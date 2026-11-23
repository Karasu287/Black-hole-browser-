const { WebContentsView, BrowserWindow, session, shell, Menu, MenuItem, dialog, app, Notification, clipboard, ipcMain, webFrameMain, nativeTheme } = require('electron');
const path = require('path');
const storage = require('./storage');
const adBlocker = require('./adBlocker');

const GROUP_COLORS = {
  purple: '#a855f7',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  green: '#10b981',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899'
};

class ViewManager {
  constructor(mainWindow = null, options = {}) {
    this.mainWindow = mainWindow;
    this.isIncognito = Boolean(options.isIncognito);
    this.tabs = new Map(); // id -> tab object
    this.tabGroups = new Map(); // id -> group object { id, name, color, colorHex, isCollapsed }
    this.tabMediaMap = new Map(); // webContentsId -> last detected media info
    this.activeTabId = null;
    this.topBarHeight = 109; // Tabs (38px) + Navbar (40px) + Bookmarks (30px) + Border (1px)
    this.sleepInterval = null;
    this.nextTabId = 1;
    this.nextGroupId = 1;
    this.isModalOpen = false;
    this.isHtmlFullScreen = false;
    this.activeFullScreenTabId = null;
    this.isSplitScreen = false;
    this.splitTabId = null;
    this.splitRatio = 0.5;
    const initialSettings = storage.getSettings ? storage.getSettings() : {};
    this.isVerticalTabs = Boolean(initialSettings.verticalTabsEnabled);
    this.verticalTabsCollapsed = Boolean(initialSettings.verticalTabsCollapsed);
    this.verticalTabsWidth = Number(initialSettings.verticalTabsWidth) || 240;
    this.verticalTabsCollapsedWidth = 52;
    this.recentlyClosedTabs = this.isIncognito ? [] : (storage.getRecentlyClosedTabs() || []);
    if (!ViewManager._mediaIpcInitialized) {
      ViewManager._mediaIpcInitialized = true;
      this.initMediaIpcHandlers();
    }
    if (mainWindow) {
      this.setMainWindow(mainWindow);
    }
  }

  setModalOverlay(isOpen) {
    this.isModalOpen = Boolean(isOpen);
    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || !tab.view) return;

