import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as jsforce from 'jsforce';
import * as fs from 'fs';
import * as path from 'path';

export class SalesforceService {
    private static outputChannel: vscode.OutputChannel | undefined;
    private static readonly SF_CLI_TIMEOUT_MS = 30_000;
    private static readonly METADATA_TIMEOUT_MS = 60_000;
    private conn: jsforce.Connection | undefined;

    constructor() { }

    public static setOutputChannel(channel: vscode.OutputChannel) {
        this.outputChannel = channel;
    }

    private log(msg: string) {
        console.log(msg);
        if (SalesforceService.outputChannel) {
            SalesforceService.outputChannel.appendLine(msg);
        }
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${operation} timed out after ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
        });

        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    private async getOrgInfo(): Promise<{ accessToken: string; instanceUrl: string }> {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return new Promise((resolve, reject) => {
            this.log('Fetching Org Info using SF CLI...');
            cp.exec('sf org display --json', {
                cwd: rootPath,
                maxBuffer: 1024 * 1024 * 10,
                timeout: SalesforceService.SF_CLI_TIMEOUT_MS,
                killSignal: 'SIGTERM'
            }, (err, stdout, stderr) => {
                if (err) {
                    this.log(`SF CLI Exec Error: ${err.message}`);
                    this.log(`SF CLI Stderr: ${stderr}`);
                    reject(`SF CLI Error: ${stderr || err.message}`);
                    return;
                }
                try {
                    const result = JSON.parse(stdout);
                    if (result.status === 0 && result.result) {
                        resolve({
                            accessToken: result.result.accessToken,
                            instanceUrl: result.result.instanceUrl
                        });
                    } else {
                        reject(result.message || 'Unknown SF CLI error');
                    }
                } catch (e) {
                    reject('Failed to parse SF CLI output');
                }
            });
        });
    }

    public async connect(): Promise<boolean> {
        try {
            const orgInfo = await this.getOrgInfo();
            this.conn = new jsforce.Connection({
                instanceUrl: orgInfo.instanceUrl,
                accessToken: orgInfo.accessToken
            });
            return true;
        } catch (e) {
            const msg = `Salesforce Connection Error: ${e}. Ensure you have a default org set (sf config set target-org <alias>).`;
            this.log(msg);
            vscode.window.showErrorMessage(msg);
            return false;
        }
    }

    public async describeMetadata(): Promise<string[]> {
        this.log('Describing Metadata Types...');
        if (!this.conn) {
            this.log('No connection, attempting to connect...');
            const success = await this.connect();
            if (!success) {
                this.log('Connection attempt failed.');
                return [];
            }
        }
        if (!this.conn) { 
            this.log('Connection failed, cannot describe metadata.');
            return []; 
        }

        try {
            const description = await this.withTimeout(
                this.conn.metadata.describe('60.0'),
                SalesforceService.METADATA_TIMEOUT_MS,
                'Describing metadata'
            ); // Hardcoded version for now
            const types = new Set<string>();

            description.metadataObjects.forEach((obj: any) => {
                types.add(obj.xmlName);
                if (obj.childXmlNames) {
                    if (Array.isArray(obj.childXmlNames)) {
                        obj.childXmlNames.forEach((child: string) => types.add(child));
                    } else {
                        types.add(obj.childXmlNames);
                    }
                }
            });

            return Array.from(types).sort();
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage('Error describing metadata: ' + error);
            throw new Error(error);
        }
    }

    public async listMetadata(type: string, folder?: string): Promise<any[]> {
        if (!this.conn) {
            await this.connect();
        }
        if (!this.conn) { return []; }

        try {
            // Construct query specifically to avoid undefined issues
            const query: any = { type: type };
            if (folder) {
                query.folder = folder;
            }

            console.log(`Listing metadata for type: ${type}, folder: ${folder}`);

            // Query
            const members = await this.withTimeout(
                this.conn.metadata.list([query], '60.0'),
                SalesforceService.METADATA_TIMEOUT_MS,
                `Listing ${type}`
            );

            if (!members) {
                console.log(`No members found for ${type}`);
                return [];
            }

            let fileProperties = Array.isArray(members) ? members : [members];
            console.log(`Found ${fileProperties.length} members for ${type}`);

            // Enrich with local existence info
            const enriched = await this.enrichWithLocalStatus(type, fileProperties);

            return enriched.map((m: any) => ({
                fullName: m.fullName,
                lastModifiedDate: m.lastModifiedDate,
                lastModifiedByName: m.lastModifiedByName,
                type: m.type,
                isLocal: m.isLocal,
                status: m.status
            }));
        } catch (e) {
            console.error(e);
            throw e;
        }
    }

    public async hydrateCustomMetadata(members: any[]): Promise<any[]> {
        if (!this.conn || members.length === 0) return members;

        const fileProperties = [...members]; // Clone to modify

        try {
            // 1. Group by underlying type (Prefix of RecordName) and create lookup maps
            const typeGroups = new Map<string, any[]>();
            const typeMemberMaps = new Map<string, Map<string, any>>();
            fileProperties.forEach((m: any) => {
                const parts = m.fullName.split('.');
                if (parts.length === 2) {
                    const typeName = parts[0];
                    if (!typeGroups.has(typeName)) {
                        typeGroups.set(typeName, []);
                        typeMemberMaps.set(typeName, new Map());
                    }
                    typeGroups.get(typeName)?.push(m);
                    typeMemberMaps.get(typeName)?.set(m.fullName, m);
                }
            });

            // 2. Query each Type__mdt
            const typeNames = Array.from(typeGroups.keys());
            const hydrateType = async (typeName: string) => {
                const mdtName = typeName.endsWith('__mdt') ? typeName : `${typeName}__mdt`;
                try {
                    const soql = `SELECT DeveloperName, LastModifiedDate, LastModifiedBy.Name FROM ${mdtName}`;
                    const result = await this.conn!.query(soql);
                    const records = result.records;
                    const memberMap = typeMemberMaps.get(typeName);

                    // 3. Map results back using O(1) lookups
                    records.forEach((rec: any) => {
                        const fullRecordName = `${typeName}.${rec.DeveloperName}`;
                        const member = memberMap?.get(fullRecordName);
                        if (member) {
                            member.lastModifiedDate = rec.LastModifiedDate;
                            if (rec.LastModifiedBy && rec.LastModifiedBy.Name) {
                                member.lastModifiedByName = rec.LastModifiedBy.Name;
                            }
                        }
                    });
                } catch (qErr) {
                    // console.warn(`Failed to hydrate ${mdtName}`, qErr);
                    // Silently fail for individual types (permissions/existence issues)
                }
            };

            const concurrency = 4;
            for (let i = 0; i < typeNames.length; i += concurrency) {
                await Promise.all(typeNames.slice(i, i + concurrency).map(hydrateType));
            }
        } catch (hErr) {
            console.error('Hydration failed', hErr);
        }

        return fileProperties;
    }


    public async updateManifest(types: { name: string; members: string[] }[], silent: boolean = false) {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('No workspace open to save package.xml');
            return;
        }

        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const packageXmlPath = path.join(rootPath, 'manifest', 'package.xml');
        // Ensure manifest dir exists
        const manifestDir = path.dirname(packageXmlPath);
        if (!fs.existsSync(manifestDir)) {
            fs.mkdirSync(manifestDir, { recursive: true });
        }

        const escapeXml = (unsafe: string) => {
            return unsafe.replace(/[<>&'"]/g, (c) => {
                switch (c) {
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '&': return '&amp;';
                    case '\'': return '&apos;';
                    case '"': return '&quot;';
                }
                return c;
            });
        };

        const normalizedTypes = new Map<string, Set<string>>();
        for (const typeEntry of types) {
            const typeName = String(typeEntry?.name || '').trim();
            if (!typeName) {
                continue;
            }

            const existingMembers = normalizedTypes.get(typeName) || new Set<string>();
            for (const member of typeEntry.members || []) {
                const memberName = String(member || '').trim();
                if (!memberName) {
                    continue;
                }
                if (memberName === '*') {
                    existingMembers.clear();
                    existingMembers.add('*');
                    break;
                }
                if (!existingMembers.has('*')) {
                    existingMembers.add(memberName);
                }
            }

            if (existingMembers.size > 0) {
                normalizedTypes.set(typeName, existingMembers);
            }
        }

        if (normalizedTypes.size === 0) {
            vscode.window.showErrorMessage('No valid metadata selections found to update package.xml');
            return;
        }

        // Simple XML generation
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';

        for (const typeName of Array.from(normalizedTypes.keys()).sort((a, b) => a.localeCompare(b))) {
            const members = Array.from(normalizedTypes.get(typeName) || []).sort((a, b) => a.localeCompare(b));
            xml += '    <types>\n';
            members.forEach(m => {
                xml += `        <members>${escapeXml(m)}</members>\n`;
            });
            xml += `        <name>${escapeXml(typeName)}</name>\n`;
            xml += '    </types>\n';
        }

        xml += '    <version>60.0</version>\n';
        xml += '</Package>';

        try {
            fs.writeFileSync(packageXmlPath, xml);
        } catch (e) {
            vscode.window.showErrorMessage('Error writing package.xml: ' + e);
            throw e;
        }
        
        if (!silent) {
            vscode.window.showInformationMessage(`Manifest updated at ${packageXmlPath}`);
            // Open the file
            const doc = await vscode.workspace.openTextDocument(packageXmlPath);
            await vscode.window.showTextDocument(doc);
        }
    }
    private async enrichWithLocalStatus(type: string, members: any[]): Promise<any[]> {
        if (!vscode.workspace.workspaceFolders) return members;
        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        
        // 1. Find sfdx-project.json
        const projectPath = path.join(rootPath, 'sfdx-project.json');
        if (!fs.existsSync(projectPath)) return members;

        try {
            const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
            const packageDirectories = projectData.packageDirectories || [{ path: 'force-app' }];
            
            // 2. Simple mapping for common types
            const typeToFolder: any = {
                'ApexClass': { folder: 'classes', ext: '.cls' },
                'ApexTrigger': { folder: 'triggers', ext: '.trigger' },
                'ApexPage': { folder: 'pages', ext: '.page' },
                'ApexComponent': { folder: 'components', ext: '.component' },
                'LightningWebComponent': { folder: 'lwc', isDir: true },
                'AuraDefinitionBundle': { folder: 'aura', isDir: true },
                'CustomObject': { folder: 'objects', ext: '.object-meta.xml' },
                'Layout': { folder: 'layouts', ext: '.layout-meta.xml' },
                'StaticResource': { folder: 'staticresources', ext: '.resource-meta.xml' }
            };

            const config = typeToFolder[type];
            if (!config) return members;

            const packageBasePaths = packageDirectories
                .map((dir: any) => path.join(rootPath, dir.path, 'main', 'default', config.folder))
                .filter((basePath: string) => fs.existsSync(basePath));

            if (packageBasePaths.length === 0) return members;

            const localEntries = new Map<string, Date>();

            for (const basePath of packageBasePaths) {
                const entries = fs.readdirSync(basePath, { withFileTypes: true });
                for (const entry of entries) {
                    const entryPath = path.join(basePath, entry.name);
                    if (config.isDir) {
                        if (!entry.isDirectory()) continue;
                        localEntries.set(entry.name, fs.statSync(entryPath).mtime);
                    } else {
                        if (!entry.isFile() || !entry.name.endsWith(config.ext)) continue;
                        localEntries.set(entry.name.slice(0, -config.ext.length), fs.statSync(entryPath).mtime);
                    }
                }
            }

            return members.map(m => {
                let found = false;
                let status = 'new';
                const localMtime = localEntries.get(m.fullName);

                if (localMtime) {
                    found = true;
                    const serverDate = new Date(m.lastModifiedDate);
                    if (serverDate > localMtime) {
                        status = 'changed';
                    } else {
                        status = 'synced';
                    }
                }

                return { ...m, isLocal: found, status: status };
            });

        } catch (e) {
            console.error('Error checking local status', e);
            return members;
        }
    }
    public async getOrgUrl(): Promise<string> { const info = await this.getOrgInfo(); return info.instanceUrl; }
    public async retrieveMetadata(): Promise<void> {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open your Salesforce project folder first.');
            return;
        }

        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const manifestPath = path.join(rootPath, 'manifest', 'package.xml');

        // Ensure manifest exists before attempting retrieve
        if (!fs.existsSync(manifestPath)) {
            vscode.window.showErrorMessage(`manifest/package.xml not found at ${manifestPath}. Use "Update package.xml" first.`);
            return;
        }

        // Reuse existing terminal if available, else create a new one with explicit cwd
        const TERMINAL_NAME = 'SF Metadata Retrieve';
        let terminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
        if (!terminal || terminal.exitStatus !== undefined) {
            terminal = vscode.window.createTerminal({
                name: TERMINAL_NAME,
                cwd: rootPath,
            });
        }

        terminal.show(true); // true = preserve focus on editor

        // Wait for the shell to initialise before sending text
        await new Promise(resolve => setTimeout(resolve, 400));

        terminal.sendText(`sf project retrieve start -x manifest/package.xml`);
    }
}
