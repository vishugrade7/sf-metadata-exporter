const vscode = acquireVsCodeApi();

function webviewLog(text) {
    try {
        vscode.postMessage({ command: 'webviewLog', text: String(text) });
    } catch (e) {
        // The extension host may not be ready yet; keep startup resilient.
    }
}

function safeStorageGet(key) {
    try {
        return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (e) {
        webviewLog(`localStorage get failed for ${key}: ${e && e.message ? e.message : e}`);
        return null;
    }
}

function safeStorageSet(key, value) {
    try {
        if (window.localStorage) {
            window.localStorage.setItem(key, value);
        }
    } catch (e) {
        webviewLog(`localStorage set failed for ${key}: ${e && e.message ? e.message : e}`);
    }
}

function runStartupStep(name, fn) {
    try {
        fn();
        webviewLog(`${name} initialized`);
    } catch (e) {
        webviewLog(`${name} failed: ${e && e.message ? e.message : e}`);
    }
}

window.addEventListener('error', event => {
    webviewLog(`runtime error: ${event.message || 'unknown error'}${event.lineno ? ` at ${event.lineno}:${event.colno}` : ''}`);
});

window.addEventListener('unhandledrejection', event => {
    webviewLog(`unhandled rejection: ${event.reason && event.reason.message ? event.reason.message : event.reason}`);
});

// --- Theme Toggle (Light/Dark) ---
const THEME_STORAGE_KEY = 'sfme-theme';

function isLightColor(color) {
    // Supports rgb(), rgba(), #rgb, #rrggbb. Returns false if unknown.
    if (!color) return false;
    const c = String(color).trim().toLowerCase();

    let r, g, b;
    const rgbMatch = c.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/);
    if (rgbMatch) {
        r = Number(rgbMatch[1]);
        g = Number(rgbMatch[2]);
        b = Number(rgbMatch[3]);
    } else if (c.startsWith('#')) {
        const hex = c.slice(1);
        if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
        } else if (hex.length === 6) {
            r = parseInt(hex.slice(0, 2), 16);
            g = parseInt(hex.slice(2, 4), 16);
            b = parseInt(hex.slice(4, 6), 16);
        } else {
            return false;
        }
    } else {
        return false;
    }

    // Relative luminance approximation (sRGB)
    const srgb = [r, g, b].map(v => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    return L > 0.5;
}

function inferVscodeTheme() {
    // Prefer VS Code-provided CSS var if available; fallback to computed body background.
    const rootStyles = getComputedStyle(document.documentElement);
    const vscodeBg = rootStyles.getPropertyValue('--vscode-editor-background').trim();
    const bg = vscodeBg || getComputedStyle(document.body).backgroundColor;
    return isLightColor(bg) ? 'light' : 'dark';
}

function getInitialTheme() {
    const stored = safeStorageGet(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    // Default: follow VS Code theme variables (no override)
    return 'auto';
}

function applyTheme(theme) {
    if (theme === 'auto') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = theme;
    }

    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;

    const icon = btn.querySelector('i');
    const effective = theme === 'auto' ? inferVscodeTheme() : theme;
    const isDark = effective === 'dark';
    btn.setAttribute('aria-pressed', String(isDark));
    btn.title = theme === 'auto'
        ? (isDark ? 'Using VS Code theme (Dark). Click to force Light' : 'Using VS Code theme (Light). Click to force Dark')
        : (isDark ? 'Switch to Light theme' : 'Switch to Dark theme');
    btn.setAttribute('aria-label', btn.title);

    if (icon) {
        icon.className = theme === 'auto'
            ? 'fas fa-circle-half-stroke'
            : (isDark ? 'fas fa-moon' : 'fas fa-sun');
    }
}

function initThemeToggle() {
    const initial = getInitialTheme();
    applyTheme(initial);

    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const current = document.documentElement.dataset.theme;
        const effective = current ? current : inferVscodeTheme();
        const next = effective === 'dark' ? 'light' : 'dark';
        safeStorageSet(THEME_STORAGE_KEY, next);
        applyTheme(next);
    });
}

// --- Sidebar Auto/Manual Minimize ---
const SIDEBAR_PINNED_KEY = 'sfme-sidebar-pinned';
const SIDEBAR_COLLAPSED_KEY = 'sfme-sidebar-collapsed';

let sidebarPinned = false;
let sidebarCollapsed = false;
let sidebarAutoTimer = null;

function readBool(key, fallback = false) {
    const raw = safeStorageGet(key);
    if (raw === null) return fallback;
    return raw === 'true';
}

function applySidebarState() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    sidebar.classList.toggle('collapsed', !!sidebarCollapsed);

    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    const collapseIcon = collapseBtn ? collapseBtn.querySelector('i') : null;
    if (collapseBtn) {
        collapseBtn.setAttribute('aria-pressed', String(!!sidebarCollapsed));
        collapseBtn.title = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
        collapseBtn.setAttribute('aria-label', collapseBtn.title);
        if (collapseIcon) {
            collapseIcon.className = sidebarCollapsed ? 'fas fa-angle-double-right' : 'fas fa-angle-double-left';
        }
    }

    const pinBtn = document.getElementById('sidebar-pin-btn');
    if (pinBtn) {
        pinBtn.setAttribute('aria-pressed', String(!!sidebarPinned));
        pinBtn.title = sidebarPinned ? 'Unpin sidebar (enable auto-minimize)' : 'Pin sidebar (disable auto-minimize)';
        pinBtn.setAttribute('aria-label', pinBtn.title);
        pinBtn.classList.toggle('active', !!sidebarPinned);
    }
}

function setSidebarCollapsed(nextCollapsed, { persist = true } = {}) {
    sidebarCollapsed = !!nextCollapsed;
    if (persist) safeStorageSet(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    applySidebarState();
}

function setSidebarPinned(nextPinned, { persist = true } = {}) {
    sidebarPinned = !!nextPinned;
    if (persist) safeStorageSet(SIDEBAR_PINNED_KEY, String(sidebarPinned));
    applySidebarState();
}

function initSidebarMinimize() {
    sidebarPinned = readBool(SIDEBAR_PINNED_KEY, true);
    sidebarCollapsed = readBool(SIDEBAR_COLLAPSED_KEY, false);
    applySidebarState();

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            // Manual override: if user collapses/expands explicitly, keep it (and pin).
            setSidebarPinned(true);
            setSidebarCollapsed(!sidebarCollapsed);
        });
    }

    const pinBtn = document.getElementById('sidebar-pin-btn');
    if (pinBtn) {
        pinBtn.addEventListener('click', () => {
            setSidebarPinned(!sidebarPinned);
            // If user unpins while not hovered, allow auto-collapse quickly.
            if (!sidebarPinned && !sidebar.matches(':hover')) {
                setSidebarCollapsed(true);
            }
        });
    }

    sidebar.addEventListener('mouseenter', () => {
        if (sidebarAutoTimer) {
            clearTimeout(sidebarAutoTimer);
            sidebarAutoTimer = null;
        }
        if (!sidebarPinned) {
            setSidebarCollapsed(false);
        }
    });

    sidebar.addEventListener('mouseleave', () => {
        if (sidebarPinned) return;
        if (sidebarAutoTimer) clearTimeout(sidebarAutoTimer);
        sidebarAutoTimer = setTimeout(() => {
            setSidebarCollapsed(true);
            sidebarAutoTimer = null;
        }, 350);
    });
}

// State
let allMetadataTypes = [];
let currentMembers = [];
let allMembers = [];
let selections = {}; // Object: { 'TypeName': Set(['Member1', 'Member2']) }
let currentType = '';
let currentFolder = null; // null = root, string = folder name
let currentSort = { field: 'name', direction: 'asc' };
let wildcards = {}; // Object: { 'TypeName': boolean }
let metadataTypesTimer = null;
let membersTimer = null;
let memberRequestId = 0;
const TYPES_TIMEOUT_MS = 45000;
const MEMBERS_TIMEOUT_MS = 70000;

