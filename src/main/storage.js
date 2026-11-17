const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class StorageManager {
  constructor() {
    this.userDataPath = (app && typeof app.getPath === 'function') 
      ? app.getPath('userData') 
      : path.join(process.env.APPDATA || process.env.HOME || '.', 'Black hole Browser');
    this.storageFile = path.join(this.userDataPath, 'eclipse_data.json');
    this.blackholeStorageFile = path.join(this.userDataPath, 'blackhole_data.json');
    this.extensionsDir = path.join(this.userDataPath, 'installed_extensions');
    this.defaultSettings = {
      searchEngine: 'google', // 'google' | 'yandex' | 'duckduckgo' | 'bing'
      homePage: 'eclipse://newtab',
      tabSleepEnabled: true,
      tabSleepMinutes: 10,
      gameOptimizationEnabled: true,
      hardwareAcceleration: true,
      blockTrackers: true,
      adBlockerEnabled: true,
      adBlockYouTubeAutoSkip: true,
      showBookmarksBar: true,
      theme: 'dark', // 'dark' | 'light' | 'system'
      websiteDarkTheme: true,
      zoomLevel: 1.0,
      restoreSessionOnStartup: true,
      openNewTabOnStartup: true,
      youtubeTheaterMode: true,
      youtubeDpiBypassEnabled: true,
      verticalTabsEnabled: false,
      verticalTabsCollapsed: false,
      verticalTabsWidth: 240,
      pipProEnabled: true,
      pipAutoTabSwitch: true,
      pipFloatingButtonEnabled: true,
      pipSeekStepSeconds: 10,
      bubbleDimmingEnabled: true,
      bubbleDimmingOpacity: 0.35,
      neonThemeColor: '#a855f7',
      newTabBackgroundType: 'default', // 'default' | 'custom'
      newTabBackgroundImage: '',
      newTabBackgroundDim: 30, // 0 - 90 (%)
      newTabBackgroundBlur: 0, // 0 - 20 (px)
      newTabBackgroundFit: 'cover', // 'cover' | 'contain' | 'repeat' | 'stretch' | 'free'
      newTabBackgroundPosition: 'center center',
      newTabBackgroundPosX: 50, // 0 - 100 (%)
      newTabBackgroundPosY: 50, // 0 - 100 (%)
      newTabBackgroundScale: 100, // 50 - 250 (%)
      newTabBackgroundFlip: false, // true | false
      autoCheckUpdates: true,
      updateFeedUrl: 'https://raw.githubusercontent.com/Karasu287/Black-hole-browser-/main/version.json',
      dismissedUpdateVersion: null,
      lastUpdateCheckTime: null
    };
    this.migrateLegacyData();
    this.ensureDirectories();
    this.data = this.loadData();
  }

  migrateLegacyData() {
    try {
      const appData = (app && typeof app.getPath === 'function') ? app.getPath('appData') : (process.env.APPDATA || '');
      if (!appData) return;

      const legacyDirs = [
        path.join(appData, 'eclipse-browser'),
        path.join(appData, 'eclipse-browser-data'),
        path.join(appData, 'Eclipse')
      ];

      if (!fs.existsSync(this.userDataPath)) {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      }

      for (const legacyDir of legacyDirs) {
        if (fs.existsSync(legacyDir) && path.resolve(legacyDir) !== path.resolve(this.userDataPath)) {
          const legacyStorage = path.join(legacyDir, 'eclipse_data.json');
          const currentStorage = fs.existsSync(this.blackholeStorageFile) ? this.blackholeStorageFile : this.storageFile;
          
          const currentSize = fs.existsSync(currentStorage) ? fs.statSync(currentStorage).size : 0;
          const legacySize = fs.existsSync(legacyStorage) ? fs.statSync(legacyStorage).size : 0;

          // If legacy data has substantive data and current does not or is smaller
          if (legacySize > currentSize) {
            try {
              fs.cpSync(legacyDir, this.userDataPath, { recursive: true, force: true });
              console.log(`[Storage] Successfully migrated legacy profile data from ${legacyDir} to ${this.userDataPath}`);
              break;
            } catch (copyErr) {
              console.warn('[Storage] Partial migration fallback:', copyErr);
              if (fs.existsSync(legacyStorage)) {
                fs.copyFileSync(legacyStorage, this.storageFile);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[Storage] Legacy migration error:', err);
    }
  }

  ensureDirectories() {
    if (!fs.existsSync(this.extensionsDir)) {
      fs.mkdirSync(this.extensionsDir, { recursive: true });
    }
  }

  loadData() {
    try {
      const fileToLoad = fs.existsSync(this.blackholeStorageFile) 
        ? this.blackholeStorageFile 
        : (fs.existsSync(this.storageFile) ? this.storageFile : null);

      if (fileToLoad && fs.existsSync(fileToLoad)) {
        const raw = fs.readFileSync(fileToLoad, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          settings: { ...this.defaultSettings, ...(parsed.settings || {}) },
          bookmarks: parsed.bookmarks || this.getDefaultBookmarks(),
          history: parsed.history || [],
          extensions: parsed.extensions || [],
          passwords: parsed.passwords || [],
          lastOpenTabs: parsed.lastOpenTabs || [],
          tabGroups: parsed.tabGroups || [],
          recentlyClosedTabs: parsed.recentlyClosedTabs || [],
          shortcuts: parsed.shortcuts || this.getDefaultShortcuts(),
          downloads: parsed.downloads || [],
          adBlockStats: parsed.adBlockStats || { totalBlocked: 0 },
          adBlockWhitelist: parsed.adBlockWhitelist || []
        };
      }
    } catch (e) {
      console.error('Failed to read storage file:', e);
    }
    return {
      settings: { ...this.defaultSettings },
      bookmarks: this.getDefaultBookmarks(),
      history: [],
      extensions: [],
      passwords: [],
      lastOpenTabs: [],
      tabGroups: [],
      recentlyClosedTabs: [],
      shortcuts: this.getDefaultShortcuts(),
      downloads: [],
      adBlockStats: { totalBlocked: 0 },
      adBlockWhitelist: []
    };
  }

  getDefaultShortcuts() {
    return [
      // Вкладки и Окна
      { id: 'new-tab', name: 'Новая вкладка', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Открыть новую вкладку в текущем окне', defaultKey: 'Ctrl+T', key: 'Ctrl+T', enabled: true },
      { id: 'new-window', name: 'Новое окно', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Открыть отдельное новое окно браузера', defaultKey: 'Ctrl+N', key: 'Ctrl+N', enabled: true },
      { id: 'close-tab', name: 'Закрыть вкладку', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Закрыть текущую активную вкладку', defaultKey: 'Ctrl+W', key: 'Ctrl+W', enabled: true },
      { id: 'restore-tab', name: 'Восстановить вкладку', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Заново открыть последнюю закрытую вкладку', defaultKey: 'Ctrl+Shift+T', key: 'Ctrl+Shift+T', enabled: true },
      { id: 'new-incognito', name: 'Окно инкогнито', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Открыть новое приватное окно инкогнито', defaultKey: 'Ctrl+Shift+N', key: 'Ctrl+Shift+N', enabled: true },
      { id: 'next-tab', name: 'Следующая вкладка', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Переключиться на следующую вкладку справа', defaultKey: 'Ctrl+Tab', key: 'Ctrl+Tab', enabled: true },
      { id: 'prev-tab', name: 'Предыдущая вкладка', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Переключиться на предыдущую вкладку слева', defaultKey: 'Ctrl+Shift+Tab', key: 'Ctrl+Shift+Tab', enabled: true },
      { id: 'duplicate-tab', name: 'Дублировать вкладку', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Создать копию текущей вкладки', defaultKey: 'Ctrl+Shift+D', key: 'Ctrl+Shift+D', enabled: true },
      { id: 'move-tab-new-window', name: 'Вкладка в отдельное окно', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Перенести текущую вкладку в новое отдельное окно', defaultKey: 'Ctrl+Alt+N', key: 'Ctrl+Alt+N', enabled: true },
      { id: 'split-screen', name: 'Разделение экрана (2 вкладки)', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Открыть две вкладки рядом или выйти из режима разделения', defaultKey: 'Alt+S', key: 'Alt+S', enabled: true },
      { id: 'toggle-vertical-tabs', name: 'Вертикальные вкладки', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Переключить боковую панель вертикальных вкладок', defaultKey: 'Ctrl+Shift+V', key: 'Ctrl+Shift+V', enabled: true },
      { id: 'tab-digits', name: 'Переход по вкладкам 1-9', category: 'tabs', categoryName: 'Вкладки и Окна', description: 'Быстрый переход к вкладкам с 1 по 9 по номеру', defaultKey: 'Ctrl+1..9', key: 'Ctrl+1..9', enabled: true },

      // Навигация и Страница
      { id: 'reload-page', name: 'Перезагрузить страницу', category: 'nav', categoryName: 'Навигация и Страница', description: 'Обновить содержимое текущей страницы', defaultKey: 'Ctrl+R', key: 'Ctrl+R', enabled: true },
      { id: 'hard-reload', name: 'Очистить кэш и обновить', category: 'nav', categoryName: 'Навигация и Страница', description: 'Полная перезагрузка страницы без кэша', defaultKey: 'Ctrl+Shift+R', key: 'Ctrl+Shift+R', enabled: true },
      { id: 'focus-omnibox', name: 'Адресная строка (Поиск / URL)', category: 'nav', categoryName: 'Навигация и Страница', description: 'Сфокусироваться на адресной строке и выделить текст', defaultKey: 'Ctrl+L', key: 'Ctrl+L', enabled: true },
      { id: 'find-in-page', name: 'Поиск на странице', category: 'nav', categoryName: 'Навигация и Страница', description: 'Открыть панель быстрого поиска текста на странице', defaultKey: 'Ctrl+F', key: 'Ctrl+F', enabled: true },
      { id: 'zoom-in', name: 'Увеличить масштаб', category: 'nav', categoryName: 'Навигация и Страница', description: 'Увеличить масштаб отображения веб-страницы', defaultKey: 'Ctrl+=', key: 'Ctrl+=', enabled: true },
      { id: 'zoom-out', name: 'Уменьшить масштаб', category: 'nav', categoryName: 'Навигация и Страница', description: 'Уменьшить масштаб отображения веб-страницы', defaultKey: 'Ctrl+-', key: 'Ctrl+-', enabled: true },
      { id: 'zoom-reset', name: 'Сбросить масштаб (100%)', category: 'nav', categoryName: 'Навигация и Страница', description: 'Вернуть масштаб страницы к 100%', defaultKey: 'Ctrl+0', key: 'Ctrl+0', enabled: true },
      { id: 'fullscreen', name: 'Полноэкранный режим', category: 'nav', categoryName: 'Навигация и Страница', description: 'Развернуть браузер на весь экран', defaultKey: 'F11', key: 'F11', enabled: true },

      // Инструменты и Окна браузера
      { id: 'open-history', name: 'История посещений', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть панель истории просмотров страниц', defaultKey: 'Ctrl+H', key: 'Ctrl+H', enabled: true },
      { id: 'open-downloads', name: 'История загрузок', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть список скачанных файлов и загрузок', defaultKey: 'Ctrl+J', key: 'Ctrl+J', enabled: true },
      { id: 'open-bookmarks', name: 'Менеджер закладок', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть панель сохраненных закладок', defaultKey: 'Ctrl+B', key: 'Ctrl+B', enabled: true },
      { id: 'bookmark-page', name: 'Добавить в закладки', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Сохранить текущую страницу в закладки', defaultKey: 'Ctrl+D', key: 'Ctrl+D', enabled: true },
      { id: 'toggle-bookmarks-bar', name: 'Панель закладок (вкл/выкл)', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Показать или скрыть панель быстрого доступа к закладкам', defaultKey: 'Ctrl+Shift+B', key: 'Ctrl+Shift+B', enabled: true },
      { id: 'open-settings', name: 'Настройки браузера', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть окно настроек браузера', defaultKey: 'Ctrl+,', key: 'Ctrl+,', enabled: true },
      { id: 'open-passwords', name: 'Менеджер паролей', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть сохраненные учетные записи и пароли', defaultKey: 'Ctrl+Shift+L', key: 'Ctrl+Shift+L', enabled: true },
      { id: 'open-extensions', name: 'Управление расширениями', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть менеджер расширений Chrome Web Store', defaultKey: 'Ctrl+Shift+E', key: 'Ctrl+Shift+E', enabled: true },
      { id: 'toggle-shield', name: 'Управление Shield (Реклама)', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть быстрое меню управления блокировщиком', defaultKey: 'Ctrl+Shift+S', key: 'Ctrl+Shift+S', enabled: true },
      { id: 'toggle-pip', name: 'Картинка в картинке (PiP)', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Вынести активное видео в плавающее окно', defaultKey: 'Alt+P', key: 'Alt+P', enabled: true },
      { id: 'clear-cache', name: 'Очистка данных и кэша', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Быстрая очистка кэша, куки и временных файлов', defaultKey: 'Ctrl+Shift+Delete', key: 'Ctrl+Shift+Delete', enabled: true },
      { id: 'devtools', name: 'Инструменты разработчика', category: 'tools', categoryName: 'Инструменты и Панели', description: 'Открыть консоль Chromium DevTools для текущей вкладки', defaultKey: 'F12', key: 'F12', enabled: true }
    ];
  }

  getDefaultBookmarks() {
    return [
      { id: 'bm_1', title: 'Google', url: 'https://www.google.com', favicon: 'https://www.google.com/favicon.ico' },
      { id: 'bm_2', title: 'YouTube', url: 'https://www.youtube.com', favicon: 'https://www.youtube.com/favicon.ico' },
      { id: 'bm_3', title: 'GitHub', url: 'https://github.com', favicon: 'https://github.com/favicon.ico' },
      { id: 'bm_4', title: 'Yandex', url: 'https://ya.ru', favicon: 'https://ya.ru/favicon.ico' },
      { id: 'bm_5', title: 'Chrome Web Store', url: 'https://chromewebstore.google.com', favicon: 'https://ssl.gstatic.com/chrome/webstore/images/icon_32px.png' }
    ];
  }

  save(immediate = false) {
    if (immediate) {
      this.saveSync();
      return;
    }
    this.saveDebounced();
  }

  saveDebounced(delay = 80) {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveAsync();
    }, delay);
  }

  async saveAsync() {
    try {
      const payload = JSON.stringify(this.data, null, 2);
      const tmpFile = path.join(this.userDataPath, `data_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.tmp`);
      
      await fs.promises.writeFile(tmpFile, payload, 'utf8');
      
      try {
        await fs.promises.copyFile(tmpFile, this.blackholeStorageFile);
      } catch (e) {}

      try {
        await fs.promises.rename(tmpFile, this.storageFile);
      } catch (e) {
        await fs.promises.copyFile(tmpFile, this.storageFile);
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    } catch (e) {
      console.error('Failed to save storage data async:', e);
      this.saveSync();
    }
  }

  saveSync() {
    try {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      const payload = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(this.storageFile, payload, 'utf8');
      fs.writeFileSync(this.blackholeStorageFile, payload, 'utf8');
    } catch (e) {
      console.error('Failed to save storage data sync:', e);
    }
  }

  getSettings() {
    return this.data.settings;
  }

  getTheme() {
    return this.data.settings.theme || 'dark';
  }

  setTheme(theme) {
    this.data.settings.theme = theme || 'dark';
    this.save();
    return this.data.settings.theme;
  }

  getWebsiteDarkTheme() {
    return this.data.settings.websiteDarkTheme !== false;
  }

  setWebsiteDarkTheme(enabled) {
    this.data.settings.websiteDarkTheme = Boolean(enabled);
    this.save();
    return this.data.settings.websiteDarkTheme;
  }

  getYoutubeTheaterMode() {
    return this.data.settings.youtubeTheaterMode !== false;
  }

  setYoutubeTheaterMode(enabled) {
    this.data.settings.youtubeTheaterMode = Boolean(enabled);
    this.save();
    return this.data.settings.youtubeTheaterMode;
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  getBookmarks() {
    return this.data.bookmarks;
  }

  addBookmark(bookmark) {
    const item = {
      id: 'bm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title: bookmark.title || 'Новая закладка',
      url: bookmark.url,
      favicon: bookmark.favicon || '',
      dateAdded: Date.now()
    };
    this.data.bookmarks.unshift(item);
    this.save();
    return item;
  }

  removeBookmark(id) {
    this.data.bookmarks = this.data.bookmarks.filter(b => b.id !== id);
    this.save();
    return this.data.bookmarks;
  }

  isBookmarked(url) {
    if (!url) return false;
    return this.data.bookmarks.some(b => b.url === url);
  }

  getHistory(limit = 100) {
    return this.data.history.slice(0, limit);
  }

  addHistory(entry) {
    if (!entry.url || entry.url.startsWith('eclipse://') || entry.url === 'about:blank') return;
    
    // Remove if already recent to avoid duplicates
    this.data.history = this.data.history.filter(h => h.url !== entry.url);
    
    this.data.history.unshift({
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title: entry.title || entry.url,
      url: entry.url,
      favicon: entry.favicon || '',
      visitTime: Date.now()
    });

    // Cap history at 1500 items for performance
    if (this.data.history.length > 1500) {
      this.data.history = this.data.history.slice(0, 1500);
    }
    this.save();
  }

  clearHistory() {
    this.data.history = [];
    this.save();
    return [];
  }

  removeHistoryItem(idOrUrl) {
    if (!idOrUrl) return this.data.history;
    this.data.history = this.data.history.filter(h => h.id !== idOrUrl && h.url !== idOrUrl);
    this.save();
    return this.data.history;
  }

  getExtensions() {
    return this.data.extensions;
  }

  saveExtensionRecord(extRecord) {
    const idx = this.data.extensions.findIndex(e => e.id === extRecord.id);
    if (idx >= 0) {
      this.data.extensions[idx] = { ...this.data.extensions[idx], ...extRecord };
    } else {
      this.data.extensions.push(extRecord);
    }
    this.save();
  }

  removeExtensionRecord(id) {
    this.data.extensions = this.data.extensions.filter(e => e.id !== id);
    this.save();
  }

  saveOpenTabs(tabs, tabGroups) {
    this.data.lastOpenTabs = tabs.map(t => ({
      url: t.url,
      title: t.title,
      favicon: t.favicon || '',
      isPinned: !!t.isPinned,
      groupId: t.groupId || null
    }));
    if (Array.isArray(tabGroups)) {
      this.data.tabGroups = tabGroups;
    }
    this.save();
  }

  getTabGroups() {
    return this.data.tabGroups || [];
  }

  saveTabGroups(groups) {
    this.data.tabGroups = groups || [];
    this.save();
  }

  getLastOpenTabs() {
    return this.data.lastOpenTabs;
  }

  getRecentlyClosedTabs() {
    return this.data.recentlyClosedTabs || [];
  }

  saveRecentlyClosedTabs(tabs) {
    if (Array.isArray(tabs)) {
      this.data.recentlyClosedTabs = tabs.slice(-50);
      this.save();
    }
  }

  // --- Password Manager ---
  getPasswords() {
    return this.data.passwords || [];
  }

  savePassword(credential) {
    if (!this.data.passwords) this.data.passwords = [];
    const origin = (credential.origin || '').trim();
    const username = (credential.username || '').trim();
    const password = credential.password || '';

    if (!origin || !password) return { success: false, error: 'Origin and password are required' };

    const idx = this.data.passwords.findIndex(p => p.origin === origin && p.username === username);
    const item = {
      id: idx >= 0 ? this.data.passwords[idx].id : ('pwd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
      origin,
      username,
      password,
      dateUpdated: Date.now()
    };

    if (idx >= 0) {
      this.data.passwords[idx] = item;
    } else {
      this.data.passwords.unshift(item);
    }
    this.save();
    return { success: true, item };
  }

  deletePassword(id) {
    if (!this.data.passwords) return [];
    this.data.passwords = this.data.passwords.filter(p => p.id !== id);
    this.save();
    return this.data.passwords;
  }

  getPasswordsForOrigin(originUrl) {
    if (!this.data.passwords || !originUrl) return [];
    try {
      const urlObj = new URL(originUrl);
      const host = urlObj.hostname.toLowerCase();
      return this.data.passwords.filter(p => {
        try {
          const pHost = new URL(p.origin).hostname.toLowerCase();
          return pHost === host || host.endsWith('.' + pHost) || pHost.endsWith('.' + host);
        } catch (e) {
          return p.origin.toLowerCase().includes(host);
        }
      });
    } catch (e) {
      return [];
    }
  }

  // --- Password Import & Export ---
  importPasswords(items, options = { overwrite: true }) {
    if (!this.data.passwords) this.data.passwords = [];
    if (!Array.isArray(items)) return { success: false, error: 'Invalid items array' };

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const cred of items) {
      let origin = (cred.origin || cred.url || '').trim();
      const username = (cred.username || cred.login || '').trim();
      const password = cred.password || '';

      if (!origin || !password) {
        skippedCount++;
        continue;
      }

      // Normalize origin to https:// if scheme is missing
      if (!/^[a-zA-Z]+:\/\//.test(origin)) {
        origin = 'https://' + origin;
      }

      const idx = this.data.passwords.findIndex(p => {
        try {
          const pOrigin = new URL(p.origin).hostname.toLowerCase();
          const targetOrigin = new URL(origin).hostname.toLowerCase();
          return pOrigin === targetOrigin && p.username === username;
        } catch (e) {
          return p.origin.toLowerCase() === origin.toLowerCase() && p.username === username;
        }
      });

      const entry = {
        id: idx >= 0 ? this.data.passwords[idx].id : ('pwd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
        origin,
        username,
        password,
        dateUpdated: Date.now()
      };

      if (idx >= 0) {
        if (options.overwrite !== false) {
          this.data.passwords[idx] = entry;
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        this.data.passwords.unshift(entry);
        importedCount++;
      }
    }

    this.save();
    return {
      success: true,
      importedCount,
      updatedCount,
      skippedCount,
      totalPasswords: this.data.passwords.length
    };
  }

  exportPasswordsCsv() {
    const passwords = this.data.passwords || [];
    const header = 'name,url,username,password,note';
    const rows = passwords.map(p => {
      let name = p.origin;
      try { name = new URL(p.origin).hostname; } catch (e) {}
      const escapeCsv = (val) => {
        const str = String(val || '');
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      return [
        escapeCsv(name),
        escapeCsv(p.origin),
        escapeCsv(p.username),
        escapeCsv(p.password),
        escapeCsv('')
      ].join(',');
    });
    return [header, ...rows].join('\r\n');
  }

  // --- Ad Blocker & Whitelist ---
  getAdBlockStats() {
    return this.data.adBlockStats || { totalBlocked: 0 };
  }

  incrementAdBlockStats(count = 1) {
    if (!this.data.adBlockStats) {
      this.data.adBlockStats = { totalBlocked: 0 };
    }
    this.data.adBlockStats.totalBlocked = (this.data.adBlockStats.totalBlocked || 0) + count;
    this.saveDebounced(5000);
    return this.data.adBlockStats;
  }

  resetAdBlockStats() {
    this.data.adBlockStats = { totalBlocked: 0 };
    this.save();
    return this.data.adBlockStats;
  }

  getAdBlockWhitelist() {
    return this.data.adBlockWhitelist || [];
  }

  isDomainWhitelisted(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    const whitelist = this.getAdBlockWhitelist();
    return whitelist.some(d => d.toLowerCase() === cleanDomain || cleanDomain.endsWith('.' + d.toLowerCase()));
  }

  toggleAdBlockWhitelist(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    if (!this.data.adBlockWhitelist) this.data.adBlockWhitelist = [];

    const idx = this.data.adBlockWhitelist.findIndex(d => d.toLowerCase() === cleanDomain);
    let isWhitelisted = false;
    if (idx >= 0) {
      this.data.adBlockWhitelist.splice(idx, 1);
      isWhitelisted = false;
    } else {
      this.data.adBlockWhitelist.push(cleanDomain);
      isWhitelisted = true;
    }
    this.save();
    return isWhitelisted;
  }

  addAdBlockWhitelist(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    if (!this.data.adBlockWhitelist) this.data.adBlockWhitelist = [];
    if (!this.data.adBlockWhitelist.some(d => d.toLowerCase() === cleanDomain)) {
      this.data.adBlockWhitelist.push(cleanDomain);
      this.save();
    }
    return true;
  }

  removeAdBlockWhitelist(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    if (!this.data.adBlockWhitelist) return false;
    this.data.adBlockWhitelist = this.data.adBlockWhitelist.filter(d => d.toLowerCase() !== cleanDomain);
    this.save();
    return true;
  }

  // --- Shortcuts Management ---
  getShortcuts() {
    const defaults = this.getDefaultShortcuts();
    if (!this.data.shortcuts || !Array.isArray(this.data.shortcuts)) {
      this.data.shortcuts = defaults;
      this.save();
      return this.data.shortcuts;
    }
    // Merge existing with defaults in case new shortcuts were added
    const map = new Map(this.data.shortcuts.map(s => [s.id, s]));
    const merged = defaults.map(def => {
      if (map.has(def.id)) {
        const saved = map.get(def.id);
        return {
          ...def,
          key: saved.key !== undefined ? saved.key : def.key,
          enabled: saved.enabled !== undefined ? saved.enabled : def.enabled
        };
      }
      return def;
    });
    this.data.shortcuts = merged;
    return this.data.shortcuts;
  }

  updateShortcut(id, updates) {
    const shortcuts = this.getShortcuts();
    const idx = shortcuts.findIndex(s => s.id === id);
    if (idx >= 0) {
      shortcuts[idx] = {
        ...shortcuts[idx],
        ...updates
      };
      this.data.shortcuts = shortcuts;
      this.save();
      return shortcuts[idx];
    }
    return null;
  }

  toggleShortcut(id, enabled) {
    return this.updateShortcut(id, { enabled: Boolean(enabled) });
  }

  resetShortcuts() {
    this.data.shortcuts = this.getDefaultShortcuts();
    this.save();
    return this.data.shortcuts;
  }

  // --- Downloads Management ---
  getDownloads(limit = 100) {
    if (!this.data.downloads) this.data.downloads = [];
    return this.data.downloads.slice(0, limit).map(d => {
      let fn = d.filename || d.fileName || '';
      if (!fn || fn === 'download' || fn === 'Без названия' || fn.trim() === '') {
        if (d.savePath) {
          fn = path.basename(d.savePath);
        }
        if (!fn || fn === 'download') {
          try {
            const parsedUrl = new URL(d.url);
            const segs = parsedUrl.pathname.split('/').filter(Boolean);
            if (segs.length > 0) fn = decodeURIComponent(segs[segs.length - 1]);
          } catch (e) {}
        }
      }
      if (!fn) fn = 'Файл';
      return {
        ...d,
        filename: fn,
        fileName: fn,
        totalBytes: d.fileSize || d.totalBytes || d.receivedBytes || 0
      };
    });
  }

  addDownloadRecord(record) {
    if (!this.data.downloads) this.data.downloads = [];
    // If download item with same id or savePath already exists, update it
    const idx = this.data.downloads.findIndex(d => (record.id && d.id === record.id) || (record.savePath && d.savePath === record.savePath));
    
    let fn = record.filename || record.fileName || '';
    if (!fn || fn === 'download' || fn === 'Без названия' || fn.trim() === '') {
      if (record.savePath) {
        fn = path.basename(record.savePath);
      }
      if (!fn || fn === 'download') {
        try {
          const parsedUrl = new URL(record.url);
          const segs = parsedUrl.pathname.split('/').filter(Boolean);
          if (segs.length > 0) fn = decodeURIComponent(segs[segs.length - 1]);
        } catch (e) {}
      }
    }
    if (!fn) fn = 'Файл';

    const entry = {
      id: record.id || ('dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
      filename: fn,
      fileName: fn,
      url: record.url || '',
      savePath: record.savePath || '',
      fileSize: record.fileSize || record.totalBytes || 0,
      totalBytes: record.fileSize || record.totalBytes || 0,
      receivedBytes: record.receivedBytes || 0,
      state: record.state || 'completed', // 'progressing' | 'completed' | 'cancelled' | 'interrupted'
      mimeType: record.mimeType || '',
      startTime: record.startTime || Date.now(),
      completedTime: record.completedTime || (record.state === 'completed' ? Date.now() : null)
    };

    if (idx >= 0) {
      this.data.downloads[idx] = { ...this.data.downloads[idx], ...entry };
    } else {
      this.data.downloads.unshift(entry);
    }
    // Limit to 200 items
    if (this.data.downloads.length > 200) {
      this.data.downloads = this.data.downloads.slice(0, 200);
    }
    this.save();
    return entry;
  }

  removeDownloadRecord(id) {
    if (!this.data.downloads) return [];
    this.data.downloads = this.data.downloads.filter(d => d.id !== id);
    this.save();
    return this.data.downloads;
  }

  clearDownloads() {
    this.data.downloads = [];
    this.save();
    return [];
  }
}

module.exports = new StorageManager();
