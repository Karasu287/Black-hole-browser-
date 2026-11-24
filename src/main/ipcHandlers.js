const { ipcMain, dialog, shell, app, session, BrowserWindow, Menu, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const defaultViewManager = require('./viewManager');
const extensionManager = require('./extensionManager');
const popupManager = require('./popupManager');
const adBlocker = require('./adBlocker');
const updateManager = require('./updateManager');
const dpiBypass = require('./dpiBypass');
const storage = require('./storage');
const downloadManager = require('./downloadManager');
const defaultBrowser = require('./defaultBrowser');

let isIpcInitialized = false;

function getWindow(event, defaultWin) {
  if (event && event.sender) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (typeof win.getParentWindow === 'function' && win.getParentWindow() && !win.getParentWindow().isDestroyed()) {
        return win.getParentWindow();
      }
      return win;
    }
  }
  return defaultWin || (popupManager ? popupManager.mainWindow : null) || null;
}

function getViewManager(event, defaultVm) {
  const win = getWindow(event, null);
  if (win && win._viewManager) return win._viewManager;
  if (popupManager && popupManager.mainWindow && popupManager.mainWindow._viewManager) {
    return popupManager.mainWindow._viewManager;
  }
  return defaultVm || defaultViewManager;
}

function setupIpcHandlers(mainWindow) {
  if (isIpcInitialized) return;
  isIpcInitialized = true;

  // --- Window ID Synchronous & Async Access ---
  ipcMain.on('window-get-id-sync', (event) => {
    const win = getWindow(event, mainWindow);
    event.returnValue = win ? win.id : 1;
  });

  ipcMain.handle('window-get-id', (event) => {
    const win = getWindow(event, mainWindow);
    return win ? win.id : 1;
  });

  // --- Cross-window Tab Drag & Drop Coordination ---
  let activeTabDragSession = null;

  ipcMain.handle('tabs-start-drag', (event, { tabId }) => {
    const win = getWindow(event, mainWindow);
    activeTabDragSession = {
      sourceWindowId: win ? win.id : null,
      tabId,
      handled: false,
      startTime: Date.now()
    };
    return true;
  });

  ipcMain.handle('tabs-end-drag', () => {
    const handled = activeTabDragSession ? Boolean(activeTabDragSession.handled) : false;
    setTimeout(() => {
      if (activeTabDragSession && activeTabDragSession.handled) {
        activeTabDragSession = null;
      }
    }, 400);
    return handled;
  });

  ipcMain.handle('tabs-transfer-between-windows', async (event, options) => {
    const { sourceWindowId, tabId, targetIndex, groupId } = options || {};
    const targetWin = getWindow(event, mainWindow);
    if (!targetWin || targetWin.isDestroyed()) return { success: false };

    const sourceWin = BrowserWindow.fromId(Number(sourceWindowId));
    if (!sourceWin || sourceWin.isDestroyed()) return { success: false };

    const sourceVm = sourceWin._viewManager;
    const targetVm = targetWin._viewManager;
    if (!sourceVm || !targetVm) return { success: false };

    if (activeTabDragSession) {
      activeTabDragSession.handled = true;
    }

    return await targetVm.adoptTabFromViewManager(sourceVm, tabId, {
      targetIndex,
      groupId
    });
  });

  ipcMain.handle('window-focus', (event) => {
    const win = getWindow(event, mainWindow);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // --- Window Controls ---
  ipcMain.handle('window-minimize', (event) => {
    const win = getWindow(event, mainWindow);
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.handle('window-maximize', (event) => {
    const win = getWindow(event, mainWindow);
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });

  ipcMain.handle('window-is-maximized', (event) => {
    const win = getWindow(event, mainWindow);
    return win && !win.isDestroyed() ? win.isMaximized() : false;
  });

  ipcMain.handle('window-close', (event) => {
    const win = getWindow(event, mainWindow);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('open-new-window', (event, url) => {
    const win = getWindow(event, mainWindow);
    const isIncognito = Boolean(win && win._isIncognito);
    if (global.createBrowserWindow) {
      return global.createBrowserWindow({
        initialUrl: url || (isIncognito ? 'eclipse://incognito' : 'eclipse://newtab'),
        isIncognito,
        isSecondaryWindow: true
      });
    }
  });

  // --- Incognito Window Controls ---
  ipcMain.handle('open-incognito-window', (event, url) => {
    if (global.createIncognitoWindow) {
      return global.createIncognitoWindow(url);
    }
  });

  ipcMain.handle('is-incognito-window', (event) => {
    const win = getWindow(event, mainWindow);
    return Boolean(win && win._isIncognito);
  });

  // --- Tab Management ---
  ipcMain.handle('tabs-create', (event, options) => {
    return getViewManager(event, defaultViewManager).createTab(options);
  });

  ipcMain.handle('tabs-switch', (event, tabId) => {
    getViewManager(event, defaultViewManager).switchTab(tabId);
  });

  ipcMain.handle('tabs-close', (event, tabId) => {
    getViewManager(event, defaultViewManager).closeTab(tabId);
  });

  ipcMain.handle('tabs-restore-last-closed', (event) => {
    return getViewManager(event, defaultViewManager).restoreLastClosedTab();
  });

  ipcMain.handle('tabs-reorder', (event, orderedTabs) => {
    getViewManager(event, defaultViewManager).reorderTabs(orderedTabs);
  });

  ipcMain.handle('tabs-move', (event, tabId, direction) => {
    getViewManager(event, defaultViewManager).moveTab(tabId, direction);
  });

  ipcMain.handle('tabs-move-group', (event, groupId, direction) => {
    getViewManager(event, defaultViewManager).moveGroup(groupId, direction);
  });

  ipcMain.handle('tabs-toggle-mute', (event, tabId) => {
    getViewManager(event, defaultViewManager).toggleMute(tabId);
  });

  ipcMain.handle('tabs-toggle-pip', (event, tabId) => {
    getViewManager(event, defaultViewManager).togglePictureInPicture(tabId);
  });

  ipcMain.handle('tabs-toggle-pin', (event, tabId) => {
    getViewManager(event, defaultViewManager).togglePin(tabId);
  });

  ipcMain.handle('tabs-duplicate', (event, tabId) => {
    getViewManager(event, defaultViewManager).duplicateTab(tabId);
  });

  ipcMain.handle('tabs-move-to-new-window', (event, tabId, options) => {
    return getViewManager(event, defaultViewManager).moveTabToNewWindow(tabId, options);
  });

  ipcMain.handle('tabs-open-in-new-window', (event, tabId) => {
    return getViewManager(event, defaultViewManager).openTabInNewWindow(tabId);
  });

  ipcMain.handle('tabs-close-right', (event, tabId) => {
    getViewManager(event, defaultViewManager).closeTabsToRight(tabId);
  });

  ipcMain.handle('tabs-close-left', (event, tabId) => {
    getViewManager(event, defaultViewManager).closeTabsToLeft(tabId);
  });

  ipcMain.handle('tabs-close-others', (event, tabId) => {
    getViewManager(event, defaultViewManager).closeOtherTabs(tabId);
  });

  ipcMain.handle('tabs-hibernate', (event, tabId) => {
    getViewManager(event, defaultViewManager).hibernateTab(tabId);
  });

  ipcMain.handle('tabs-show-context-menu', (event, tabId, coords) => {
    getViewManager(event, defaultViewManager).showTabContextMenu(tabId, coords);
  });

  // --- Split Screen (2 Tabs Side-by-Side) ---
  ipcMain.handle('split-screen-toggle', (event, tabId) => {
    return getViewManager(event, defaultViewManager).toggleSplitScreen(tabId);
  });

  ipcMain.handle('split-screen-get-state', (event) => {
    return getViewManager(event, defaultViewManager).getSplitScreenState();
  });

  ipcMain.handle('split-screen-set-ratio', (event, ratio) => {
    return getViewManager(event, defaultViewManager).setSplitRatio(ratio);
  });

  ipcMain.handle('split-screen-swap', (event) => {
    return getViewManager(event, defaultViewManager).swapSplitTabs();
  });

  ipcMain.handle('split-screen-show-menu', (event, coords) => {
    const vm = getViewManager(event, defaultViewManager);
    const isSplit = vm.isSplitScreen;
    const template = [
      {
        label: isSplit ? '✕ Закрыть разделение экрана' : '🪟 Включить разделение экрана (Alt+S)',
        click: () => vm.toggleSplitScreen()
      }
    ];

    if (isSplit) {
      template.push(
        { type: 'separator' },
        {
          label: '⇄ Поменять вкладки местами',
          click: () => vm.swapSplitTabs()
        },
        { type: 'separator' },
        {
          label: 'Пропорции: 50% / 50% (Поровну)',
          type: 'radio',
          checked: Math.abs(vm.splitRatio - 0.5) < 0.05,
          click: () => vm.setSplitRatio(0.5)
        },
        {
          label: 'Пропорции: 70% / 30% (Шире слева)',
          type: 'radio',
          checked: Math.abs(vm.splitRatio - 0.7) < 0.05,
          click: () => vm.setSplitRatio(0.7)
        },
        {
          label: 'Пропорции: 30% / 70% (Шире справа)',
          type: 'radio',
          checked: Math.abs(vm.splitRatio - 0.3) < 0.05,
          click: () => vm.setSplitRatio(0.3)
        }
      );
    }

    const menu = Menu.buildFromTemplate(template);
    const win = getWindow(event, vm.mainWindow);
    if (win) {
      menu.popup({
        window: win,
        x: coords && typeof coords.x === 'number' ? Math.round(coords.x) : undefined,
        y: coords && typeof coords.y === 'number' ? Math.round(coords.y) : undefined
      });
    }
    return true;
  });

  // --- Vertical Tabs ---
  ipcMain.handle('vertical-tabs-toggle', (event) => {
    return getViewManager(event, defaultViewManager).toggleVerticalTabs();
  });

  ipcMain.handle('vertical-tabs-toggle-collapse', (event) => {
    return getViewManager(event, defaultViewManager).toggleVerticalTabsCollapse();
  });

  ipcMain.handle('vertical-tabs-set', (event, options) => {
    return getViewManager(event, defaultViewManager).setVerticalTabs(options);
  });

  ipcMain.handle('vertical-tabs-get-state', (event) => {
    return getViewManager(event, defaultViewManager).getVerticalTabsState();
  });

  // --- Tab Groups (Folders) ---
  ipcMain.handle('tabs-create-group', (event, options) => {
    return getViewManager(event, defaultViewManager).createTabGroup(options);
  });

  ipcMain.handle('tabs-update-group', (event, groupId, updates) => {
    return getViewManager(event, defaultViewManager).updateTabGroup(groupId, updates);
  });

  ipcMain.handle('tabs-toggle-group-collapse', (event, groupId) => {
    getViewManager(event, defaultViewManager).toggleGroupCollapse(groupId);
  });

  ipcMain.handle('tabs-add-to-group', (event, tabId, groupId) => {
    getViewManager(event, defaultViewManager).addTabToGroup(tabId, groupId);
  });

  ipcMain.handle('tabs-remove-from-group', (event, tabId) => {
    getViewManager(event, defaultViewManager).removeTabFromGroup(tabId);
  });

  ipcMain.handle('tabs-ungroup', (event, groupId) => {
    getViewManager(event, defaultViewManager).ungroup(groupId);
  });

  ipcMain.handle('tabs-close-group', (event, groupId) => {
    getViewManager(event, defaultViewManager).closeGroup(groupId);
  });

  ipcMain.handle('tabs-show-group-context-menu', (event, groupId, coords) => {
    getViewManager(event, defaultViewManager).showGroupContextMenu(groupId, coords);
  });

  ipcMain.handle('tabs-get-all', (event) => {
    const vm = getViewManager(event, defaultViewManager);
    return {
      tabs: vm.getTabsSummary(),
      groups: vm.getGroupsSummary(),
      activeTabId: vm.activeTabId
    };
  });

  // --- Navigation ---
  ipcMain.handle('nav-navigate', (event, url) => {
    getViewManager(event, defaultViewManager).navigate(url);
  });

  ipcMain.handle('nav-back', (event) => {
    getViewManager(event, defaultViewManager).goBack();
  });

  ipcMain.handle('nav-forward', (event) => {
    getViewManager(event, defaultViewManager).goForward();
  });

  ipcMain.handle('nav-reload', (event, ignoreCache) => {
    getViewManager(event, defaultViewManager).reload(ignoreCache);
  });

  ipcMain.handle('nav-stop', (event) => {
    getViewManager(event, defaultViewManager).stop();
  });

  ipcMain.handle('nav-set-top-bar-height', (event, height) => {
    getViewManager(event, defaultViewManager).setTopBarHeight(height);
  });

  ipcMain.handle('nav-find-in-page', (event, text, forward, findNext) => {
    return getViewManager(event, defaultViewManager).findInPage(text, forward, findNext);
  });

  ipcMain.handle('nav-stop-find', (event, action) => {
    getViewManager(event, defaultViewManager).stopFindInPage(action);
  });

  // --- Chrome Extension Management ---
  ipcMain.handle('extensions-get-all', () => {
    return extensionManager.getAllExtensions();
  });

  ipcMain.handle('extensions-toggle', async (event, id, enabled) => {
    return await extensionManager.toggleExtension(id, enabled);
  });

  ipcMain.handle('extensions-remove', async (event, id) => {
    return await extensionManager.removeExtension(id);
  });

  ipcMain.handle('extensions-open-popup', (event, id, anchorBounds) => {
    extensionManager.openExtensionPopup(id, anchorBounds);
  });

  ipcMain.handle('extensions-open-options', (event, id) => {
    extensionManager.openExtensionOptions(id);
  });

  ipcMain.handle('extensions-toggle-pin', (event, id, isPinned) => {
    return extensionManager.toggleExtensionPin(id, isPinned);
  });

  ipcMain.handle('extensions-show-context-menu', (event, id, coords) => {
    extensionManager.showExtensionContextMenu(id, coords);
  });

  ipcMain.handle('extensions-install-file-dialog', async (event) => {
    const parentWin = getWindow(event, mainWindow);
    const result = await dialog.showOpenDialog(parentWin, {
      title: 'Выберите файл расширения (.zip или .crx)',
      filters: [
        { name: 'Chrome Extension Archive', extensions: ['zip', 'crx'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return await extensionManager.installFromZipOrCrx(result.filePaths[0]);
    }
    return { canceled: true };
  });

  ipcMain.handle('extensions-install-dir-dialog', async (event) => {
    const parentWin = getWindow(event, mainWindow);
    const result = await dialog.showOpenDialog(parentWin, {
      title: 'Выберите папку с распакованным расширением (содержащую manifest.json)',
      properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return await extensionManager.installFromDirectory(result.filePaths[0]);
    }
    return { canceled: true };
  });

  ipcMain.handle('extensions-install-from-path', async (event, filePath) => {
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        return await extensionManager.installFromDirectory(filePath);
      } else {
        return await extensionManager.installFromZipOrCrx(filePath);
      }
    }
    return { success: false, error: 'File does not exist' };
  });

  ipcMain.handle('extensions-install-from-webstore', async (event, idOrUrl) => {
    return await extensionManager.installFromWebStore(idOrUrl);
  });

  // --- Bookmarks ---
  ipcMain.handle('bookmarks-get', () => {
    return storage.getBookmarks();
  });

  ipcMain.handle('bookmarks-add', (event, bookmark) => {
    return storage.addBookmark(bookmark);
  });

  ipcMain.handle('bookmarks-remove', (event, id) => {
    return storage.removeBookmark(id);
  });

  ipcMain.handle('bookmarks-check', (event, url) => {
    return storage.isBookmarked(url);
  });

  // --- History ---
  ipcMain.handle('history-get', (event, limit) => {
    return storage.getHistory(limit);
  });

  ipcMain.handle('history-clear', () => {
    return storage.clearHistory();
  });

  ipcMain.handle('history-remove-item', (event, idOrUrl) => {
    return storage.removeHistoryItem(idOrUrl);
  });

  // --- Popups (Downloads & History Floating Bubbles) ---
  ipcMain.handle('popup-toggle-downloads', (event, anchorBounds) => {
    const win = getWindow(event, mainWindow);
    if (win) popupManager.setMainWindow(win);
    popupManager.togglePopup('downloads', anchorBounds);
  });

  ipcMain.handle('popup-toggle-history', (event, anchorBounds) => {
    const win = getWindow(event, mainWindow);
    if (win) popupManager.setMainWindow(win);
    popupManager.togglePopup('history', anchorBounds);
  });

  ipcMain.handle('popup-close', () => {
    popupManager.closePopup();
  });

  ipcMain.handle('popup-close-vt-toast', () => {
    popupManager.closeVirusTotalToast();
  });

  ipcMain.handle('open-full-downloads-modal', (event) => {
    const vm = getViewManager(event, defaultViewManager);
    popupManager.closePopup();
    if (vm) {
      vm.createTab({ url: 'eclipse://downloads', active: true });
    }
  });

  ipcMain.handle('open-full-history-modal', (event) => {
    const vm = getViewManager(event, defaultViewManager);
    popupManager.closePopup();
    if (vm) {
      vm.createTab({ url: 'eclipse://history', active: true });
    }
  });

  // --- Settings ---
  ipcMain.handle('settings-get', () => {
    return storage.getSettings();
  });

  ipcMain.handle('settings-update', (event, newSettings) => {
    const updated = storage.updateSettings(newSettings);
    if (newSettings && newSettings.theme !== undefined) {
      if (global.applyThemeSource) {
        global.applyThemeSource(newSettings.theme);
      }
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('theme-changed', {
            theme: newSettings.theme,
            shouldUseDarkColors: nativeTheme.shouldUseDarkColors
          });
          if (win._viewManager && typeof win._viewManager.updateTheme === 'function') {
            win._viewManager.updateTheme(newSettings.theme);
          }
        }
      });
      if (defaultViewManager && typeof defaultViewManager.updateTheme === 'function') {
        defaultViewManager.updateTheme(newSettings.theme);
      }
    }
    if (newSettings && (newSettings.websiteDarkTheme !== undefined || newSettings.theme !== undefined)) {
      if (global.applyThemeSource) {
        global.applyThemeSource();
      }
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win._viewManager && typeof win._viewManager.updateWebColorScheme === 'function') {
          win._viewManager.updateWebColorScheme();
        }
      });
      if (defaultViewManager && typeof defaultViewManager.updateWebColorScheme === 'function') {
        defaultViewManager.updateWebColorScheme();
      }
    }
    if (newSettings && newSettings.youtubeDpiBypassEnabled !== undefined) {
      if (dpiBypass.enabled !== newSettings.youtubeDpiBypassEnabled) {
        dpiBypass.toggle(newSettings.youtubeDpiBypassEnabled);
      }
    }

    // Broadcast settings and neon theme update to all windows and views
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('settings-changed', updated);
        if (newSettings && newSettings.neonThemeColor !== undefined) {
          win.webContents.send('neon-theme-changed', { neonThemeColor: newSettings.neonThemeColor });
        }
        const vm = win._viewManager || defaultViewManager;
        if (vm && vm.tabs) {
          vm.tabs.forEach(tab => {
            if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
              tab.view.webContents.send('settings-changed', updated);
              if (newSettings && newSettings.neonThemeColor !== undefined) {
                tab.view.webContents.send('neon-theme-changed', { neonThemeColor: newSettings.neonThemeColor });
              }
            }
          });
        }
      }
    });

    return updated;
  });

  // Dialog to select custom background image for newtab
  ipcMain.handle('select-background-image', async (event) => {
    const parentWin = getWindow(event, mainWindow);
    const result = await dialog.showOpenDialog(parentWin, {
      title: 'Выберите фоновое изображение для главной страницы',
      filters: [
        { name: 'Изображения (PNG, JPG, WEBP, GIF, BMP)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      try {
        const bgDir = path.join(storage.userDataPath, 'custom_backgrounds');
        if (!fs.existsSync(bgDir)) {
          fs.mkdirSync(bgDir, { recursive: true });
        }
        const ext = path.extname(selectedPath).toLowerCase();
        const destPath = path.join(bgDir, 'user_background' + ext);
        fs.copyFileSync(selectedPath, destPath);

        const fileBuf = fs.readFileSync(destPath);
        const mimeType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : (ext === '.gif' ? 'image/gif' : 'image/jpeg'));
        const dataUrl = `data:${mimeType};base64,${fileBuf.toString('base64')}`;
        return { success: true, filePath: destPath, dataUrl };
      } catch (err) {
        console.error('Failed to copy custom background:', err);
        return { success: false, error: err.message };
      }
    }
    return { canceled: true };
  });

  // --- YouTube DPI Bypass ---
  ipcMain.handle('dpi-get-status', () => {
    return dpiBypass.getStatus();
  });

  ipcMain.handle('dpi-toggle', (event, enable) => {
    return dpiBypass.toggle(enable);
  });

  // --- Default Browser ---
  ipcMain.handle('check-is-default-browser', async () => {
    return defaultBrowser.checkIsDefaultBrowser();
  });

  ipcMain.handle('set-as-default-browser', async () => {
    return await defaultBrowser.setAsDefaultBrowser();
  });

  // --- YouTube Theater Mode Sync & Persistence ---
  ipcMain.on('get-yt-theater-mode-sync', (event) => {
    event.returnValue = storage.getYoutubeTheaterMode();
  });

  ipcMain.on('get-adblock-enabled-sync', (event) => {
    try {
      event.returnValue = Boolean(adBlocker && adBlocker.enabled);
    } catch (e) {
      event.returnValue = true;
    }
  });

  ipcMain.handle('get-yt-theater-mode', () => {
    return storage.getYoutubeTheaterMode();
  });

  ipcMain.on('set-yt-theater-mode', (event, enabled) => {
    const isEnabled = Boolean(enabled);
    storage.setYoutubeTheaterMode(isEnabled);
    
    // Update YouTube PREF cookie (f6=400 is dark mode, wide=1/0 is theater mode)
    const prefVal = isEnabled ? 'f6=400&wide=1' : 'f6=400&wide=0';
    session.defaultSession.cookies.set({
      url: 'https://www.youtube.com',
      name: 'PREF',
      value: prefVal,
      domain: '.youtube.com',
      path: '/',
      expirationDate: Math.floor(Date.now() / 1000) + 315360000
    }).catch(() => {});
  });

  // --- Ad Blocker & Shield Engine ---
  ipcMain.handle('adblock-get-status', (event, domain, tabId) => {
    let wcId = null;
    if (tabId) {
      const vm = getViewManager(event, defaultViewManager);
      const tab = vm.tabs.get(tabId);
      if (tab && tab.view && tab.view.webContents) {
        wcId = tab.view.webContents.id;
      }
    }
    return adBlocker.getStatusForDomain(domain, wcId);
  });

  ipcMain.handle('adblock-toggle', (event, enable) => {
    return adBlocker.toggle(enable);
  });

  ipcMain.handle('adblock-toggle-whitelist', (event, domain) => {
    return adBlocker.toggleWhitelist(domain);
  });

  ipcMain.handle('adblock-get-whitelist', () => {
    return storage.getAdBlockWhitelist();
  });

  ipcMain.handle('adblock-reset-stats', () => {
    return storage.resetAdBlockStats();
  });

  ipcMain.handle('adblock-get-stats', () => {
    return storage.getAdBlockStats();
  });

  ipcMain.handle('settings-clear-cache', async () => {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ['appcache', 'serviceworkers', 'cachestorage']
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // --- Performance / Memory Stats ---
  ipcMain.handle('performance-get-stats', async (event) => {
    const mem = process.getProcessMemoryInfo ? await process.getProcessMemoryInfo() : {};
    const vm = getViewManager(event, defaultViewManager);
    const tabs = vm.getTabsSummary();
    const sleepingCount = tabs.filter(t => t.isSleeping).length;
    const activeCount = tabs.length - sleepingCount;
    const estimatedSavedRamMb = sleepingCount * 110;

    return {
      residentSetMb: Math.round((mem.residentSet || 0) / 1024),
      privateMemoryMb: Math.round((mem.private || 0) / 1024),
      totalTabs: tabs.length,
      activeTabs: activeCount,
      sleepingTabs: sleepingCount,
      estimatedSavedRamMb
    };
  });

  // --- Password Manager ---
  ipcMain.handle('passwords-get', () => {
    return storage.getPasswords();
  });

  ipcMain.handle('passwords-save', (event, credential) => {
    return storage.savePassword(credential);
  });

  ipcMain.handle('passwords-delete', (event, id) => {
    return storage.deletePassword(id);
  });

  ipcMain.handle('passwords-get-for-origin', (event, origin) => {
    return storage.getPasswordsForOrigin(origin);
  });

  ipcMain.handle('passwords-batch-import', (event, items, options) => {
    return storage.importPasswords(items, options);
  });

  ipcMain.handle('passwords-import-file-dialog', async (event) => {
    const fs = require('fs');
    const parentWin = getWindow(event, mainWindow);
    const result = await dialog.showOpenDialog(parentWin, {
      title: 'Выберите файл экспорта паролей (CSV или JSON из Chrome, Яндекс, Edge, Firefox, Bitwarden)',
      filters: [
        { name: 'Файлы паролей (CSV / JSON)', extensions: ['csv', 'txt', 'json'] },
        { name: 'Все файлы', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = parsePasswordsFromContent(content);
        return {
          success: true,
          filePath,
          totalParsed: parsed.length,
          items: parsed
        };
      } catch (err) {
        return { success: false, error: 'Ошибка чтения файла: ' + err.message };
      }
    }
    return { canceled: true };
  });

  ipcMain.handle('passwords-parse-content', (event, content) => {
    try {
      const parsed = parsePasswordsFromContent(content);
      return { success: true, totalParsed: parsed.length, items: parsed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('passwords-export-file-dialog', async (event) => {
    const fs = require('fs');
    const parentWin = getWindow(event, mainWindow);
    const result = await dialog.showSaveDialog(parentWin, {
      title: 'Экспорт паролей Black hole Browser в CSV',
      defaultPath: `blackhole_passwords_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [
        { name: 'CSV File', extensions: ['csv'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      try {
        const csv = storage.exportPasswordsCsv();
        fs.writeFileSync(result.filePath, csv, 'utf8');
        return { success: true, filePath: result.filePath, count: storage.getPasswords().length };
      } catch (err) {
        return { success: false, error: 'Ошибка сохранения файла: ' + err.message };
      }
    }
    return { canceled: true };
  });

  // Listen for login/password submission from web tabs
  ipcMain.on('detected-credentials', (event, { origin, username, password }) => {
    const win = getWindow(event, mainWindow);
    if (win && !win.isDestroyed() && !win._isIncognito) {
      win.webContents.send('prompt-save-password', { origin, username, password });
    }
  });

  // --- Modal Overlay ---
  ipcMain.handle('modal-state-changed', (event, isOpen) => {
    getViewManager(event, defaultViewManager).setModalOverlay(isOpen);
  });

  // --- Shortcuts System ---
  ipcMain.handle('shortcuts-get', () => {
    return storage.getShortcuts();
  });

  ipcMain.handle('shortcuts-update', (event, id, updates) => {
    const updated = storage.updateShortcut(id, updates);
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('shortcuts-updated', storage.getShortcuts());
      }
    });
    return updated;
  });

  ipcMain.handle('shortcuts-toggle', (event, id, enabled) => {
    const updated = storage.toggleShortcut(id, enabled);
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('shortcuts-updated', storage.getShortcuts());
      }
    });
    return updated;
  });

  ipcMain.handle('shortcuts-reset', () => {
    const resetList = storage.resetShortcuts();
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('shortcuts-updated', resetList);
      }
    });
    return resetList;
  });

  // --- Downloads System ---
  ipcMain.handle('downloads-get', (event, limit) => {
    return storage.getDownloads(limit);
  });

  ipcMain.handle('downloads-clear', () => {
    return storage.clearDownloads();
  });

  ipcMain.handle('downloads-remove-item', (event, id) => {
    return storage.removeDownloadRecord(id);
  });

  ipcMain.handle('downloads-pause', (event, id) => {
    return downloadManager.pauseDownload(id);
  });
  ipcMain.handle('download-pause', (event, id) => {
    return downloadManager.pauseDownload(id);
  });

  ipcMain.handle('downloads-resume', (event, id) => {
    return downloadManager.resumeDownload(id);
  });
  ipcMain.handle('download-resume', (event, id) => {
    return downloadManager.resumeDownload(id);
  });

  ipcMain.handle('downloads-cancel', (event, id) => {
    return downloadManager.cancelDownload(id);
  });
  ipcMain.handle('download-cancel', (event, id) => {
    return downloadManager.cancelDownload(id);
  });

  ipcMain.handle('downloads-open-file', (event, filePath) => {
    if (filePath) {
      shell.openPath(filePath);
    }
  });

  ipcMain.handle('downloads-show-in-folder', (event, filePath) => {
    if (filePath) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('downloads-open-folder', () => {
    const dlPath = app.getPath('downloads');
    shell.openPath(dlPath);
  });

  const dragIconCache = new Map();

  ipcMain.handle('downloads-get-file-icon', async (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    try {
      const normalizedPath = path.normalize(path.resolve(filePath));
      if (fs.existsSync(normalizedPath)) {
        const icon = await app.getFileIcon(normalizedPath, { size: 'normal' });
        if (icon && !icon.isEmpty()) {
          dragIconCache.set(normalizedPath, icon);
          return icon.toDataURL();
        }
      }
    } catch (e) {}
    return null;
  });

  ipcMain.on('downloads-start-drag', (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return;
    const normalizedPath = path.normalize(path.resolve(filePath));
    if (!fs.existsSync(normalizedPath)) return;

    popupManager.isDragging = true;

    // Synchronous icon resolution to prevent losing the Windows OLE drag context
    let icon = dragIconCache.get(normalizedPath);
    if (!icon) {
      try {
        const defaultIco = path.join(__dirname, '../../icon.ico');
        if (fs.existsSync(defaultIco)) {
          icon = nativeImage.createFromPath(defaultIco);
        }
      } catch (err) {}
    }

    try {
      event.sender.startDrag({
        file: normalizedPath,
        files: [normalizedPath],
        icon: icon || path.join(__dirname, '../../icon.ico')
      });
    } catch (dragErr) {
      console.warn('Failed to start native drag:', dragErr.message);
    }

    // Safety fallback timer to release dragging state
    setTimeout(() => {
      if (popupManager.isDragging) {
        popupManager.isDragging = false;
      }
    }, 12000);
  });

  ipcMain.on('downloads-end-drag', () => {
    popupManager.isDragging = false;
    setTimeout(() => {
      if (popupManager.activePopupWindow && !popupManager.activePopupWindow.isDestroyed() && !popupManager.activePopupWindow.isFocused()) {
        popupManager.closePopup();
      }
    }, 300);
  });

  // --- VirusTotal Security Scanner ---
  ipcMain.handle('check-virustotal', async (event, targetPathOrUrl) => {
    const vm = getViewManager(event, defaultViewManager);
    popupManager.closePopup();

    try {
      if (!targetPathOrUrl || typeof targetPathOrUrl !== 'string') {
        vm.createTab({ url: 'https://www.virustotal.com/gui/home/upload', active: true });
        return { success: true, url: 'https://www.virustotal.com/gui/home/upload' };
      }

      // If it's an HTTP/HTTPS URL (e.g. extension page or download URL)
      if (targetPathOrUrl.startsWith('http://') || targetPathOrUrl.startsWith('https://')) {
        const urlSha256 = crypto.createHash('sha256').update(targetPathOrUrl).digest('hex');
        const vtUrl = `https://www.virustotal.com/gui/url/${urlSha256}`;
        vm.createTab({ url: vtUrl, active: true });
        return { success: true, url: vtUrl };
      }

      // If it's a local file path
      const normalizedPath = path.normalize(path.resolve(targetPathOrUrl));
      if (fs.existsSync(normalizedPath)) {
        const stat = fs.statSync(normalizedPath);
        if (stat.isFile()) {
          const sha256 = await new Promise((resolve) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(normalizedPath);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', () => resolve(null));
          });

          if (sha256) {
            const vtUrl = `https://www.virustotal.com/gui/file/${sha256}`;
            vm.createTab({ url: vtUrl, active: true });
            return { success: true, sha256, url: vtUrl };
          }
        }
      }

      // Fallback: open VirusTotal home upload page
      vm.createTab({ url: 'https://www.virustotal.com/gui/home/upload', active: true });
      return { success: true, url: 'https://www.virustotal.com/gui/home/upload' };
    } catch (err) {
      console.warn('VirusTotal check error:', err);
      vm.createTab({ url: 'https://www.virustotal.com/gui/home/upload', active: true });
      return { success: false, error: err.message };
    }
  });

  // --- Utility ---
  ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
  });

  // --- Update Manager Handlers ---
  ipcMain.handle('check-for-updates', async (event) => {
    return await updateManager.checkForUpdates({ manual: true });
  });

  ipcMain.handle('download-update', async (event, downloadUrl) => {
    return await updateManager.downloadUpdate(downloadUrl);
  });

  ipcMain.handle('install-update', async (event, installerPath) => {
    return updateManager.installUpdate(installerPath);
  });

  ipcMain.handle('dismiss-update', async (event, version) => {
    return updateManager.dismissUpdate(version);
  });

  ipcMain.handle('get-version-info', async () => {
    return updateManager.getVersionInfo();
  });

  ipcMain.handle('save-update-settings', async (event, newSettings) => {
    return updateManager.saveUpdateSettings(newSettings);
  });
}

function parsePasswordsFromContent(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const text = rawText.trim();

  // 1. Try JSON formats (Bitwarden JSON, custom JSON export)
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.passwords || parsed.logins || parsed.items || []);
      if (Array.isArray(list) && list.length > 0) {
        return list.map(item => {
          const login = (typeof item.login === 'object' && item.login) ? item.login : {};
          let origin = item.origin || item.url || item.website || (login.uris && login.uris[0] ? login.uris[0].uri : '') || item.name || '';
          let username = item.username || (typeof item.login === 'string' ? item.login : '') || login.username || item.user || '';
          let password = item.password || login.password || '';

          if (typeof origin === 'object' && origin) origin = origin.uri || origin.url || '';
          if (typeof username === 'object' && username) username = username.username || '';
          if (typeof password === 'object' && password) password = '';

          return { origin: String(origin || '').trim(), username: String(username || '').trim(), password: String(password || '').trim() };
        }).filter(p => p.origin && p.password);
      }
    } catch (e) {}
  }

  // 2. Parse CSV (Chrome, Edge, Yandex, Opera, Firefox, KeePass, 1Password)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const isSemicolon = !firstLine.includes(',') && firstLine.includes(';');
  const delim = isSemicolon ? ';' : ',';

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delim && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headerCols = parseLine(firstLine).map(h => h.toLowerCase().replace(/[\s_"']/g, ''));

  let urlIdx = headerCols.findIndex(h => ['url', 'origin', 'website', 'uri', 'site', 'hostname', 'link', 'formactionorigin'].includes(h));
  let userIdx = headerCols.findIndex(h => ['username', 'user', 'login', 'email', 'loginname', 'account'].includes(h));
  let pwdIdx = headerCols.findIndex(h => ['password', 'pass', 'pwd', 'secret', 'passwords'].includes(h));
  let nameIdx = headerCols.findIndex(h => ['name', 'title'].includes(h));

  let startRow = 1;

  // If no header matches found, check if first row is data
  if (urlIdx === -1 && pwdIdx === -1) {
    if (headerCols.length >= 3) {
      if (headerCols.length >= 4) {
        urlIdx = 1; userIdx = 2; pwdIdx = 3;
      } else {
        urlIdx = 0; userIdx = 1; pwdIdx = 2;
      }
      startRow = 0; // First line is actual data
    }
  }

  if (urlIdx === -1 && nameIdx !== -1) urlIdx = nameIdx;
  if (pwdIdx === -1) pwdIdx = headerCols.length - 1;

  const results = [];
  for (let i = startRow; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length === 0) continue;

    let origin = (urlIdx >= 0 ? cols[urlIdx] : (nameIdx >= 0 ? cols[nameIdx] : '')) || '';
    let username = userIdx >= 0 ? (cols[userIdx] || '') : '';
    let password = pwdIdx >= 0 ? (cols[pwdIdx] || '') : '';

    // Clean wrapping quotes
    origin = origin.replace(/^["']|["']$/g, '').trim();
    username = username.replace(/^["']|["']$/g, '').trim();
    password = password.replace(/^["']|["']$/g, '').trim();

    if (origin && password) {
      results.push({ origin, username, password });
    }
  }

  return results;
}

module.exports = { setupIpcHandlers };