// DOM Elements
const typeListEl = document.getElementById('type-list');
const membersListEl = document.getElementById('members-list');
const membersContentEl = document.getElementById('members-content');
const typeSearchInput = document.getElementById('type-search');
const memberSearchInput = document.getElementById('member-search');
const selectedTypeDisplay = document.getElementById('selected-type-display');
const userFilterSelect = document.getElementById('user-filter'); // now a custom dropdown container
const dateFilterStart = document.getElementById('date-filter-start');
const dateFilterEnd = document.getElementById('date-filter-end');
const updateBtn = document.getElementById('update-btn');
const copyBtn = document.getElementById('copy-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const selectFilteredBtn = document.getElementById('select-filtered-btn');
const wildcardCheckbox = document.getElementById('wildcard-checkbox');
const wildcardWarningEl = document.getElementById('wildcard-warning');
const helpBtn = document.getElementById('help-btn');
const tutorialOverlay = document.getElementById('tutorial-overlay');
const tutorialStepsEl = document.getElementById('tutorial-steps');
const stepDotsEl = document.getElementById('step-dots');
const nextStepBtn = document.getElementById('next-step');
const prevStepBtn = document.getElementById('prev-step');
const closeTutorialBtn = document.getElementById('close-tutorial');
const lockBtn = document.getElementById('lock-btn');
const lockIcon = lockBtn ? lockBtn.querySelector('i') : null;

// --- Custom User Filter Dropdown State ---
let userFilterValue = ''; // '' => All Users
let allUserOptions = []; // array of strings

function ensureSelectionSet(type) {
    if (!type) return new Set();
    if (!selections[type]) {
        selections[type] = new Set();
    }
    return selections[type];
}

function getUserFilterEls() {
    if (!userFilterSelect) return null;
    const trigger = userFilterSelect.querySelector('.custom-select-trigger');
    const valueEl = userFilterSelect.querySelector('.custom-select-value');
    const dropdown = userFilterSelect.querySelector('.custom-select-dropdown');
    const optionsEl = userFilterSelect.querySelector('.custom-select-options');
    const searchInput = userFilterSelect.querySelector('.custom-select-search-input');
    return { trigger, valueEl, dropdown, optionsEl, searchInput };
}

function setUserFilterValue(next) {
    userFilterValue = next || '';
    const els = getUserFilterEls();
    if (els && els.valueEl) {
        els.valueEl.textContent = userFilterValue ? userFilterValue : 'All Users';
    }
    renderUserFilterOptions();
    scheduleApplyFilters();
}

function openUserFilterDropdown() {
    const els = getUserFilterEls();
    if (!els || !els.trigger) return;
    userFilterSelect.classList.add('open');
    els.trigger.setAttribute('aria-expanded', 'true');
    if (els.searchInput) {
        els.searchInput.value = '';
        els.searchInput.focus();
    }
    renderUserFilterOptions();
}

function closeUserFilterDropdown() {
    const els = getUserFilterEls();
    if (!els || !els.trigger) return;
    userFilterSelect.classList.remove('open');
    els.trigger.setAttribute('aria-expanded', 'false');
}

function toggleUserFilterDropdown() {
    if (!userFilterSelect) return;
    if (userFilterSelect.classList.contains('open')) closeUserFilterDropdown();
    else openUserFilterDropdown();
}

function renderUserFilterOptions() {
    const els = getUserFilterEls();
    if (!els || !els.optionsEl) return;

    const term = (els.searchInput && els.searchInput.value ? els.searchInput.value : '').toLowerCase().trim();

    const options = [''].concat(allUserOptions);
    const filtered = term
        ? options.filter(o => (o ? o : 'All Users').toLowerCase().includes(term))
        : options;

    els.optionsEl.innerHTML = '';
    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'custom-select-empty';
        empty.textContent = 'No matches';
        els.optionsEl.appendChild(empty);
        return;
    }

    filtered.forEach(optVal => {
        const row = document.createElement('div');
        row.className = 'custom-select-option' + ((optVal || '') === (userFilterValue || '') ? ' selected' : '');
        row.dataset.value = optVal;

        const check = document.createElement('span');
        check.className = 'custom-select-check';
        check.innerHTML = '<i class="fas fa-check"></i>';

        const text = document.createElement('span');
        text.textContent = optVal ? optVal : 'All Users';

        row.appendChild(check);
        row.appendChild(text);
        row.addEventListener('click', () => {
            setUserFilterValue(optVal);
            closeUserFilterDropdown();
        });

        els.optionsEl.appendChild(row);
    });
}

function initUserFilterDropdown() {
    const els = getUserFilterEls();
    if (!els || !els.trigger) return;

    els.trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUserFilterDropdown();
    });

    if (els.searchInput) {
        els.searchInput.addEventListener('input', renderUserFilterOptions);
        els.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeUserFilterDropdown();
            }
        });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!userFilterSelect) return;
        if (!userFilterSelect.classList.contains('open')) return;
        if (userFilterSelect.contains(e.target)) return;
        closeUserFilterDropdown();
    });

    // Close on escape anywhere
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!userFilterSelect || !userFilterSelect.classList.contains('open')) return;
        closeUserFilterDropdown();
    });

    // Default display
    setUserFilterValue('');
}

// --- State Management ---

function saveState() {
    try {
    // Convert Sets to Arrays for storage
    const serializedSelections = {};
    for (const [key, value] of Object.entries(selections)) {
        serializedSelections[key] = Array.from(value);
    }

        vscode.setState({
            selections: serializedSelections,
            currentType: currentType,
            allMetadataTypes: allMetadataTypes,
            wildcards: wildcards
        });
    } catch (e) {
        webviewLog(`setState failed: ${e && e.message ? e.message : e}`);
    }
}

function restoreState() {
    let state = null;
    try {
        state = vscode.getState();
    } catch (e) {
        webviewLog(`getState failed: ${e && e.message ? e.message : e}`);
    }
    if (state) {
        if (state.selections) {
            // Convert Arrays back to Sets
            for (const [key, value] of Object.entries(state.selections)) {
                selections[key] = new Set(value);
            }
        }
        if (state.currentType) {
            currentType = state.currentType;
        }
        if (state.allMetadataTypes) {
            allMetadataTypes = state.allMetadataTypes;
            renderMetadataTypes(allMetadataTypes);
        }
        if (state.wildcards) {
            wildcards = state.wildcards;
        }

        // If we have a current type, verify UI is synced or fetch members
        if (currentType) {
            selectedTypeDisplay.textContent = currentType;
            requestMetadataMembers(currentType);
        }
    }
}

function setMetadataTypesLoading() {
    typeListEl.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const row = document.createElement('div');
        row.className = 'skeleton-sidebar-item';
        const icon = document.createElement('div');
        icon.className = 'skeleton-sidebar-icon';
        const text = document.createElement('div');
        text.className = 'skeleton-sidebar-text';
        text.style.maxWidth = `${45 + (i % 5) * 10}%`;
        row.appendChild(icon);
        row.appendChild(text);
        typeListEl.appendChild(row);
    }
}

function showTypeError(message) {
    typeListEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'load-error compact';

    const title = document.createElement('strong');
    title.textContent = 'Could not load metadata types';
    const detail = document.createElement('span');
    detail.textContent = message || 'Salesforce did not respond in time.';
    const retry = document.createElement('button');
    retry.className = 'mini-btn';
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', requestMetadataTypes);

    container.appendChild(title);
    container.appendChild(detail);
    container.appendChild(retry);
    typeListEl.appendChild(container);
}

function showMembersError(message) {
    membersContentEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'load-error';

    const title = document.createElement('strong');
    title.textContent = currentType ? `Could not load ${currentType}` : 'Could not load members';
    const detail = document.createElement('span');
    detail.textContent = message || 'Salesforce did not respond in time.';
    const retry = document.createElement('button');
    retry.className = 'mini-btn';
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
        if (currentType) requestMetadataMembers(currentType);
    });

    container.appendChild(title);
    container.appendChild(detail);
    container.appendChild(retry);
    membersContentEl.appendChild(container);
}

function requestMetadataTypes() {
    if (metadataTypesTimer) clearTimeout(metadataTypesTimer);
    setMetadataTypesLoading();
    webviewLog('requesting metadata types');
    metadataTypesTimer = setTimeout(() => {
        metadataTypesTimer = null;
        showTypeError('The Salesforce CLI or Metadata API is taking too long. Check your default org and try again.');
    }, TYPES_TIMEOUT_MS);
    vscode.postMessage({ command: 'getMetadataTypes' });
}

