import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SalesforceService } from './salesforce';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("SF Metadata Exporter");
    outputChannel.appendLine('Salesforce Metadata Exporter is now active!');
    
    SalesforceService.setOutputChannel(outputChannel);


    let disposable = vscode.commands.registerCommand('sf-metadata-exporter.open', () => {
        SfMetadataExporterPanel.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(disposable);
}

class SfMetadataExporterPanel {
    public static currentPanel: SfMetadataExporterPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private readonly _sfService: SalesforceService;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (SfMetadataExporterPanel.currentPanel) {
            SfMetadataExporterPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'sfMetadataExporter',
            'SF Metadata Exporter',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'src', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'images'),
                    extensionUri
                ]
            }
        );

        SfMetadataExporterPanel.currentPanel = new SfMetadataExporterPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._sfService = new SalesforceService();

        this._panel.webview.onDidReceiveMessage(
            async message => {
                console.log("SFME Message Received:", message.command);
                switch (message.command) {
                    case 'webviewLog':
                        outputChannel.appendLine(`[webview] ${message.text}`);
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'getMetadataTypes':
                        outputChannel.appendLine('Webview requested: getMetadataTypes');
                        try {
                            const types = await this._sfService.describeMetadata();
                            outputChannel.appendLine(`Found ${types.length} metadata types. Sending to webview...`);
                            this._panel.webview.postMessage({ command: 'setMetadataTypes', types: types });
                        } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            outputChannel.appendLine(`Error fetching metadata types: ${message}`);
                            vscode.window.showErrorMessage(`Failed to fetch metadata types: ${message}`);
                            this._panel.webview.postMessage({ command: 'metadataTypesError', message });
                        }
                        return;
                    case 'getMetadataMembers':
                        try {
                            const members = await this._sfService.listMetadata(message.type);
                            this._panel.webview.postMessage({ command: 'setMembers', type: message.type, members: members, requestId: message.requestId });

                            if (message.type === 'CustomMetadata') {
                                this._sfService.hydrateCustomMetadata(members).then(hydrated => {
                                    this._panel.webview.postMessage({ command: 'setMembers', type: message.type, members: hydrated, requestId: message.requestId });
                                });
                            }
                        } catch (e) {
                            const messageText = e instanceof Error ? e.message : String(e);
                            vscode.window.showErrorMessage(`Failed to fetch members: ${messageText}`);
                            this._panel.webview.postMessage({ command: 'membersError', type: message.type, message: messageText, requestId: message.requestId });
                        }
                        return;
                    case 'getOrgUrl':
                        try {
                            const url = await this._sfService.getOrgUrl();
                            this._panel.webview.postMessage({ command: 'setOrgUrl', url });
                        } catch (e) {
                            outputChannel.appendLine(`Error fetching org URL: ${e}`);
                        }
                        return;
                    case 'openInOrg':
                        try {
                            const orgUrl = await this._sfService.getOrgUrl();
                            let target = orgUrl;
                            if (message.id) {
                                target = `${orgUrl}/${message.id}`;
                            }
                            vscode.env.openExternal(vscode.Uri.parse(target));
                        } catch (e) {
                            vscode.window.showErrorMessage(`Failed to open in Org: ${e}`);
                        }
                        return;
                    case 'updateManifest':
                        // Backward compatibility or single type update
                        await this._sfService.updateManifest([{ name: message.type, members: message.members }]);
                        return;
                    case 'updateManifestBulk':
                        try {
                            await this._sfService.updateManifest(message.types, !!message.silent);
                        } catch (e) {
                            vscode.window.showErrorMessage('Failed to update manifest: ' + e);
                        }
                        return;
                    case 'retrieve':
                        try {
                            await this._sfService.retrieveMetadata();
                        } catch (e) {
                            vscode.window.showErrorMessage('Failed to retrieve: ' + e);
                        }
                        return;
                    case 'retrieveWithUpdate':
                        // Step 1: update package.xml silently with current selections
                        // Step 2: open terminal and run SF CLI retrieve
                        try {
                            if (message.types && message.types.length > 0) {
                                await this._sfService.updateManifest(message.types, true /* silent */);
                            }
                            await this._sfService.retrieveMetadata();
                        } catch (e) {
                            vscode.window.showErrorMessage('Retrieve failed: ' + e);
                        }
                        return;
                }
            },
            null,
            this._disposables
        );

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        SfMetadataExporterPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        const fontAwesomeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'vendor', 'fontawesome', 'css', 'all.min.css'));
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'index.html');

        const cspSource = webview.cspSource;

        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Inject CSP meta tag FIRST so fonts are allowed to load
        const csp = [
            `default-src 'none'`,
            `style-src ${cspSource} 'unsafe-inline'`,
            `font-src ${cspSource} data:`,
            `script-src ${cspSource}`,
            `img-src ${cspSource} https: data: blob:`,
        ].join('; ');

        // Inject stylesheet and Font Awesome links
        htmlContent = htmlContent.replace('</head>', `
<link href="${styleUri}" rel="stylesheet">
<link href="${fontAwesomeUri}" rel="stylesheet">
</head>`);
        const startupFallback = `
<script>
setTimeout(function () {
    if (window.__sfmeStarted) return;
    var list = document.getElementById('type-list');
    if (list) {
        list.innerHTML = '<div class="load-error compact"><strong>Webview script did not start</strong><span>Reload VS Code and reinstall the latest VSIX if this stays visible.</span></div>';
    }
}, 3000);
</script>`;

        htmlContent = htmlContent.replace('</body>', `<script src="${scriptUri}"></script>\n${startupFallback}\n</body>`);

        return htmlContent;
    }
}
