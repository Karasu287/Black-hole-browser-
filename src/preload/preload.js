const { contextBridge, ipcRenderer } = require('electron');

let windowId = 1;
try {
  windowId = ipcRenderer.sendSync('window-get-id-sync');
} catch (e) {}

contextBridge.exposeInMainWorld('electronAPI', {
  windowId,
  getWindowId: () => windowId,
  startTabDrag: (data) => ipcRenderer.invoke('tabs-start-drag', data),
  endTabDrag: () => ipcRenderer.invoke('tabs-end-drag'),
  transferTabBetweenWindows: (options) => ipcRenderer.invoke('tabs-transfer-between-windows', options),

  // Window controls
  focusWindow: () => ipcRenderer.invoke('window-focus'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  openNewWindow: (url) => ipcRenderer.invoke('open-new-window', url),
  openIncognitoWindow: (url) => ipcRenderer.invoke('open-incognito-window', url),
  isIncognitoWindow: () => ipcRenderer.invoke('is-incognito-window'),

  // Tab controls
  createTab: (options) => ipcRenderer.invoke('tabs-create', options),
  switchTab: (id) => ipcRenderer.invoke('tabs-switch', id),
  closeTab: (id) => ipcRenderer.invoke('tabs-close', id),
  restoreLastClosedTab: () => ipcRenderer.invoke('tabs-restore-last-closed'),
  toggleMute: (id) => ipcRenderer.invoke('tabs-toggle-mute', id),
  togglePictureInPicture: (id) => ipcRenderer.invoke('tabs-toggle-pip', id),
  togglePin: (id) => ipcRenderer.invoke('tabs-toggle-pin', id),
  duplicateTab: (id) => ipcRenderer.invoke('tabs-duplicate', id),
  moveTabToNewWindow: (id, options) => ipcRenderer.invoke('tabs-move-to-new-window', id, options),
  openTabInNewWindow: (id) => ipcRenderer.invoke('tabs-open-in-new-window', id),
  closeTabsToRight: (id) => ipcRenderer.invoke('tabs-close-right', id),
  closeTabsToLeft: (id) => ipcRenderer.invoke('tabs-close-left', id),
  closeOtherTabs: (id) => ipcRenderer.invoke('tabs-close-others', id),
  hibernateTab: (id) => ipcRenderer.invoke('tabs-hibernate', id),
  showTabContextMenu: (id, coords) => ipcRenderer.invoke('tabs-show-context-menu', id, coords),
  createTabGroup: (options) => ipcRenderer.invoke('tabs-create-group', options),
  updateTabGroup: (groupId, updates) => ipcRenderer.invoke('tabs-update-group', groupId, updates),
  toggleGroupCollapse: (groupId) => ipcRenderer.invoke('tabs-toggle-group-collapse', groupId),
  addTabToGroup: (tabId, groupId) => ipcRenderer.invoke('tabs-add-to-group', tabId, groupId),
  removeTabFromGroup: (tabId) => ipcRenderer.invoke('tabs-remove-from-group', tabId),
  ungroupTabs: (groupId) => ipcRenderer.invoke('tabs-ungroup', groupId),
  closeTabGroup: (groupId) => ipcRenderer.invoke('tabs-close-group', groupId),
  showGroupContextMenu: (groupId, coords) => ipcRenderer.invoke('tabs-show-group-context-menu', groupId, coords),
  reorderTabs: (orderedTabs) => ipcRenderer.invoke('tabs-reorder', orderedTabs),
  moveTab: (tabId, direction) => ipcRenderer.invoke('tabs-move', tabId, direction),
  moveGroup: (groupId, direction) => ipcRenderer.invoke('tabs-move-group', groupId, direction),
  getAllTabs: () => ipcRenderer.invoke('tabs-get-all'),

  // Navigation
  navigate: (url) => ipcRenderer.invoke('nav-navigate', url),
  goBack: () => ipcRenderer.invoke('nav-back'),
  goForward: () => ipcRenderer.invoke('nav-forward'),
  reload: (ignoreCache) => ipcRenderer.invoke('nav-reload', ignoreCache),
  stop: () => ipcRenderer.invoke('nav-stop'),
  setTopBarHeight: (height) => ipcRenderer.invoke('nav-set-top-bar-height', height),
  findInPage: (text, forward, findNext) => ipcRenderer.invoke('nav-find-in-page', text, forward, findNext),
  stopFind: (action) => ipcRenderer.invoke('nav-stop-find', action),

  // Extensions
  getExtensions: () => ipcRenderer.invoke('extensions-get-all'),
  toggleExtension: (id, enabled) => ipcRenderer.invoke('extensions-toggle', id, enabled),
  removeExtension: (id) => ipcRenderer.invoke('extensions-remove', id),
  openExtensionPopup: (id, bounds) => ipcRenderer.invoke('extensions-open-popup', id, bounds),
  openExtensionOptions: (id) => ipcRenderer.invoke('extensions-open-options', id),
  toggleExtensionPin: (id, isPinned) => ipcRenderer.invoke('extensions-toggle-pin', id, isPinned),
  showExtensionContextMenu: (id, coords) => ipcRenderer.invoke('extensions-show-context-menu', id, coords),
  installExtensionFileDialog: () => ipcRenderer.invoke('extensions-install-file-dialog'),
  installExtensionDirDialog: () => ipcRenderer.invoke('extensions-install-dir-dialog'),
  installExtensionFromPath: (filePath) => ipcRenderer.invoke('extensions-install-from-path', filePath),
  installExtensionFromWebStore: (idOrUrl) => ipcRenderer.invoke('extensions-install-from-webstore', idOrUrl),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks-get'),
  addBookmark: (bookmark) => ipcRenderer.invoke('bookmarks-add', bookmark),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks-remove', id),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks-check', url),

  // History
  getHistory: (limit) => ipcRenderer.invoke('history-get', limit),
  clearHistory: () => ipcRenderer.invoke('history-clear'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings-get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings-update', settings),
  clearCache: () => ipcRenderer.invoke('settings-clear-cache'),
  checkIsDefaultBrowser: () => ipcRenderer.invoke('check-is-default-browser'),
  setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser'),

  // Performance stats
  getPerformanceStats: () => ipcRenderer.invoke('performance-get-stats'),

  // Modal state
  setModalState: (isOpen) => ipcRenderer.invoke('modal-state-changed', isOpen),

  // Open External URL
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Passwords
  getPasswords: () => ipcRenderer.invoke('passwords-get'),
  savePassword: (cred) => ipcRenderer.invoke('passwords-save', cred),
  deletePassword: (id) => ipcRenderer.invoke('passwords-delete', id),
  getPasswordsForOrigin: (origin) => ipcRenderer.invoke('passwords-get-for-origin', origin),
  importPasswordsFileDialog: () => ipcRenderer.invoke('passwords-import-file-dialog'),
  parsePasswordsContent: (content) => ipcRenderer.invoke('passwords-parse-content', content),
  batchImportPasswords: (items, options) => ipcRenderer.invoke('passwords-batch-import', items, options),
  exportPasswordsFileDialog: () => ipcRenderer.invoke('passwords-export-file-dialog'),

  // AdBlocker / Shield
  getAdBlockStatus: (domain, tabId) => ipcRenderer.invoke('adblock-get-status', domain, tabId),
  toggleAdBlock: (enable) => ipcRenderer.invoke('adblock-toggle', enable),
  toggleAdBlockWhitelist: (domain) => ipcRenderer.invoke('adblock-toggle-whitelist', domain),
  getAdBlockWhitelist: () => ipcRenderer.invoke('adblock-get-whitelist'),
  resetAdBlockStats: () => ipcRenderer.invoke('adblock-reset-stats'),
  getAdBlockStats: () => ipcRenderer.invoke('adblock-get-stats'),

  // ⚡ YouTube DPI Bypass
  getDpiBypassStatus: () => ipcRenderer.invoke('dpi-get-status'),
  toggleDpiBypass: (enable) => ipcRenderer.invoke('dpi-toggle', enable),
  onDpiBypassStateChanged: (callback) => {
    ipcRenderer.on('dpi-bypass-state-changed', (event, data) => callback(data));
  },

  // 🪟 Split Screen (2 Tabs Side-by-Side)
  toggleSplitScreen: (tabId) => ipcRenderer.invoke('split-screen-toggle', tabId),
  getSplitScreenState: () => ipcRenderer.invoke('split-screen-get-state'),
  setSplitScreenRatio: (ratio) => ipcRenderer.invoke('split-screen-set-ratio', ratio),
  swapSplitScreenTabs: () => ipcRenderer.invoke('split-screen-swap'),
  showSplitScreenMenu: (coords) => ipcRenderer.invoke('split-screen-show-menu', coords),
  onSplitScreenStateChanged: (callback) => {
    ipcRenderer.on('split-screen-state-changed', (event, data) => callback(data));
  },

  // 🗂️ Vertical Tabs
  toggleVerticalTabs: () => ipcRenderer.invoke('vertical-tabs-toggle'),
  toggleVerticalTabsCollapse: () => ipcRenderer.invoke('vertical-tabs-toggle-collapse'),
  setVerticalTabs: (options) => ipcRenderer.invoke('vertical-tabs-set', options),
  getVerticalTabsState: () => ipcRenderer.invoke('vertical-tabs-get-state'),
  onVerticalTabsStateChanged: (callback) => {
    ipcRenderer.on('vertical-tabs-state-changed', (event, data) => callback(data));
  },

  // Shortcuts System
  getShortcuts: () => ipcRenderer.invoke('shortcuts-get'),
  updateShortcut: (id, updates) => ipcRenderer.invoke('shortcuts-update', id, updates),
  toggleShortcut: (id, enabled) => ipcRenderer.invoke('shortcuts-toggle', id, enabled),
  resetShortcuts: () => ipcRenderer.invoke('shortcuts-reset'),

  // History
  removeHistoryItem: (idOrUrl) => ipcRenderer.invoke('history-remove-item', idOrUrl),

  // Floating Popups (Downloads & History Bubbles)
  toggleDownloadsBubble: (bounds) => ipcRenderer.invoke('popup-toggle-downloads', bounds),
  toggleHistoryBubble: (bounds) => ipcRenderer.invoke('popup-toggle-history', bounds),
  closeBubble: () => ipcRenderer.invoke('popup-close'),
  closeVirusTotalToast: () => ipcRenderer.invoke('popup-close-vt-toast'),
  openFullDownloadsModal: () => ipcRenderer.invoke('open-full-downloads-modal'),
  openFullHistoryModal: () => ipcRenderer.invoke('open-full-history-modal'),

  // Downloads System
  getDownloads: (limit) => ipcRenderer.invoke('downloads-get', limit),
  clearDownloads: () => ipcRenderer.invoke('downloads-clear'),
  removeDownloadItem: (id) => ipcRenderer.invoke('downloads-remove-item', id),
  pauseDownload: (id) => ipcRenderer.invoke('downloads-pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('downloads-resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads-cancel', id),
  openDownloadFile: (filePath) => ipcRenderer.invoke('downloads-open-file', filePath),
  showDownloadInFolder: (filePath) => ipcRenderer.invoke('downloads-show-in-folder', filePath),
  openDownloadsFolder: () => ipcRenderer.invoke('downloads-open-folder'),
  startDownloadDrag: (filePath) => ipcRenderer.send('downloads-start-drag', filePath),
  endDownloadDrag: () => ipcRenderer.send('downloads-end-drag'),
  getDownloadFileIcon: (filePath) => ipcRenderer.invoke('downloads-get-file-icon', filePath),
  checkVirusTotal: (filePathOrUrl) => ipcRenderer.invoke('check-virustotal', filePathOrUrl),

  // Event Listeners from Main process
  onTabsUpdated: (callback) => {
    ipcRenderer.on('tabs-updated', (event, data) => callback(data));
  },
  onTabStateChanged: (callback) => {
    ipcRenderer.on('tab-state-changed', (event, data) => callback(data));
  },
  onAdBlockTabStatsUpdated: (callback) => {
    ipcRenderer.on('adblock-tab-stats-updated', (event, data) => callback(data));
  },
  onAdBlockStateChanged: (callback) => {
    ipcRenderer.on('adblock-state-changed', (event, data) => callback(data));
  },
  onExtensionsUpdated: (callback) => {
    ipcRenderer.on('extensions-updated', (event, data) => callback(data));
  },
  onOpenModalExtensions: (callback) => {
    ipcRenderer.on('open-modal-extensions', () => callback());
  },
  onPromptSavePassword: (callback) => {
    ipcRenderer.on('prompt-save-password', (event, data) => callback(data));
  },
  onPromptCreateTabGroup: (callback) => {
    ipcRenderer.on('prompt-create-tab-group', (event, data) => callback(data));
  },
  onPromptEditTabGroup: (callback) => {
    ipcRenderer.on('prompt-edit-tab-group', (event, data) => callback(data));
  },
  onFocusOmnibox: (callback) => {
    ipcRenderer.on('focus-omnibox', () => callback());
  },
  onTriggerBookmarkShortcut: (callback) => {
    ipcRenderer.on('trigger-bookmark-shortcut', () => callback());
  },
  onTriggerFindShortcut: (callback) => {
    ipcRenderer.on('trigger-find-shortcut', () => callback());
  },
  onTriggerHistory: (callback) => {
    ipcRenderer.on('trigger-history', () => callback());
  },
  onTriggerDownloads: (callback) => {
    ipcRenderer.on('trigger-downloads', () => callback());
  },
  onTriggerBookmarks: (callback) => {
    ipcRenderer.on('trigger-bookmarks', () => callback());
  },
  onTriggerToggleBookmarksBar: (callback) => {
    ipcRenderer.on('trigger-toggle-bookmarks-bar', () => callback());
  },
  onTriggerSettings: (callback) => {
    ipcRenderer.on('trigger-settings', () => callback());
  },
  onTriggerPasswords: (callback) => {
    ipcRenderer.on('trigger-passwords', () => callback());
  },
  onTriggerExtensions: (callback) => {
    ipcRenderer.on('trigger-extensions', () => callback());
  },
  onTriggerShield: (callback) => {
    ipcRenderer.on('trigger-shield', () => callback());
  },
  onTriggerClearCache: (callback) => {
    ipcRenderer.on('trigger-clear-cache', () => callback());
  },
  onShortcutsUpdated: (callback) => {
    ipcRenderer.on('shortcuts-updated', (event, data) => callback(data));
  },
  onDownloadUpdated: (callback) => {
    ipcRenderer.on('download-updated', (event, data) => callback(data));
  },
  onHtmlFullScreenState: (callback) => {
    ipcRenderer.on('html-full-screen-state', (event, isFs) => callback(isFs));
  },
  onTriggerDownloadsModal: (callback) => {
    ipcRenderer.on('trigger-downloads-modal', () => callback());
  },
  onTriggerHistoryModal: (callback) => {
    ipcRenderer.on('trigger-history-modal', () => callback());
  },
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (event, data) => callback(data));
  },
  onNeonThemeChanged: (callback) => {
    ipcRenderer.on('neon-theme-changed', (event, data) => callback(data));
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings-changed', (event, data) => callback(data));
  },
  selectBackgroundImage: () => ipcRenderer.invoke('select-background-image'),

  // Updates & Version Management
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (downloadUrl) => ipcRenderer.invoke('download-update', downloadUrl),
  installUpdate: (installerPath) => ipcRenderer.invoke('install-update', installerPath),
  dismissUpdate: (version) => ipcRenderer.invoke('dismiss-update', version),
  getVersionInfo: () => ipcRenderer.invoke('get-version-info'),
  saveUpdateSettings: (settings) => ipcRenderer.invoke('save-update-settings', settings),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, data) => callback(data));
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.on('update-not-available', (event, data) => callback(data));
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (event, data) => callback(data));
  },
  onUpdateDownloadComplete: (callback) => {
    ipcRenderer.on('update-download-complete', (event, data) => callback(data));
  },
  onUpdateError: (callback) => {
    ipcRenderer.on('update-error', (event, data) => callback(data));
  }
});