function requestMetadataMembers(type) {
    if (!type) return;
    if (membersTimer) clearTimeout(membersTimer);
    const requestId = ++memberRequestId;
    webviewLog(`requesting members for ${type} (${requestId})`);
    renderSkeletons();
    membersTimer = setTimeout(() => {
        if (requestId !== memberRequestId) return;
        membersTimer = null;
        showMembersError('The Salesforce Metadata API is taking too long. Retry after confirming your org is reachable.');
    }, MEMBERS_TIMEOUT_MS);
    vscode.postMessage({ command: 'getMetadataMembers', type: type, requestId });
}

// Initial Load
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'setMetadataTypes':
            if (metadataTypesTimer) {
                clearTimeout(metadataTypesTimer);
                metadataTypesTimer = null;
            }
            allMetadataTypes = message.types;
            saveState(); // Save types when loaded
            renderMetadataTypes(allMetadataTypes);
            break;
        case 'metadataTypesError':
            if (metadataTypesTimer) {
                clearTimeout(metadataTypesTimer);
                metadataTypesTimer = null;
            }
            showTypeError(message.message);
            break;
        case 'membersError':
            if (message.type && currentType && message.type !== currentType) {
                break;
            }
            if (message.requestId && message.requestId !== memberRequestId) {
                break;
            }
            if (membersTimer) {
                clearTimeout(membersTimer);
                membersTimer = null;
            }
            showMembersError(message.message);
            break;
        case 'setMembers':
            // Ignore stale responses when user switches types quickly
            if (message.type && currentType && message.type !== currentType) {
                break;
            }
            if (message.requestId && message.requestId !== memberRequestId) {
                break;
            }
            if (membersTimer) {
                clearTimeout(membersTimer);
                membersTimer = null;
            }
            allMembers = message.members;
            currentMembers = allMembers;
            scheduleApplyFilters();
            populateUserFilter(allMembers);
            break;
        case 'alert':
            // Should handle alerts if implemented in extension to send alerts back? 
            // Or maybe we use vscode.window.showInformationMessage in extension.
            break;
    }
});

runStartupStep('theme', initThemeToggle);
runStartupStep('sidebar', initSidebarMinimize);
runStartupStep('user filter', initUserFilterDropdown);

// Restore state on startup
runStartupStep('state restore', restoreState);
webviewLog(`state restored; cached metadata types: ${allMetadataTypes.length}`);

// Always fetch types too, just in case (or if fresh)
if (allMetadataTypes.length === 0) {
    requestMetadataTypes();
}

// --- Metadata Types Logic ---

function getTypeIcon(type) {
    const map = {
        'ApexClass': 'fa-code',
        'ApexComponent': 'fa-file-code',
        'ApexPage': 'fa-file-code',
        'ApexTrigger': 'fa-bolt',
        'ApexTestSuite': 'fa-vial',
        'ApexEmailNotifications': 'fa-bell',
        'CustomObject': 'fa-database',
        'CustomField': 'fa-columns',
        'CustomLabel': 'fa-tags',
        'Layout': 'fa-layer-group',
        'LightningComponent': 'fa-bolt',
        'AuraDefinitionBundle': 'fa-bolt',
        'LightningWebComponent': 'fa-code',
        'StaticResource': 'fa-file-archive',
        'PermissionSet': 'fa-user-shield',
        'Profile': 'fa-id-badge',
        'Role': 'fa-sitemap',
        'Flow': 'fa-wind',
        'FlowDefinition': 'fa-wind',
        'Workflow': 'fa-random',
        'WorkflowRule': 'fa-random',
        'Report': 'fa-chart-bar',
        'Dashboard': 'fa-tachometer-alt',
        'EmailTemplate': 'fa-envelope',
        'Queue': 'fa-users',
        'Group': 'fa-users',
        'User': 'fa-user',
        'AppMenu': 'fa-th',
        'CustomTab': 'fa-folder',
        'FlexiPage': 'fa-columns',
        'RecordType': 'fa-tag',
        'ValidationRule': 'fa-check-circle',
        'AssignmentRule': 'fa-arrow-right',
        'AssignmentRules': 'fa-arrow-right-long',
        'AutoResponseRule': 'fa-reply',
        'EscalationRule': 'fa-exclamation-triangle',
        'SharingRule': 'fa-share-alt',
        'Letterhead': 'fa-file-alt',
        'QuickAction': 'fa-bolt',
        'GlobalValueSet': 'fa-list',
        'CustomMetadata': 'fa-database',
        'AIApplication': 'fa-robot',
        'AIApplicationConfig': 'fa-brain',
        'ActionLauncherItemDef': 'fa-rocket',
        'ActionLinkGroupTemplate': 'fa-link',
        'AnalyticSnapshot': 'fa-camera',
        'AnimationRule': 'fa-film',
        'AppointmentAssignmentPolicy': 'fa-calendar-check',
        'AppointmentSchedulingPolicy': 'fa-calendar-alt',
        'ApprovalProcess': 'fa-thumbs-up',
        'CustomApplication': 'fa-window-maximize',
        'ConnectedApp': 'fa-network-wired',
        'ExternalDataSource': 'fa-cloud',
        'NamedCredential': 'fa-key',
        'RemoteSiteSetting': 'fa-globe',
        'Settings': 'fa-sliders-h',
        'Translations': 'fa-language',
        'CustomPermission': 'fa-shield-alt',
        'PlatformEventChannel': 'fa-broadcast-tower',
        'PlatformEventSubscriberConfig': 'fa-satellite-dish'
    };
    
    if (map[type]) return map[type];
    
    // Fallback logic based on type name patterns
    const t = type.toLowerCase();
    if (t.includes('rule')) return 'fa-check-circle';
    if (t.includes('page') || t.includes('component')) return 'fa-file-code';
    if (t.includes('object') || t.includes('metadata')) return 'fa-database';
    if (t.includes('field') || t.includes('column')) return 'fa-columns';
    if (t.includes('template')) return 'fa-envelope';
    if (t.includes('report')) return 'fa-chart-bar';
    if (t.includes('dashboard')) return 'fa-tachometer-alt';
    if (t.includes('flow')) return 'fa-wind';
    if (t.includes('app')) return 'fa-window-maximize';
    if (t.includes('ai') || t.includes('intelligence') || t.includes('bot')) return 'fa-robot';
    if (t.includes('permission') || t.includes('security')) return 'fa-user-shield';
    if (t.includes('profile')) return 'fa-id-badge';
    if (t.includes('role')) return 'fa-sitemap';
    if (t.includes('user') || t.includes('group') || t.includes('queue')) return 'fa-users';
    if (t.includes('workflow') || t.includes('process')) return 'fa-random';
    if (t.includes('layout')) return 'fa-layer-group';
    if (t.includes('label')) return 'fa-tags';
    if (t.includes('apex')) return 'fa-code';
    if (t.includes('trigger')) return 'fa-bolt';
    if (t.includes('static') || t.includes('resource')) return 'fa-file-archive';
    if (t.includes('setting') || t.includes('config')) return 'fa-cog';
    if (t.includes('policy')) return 'fa-balance-scale';
    
    return 'fa-box';
}

function renderMetadataTypes(types) {
    typeListEl.innerHTML = '';
    types.forEach(type => {
        const div = document.createElement('div');
        div.className = 'list-item';
        if (type === currentType) div.classList.add('active');
        div.title = type;

        const nameSpan = document.createElement('span');

        // Icon
        const iconClass = getTypeIcon(type);
        const icon = document.createElement('i');
        icon.className = `fas ${iconClass} type-icon`;
        div.appendChild(icon);

        const text = document.createTextNode(type);
        nameSpan.appendChild(text);
        div.appendChild(nameSpan);

        // Badge
        const count = selections[type] ? selections[type].size : 0;
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = count;
            div.appendChild(badge);
        }

        div.onclick = () => selectType(type, div);
        typeListEl.appendChild(div);
    });
}

