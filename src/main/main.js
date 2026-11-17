const { app, BrowserWindow, session, protocol, globalShortcut, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const viewManager = require('./viewManager');
const extensionManager = require('./extensionManager');
const popupManager = require('./popupManager');
const adBlocker = require('./adBlocker');
const updateManager = require('./updateManager');
const dpiBypass = require('./dpiBypass');
const storage = require('./storage');
const defaultBrowser = require('./defaultBrowser');
const { setupIpcHandlers } = require('./ipcHandlers');

// Set Application Name & User Model ID for Windows Taskbar pinning & grouping
app.name = 'Black hole Browser';
app.setAppUserModelId('com.blackhole.browser');

// Configure System Theme and Chromium prefers-color-scheme
function applyThemeSource(theme) {
  const currentTheme = theme || storage.getTheme() || 'dark';
  const isWebsiteDark = storage.getWebsiteDarkTheme();

  if (currentTheme === 'light') {
    nativeTheme.themeSource = 'light';
  } else if (currentTheme === 'system') {
    nativeTheme.themeSource = 'system';
  } else {
    nativeTheme.themeSource = 'dark';
  }

  // Update YouTube preferences and cookies dynamically
  try {
    const theaterEnabled = storage.getYoutubeTheaterMode();
    const isThemeDark = (currentTheme === 'dark' || currentTheme === 'dark-oled' || (currentTheme === 'system' && nativeTheme.shouldUseDarkColors));
    const effectiveWebDark = isWebsiteDark && isThemeDark;
    const f6Flag = effectiveWebDark ? '400' : '0';
    const prefValue = theaterEnabled ? `f6=${f6Flag}&wide=1` : `f6=${f6Flag}&wide=0`;

    if (session.defaultSession && session.defaultSession.cookies) {
      session.defaultSession.cookies.set({
        url: 'https://www.youtube.com',
        name: 'PREF',
        value: prefValue,
        domain: '.youtube.com',
        path: '/',
        expirationDate: Math.floor(Date.now() / 1000) + 315360000
      }).catch(() => {});

      session.defaultSession.cookies.set({
        url: 'https://www.youtube.com',
        name: 'theme',
        value: effectiveWebDark ? '2' : '1',
        domain: '.youtube.com',
        path: '/',
        expirationDate: Math.floor(Date.now() / 1000) + 315360000
      }).catch(() => {});
    }
  } catch (e) {}
}

global.applyThemeSource = applyThemeSource;
applyThemeSource();

nativeTheme.on('updated', () => {
  const currentTheme = storage.getTheme();
  if (currentTheme === 'system') {
    applyThemeSource('system');
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('theme-changed', {
          theme: 'system',
          shouldUseDarkColors: nativeTheme.shouldUseDarkColors
        });
        if (win._viewManager && typeof win._viewManager.updateTheme === 'function') {
          win._viewManager.updateTheme('system');
        }
      }
    });
    if (viewManager && typeof viewManager.updateTheme === 'function') {
      viewManager.updateTheme('system');
    }
  }
});

// --- Global Crash & Process Resilience Handlers with File Logging ---
const logDir = path.join(app.getPath('userData'), 'logs');
try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
const crashLogPath = path.join(logDir, 'browser_crash.log');