    if (this.isModalOpen) {
      if (this.mainWindow.contentView.children.includes(tab.view)) {
        this.mainWindow.contentView.removeChildView(tab.view);
      }
    } else {
      if (!this.mainWindow.contentView.children.includes(tab.view)) {
        this.mainWindow.contentView.addChildView(tab.view);
      }
      this.updateActiveViewBounds();
    }
  }

  setMainWindow(window) {
    this.mainWindow = window;
    this.startHibernationWatchdog();
    
    this.mainWindow.on('resize', () => {
      this.updateActiveViewBounds();
    });

    // Handle full screen bounds
    this.mainWindow.on('enter-full-screen', () => {
      this.updateActiveViewBounds();
    });
    this.mainWindow.on('leave-full-screen', () => {
      if (this.isHtmlFullScreen) {
        this.isHtmlFullScreen = false;
        const tab = this.tabs.get(this.activeTabId);
        if (tab && tab.view && tab.view.webContents) {
          tab.view.webContents.executeJavaScript('if (document.fullscreenElement) { document.exitFullscreen(); }').catch(() => {});
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('html-full-screen-state', false);
        }
      }
      this.updateActiveViewBounds();
    });
  }

  setTopBarHeight(height) {
    this.topBarHeight = height;
    this.updateActiveViewBounds();
  }

  setModalOverlay(isOpen) {
    this.isModalOpen = Boolean(isOpen);
    this.updateActiveViewBounds();
  }

  setTabDimming(tabId = null, opacity = 0.35) {
    const targetId = tabId || this.activeTabId;
    if (!targetId) return;
    const tab = this.tabs.get(targetId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return;

    const op = Math.max(0, Math.min(0.9, parseFloat(opacity) || 0.35));
    const js = `(function() {
      try {
        let d = document.getElementById('__blackhole_dimmer__');
        if (!d) {
          d = document.createElement('div');
          d.id = '__blackhole_dimmer__';
          d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,${op});z-index:2147483647;pointer-events:none;transition:opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);opacity:0;';
          (document.body || document.documentElement).appendChild(d);
          requestAnimationFrame(() => { if (d) d.style.opacity = '1'; });
        } else {
          d.style.background = 'rgba(0,0,0,${op})';
          d.style.opacity = '1';
        }
      } catch(e) {}
    })();`;

    tab.view.webContents.executeJavaScript(js).catch(() => {});
  }

  removeTabDimming(tabId = null) {
    const targetId = tabId || this.activeTabId;
    if (!targetId) return;
    const tab = this.tabs.get(targetId);
    if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return;

    const js = `(function() {
      try {
        const d = document.getElementById('__blackhole_dimmer__');
        if (d) {
          d.style.opacity = '0';
          setTimeout(() => {
            if (d && d.parentNode) d.parentNode.removeChild(d);
          }, 220);
        }
      } catch(e) {}
    })();`;

    tab.view.webContents.executeJavaScript(js).catch(() => {});
  }

  updateActiveViewBounds() {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || !tab.view) return;

    try {
      if (tab.view.webContents && tab.view.webContents.isDestroyed()) return;

      const splitTab = (this.isSplitScreen && this.splitTabId) ? this.tabs.get(this.splitTabId) : null;
      const isSplitActive = Boolean(this.isSplitScreen && splitTab && splitTab.view && !splitTab.isSleeping && (!splitTab.view.webContents || !splitTab.view.webContents.isDestroyed()));

      if (this.isModalOpen) {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        if (isSplitActive) {
          splitTab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
        return;
      }

      const [width, height] = this.mainWindow.getContentSize();

      if (this.isHtmlFullScreen || (this.mainWindow && this.mainWindow.isFullScreen())) {
        tab.view.setBounds({
          x: 0,
          y: 0,
          width: width,
          height: height
        });
        if (isSplitActive) {
          splitTab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
      } else {
        const sidebarOffset = this.isVerticalTabs
          ? (this.verticalTabsCollapsed ? this.verticalTabsCollapsedWidth : this.verticalTabsWidth)
          : 0;
        const contentWidth = Math.max(200, width - sidebarOffset);
        const viewHeight = Math.max(0, height - this.topBarHeight);

        if (isSplitActive) {
          const dividerWidth = 6;
          const leftWidth = Math.max(200, Math.floor((contentWidth - dividerWidth) * this.splitRatio));
          const rightWidth = Math.max(200, contentWidth - leftWidth - dividerWidth);
          const rightX = sidebarOffset + leftWidth + dividerWidth;

          tab.view.setBounds({
            x: sidebarOffset,
            y: this.topBarHeight,
            width: leftWidth,
            height: viewHeight
          });

          splitTab.view.setBounds({
            x: rightX,
            y: this.topBarHeight,
            width: rightWidth,
            height: viewHeight
          });
          return;
        }

        tab.view.setBounds({
          x: sidebarOffset,
          y: this.topBarHeight,
          width: contentWidth,
          height: viewHeight
        });
      }
    } catch (e) {
      console.warn('Error setting view bounds:', e);
    }
  }

  // --- Split Screen (2 Tabs Side-by-Side) Controller ---
  toggleSplitScreen(targetTabId = null) {
    if (this.isSplitScreen) {
      if (targetTabId && targetTabId !== this.splitTabId && targetTabId !== this.activeTabId) {
        this.enableSplitScreen(targetTabId);
      } else {
        this.disableSplitScreen();
      }
    } else {
      this.enableSplitScreen(targetTabId);
    }
  }

  enableSplitScreen(targetTabId = null) {
    let splitId = targetTabId;
    if (!splitId || splitId === this.activeTabId) {
      // Pick another open tab if available
      for (const [id, tab] of this.tabs.entries()) {
        if (id !== this.activeTabId) {
          splitId = id;
          break;
        }
      }
      // If only 1 tab exists, create a new tab for the second pane
      if (!splitId) {
        const newTab = this.createTab({ url: this.isIncognito ? 'eclipse://incognito' : 'eclipse://newtab', active: false });
        splitId = newTab ? newTab.id : null;
      }
    }

    if (!splitId) return false;
    const splitTab = this.tabs.get(splitId);
    if (!splitTab) return false;

    // Wake up target tab if sleeping
    if (splitTab.isSleeping) {
      this.wakeTab(splitId);
    }

    // Clean up previous split tab view if different
    if (this.splitTabId && this.splitTabId !== splitId) {
      const prevSplit = this.tabs.get(this.splitTabId);
      if (prevSplit && prevSplit.view) {
        try {
          if (typeof prevSplit.view.setVisible === 'function') prevSplit.view.setVisible(false);
          if (this.mainWindow && this.mainWindow.contentView && this.mainWindow.contentView.children.includes(prevSplit.view)) {
            this.mainWindow.contentView.removeChildView(prevSplit.view);
          }
        } catch (e) {}
      }
    }

    this.isSplitScreen = true;
    this.splitTabId = splitId;
    splitTab.lastActive = Date.now();

    try {
      if (splitTab.view) {
        if (typeof splitTab.view.setVisible === 'function') splitTab.view.setVisible(true);
        if (this.mainWindow && this.mainWindow.contentView && !this.mainWindow.contentView.children.includes(splitTab.view)) {
          this.mainWindow.contentView.addChildView(splitTab.view);
        }
      }
    } catch (e) {
      console.warn('Error attaching split view:', e);
    }

    this.updateActiveViewBounds();
    this.notifySplitScreenState();
    this.notifyTabsUpdate();
    return true;
  }

  disableSplitScreen() {
    if (!this.isSplitScreen) return;

    if (this.splitTabId) {
      const splitTab = this.tabs.get(this.splitTabId);
      if (splitTab && splitTab.view) {
        try {
          if (typeof splitTab.view.setVisible === 'function') splitTab.view.setVisible(false);
          if (this.mainWindow && this.mainWindow.contentView && this.mainWindow.contentView.children.includes(splitTab.view)) {
            this.mainWindow.contentView.removeChildView(splitTab.view);
          }
        } catch (e) {}
      }
    }

    this.isSplitScreen = false;
    this.splitTabId = null;

    this.updateActiveViewBounds();
    this.notifySplitScreenState();
    this.notifyTabsUpdate();
  }

  setSplitRatio(ratio) {
    this.splitRatio = Math.max(0.2, Math.min(0.8, Number(ratio) || 0.5));
    this.updateActiveViewBounds();
    this.notifySplitScreenState();
  }

  swapSplitTabs() {
    if (!this.isSplitScreen || !this.splitTabId || !this.activeTabId) return;
    const oldActive = this.activeTabId;
    this.activeTabId = this.splitTabId;
    this.splitTabId = oldActive;

    this.updateActiveViewBounds();
    this.notifySplitScreenState();
    this.notifyTabsUpdate();
    this.notifyTabState(this.activeTabId);
  }

  getSplitScreenState() {
    return {
      isActive: this.isSplitScreen,
      leftTabId: this.activeTabId,
      rightTabId: this.splitTabId,
      splitRatio: this.splitRatio
    };
  }

  notifySplitScreenState() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('split-screen-state-changed', this.getSplitScreenState());
    }
  }

  // --- Vertical Tabs Controller ---
  toggleVerticalTabs() {
    this.isVerticalTabs = !this.isVerticalTabs;
    storage.updateSettings({ verticalTabsEnabled: this.isVerticalTabs });
    this.updateActiveViewBounds();
    this.notifyVerticalTabsState();
    return this.getVerticalTabsState();
  }

  toggleVerticalTabsCollapse() {
    this.verticalTabsCollapsed = !this.verticalTabsCollapsed;
    storage.updateSettings({ verticalTabsCollapsed: this.verticalTabsCollapsed });
    this.updateActiveViewBounds();
    this.notifyVerticalTabsState();
    return this.getVerticalTabsState();
  }

  setVerticalTabs(options = {}) {
    if (typeof options.enabled === 'boolean') {
      this.isVerticalTabs = options.enabled;
    }
    if (typeof options.collapsed === 'boolean') {
      this.verticalTabsCollapsed = options.collapsed;
    }
    if (typeof options.width === 'number') {
      this.verticalTabsWidth = Math.max(180, Math.min(450, options.width));
    }
    storage.updateSettings({
      verticalTabsEnabled: this.isVerticalTabs,
      verticalTabsCollapsed: this.verticalTabsCollapsed,
      verticalTabsWidth: this.verticalTabsWidth
    });
    this.updateActiveViewBounds();
    this.notifyVerticalTabsState();
    return this.getVerticalTabsState();
  }

  getVerticalTabsState() {
    return {
      enabled: this.isVerticalTabs,
      collapsed: this.verticalTabsCollapsed,
      width: this.verticalTabsWidth,
      collapsedWidth: this.verticalTabsCollapsedWidth,
      currentWidth: this.isVerticalTabs
        ? (this.verticalTabsCollapsed ? this.verticalTabsCollapsedWidth : this.verticalTabsWidth)
        : 0
    };
  }

  notifyVerticalTabsState() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('vertical-tabs-state-changed', this.getVerticalTabsState());
    }
  }

  startHibernationWatchdog() {
    if (this.sleepInterval) clearInterval(this.sleepInterval);

    this.sleepInterval = setInterval(() => {
      this.checkAndHibernateTabs();
    }, 20000); // Check every 20 seconds
  }

  checkAndHibernateTabs() {
    const settings = storage.getSettings();
    if (!settings.tabSleepEnabled) return;

    const timeoutMs = (settings.tabSleepMinutes || 10) * 60 * 1000;
    const now = Date.now();

    for (const [id, tab] of this.tabs.entries()) {
      if (id === this.activeTabId) continue; // Never hibernate active tab
      if (tab.isPinned) continue; // Don't hibernate pinned tabs
      if (tab.isSleeping) continue; // Already sleeping

      if (tab.view && tab.view.webContents) {
        // Don't hibernate if audio is playing (e.g. YouTube background music)
        if (tab.view.webContents.isCurrentlyAudible()) continue;

        if (now - tab.lastActive > timeoutMs) {
          this.hibernateTab(id);
        }
      }
    }
  }

  hibernateTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isSleeping || !tab.view) return;

    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.contentView && this.mainWindow.contentView.children.includes(tab.view)) {
        this.mainWindow.contentView.removeChildView(tab.view);
      }
      // Destroy webContents to release 100% RAM
      if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
      tab.view = null;
      tab.isSleeping = true;

      this.notifyTabsUpdate();
    } catch (e) {
      console.error(`Failed to hibernate tab ${tabId}:`, e);
    }
  }

  wakeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.isSleeping) return;

    tab.isSleeping = false;
    tab.view = this.createWebContentsView(tab.url);
    this.setupViewEvents(tab.id, tab.view);
    tab.lastActive = Date.now();

    if (tab.url && tab.url !== 'about:blank' && !tab.url.startsWith('eclipse://') && !tab.url.startsWith('blackhole://')) {
      tab.view.webContents.loadURL(tab.url);
    } else if (tab.url.startsWith('eclipse://newtab') || tab.url.startsWith('blackhole://newtab')) {
      this.loadInternalPage(tab.view, 'newtab');
    } else if (tab.url.startsWith('eclipse://history') || tab.url.startsWith('blackhole://history')) {
      this.loadInternalPage(tab.view, 'history');
    } else if (tab.url.startsWith('eclipse://downloads') || tab.url.startsWith('blackhole://downloads')) {
      this.loadInternalPage(tab.view, 'downloads');
    } else if (tab.url.startsWith('eclipse://incognito') || tab.url.startsWith('blackhole://incognito')) {
      this.loadInternalPage(tab.view, 'incognito');
    }
  }

  createWebContentsView(initialUrl) {
    const webPreferences = {
      preload: path.join(__dirname, '../preload/tabPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: true,
      autoplayPolicy: 'user-gesture-required'
    };

    if (this.isIncognito) {
      webPreferences.partition = 'incognito';
    }

    const view = new WebContentsView({ webPreferences });

    const isDark = nativeTheme.shouldUseDarkColors;
    const isInternal = initialUrl && (initialUrl.startsWith('eclipse://') || initialUrl.startsWith('blackhole://'));
    view.setBackgroundColor(isInternal ? (isDark ? '#0b0d14' : '#f8fafc') : '#ffffff');

    const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    view.webContents.setUserAgent(chromeUserAgent);

    // Handle new-window / target=_blank to open in new browser tab with flood/spam protection
    view.webContents.setWindowOpenHandler(({ url, disposition }) => {
      const trimmedUrl = (url && typeof url === 'string') ? url.trim() : '';
      if (trimmedUrl.startsWith('javascript:') || trimmedUrl.startsWith('data:')) {
        return { action: 'deny' };
      }

      const targetUrl = trimmedUrl || 'about:blank';

      // Filter known spam / popup domains
      const lower = targetUrl.toLowerCase();
      const shadyList = ['1xbet', '1x-bet', 'vulkan', 'pin-up', 'vavada', 'joycasino', 'refpa', 'ref-pa', 'popads', 'adsterra', 'clickadu', 'propeller', 'onclick', 'traffim', 'up-x', 'catcasino', 'spinbetter', '1win', 'betwinner', 'melbet', 'mostbet'];
      if (shadyList.some(s => lower.includes(s))) {
        console.log('[Black hole Shield] Blocked shady popup tab:', targetUrl);
        return { action: 'deny' };
      }

      // Check for external protocol (riotclient, steam, discord, tg, magnet, mailto, etc.)
      try {
        const parsed = new URL(targetUrl);
        const internalSchemes = ['http:', 'https:', 'eclipse:', 'blackhole:', 'about:', 'chrome:', 'file:'];
        if (!internalSchemes.includes(parsed.protocol)) {
          shell.openExternal(targetUrl).catch(() => {});
          return { action: 'deny' };
        }
      } catch (e) {
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('eclipse://') && !targetUrl.startsWith('blackhole://') && targetUrl !== 'about:blank') {
          shell.openExternal(targetUrl).catch(() => {});
          return { action: 'deny' };
        }
      }

      // Rate limit popup tabs to max 5 within 2 seconds per view
      const now = Date.now();
      if (!view._popupWindow) view._popupWindow = { start: now, count: 0 };
      if (now - view._popupWindow.start > 2000) {
        view._popupWindow = { start: now, count: 0 };
      }
      view._popupWindow.count++;
      if (view._popupWindow.count > 5) {
        console.warn('[Black hole Shield] Blocked excessive popup spam:', targetUrl);
        return { action: 'deny' };
      }

      this.createTab({ url: targetUrl, active: disposition !== 'background-tab', wasOpenedByScript: true });
      return { action: 'deny' };
    });

    return view;
  }

  injectAdBlockerToFrame(frame) {
    if (!frame || !adBlocker.enabled) return;
    try {
      const cosmeticCSS = `
        /* VK Video Ad Elements, Banners, Timers & Overlays */
        .videoplayer_ad, .videoplayer__ad, [class*="videoplayer_ad"], [class*="videoplayer__ad"],
        [id*="videoplayer_ad"], [id*="videoplayer__ad"],
        .videoplayer_ad_banner, .videoplayer_ad_overlay, .videoplayer_ad_timer,
        .videoplayer_ad_link, .videoplayer_ad_title, .videoplayer_ad_progress,
        .videoplayer_ad_header, .videoplayer_ad_action, .videoplayer_ad_box,
        .videoplayer_ad_content, .videoplayer_ad_creative, .videoplayer_ad_info,
        .videoplayer_ad_label, .videoplayer_ad_mark, .videoplayer_ad_wrap,
        .b-direct_banner, .b-direct-item, .ya-direct-item,
        [class*="erid" i], [class*="Erid" i], [class*="ERID" i],

        /* Yandex Translate & Yandex Portal Direct Banners */
        .sidebar-banner, .sidebar__banner, .translate-sidebar, .translate-sidebar__banner,
        .translator-banner, .translate-banner, .translate-page__banner,
        .b-direct, .b-direct__item, .b-direct_type_vertical, .b-direct__menu,
        .b-spec-adv, .b-banner, [data-bem*="sidebar-banner"], [data-bem*="b-direct"],
        [data-bem*="direct"], [class*="translate-sidebar"], [class*="sidebar-banner"],
        [class*="sidebar__banner"], [class*="translator__banner"],
        .yandex-adaptive-banner, .ya-partner, .ya-unit, [class*="ya-unit"],
        [id^="yandex_rtb_"], [id*="yandex_rtb"], [id^="ya_direct_"],
        [class*="ya-direct"], [class*="direct-item"], [class*="direct_item"],
        [class*="ya-partner"], div[data-bem*="direct"], div[data-bem*="yandex"],
        .direct_banner, .direct-banner, .ads-block, .banner-place,
        [class*="direct-ads"], [class*="yandex-ad"], .direct-widget,
        [data-ad-client], [data-ad-slot], [data-ya-widget], [data-ya-slot],
        [id^="adfox_"], [class*="adfox_"], [class*="rsya"], [id*="rsya"],
        div[data-ad], .ad-wrapper, .ad-box,
        [id*="adriver"], [class*="adriver"], [id*="mailru_ad"], [class*="mailru_ad"],

        /* Anime / Streaming Player Ads (Kodik, Alloha, VideoCDN, Sibnet, Voidboost, Collaps, Ashdi, Lumex, HDRezka) */
        .kodik-ad, .alloha-ad, .ad-container, .vast-ad, .vpaid-ad, .video-ad-overlay,
        .preroll-container, .preroll-ad, .ad-overlay, .player-ad-overlay,
        .vast-block, .vpaid-block, .ad-interstitial, .vjs-ad-playing,
        div[class*="clickunder"], div[id*="clickunder"], div[class*="popunder"],
        .kodik-overlay, .alloha-click-overlay, div[class*="ad_overlay"], div[id*="ad_overlay"],
        .adsbygoogle, iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"],
        .adblock-modal, .adblock-overlay, #adblock-message, .adblock-notice {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          height: 0 !important;
          min-height: 0 !important;
          width: 0 !important;
          pointer-events: none !important;
        }
      `;

      frame.insertCSS(cosmeticCSS, { cssOrigin: 'user' }).catch(() => {});
    } catch (err) {}
  }

  setupViewEvents(tabId, view) {
    const wc = view.webContents;
    this.applyWebColorScheme(wc);

    const handleExternalProtocol = (event, url) => {
      if (!url || typeof url !== 'string') return false;
      const trimmedUrl = url.trim();
      try {
        const parsed = new URL(trimmedUrl);
        const internalSchemes = ['http:', 'https:', 'eclipse:', 'blackhole:', 'about:', 'chrome:', 'file:', 'data:', 'blob:', 'javascript:'];
        if (!internalSchemes.includes(parsed.protocol)) {
          if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          shell.openExternal(trimmedUrl).catch(() => {});
          return true;
        }
      } catch (e) {
        if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('eclipse://') && !trimmedUrl.startsWith('blackhole://') && !trimmedUrl.startsWith('data:') && !trimmedUrl.startsWith('about:')) {
          if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          shell.openExternal(trimmedUrl).catch(() => {});
          return true;
        }
      }
      return false;
    };

    // Safely handle guest pages calling window.close()
    wc.on('close', () => {
      const tab = this.tabs.get(tabId);
      if (tab && !tab._isClosing && tab.wasOpenedByScript && this.tabs.size > 1) {
        setImmediate(() => {
          this.closeTab(tabId);
        });
      }
    });

    wc.on('render-process-gone', (event, details) => {
      console.warn(`[Black hole Shield] Tab ${tabId} render process exited:`, details);
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      tab.isLoading = false;
      this.notifyTabState(tabId);

      // If tab was put to sleep intentionally (hibernation), do NOT treat as crash or reload
      if (tab.isSleeping) return;

      const now = Date.now();
      tab._crashCount = (tab._crashCount || 0) + 1;
      tab._lastCrashTime = now;

      if (tab._crashCount <= 2) {
        setTimeout(() => {
          try {
            if (tab && !tab.isSleeping && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
              tab.view.webContents.reload();
            }
          } catch (e) {}
        }, 400);
      } else {
        console.warn(`[Black hole Shield] Tab ${tabId} exited multiple times. Putting to sleep to prevent browser crash.`);
        this.hibernateTab(tabId);
      }
    });

    wc.on('unresponsive', () => {
      console.warn(`[Black hole Shield] Tab ${tabId} became temporarily unresponsive`);
    });

    wc.on('will-navigate', (event, url) => {
      if (handleExternalProtocol(event, url)) {
        return;
      }
    });

    wc.on('will-redirect', (event, url) => {
      if (handleExternalProtocol(event, url)) {
        return;
      }
    });

    wc.on('frame-created', (event, { frame }) => {
      this.injectAdBlockerToFrame(frame);
    });

    wc.on('did-frame-finish-load', (event, isMainFrame, frameProcessId, frameRoutingId) => {
      try {
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
        if (frame) {
          this.injectAdBlockerToFrame(frame);
        }
      } catch (e) {}
    });

    wc.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && url) {
        this.applyWebColorScheme(wc);
        if (url.startsWith('eclipse://') || url.startsWith('blackhole://')) {
          const isDark = nativeTheme.shouldUseDarkColors;
          try { view.setBackgroundColor(isDark ? '#0b0d14' : '#f8fafc'); } catch(e) {}
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          try { view.setBackgroundColor('#ffffff'); } catch(e) {}
        }
      }
      if (isMainFrame && !isInPlace) {
        const tab = this.tabs.get(tabId);
        if (tab) {
          tab._isMainFrameNavigating = true;
          if (!tab.isLoading) {
            tab.isLoading = true;
            this.notifyTabState(tabId);
          }
        }
      }
    });

    wc.on('did-start-loading', () => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        const isMainLoading = (typeof wc.isLoadingMainFrame === 'function' ? wc.isLoadingMainFrame() : false) || Boolean(tab._isMainFrameNavigating);
        if (isMainLoading) {
          if (!tab.isLoading) {
            tab.isLoading = true;
            this.notifyTabState(tabId);
          }
        }
      }
    });

    const getCanGoBack = () => (wc.navigationHistory ? wc.navigationHistory.canGoBack() : (wc.canGoBack ? wc.canGoBack() : false));
    const getCanGoForward = () => (wc.navigationHistory ? wc.navigationHistory.canGoForward() : (wc.canGoForward ? wc.canGoForward() : false));

    wc.on('did-stop-loading', () => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        const stillLoadingMain = typeof wc.isLoadingMainFrame === 'function' ? wc.isLoadingMainFrame() : false;
        if (!stillLoadingMain) {
          tab._isMainFrameNavigating = false;
          const wasLoading = tab.isLoading;
          tab.isLoading = false;
          tab.canGoBack = getCanGoBack();
          tab.canGoForward = getCanGoForward();
          if (wasLoading) {
            this.notifyTabState(tabId);
          }
        }
      }
    });

    wc.on('did-finish-load', () => {
      this.applyWebColorScheme(wc);
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab._isMainFrameNavigating = false;
        if (tab.isLoading) {
          tab.isLoading = false;
          tab.canGoBack = getCanGoBack();
          tab.canGoForward = getCanGoForward();
          this.notifyTabState(tabId);
        }
      }
      if (!this.isIncognito && tab && tab.url && tab.url.startsWith('http')) {
        const saved = storage.getPasswordsForOrigin(tab.url);
        if (saved && saved.length > 0) {
          wc.send('fill-credentials', saved);
        }
      }
    });

    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        const tab = this.tabs.get(tabId);
        if (tab) {
          tab._isMainFrameNavigating = false;
          if (tab.isLoading) {
            tab.isLoading = false;
            tab.canGoBack = getCanGoBack();
            tab.canGoForward = getCanGoForward();
            this.notifyTabState(tabId);
          }
        }
      }
    });

    wc.on('page-title-updated', (event, title) => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.title = title || (this.isIncognito ? 'Инкогнито' : 'Новая вкладка');
        if (!this.isIncognito && tab.url && !tab.url.startsWith('eclipse://')) {
          storage.addHistory({
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon
          });
        }
        this.notifyTabState(tabId);
      }
    });

    wc.on('page-favicon-updated', (event, favicons) => {
      const tab = this.tabs.get(tabId);
      if (tab && favicons && favicons.length > 0) {
        tab.favicon = favicons[0];
        this.notifyTabState(tabId);
      }
    });

    wc.on('did-navigate', (event, url) => {
      adBlocker.resetTabStats(wc.id);
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.url = url;
        tab.canGoBack = getCanGoBack();
        tab.canGoForward = getCanGoForward();
        this.notifyTabState(tabId);
      }
    });

    wc.on('did-navigate-in-page', (event, url) => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.url = url;
        tab.canGoBack = getCanGoBack();
        tab.canGoForward = getCanGoForward();
        this.notifyTabState(tabId);
      }
    });

    wc.on('media-started-playing', () => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.isPlayingAudio = true;
        this.notifyTabState(tabId);
      }
    });

    wc.on('media-paused', () => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.isPlayingAudio = false;
        this.notifyTabState(tabId);
      }
    });

    // HTML5 Fullscreen (YouTube, VK, Twitch, HTML5 video fullscreen)
    wc.on('enter-html-full-screen', () => {
      this.isHtmlFullScreen = true;
      this.activeFullScreenTabId = tabId;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.setFullScreen(true);
        this.mainWindow.webContents.send('html-full-screen-state', true);
      }
      this.updateActiveViewBounds();
    });

    wc.on('leave-html-full-screen', () => {
      this.isHtmlFullScreen = false;
      this.activeFullScreenTabId = null;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.setFullScreen(false);
        this.mainWindow.webContents.send('html-full-screen-state', false);
      }
      this.updateActiveViewBounds();
    });

    // Handle browser shortcuts even when WebContents has input focus
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;

      const isCtrl = Boolean(input.control || input.meta);
      const isAlt = Boolean(input.alt);
      const isShift = Boolean(input.shift);
      const code = input.code || '';
      const key = (input.key || '').toLowerCase();

      // Escape: Exit HTML5 fullscreen
      if (code === 'Escape' || key === 'escape') {
        if (this.isHtmlFullScreen) {
          event.preventDefault();
          wc.executeJavaScript('if (document.fullscreenElement) { document.exitFullscreen(); }').catch(() => {});
          return;
        }
      }

      // Helper function to normalize key and match against configured shortcuts
      const matchShortcutAction = () => {
        const cyrillicToLatin = {
          'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p',
          'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l',
          'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`'
        };

        let primaryChar = '';
        if (code.startsWith('Key')) {
          primaryChar = code.replace('Key', '').toLowerCase();
        } else if (code.startsWith('Digit')) {
          primaryChar = code.replace('Digit', '');
        } else if (code.startsWith('Numpad') && /Numpad[0-9]/.test(code)) {
          primaryChar = code.replace('Numpad', '');
        } else if (/^f[1-9][0-2]?$/i.test(key) || /^f[1-9][0-2]?$/i.test(code)) {
          primaryChar = (code || key).toLowerCase();
        } else if (code === 'Escape' || key === 'escape') {
          primaryChar = 'escape';
        } else if (code === 'Delete' || key === 'delete') {
          primaryChar = 'delete';
        } else if (code === 'Tab' || key === 'tab') {
          primaryChar = 'tab';
        } else if (code === 'Minus' || key === '-' || key === '_') {
          primaryChar = '-';
        } else if (code === 'Equal' || key === '=' || key === '+') {
          primaryChar = '=';
        } else if (code === 'Comma' || key === ',' || key === '<' || key === 'б') {
          primaryChar = ',';
        } else if (code === 'Period' || key === '.' || key === '>' || key === 'ю') {
          primaryChar = '.';
        } else {
          primaryChar = cyrillicToLatin[key] || key;
        }

        const shortcuts = storage.getShortcuts();
        for (const sc of shortcuts) {
          if (!sc.key) continue;

          if (sc.id === 'tab-digits' || sc.key === 'Ctrl+1..9') {
            if (isCtrl && !isAlt && !isShift && /^[1-9]$/.test(primaryChar)) {
              return sc.enabled ? { id: 'tab-digits', digit: parseInt(primaryChar, 10) } : { disabled: true };
            }
            continue;
          }

          const parts = sc.key.split('+').map(p => p.trim().toLowerCase());
          const needsCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('cmdorctrl');
          const needsAlt = parts.includes('alt');
          const needsShift = parts.includes('shift');
          const keyPart = parts.filter(p => !['ctrl', 'cmd', 'cmdorctrl', 'alt', 'shift', 'meta'].includes(p)).join('+');

          if (Boolean(isCtrl) !== Boolean(needsCtrl)) continue;
          if (Boolean(isAlt) !== Boolean(needsAlt)) continue;
          if (Boolean(isShift) !== Boolean(needsShift)) continue;

          const targetKey = keyPart.toLowerCase();
          let keyMatches = false;
          if (targetKey === '=' || targetKey === '+') {
            keyMatches = (primaryChar === '=' || primaryChar === '+');
          } else if (targetKey === '-' || targetKey === '_') {
            keyMatches = (primaryChar === '-');
          } else {
            keyMatches = (primaryChar === targetKey);
          }

          if (keyMatches) {
            return sc.enabled ? { id: sc.id } : { disabled: true };
          }
        }
        return null;
      };

      const matched = matchShortcutAction();
      if (!matched) return;
      if (matched.disabled) {
        // Explicitly disabled by the user toggle!
        return;
      }

      // Execute enabled shortcut action
      event.preventDefault();
      switch (matched.id) {
        case 'new-tab':
          this.createTab({ url: this.isIncognito ? 'eclipse://incognito' : 'eclipse://newtab', active: true });
          break;
        case 'close-tab':
          this.closeTab(tabId);
          break;
        case 'restore-tab':
          this.restoreLastClosedTab();
          break;
        case 'new-incognito':
          if (global.createIncognitoWindow) global.createIncognitoWindow();
          break;
        case 'next-tab':
          this.switchToNextTab();
          break;
        case 'prev-tab':
          this.switchToPrevTab();
          break;
        case 'duplicate-tab':
          this.duplicateTab(tabId);
          break;
        case 'new-window':
          if (global.createBrowserWindow) {
            global.createBrowserWindow({
              initialUrl: this.isIncognito ? 'eclipse://incognito' : 'eclipse://newtab',
              isIncognito: this.isIncognito,
              isSecondaryWindow: true
            });
          }
          break;
        case 'move-tab-new-window':
          this.moveTabToNewWindow(tabId);
          break;
        case 'split-screen':
          this.toggleSplitScreen();
          break;
        case 'toggle-vertical-tabs':
          this.toggleVerticalTabs();
          break;
        case 'tab-digits':
          if (matched.digit) this.switchToTabIndex(matched.digit - 1);
          break;
        case 'reload-page':
          wc.reload();
          break;
        case 'hard-reload':
          wc.reloadIgnoringCache();
          break;
        case 'focus-omnibox':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('focus-omnibox');
          }
          break;
        case 'find-in-page':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-find-shortcut');
          }
          break;
        case 'zoom-in':
          this.zoomIn(tabId);
          break;
        case 'zoom-out':
          this.zoomOut(tabId);
          break;
        case 'zoom-reset':
          this.zoomReset(tabId);
          break;
        case 'fullscreen':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          }
          break;
        case 'open-history':
          this.createTab({ url: 'eclipse://history', active: true });
          break;
        case 'open-downloads':
          this.createTab({ url: 'eclipse://downloads', active: true });
          break;
        case 'open-bookmarks':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-bookmarks');
          }
          break;
        case 'bookmark-page':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-bookmark-shortcut');
          }
          break;
        case 'toggle-bookmarks-bar':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-toggle-bookmarks-bar');
          }
          break;
        case 'open-settings':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-settings');
          }
          break;
        case 'open-passwords':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-passwords');
          }
          break;
        case 'open-extensions':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-extensions');
          }
          break;
        case 'toggle-shield':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-shield');
          }
          break;
        case 'toggle-pip':
          this.togglePictureInPicture(tabId);
          break;
        case 'clear-cache':
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('trigger-clear-cache');
          }
          break;
        case 'devtools':
          wc.toggleDevTools();
          break;
      }
    });

    // Context menu for web contents
    wc.on('context-menu', (event, params) => {
      this.showContextMenu(wc, params, tabId);
    });
  }

  initMediaIpcHandlers() {
    ipcMain.on('context-media-detected', (event, mediaInfo) => {
      try {
        if (event && event.sender) {
          this.tabMediaMap.set(event.sender.id, mediaInfo);
        }
      } catch (e) {}
    });

    ipcMain.on('save-converted-image-buffer', (event, { dataUrl, filename, format, width, height }) => {
      try {
        const fs = require('fs');
        const downloadsDir = app.getPath('downloads');
        const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) return;

        const buffer = Buffer.from(match[2], 'base64');
        const cleanName = this.sanitizeFilename(filename, `image.${format || 'png'}`);
        const finalPath = this.getUniqueFilePath(downloadsDir, cleanName);

        fs.writeFileSync(finalPath, buffer);
        this.showNotification(
          '✅ Изображение сохранено',
          `Файл «${path.basename(finalPath)}» (${width}×${height} px) сохранён в папку Загрузки.`
        );
      } catch (err) {
        console.error('[Eclipse] Save image error:', err);
      }
    });

    ipcMain.on('download-direct-url', (event, { url, filename }) => {
      this.downloadDirectMedia(event.sender, url, filename);
    });

    ipcMain.on('collect-page-images-response', async (event, { pageTitle, images }) => {
      try {
        const fs = require('fs');
        const AdmZip = require('adm-zip');
        const downloadsDir = app.getPath('downloads');

        if (!images || images.length === 0) {
          this.showNotification('Медиа', 'На текущей странице не найдено подходящих изображений.');
          return;
        }

        this.showNotification('Архивация', `Загрузка ${images.length} изображений в ZIP архив...`);

        const zip = new AdmZip();
        let downloadedCount = 0;

        const fetchPromises = images.map(async (imgItem, idx) => {
          try {
            const res = await fetch(imgItem.src);
            if (!res.ok) return;
            const ab = await res.arrayBuffer();
            const buffer = Buffer.from(ab);

            let ext = path.extname(new URL(imgItem.src).pathname) || '.jpg';
            if (!ext || ext.length > 5 || ext.includes('?')) ext = '.jpg';

            const indexStr = String(idx + 1).padStart(2, '0');
            const imgName = `image_${indexStr}${ext}`;

            zip.addFile(imgName, buffer);
            downloadedCount++;
          } catch (e) {}
        });

        await Promise.all(fetchPromises);

        if (downloadedCount === 0) {
          this.showNotification('Ошибка', 'Не удалось скачать изображения со страницы.');
          return;
        }

        const zipFilename = this.sanitizeFilename(`${pageTitle}_images.zip`, 'images.zip');
        const finalZipPath = this.getUniqueFilePath(downloadsDir, zipFilename);

        zip.writeZip(finalZipPath);
        this.showNotification(
          '🎉 Архив готов!',
          `Успешно скачано ${downloadedCount} изображений в файл «${path.basename(finalZipPath)}».`
        );
      } catch (err) {
        console.error('[Eclipse] Zip images error:', err);
      }
    });
  }

  showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: `Black hole Browser • ${title}`,
          body: body || '',
          icon: path.join(__dirname, '../../icon.png'),
          silent: false
        });
        notif.show();
      }
    } catch (e) {}
  }

  getUniqueFilePath(dir, filename) {
    const fs = require('fs');
    let target = path.join(dir, filename);
    if (!fs.existsSync(target)) return target;

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let counter = 1;
    while (fs.existsSync(path.join(dir, `${base} (${counter})${ext}`))) {
      counter++;
    }
    return path.join(dir, `${base} (${counter})${ext}`);
  }

  sanitizeFilename(name, fallback = 'file') {
    if (!name) return fallback;
    let clean = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    if (clean.length > 90) clean = clean.substring(0, 90).trim();
    return clean || fallback;
  }

  async downloadDirectMedia(wc, url, suggestedName) {
    if (!url) return;
    const fs = require('fs');
    const downloadsDir = app.getPath('downloads');

    this.showNotification('Загрузка файла', `Начато скачивание: ${suggestedName}`);

    try {
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.*)$/);
        if (match) {
          const mime = match[1];
          const ext = mime.includes('png') ? '.png' : (mime.includes('webp') ? '.webp' : (mime.includes('gif') ? '.gif' : '.jpg'));
          const buffer = Buffer.from(match[2], 'base64');
          const finalPath = this.getUniqueFilePath(downloadsDir, `${suggestedName}${ext}`);
          fs.writeFileSync(finalPath, buffer);
          this.showNotification('✅ Успешно сохранено', `Файл сохранён в Загрузки: ${path.basename(finalPath)}`);
          return;
        }
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      let ext = path.extname(new URL(url).pathname) || '';
      if (!ext || ext.length > 5 || ext.includes('?')) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('image/png')) ext = '.png';
        else if (contentType.includes('image/webp')) ext = '.webp';
        else if (contentType.includes('image/gif')) ext = '.gif';
        else if (contentType.includes('image/svg')) ext = '.svg';
        else if (contentType.includes('video/mp4')) ext = '.mp4';
        else if (contentType.includes('video/webm')) ext = '.webm';
        else ext = '.jpg';
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = suggestedName.endsWith(ext) ? suggestedName : `${suggestedName}${ext}`;
      const finalPath = this.getUniqueFilePath(downloadsDir, filename);

      fs.writeFileSync(finalPath, buffer);
      this.showNotification('✅ Успешно скачано', `Файл сохранён в папку Загрузки: ${path.basename(finalPath)}`);
    } catch (err) {
      console.warn('[Eclipse] Direct media download error, fallback to session download:', err);
      try {
        session.defaultSession.downloadURL(url);
      } catch (e) {}
    }
  }

  downloadConvertedImage(wc, url, format, scale, filename) {
    if (!wc || !url) return;
    this.showNotification('Обработка изображения', `Конвертация и масштабирование (${format.toUpperCase()}, ${scale}x)...`);
    wc.send('render-and-convert-image', {
      url,
      format,
      scale,
      filename: this.sanitizeFilename(filename, `image.${format}`)
    });
  }

  async downloadVideoWithQuality(wc, { tab, tabMedia, quality, format }) {
    const fs = require('fs');
    const downloadsDir = app.getPath('downloads');
    const videoTitle = this.sanitizeFilename(tabMedia?.title || tab?.title || 'video', 'video');
    const isAudio = quality === 'audio';
    const ext = isAudio ? (format === 'm4a' ? '.m4a' : '.mp3') : '.mp4';
    const qualityLabel = isAudio ? 'MP3_Audio' : (quality.toUpperCase());

    this.showNotification('Загрузка видео', `Начато скачивание «${videoTitle}» (${qualityLabel})...`);

    const pageUrl = (tab && tab.url) ? tab.url : (tabMedia?.pageUrl || '');
    const isYouTube = pageUrl.includes('youtube.com/watch') || pageUrl.includes('youtu.be') || Boolean(tabMedia?.isYouTube);

    if (isYouTube) {
      try {
        const ytData = await wc.executeJavaScript(`
          (function() {
            try {
              let resp = window.ytInitialPlayerResponse;
              if (!resp) {
                const player = document.getElementById('movie_player');
                if (player && typeof player.getPlayerResponse === 'function') {
                  resp = player.getPlayerResponse();
                }
              }
              if (resp && resp.streamingData) {
                return {
                  title: resp.videoDetails ? resp.videoDetails.title : document.title,
                  formats: resp.streamingData.formats || [],
                  adaptiveFormats: resp.streamingData.adaptiveFormats || []
                };
              }
            } catch (e) {}
            return null;
          })();
        `);

        if (ytData && ytData.formats && ytData.formats.length > 0) {
          let targetStream = null;

          if (isAudio) {
            const audioFormats = (ytData.adaptiveFormats || []).filter(f => (f.mimeType && f.mimeType.includes('audio')));
            audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            targetStream = audioFormats[0] || ytData.formats[0];
          } else if (quality === '720p') {
            targetStream = ytData.formats.find(f => f.qualityLabel === '720p' || f.itag === 22) || ytData.formats[0];
          } else if (quality === '360p') {
            targetStream = ytData.formats.find(f => f.qualityLabel === '360p' || f.itag === 18) || ytData.formats[0];
          } else if (quality === '1080p') {
            const vid1080 = (ytData.adaptiveFormats || []).find(f => f.qualityLabel && f.qualityLabel.includes('1080'));
            targetStream = vid1080 || ytData.formats.find(f => f.qualityLabel === '720p') || ytData.formats[0];
          } else {
            targetStream = ytData.formats[0];
          }

          if (targetStream && targetStream.url) {
            const finalFilename = `${this.sanitizeFilename(ytData.title || videoTitle, 'video')}_${qualityLabel}${ext}`;
            await this.downloadDirectMedia(wc, targetStream.url, finalFilename);
            return;
          }
        }
      } catch (ytErr) {
        console.warn('[Eclipse] YouTube stream extract attempt:', ytErr.message);
      }
    }

    const directUrl = tabMedia?.url;
    if (directUrl && directUrl.startsWith('http') && !directUrl.startsWith('blob:')) {
      const finalFilename = `${videoTitle}_${qualityLabel}${ext}`;
      await this.downloadDirectMedia(wc, directUrl, finalFilename);
      return;
    }

    this.showNotification('Готово', `Ссылка на видеопоток скопирована в буфер: ${pageUrl || directUrl}`);
    clipboard.writeText(pageUrl || directUrl || '');
  }

  async downloadAllImagesZip(wc) {
    if (!wc) return;
    this.showNotification('Сбор изображений', 'Сканирование и упаковка всех изображений со страницы...');
    wc.send('collect-page-images-request');
  }

  showContextMenu(wc, params, tabId) {
    const menu = new Menu();
    const tab = this.tabs.get(tabId || this.activeTabId);
    const tabMedia = this.tabMediaMap.get(wc.id) || {};

    const isImage = Boolean(params.hasImageContents || params.mediaType === 'image' || tabMedia.type === 'image');
    const imageUrl = tabMedia.url || params.srcURL;

    const isVideo = Boolean(
      params.mediaType === 'video' ||
      tabMedia.type === 'video' ||
      (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be') || tab.url.includes('vk.com/video'))) ||
      tabMedia.hasVideo
    );
    const videoUrl = tabMedia.url || params.srcURL || (tab ? tab.url : '');
    const videoTitle = this.sanitizeFilename(tabMedia.title || (tab ? tab.title : '') || 'video', 'video');
    const imageTitle = this.sanitizeFilename(tabMedia.alt || tabMedia.title || (tab ? tab.title : '') || 'image', 'image');

    // --- 1. Link Actions ---
    if (params.linkURL) {
      menu.append(new MenuItem({
        label: '🔗 Открыть ссылку в новой вкладке',
        click: () => this.createTab({ url: params.linkURL, active: true })
      }));
      menu.append(new MenuItem({
        label: '🪟 Открыть ссылку в новом окне',
        click: () => {
          if (global.createBrowserWindow) {
            global.createBrowserWindow({
              initialUrl: params.linkURL,
              isIncognito: this.isIncognito,
              isSecondaryWindow: true
            });
          }
        }
      }));
      menu.append(new MenuItem({
        label: '🕶️ Открыть ссылку в окне инкогнито',
        click: () => {
          if (global.createIncognitoWindow) {
            global.createIncognitoWindow(params.linkURL);
          }
        }
      }));
      menu.append(new MenuItem({
        label: '📋 Копировать адрес ссылки',
        click: () => clipboard.writeText(params.linkURL)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // --- 2. Image Actions with Quality Selection ---
    if (isImage && imageUrl) {
      const imgMenu = new Menu();

      const resLabel = (tabMedia.naturalWidth && tabMedia.naturalHeight)
        ? ` (${tabMedia.naturalWidth} × ${tabMedia.naturalHeight})`
        : '';
      imgMenu.append(new MenuItem({
        label: `🌟 Исходное качество (Оригинал)${resLabel}`,
        click: () => this.downloadDirectMedia(wc, imageUrl, `${imageTitle}_original`)
      }));

      imgMenu.append(new MenuItem({ type: 'separator' }));

      imgMenu.append(new MenuItem({
        label: '🖼️ В формате PNG (Без сжатия, кристальная четкость)',
        click: () => this.downloadConvertedImage(wc, imageUrl, 'png', 1, `${imageTitle}.png`)
      }));

      imgMenu.append(new MenuItem({
        label: '🎨 В формате JPG (100% максимальное качество)',
        click: () => this.downloadConvertedImage(wc, imageUrl, 'jpeg', 1, `${imageTitle}.jpg`)
      }));

      imgMenu.append(new MenuItem({
        label: '⚡ В формате WebP (Компактный размер)',
        click: () => this.downloadConvertedImage(wc, imageUrl, 'webp', 1, `${imageTitle}.webp`)
      }));

      imgMenu.append(new MenuItem({ type: 'separator' }));

      imgMenu.append(new MenuItem({
        label: '🔍 2x Super-Resolution Увеличение (200%)',
        click: () => this.downloadConvertedImage(wc, imageUrl, 'png', 2, `${imageTitle}_2x_upscale.png`)
      }));

      imgMenu.append(new MenuItem({
        label: '🔍 4x Ultra HD Увеличение (400% / 4K)',
        click: () => this.downloadConvertedImage(wc, imageUrl, 'png', 4, `${imageTitle}_4k_upscale.png`)
      }));

      menu.append(new MenuItem({
        label: '📥 Скачать изображение с выбором качества',
        submenu: imgMenu
      }));

      menu.append(new MenuItem({
        label: '📋 Копировать изображение',
        click: () => {
          try { wc.copyImageAt(params.x, params.y); } catch (e) {}
        }
      }));

      menu.append(new MenuItem({
        label: '🔗 Копировать адрес изображения',
        click: () => clipboard.writeText(imageUrl)
      }));

      menu.append(new MenuItem({
        label: '🌐 Открыть изображение в новой вкладке',
        click: () => this.createTab({ url: imageUrl, active: true })
      }));

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // --- 3. Video Actions with Quality Selection ---
    if (isVideo) {
      const vidMenu = new Menu();

      vidMenu.append(new MenuItem({
        label: '🎬 1080p Full HD (MP4, 1920×1080)',
        click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '1080p', format: 'mp4' })
      }));

      vidMenu.append(new MenuItem({
        label: '🎬 720p HD (MP4, 1280×720)',
        click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '720p', format: 'mp4' })
      }));

      vidMenu.append(new MenuItem({
        label: '🎬 480p SD (MP4, 854×480)',
        click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '480p', format: 'mp4' })
      }));

      vidMenu.append(new MenuItem({
        label: '🎬 360p (MP4, компактный размер)',
        click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '360p', format: 'mp4' })
      }));

      vidMenu.append(new MenuItem({ type: 'separator' }));

      vidMenu.append(new MenuItem({
        label: '🎵 Только аудио MP3 (320 kbps)',
        click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: 'audio', format: 'mp3' })
      }));

      vidMenu.append(new MenuItem({
        label: '🎵 Аудио M4A / AAC (Оригинал)',
        click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: 'audio', format: 'm4a' })
      }));

      vidMenu.append(new MenuItem({ type: 'separator' }));

      vidMenu.append(new MenuItem({
        label: '🔗 Скопировать ссылку на видео',
        click: () => clipboard.writeText(videoUrl || (tab ? tab.url : ''))
      }));

      menu.append(new MenuItem({
        label: '📥 Скачать видео с выбором качества',
        submenu: vidMenu
      }));

      menu.append(new MenuItem({
        label: '📺 Картинка в картинке',
        accelerator: 'Alt+P',
        click: () => wc.send('toggle-pip')
      }));

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // --- 4. Selection / Text Search ---
    if (params.selectionText) {
      const query = params.selectionText.trim();
      menu.append(new MenuItem({
        label: `🔍 Искать «${query.length > 25 ? query.substring(0, 22) + '...' : query}»`,
        click: () => {
          const engine = storage.getSettings().searchEngine || 'google';
          const searchUrls = {
            google: 'https://www.google.com/search?q=',
            yandex: 'https://ya.ru/search/?text=',
            duckduckgo: 'https://duckduckgo.com/?q=',
            bing: 'https://www.bing.com/search?q='
          };
          const base = searchUrls[engine] || searchUrls.google;
          this.createTab({ url: base + encodeURIComponent(query), active: true });
        }
      }));
      menu.append(new MenuItem({
        label: 'Копировать',
        role: 'copy'
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // --- 5. Editable / Input Fields ---
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Вставить', role: 'paste' }));
      menu.append(new MenuItem({ label: 'Вырезать', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Выделить всё', role: 'selectAll' }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // --- 6. Page Media Submenu (if not directly on image/video) ---
    if (!isImage && !isVideo) {
      const pageMediaMenu = new Menu();

      pageMediaMenu.append(new MenuItem({
        label: '🖼️ Скачать все изображения со страницы (.ZIP архив)',
        click: () => this.downloadAllImagesZip(wc)
      }));

      if (tabMedia.hasVideo || (tab && tab.url && (tab.url.includes('youtube.com') || tab.url.includes('youtu.be')))) {
        const pageVidMenu = new Menu();
        pageVidMenu.append(new MenuItem({
          label: '🎬 1080p Full HD (MP4)',
          click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '1080p', format: 'mp4' })
        }));
        pageVidMenu.append(new MenuItem({
          label: '🎬 720p HD (MP4)',
          click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '720p', format: 'mp4' })
        }));
        pageVidMenu.append(new MenuItem({
          label: '🎬 480p SD (MP4)',
          click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: '480p', format: 'mp4' })
        }));
        pageVidMenu.append(new MenuItem({
          label: '🎵 Только аудио MP3',
          click: () => this.downloadVideoWithQuality(wc, { tab, tabMedia, quality: 'audio', format: 'mp3' })
        }));

        pageMediaMenu.append(new MenuItem({
          label: '🎬 Скачать видео со страницы',
          submenu: pageVidMenu
        }));
      }

      menu.append(new MenuItem({
        label: '📥 Скачать медиа со страницы',
        submenu: pageMediaMenu
      }));

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // --- 7. Standard Navigation & DevTools ---
    const canBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : (wc.canGoBack ? wc.canGoBack() : false);
    const canFwd = wc.navigationHistory ? wc.navigationHistory.canGoForward() : (wc.canGoForward ? wc.canGoForward() : false);

    menu.append(new MenuItem({
      label: 'Назад',
      enabled: canBack,
      click: () => wc.goBack()
    }));
    menu.append(new MenuItem({
      label: 'Вперед',
      enabled: canFwd,
      click: () => wc.goForward()
    }));
    menu.append(new MenuItem({
      label: 'Перезагрузить',
      click: () => wc.reload()
    }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: 'Просмотреть код',
      click: () => wc.inspectElement(params.x, params.y)
    }));

    menu.popup();
  }

  loadInternalPage(view, page) {
    try { view.setBackgroundColor('#0b0d14'); } catch(e) {}
    if (page === 'newtab') {
      const newtabPath = path.join(__dirname, '../renderer/newtab.html');
      view.webContents.loadFile(newtabPath);
    } else if (page === 'incognito') {
      const incognitoPath = path.join(__dirname, '../renderer/incognito.html');
      view.webContents.loadFile(incognitoPath);
    } else if (page === 'history') {
      const historyPath = path.join(__dirname, '../renderer/history.html');
      view.webContents.loadFile(historyPath);
    } else if (page === 'downloads') {
      const downloadsPath = path.join(__dirname, '../renderer/downloads.html');
      view.webContents.loadFile(downloadsPath);
    }
  }

  createTab(options = {}) {
    const id = 'tab_' + this.nextTabId++;
    const defaultUrl = this.isIncognito ? 'eclipse://incognito' : 'eclipse://newtab';
    let url = options.url || defaultUrl;
    const active = options.active !== false;
    const isSleeping = Boolean(options.isSleeping && !active);

    let view = null;
    if (!isSleeping) {
      view = this.createWebContentsView(url);
    }

    let defaultTitle = 'Новая вкладка';
    if (this.isIncognito) {
      defaultTitle = 'Режим инкогнито';
    } else if (url.startsWith('eclipse://history') || url.startsWith('blackhole://history') || url.startsWith('chrome://history') || url.startsWith('about:history')) {
      defaultTitle = 'История';
    } else if (url.startsWith('eclipse://downloads') || url.startsWith('blackhole://downloads') || url.startsWith('chrome://downloads') || url.startsWith('about:downloads')) {
      defaultTitle = 'Загрузки';
    }

    const tab = {
      id,
      title: options.title || (url.startsWith('eclipse://') || url.startsWith('blackhole://') || url.startsWith('chrome://') || url.startsWith('about:') ? defaultTitle : 'Вкладка'),
      url,
      favicon: options.favicon || '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isMuted: false,
      isPinned: Boolean(options.isPinned),
      groupId: options.groupId || null,
      isSleeping: isSleeping,
      isPlayingAudio: false,
      lastActive: Date.now(),
      wasOpenedByScript: Boolean(options.wasOpenedByScript),
      view
    };

    this.tabs.set(id, tab);

    if (view) {
      this.setupViewEvents(id, view);

      if (url.startsWith('eclipse://incognito') || url.startsWith('blackhole://incognito') || url.startsWith('chrome://incognito') || url.startsWith('about:incognito')) {
        this.loadInternalPage(view, 'incognito');
      } else if (url.startsWith('eclipse://newtab') || url.startsWith('blackhole://newtab') || url.startsWith('chrome://newtab') || url.startsWith('about:newtab')) {
        this.loadInternalPage(view, 'newtab');
      } else if (url.startsWith('eclipse://history') || url.startsWith('blackhole://history') || url.startsWith('chrome://history') || url.startsWith('about:history')) {
        this.loadInternalPage(view, 'history');
      } else if (url.startsWith('eclipse://downloads') || url.startsWith('blackhole://downloads') || url.startsWith('chrome://downloads') || url.startsWith('about:downloads')) {
        this.loadInternalPage(view, 'downloads');
      } else if (url && url !== 'about:blank') {
        view.webContents.loadURL(url).catch(err => {
          console.warn('Navigation error:', err.message);
        });
      }
    }

    if (active) {
      this.switchTab(id);
    } else {
      this.notifyTabsUpdate();
    }

    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      isLoading: tab.isLoading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isMuted: tab.isMuted,
      isPinned: tab.isPinned,
      groupId: tab.groupId,
      isSleeping: tab.isSleeping,
      isPlayingAudio: tab.isPlayingAudio,
      isActive: tab.id === this.activeTabId
    };
  }

  switchTab(tabId) {
    if (this.isSplitScreen && tabId === this.splitTabId) {
      this.swapSplitTabs();
      return;
    }

    const prevActiveId = this.activeTabId;
    const currentTab = this.tabs.get(prevActiveId);
    if (currentTab && currentTab.view) {
      currentTab.lastActive = Date.now();

      // PiP Pro: Auto-PiP on tab switch if leaving a tab with playing video
      const settings = storage.getSettings ? storage.getSettings() : {};
      if (settings.pipAutoTabSwitch !== false && (!this.isSplitScreen || this.splitTabId !== prevActiveId)) {
        try {
          if (currentTab.view.webContents && !currentTab.view.webContents.isDestroyed()) {
            currentTab.view.webContents.send('pip-auto-enter');
          }
        } catch (e) {}
      }

      try {
        if (typeof currentTab.view.setVisible === 'function') {
          currentTab.view.setVisible(false);
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.contentView && this.mainWindow.contentView.children.includes(currentTab.view)) {
          this.mainWindow.contentView.removeChildView(currentTab.view);
        }
      } catch (e) {
        console.warn('Error removing child view in switchTab:', e);
      }
    }

    const nextTab = this.tabs.get(tabId);
    if (!nextTab) return;

    this.activeTabId = tabId;
    nextTab.lastActive = Date.now();

    // PiP Pro: Return video from auto-PiP when returning to tab
    try {
      if (nextTab.view && nextTab.view.webContents && !nextTab.view.webContents.isDestroyed()) {
        nextTab.view.webContents.send('pip-auto-exit');
      }
    } catch (e) {}

    if (nextTab.isSleeping) {
      this.wakeTab(tabId);
    }

    try {
      if (nextTab.view) {
        if (typeof nextTab.view.setVisible === 'function') {
          nextTab.view.setVisible(true);
        }
      }
      if (!this.isModalOpen && nextTab.view && this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.contentView && !this.mainWindow.contentView.children.includes(nextTab.view)) {
        this.mainWindow.contentView.addChildView(nextTab.view);
      }
    } catch (e) {
      console.warn('Error adding child view in switchTab:', e);
    }

    this.updateActiveViewBounds();
    this.notifyTabsUpdate();
    this.notifyTabState(tabId);
  }

  setAllViewsMinimized(isMinimized) {
    for (const [id, tab] of this.tabs.entries()) {
      if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        try {
          if (typeof tab.view.setVisible === 'function') {
            tab.view.setVisible(!isMinimized && id === this.activeTabId);
          }
        } catch (e) {}
      }
    }
  }

  closeTab(tabId) {
    if (this.isSplitScreen) {
      if (tabId === this.splitTabId) {
        this.disableSplitScreen();
      } else if (tabId === this.activeTabId && this.splitTabId) {
        const nextActive = this.splitTabId;
        this.disableSplitScreen();
        this.closeTab(tabId);
        if (this.tabs.has(nextActive)) {
          this.switchTab(nextActive);
        }
        return;
      }
    }

    const tab = this.tabs.get(tabId);
    if (!tab || tab._isClosing) return;
    tab._isClosing = true;

    // Immediately remove from tab map so no lookups or recursive events can target it
    this.tabs.delete(tabId);

    // Save to recently closed tabs for Ctrl+Shift+T restore
    if (tab.url && tab.url !== 'about:blank') {
      this.recentlyClosedTabs.push({
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        groupId: tab.groupId,
        isPinned: tab.isPinned,
        timestamp: Date.now()
      });
      if (this.recentlyClosedTabs.length > 50) {
        this.recentlyClosedTabs.shift();
      }
      storage.saveRecentlyClosedTabs(this.recentlyClosedTabs);
    }

    if (tab.view) {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.contentView && this.mainWindow.contentView.children.includes(tab.view)) {
          this.mainWindow.contentView.removeChildView(tab.view);
        }
      } catch (e) {
        console.warn('Error removing child view in closeTab:', e);
      }
      try {
        if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.removeAllListeners();
          tab.view.webContents.close();
        }
      } catch (e) {
        console.warn('Error closing webContents in closeTab:', e);
      }
    }

    // If active tab closed, switch to adjacent tab
    if (this.activeTabId === tabId) {
      const remainingIds = Array.from(this.tabs.keys());
      if (remainingIds.length > 0) {
        this.switchTab(remainingIds[remainingIds.length - 1]);
      } else {
        // If all closed, create one new tab
        this.createTab({ url: 'eclipse://newtab', active: true });
      }
    } else {
      this.notifyTabsUpdate();
    }
  }

  detachTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    if (tab.view) {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.contentView && this.mainWindow.contentView.children.includes(tab.view)) {
          this.mainWindow.contentView.removeChildView(tab.view);
        }
      } catch (e) {
        console.warn('Error removing child view in detachTab:', e);
      }
    }

    this.tabs.delete(tabId);

    // If source window has no more tabs left:
    if (this.tabs.size === 0) {
      this.activeTabId = null;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const otherWins = BrowserWindow.getAllWindows().filter(w =>
          !w.isDestroyed() &&
          w !== this.mainWindow &&
          !w._isPopup &&
          !w._isToast &&
          Boolean(w._viewManager)
        );
        if (otherWins.length > 0) {
          setTimeout(() => {
            try {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try { this.mainWindow.setOpacity(0); } catch (e) {}
                this.mainWindow.close();
              }
            } catch (e) {}
          }, 120);
        } else {
          this.createTab({ url: this.isIncognito ? 'eclipse://incognito' : 'eclipse://newtab', active: true });
        }
      }
    } else {
      if (this.activeTabId === tabId) {
        const remainingIds = Array.from(this.tabs.keys());
        if (remainingIds.length > 0) {
          this.switchTab(remainingIds[remainingIds.length - 1]);
        }
      } else {
        this.notifyTabsUpdate();
      }
    }

    return tab;
  }

  async adoptTabFromViewManager(sourceVm, tabId, options = {}) {
    if (!sourceVm || !sourceVm.tabs || !tabId) return { success: false };

    const sourceTab = sourceVm.tabs.get(tabId);
    if (!sourceTab) return { success: false };

    // Detach from source view manager
    const detachedTab = sourceVm.detachTab(tabId);
    if (!detachedTab) return { success: false };

    // If moving between incognito and regular window, recreate tab fresh
    if (this.isIncognito !== sourceVm.isIncognito) {
      if (detachedTab.view && detachedTab.view.webContents && !detachedTab.view.webContents.isDestroyed()) {
        try { detachedTab.view.webContents.close(); } catch (e) {}
      }
      const newTabRes = this.createTab({
        url: detachedTab.url,
        title: detachedTab.title,
        isPinned: Boolean(detachedTab.isPinned),
        active: true,
        groupId: options.groupId || null
      });
      return { success: true, tabId: newTabRes ? newTabRes.id : null };
    }

    // Refresh live URL & Title from WebContents if view exists
    if (detachedTab.view && detachedTab.view.webContents && !detachedTab.view.webContents.isDestroyed()) {
      try {
        const liveUrl = detachedTab.view.webContents.getURL();
        if (liveUrl) detachedTab.url = liveUrl;
        const liveTitle = detachedTab.view.webContents.getTitle();
        if (liveTitle) detachedTab.title = liveTitle;
      } catch (e) {}
    }

    // Allocate new ID in target view manager
    const newTabId = 'tab_' + this.nextTabId++;
    detachedTab.id = newTabId;
    detachedTab.lastActive = Date.now();
    if (options.groupId !== undefined) {
      detachedTab.groupId = options.groupId;
    }

    // Insert into this.tabs at targetIndex
    const currentEntries = Array.from(this.tabs.entries());
    let insertIdx = (typeof options.targetIndex === 'number' && options.targetIndex >= 0)
      ? options.targetIndex
      : currentEntries.length;
    if (insertIdx > currentEntries.length) insertIdx = currentEntries.length;

    currentEntries.splice(insertIdx, 0, [newTabId, detachedTab]);
    this.tabs = new Map(currentEntries);

    if (detachedTab.view) {
      const eventsToRemove = [
        'render-process-gone', 'unresponsive', 'will-navigate', 'will-redirect',
        'frame-created', 'did-frame-finish-load', 'did-start-navigation',
        'did-start-loading', 'did-stop-loading', 'did-finish-load',
        'page-title-updated', 'page-favicon-updated', 'did-navigate',
        'did-navigate-in-page', 'media-started-playing', 'media-paused',
        'enter-html-full-screen', 'leave-html-full-screen', 'before-input-event',
        'context-menu'
      ];
      for (const ev of eventsToRemove) {
        detachedTab.view.webContents.removeAllListeners(ev);
      }

      this.setupViewEvents(newTabId, detachedTab.view);

      detachedTab.view.webContents.setWindowOpenHandler(({ url, disposition }) => {
        if (!url || typeof url !== 'string') return { action: 'deny' };
        const trimmedUrl = url.trim();
        if (trimmedUrl.startsWith('javascript:') || trimmedUrl.startsWith('data:') || trimmedUrl.startsWith('about:blank')) {
          return { action: 'deny' };
        }
        try {
          const parsed = new URL(trimmedUrl);
          const internalSchemes = ['http:', 'https:', 'eclipse:', 'blackhole:', 'about:', 'chrome:', 'file:'];
          if (!internalSchemes.includes(parsed.protocol)) {
            shell.openExternal(trimmedUrl).catch(() => {});
            return { action: 'deny' };
          }
        } catch (e) {
          if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('eclipse://') && !trimmedUrl.startsWith('blackhole://')) {
            shell.openExternal(trimmedUrl).catch(() => {});
            return { action: 'deny' };
          }
        }
        this.createTab({ url: trimmedUrl, active: disposition !== 'background-tab' });
        return { action: 'deny' };
      });
    }

    // Switch to adopted tab and bring window to front
    this.switchTab(newTabId);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
    }

    return { success: true, tabId: newTabId };
  }

  restoreLastClosedTab() {
    if (!this.recentlyClosedTabs || this.recentlyClosedTabs.length === 0) {
      return null;
    }

    const lastClosed = this.recentlyClosedTabs.pop();
    storage.saveRecentlyClosedTabs(this.recentlyClosedTabs);
    if (!lastClosed || !lastClosed.url) return null;

    return this.createTab({
      url: lastClosed.url,
      title: lastClosed.title,
      favicon: lastClosed.favicon,
      groupId: (lastClosed.groupId && this.tabGroups.has(lastClosed.groupId)) ? lastClosed.groupId : null,
      isPinned: lastClosed.isPinned,
      active: true
    });
  }

  togglePictureInPicture(tabId) {
    const id = tabId || this.activeTabId;
    const tab = this.tabs.get(id);
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.send('toggle-pip');
    }
  }

  navigate(url) {
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    if (tab.isSleeping) {
      this.wakeTab(this.activeTabId);
    }

    let finalUrl = url.trim();

    // Check if it's search query or URL
    const isUrl = /^(https?:\/\/|file:\/\/|chrome:\/\/|eclipse:\/\/|blackhole:\/\/)/i.test(finalUrl) ||
                  (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/i.test(finalUrl) && !finalUrl.includes(' '));

    if (finalUrl.startsWith('eclipse://incognito') || finalUrl.startsWith('blackhole://incognito') || finalUrl.startsWith('chrome://incognito') || finalUrl.startsWith('about:incognito')) {
      this.loadInternalPage(tab.view, 'incognito');
      tab.url = 'eclipse://incognito';
      tab.title = 'Режим инкогнито';
      this.notifyTabState(tab.id);
      return;
    }

    if (finalUrl.startsWith('eclipse://newtab') || finalUrl.startsWith('blackhole://newtab') || finalUrl.startsWith('chrome://newtab') || finalUrl.startsWith('about:newtab')) {
      this.loadInternalPage(tab.view, 'newtab');
      tab.url = 'eclipse://newtab';
      tab.title = 'Новая вкладка';
      this.notifyTabState(tab.id);
      return;
    }

    if (finalUrl.startsWith('eclipse://history') || finalUrl.startsWith('blackhole://history') || finalUrl.startsWith('chrome://history') || finalUrl.startsWith('about:history')) {
      this.loadInternalPage(tab.view, 'history');
      tab.url = 'eclipse://history';
      tab.title = 'История';
      this.notifyTabState(tab.id);
      return;
    }

    if (finalUrl.startsWith('eclipse://downloads') || finalUrl.startsWith('blackhole://downloads') || finalUrl.startsWith('chrome://downloads') || finalUrl.startsWith('about:downloads')) {
      this.loadInternalPage(tab.view, 'downloads');
      tab.url = 'eclipse://downloads';
      tab.title = 'Загрузки';
      this.notifyTabState(tab.id);
      return;
    }

    if (!isUrl) {
      const engine = storage.getSettings().searchEngine || 'google';
      const searchUrls = {
        google: 'https://www.google.com/search?q=',
        yandex: 'https://ya.ru/search/?text=',
        duckduckgo: 'https://duckduckgo.com/?q=',
        bing: 'https://www.bing.com/search?q='
      };
      const base = searchUrls[engine] || searchUrls.google;
      finalUrl = base + encodeURIComponent(finalUrl);
    } else if (!/^[a-zA-Z]+:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    tab.url = finalUrl;
    tab._isMainFrameNavigating = true;
    tab.isLoading = true;
    this.notifyTabState(tab.id);
    tab.view.webContents.loadURL(finalUrl).catch(e => {
      console.warn('Navigation loadURL error:', e.message);
    });
  }

  goBack() {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      const wc = tab.view.webContents;
      const canBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : (wc.canGoBack ? wc.canGoBack() : false);
      if (canBack) {
        tab._isMainFrameNavigating = true;
        tab.isLoading = true;
        this.notifyTabState(this.activeTabId);
        wc.goBack();
      }
    }
  }

  goForward() {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      const wc = tab.view.webContents;
      const canFwd = wc.navigationHistory ? wc.navigationHistory.canGoForward() : (wc.canGoForward ? wc.canGoForward() : false);
      if (canFwd) {
        tab._isMainFrameNavigating = true;
        tab.isLoading = true;
        this.notifyTabState(this.activeTabId);
        wc.goForward();
      }
    }
  }

  reload(ignoreCache = false) {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      tab._isMainFrameNavigating = true;
      tab.isLoading = true;
      this.notifyTabState(this.activeTabId);
      if (ignoreCache) {
        tab.view.webContents.reloadIgnoringCache();
      } else {
        tab.view.webContents.reload();
      }
    }
  }

  stop() {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      tab._isMainFrameNavigating = false;
      tab.isLoading = false;
      this.notifyTabState(this.activeTabId);
      tab.view.webContents.stop();
    }
  }

  toggleMute(tabId) {
    const id = tabId || this.activeTabId;
    const tab = this.tabs.get(id);
    if (tab && tab.view) {
      tab.isMuted = !tab.isMuted;
      tab.view.webContents.setAudioMuted(tab.isMuted);
      this.notifyTabState(id);
    }
  }

  togglePin(tabId) {
    const id = tabId || this.activeTabId;
    const tab = this.tabs.get(id);
    if (tab) {
      tab.isPinned = !tab.isPinned;
      this.notifyTabsUpdate();
    }
  }

  duplicateTab(tabId) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (!tab) return;
    this.createTab({ url: tab.url, active: true });
  }

  async moveTabToNewWindow(tabId, options = {}) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (!tab) return;

    // Check if the tab was dropped onto another existing window!
    if (options && options.screenX !== undefined && options.screenY !== undefined) {
      const { screenX, screenY } = options;
      const otherWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w !== this.mainWindow);
      for (const targetWin of otherWindows) {
        const bounds = targetWin.getBounds();
        if (
          screenX >= bounds.x &&
          screenX <= bounds.x + bounds.width &&
          screenY >= bounds.y &&
          screenY <= bounds.y + bounds.height
        ) {
          const targetVm = targetWin._viewManager;
          if (targetVm) {
            let targetIndex = targetVm.tabs.size;
            // If dropped near the top tab strip, intelligently estimate index based on X position
            if (screenY <= bounds.y + 100) {
              const tabCount = Math.max(1, targetVm.tabs.size);
              const tabWidth = Math.max(60, Math.min(200, (bounds.width - 150) / tabCount));
              const relX = Math.max(0, screenX - bounds.x - 8);
              const estimatedIdx = Math.floor(relX / tabWidth);
              targetIndex = Math.max(0, Math.min(targetVm.tabs.size, estimatedIdx));
            }
            return await targetVm.adoptTabFromViewManager(this, tab.id, {
              targetIndex
            });
          }
        }
      }
    }

    const url = tab.url || 'eclipse://newtab';
    const title = tab.title || '';
    const isIncognito = Boolean(this.isIncognito);

    const windowOptions = {
      isIncognito,
      initialUrl: url,
      initialTitle: title,
      isSecondaryWindow: true
    };

    if (options && options.screenX !== undefined && options.screenY !== undefined) {
      windowOptions.x = Math.max(0, Math.round(options.screenX - 250));
      windowOptions.y = Math.max(0, Math.round(options.screenY - 30));
    }

    if (global.createBrowserWindow) {
      await global.createBrowserWindow(windowOptions);
    }

    if (this.tabs.size > 1) {
      this.closeTab(tab.id);
    } else {
      if (options && options.closeIfSingle) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.close();
        }
      } else {
        this.createTab({ url: isIncognito ? 'eclipse://incognito' : 'eclipse://newtab', active: true });
        this.closeTab(tab.id);
      }
    }
  }

  async openTabInNewWindow(tabId) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (!tab) return;

    if (global.createBrowserWindow) {
      await global.createBrowserWindow({
        initialUrl: tab.url || 'eclipse://newtab',
        initialTitle: tab.title || '',
        isIncognito: this.isIncognito,
        isSecondaryWindow: true
      });
    }
  }

  closeTabsToRight(tabId) {
    const id = tabId || this.activeTabId;
    const tabIds = Array.from(this.tabs.keys());
    const targetIdx = tabIds.indexOf(id);
    if (targetIdx === -1) return;

    const toClose = [];
    for (let i = targetIdx + 1; i < tabIds.length; i++) {
      const tId = tabIds[i];
      const tab = this.tabs.get(tId);
      if (tab && !tab.isPinned) {
        toClose.push(tId);
      }
    }
    toClose.forEach(tId => this.closeTab(tId));
  }

  closeTabsToLeft(tabId) {
    const id = tabId || this.activeTabId;
    const tabIds = Array.from(this.tabs.keys());
    const targetIdx = tabIds.indexOf(id);
    if (targetIdx === -1) return;

    const toClose = [];
    for (let i = 0; i < targetIdx; i++) {
      const tId = tabIds[i];
      const tab = this.tabs.get(tId);
      if (tab && !tab.isPinned) {
        toClose.push(tId);
      }
    }
    toClose.forEach(tId => this.closeTab(tId));
  }

  closeOtherTabs(tabId) {
    const id = tabId || this.activeTabId;
    const tabIds = Array.from(this.tabs.keys());
    const toClose = [];
    for (const tId of tabIds) {
      if (tId !== id) {
        const tab = this.tabs.get(tId);
        if (tab && !tab.isPinned) {
          toClose.push(tId);
        }
      }
    }
    toClose.forEach(tId => this.closeTab(tId));
  }

  // --- Tab Groups (Folders) Management ---
  createTabGroup(options = {}) {
    const id = 'group_' + (this.nextGroupId++) + '_' + Date.now().toString(36);
    const color = options.color || 'purple';
    const group = {
      id,
      name: (options.name || 'Новая папка').trim(),
      color: color,
      colorHex: GROUP_COLORS[color] || GROUP_COLORS.purple,
      isCollapsed: Boolean(options.isCollapsed),
      dateCreated: Date.now()
    };

    this.tabGroups.set(id, group);

    if (Array.isArray(options.tabIds)) {
      options.tabIds.forEach(tabId => {
        const tab = this.tabs.get(tabId);
        if (tab) tab.groupId = id;
      });
    }

    this.notifyTabsUpdate();
    return group;
  }

  updateTabGroup(groupId, updates = {}) {
    const group = this.tabGroups.get(groupId);
    if (!group) return null;

    if (typeof updates.name === 'string') group.name = updates.name.trim() || 'Папка';
    if (typeof updates.color === 'string') {
      group.color = updates.color;
      group.colorHex = GROUP_COLORS[updates.color] || GROUP_COLORS.purple;
    }
    if (typeof updates.isCollapsed === 'boolean') {
      group.isCollapsed = updates.isCollapsed;
    }

    this.notifyTabsUpdate();
    return group;
  }

  toggleGroupCollapse(groupId) {
    const group = this.tabGroups.get(groupId);
    if (!group) return;
    group.isCollapsed = !group.isCollapsed;
    this.notifyTabsUpdate();
  }

  addTabToGroup(tabId, groupId) {
    const tab = this.tabs.get(tabId);
    const group = this.tabGroups.get(groupId);
    if (!tab || !group) return;

    tab.groupId = groupId;
    if (group.isCollapsed && this.activeTabId === tabId) {
      group.isCollapsed = false;
    }
    this.notifyTabsUpdate();
  }

  removeTabFromGroup(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const oldGroupId = tab.groupId;
    tab.groupId = null;

    if (oldGroupId) {
      const hasRemaining = Array.from(this.tabs.values()).some(t => t.groupId === oldGroupId);
      if (!hasRemaining) {
        this.tabGroups.delete(oldGroupId);
      }
    }
    this.notifyTabsUpdate();
  }

  ungroup(groupId) {
    for (const tab of this.tabs.values()) {
      if (tab.groupId === groupId) {
        tab.groupId = null;
      }
    }
    this.tabGroups.delete(groupId);
    this.notifyTabsUpdate();
  }

  closeGroup(groupId) {
    const tabIdsToClose = [];
    for (const [id, tab] of this.tabs.entries()) {
      if (tab.groupId === groupId) {
        tabIdsToClose.push(id);
      }
    }
    tabIdsToClose.forEach(id => this.closeTab(id));
    this.tabGroups.delete(groupId);
    this.notifyTabsUpdate();
  }

  getGroupsSummary() {
    return Array.from(this.tabGroups.values());
  }

  reorderTabs(orderedTabs) {
    if (!Array.isArray(orderedTabs) || orderedTabs.length === 0) return;

    const newTabsMap = new Map();

    for (const item of orderedTabs) {
      const tabId = typeof item === 'string' ? item : item.id;
      const tab = this.tabs.get(tabId);
      if (tab) {
        if (typeof item === 'object') {
          if ('groupId' in item) tab.groupId = item.groupId || null;
          if ('isPinned' in item) tab.isPinned = Boolean(item.isPinned);
        }
        newTabsMap.set(tabId, tab);
      }
    }

    // Preserve any existing tabs that might have been omitted
    for (const [id, tab] of this.tabs.entries()) {
      if (!newTabsMap.has(id)) {
        newTabsMap.set(id, tab);
      }
    }

    this.tabs = newTabsMap;
    this.notifyTabsUpdate();
  }

  moveTab(tabId, direction) {
    const tabIds = Array.from(this.tabs.keys());
    const idx = tabIds.indexOf(tabId);
    if (idx === -1) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= tabIds.length) return;

    const currentTab = this.tabs.get(tabId);
    const targetTabId = tabIds[targetIdx];
    const targetTab = this.tabs.get(targetTabId);

    // Swap positions
    tabIds[idx] = targetTabId;
    tabIds[targetIdx] = tabId;

    if (targetTab && !currentTab.isPinned && !targetTab.isPinned) {
      // Adopt group if moving into a grouped region
      currentTab.groupId = targetTab.groupId;
    }

    const newTabsMap = new Map();
    tabIds.forEach(id => {
      newTabsMap.set(id, this.tabs.get(id));
    });
    this.tabs = newTabsMap;
    this.notifyTabsUpdate();
  }

  moveGroup(groupId, direction) {
    const group = this.tabGroups.get(groupId);
    if (!group) return;

    const tabsList = Array.from(this.tabs.values());
    const groupTabs = tabsList.filter(t => t.groupId === groupId && !t.isPinned);
    if (groupTabs.length === 0) return;

    const otherTabs = tabsList.filter(t => t.groupId !== groupId || t.isPinned);
    const firstGroupTabIdx = tabsList.findIndex(t => t.groupId === groupId && !t.isPinned);

    let newIndex = 0;
    if (direction < 0) {
      newIndex = Math.max(0, firstGroupTabIdx - 1);
      const prevTab = tabsList[newIndex];
      if (prevTab && prevTab.groupId) {
        const prevGroupStart = tabsList.findIndex(t => t.groupId === prevTab.groupId && !t.isPinned);
        if (prevGroupStart !== -1) newIndex = prevGroupStart;
      }
    } else {
      let lastGroupTabIdx = firstGroupTabIdx + groupTabs.length - 1;
      for (let i = tabsList.length - 1; i >= 0; i--) {
        if (tabsList[i].groupId === groupId && !tabsList[i].isPinned) {
          lastGroupTabIdx = i;
          break;
        }
      }
      const nextIdx = lastGroupTabIdx + 1;
      if (nextIdx >= tabsList.length) return;
      const nextTab = tabsList[nextIdx];
      if (nextTab && nextTab.groupId) {
        let nextGroupLast = nextIdx;
        for (let i = tabsList.length - 1; i >= 0; i--) {
          if (tabsList[i].groupId === nextTab.groupId && !tabsList[i].isPinned) {
            nextGroupLast = i;
            break;
          }
        }
        newIndex = nextGroupLast + 1;
      } else {
        newIndex = nextIdx + 1;
      }
    }

    const remainingBefore = otherTabs.slice(0, newIndex);
    const remainingAfter = otherTabs.slice(newIndex);
    const result = [...remainingBefore, ...groupTabs, ...remainingAfter];

    const newTabsMap = new Map();
    result.forEach(t => {
      newTabsMap.set(t.id, this.tabs.get(t.id));
    });
    this.tabs = newTabsMap;
    this.notifyTabsUpdate();
  }

  showGroupContextMenu(groupId, coords) {
    const group = this.tabGroups.get(groupId);
    if (!group) return;

    const menu = new Menu();

    menu.append(new MenuItem({
      label: group.isCollapsed ? '📂 Развернуть папку' : '📁 Свернуть папку',
      click: () => this.toggleGroupCollapse(groupId)
    }));

    menu.append(new MenuItem({
      label: '➕ Новая вкладка в этой папке',
      click: () => {
        this.createTab({ url: 'eclipse://newtab', groupId, active: true });
      }
    }));

    menu.append(new MenuItem({
      label: '🎨 Настроить имя и цвет...',
      click: () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('prompt-edit-tab-group', { groupId });
        }
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: '⬅️ Переместить папку влево',
      click: () => this.moveGroup(groupId, -1)
    }));

    menu.append(new MenuItem({
      label: '➡️ Переместить папку вправо',
      click: () => this.moveGroup(groupId, 1)
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: '🔓 Разгруппировать вкладки',
      click: () => this.ungroup(groupId)
    }));

    menu.append(new MenuItem({
      label: '❌ Закрыть всю папку с вкладками',
      click: () => this.closeGroup(groupId)
    }));

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const popupOpts = { window: this.mainWindow };
      if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
        popupOpts.x = Math.round(coords.x);
        popupOpts.y = Math.round(coords.y);
      }
      menu.popup(popupOpts);
    }
  }

  showTabContextMenu(tabId, coords) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const tabIds = Array.from(this.tabs.keys());
    const targetIdx = tabIds.indexOf(tabId);
    const isPinned = Boolean(tab.isPinned);
    const isSleeping = Boolean(tab.isSleeping);
    const isMuted = Boolean(tab.isMuted);
    const currentGroup = tab.groupId ? this.tabGroups.get(tab.groupId) : null;

    const hasTabsToRight = targetIdx >= 0 && targetIdx < tabIds.length - 1;
    const hasTabsToLeft = targetIdx > 0;
    const hasOtherTabs = tabIds.length > 1;

    const menu = new Menu();

    // --- Tab Groups / Folders Submenu ---
    const groupSubmenu = new Menu();
    groupSubmenu.append(new MenuItem({
      label: '➕ Новая папка с вкладками...',
      click: () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('prompt-create-tab-group', { tabId });
        }
      }
    }));

    const allGroups = Array.from(this.tabGroups.values());
    if (allGroups.length > 0) {
      groupSubmenu.append(new MenuItem({ type: 'separator' }));
      for (const g of allGroups) {
        if (g.id !== tab.groupId) {
          groupSubmenu.append(new MenuItem({
            label: `📁 ${g.name}`,
            click: () => this.addTabToGroup(tabId, g.id)
          }));
        }
      }
    }

    if (currentGroup) {
      menu.append(new MenuItem({
        label: `📂 Извлечь из папки «${currentGroup.name}»`,
        click: () => this.removeTabFromGroup(tabId)
      }));
      menu.append(new MenuItem({
        label: '📁 Переместить в папку',
        submenu: groupSubmenu
      }));
      menu.append(new MenuItem({
        label: `🎨 Настроить папку «${currentGroup.name}»...`,
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('prompt-edit-tab-group', { groupId: currentGroup.id });
          }
        }
      }));
      menu.append(new MenuItem({
        label: `❌ Закрыть всю папку «${currentGroup.name}»`,
        click: () => this.closeGroup(currentGroup.id)
      }));
    } else {
      menu.append(new MenuItem({
        label: '📁 Добавить вкладку в папку',
        submenu: groupSubmenu
      }));
    }

    menu.append(new MenuItem({ type: 'separator' }));

    // 1. Pin / Unpin
    menu.append(new MenuItem({
      label: isPinned ? '📍 Открепить вкладку' : '📌 Закрепить вкладку',
      click: () => this.togglePin(tabId)
    }));

    // 2. Duplicate & Move to New Window
    menu.append(new MenuItem({
      label: '📋 Дублировать вкладку',
      click: () => this.duplicateTab(tabId)
    }));

    menu.append(new MenuItem({
      label: '🪟 Открыть вкладку в отдельном окне',
      click: () => this.moveTabToNewWindow(tabId)
    }));

    menu.append(new MenuItem({
      label: '🪟 Открыть копию в новом окне',
      click: () => this.openTabInNewWindow(tabId)
    }));

    // Move Tab Left / Right
    menu.append(new MenuItem({
      label: '⬅️ Переместить вкладку влево',
      enabled: hasTabsToLeft,
      click: () => this.moveTab(tabId, -1)
    }));

    menu.append(new MenuItem({
      label: '➡️ Переместить вкладку вправо',
      enabled: hasTabsToRight,
      click: () => this.moveTab(tabId, 1)
    }));

    // 3. Reload
    menu.append(new MenuItem({
      label: '🔄 Перезагрузить',
      click: () => {
        if (tab.view) {
          tab.view.webContents.reload();
        } else if (isSleeping) {
          this.wakeTab(tabId);
        }
      }
    }));

    // 4. Mute / Unmute
    menu.append(new MenuItem({
      label: isMuted ? '🔊 Включить звук на вкладке' : '🔇 Отключить звук на вкладке',
      click: () => this.toggleMute(tabId)
    }));

    // 5. Picture-in-Picture
    menu.append(new MenuItem({
      label: '📺 Картинка в картинке',
      accelerator: 'Alt+P',
      click: () => this.togglePictureInPicture(tabId)
    }));

    // 6. Split Screen (Open Side-by-Side)
    menu.append(new MenuItem({
      label: (this.isSplitScreen && this.splitTabId === tabId) 
        ? '🪟 Закрыть разделение экрана' 
        : '🪟 Открыть рядом (Разделить экран)',
      accelerator: 'Alt+S',
      click: () => this.toggleSplitScreen(tabId)
    }));

    // 7. Vertical Tabs
    menu.append(new MenuItem({
      label: this.isVerticalTabs ? '🗂️ Переключить на горизонтальные вкладки' : '🗂️ Включить вертикальные вкладки',
      accelerator: 'Ctrl+Shift+V',
      click: () => this.toggleVerticalTabs()
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    // 5. Unload / Hibernate
    menu.append(new MenuItem({
      label: isSleeping ? '⚡ Разбудить вкладку' : '💤 Выгрузить вкладку (освободить память)',
      click: () => {
        if (isSleeping) {
          this.wakeTab(tabId);
        } else {
          this.hibernateTab(tabId);
        }
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    // 6. Close tabs to right
    menu.append(new MenuItem({
      label: '➡️ Закрыть вкладки справа',
      enabled: hasTabsToRight,
      click: () => this.closeTabsToRight(tabId)
    }));

    // 7. Close tabs to left
    menu.append(new MenuItem({
      label: '⬅️ Закрыть вкладки слева',
      enabled: hasTabsToLeft,
      click: () => this.closeTabsToLeft(tabId)
    }));

    // 8. Close other tabs
    menu.append(new MenuItem({
      label: '🗂️ Закрыть другие вкладки',
      enabled: hasOtherTabs,
      click: () => this.closeOtherTabs(tabId)
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    // 9. Close this tab
    menu.append(new MenuItem({
      label: '❌ Закрыть вкладку',
      accelerator: 'CmdOrCtrl+W',
      click: () => this.closeTab(tabId)
    }));

    // 10. Reopen closed tab
    menu.append(new MenuItem({
      label: '↩️ Вернуть закрытую вкладку',
      accelerator: 'CmdOrCtrl+Shift+T',
      enabled: this.recentlyClosedTabs.length > 0,
      click: () => this.restoreLastClosedTab()
    }));

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const popupOpts = { window: this.mainWindow };
      if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
        popupOpts.x = Math.round(coords.x);
        popupOpts.y = Math.round(coords.y);
      }
      menu.popup(popupOpts);
    }
  }

  switchToNextTab() {
    const tabList = Array.from(this.tabs.keys());
    if (tabList.length <= 1) return;
    const curIdx = tabList.indexOf(this.activeTabId);
    const nextIdx = (curIdx + 1) % tabList.length;
    this.switchTab(tabList[nextIdx]);
  }

  switchToPrevTab() {
    const tabList = Array.from(this.tabs.keys());
    if (tabList.length <= 1) return;
    const curIdx = tabList.indexOf(this.activeTabId);
    const prevIdx = (curIdx - 1 + tabList.length) % tabList.length;
    this.switchTab(tabList[prevIdx]);
  }

  switchToTabIndex(index) {
    const tabList = Array.from(this.tabs.keys());
    if (index >= 0 && index < tabList.length) {
      this.switchTab(tabList[index]);
    }
  }

  zoomIn(tabId) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (tab && tab.view) {
      const current = tab.view.webContents.getZoomFactor();
      const next = Math.min(3.0, Math.round((current + 0.1) * 10) / 10);
      tab.view.webContents.setZoomFactor(next);
    }
  }

  zoomOut(tabId) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (tab && tab.view) {
      const current = tab.view.webContents.getZoomFactor();
      const next = Math.max(0.3, Math.round((current - 0.1) * 10) / 10);
      tab.view.webContents.setZoomFactor(next);
    }
  }

  zoomReset(tabId) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (tab && tab.view) {
      tab.view.webContents.setZoomFactor(1.0);
    }
  }

  setZoom(factor) {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      tab.view.webContents.setZoomFactor(factor);
    }
  }

  findInPage(text, forward = true, findNext = false) {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      return tab.view.webContents.findInPage(text, {
        forward,
        findNext
      });
    }
  }

  stopFindInPage(action = 'clearSelection') {
    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.view) {
      tab.view.webContents.stopFindInPage(action);
    }
  }

  getTabsSummary() {
    return Array.from(this.tabs.values()).map(t => ({
      id: t.id,
      title: t.title,
      url: t.url,
      favicon: t.favicon,
      isLoading: t.isLoading,
      isMuted: t.isMuted,
      isPinned: t.isPinned,
      groupId: t.groupId || null,
      isSleeping: t.isSleeping,
      isPlayingAudio: t.isPlayingAudio,
      isActive: t.id === this.activeTabId,
      isSplitSecondary: Boolean(this.isSplitScreen && t.id === this.splitTabId)
    }));
  }

  notifyTabsUpdate() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('tabs-updated', {
        tabs: this.getTabsSummary(),
        groups: this.getGroupsSummary(),
        activeTabId: this.activeTabId
      });
      // Save session only for standard browsing windows (never in incognito)
      if (!this.isIncognito) {
        storage.saveOpenTabs(Array.from(this.tabs.values()), this.getGroupsSummary());
      }
    }
  }

  notifyTabState(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !this.mainWindow || this.mainWindow.isDestroyed()) return;

    this.mainWindow.webContents.send('tab-state-changed', {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      isLoading: tab.isLoading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isMuted: tab.isMuted,
      isPinned: tab.isPinned,
      groupId: tab.groupId || null,
      isSleeping: tab.isSleeping,
      isPlayingAudio: tab.isPlayingAudio,
      isActive: tab.id === this.activeTabId
    });
  }

  applyWebColorScheme(wc) {
    if (!wc || wc.isDestroyed()) return;
    try {
      const settings = storage.getSettings();
      const isWebsiteDark = settings.websiteDarkTheme !== false;
      const theme = settings.theme || 'dark';
      const isSystemDark = (theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors));

      const scheme = (isWebsiteDark && isSystemDark) ? 'dark' : 'light';
      if (typeof wc.emulateMedia === 'function') {
        wc.emulateMedia({ colorScheme: scheme });
      }
    } catch (e) {
      console.warn('[ViewManager] Error applying color scheme:', e);
    }
  }

  updateWebColorScheme() {
    for (const [id, tab] of this.tabs.entries()) {
      if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        this.applyWebColorScheme(tab.view.webContents);
      }
    }
  }

  updateTheme(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    for (const [id, tab] of this.tabs.entries()) {
      if (tab && tab.view) {
        const isInternal = tab.url && (tab.url.startsWith('eclipse://') || tab.url.startsWith('blackhole://'));
        if (isInternal) {
          try {
            tab.view.setBackgroundColor(isDark ? '#0b0d14' : '#f8fafc');
            if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
              tab.view.webContents.send('theme-changed', { theme, isDark });
            }
          } catch (e) {}
        }
      }
    }
    this.updateWebColorScheme();
  }

  cleanUp() {
    if (this.sleepInterval) clearInterval(this.sleepInterval);
  }
}

const defaultManager = new ViewManager();
defaultManager.ViewManager = ViewManager;
module.exports = defaultManager;