function selectType(type, element) {
    currentType = type;
    currentFolder = null; // Reset folder state immediately
    saveState();

    // Reset breadcrumb immediately
    updateBreadcrumb();

    // UI Update - Respect current search filter
    const term = typeSearchInput.value.toLowerCase();
    const filtered = allMetadataTypes.filter(t => t.toLowerCase().includes(term));
    renderMetadataTypes(filtered);

    selectedTypeDisplay.textContent = type;

    // Update Wildcard Checkbox
    wildcardCheckbox.checked = wildcards[type] || false;
    updateWildcardConflictNotice();

    // Init selection set if needed
    if (!selections[type]) {
        selections[type] = new Set();
    }
    
    requestMetadataMembers(type);
    
    // Auto-hide support banner if visible
    if (typeof hideSupportBanner === 'function') {
        hideSupportBanner();
    }
}

function updateWildcardConflictNotice() {
    if (!wildcardWarningEl) return;
    if (!currentType) {
        wildcardWarningEl.classList.add('hidden');
        wildcardWarningEl.textContent = '';
        return;
    }

    const hasWildcard = !!wildcards[currentType];
    const explicitCount = selections[currentType] ? selections[currentType].size : 0;

    if (hasWildcard && explicitCount > 0) {
        wildcardWarningEl.textContent = `Wildcard is enabled for ${currentType}. ${explicitCount} explicit selection(s) will be ignored and '*' will be used in package.xml.`;
        wildcardWarningEl.classList.remove('hidden');
        return;
    }

    wildcardWarningEl.classList.add('hidden');
    wildcardWarningEl.textContent = '';
}

typeSearchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allMetadataTypes.filter(t => t.toLowerCase().includes(term));
    renderMetadataTypes(filtered);
});

// --- Members Logic ---

const CHUNK_SIZE = 20;
let displayedMembers = [];
let renderedCount = 0;

function renderMembers(members) {
    // If search is active, flatten everything (handled by applyFilters passing filtered list)
    // If no search, check for folders

    const searchTerm = memberSearchInput.value.trim();
    displayedMembers = members; // This holds specific list to render (folders or leaf members)
    renderedCount = 0;

    membersContentEl.innerHTML = '';

    // Update Breadcrumb/Back UI
    updateBreadcrumb();

    if (members.length === 0) {
        const msg = searchTerm ? `No results for "${searchTerm}"` : (currentFolder ? 'Folder is empty' : 'No members available.');
        membersContentEl.innerHTML = `<div class="empty-state">${msg}</div>`;
        return;
    }

    renderNextChunk();
}

function renderSkeletons() {
    membersContentEl.innerHTML = '';
    const fragment = document.createDocumentFragment();
    // Render 15 skeleton rows
    for (let i = 0; i < 15; i++) {
        const div = document.createElement('div');
        div.className = 'skeleton-row';

        // Checkbox pill
        const p0 = document.createElement('div');
        p0.className = 'skeleton-pill pill-checkbox';
        div.appendChild(p0);

        // Name pill
        const p1 = document.createElement('div');
        p1.className = 'skeleton-pill pill-name';
        div.appendChild(p1);

        // User pill
        const p2 = document.createElement('div');
        p2.className = 'skeleton-pill pill-user col-user';
        if (!document.querySelector('input[data-column="col-user"]').checked) p2.classList.add('hidden');
        div.appendChild(p2);

        // Date pill
        const p3 = document.createElement('div');
        p3.className = 'skeleton-pill pill-date col-date';
        if (!document.querySelector('input[data-column="col-date"]').checked) p3.classList.add('hidden');
        div.appendChild(p3);

        // Created User
        const p4 = document.createElement('div');
        p4.className = 'skeleton-pill pill-user col-created-user';
        if (!document.querySelector('input[data-column="col-created-user"]').checked) p4.classList.add('hidden');
        div.appendChild(p4);

        // Created Date
        const p5 = document.createElement('div');
        p5.className = 'skeleton-pill pill-date col-created-date';
        if (!document.querySelector('input[data-column="col-created-date"]').checked) p5.classList.add('hidden');
        div.appendChild(p5);

        // Actions
        const p6 = document.createElement('div');
        p6.className = 'skeleton-pill pill-checkbox col-actions';
        div.appendChild(p6);

        fragment.appendChild(div);
    }
    membersContentEl.appendChild(fragment);
}

function renderNextChunk() {
    if (renderedCount >= displayedMembers.length) return;

    const chunk = displayedMembers.slice(renderedCount, renderedCount + CHUNK_SIZE);
    const fragment = document.createDocumentFragment();
    const selectedSet = selections[currentType] || new Set();

    chunk.forEach((item, index) => {
        // Check if it's a folder or a member
        if (item.isFolder) {
            const row = document.createElement('div');
            row.className = 'member-row folder-row animate-entry'; // Added animation class
            row.style.animationDelay = `${index * 0.03}s`; // Optional stagger
            row.onclick = () => openFolder(item.name);

            const iconCol = document.createElement('div');
            iconCol.className = 'col-icon';
            iconCol.innerHTML = '<i class="fas fa-folder"></i>';

            const nameCol = document.createElement('div');
            nameCol.className = 'col-name';
            nameCol.textContent = item.displayName; // Use displayName for folders

            // Maybe show count? item.count
            const countBadge = document.createElement('span');
            countBadge.className = 'folder-count';
            countBadge.textContent = `(${item.count})`;
            nameCol.appendChild(countBadge);

            row.appendChild(iconCol);
            row.appendChild(nameCol);
            // Empty cols for alignment if needed, or just flex name

            fragment.appendChild(row);
        } else {
            // It's a member
            const m = item;
            const row = document.createElement('div');
            row.className = 'member-row animate-entry'; // Added animation class
            row.style.animationDelay = `${index * 0.03}s`; // Optional stagger
            const isSelected = selectedSet.has(m.fullName);
            if (isSelected) {
                row.classList.add('selected');
            }

            // Checkbox column
            const checkboxCol = document.createElement('div');
            checkboxCol.style.display = 'flex';
            checkboxCol.style.justifyContent = 'center';
            checkboxCol.style.alignItems = 'center';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isSelected;
            checkbox.style.cursor = 'pointer';

            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleSelection(m.fullName, row, checkbox.checked);
            };
            checkboxCol.appendChild(checkbox);

            row.onclick = () => {
                checkbox.checked = !checkbox.checked;
                toggleSelection(m.fullName, row, checkbox.checked);
            };

            const nameCol = document.createElement('div');
            nameCol.className = 'col-name';
            // If inside a folder, show relative name? 
            // ex: Allowance.Address -> Address
            const displayName = currentFolder ? m.fullName.substring(currentFolder.length + 1) : m.fullName;
            nameCol.textContent = displayName;

            const userCol = document.createElement('div');
            userCol.className = 'col-user';
            userCol.textContent = m.lastModifiedByName || 'Unknown';
            if (!document.querySelector('input[data-column="col-user"]').checked) userCol.classList.add('hidden');

            const dateCol = document.createElement('div');
            dateCol.className = 'col-date';
            dateCol.textContent = m.lastModifiedDate ? new Date(m.lastModifiedDate).toLocaleString() : 'N/A';
            if (!document.querySelector('input[data-column="col-date"]').checked) dateCol.classList.add('hidden');

            const createdUserCol = document.createElement('div');
            createdUserCol.className = 'col-created-user';
            createdUserCol.textContent = m.createdByName || 'Unknown';
            if (!document.querySelector('input[data-column="col-created-user"]').checked) createdUserCol.classList.add('hidden');

            const createdDateCol = document.createElement('div');
            createdDateCol.className = 'col-created-date';
            createdDateCol.textContent = m.createdDate ? new Date(m.createdDate).toLocaleString() : 'N/A';
            if (!document.querySelector('input[data-column="col-created-date"]').checked) createdDateCol.classList.add('hidden');

            const actionsCol = document.createElement('div');
            actionsCol.className = 'col-actions';
            const openIcon = document.createElement('i');
            openIcon.className = 'fas fa-external-link-alt action-icon';
            openIcon.title = 'Open in Salesforce Org';
            openIcon.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'openInOrg', id: m.id, type: m.type, fullName: m.fullName });
            };
            actionsCol.appendChild(openIcon);

            // Conflict/Local indicator
            const badge = document.createElement('span');
            const statusMap = {
                'synced': { class: 'status-synced', label: 'Synced (Matches Local)' },
                'new': { class: 'status-new', label: 'New (Server Only)' },
                'changed': { class: 'status-changed', label: 'Modified (Server Newer)' }
            };
            const statusInfo = statusMap[m.status] || statusMap['new'];
            badge.className = `conflict-badge ${statusInfo.class}`;
            badge.title = statusInfo.label;
            nameCol.prepend(badge);

            row.appendChild(checkboxCol);
            row.appendChild(nameCol);
            row.appendChild(userCol);
            row.appendChild(dateCol);
            row.appendChild(createdUserCol);
            row.appendChild(createdDateCol);
            row.appendChild(actionsCol);

            fragment.appendChild(row);
        }
    });

    membersContentEl.appendChild(fragment);
    renderedCount += chunk.length;
}