function logCrash(category, message, details = null) {
  try {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${category}] ${message}${details ? '\n' + (typeof details === 'object' ? JSON.stringify(details, null, 2) : details) : ''}\n\n`;
    fs.appendFileSync(crashLogPath, entry, 'utf8');
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  console.error('[Black hole Browser] Uncaught Exception:', err);
  logCrash('UNCAUGHT_EXCEPTION', err && err.stack ? err.stack : String(err));
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Black hole Browser] Unhandled Rejection:', reason);
  logCrash('UNHANDLED_REJECTION', reason && reason.stack ? reason.stack : String(reason));
});

app.on('child-process-gone', (event, details) => {
  console.warn('[Black hole Browser] Child process exited:', details);
  if (details && details.reason !== 'clean-exit') {
    logCrash('CHILD_PROCESS_GONE', `Type: ${details.type}, Reason: ${details.reason}, ExitCode: ${details.exitCode}`, details);
  }
});

app.on('render-process-gone', (event, webContents, details) => {
  console.warn('[Black hole Browser] Render process exited:', details);
  if (details && details.reason !== 'clean-exit') {
    logCrash('RENDER_PROCESS_GONE', `Reason: ${details.reason}, ExitCode: ${details.exitCode}`, details);
  }
  // Auto-recover main browser shell if its UI renderer died
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents === webContents) {
    logCrash('MAIN_WINDOW_RECOVERY', 'Main UI renderer died, auto-reloading UI window');
    try { mainWindow.reload(); } catch (e) {}
  }
});

if (typeof app.on === 'function') {
  app.on('gpu-process-crashed', (event, killed) => {
    console.warn('[Black hole Browser] GPU process crashed, killed:', killed);
    logCrash('GPU_PROCESS_CRASHED', `killed: ${killed}`);
  });
}

// --- Remote debugging (dev) ---
if (process.argv.includes('--enable-cdp')) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// --- Performance & Chromium Optimization Switches ---
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,ParallelDownloading');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,DialMediaRouteProvider');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Chromium native background timer throttling is preserved: drastically cuts CPU/RAM when Alt-Tabbed
app.commandLine.appendSwitch('enable-background-thread-pool');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// Intelligent Process Priority & Gaming CPU Scheduler
const os = require('os');

function applyProcessPriority(isForeground) {
  try {
    const settings = storage.getSettings();
    if (settings && settings.gameOptimizationEnabled === false) return;
    if (process.platform !== 'win32') return;

    // CRITICAL: NEVER deprioritize process.pid (Main process) or GPU/Audio/Utility child processes!
    // Lowering the Main process or GPU process to BELOW_NORMAL causes the GPU watchdog to time out
    // and causes IPC heartbeat starvation, which results in the browser crashing when in Alt-Tab!

    // Instead, only optionally lower background non-audible tab renderers
    if (typeof app.getAppMetrics === 'function') {
      let isAnyMediaPlaying = false;
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed() && win._viewManager && win._viewManager.tabs) {
          for (const tab of win._viewManager.tabs.values()) {
            if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
              if (tab.view.webContents.isCurrentlyAudible() || tab.isPlayingAudio) {
                isAnyMediaPlaying = true;
                break;
              }
            }
          }
        }
        if (isAnyMediaPlaying) break;
      }

      const targetPriority = (isForeground || isAnyMediaPlaying)
        ? os.constants.priority.PRIORITY_NORMAL 
        : os.constants.priority.PRIORITY_BELOW_NORMAL;

      const metrics = app.getAppMetrics();
      for (const m of metrics) {
        // ONLY adjust Renderer/Tab processes, NEVER Main, GPU, Audio, or Utility!
        if (m && m.pid && m.pid !== process.pid && (m.type === 'Renderer' || m.type === 'Tab')) {
          try {
            os.setPriority(m.pid, targetPriority);
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
}

global.applyProcessPriority = applyProcessPriority;

let mainWindow = null;
let isAppFirstLaunch = true;

async function createWindow(options = {}) {
  const isIncognito = Boolean(options.isIncognito);
  const initialUrl = options.initialUrl;
  const initialTitle = options.initialTitle;
  const isSecondary = Boolean(options.isSecondaryWindow || initialUrl || !isAppFirstLaunch);
  const isFirstLaunch = isAppFirstLaunch && !isIncognito;
  isAppFirstLaunch = false;

  const iconPath = path.join(__dirname, '../../icon.png');
  const appIcon = nativeImage.createFromPath(iconPath);

  const windowOptions = {
    width: options.width || 1280,
    height: options.height || 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Custom sleek dark frameless titlebar
    backgroundColor: '#000000',
    icon: appIcon,
    show: false, // Show when ready to prevent white flash
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for preload IPC communication with secure contextBridge
      additionalArguments: isIncognito ? ['--is-incognito=true'] : []
    }
  };

  if (options.x !== undefined && options.y !== undefined) {
    windowOptions.x = Math.max(0, Math.round(options.x));
    windowOptions.y = Math.max(0, Math.round(options.y));
  }

  const win = new BrowserWindow(windowOptions);

  win._isIncognito = isIncognito;

  // Create dedicated ViewManager for this window
  const vm = new viewManager.ViewManager(win, { isIncognito });
  win._viewManager = vm;

  if (!mainWindow && !isIncognito) {
    mainWindow = win;
    viewManager.setMainWindow(mainWindow);
    extensionManager.setMainWindow(mainWindow);
    popupManager.setMainWindow(mainWindow);
    adBlocker.init(mainWindow);
    updateManager.init(mainWindow);
    dpiBypass.init();
  }

  // Load the top browser UI shell
  await win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', async () => {
    win.show();
    
    if (isIncognito) {
      // Create initial incognito start tab
      vm.createTab({
        url: initialUrl || 'eclipse://incognito',
        title: initialTitle || '',
        active: true
      });
    } else {
      // Ensure extensions engine is initialized
      await extensionManager.init();

      if (isSecondary || initialUrl) {
        // Subsequent window or detached tab window
        vm.createTab({
          url: initialUrl || 'eclipse://newtab',
          title: initialTitle || '',
          active: true
        });
      } else {
        // First window on app startup
        const settings = storage.getSettings();
        const savedTabs = storage.getLastOpenTabs();
        const savedGroups = storage.getTabGroups();

        if (savedGroups && Array.isArray(savedGroups)) {
          for (const g of savedGroups) {
            vm.tabGroups.set(g.id, g);
          }
        }

        const launchUrl = initialUrl || defaultBrowser.getUrlFromArgs(process.argv);

        if (launchUrl) {
          // If opened with an external link, load that link directly
          vm.createTab({
            url: launchUrl,
            active: true
          });

          // Restore remaining session tabs in background sleep mode if enabled
          if (settings.restoreSessionOnStartup && savedTabs && savedTabs.length > 0) {
            for (const t of savedTabs) {
              vm.createTab({
                url: t.url,
                title: t.title,
                favicon: t.favicon,
                isPinned: t.isPinned,
                groupId: t.groupId,
                active: false,
                isSleeping: true
              });
            }
          }
        } else if (settings.restoreSessionOnStartup && savedTabs && savedTabs.length > 0) {
          const isNewTabUrl = (url) => {
            if (!url) return true;
            const u = url.toLowerCase();
            return u.startsWith('eclipse://newtab') ||
                   u.startsWith('blackhole://newtab') ||
                   u === 'about:blank' ||
                   u.endsWith('newtab.html');
          };

          const openNewTab = settings.openNewTabOnStartup !== false;
          let targetActiveIndex = -1;

          if (openNewTab) {
            // Check if a new tab is already present in the saved session
            for (let i = savedTabs.length - 1; i >= 0; i--) {
              if (isNewTabUrl(savedTabs[i].url)) {
                targetActiveIndex = i;
                break;
              }
            }
          }

          if (openNewTab && targetActiveIndex !== -1) {
            // A new tab already exists: open directly focused on it, keep others sleeping
            for (let i = 0; i < savedTabs.length; i++) {
              const t = savedTabs[i];
              const isActive = (i === targetActiveIndex);
              vm.createTab({
                url: t.url,
                title: t.title,
                favicon: t.favicon,
                isPinned: t.isPinned,
                groupId: t.groupId,
                active: isActive,
                isSleeping: !isActive
              });
            }
          } else if (openNewTab && targetActiveIndex === -1) {
            // No new tab exists: restore saved tabs in sleep mode, then open and focus a fresh new tab!
            for (const t of savedTabs) {
              vm.createTab({
                url: t.url,
                title: t.title,
                favicon: t.favicon,
                isPinned: t.isPinned,
                groupId: t.groupId,
                active: false,
                isSleeping: true
              });
            }
            vm.createTab({
              url: 'eclipse://newtab',
              active: true,
              isSleeping: false
            });
          } else {
            // Standard restore: activate first tab, keep others sleeping
            let isFirst = true;
            for (const t of savedTabs) {
              vm.createTab({
                url: t.url,
                title: t.title,
                favicon: t.favicon,
                isPinned: t.isPinned,
                groupId: t.groupId,
                active: isFirst,
                isSleeping: !isFirst
              });
              isFirst = false;
            }
          }
        } else {
          vm.createTab({
            url: 'eclipse://newtab',
            active: true
          });
        }
      }
    }
  });

  win.on('blur', () => {
    setTimeout(() => {
      const anyFocused = BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isFocused());
      if (!anyFocused) {
        applyProcessPriority(false);
      }
    }, 250);
  });

  win.on('focus', () => {
    applyProcessPriority(true);
  });

  win.on('minimize', () => {
    applyProcessPriority(false);
    if (win._viewManager && typeof win._viewManager.setAllViewsMinimized === 'function') {
      win._viewManager.setAllViewsMinimized(true);
    }
  });

  win.on('restore', () => {
    applyProcessPriority(true);
    if (win._viewManager && typeof win._viewManager.setAllViewsMinimized === 'function') {
      win._viewManager.setAllViewsMinimized(false);
    }
  });

  win.on('closed', () => {
    vm.cleanUp();
    if (win === mainWindow) {
      const remainingWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w !== win && !w._isIncognito);
      mainWindow = remainingWindows[0] || null;
      if (mainWindow) {
        viewManager.setMainWindow(mainWindow);
        extensionManager.setMainWindow(mainWindow);
      }
    }
  });

  return win;
}

function createIncognitoWindow(initialUrl) {
  return createWindow({ isIncognito: true, initialUrl, isSecondaryWindow: true });
}

global.createBrowserWindow = createWindow;
global.createIncognitoWindow = createIncognitoWindow;

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !w._isIncognito);
    const targetWin = mainWindow || wins[0];
    if (targetWin) {
      if (targetWin.isMinimized()) targetWin.restore();
      targetWin.focus();

      const externalUrl = defaultBrowser.getUrlFromArgs(commandLine);
      if (externalUrl) {
        const vm = targetWin._viewManager || viewManager;
        vm.createTab({
          url: externalUrl,
          active: true
        });
      }
    } else {
      const externalUrl = defaultBrowser.getUrlFromArgs(commandLine);
      createWindow({ initialUrl: externalUrl });
    }
  });

  app.whenReady().then(async () => {
    // Ensure Windows knows about Eclipse capabilities for Default Browser support
    try {
      defaultBrowser.registerWindowsCapabilities();
    } catch (e) {}

    // Register custom protocol for internal browser pages (eclipse:// and blackhole://)
    const handleInternalProtocol = (request, callback) => {
      const url = request.url.replace(/^(?:eclipse|blackhole):\/\//i, '');
      const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
      if (cleanUrl === 'newtab' || cleanUrl === 'newtab.html') {
        return callback({ path: path.join(__dirname, '../renderer/newtab.html') });
      }
      if (cleanUrl === 'incognito' || cleanUrl === 'incognito.html') {
        return callback({ path: path.join(__dirname, '../renderer/incognito.html') });
      }
      if (cleanUrl === 'history' || cleanUrl === 'history.html') {
        return callback({ path: path.join(__dirname, '../renderer/history.html') });
      }
      return callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND
    };

    protocol.registerFileProtocol('eclipse', handleInternalProtocol);
    protocol.registerFileProtocol('blackhole', handleInternalProtocol);

    const defaultChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const defaultAcceptLanguages = 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7';

    app.userAgentFallback = defaultChromeUA;
    session.defaultSession.setUserAgent(defaultChromeUA, defaultAcceptLanguages);

    const setupSessionHeaders = (targetSession) => {
      if (!targetSession || !targetSession.webRequest) return;
      targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = details.requestHeaders || {};

        // 1. Ensure genuine Chrome 130 User-Agent
        requestHeaders['User-Agent'] = defaultChromeUA;

        // 2. Standard Low-Entropy Client Hints (Never send anomalous high-entropy hints like sec-ch-ua-platform-version without Accept-CH)
        requestHeaders['sec-ch-ua'] = '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"';
        requestHeaders['sec-ch-ua-mobile'] = '?0';
        requestHeaders['sec-ch-ua-platform'] = '"Windows"';

        delete requestHeaders['sec-ch-ua-platform-version'];
        delete requestHeaders['sec-ch-ua-arch'];
        delete requestHeaders['sec-ch-ua-model'];
        delete requestHeaders['sec-ch-ua-bitness'];
        delete requestHeaders['sec-ch-ua-full-version-list'];

        // 3. Ensure Accept-Language header is present and authentic
        if (!requestHeaders['Accept-Language']) {
          requestHeaders['Accept-Language'] = defaultAcceptLanguages;
        }

        callback({ requestHeaders });
      });

      targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = [
          'media',
          'geolocation',
          'notifications',
          'midi',
          'clipboard-read',
          'clipboard-sanitized-write',
          'fullscreen',
          'pointerLock',
          'mediaKeySystem',
          'display-capture'
        ];
        callback(allowed.includes(permission));
      });

      targetSession.setPermissionCheckHandler(() => true);
    };

    // Configure both default session and incognito in-memory session
    setupSessionHeaders(session.defaultSession);
    const incognitoSession = session.fromPartition('incognito');
    incognitoSession.setUserAgent(defaultChromeUA, defaultAcceptLanguages);
    setupSessionHeaders(incognitoSession);

    // Apply theme settings and configure YouTube cookies
    applyThemeSource();

    // Universal Download Manager & CRX Auto-installer
    const setupSessionDownloads = (ses) => {
      if (!ses) return;
      ses.on('will-download', (event, item, webContents) => {
        let filename = item.getFilename() || '';
        const url = item.getURL() || '';
        const totalBytes = item.getTotalBytes() || 0;
        const mimeType = item.getMimeType() || '';
        const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        if (filename.endsWith('.crx')) {
          const tempPath = path.join(app.getPath('temp'), `ext_${Date.now()}_${filename}`);
          item.setSavePath(tempPath);
          item.once('done', async (e, state) => {
            if (state === 'completed') {
              await extensionManager.installFromZipOrCrx(tempPath);
            }
          });
          return;
        }

        const resolveFileName = () => {
          let fn = item.getFilename() || filename;
          if (!fn || fn === 'download' || fn === 'Без названия') {
            const sp = item.getSavePath();
            if (sp) fn = path.basename(sp);
          }
          if (!fn || fn === 'download') {
            try {
              const u = new URL(url);
              const segs = u.pathname.split('/').filter(Boolean);
              if (segs.length > 0) fn = decodeURIComponent(segs[segs.length - 1]);
            } catch (e) {}
          }
          return fn || 'Файл';
        };

        const initialRecord = {
          id: downloadId,
          filename: resolveFileName(),
          fileName: resolveFileName(),
          url,
          savePath: item.getSavePath() || '',
          fileSize: totalBytes,
          totalBytes: totalBytes,
          receivedBytes: 0,
          state: 'progressing',
          mimeType,
          startTime: Date.now()
        };
        storage.addDownloadRecord(initialRecord);

        // Notify all browser windows
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('download-updated', initialRecord);
          }
        });

        item.on('updated', (e, state) => {
          const currentFilename = resolveFileName();
          const updatedRecord = {
            id: downloadId,
            filename: currentFilename,
            fileName: currentFilename,
            url,
            savePath: item.getSavePath() || '',
            fileSize: item.getTotalBytes(),
            totalBytes: item.getTotalBytes(),
            receivedBytes: item.getReceivedBytes(),
            state: state === 'interrupted' ? 'interrupted' : 'progressing',
            mimeType
          };
          storage.addDownloadRecord(updatedRecord);
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('download-updated', updatedRecord);
            }
          });
        });

        item.once('done', (e, state) => {
          const currentFilename = resolveFileName();
          const finalRecord = {
            id: downloadId,
            filename: currentFilename,
            fileName: currentFilename,
            url,
            savePath: item.getSavePath() || '',
            fileSize: item.getTotalBytes(),
            totalBytes: item.getTotalBytes(),
            receivedBytes: item.getReceivedBytes(),
            state: state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'interrupted'),
            mimeType,
            completedTime: Date.now()
          };
          storage.addDownloadRecord(finalRecord);
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('download-updated', finalRecord);
            }
          });

          // Show floating VirusTotal toast over active page
          if (state === 'completed' && finalRecord.savePath) {
            popupManager.showVirusTotalToast(finalRecord);
          }
        });
      });
    };

    setupSessionDownloads(session.defaultSession);
    try {
      setupSessionDownloads(session.fromPartition('incognito'));
    } catch (e) {}

    // Handle certificate errors gracefully
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
      event.preventDefault();
      callback(true);
    });

    // Initialize global IPC handlers
    setupIpcHandlers(null);

    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