membersListEl.addEventListener('scroll', () => {
    // Load more when scrolled to bottom (with 50px buffer)
    if (membersListEl.scrollTop + membersListEl.clientHeight >= membersListEl.scrollHeight - 50) {
        renderNextChunk();
    }
});

function toggleSelection(memberName, cardElement, isChecked) {
    if (!currentType) return;

    const set = ensureSelectionSet(currentType);
    if (!isChecked) {
        set.delete(memberName);
        cardElement.classList.remove('selected');
    } else {
        set.add(memberName);
        cardElement.classList.add('selected');
    }

    saveState();

    // UI Update -> Update badges
    const term = typeSearchInput.value.toLowerCase();
    const filtered = allMetadataTypes.filter(t => t.toLowerCase().includes(term));
    renderMetadataTypes(filtered);

    // Update header checkbox
    updateSelectAllCheckbox(); updateBadgeCount();
}

// Select All Logic
const selectAllCheckbox = document.getElementById('select-all-checkbox');

if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        if (!currentType) return;

        const set = ensureSelectionSet(currentType);

        // Only affect currently displayed/filtered items? Or all items?
        // Ideally all *filtered* items if filter is active, or all items in list.
        // For simplicity, let's target displayedMembers (which respects filters).

        displayedMembers.forEach(m => {
            // Only toggle selection for actual members, not folders
            if (!m.isFolder) {
                if (isChecked) {
                    set.add(m.fullName);
                } else {
                    set.delete(m.fullName);
                }
            }
        });

        saveState();
        renderMetadataTypes(allMetadataTypes); // update badges
        updateBadgeCount(); renderMembers(displayedMembers); updateBadgeCount(); // re-render rows to update visual state
    });
}

function updateSelectAllCheckbox() {
    if (!selectAllCheckbox || !currentType || displayedMembers.length === 0) {
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        return;
    }

    const set = ensureSelectionSet(currentType);
    const actualMembers = displayedMembers.filter(m => !m.isFolder); // Only consider actual members

    if (actualMembers.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    const allSelected = actualMembers.every(m => set.has(m.fullName));
    const someSelected = actualMembers.some(m => set.has(m.fullName));

    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = someSelected && !allSelected;
}

// Folder Navigation Logic
function openFolder(folderName) {
    currentFolder = folderName;
    scheduleApplyFilters();
}

function closeFolder() {
    currentFolder = null;
    scheduleApplyFilters();
}

function updateBreadcrumb() {
    // Find or create breadcrumb container. 
    // Ideally put it in header-info or a new bar. 
    // Let's assume we injected a #breadcrumb-container in HTML or created it here.

    let container = document.getElementById('breadcrumb-container');
    if (!container) {
        // Create if missing (inserted after header-info title usually)
        const headerInfo = document.querySelector('.header-info');
        if (headerInfo) {
            container = document.createElement('div');
            container.id = 'breadcrumb-container';
            container.className = 'breadcrumb-container';
            headerInfo.appendChild(container); // Append to header-info
        }
    }

    if (!container) return;

    container.innerHTML = '';

    if (currentFolder) {
        // Back Button
        const backBtn = document.createElement('button');
        backBtn.className = 'back-btn';
        backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back';
        backBtn.onclick = closeFolder;
        container.appendChild(backBtn);

        // Current Folder Label
        const label = document.createElement('span');
        label.className = 'breadcrumb-label';
        label.textContent = ` / ${currentFolder}`;
        container.appendChild(label);

        // Hide Main Title? Or just show alongside regarding hierarchy
        // Maybe hide "None" or Type Name if redundant?
        // Let's keep Type Name visible, breadcrumb is sub-nav.
    }
}

// Lock State
let isFilterLocked = false;

if (lockBtn) {
    lockBtn.addEventListener('click', () => {
        isFilterLocked = !isFilterLocked;
        if (isFilterLocked) {
            lockBtn.classList.add('active');
            lockIcon.className = 'fas fa-lock';
            lockBtn.title = "Unlock Filters";
        } else {
            lockBtn.classList.remove('active');
            lockIcon.className = 'fas fa-unlock';
            lockBtn.title = "Lock Filters";
        }
    });
}

function populateUserFilter(members) {
    const users = new Set(members.map(m => m.lastModifiedByName).filter(Boolean));
    allUserOptions = Array.from(users).sort((a, b) => a.localeCompare(b));

    if (isFilterLocked && userFilterValue) {
        const optionExists = allUserOptions.includes(userFilterValue);
        if (!optionExists) {
            // Keep locked selection, but it may not exist in current member set
            // (e.g., switching types). We'll show it anyway.
            allUserOptions = [userFilterValue].concat(allUserOptions);
        }
    } else if (!isFilterLocked) {
        userFilterValue = '';
    }

    const els = getUserFilterEls();
    if (els && els.valueEl) {
        els.valueEl.textContent = userFilterValue ? userFilterValue : 'All Users';
    }
    renderUserFilterOptions();

    if (!isFilterLocked) {
        dateFilterStart.value = "";
        dateFilterEnd.value = "";
    }
}

// --- Filtering Logic ---

let applyFiltersTimer = null;
function scheduleApplyFilters() {
    if (applyFiltersTimer) clearTimeout(applyFiltersTimer);
    // Debounce to avoid re-sorting/re-grouping on every keystroke on slow systems
    applyFiltersTimer = setTimeout(() => {
        applyFiltersTimer = null;
        applyFilters();
    }, 120);
}

function applyFilters() {
    const term = memberSearchInput.value.toLowerCase().trim();
    const user = userFilterValue;
    const dateValStart = dateFilterStart.value;
    const dateValEnd = dateFilterEnd.value;

    // First, determine what items to work with based on folder context
    // If we're in a folder, start with items in that folder
    // If we're at root, start with all members

    const prefix = currentFolder ? currentFolder + '.' : '';
    let baseMembers = allMembers;

    // Filter by folder context first (if applicable)
    if (currentFolder) {
        baseMembers = allMembers.filter(m => m.fullName.startsWith(prefix));
    }

    // Apply user and date filters
    let filtered = baseMembers.filter(m => {
        const matchesUser = !user || m.lastModifiedByName === user;

        let matchesDate = true;
        if (m.lastModifiedDate) {
            const modDate = new Date(m.lastModifiedDate);
            modDate.setHours(0, 0, 0, 0); // Normalize to start of day

            if (dateValStart) {
                const start = new Date(dateValStart);
                start.setHours(0, 0, 0, 0);
                if (modDate < start) matchesDate = false;
            }
            if (dateValEnd) {
                const end = new Date(dateValEnd);
                end.setHours(0, 0, 0, 0);
                if (modDate > end) matchesDate = false;
            }
        } else if (dateValStart || dateValEnd) {
            matchesDate = false;
        }

        return matchesUser && matchesDate;
    });

    // Sort logic
    filtered = sortMembers(filtered);

    // Grouping Logic (optimized)
    // Previous code did O(n^2) counting via filtered.filter(...) for each folder.
    const items = [];
    const folderCounts = new Map(); // fullFolderName -> count
    const folderDisplay = new Map(); // fullFolderName -> displayName
    const folderOrder = [];

    for (const m of filtered) {
        const relativeName = m.fullName.substring(prefix.length);
        const firstDotIndex = relativeName.indexOf('.');

        if (firstDotIndex !== -1) {
            const folderName = relativeName.substring(0, firstDotIndex);
            const fullFolderName = prefix + folderName;

            if (!folderCounts.has(fullFolderName)) {
                folderCounts.set(fullFolderName, 0);
                folderDisplay.set(fullFolderName, folderName);
                folderOrder.push(fullFolderName);
            }
            folderCounts.set(fullFolderName, folderCounts.get(fullFolderName) + 1);
        } else {
            items.push(m);
        }
    }

    for (const fullFolderName of folderOrder) {
        items.push({
            isFolder: true,
            name: fullFolderName,
            displayName: folderDisplay.get(fullFolderName),
            count: folderCounts.get(fullFolderName)
        });
    }

    // Sort items - folders first
    items.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;

        const nameA = a.isFolder ? a.displayName : a.fullName;
        const nameB = b.isFolder ? b.displayName : b.fullName;
        return nameA.localeCompare(nameB);
    });

    // NOW apply search term to the current view items only
    let displayItems = items;
    if (term) {
        displayItems = items.filter(item => {
            if (item.isFolder) {
                // Search folder names only
                return item.displayName.toLowerCase().includes(term);
            } else {
                // Search member names
                return item.fullName.toLowerCase().includes(term);
            }
        });
    }

    renderMembers(displayItems);
    updateSortIcons();
}

function sortMembers(members) {
    const field = currentSort.field;
    const dir = currentSort.direction === 'asc' ? 1 : -1;

    return [...members].sort((a, b) => {
        let valA, valB;

        if (field === 'name') {
            valA = a.fullName.toLowerCase();
            valB = b.fullName.toLowerCase();
        } else if (field === 'user') {
            valA = (a.lastModifiedByName || '').toLowerCase();
            valB = (b.lastModifiedByName || '').toLowerCase();
        } else if (field === 'date') {
            const dateA = new Date(a.lastModifiedDate || 0);
            const dateB = new Date(b.lastModifiedDate || 0);
            valA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
            valB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
        }

        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
}

// Sort Headers
document.querySelectorAll('.member-list-header > div[data-sort]').forEach(el => {
    el.addEventListener('click', () => {
        const field = el.dataset.sort;
        if (currentSort.field === field) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.field = field;
            currentSort.direction = 'asc';
        }
        applyFilters();
    });
});

function updateSortIcons() {
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.className = 'fas fa-sort sort-icon'; // Reset
    });

    const activeHeader = document.querySelector(`.member-list-header > div[data-sort="${currentSort.field}"]`);
    if (activeHeader) {
        const icon = activeHeader.querySelector('.sort-icon');
        if (icon) {
            icon.className = `fas fa-sort-${currentSort.direction === 'asc' ? 'up' : 'down'} sort-icon active`;
        }
    }
}

memberSearchInput.addEventListener('input', scheduleApplyFilters);
dateFilterStart.addEventListener('change', () => {
    
    scheduleApplyFilters();
});
dateFilterEnd.addEventListener('change', () => {
    
    scheduleApplyFilters();
});
// No sync needed for native input

selectFilteredBtn.addEventListener('click', () => {
    if (!currentType) return;
    const set = ensureSelectionSet(currentType); // always creates Set if missing
    displayedMembers.forEach(m => {
        if (!m.isFolder) {
            set.add(m.fullName);
        }
    });
    saveState();
    renderMetadataTypes(allMetadataTypes);
    renderMembers(displayedMembers);
    updateBadgeCount();
    updateSelectAllCheckbox();
});

wildcardCheckbox.addEventListener('change', (e) => {
    if (!currentType) return;
    wildcards[currentType] = e.target.checked;
    updateWildcardConflictNotice();
    saveState();
    if (typeof autoUpdateCheckbox !== 'undefined' && autoUpdateCheckbox && autoUpdateCheckbox.checked) {
        triggerBulkUpdate(true);
    }
});

// --- Actions ---

function getSelections() {
    const typesToUpdate = [];
    const allKnownTypes = new Set([...Object.keys(selections), ...Object.keys(wildcards)]);
    
    for (const type of allKnownTypes) {
        if (wildcards[type]) {
            typesToUpdate.push({ name: type, members: ['*'] });
        } else if (selections[type] && selections[type].size > 0) {
            typesToUpdate.push({ name: type, members: Array.from(selections[type]) });
        }
    }
    return typesToUpdate;
}

function handleUpdate() {
    const types = getSelections();
    if (types.length > 0) {
        vscode.postMessage({ command: 'updateManifestBulk', types: types });
    } else {
        vscode.postMessage({ command: 'alert', text: 'No items selected to update.' });
    }
}

function handleCopy() {
    const types = getSelections();
    if (types.length === 0) {
        vscode.postMessage({ command: 'alert', text: 'No items selected to copy.' });
        return;
    }

    // Generate XML locally
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
    types.forEach(t => {
        xml += '    <types>\n';
        t.members.forEach(m => xml += `        <members>${m}</members>\n`);
        xml += `        <name>${t.name}</name>\n    </types>\n`;
    });
    xml += '    <version>60.0</version>\n</Package>';

    // Copy to clipboard
    navigator.clipboard.writeText(xml).then(() => {
        vscode.postMessage({ command: 'alert', text: 'Metadata copied to clipboard!' });
    }, (err) => {
        vscode.postMessage({ command: 'alert', text: 'Failed to copy: ' + err });
    });
}

function handleClearAll() {
    selections = {};
    wildcards = {};
    dateFilterStart.value = "";
    dateFilterEnd.value = "";
    
    saveState();
    
    // Update Sidebar Badges
    const term = typeSearchInput.value.toLowerCase();
    const filtered = allMetadataTypes.filter(t => t.toLowerCase().includes(term));
    renderMetadataTypes(filtered);
    
    // Update Members List
    if (currentType) {
        applyFilters(); 
    }

    updateBadgeCount();
}

// Removed in favor of dynamic onclick logic at end of file
// updateBtn.addEventListener('click', handleUpdate);
copyBtn.addEventListener('click', handleCopy);
clearAllBtn.addEventListener('click', handleClearAll);
const downloadBtn = document.getElementById('download-btn');
if (downloadBtn) {
    downloadBtn.addEventListener('click', handleDownload);
}

function handleDownload() {
    const types = getSelections();
    if (types.length === 0) {
        vscode.postMessage({ command: 'alert', text: 'No items selected to download.' });
        return;
    }

    // Generate XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
    types.forEach(t => {
        xml += '    <types>\n';
        t.members.forEach(m => xml += `        <members>${m}</members>\n`);
        xml += `        <name>${t.name}</name>\n    </types>\n`;
    });
    xml += '    <version>60.0</version>\n</Package>';

    // Trigger Download
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'package.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function openNativeDatePicker(input) {
    if (!input) return;
    try {
        if (typeof input.showPicker === 'function') {
            input.showPicker();
            return;
        }
    } catch (e) {
        // Some webview/OS combos may throw if picker isn't available.
    }
    input.focus();
    input.click();
}

function initDatePickerPopups() {
    [dateFilterStart, dateFilterEnd].forEach(input => {
        if (!input) return;
        const pill = input.closest('.date-pill');
        if (!pill) return;

        // Clicking the pill/calendar icon should open the native date picker.
        pill.addEventListener('mousedown', (e) => {
            if (e.target === input) return;
            e.preventDefault();
            openNativeDatePicker(input);
        });

        // Keyboard accessibility for date fields.
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                openNativeDatePicker(input);
            }
        });
    });
}

// --- Tutorial Logic ---
// --- Comprehensive Guided Tour Logic ---

const tourSteps = [
    {
        target: '.sidebar',
        title: '📂 Metadata Sidebar',
        text: 'Browse all Salesforce metadata types here. The badges show your current selection count for each type.',
        pos: 'right'
    },
    {
        target: '.filter-bar',
        title: '🔍 Search & Filters',
        text: 'Quickly find members by name, filter by modified user, or specify a date range to see recent changes.',
        pos: 'bottom'
    },
    {
        target: '#lock-btn',
        title: '🔒 Filter Lock',
        text: 'Keep your search and date filters active even when you switch to a different metadata type.',
        pos: 'bottom'
    },
    {
        target: '.header-row .col-check input',
        title: '🔘 Select All',
        text: 'Check this to select or unselect every item currently visible in the list.',
        pos: 'bottom'
    },
    {
        target: '#select-filtered-btn',
        title: '⚡ Select Filtered',
        text: 'Instantly select ONLY the items that match your current filters. Great for bulk-selecting today\'s changes.',
        pos: 'bottom'
    },
    {
        target: '#wildcard-checkbox',
        title: '🃏 Wildcard (*)',
        text: 'Enable this to include ALL members of this type in your manifest using the * symbol.',
        pos: 'bottom'
    },
    {
        target: '.conflict-badge',
        title: '🔴 Conflict Indicators',
        text: '🟢 Synced: Matches local file.\n🟠 New: Server only.\n🔴 Modified: Server is newer than local (Conflict!).',
        pos: 'right'
    },
    {
        target: '#update-btn',
        title: '💾 Save package.xml',
        text: 'Write your selections directly to the project\'s manifest folder.',
        pos: 'left'
    },
    {
        target: '#copy-btn',
        title: '📋 Copy to Clipboard',
        text: 'Copy the generated XML content to your clipboard for quick pasting.',
        pos: 'left'
    },
    {
        target: '#clear-all-btn',
        title: '🧹 Unselect All',
        text: 'Reset all selections across all metadata types and start fresh.',
        pos: 'left'
    },
    {
        target: '#help-btn',
        title: '❓ Need Help?',
        text: 'Click this icon anytime to restart this tour and learn about the features.',
        pos: 'left'
    }
];

let tourIndex = 0;

function startTour() {
    const tour = document.getElementById('tutorial-tour');
    if (!tour) return;
    tourIndex = 0;
    tour.classList.remove('hidden');
    renderTourStep();
}

function renderTourStep() {
    const step = tourSteps[tourIndex];
    let targetEl = document.querySelector(step.target);
    const tooltip = document.getElementById('tour-tooltip');
    const spotlight = document.getElementById('tour-spotlight');
    const tourTitle = document.getElementById('tour-title');
    const tourText = document.getElementById('tour-text');
    const tourDots = document.getElementById('tour-dots');
    const tourPrev = document.getElementById('tour-prev');
    const tourNext = document.getElementById('tour-next');

    if (!tooltip || !spotlight || !tourTitle || !tourText || !tourDots || !tourPrev || !tourNext) {
        closeTour();
        return;
    }

    if (!targetEl) {
        // Fallback for dynamic elements
        if (tourIndex < tourSteps.length - 1) {
            tourIndex++;
            renderTourStep();
        } else {
            closeTour();
        }
        return;
    }

    const rect = targetEl.getBoundingClientRect();
    
    // Spotlight
    spotlight.style.top = (rect.top - 5) + 'px';
    spotlight.style.left = (rect.left - 5) + 'px';
    spotlight.style.width = (rect.width + 10) + 'px';
    spotlight.style.height = (rect.height + 10) + 'px';

    // Tooltip Content
    tourTitle.textContent = step.title;
    tourText.innerHTML = step.text.replace(/\n/g, '<br>');
    
    // Dots
    tourDots.innerHTML = tourSteps.map((_, i) => `<div class="tour-dot ${i === tourIndex ? 'active' : ''}"></div>`).join('');

    // Positioning
    tooltip.className = 'tour-tooltip ' + step.pos;
    
    // Basic positioning logic
    if (step.pos === 'right') {
        tooltip.style.top = rect.top + 'px';
        tooltip.style.left = (rect.right + 25) + 'px';
    } else if (step.pos === 'bottom') {
        tooltip.style.top = (rect.bottom + 25) + 'px';
        tooltip.style.left = rect.left + 'px';
    } else if (step.pos === 'left') {
        tooltip.style.top = rect.top + 'px';
        tooltip.style.left = (rect.left - 345) + 'px';
    } else if (step.pos === 'top') {
        tooltip.style.top = (rect.top - tooltip.offsetHeight - 25) + 'px';
        tooltip.style.left = rect.left + 'px';
    }

    tourPrev.style.visibility = tourIndex === 0 ? 'hidden' : 'visible';
    tourNext.textContent = tourIndex === tourSteps.length - 1 ? 'Finish' : 'Next';
}

function closeTour() {
    const tour = document.getElementById('tutorial-tour');
    if (tour) {
        tour.classList.add('hidden');
    }
    safeStorageSet('tour-completed', 'true');
}

if (helpBtn) {
    helpBtn.onclick = startTour;
}

const tourNextBtn = document.getElementById('tour-next');
if (tourNextBtn) {
    tourNextBtn.onclick = () => {
        if (tourIndex < tourSteps.length - 1) {
            tourIndex++;
            renderTourStep();
        } else {
            closeTour();
        }
    };
}

const tourPrevBtn = document.getElementById('tour-prev');
if (tourPrevBtn) {
    tourPrevBtn.onclick = () => {
        if (tourIndex > 0) {
            tourIndex--;
            renderTourStep();
        }
    };
}

const tourCloseBtn = document.getElementById('tour-close');
if (tourCloseBtn) {
    tourCloseBtn.onclick = closeTour;
}

// Auto-start for new users
if (!safeStorageGet('tour-completed')) {
    setTimeout(startTour, 2000);
}

initDatePickerPopups();


// --- Column Settings Logic ---
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const columnCheckboxes = document.querySelectorAll('.settings-list input[type="checkbox"]');

function updateColumnVisibility() {
    let gridTemplate = '40px minmax(250px, 1.5fr)'; // Base: Checkbox + Name
    
    columnCheckboxes.forEach(cb => {
        const colClass = cb.dataset.column;
        const elements = document.querySelectorAll('.' + colClass);
        if (cb.checked) {
            elements.forEach(el => el.classList.remove('hidden'));
            if (colClass.includes('date')) gridTemplate += ' 170px';
            else gridTemplate += ' 140px';
        } else {
            elements.forEach(el => el.classList.add('hidden'));
        }
    });
    
    gridTemplate += ' 60px'; // Org Action
    document.documentElement.style.setProperty('--grid-columns', gridTemplate);
}

if (settingsBtn) {
    settingsBtn.onclick = () => settingsModal.classList.remove('hidden');
}
if (closeSettingsBtn) {
    closeSettingsBtn.onclick = () => settingsModal.classList.add('hidden');
}

columnCheckboxes.forEach(cb => {
    cb.onchange = () => updateColumnVisibility();
});

// --- Manifest Preview Logic ---
const previewSheet = document.getElementById('manifest-preview');
const previewCode = document.getElementById('preview-code');

const triggerPreview = () => {
    if (!previewCode || !previewSheet) {
        vscode.postMessage({ command: 'alert', text: 'Manifest preview is not available in this build.' });
        return;
    }
    const types = [];
    Object.keys(selections).forEach(type => {
        const members = Array.from(selections[type]);
        if (members.length > 0) {
            types.push({ name: type, members });
        }
    });

    if (types.length === 0) {
        vscode.postMessage({ command: 'alert', text: 'Please select at least one item first.' });
        return;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
    types.forEach(t => {
        xml += '    <types>\n';
        t.members.forEach(m => xml += `        <members>${m}</members>\n`);
        xml += `        <name>${t.name}</name>\n    </types>\n`;
    });
    xml += '    <version>60.0</version>\n</Package>';
    
    previewCode.textContent = xml;
    previewSheet.classList.add('open');
};

const closePreviewBtn = document.getElementById('close-preview-btn');
if (closePreviewBtn) {
    closePreviewBtn.onclick = () => {
        if (previewSheet) {
            previewSheet.classList.remove('open');
        }
    };
}

const copyPreviewBtn = document.getElementById('copy-preview-btn');
if (copyPreviewBtn) {
    copyPreviewBtn.onclick = () => {
        if (!previewCode) return;
        navigator.clipboard.writeText(previewCode.textContent);
        webviewLog('Manifest copied to clipboard');
    };
}

// --- CSV Export Logic ---
const triggerCSVExport = () => {
    if (!currentMembers || currentMembers.length === 0) return;
    
    let csv = 'Name,Modified By,Modified Date,Created By,Created Date,Status\n';
    currentMembers.forEach(m => {
        csv += [`"${m.fullName}"`, `"${m.lastModifiedByName || ''}"`, `"${m.lastModifiedDate || ''}"`, `"${m.createdByName || ''}"`, `"${m.createdDate || ''}"`, `"${m.status || ''}"`].join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.getElementById('csv-link');
    if (!link) {
        URL.revokeObjectURL(url);
        vscode.postMessage({ command: 'alert', text: 'CSV export link is missing in this build.' });
        return;
    }
    link.href = url;
    link.download = `metadata_${currentType || 'export'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
};

// Initial visibility sync
updateColumnVisibility();

// Update renderNextChunk to respect visibility
const originalRenderNextChunk = renderNextChunk;
renderNextChunk = function() {
    originalRenderNextChunk();
    updateColumnVisibility();
};



// --- Sidebar Resizer ---
const resizer = document.getElementById('resizer');
const sidebar = document.querySelector('.sidebar');
let isResizing = false;

/**
 * Compute the minimum sidebar width so it never collapses past its content.
 * Uses the widest visible list-item text (icon 16px + margin 10px + text + 15px padding × 2 + 5px safety).
 */
function getSidebarMinWidth() {
    const BASE_PADDING = 15 * 2;   // left + right padding of .list-item
    const ICON_W = 16 + 10;        // icon width + margin-right
    const SAFETY = 5;              // extra breathing room

    let maxTextW = 0;
    typeListEl.querySelectorAll('.list-item span').forEach(span => {
        // scrollWidth gives the full unwrapped text width
        maxTextW = Math.max(maxTextW, span.scrollWidth);
    });

    // Fallback: if no items rendered yet, use a sensible default
    if (maxTextW === 0) return 150;

    return BASE_PADDING + ICON_W + maxTextW + SAFETY;
}

if (resizer && sidebar) {
    // Show wider hit-target while hovered but before drag
    resizer.addEventListener('mouseenter', () => {
        if (!isResizing) resizer.classList.add('hovered');
    });
    resizer.addEventListener('mouseleave', () => {
        if (!isResizing) resizer.classList.remove('hovered');
    });

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        resizer.classList.remove('hovered');
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
    });

    function handleMouseMove(e) {
        if (!isResizing) return;
        const newWidth = e.clientX;
        const minW = getSidebarMinWidth();
        const maxW = Math.floor(window.innerWidth * 0.5); // max 50% of viewport
        if (newWidth >= minW && newWidth <= maxW) {
            sidebar.style.width = `${newWidth}px`;
            sidebar.style.minWidth = `${newWidth}px`;
            sidebar.style.maxWidth = `${newWidth}px`;
        } else if (newWidth < minW) {
            // Snap to minimum
            sidebar.style.width = `${minW}px`;
            sidebar.style.minWidth = `${minW}px`;
            sidebar.style.maxWidth = `${minW}px`;
        }
    }

    function stopResizing() {
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
    }
}

// --- Selection Badge ---
const selectionBadge = document.getElementById('selection-badge');

function updateBadgeCount() {
    let total = 0;
    Object.values(selections).forEach(set => total += set.size);
    
    if (selectionBadge) {
        if (total > 0) {
            selectionBadge.textContent = total > 99 ? '99+' : String(total);
            selectionBadge.title = `${total} selected`;
            selectionBadge.classList.remove('hidden');
        } else {
            selectionBadge.classList.add('hidden');
            selectionBadge.title = '';
        }
    }
    updateWildcardConflictNotice();
    return total;
}

// Update toggleSelection to include badge
const originalToggleSelection = toggleSelection;
toggleSelection = function(memberName, cardElement, isChecked) {
    originalToggleSelection(memberName, cardElement, isChecked);
    updateBadgeCount();
};

if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
        updateBadgeCount();
    });
}

// --- Manifest Update Logic ---
function triggerBulkUpdate() {
    try {
        const types = getSelections();

        if (types.length > 0) {
            vscode.postMessage({ command: 'updateManifestBulk', types: types, silent: false });
        } else {
            vscode.postMessage({ command: 'alert', text: 'No items selected. Please select metadata items or enable Wildcard.' });
        }
    } catch (err) {
        vscode.postMessage({ command: 'alert', text: 'Error preparing manifest update: ' + err.message });
        console.error(err);
    }
}

if (updateBtn) {
    updateBtn.onclick = () => {
        triggerBulkUpdate();
    };
}

// --- Retrieve Button ---
const retrieveBtn = document.getElementById('retrieve-btn');
if (retrieveBtn) {
    retrieveBtn.addEventListener('click', () => {
        const types = getSelections();
        if (types.length === 0) {
            vscode.postMessage({ command: 'alert', text: 'No items selected. Please select metadata items before retrieving.' });
            return;
        }

        // Lock button and show phase 1: Saving manifest
        retrieveBtn.classList.add('loading');
        const icon = retrieveBtn.querySelector('i');
        const label = retrieveBtn.querySelector('span');
        const origIcon = icon ? icon.className : 'fas fa-cloud-download-alt';
        if (icon) icon.className = 'fas fa-spinner fa-spin';
        if (label) label.textContent = 'Saving…';

        // Phase 2 label after short delay (manifest write is fast)
        setTimeout(() => {
            if (label) label.textContent = 'Retrieving…';
        }, 800);

        // Send combined command: update manifest silently then retrieve
        vscode.postMessage({ command: 'retrieveWithUpdate', types });

        // Restore button after terminal has had time to open
        setTimeout(() => {
            retrieveBtn.classList.remove('loading');
            if (icon) icon.className = origIcon;
            if (label) label.textContent = 'Retrieve';
        }, 3500);
    });
}


// Initial count
updateBadgeCount();

// --- Finalization ---
console.log("SF Metadata Exporter: main.js completed successfully.");
window.__sfmeStarted = true;

// Support Banner Logic
const supportBanner = document.getElementById('support-banner');
const closeSupportBtn = document.getElementById('close-support-banner');

function hideSupportBanner() {
    if (supportBanner && supportBanner.classList.contains('visible')) {
        closeSupportBtn.click();
    }
}

if (supportBanner && closeSupportBtn) {
    // FORCE SHOW ON LAUNCH FOR TROUBLESHOOTING
    setTimeout(() => {
        if (supportBanner) {
            console.log("SF Metadata Exporter: Forcing support banner visibility");
            supportBanner.classList.add('visible');
            document.body.classList.add('support-banner-visible');
        }
    }, 2000);

    closeSupportBtn.addEventListener('click', () => {
        const supportLinks = supportBanner.querySelector('.support-links');
        const footerLinks = document.querySelector('.footer-buttons');
        
        if (supportLinks && footerLinks && supportBanner.classList.contains('visible')) {
            const startRect = supportLinks.getBoundingClientRect();
            const endRect = footerLinks.getBoundingClientRect();
            
            // Create a clone for animation
            const clone = supportLinks.cloneNode(true);
            clone.className = 'support-links-clone'; // Add class for easy cleanup
            clone.style.position = 'fixed';
            clone.style.top = startRect.top + 'px';
            clone.style.left = startRect.left + 'px';
            clone.style.width = startRect.width + 'px';
            clone.style.zIndex = '3000';
            clone.style.transition = 'all 0.8s cubic-bezier(0.19, 1, 0.22, 1)';
            clone.style.pointerEvents = 'none';
            document.body.appendChild(clone);
            
            // Remove visible class immediately
            supportBanner.classList.remove('visible');
            document.body.classList.remove('support-banner-visible');
            
            // Start animation
            requestAnimationFrame(() => {
                clone.style.top = (endRect.top - 2) + 'px'; 
                clone.style.left = endRect.left + 'px';
                clone.style.opacity = '0.5';
                clone.style.transform = 'scale(0.75)';
                clone.style.filter = 'grayscale(0.5) brightness(1.2)';
            });
            
            setTimeout(() => {
                if (clone.parentNode) {
                    document.body.removeChild(clone);
                }
                // Cleanup any other orphans just in case
                document.querySelectorAll('.support-links-clone').forEach(el => el.remove());
                
                const currentState = vscode.getState() || {};
                vscode.setState({ ...currentState, supportBannerDismissed_v2: true });
            }, 850);
        } else {
            supportBanner.classList.remove('visible');
            document.body.classList.remove('support-banner-visible');
            const currentState = vscode.getState() || {};
            vscode.setState({ ...currentState, supportBannerDismissed_v2: true });
        }
    });
}
