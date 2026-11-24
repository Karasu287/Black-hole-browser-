const { ipcRenderer, webFrame, contextBridge } = require('electron');

// Expose safe Electron API for internal browser pages (eclipse://, blackhole://, internal file pages)
try {
  const isInternal = window.location.protocol === 'eclipse:' ||
                     window.location.protocol === 'blackhole:' ||
                     (window.location.protocol === 'file:' && (
                       window.location.pathname.includes('renderer') ||
                       window.location.pathname.endsWith('history.html') ||
                       window.location.pathname.endsWith('downloads.html') ||
                       window.location.pathname.endsWith('newtab.html') ||
                       window.location.pathname.endsWith('incognito.html')
                     ));

  if (isInternal && contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
    contextBridge.exposeInMainWorld('electronAPI', {
      getHistory: (limit) => ipcRenderer.invoke('history-get', limit),
      clearHistory: () => ipcRenderer.invoke('history-clear'),
      removeHistoryItem: (idOrUrl) => ipcRenderer.invoke('history-remove-item', idOrUrl),
      getDownloads: (limit) => ipcRenderer.invoke('downloads-get', limit),
      clearDownloads: () => ipcRenderer.invoke('downloads-clear'),
      removeDownloadItem: (id) => ipcRenderer.invoke('downloads-remove-item', id),
      openDownloadFile: (filePath) => ipcRenderer.invoke('downloads-open-file', filePath),
      showDownloadInFolder: (filePath) => ipcRenderer.invoke('downloads-show-in-folder', filePath),
      openDownloadsFolder: () => ipcRenderer.invoke('downloads-open-folder'),
      getDownloadFileIcon: (filePath) => ipcRenderer.invoke('downloads-get-file-icon', filePath),
      startDownloadDrag: (filePath) => ipcRenderer.send('downloads-start-drag', filePath),
      endDownloadDrag: () => ipcRenderer.send('downloads-end-drag'),
      onDownloadUpdated: (callback) => {
        ipcRenderer.on('download-updated', (event, data) => callback(data));
      },
      getSettings: () => ipcRenderer.invoke('settings-get'),
      updateSettings: (settings) => ipcRenderer.invoke('settings-update', settings),
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
      navigate: (url) => ipcRenderer.invoke('nav-navigate', url),
      createTab: (options) => ipcRenderer.invoke('tabs-create', options),
      closeTab: (id) => ipcRenderer.invoke('tabs-close', id),
      openExternal: (url) => ipcRenderer.invoke('open-external', url),
      checkVirusTotal: (filePathOrUrl) => ipcRenderer.invoke('check-virustotal', filePathOrUrl)
    });
  }
} catch (e) {
  console.warn('Failed to expose internal electronAPI:', e);
}

// Shield: Block guest web pages from calling window.close() to kill tabs/browser
try {
  if (!window.opener) {
    window.close = function() {
      console.warn('[Black hole Shield] Blocked isolated window.close() call');
    };
  }
} catch (e) {}

// Neon theme sync for tabs and floating PiP
function applyTabNeonColor(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return;
  let c = hexColor.trim().replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (c.length !== 6) return;
  const num = parseInt(c, 16);
  if (isNaN(num)) return;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const hoverR = Math.min(255, Math.floor(r * 1.18));
  const hoverG = Math.min(255, Math.floor(g * 1.18));
  const hoverB = Math.min(255, Math.floor(b * 1.18));
  const hoverHex = `#${((1 << 24) + (hoverR << 16) + (hoverG << 8) + hoverB).toString(16).slice(1)}`;

  const setVars = () => {
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty('--pip-neon-color', hexColor);
      root.style.setProperty('--pip-neon-hover', hoverHex);
      root.style.setProperty('--pip-neon-glow', `rgba(${r}, ${g}, ${b}, 0.5)`);
      root.style.setProperty('--pip-neon-glow-strong', `rgba(${r}, ${g}, ${b}, 0.8)`);
    }
  };
  if (document.documentElement) {
    setVars();
  } else {
    document.addEventListener('DOMContentLoaded', setVars, { once: true });
  }
}

try {
  ipcRenderer.on('neon-theme-changed', (event, data) => {
    if (data && data.neonThemeColor) {
      applyTabNeonColor(data.neonThemeColor);
    }
  });
  ipcRenderer.on('settings-changed', (event, s) => {
    if (s && s.neonThemeColor) {
      applyTabNeonColor(s.neonThemeColor);
    }
  });
  ipcRenderer.invoke('settings-get').then(s => {
    if (s && s.neonThemeColor) {
      applyTabNeonColor(s.neonThemeColor);
    }
  }).catch(() => {});
} catch (e) {}

// Google Account, WAF & Anti-Detection Native Stealth Engine
function initStealthAndAntiDetection() {
  const stealthScript = `
    (function() {
      if (window.__eclipse_stealth_injected__) return;
      window.__eclipse_stealth_injected__ = true;

      // 1. Native toString Protection Engine
      const nativeFunctions = new WeakMap();
      const origToString = Function.prototype.toString;

      const makeNative = function(fn, name) {
        if (!fn || typeof fn !== 'function') return fn;
        const fnName = name || fn.name || '';
        nativeFunctions.set(fn, 'function ' + fnName + '() { [native code] }');
        return fn;
      };

      try {
        Function.prototype.toString = function toString() {
          if (nativeFunctions.has(this)) {
            return nativeFunctions.get(this);
          }
          return origToString.call(this);
        };
        makeNative(Function.prototype.toString, 'toString');
      } catch (e) {}

      window.__eclipse_make_native__ = makeNative;

      // 2. Hide navigator.webdriver completely & naturally
      try {
        const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
        if ('webdriver' in navProto || 'webdriver' in navigator) {
          Object.defineProperty(navProto, 'webdriver', {
            get: makeNative(function webdriver() { return undefined; }, 'get webdriver'),
            set: undefined,
            enumerable: true,
            configurable: true
          });
        }
        try { delete navigator.webdriver; } catch(e) {}
      } catch (e) {}

      // 3. Realistic Native PluginArray & MimeTypeArray (5 Plugins, 2 MimeTypes matching Chrome on Windows)
      try {
        const mimeTypesData = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
        ];

        const pluginsData = [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
        ];

        const pluginArray = Object.create(PluginArray.prototype);
        const mimeTypeArray = Object.create(MimeTypeArray.prototype);

        const plugins = pluginsData.map(p => {
          const plug = Object.create(Plugin.prototype);
          Object.defineProperties(plug, {
            name: { value: p.name, enumerable: true },
            filename: { value: p.filename, enumerable: true },
            description: { value: p.description, enumerable: true },
            length: { value: 2, enumerable: true }
          });
          return plug;
        });

        const mimeTypes = mimeTypesData.map(m => {
          const mime = Object.create(MimeType.prototype);
          Object.defineProperties(mime, {
            type: { value: m.type, enumerable: true },
            suffixes: { value: m.suffixes, enumerable: true },
            description: { value: m.description, enumerable: true },
            enabledPlugin: { value: plugins[0], enumerable: true }
          });
          return mime;
        });

        plugins.forEach((plug, i) => {
          Object.defineProperty(pluginArray, i, { value: plug, enumerable: true });
          Object.defineProperty(pluginArray, plug.name, { value: plug, enumerable: false });
          Object.defineProperty(plug, 0, { value: mimeTypes[0], enumerable: true });
          Object.defineProperty(plug, 1, { value: mimeTypes[1], enumerable: true });
          Object.defineProperty(plug, mimeTypes[0].type, { value: mimeTypes[0], enumerable: false });
          Object.defineProperty(plug, mimeTypes[1].type, { value: mimeTypes[1], enumerable: false });
        });
        Object.defineProperty(pluginArray, 'length', { value: plugins.length, enumerable: true });
        Object.defineProperty(pluginArray, 'item', { value: makeNative(function item(index) { return plugins[index] || null; }, 'item') });
        Object.defineProperty(pluginArray, 'namedItem', { value: makeNative(function namedItem(name) { return pluginArray[name] || null; }, 'namedItem') });
        Object.defineProperty(pluginArray, 'refresh', { value: makeNative(function refresh() {}, 'refresh') });

        mimeTypes.forEach((mime, i) => {
          Object.defineProperty(mimeTypeArray, i, { value: mime, enumerable: true });
          Object.defineProperty(mimeTypeArray, mime.type, { value: mime, enumerable: false });
        });
        Object.defineProperty(mimeTypeArray, 'length', { value: mimeTypes.length, enumerable: true });
        Object.defineProperty(mimeTypeArray, 'item', { value: makeNative(function item(index) { return mimeTypes[index] || null; }, 'item') });
        Object.defineProperty(mimeTypeArray, 'namedItem', { value: makeNative(function namedItem(name) { return mimeTypeArray[name] || null; }, 'namedItem') });

        const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
        Object.defineProperty(navProto, 'plugins', { get: makeNative(function plugins() { return pluginArray; }, 'get plugins'), enumerable: true, configurable: true });
        Object.defineProperty(navProto, 'mimeTypes', { get: makeNative(function mimeTypes() { return mimeTypeArray; }, 'get mimeTypes'), enumerable: true, configurable: true });
      } catch (e) {}

      // 4. Languages and Locale Settings
      try {
        const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
        const languagesList = Object.freeze(['ru-RU', 'ru', 'en-US', 'en']);
        Object.defineProperty(navProto, 'languages', { get: makeNative(function languages() { return languagesList; }, 'get languages'), enumerable: true, configurable: true });
        Object.defineProperty(navProto, 'language', { get: makeNative(function language() { return 'ru-RU'; }, 'get language'), enumerable: true, configurable: true });
        Object.defineProperty(navProto, 'vendor', { get: makeNative(function vendor() { return 'Google Inc.'; }, 'get vendor'), enumerable: true, configurable: true });
      } catch (e) {}

      // 4.1. Authentic navigator.userAgentData (Chrome 130 Windows 64-bit Client Hints)
      try {
        const brandsData = Object.freeze([
          { brand: 'Chromium', version: '130' },
          { brand: 'Google Chrome', version: '130' },
          { brand: 'Not?A_Brand', version: '99' }
        ]);
        const fullVersionListData = Object.freeze([
          { brand: 'Chromium', version: '130.0.6723.70' },
          { brand: 'Google Chrome', version: '130.0.6723.70' },
          { brand: 'Not?A_Brand', version: '99.0.0.0' }
        ]);

        const fakeUaData = {
          brands: brandsData,
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: makeNative(function getHighEntropyValues(hints) {
            return Promise.resolve({
              architecture: 'x86',
              bitness: '64',
              brands: brandsData,
              fullVersionList: fullVersionListData,
              mobile: false,
              model: '',
              platform: 'Windows',
              platformVersion: '15.0.0',
              uaFullVersion: '130.0.6723.70',
              wow64: false
            });
          }, 'getHighEntropyValues'),
          toJSON: makeNative(function toJSON() {
            return {
              brands: brandsData,
              mobile: false,
              platform: 'Windows'
            };
          }, 'toJSON')
        };

        const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
        Object.defineProperty(navProto, 'userAgentData', {
          get: makeNative(function userAgentData() { return fakeUaData; }, 'get userAgentData'),
          enumerable: true,
          configurable: true
        });
        try {
          Object.defineProperty(navigator, 'userAgentData', {
            get: makeNative(function userAgentData() { return fakeUaData; }, 'get userAgentData'),
            enumerable: true,
            configurable: true
          });
        } catch (e) {}
      } catch (e) {}

      // 5. Authentic window.chrome Object & Performance APIs
      try {
        if (!window.chrome) {
          window.chrome = {};
        }

        if (!window.chrome.app) {
          window.chrome.app = {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            getDetails: makeNative(function getDetails() { return null; }, 'getDetails'),
            getIsInstalled: makeNative(function getIsInstalled() { return false; }, 'getIsInstalled'),
            installState: makeNative(function installState(cb) { if (typeof cb === 'function') cb('not_installed'); }, 'installState'),
            runningState: makeNative(function runningState() { return 'cannot_run'; }, 'runningState')
          };
        }

        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
            PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
            RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
            connect: makeNative(function connect() { return { disconnect: function() {}, onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {} }; }, 'connect'),
            sendMessage: makeNative(function sendMessage() {}, 'sendMessage'),
            id: undefined
          };
        }

        if (!window.chrome.csi) {
          window.chrome.csi = makeNative(function csi() {
            return {
              startE: Date.now(),
              onloadT: Date.now() + 50,
              pageT: 50.12,
              tran: 15
            };
          }, 'csi');
        }

        if (!window.chrome.loadTimes) {
          window.chrome.loadTimes = makeNative(function loadTimes() {
            const now = Date.now() / 1000;
            return {
              requestTime: now,
              startLoadTime: now,
              commitLoadTime: now + 0.05,
              finishDocumentLoadTime: now + 0.1,
              finishLoadTime: now + 0.15,
              firstPaintTime: now + 0.08,
              firstPaintAfterLoadTime: 0,
              navigationType: 'Other',
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
              npnNegotiatedProtocol: 'h2',
              wasAlternateProtocolAvailable: false,
              connectionInfo: 'h2'
            };
          }, 'loadTimes');
        }

        if (!window.chrome.management) {
          window.chrome.management = {
            get: makeNative(function(id, cb) { if (typeof cb === 'function') { try { cb(null); } catch (e) {} } return Promise.resolve(null); }, 'get'),
            getAll: makeNative(function(cb) { if (typeof cb === 'function') { try { cb([]); } catch (e) {} } return Promise.resolve([]); }, 'getAll'),
            getSelf: makeNative(function(cb) { if (typeof cb === 'function') { try { cb(null); } catch (e) {} } return Promise.resolve(null); }, 'getSelf'),
            setEnabled: makeNative(function(id, enabled, cb) { if (typeof cb === 'function') { try { cb(); } catch (e) {} } return Promise.resolve(); }, 'setEnabled'),
            uninstall: makeNative(function(id, options, cb) { if (typeof cb === 'function') { try { cb(); } catch (e) {} } return Promise.resolve(); }, 'uninstall')
          };
        }

        function triggerWebstoreInstall(extId, details) {
          if (!extId) {
            var match = window.location.pathname.match(/\/detail\/(?:[^\/]+\/)?([a-z]{32})/i) ||
                        window.location.href.match(/([a-z]{32})/i);
            if (match) extId = match[1];
          }
          if (extId) {
            window.dispatchEvent(new CustomEvent('eclipse-webstore-install', {
              detail: { id: extId, details: details }
            }));
          }
        }

        if (!window.chrome.webstore) {
          window.chrome.webstore = {
            install: makeNative(function install(url, successCb, failureCb) {
              var match = (url || '').match(/([a-z]{32})/i) || window.location.href.match(/([a-z]{32})/i);
              var extId = match ? match[1] : null;
              if (extId) {
                triggerWebstoreInstall(extId, null);
                if (typeof successCb === 'function') { try { successCb(); } catch (e) {} }
              } else if (typeof failureCb === 'function') {
                try { failureCb('No extension ID found'); } catch (e) {}
              }
            }, 'install'),
            onInstallStageChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
            onDownloadProgress: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
          };
        }

        if (!window.chrome.webstorePrivate) {
          window.chrome.webstorePrivate = {
            getExtensionStatus: makeNative(function getExtensionStatus(extId, manifestOrCb, maybeCb) {
              var cb = typeof maybeCb === 'function' ? maybeCb : (typeof manifestOrCb === 'function' ? manifestOrCb : null);
              if (cb) { try { cb('can_install'); } catch (err) {} }
              return Promise.resolve('can_install');
            }, 'getExtensionStatus'),
            beginInstallWithManifest3: makeNative(function beginInstallWithManifest3(details, cb) {
              var extId = (details && details.id) ? details.id : details;
              triggerWebstoreInstall(extId, details);
              if (typeof cb === 'function') { try { cb(''); } catch (err) {} }
              return Promise.resolve('');
            }, 'beginInstallWithManifest3'),
            install: makeNative(function install(extId, cb) {
              triggerWebstoreInstall(extId, null);
              if (typeof cb === 'function') { try { cb(''); } catch (err) {} }
              return Promise.resolve('');
            }, 'install'),
            completeInstall: makeNative(function completeInstall(id, cb) {
              if (typeof cb === 'function') { try { cb(''); } catch (err) {} }
              return Promise.resolve('');
            }, 'completeInstall'),
            enableAppList: makeNative(function enableAppList(cb) { if (typeof cb === 'function') { try { cb(); } catch (err) {} } return Promise.resolve(); }, 'enableAppList'),
            getIsLauncherEnabled: makeNative(function getIsLauncherEnabled(cb) { if (typeof cb === 'function') { try { cb(false); } catch (err) {} } return Promise.resolve(false); }, 'getIsLauncherEnabled'),
            getReferrerChain: makeNative(function getReferrerChain(cb) { if (typeof cb === 'function') { try { cb('EgIIAA=='); } catch (err) {} } return Promise.resolve('EgIIAA=='); }, 'getReferrerChain'),
            isExtensionInstalled: makeNative(function isExtensionInstalled(extId, cb) { if (typeof cb === 'function') { try { cb(false); } catch (err) {} } return Promise.resolve(false); }, 'isExtensionInstalled'),
            isInIncognitoMode: makeNative(function isInIncognitoMode(cb) { if (typeof cb === 'function') { try { cb(false); } catch (err) {} } return Promise.resolve(false); }, 'isInIncognitoMode'),
            getWebGLStatus: makeNative(function getWebGLStatus(cb) { if (typeof cb === 'function') { try { cb('webgl_allowed'); } catch (err) {} } return Promise.resolve('webgl_allowed'); }, 'getWebGLStatus'),
            getBrowserLogin: makeNative(function getBrowserLogin(cb) { var res = { login: '' }; if (typeof cb === 'function') { try { cb(res); } catch (err) {} } return Promise.resolve(res); }, 'getBrowserLogin'),
            getStoreLogin: makeNative(function getStoreLogin(cb) { if (typeof cb === 'function') { try { cb(''); } catch (err) {} } return Promise.resolve(''); }, 'getStoreLogin'),
            setStoreLogin: makeNative(function setStoreLogin(login, cb) { if (typeof cb === 'function') { try { cb(); } catch (err) {} } return Promise.resolve(); }, 'setStoreLogin')
          };
        }
      } catch (e) {}

      // 6. Permissions API stealth (Standard Prompt State for Notifications)
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const origQuery = navigator.permissions.query;
          navigator.permissions.query = makeNative(function query(parameters) {
            if (parameters && parameters.name === 'notifications') {
              return Promise.resolve({
                state: Notification.permission === 'granted' ? 'granted' : (Notification.permission === 'denied' ? 'denied' : 'prompt'),
                onchange: null
              });
            }
            return origQuery.apply(this, arguments);
          }, 'query');
        }

        try {
          if (!window.opener) {
            window.close = function() {
              console.warn('[Black hole Shield] Blocked main world window.close() call');
            };
          }
        } catch (e) {}
      } catch (e) {}
    })();
  `;

  try {
    webFrame.executeJavaScript(stealthScript).catch(() => {});
  } catch (e) {}
}

initStealthAndAntiDetection();

// 1. Listen for autofill command from main process
ipcRenderer.on('fill-credentials', (event, credentials) => {
  if (!credentials || !credentials.length) return;
  const cred = credentials[0];

  function tryFill() {
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    if (passwordInputs.length === 0) return false;

    const pwdInput = passwordInputs[0];
    let userInput = null;
    const form = pwdInput.closest('form');
    if (form) {
      userInput = form.querySelector('input[type="text"], input[type="email"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[autocomplete="username"]');
    }
    if (!userInput) {
      const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"]'));
      userInput = allInputs.find(i => i.compareDocumentPosition(pwdInput) & Node.DOCUMENT_POSITION_FOLLOWING) || allInputs[0];
    }

    if (userInput && cred.username && !userInput.value) {
      userInput.value = cred.username;
      userInput.dispatchEvent(new Event('input', { bubbles: true }));
      userInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (pwdInput && cred.password && !pwdInput.value) {
      pwdInput.value = cred.password;
      pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
      pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  if (!tryFill()) {
    setTimeout(tryFill, 500);
    setTimeout(tryFill, 1500);
  }
});

// 2. Listen for login / password form submission
function captureAndSend(form, pwdInput) {
  if (!pwdInput || !pwdInput.value) return;

  let userInput = null;
  if (form) {
    userInput = form.querySelector('input[type="text"], input[type="email"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[autocomplete="username"]');
  }
  if (!userInput) {
    const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"]'));
    userInput = allInputs.find(i => i.compareDocumentPosition(pwdInput) & Node.DOCUMENT_POSITION_FOLLOWING) || allInputs[0];
  }

  const username = userInput ? userInput.value.trim() : '';
  const password = pwdInput.value;
  const origin = window.location.origin;

  if (password && origin && origin.startsWith('http')) {
    ipcRenderer.send('detected-credentials', { origin, username, password });
  }
}

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!form || typeof form.querySelectorAll !== 'function') return;
  const pwdInput = form.querySelector('input[type="password"]');
  captureAndSend(form, pwdInput);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.type === 'password') {
    const pwdInput = e.target;
    captureAndSend(pwdInput.closest('form'), pwdInput);
  }
}, true);

// 3. Chrome Web Store Native API Bridge & Universal Installer Engine
function initChromeWebStoreBridge() {
  function isWebStorePage() {
    try {
      const host = (window.location.hostname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();
      return host.includes('chromewebstore.google.com') ||
             host.includes('chrome.google.com') ||
             href.includes('chromewebstore.google.com') ||
             href.includes('chrome.google.com');
    } catch (e) {
      return false;
    }
  }

  // Zero-overhead guard: do not attach body MutationObserver or intervals on non-WebStore pages!
  if (!isWebStorePage()) return;

  function getExtensionIdFromUrl() {
    try {
      const match = (window.location.pathname || '').match(/\/detail\/(?:[^\/]+\/)?([a-z]{32})/i) ||
                    (window.location.href || '').match(/([a-z]{32})/i);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  // Toast Notification Helper
  function showToast(message, type = 'info') {
    try {
      let toast = document.getElementById('eclipse-cws-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'eclipse-cws-toast';
        toast.style.cssText = `
          position: fixed;
          top: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2147483647;
          background: #0f111a;
          color: #f8fafc;
          border: 1px solid rgba(255,255,255,0.18);
          padding: 12px 24px;
          border-radius: 12px;
          box-shadow: 0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(168, 85, 247, 0.4);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 10px;
          pointer-events: none;
          transition: opacity 0.3s ease, transform 0.3s ease;
        `;
        (document.body || document.documentElement).appendChild(toast);
      }

      if (type === 'success') {
        toast.style.borderColor = '#10b981';
        toast.style.boxShadow = '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(16, 185, 129, 0.5)';
      } else if (type === 'error') {
        toast.style.borderColor = '#ef4444';
        toast.style.boxShadow = '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(239, 68, 68, 0.5)';
      } else {
        toast.style.borderColor = '#a855f7';
        toast.style.boxShadow = '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(168, 85, 247, 0.5)';
      }

      toast.innerHTML = message;
      toast.style.opacity = '1';

      if (toast._timer) clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        if (toast) {
          toast.style.opacity = '0';
          setTimeout(() => { toast.remove(); }, 300);
        }
      }, 5000);
    } catch (e) {}
  }

  let isInstalling = false;
  async function performInstall(extId) {
    if (isInstalling || !extId) return;
    isInstalling = true;

    showToast('⏳ Скачивание и установка расширения...', 'info');

    try {
      const res = await ipcRenderer.invoke('extensions-install-from-webstore', extId);
      if (res && res.success) {
        const extName = (res.extension && res.extension.name) || 'Расширение';
        showToast(`🎉 <strong>${extName}</strong> успешно установлено в Black hole Browser!`, 'success');
        updateInjectedButtons(true);
      } else {
        showToast(`❌ Ошибка установки: ${(res && res.error) || 'Неизвестная ошибка'}`, 'error');
      }
    } catch (err) {
      showToast(`❌ Ошибка: ${err.message}`, 'error');
    } finally {
      setTimeout(() => { isInstalling = false; }, 2000);
    }
  }

  // 1. Listen for install events dispatched from chrome.webstorePrivate in Main World
  window.addEventListener('eclipse-webstore-install', (e) => {
    const extId = (e.detail && e.detail.id) || getExtensionIdFromUrl();
    if (extId) {
      performInstall(extId);
    }
  });

  function hideAlertSafely(el) {
    if (!el || el === document.body || el === document.documentElement || el.tagName === 'MAIN' || el.tagName === 'BODY' || el.tagName === 'HTML' || el.id === 'eclipse-cws-injected-bar') return;
    if (el.querySelector('h1, cws-install-button, #eclipse-cws-injected-bar')) return;
    
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('height', '0px', 'important');
    el.style.setProperty('min-height', '0px', 'important');
    el.style.setProperty('max-height', '0px', 'important');
    el.style.setProperty('padding', '0px', 'important');
    el.style.setProperty('margin', '0px', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
  }

  // 2. Safe Shadow DOM scanner & banner suppressor & button enabler
  function scanNodeAndShadows(root) {
    if (!root) return;
    try {
      // 1. Hide only exact alert custom elements if present and not containing main headers
      const alerts = root.querySelectorAll('cws-alert, [role="alert"]');
      for (const a of alerts) {
        hideAlertSafely(a);
      }

      // 2. Target specific red banner containers containing "Открыть руководство", "Open guide", or unavailable warnings
      const candidates = root.querySelectorAll('div, section, aside, a, button, span, p');
      for (const el of candidates) {
        if (el.id === 'eclipse-cws-injected-bar') continue;
        const txt = (el.textContent || '').trim();
        const isAlertText = (
          txt.includes('Открыть руководство') ||
          txt.includes('Open guide') ||
          txt.includes('руководством по устранению') ||
          txt.includes('руководство') && (txt.includes('устранени') || txt.includes('неполадок')) ||
          txt.includes('Продукт недоступен') ||
          txt.includes('не поддерживается в вашем браузере') ||
          txt.includes('troubleshoot')
        );

        if (isAlertText && txt.length < 320) {
          // Find outermost wrapper for this alert/guide banner that does NOT include h1 or install buttons
          let targetToHide = el;
          let p = el.parentElement;
          while (p && p !== document.body && p !== document.documentElement && p.tagName !== 'MAIN' && !p.querySelector('h1, cws-install-button')) {
            if (p.tagName.toLowerCase().includes('alert') || p.getAttribute('role') === 'alert' || (p.offsetHeight > 0 && p.offsetHeight < 140)) {
              targetToHide = p;
            }
            p = p.parentElement;
          }
          hideAlertSafely(targetToHide);
        }
      }

      // 3. Enable disabled install buttons in shadow roots & attach click listener
      const buttons = root.querySelectorAll('button, [role="button"], cws-install-button');
      for (const btn of buttons) {
        const txt = (btn.textContent || '').trim();
        const aria = btn.getAttribute('aria-label') || '';
        if (
          txt === 'Установить' ||
          txt === 'Add to Chrome' ||
          txt === 'Установить в Chrome' ||
          txt === 'Добавить в Chrome' ||
          aria.includes('Установить') ||
          aria.includes('Add to Chrome')
        ) {
          if (btn.hasAttribute('disabled')) btn.removeAttribute('disabled');
          if (btn.getAttribute('aria-disabled') === 'true') btn.setAttribute('aria-disabled', 'false');
          btn.style.pointerEvents = 'auto';
          btn.style.cursor = 'pointer';
          btn.style.opacity = '1';

          if (!btn._eclipseClickAttached) {
            btn._eclipseClickAttached = true;
            btn.addEventListener('click', () => {
              const curId = getExtensionIdFromUrl();
              if (curId) performInstall(curId);
            });
          }
        }
      }

      // 4. Recurse into open shadow roots
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          scanNodeAndShadows(el.shadowRoot);
        }
      }
    } catch (e) {}
  }

  function suppressErrorBanners() {
    if (!isWebStorePage()) return;
    scanNodeAndShadows(document);
  }

  // 3. Inject custom "Install in Black hole Browser" button on detail pages
  function updateInjectedButtons(isInstalled = false) {
    if (!isWebStorePage()) {
      const existingBar = document.getElementById('eclipse-cws-injected-bar');
      if (existingBar) existingBar.remove();
      return;
    }

    try {
      const extId = getExtensionIdFromUrl();
      if (!extId) {
        const existingBar = document.getElementById('eclipse-cws-injected-bar');
        if (existingBar) existingBar.remove();
        return;
      }

      let customBar = document.getElementById('eclipse-cws-injected-bar');
      if (!customBar) {
        customBar = document.createElement('div');
        customBar.id = 'eclipse-cws-injected-bar';
        customBar.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483646;
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(11, 13, 20, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(168, 85, 247, 0.4);
          padding: 10px 18px;
          border-radius: 14px;
          box-shadow: 0 12px 36px rgba(0,0,0,0.8), 0 0 20px rgba(168, 85, 247, 0.25);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const btn = document.createElement('button');
        btn.id = 'eclipse-cws-install-btn';
        btn.style.cssText = `
          background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
          color: #ffffff;
          border: none;
          padding: 10px 20px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        `;
        btn.innerHTML = `<span>⚡</span><span>Установить в Black Hole</span>`;
        btn.addEventListener('mouseenter', () => {
          btn.style.filter = 'brightness(1.1)';
          btn.style.transform = 'translateY(-1px)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.filter = 'none';
          btn.style.transform = 'none';
        });
        btn.addEventListener('click', () => {
          const currentId = getExtensionIdFromUrl();
          if (currentId) {
            btn.innerHTML = `<span>⏳</span><span>Установка...</span>`;
            performInstall(currentId);
          }
        });

        customBar.appendChild(btn);
        (document.body || document.documentElement).appendChild(customBar);
      } else {
        const btn = document.getElementById('eclipse-cws-install-btn');
        if (btn && isInstalled) {
          btn.innerHTML = `<span>✓</span><span>Установлено</span>`;
          btn.style.background = '#10b981';
          btn.style.boxShadow = '0 4px 15px rgba(16, 185, 129, 0.4)';
        }
      }
    } catch (e) {}
  }

  // 4. Fallback click capture: if a user clicks ANY button that says "Установить" or "Add to Chrome", start installation
  document.addEventListener('click', (e) => {
    if (!isWebStorePage()) return;
    const target = e.target;
    if (!target) return;
    const btn = target.closest('button, div[role="button"], a[role="button"], cws-install-button');
    if (!btn || btn.id === 'eclipse-cws-install-btn') return;

    const text = (btn.textContent || '').trim();
    const ariaLabel = btn.getAttribute('aria-label') || '';

    const isInstallBtn = (
      text === 'Установить' ||
      text === 'Add to Chrome' ||
      text === 'Установить в Chrome' ||
      text === 'Добавить в Chrome' ||
      ariaLabel.includes('Установить') ||
      ariaLabel.includes('Add to Chrome') ||
      ariaLabel.includes('Добавить в Chrome')
    );

    if (isInstallBtn) {
      const extId = getExtensionIdFromUrl();
      if (extId) {
        setTimeout(() => {
          if (!isInstalling) {
            performInstall(extId);
          }
        }, 50);
      }
    }
  }, true);

  // 5. MutationObserver & Periodic Check
  const observer = new MutationObserver(() => {
    suppressErrorBanners();
    updateInjectedButtons();
  });

  function startObserver() {
    suppressErrorBanners();
    updateInjectedButtons();
    const target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  setInterval(() => {
    suppressErrorBanners();
    updateInjectedButtons();
  }, 250);

  // SPA navigation handling
  window.addEventListener('popstate', () => {
    setTimeout(updateInjectedButtons, 200);
  });
}

initChromeWebStoreBridge();

// 4. YouTube Theater Mode (Широкий экран) Preference Engine
function initYouTubeTheaterMode() {
  try {
    const host = window.location.hostname.toLowerCase();
    const isYouTube = host.includes('youtube.com') || host.includes('youtu.be');
    if (!isYouTube) return;

    let persistentPref = true;
    try {
      persistentPref = ipcRenderer.sendSync('get-yt-theater-mode-sync');
    } catch (e) {
      try {
        const local = localStorage.getItem('eclipse_yt_theater_mode');
        persistentPref = local === null ? true : (local === 'true');
      } catch (err) {}
    }

    const ytTheaterScript = `
      (function() {
        if (window.__eclipse_yt_theater_injected__) return;
        window.__eclipse_yt_theater_injected__ = true;

        const STORAGE_KEY = 'eclipse_yt_theater_mode';

        try {
          const desired = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'true' : 'false';
          if (localStorage.getItem('yt-dark-mode-pref') !== desired) {
            localStorage.setItem('yt-dark-mode-pref', desired);
          }
        } catch (e) {}

        function savePref(isTheater) {
          try {
            localStorage.setItem(STORAGE_KEY, isTheater ? 'true' : 'false');
            localStorage.setItem('wide', isTheater ? '1' : '0');
            
            try {
              let sticky = localStorage.getItem('yt-player-sticky-settings');
              let obj = sticky ? JSON.parse(sticky) : { values: {} };
              if (!obj.values) obj.values = {};
              obj.values.wide = Boolean(isTheater);
              localStorage.setItem('yt-player-sticky-settings', JSON.stringify(obj));
            } catch (err) {}

            window.dispatchEvent(new CustomEvent('eclipse-yt-theater-changed', {
              detail: { isTheater: Boolean(isTheater) }
            }));
          } catch (e) {}
        }

        // Listen for user clicks on size button or 't' key
        document.addEventListener('click', (e) => {
          const btn = e.target && e.target.closest('button.ytp-size-button');
          if (btn) {
            setTimeout(() => {
              const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
              const isTheater = watchFlexy && (watchFlexy.hasAttribute('theater') || watchFlexy.theater === true);
              savePref(Boolean(isTheater));
            }, 100);
          }
        }, true);

        document.addEventListener('keydown', (e) => {
          if (e.key === 't' || e.key === 'T') {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
            setTimeout(() => {
              const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
              const isTheater = watchFlexy && (watchFlexy.hasAttribute('theater') || watchFlexy.theater === true);
              savePref(Boolean(isTheater));
            }, 100);
          }
        }, true);
      })();
    `;

    webFrame.executeJavaScript(ytTheaterScript);

    // Forward preference changes to main process
    window.addEventListener('eclipse-yt-theater-changed', (e) => {
      const isTheater = e.detail && e.detail.isTheater;
      ipcRenderer.send('set-yt-theater-mode', isTheater);
    });
  } catch (e) {
    console.warn('Failed to inject YouTube theater mode engine:', e);
  }
}

// 5. YouTube Comment Like & Anti-Scroll Jump Engine
function initYouTubeCommentFixEngine() {
  try {
    const host = window.location.hostname.toLowerCase();
    const isYouTube = host.includes('youtube.com') || host.includes('youtu.be');
    if (!isYouTube) return;

    const ytCommentFixScript = `
      (function() {
        if (window.__eclipse_yt_comment_fix_injected__) return;
        window.__eclipse_yt_comment_fix_injected__ = true;

        let targetScrollY = 0;
        let lockScrollUntil = 0;

        // User intentional scrolling (mouse wheel, touch gesture) releases lock
        window.addEventListener('wheel', () => { lockScrollUntil = 0; }, { passive: true, capture: true });
        window.addEventListener('touchmove', () => { lockScrollUntil = 0; }, { passive: true, capture: true });

        function isCommentAction(target) {
          if (!target || typeof target.closest !== 'function') return false;
          return Boolean(
            target.closest('ytd-comments, #comments, ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer, ytd-comment-action-buttons-renderer, #like-button, #dislike-button, ytd-toggle-button-renderer') ||
            target.closest('[aria-label*="Нравится" i], [aria-label*="Like" i], [aria-label*="дизлайк" i], [aria-label*="Dislike" i], [aria-label*="Ответить" i], [aria-label*="Reply" i]')
          );
        }

        function armScrollLock(e) {
          if (isCommentAction(e.target)) {
            targetScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
            lockScrollUntil = Date.now() + 1000;
          }
        }

        document.addEventListener('pointerdown', armScrollLock, true);
        document.addEventListener('mousedown', armScrollLock, true);
        document.addEventListener('click', armScrollLock, true);

        // Override HTMLElement.prototype.focus to prevent YouTube focus management from jumping viewport
        const origFocus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function(options) {
          if (Date.now() < lockScrollUntil) {
            if (typeof options === 'object' && options !== null) {
              options.preventScroll = true;
            } else {
              options = { preventScroll: true };
            }
          }
          return origFocus.call(this, options);
        };

        // Override Element.prototype.scrollIntoView to prevent snapping to #header or #comments
        const origScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function() {
          if (Date.now() < lockScrollUntil) {
            const id = (this.id || '').toLowerCase();
            const tag = (this.tagName || '').toLowerCase();
            if (
              id === 'header' || id === 'comments' || tag === 'ytd-comments' || id === 'title' ||
              (typeof this.closest === 'function' && this.closest('ytd-comments, #comments'))
            ) {
              return;
            }
          }
          return origScrollIntoView.apply(this, arguments);
        };

        // If viewport jumps significantly while locked, immediately restore scroll position
        window.addEventListener('scroll', function() {
          if (Date.now() < lockScrollUntil && targetScrollY > 0) {
            const curY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
            if (Math.abs(curY - targetScrollY) > 20) {
              window.scrollTo({
                top: targetScrollY,
                left: window.scrollX,
                behavior: 'instant'
              });
            }
          }
        }, { passive: false });
      })();
    `;

    webFrame.executeJavaScript(ytCommentFixScript);
  } catch (e) {
    console.warn('[Eclipse] Failed to inject YouTube comment fix engine:', e);
  }
}

// 6. Universal Picture-in-Picture (PiP Pro) Engine
function initPictureInPictureEngine() {
  // --- A. Main World PiP & MediaSession Injection Script ---
  const mainWorldPipScript = `
    (function() {
      if (window.__eclipse_pip_main_world_injected__) return;
      window.__eclipse_pip_main_world_injected__ = true;

      // 1. Helper to find active video
      function getActiveVideo() {
        if (document.pictureInPictureElement && document.pictureInPictureElement.tagName === 'VIDEO') {
          return document.pictureInPictureElement;
        }
        const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (ytPlayer) {
          const v = ytPlayer.querySelector('video');
          if (v) return v;
        }
        const videos = Array.from(document.querySelectorAll('video'));
        return videos.find(v => !v.paused && v.currentTime > 0 && !v.ended) ||
               videos.find(v => !v.paused) ||
               videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] ||
               null;
      }

      // 2. Safe Seek Functions (calls YouTube native player API if present)
      function doSeek(offsetSeconds) {
        try {
          const ytPlayer = document.getElementById('movie_player');
          if (ytPlayer && typeof ytPlayer.seekBy === 'function') {
            ytPlayer.seekBy(offsetSeconds);
            syncMediaSessionState();
            return;
          }
        } catch (e) {}
        const v = getActiveVideo();
        if (v) {
          const maxTime = v.duration || Infinity;
          v.currentTime = Math.max(0, Math.min(maxTime, v.currentTime + offsetSeconds));
          syncMediaSessionState();
        }
      }

      function doSeekTo(seekTime) {
        try {
          const ytPlayer = document.getElementById('movie_player');
          if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
            ytPlayer.seekTo(seekTime, true);
            syncMediaSessionState();
            return;
          }
        } catch (e) {}
        const v = getActiveVideo();
        if (v) {
          v.currentTime = Math.max(0, Math.min(v.duration || seekTime, seekTime));
          syncMediaSessionState();
        }
      }

      // 3. Complete MediaSession Synchronizer (PlaybackState, Metadata, PositionState)
      let _lastMediaSyncTime = 0;
      function syncMediaSessionState(force = false) {
        try {
          if (!('mediaSession' in navigator)) return;
          const now = Date.now();
          if (!force && (now - _lastMediaSyncTime < 1000)) return;
          _lastMediaSyncTime = now;

          const v = getActiveVideo();
          if (!v) return;

          // A. Keep playbackState updated ('playing' / 'paused') - NEVER let it stay 'none'
          navigator.mediaSession.playbackState = v.paused ? 'paused' : 'playing';

          // B. Set position state for scrubbable timeline
          if (typeof navigator.mediaSession.setPositionState === 'function') {
            try {
              const dur = v.duration;
              if (typeof dur === 'number' && !isNaN(dur) && isFinite(dur) && dur > 0) {
                const cur = v.currentTime || 0;
                const pos = Math.max(0, Math.min(cur, dur));
                const rate = (typeof v.playbackRate === 'number' && v.playbackRate > 0) ? v.playbackRate : 1;
                navigator.mediaSession.setPositionState({
                  duration: dur,
                  playbackRate: rate,
                  position: pos
                });
              }
            } catch (posErr) {}
          }

          // C. Ensure MediaMetadata is populated
          try {
            if (!navigator.mediaSession.metadata || !navigator.mediaSession.metadata.title) {
              let title = document.title ? document.title.replace(/ - YouTube$/, '').trim() : 'Video';
              let artist = 'Black Hole Browser';
              const ytPlayer = document.getElementById('movie_player');
              if (ytPlayer && typeof ytPlayer.getVideoData === 'function') {
                const data = ytPlayer.getVideoData();
                if (data && data.title) title = data.title;
                if (data && data.author) artist = data.author;
              }
              navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: 'Black Hole Browser'
              });
            }
          } catch (mErr) {}
        } catch (e) {}
      }

      // 4. Register complete MediaSession handlers on Chromium MediaSession
      const origSetActionHandler = (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function')
        ? navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
        : null;

      function registerPipMediaHandlers() {
        if (!origSetActionHandler) return;
        try {
          // Play / Pause
          origSetActionHandler('play', () => {
            const v = getActiveVideo();
            if (v && v.paused) v.play().catch(() => {});
            syncMediaSessionState();
          });
          origSetActionHandler('pause', () => {
            const v = getActiveVideo();
            if (v && !v.paused) v.pause();
            syncMediaSessionState();
          });

          // Seek Backward (-10s) & Seek Forward (+10s)
          origSetActionHandler('seekbackward', (details) => {
            const offset = (details && details.seekOffset) || 10;
            doSeek(-offset);
          });
          origSetActionHandler('seekforward', (details) => {
            const offset = (details && details.seekOffset) || 10;
            doSeek(offset);
          });

          // Previous / Next track в PiP Chromium работают как кнопки перемотки на -10с и +10с
          origSetActionHandler('previoustrack', () => {
            doSeek(-10);
          });
          origSetActionHandler('nexttrack', () => {
            doSeek(10);
          });

          // Seek To (Scrubber timeline)
          origSetActionHandler('seekto', (details) => {
            if (details && typeof details.seekTime === 'number') {
              doSeekTo(details.seekTime);
            }
          });
        } catch (e) {}
      }

      if (navigator.mediaSession && origSetActionHandler) {
        navigator.mediaSession.setActionHandler = function(action, handler) {
          // Не даем YouTube затереть наши обработчики перемотки
          if (action === 'seekbackward' || action === 'seekforward' || action === 'seekto' || action === 'previoustrack' || action === 'nexttrack') {
            return;
          }

          return origSetActionHandler.call(this, action, handler);
        };

        registerPipMediaHandlers();
        setInterval(() => {
          syncMediaSessionState();
        }, 1000);
      }

      // 4.1. Вспомогательная функция регулировки громкости видео
      function adjustVideoVolume(delta) {
        const v = getActiveVideo();
        try {
          const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
          if (ytPlayer && typeof ytPlayer.getVolume === 'function' && typeof ytPlayer.setVolume === 'function') {
            if (delta > 0 && typeof ytPlayer.isMuted === 'function' && ytPlayer.isMuted()) {
              ytPlayer.unMute();
            }
            const current = ytPlayer.getVolume();
            const target = Math.max(0, Math.min(100, Math.round(current + delta * 100)));
            ytPlayer.setVolume(target);
            if (target === 0 && typeof ytPlayer.mute === 'function') {
              ytPlayer.mute();
            }
            if (v) v.volume = target / 100;
            return;
          }
        } catch (e) {}
        if (v) {
          if (delta > 0 && v.muted) v.muted = false;
          const target = Math.max(0, Math.min(1, Math.round((v.volume + delta) * 100) / 100));
          v.volume = target;
          if (target === 0) v.muted = true;
        }
      }

      function isUserTyping(target) {
        const active = document.activeElement;
        const elements = [target, active].filter(Boolean);
        for (const el of elements) {
          const tag = (el.tagName || '').toUpperCase();
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
          if (el.isContentEditable) return true;
          if (typeof el.closest === 'function') {
            if (el.closest('input, textarea, select, [contenteditable="true"], #search-input, ytd-commentbox, yt-formatted-string[contenteditable], [role="textbox"]')) {
              return true;
            }
          }
        }
        return false;
      }

      // Жесткая привязка стрелок на клавиатуре:
      // Влево / Вправо — ВСЕГДА и ТОЛЬКО перемотка видео на 5 секунд.
      // Вверх / Вниз — ВСЕГДА и ТОЛЬКО громкость (+5% / -5%).
      // Никаких случайных подмен громкости при фокусе на ползунке громкости YouTube!
      window.addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

        if (isUserTyping(e.target)) return;

        const v = getActiveVideo();
        if (!v) return;

        const isYouTube = window.location.hostname.includes('youtube.com');
        const isPip = document.pictureInPictureElement === v;
        const isFullscreen = Boolean(document.fullscreenElement && (document.fullscreenElement.contains(v) || document.fullscreenElement === v));
        const isPlayerFocused = Boolean(document.activeElement && (document.activeElement.closest && (document.activeElement.closest('#movie_player') || document.activeElement.closest('.html5-video-player'))));

        if (!isYouTube && !isPip && !isFullscreen && !isPlayerFocused) {
          return;
        }

        // Перехватываем событие в фазе capture, чтобы YouTube не перепутал стрелки при фокусе на слайдере громкости
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Снимаем фокус с элементов управления громкостью, если пользователь на них кликал
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          if (document.activeElement.closest && (document.activeElement.closest('.ytp-volume-area') || document.activeElement.closest('.ytp-volume-panel') || document.activeElement.closest('.ytp-mute-button'))) {
            document.activeElement.blur();
          }
        }

        if (e.key === 'ArrowLeft') {
          doSeek(-5);
        } else if (e.key === 'ArrowRight') {
          doSeek(5);
        } else if (e.key === 'ArrowUp') {
          adjustVideoVolume(0.05);
        } else if (e.key === 'ArrowDown') {
          adjustVideoVolume(-0.05);
        }
      }, true);

      // Регулировка звука колесиком мыши:
      // Применяется только в Picture-in-Picture, Fullscreen или при наведении непосредственно на регулятор громкости,
      // чтобы не ломать и не блокировать обычный скроллинг страницы на YouTube
      window.addEventListener('wheel', (e) => {
        const v = getActiveVideo();
        if (!v) return;
        const isPip = document.pictureInPictureElement === v;
        const isFullscreen = Boolean(document.fullscreenElement && (document.fullscreenElement.contains(v) || document.fullscreenElement === v));
        const isOverVolumeSlider = Boolean(e.target && e.target.closest && (e.target.closest('.ytp-volume-area') || e.target.closest('.ytp-volume-panel') || e.target.closest('[class*="volume"]')));

        if (isPip || isFullscreen || isOverVolumeSlider) {
          if (e.deltaY < 0) {
            adjustVideoVolume(0.05);
          } else if (e.deltaY > 0) {
            adjustVideoVolume(-0.05);
          }
        }
      }, { passive: true });

      // 5. Hook all video elements
      function hookVideo(video) {
        if (!video || video.__eclipse_pip_hooked__) return;
        video.__eclipse_pip_hooked__ = true;

        try {
          if (video.disablePictureInPicture) {
            video.disablePictureInPicture = false;
          }
        } catch (e) {}

        const events = ['play', 'pause', 'playing', 'seeking', 'seeked', 'ratechange', 'durationchange'];
        events.forEach(evt => {
          video.addEventListener(evt, () => {
            syncMediaSessionState(true);
          }, { passive: true });
        });
        video.addEventListener('timeupdate', () => {
          syncMediaSessionState(false);
        }, { passive: true });

        video.addEventListener('enterpictureinpicture', () => {
          registerPipMediaHandlers();
          syncMediaSessionState(true);
          const pipTimer = setInterval(() => {
            if (!document.pictureInPictureElement) {
              clearInterval(pipTimer);
              return;
            }
            syncMediaSessionState(false);
          }, 1000);
        }, { passive: true });
      }

      document.querySelectorAll('video').forEach(hookVideo);
      try {
        let _videoScanTimer = null;
        const obs = new MutationObserver(() => {
          if (_videoScanTimer) return;
          _videoScanTimer = setTimeout(() => {
            _videoScanTimer = null;
            document.querySelectorAll('video').forEach(hookVideo);
          }, 600);
        });
        const root = document.documentElement || document.body;
        if (root) obs.observe(root, { childList: true, subtree: true });
      } catch (e) {}

      // 6. Custom Black Hole Picture-in-Picture Engine
      async function toggleCustomPip(video) {
        if (!video) return;
        try {
          if (video.disablePictureInPicture) {
            video.disablePictureInPicture = false;
          }
          registerPipMediaHandlers();
          syncMediaSessionState();

          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else {
            await video.requestPictureInPicture();
          }
          syncMediaSessionState();
        } catch (err) {
          console.warn('[Eclipse] toggleCustomPip error:', err);
        }
      }

      window.__eclipse_toggle_pip__ = function() {
        const v = getActiveVideo();
        if (v) toggleCustomPip(v);
      };

      // 7. Dedicated YouTube Top-Center PiP Floating Button
      function getYouTubePlayer() {
        return document.getElementById('movie_player') ||
               document.querySelector('.html5-video-player') ||
               document.querySelector('ytd-player') ||
               document.querySelector('#player');
      }

      let pipHideTimer = null;

      function showYouTubePipBtn(delay = 2000) {
        const player = getYouTubePlayer();
        const btn = document.getElementById('yt-floating-pip-button');
        if (!btn || !player) return;
        if (btn.parentElement !== player) {
          player.appendChild(btn);
        }

        const video = player.querySelector('video') || document.querySelector('video');
        const isPip = Boolean(document.pictureInPictureElement && (document.pictureInPictureElement === video || document.pictureInPictureElement.tagName === 'VIDEO'));
        const label = btn.querySelector('.yt-pip-label');
        if (label) label.textContent = isPip ? 'Вернуть видео' : 'Картинка в картинке';

        btn.classList.add('visible');

        if (pipHideTimer) clearTimeout(pipHideTimer);
        if (delay > 0) {
          pipHideTimer = setTimeout(() => {
            if (!btn.matches(':hover')) {
              btn.classList.remove('visible');
            }
          }, delay);
        }
      }

      function hideYouTubePipBtnNow() {
        const btn = document.getElementById('yt-floating-pip-button');
        if (btn && !btn.matches(':hover')) {
          if (pipHideTimer) clearTimeout(pipHideTimer);
          btn.classList.remove('visible');
        }
      }

      function setupYouTubeButton() {
        const isYT = (window.location.hostname || '').includes('youtube') || Boolean(document.getElementById('movie_player'));
        if (!isYT) return;

        const player = getYouTubePlayer();
        if (!player) return;

        const styleId = 'eclipse-yt-pip-main-styles';
        if (!document.getElementById(styleId)) {
          const st = document.createElement('style');
          st.id = styleId;
          st.textContent = [
            '#yt-floating-pip-button {',
            '  position: absolute !important;',
            '  top: 14px !important;',
            '  left: 50% !important;',
            '  transform: translateX(-50%) translateY(-6px) !important;',
            '  z-index: 2147483647 !important;',
            '  display: flex !important;',
            '  align-items: center !important;',
            '  gap: 8px !important;',
            '  padding: 7px 18px !important;',
            '  border-radius: 24px !important;',
            '  background: rgba(10, 10, 18, 0.94) !important;',
            '  backdrop-filter: blur(16px) !important;',
            '  -webkit-backdrop-filter: blur(16px) !important;',
            '  border: 1.5px solid var(--pip-neon-color, rgba(168, 85, 247, 0.85)) !important;',
            '  color: #ffffff !important;',
            '  font-family: -apple-system, BlinkMacSystemFont, "YouTube Sans", Roboto, sans-serif !important;',
            '  font-size: 13px !important;',
            '  font-weight: 600 !important;',
            '  letter-spacing: 0.2px !important;',
            '  cursor: pointer !important;',
            '  user-select: none !important;',
            '  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.85), 0 0 18px var(--pip-neon-glow, rgba(168, 85, 247, 0.5)) !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '  transition: opacity 0.25s ease, transform 0.25s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;',
            '}',
            '#yt-floating-pip-button.visible, #yt-floating-pip-button:hover {',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '  transform: translateX(-50%) translateY(0) scale(1) !important;',
            '}',
            '#yt-floating-pip-button:hover {',
            '  transform: translateX(-50%) translateY(0) scale(1.04) !important;',
            '  background: rgba(22, 22, 36, 0.98) !important;',
            '  border-color: var(--pip-neon-hover, #c084fc) !important;',
            '  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.95), 0 0 24px var(--pip-neon-glow-strong, rgba(168, 85, 247, 0.8)) !important;',
            '}',
            '#yt-floating-pip-button:active {',
            '  transform: translateX(-50%) scale(0.97) !important;',
            '}',
            '#yt-floating-pip-button svg {',
            '  width: 16px !important;',
            '  height: 16px !important;',
            '  flex-shrink: 0 !important;',
            '  color: var(--pip-neon-hover, #c084fc) !important;',
            '}'
          ].join('\\n');
          (document.head || document.documentElement).appendChild(st);
        }

        let btn = document.getElementById('yt-floating-pip-button');
        if (!btn) {
          btn = document.createElement('div');
          btn.id = 'yt-floating-pip-button';
          // DOM API instead of innerHTML (YouTube Trusted Types CSP blocks innerHTML)
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('width', '16');
          svg.setAttribute('height', '16');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor');
          svg.setAttribute('stroke-width', '2');
          svg.setAttribute('stroke-linecap', 'round');
          svg.setAttribute('stroke-linejoin', 'round');
          const rect1 = document.createElementNS(svgNS, 'rect');
          rect1.setAttribute('x', '2'); rect1.setAttribute('y', '3');
          rect1.setAttribute('width', '20'); rect1.setAttribute('height', '14');
          rect1.setAttribute('rx', '2'); rect1.setAttribute('ry', '2');
          svg.appendChild(rect1);
          const rect2 = document.createElementNS(svgNS, 'rect');
          rect2.setAttribute('x', '11'); rect2.setAttribute('y', '9');
          rect2.setAttribute('width', '9'); rect2.setAttribute('height', '7');
          rect2.setAttribute('rx', '1'); rect2.setAttribute('ry', '1');
          rect2.setAttribute('fill', '#a855f7'); rect2.setAttribute('fill-opacity', '0.55');
          svg.appendChild(rect2);
          btn.appendChild(svg);
          const pipLabel = document.createElement('span');
          pipLabel.className = 'yt-pip-label';
          pipLabel.textContent = 'Картинка в картинке';
          btn.appendChild(pipLabel);

          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            try {
              const p = getYouTubePlayer();
              const video = (p && p.querySelector('video')) || document.querySelector('video');
              if (video) await toggleCustomPip(video);
            } catch (err) {
              console.warn('[Eclipse] YouTube PiP click error:', err);
            }
          }, true);

          btn.addEventListener('mouseenter', () => {
            if (pipHideTimer) clearTimeout(pipHideTimer);
            btn.classList.add('visible');
          });
          btn.addEventListener('mouseleave', () => {
            if (pipHideTimer) clearTimeout(pipHideTimer);
            pipHideTimer = setTimeout(hideYouTubePipBtnNow, 2000);
          });
        }

        if (btn.parentElement !== player) {
          player.appendChild(btn);
        }

        const currentVideo = player.querySelector('video') || document.querySelector('video');
        if (currentVideo) {
          hookVideo(currentVideo);
          syncMediaSessionState();
        }
      }

      // Отслеживание мыши: показываем кнопку только при наведении на верхнюю зону плеера
      let lastMouseMoveTime = 0;
      window.addEventListener('mousemove', (e) => {
        const now = Date.now();
        if (now - lastMouseMoveTime < 35) return;
        lastMouseMoveTime = now;

        const player = getYouTubePlayer();
        if (!player || !player.isConnected) return;

        const rect = player.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 60) return;

        const isInsidePlayer = (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        );
        if (!isInsidePlayer) {
          hideYouTubePipBtnNow();
          return;
        }

        // Верхняя часть видео: верхние 30% плеера (минимум 80px, максимум 180px)
        const topThreshold = Math.max(80, Math.min(rect.height * 0.30, 180));
        const isInTopArea = (e.clientY <= rect.top + topThreshold);

        if (isInTopArea) {
          showYouTubePipBtn(2000);
        } else {
          const btn = document.getElementById('yt-floating-pip-button');
          if (btn && btn.classList.contains('visible') && !btn.matches(':hover') && !pipHideTimer) {
            pipHideTimer = setTimeout(hideYouTubePipBtnNow, 600);
          }
        }
      }, { passive: true, capture: true });

      // 8. Alt+P hotkey within page & custom event listeners
      window.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyP' || e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З')) {
          const activeTag = (document.activeElement && document.activeElement.tagName) || '';
          if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const v = getActiveVideo();
          if (v) toggleCustomPip(v);
        }
      }, true);

      document.addEventListener('eclipse-toggle-pip-request', async () => {
        try {
          const v = getActiveVideo();
          if (v) await toggleCustomPip(v);
        } catch(e) {
          console.warn('[Eclipse] toggle-pip error:', e);
        }
      });
      window.addEventListener('eclipse-toggle-pip-request', async () => {
        try {
          const v = getActiveVideo();
          if (v) await toggleCustomPip(v);
        } catch(e) {
          console.warn('[Eclipse] toggle-pip error:', e);
        }
      });

      setupYouTubeButton();
      setInterval(setupYouTubeButton, 1000);
      window.addEventListener('yt-navigate-finish', () => {
        setupYouTubeButton();
        showYouTubePipBtn(2000);
      });
      window.addEventListener('yt-page-data-updated', () => {
        setupYouTubeButton();
      });
      window.addEventListener('DOMContentLoaded', setupYouTubeButton);
      let _pObsTimer = null;
      function startObserving() {
        const root = document.documentElement || document.body;
        if (root) {
          try {
            const pObs = new MutationObserver(() => {
              if (_pObsTimer) return;
              _pObsTimer = setTimeout(() => {
                _pObsTimer = null;
                setupYouTubeButton();
              }, 400);
            });
            pObs.observe(root, { childList: true, subtree: true });
          } catch (e) {}
        } else {
          document.addEventListener('DOMContentLoaded', startObserving, { once: true });
        }
      }
      startObserving();
    })();
  `;

  function injectMainWorldScript() {
    try {
      if (typeof webFrame.executeJavaScriptInIsolatedWorld === 'function') {
        webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: mainWorldPipScript }]).catch(() => {});
      } else {
        webFrame.executeJavaScript(mainWorldPipScript).catch(() => {});
      }
    } catch (e) {}
  }

  injectMainWorldScript();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMainWorldScript, { once: true });
  }

  // --- B. Isolated World Helpers (Universal fallback & IPC bridge) ---
  ipcRenderer.on('toggle-pip', () => {
    try {
      if (typeof webFrame.executeJavaScriptInIsolatedWorld === 'function') {
        webFrame.executeJavaScriptInIsolatedWorld(0, [{
          code: `
            (function() {
              if (typeof window.__eclipse_toggle_pip__ === 'function') {
                window.__eclipse_toggle_pip__();
              } else {
                const v = document.querySelector('video');
                if (v) {
                  if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(() => {});
                  } else {
                    v.requestPictureInPicture().catch(() => {});
                  }
                }
              }
            })();
          `
        }]).catch(() => {});
      }
      document.dispatchEvent(new CustomEvent('eclipse-toggle-pip-request'));
      window.dispatchEvent(new CustomEvent('eclipse-toggle-pip-request'));
    } catch (e) {}
  });

  // Auto-PiP on Tab Switch
  ipcRenderer.on('pip-auto-enter', () => {
    try {
      if (document.pictureInPictureElement) return;
      const videos = Array.from(document.querySelectorAll('video'));
      const activeVideo = videos.find(v => !v.paused && v.currentTime > 0 && !v.ended);
      if (activeVideo) {
        if (activeVideo.disablePictureInPicture) {
          activeVideo.disablePictureInPicture = false;
        }
        activeVideo._autoPipActive = true;
        activeVideo.requestPictureInPicture().catch(() => {
          activeVideo._autoPipActive = false;
        });
      }
    } catch (e) {}
  });

  ipcRenderer.on('pip-auto-exit', () => {
    try {
      if (document.pictureInPictureElement && document.pictureInPictureElement._autoPipActive) {
        document.pictureInPictureElement._autoPipActive = false;
        document.exitPictureInPicture().catch(() => {});
      }
    } catch (e) {}
  });

  // Universal PiP floating button for non-YouTube websites (Twitch, Rutube, VK Video, Kinopoisk, etc.)
  function injectPiPFloatingButton() {
    const isYT = (window.location.hostname || '').includes('youtube.com');
    if (isYT) return; // YouTube handled natively by dedicated YouTube PiP engine

    const styleId = 'eclipse-pip-floating-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .eclipse-pip-btn {
          position: absolute;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 18px;
          border-radius: 24px;
          background: rgba(10, 10, 18, 0.94);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1.5px solid var(--pip-neon-color, rgba(168, 85, 247, 0.85));
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.2px;
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          transform: translateX(-50%) translateY(-6px);
          transition: opacity 0.25s ease, transform 0.25s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.85), 0 0 18px var(--pip-neon-glow, rgba(168, 85, 247, 0.5));
          user-select: none;
        }
        .eclipse-pip-btn.visible, .eclipse-pip-btn:hover {
          opacity: 1 !important;
          pointer-events: auto !important;
          transform: translateX(-50%) translateY(0) scale(1) !important;
        }
        .eclipse-pip-btn:hover {
          transform: translateX(-50%) translateY(0) scale(1.04) !important;
          background: rgba(22, 22, 36, 0.98) !important;
          border-color: var(--pip-neon-hover, #c084fc) !important;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.95), 0 0 24px var(--pip-neon-glow-strong, rgba(168, 85, 247, 0.8)) !important;
        }
        .eclipse-pip-btn:active {
          transform: translateX(-50%) scale(0.97) !important;
        }
        .eclipse-pip-btn svg {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          color: var(--pip-neon-hover, #c084fc);
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    let hideTimer = null;
    let currentHoveredVideo = null;

    function getOrCreateBtn() {
      let btn = document.getElementById('eclipse-floating-pip-button');
      if (!btn) {
        btn = document.createElement('div');
        btn.id = 'eclipse-floating-pip-button';
        btn.className = 'eclipse-pip-btn';
        // DOM API instead of innerHTML (safe for Trusted Types CSP)
        const svgNS2 = 'http://www.w3.org/2000/svg';
        const svg2 = document.createElementNS(svgNS2, 'svg');
        svg2.setAttribute('viewBox', '0 0 24 24');
        svg2.setAttribute('width', '16');
        svg2.setAttribute('height', '16');
        svg2.setAttribute('fill', 'none');
        svg2.setAttribute('stroke', 'currentColor');
        svg2.setAttribute('stroke-width', '2');
        svg2.setAttribute('stroke-linecap', 'round');
        svg2.setAttribute('stroke-linejoin', 'round');
        const r1 = document.createElementNS(svgNS2, 'rect');
        r1.setAttribute('x', '2'); r1.setAttribute('y', '3');
        r1.setAttribute('width', '20'); r1.setAttribute('height', '14');
        r1.setAttribute('rx', '2'); r1.setAttribute('ry', '2');
        svg2.appendChild(r1);
        const r2 = document.createElementNS(svgNS2, 'rect');
        r2.setAttribute('x', '11'); r2.setAttribute('y', '9');
        r2.setAttribute('width', '9'); r2.setAttribute('height', '7');
        r2.setAttribute('rx', '1'); r2.setAttribute('ry', '1');
        r2.setAttribute('fill', '#a855f7'); r2.setAttribute('fill-opacity', '0.55');
        svg2.appendChild(r2);
        btn.appendChild(svg2);
        const pipText = document.createElement('span');
        pipText.className = 'eclipse-pip-text';
        pipText.textContent = 'Картинка в картинке';
        btn.appendChild(pipText);
        document.body.appendChild(btn);

        btn.addEventListener('mouseenter', () => {
          if (hideTimer) clearTimeout(hideTimer);
          btn.classList.add('visible');
        });

        btn.addEventListener('mouseleave', () => {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (!btn.matches(':hover')) {
              btn.classList.remove('visible');
            }
          }, 2000);
        });

        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.preventDefault();
          const targetVideo = currentHoveredVideo || document.querySelector('video');
          if (targetVideo) {
            try {
              if (targetVideo.disablePictureInPicture) {
                targetVideo.disablePictureInPicture = false;
              }
              if (document.pictureInPictureElement === targetVideo || document.pictureInPictureElement) {
                await document.exitPictureInPicture();
              } else {
                await targetVideo.requestPictureInPicture();
              }
            } catch (err) {
              console.warn('[Eclipse] Universal PiP button click error:', err);
            }
          }
        });
      }
      return btn;
    }

    function positionBtnForVideo(video, pRect) {
      if (!video) return;
      pRect = pRect || video.getBoundingClientRect();
      if (pRect.width < 140 || pRect.height < 80) return;

      const isFullscreen = Boolean(document.fullscreenElement);
      const container = document.fullscreenElement || document.body;
      const btn = getOrCreateBtn();
      if (btn.parentElement !== container) {
        container.appendChild(btn);
      }

      currentHoveredVideo = video;

      const isPip = Boolean(document.pictureInPictureElement && (document.pictureInPictureElement === video || document.pictureInPictureElement.tagName === 'VIDEO'));
      const textEl = btn.querySelector('.eclipse-pip-text');
      if (textEl) {
        textEl.textContent = isPip ? 'Вернуть видео' : 'Картинка в картинке';
      }

      if (isFullscreen) {
        btn.style.position = 'fixed';
        btn.style.top = '14px';
        btn.style.left = '50%';
        btn.style.transform = 'translateX(-50%)';
      } else {
        const top = Math.max(10, pRect.top + window.scrollY + 14);
        const centerX = pRect.left + window.scrollX + (pRect.width / 2);

        btn.style.position = 'absolute';
        btn.style.top = top + 'px';
        btn.style.left = centerX + 'px';
        btn.style.transform = 'translateX(-50%)';
      }

      btn.classList.add('visible');
    }

    // Отслеживание курсора: кнопка появляется только при наведении на верхнюю треть видео
    let lastUniversalMoveTime = 0;
    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastUniversalMoveTime < 35) return;
      lastUniversalMoveTime = now;

      const target = e.target;
      if (!target) return;

      const btn = document.getElementById('eclipse-floating-pip-button');
      if (btn && (btn === target || btn.contains(target))) {
        if (hideTimer) clearTimeout(hideTimer);
        btn.classList.add('visible');
        return;
      }

      // Специальные селекторы для популярных видеоплатформ: Twitch, VK Видео, Rutube, Кинопоиск, Дзен
      const video = target.tagName === 'VIDEO' ? target : (typeof target.closest === 'function' ? target.closest('video') : null);
      const playerContainer = typeof target.closest === 'function' ? target.closest(
        '.video-player__container, .video-player, [data-a-target="video-player"], ' +
        '.videoplayer, .videoplayer_media, .video_box, [id*="video_player"], ' +
        '[class*="playertv"], [class*="player-container"], .rutube-player, ' +
        '[class*="PlayerContainer"], [class*="stream-player"], [class*="kinopoisk-player"], ' +
        '[class*="zen-video"], .video-js, [data-player], .player-container, #player, .player'
      ) : null;
      const foundVideo = video || (playerContainer ? playerContainer.querySelector('video') : null);

      if (foundVideo) {
        const pRect = (playerContainer || foundVideo).getBoundingClientRect();
        if (pRect.width < 140 || pRect.height < 80) return;

        // Верхняя часть видео: верхние 32% плеера (минимум 70px, максимум 180px)
        const topThreshold = Math.max(70, Math.min(pRect.height * 0.32, 180));
        const isInTopArea = (e.clientY <= pRect.top + topThreshold);

        if (isInTopArea) {
          positionBtnForVideo(foundVideo, pRect);
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (btn && !btn.matches(':hover')) {
              btn.classList.remove('visible');
            }
          }, 2000); // Ровно 2 секунды
        } else {
          if (btn && btn.classList.contains('visible') && !btn.matches(':hover') && !hideTimer) {
            hideTimer = setTimeout(() => {
              if (btn && !btn.matches(':hover')) {
                btn.classList.remove('visible');
              }
            }, 600);
          }
        }
      } else {
        if (btn && btn.classList.contains('visible') && !btn.matches(':hover')) {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (btn && !btn.matches(':hover')) {
              btn.classList.remove('visible');
            }
          }, 500);
        }
      }
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPiPFloatingButton);
  } else {
    injectPiPFloatingButton();
  }
}

try { initYouTubeTheaterMode(); } catch(e) { console.warn(e); }
try { initYouTubeCommentFixEngine(); } catch(e) { console.warn(e); }
try { initPictureInPictureEngine(); } catch(e) { console.warn(e); }

// 7. Universal Context Menu Media Sniffer & Image/Video Processing Engine
function initContextMenuMediaSniffer() {
  function getBestImageSrc(imgEl) {
    if (!imgEl) return null;
    
    // 1. Check data attributes for high-res / original versions
    const highResAttrs = [
      'data-original', 'data-src', 'data-zoom-image', 'data-large-image',
      'data-highres', 'data-full-image', 'data-original-src', 'data-full-url',
      'data-hi-res', 'data-url', 'data-lazy-src'
    ];
    for (const attr of highResAttrs) {
      const val = imgEl.getAttribute(attr);
      if (val && (val.startsWith('http') || val.startsWith('//') || val.startsWith('data:image'))) {
        return val.startsWith('//') ? window.location.protocol + val : val;
      }
    }

    // 2. Parse srcset attribute to find the largest resolution image
    const srcset = imgEl.getAttribute('srcset') || imgEl.srcset;
    if (srcset && typeof srcset === 'string') {
      try {
        const candidates = srcset.split(',').map(s => {
          const parts = s.trim().split(/\s+/);
          const url = parts[0];
          let width = 0;
          if (parts[1]) {
            if (parts[1].endsWith('w')) width = parseInt(parts[1], 10) || 0;
            else if (parts[1].endsWith('x')) width = (parseFloat(parts[1]) || 1) * 1000;
          }
          return { url, width };
        }).filter(c => c.url);
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.width - a.width);
          if (candidates[0].url) {
            let res = candidates[0].url;
            if (res.startsWith('//')) res = window.location.protocol + res;
            return res;
          }
        }
      } catch (e) {}
    }

    // 3. Fallback to currentSrc or src
    return imgEl.currentSrc || imgEl.src || null;
  }

  function detectMediaAt(target, x, y) {
    if (!target) return null;

    // Check if right-clicked on an Image
    const img = target.tagName === 'IMG' ? target : (typeof target.closest === 'function' ? target.closest('img') : null);
    const picture = target.tagName === 'PICTURE' ? target : (typeof target.closest === 'function' ? target.closest('picture') : null);
    const svgImage = target.tagName === 'image' ? target : null;

    // Check if background image
    let bgUrl = null;
    try {
      let cur = target;
      for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
        const bg = window.getComputedStyle(cur).backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
          const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
          if (match && match[1] && !match[1].startsWith('data:image/svg')) {
            bgUrl = match[1];
            break;
          }
        }
        cur = cur.parentElement;
      }
    } catch (e) {}

    if (img || picture || svgImage || bgUrl) {
      const bestImg = img || (picture ? picture.querySelector('img') : null);
      const url = bestImg ? getBestImageSrc(bestImg) : (svgImage ? svgImage.getAttribute('href') : bgUrl);
      const naturalWidth = (bestImg && (bestImg.naturalWidth || bestImg.width)) || 0;
      const naturalHeight = (bestImg && (bestImg.naturalHeight || bestImg.height)) || 0;
      const alt = (bestImg && (bestImg.alt || bestImg.title)) || document.title || 'image';

      return {
        type: 'image',
        url: url,
        naturalWidth,
        naturalHeight,
        alt: alt.replace(/[\\/:*?"<>|]/g, '_').trim()
      };
    }

    // Check if right-clicked on a Video or Video Player
    const video = target.tagName === 'VIDEO' ? target : (typeof target.closest === 'function' ? target.closest('video') : null);
    const playerContainer = typeof target.closest === 'function' ? target.closest('#movie_player, .html5-video-player, .video-js, [data-player], .player-container, ytd-watch-flexy') : null;
    const foundVideo = video || (playerContainer ? playerContainer.querySelector('video') : null);

    const isYouTube = window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be');

    if (foundVideo || (isYouTube && window.location.pathname.includes('/watch'))) {
      let videoSrc = foundVideo ? (foundVideo.currentSrc || foundVideo.src) : null;
      let duration = foundVideo ? (foundVideo.duration || 0) : 0;
      let videoWidth = foundVideo ? (foundVideo.videoWidth || 0) : 0;
      let videoHeight = foundVideo ? (foundVideo.videoHeight || 0) : 0;
      let title = document.title || 'video';

      // Clean YouTube title
      if (isYouTube) {
        title = title.replace(/\s*-\s*YouTube$/i, '').trim();
      }

      return {
        type: 'video',
        url: videoSrc,
        pageUrl: window.location.href,
        title: title.replace(/[\\/:*?"<>|]/g, '_').trim(),
        duration,
        videoWidth,
        videoHeight,
        isYouTube
      };
    }

    // Check if page contains video or images
    const hasAnyVideo = Boolean(document.querySelector('video'));
    const allImgs = Array.from(document.querySelectorAll('img')).filter(i => (i.naturalWidth > 100 || i.width > 100));

    return {
      type: 'page',
      pageUrl: window.location.href,
      title: (document.title || 'webpage').replace(/[\\/:*?"<>|]/g, '_').trim(),
      hasVideo: hasAnyVideo || isYouTube,
      imageCount: allImgs.length
    };
  }

  // Intercept contextmenu on capture phase so main process has media metadata ready
  document.addEventListener('contextmenu', (e) => {
    try {
      const mediaInfo = detectMediaAt(e.target, e.clientX, e.clientY);
      if (mediaInfo) {
        ipcRenderer.send('context-media-detected', mediaInfo);
      }
    } catch (err) {
      console.warn('[Eclipse] Media detect contextmenu error:', err);
    }
  }, true);

  // Handle image conversion and upscaling request from main process
  ipcRenderer.on('render-and-convert-image', async (event, { url, format, scale, filename }) => {
    try {
      if (!url) return;

      let img = new Image();
      img.crossOrigin = 'anonymous';

      const loadPromise = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image for conversion'));
      });

      try {
        if (url.startsWith('data:')) {
          img.src = url;
        } else {
          const resp = await fetch(url, { mode: 'cors' });
          const blob = await resp.blob();
          img.src = URL.createObjectURL(blob);
        }
      } catch (e) {
        img.src = url;
      }

      await loadPromise;

      const scaleFactor = Number(scale) || 1;
      const targetWidth = Math.round((img.naturalWidth || img.width || 800) * scaleFactor);
      const targetHeight = Math.round((img.naturalHeight || img.height || 600) * scaleFactor);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      // High-quality bicubic smoothing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // White background for JPEG if transparency present
      if (format === 'jpeg' || format === 'jpg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      let mimeType = 'image/png';
      let quality = 1.0;
      if (format === 'jpeg' || format === 'jpg') {
        mimeType = 'image/jpeg';
        quality = 0.98;
      } else if (format === 'webp') {
        mimeType = 'image/webp';
        quality = 0.95;
      }

      const dataUrl = canvas.toDataURL(mimeType, quality);

      ipcRenderer.send('save-converted-image-buffer', {
        dataUrl,
        filename,
        format,
        width: targetWidth,
        height: targetHeight
      });
    } catch (err) {
      console.error('[Eclipse] Image conversion failed:', err);
      // Fallback: download direct URL
      ipcRenderer.send('download-direct-url', { url, filename });
    }
  });

  // Handle request to collect all page images
  ipcRenderer.on('collect-page-images-request', (event) => {
    try {
      const urls = new Set();
      const images = [];

      // 1. All img elements
      document.querySelectorAll('img').forEach(img => {
        const src = getBestImageSrc(img);
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (src && (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:image')) && (w >= 100 || h >= 100 || !w) && !urls.has(src)) {
          let cleanSrc = src.startsWith('//') ? window.location.protocol + src : src;
          urls.add(cleanSrc);
          images.push({ src: cleanSrc, width: w, height: h, alt: img.alt || '' });
        }
      });

      // 2. Background images
      document.querySelectorAll('*').forEach(el => {
        try {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && bg.includes('url(')) {
            const m = bg.match(/url\(['"]?(.*?)['"]?\)/);
            if (m && m[1] && (m[1].startsWith('http') || m[1].startsWith('//')) && !urls.has(m[1])) {
              let cleanSrc = m[1].startsWith('//') ? window.location.protocol + m[1] : m[1];
              urls.add(cleanSrc);
              images.push({ src: cleanSrc, width: el.clientWidth, height: el.clientHeight, alt: 'bg' });
            }
          }
        } catch (e) {}
      });

      ipcRenderer.send('collect-page-images-response', {
        pageTitle: (document.title || 'images').replace(/[\\/:*?"<>|]/g, '_').trim(),
        images: images.slice(0, 120) // top 120 images
      });
    } catch (err) {
      console.error('[Eclipse] Collect images error:', err);
    }
  });
}

initContextMenuMediaSniffer();

// 8. Built-in Universal AdBlock Engine (Cosmetic Filtering + Video Ad Auto-Skipper & Anti-Adblock Defeater)
function initAdBlockerEngine() {
  try {
    const isEnabled = ipcRenderer.sendSync('get-adblock-enabled-sync');
    if (isEnabled === false) return;
  } catch (e) {}

  // 8.1. Cosmetic Ad-Hiding Styles
  const cosmeticAdStyles = `
    /* Google Ads & DoubleClick */
    .adsbygoogle, [id^="google_ads_"], [id*="google_ads_iframe"], [name^="google_ads_iframe"],
    iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"],
    
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
    
    /* Native & Widget Teasers */
    .taboola-container, #taboola-below-article-thumbnails,
    .outbrain-container, .ob-widget, .ob-smartfeed-wrapper,
    [id*="marketgid"], [id*="mgid"], .mgbox, .criteo-ad,
    .teads-inread, [class*="popunder"], [class*="ad-banner"],
    [class*="banner-ads"], [class*="advertisement"], [data-ad-slot], [data-ad-unit],
    
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
    
    /* Anime / Streaming Player Ads (Kodik, Alloha, VideoCDN, Sibnet, Voidboost, Collaps, Ashdi, Lumex, HDRezka) */
    .kodik-ad, .alloha-ad, .ad-container, .vast-ad, .vpaid-ad, .video-ad-overlay,
    .preroll-container, .preroll-ad, .ad-overlay, .player-ad-overlay,
    .vast-block, .vpaid-block, .ad-interstitial, .vjs-ad-playing,
    div[class*="clickunder"], div[id*="clickunder"], div[class*="popunder"],
    .kodik-overlay, .alloha-click-overlay, div[class*="ad_overlay"], div[id*="ad_overlay"],
    
    /* YouTube Ad Slots & Overlays — feed/page ad slots only (NOT player internals!) */
    ytd-ad-slot-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer,
    ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer, ytd-display-ad-renderer,
    #masthead-ad, #player-ads, #top-banner-ad,
    .ytp-ad-overlay-container, .ytp-ad-message-container,
    .ytp-ad-image-overlay, .ytp-ad-text-overlay, .ytp-ad-survey,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    
    /* Anti-Adblock Annoyances */
    .adblock-modal, .adblock-overlay, #adblock-message, .adblock-notice,
    [class*="adblock-banner"], [id*="adblock"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      width: 0 !important;
      pointer-events: none !important;
    }
  `;

  try {
    webFrame.insertCSS(cosmeticAdStyles, { cssOrigin: 'user' });
  } catch (e) {}

  // 8.2. Universal Video Player Ad Auto-Skipper & Anti-Adblock Defeater Script
  const universalAdBlockScript = `
    (function() {
      if (window.__eclipse_adblock_engine_injected__) return;
      window.__eclipse_adblock_engine_injected__ = true;


      // 2. Anti-Adblock Defeater & Russian/Yandex RSYA Direct Defuser
      try {
        window.canRunAds = true;
        window.isAdBlockActive = false;
        window.adblock = false;
        window.adblocker = false;
        window.google_ad_client = true;

        const hideAdElement = (id) => {
          if (!id) return;
          try {
            const el = (typeof id === 'string') ? document.getElementById(id) : id;
            if (el) {
              el.innerHTML = '';
              el.style.setProperty('display', 'none', 'important');
              el.style.setProperty('height', '0px', 'important');
              el.style.setProperty('min-height', '0px', 'important');
            }
          } catch(e) {}
        };

        const yandexStubAdv = {
          render: function(cfg) { if (cfg && cfg.renderTo) hideAdElement(cfg.renderTo); },
          renderWidget: function(cfg) { if (cfg && cfg.renderTo) hideAdElement(cfg.renderTo); },
          destroy: function() {},
          getStat: function() { return {}; },
          sendStat: function() {}
        };

        const yandexStubAdfox = {
          create: function(cfg) { if (cfg && cfg.containerId) hideAdElement(cfg.containerId); },
          createAdaptive: function(cfg) { if (cfg && cfg.containerId) hideAdElement(cfg.containerId); },
          createScroll: function(cfg) { if (cfg && cfg.containerId) hideAdElement(cfg.containerId); },
          createCustom: function() {},
          destroy: function() {},
          clearSession: function() {},
          setParams: function() {},
          reload: function() {}
        };

        window.Ya = window.Ya || {};
        window.Ya.Context = window.Ya.Context || {};
        window.Ya.Context.AdvManager = yandexStubAdv;
        window.Ya.adfoxCode = yandexStubAdfox;
        window.Ya.Direct = { insertInto: function() {}, load: function() {} };
        window.ya = window.Ya;

        const cbQueue = window.yaContextCb || [];
        window.yaContextCb = {
          push: function(...args) {
            for (const fn of args) {
              if (typeof fn === 'function') {
                try { fn(); } catch(e) {}
              }
            }
            return args.length;
          }
        };
        if (Array.isArray(cbQueue)) {
          cbQueue.forEach(fn => { if (typeof fn === 'function') { try { fn(); } catch(e) {} } });
        }

        window.fuckAdBlock = { check: () => false, on: () => {}, onDetected: () => {}, onNotDetected: (cb) => cb && cb() };
        window.BlockAdBlock = window.fuckAdBlock;
        window.Sniffer = { isAdBlock: () => false };
      } catch (e) {}

      // 3. VK Video Ad Defusers & Global Neutralizers
      try {
        window.vk = window.vk || {};
        window.vk.videoAds = null;
        window.vk.preroll = null;
        window.vk.adman = null;
        window.VideoAds = function() {
          return {
            init: function() {},
            destroy: function() {},
            skip: function() {},
            start: function() {},
            pause: function() {},
            resume: function() {},
            hasAds: function() { return false; },
            isPlaying: function() { return false; }
          };
        };
      } catch (e) {}



      // 7. Clickunder / Shady Popunder Guard
      const originalWindowOpen = window.open;
      const customWindowOpen = function open(url, target, features) {
        if (url && typeof url === 'string') {
          const lower = url.toLowerCase();
          const shadyList = ['1xbet', '1x-bet', 'vulkan', 'pin-up', 'vavada', 'joycasino', 'refpa', 'ref-pa', 'popads', 'adsterra', 'clickadu', 'propeller', 'onclick', 'traffim', 'up-x', 'catcasino', 'spinbetter', '1win', 'betwinner', 'melbet', 'mostbet'];
          for (const s of shadyList) {
            if (lower.includes(s)) {
              console.log('[Black hole Shield] Blocked popunder redirect to:', url);
              return { closed: false, focus: () => {}, blur: () => {}, close: () => {} };
            }
          }
        }
        return originalWindowOpen.apply(this, arguments);
      };
      window.open = (window.__eclipse_make_native__ || ((fn) => fn))(customWindowOpen, 'open');

      // 8. Click-Trap Interceptor (Neutralize invisible overlays covering play buttons)
      document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target) return;
        const link = target.closest('a');
        if (link && link.href) {
          const href = link.href.toLowerCase();
          const shadyList = ['1xbet', '1x-bet', 'vulkan', 'pin-up', 'vavada', 'joycasino', 'refpa', 'ref-pa', 'popads', 'adsterra', 'clickadu', 'propeller', 'onclick', 'traffim', 'up-x', 'catcasino', 'spinbetter', '1win', 'betwinner', 'melbet', 'mostbet'];
          if (shadyList.some(s => href.includes(s))) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (link.parentNode) link.parentNode.removeChild(link);
            return;
          }
        }
      }, true);

      // 9. Ultra-Low-Overhead Video Player Ad Skipper & Defuser
      // Only executes work when an actual <video> element exists! Pure audio sites (e.g. VK Music) consume 0.00% CPU!
      // Explicit ad skip selectors only (generic skip buttons like Rutube "Пропустить заставку" are strictly excluded!)
      const targetedSkipSelectors = [
        '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-skip-ad-button', '.ytp-ad-skip-button-container button',
        '.videoplayer_ad_skip', '.videoplayer__ad_skip', '[class*="videoplayer_ad_skip"]',
        '.vast-skip-button', '.vjs-skip-ad-button',
        '.video-ad-skip', '.preroll-skip', '.kodik-ad-skip', '.alloha-skip-ad'
      ].join(', ');

      const targetedOverlaySelectors = [
        '.ytp-ad-overlay-container', '.ytp-ad-message-container',
        '.vast-ad', '.vpaid-ad', '.kodik-ad', '.alloha-ad', '.player-ad-overlay',
        '.videoplayer_ad', '.videoplayer__ad', '.videoplayer_ad_banner', '.videoplayer_ad_overlay'
      ].join(', ');

      function isAdSkipButton(btn) {
        if (!btn || btn.__blackhole_ad_clicked__) return false;

        // CRITICAL PROTECTION: Never click "Пропустить заставку", "Skip Intro", "Recap" (Rutube, Kinopoisk, etc.)
        const txt = (btn.textContent || '').toLowerCase();
        if (txt.includes('заставк') || txt.includes('intro') || txt.includes('recap') || txt.includes('титры') || txt.includes('сери')) {
          return false;
        }

        const cls = typeof btn.className === 'string' ? btn.className.toLowerCase() : '';
        if (cls.includes('intro') || cls.includes('recap') || cls.includes('title')) {
          return false;
        }

        if (typeof btn.closest === 'function' && btn.closest('ytd-comments, #comments, #masthead, [class*="intro"], [class*="recap"], [id*="intro"]')) {
          return false;
        }

        return true;
      }

      function isVideoAdActive(vid) {
        if (!vid) return false;
        const host = (window.location.hostname || '').toLowerCase();
        const isYT = host.includes('youtube.com') || host.includes('youtu.be');

        const ytPlayer = document.getElementById('movie_player') || (typeof vid.closest === 'function' ? vid.closest('.html5-video-player') : null);
        if (ytPlayer && (ytPlayer.classList.contains('ad-showing') || ytPlayer.classList.contains('ad-interrupting'))) {
          return true;
        }

        // On YouTube, ONLY trust the 'ad-showing' / 'ad-interrupting' class on movie_player.
        // All other heuristics (src checks, container checks) cause false positives on YouTube and crash MSE.
        if (isYT) {
          return false;
        }

        if (typeof vid.closest === 'function') {
          const adContainer = vid.closest('.videoplayer_ad, .vast-ad, .vpaid-ad, .preroll-ad, [class*="videoplayer_ad"]');
          if (adContainer) return true;
        }
        if (vid.classList.contains('ad-video') || (vid.dataset && (vid.dataset.ad === 'true' || vid.dataset.isAd === 'true'))) {
          return true;
        }
        const src = (vid.currentSrc || vid.src || '').toLowerCase();
        // Specific unambiguous ad domains and paths only (never generic '/ad/' which breaks Rutube and CDN content hashes)
        if (src && (
          src.includes('/video_adv/') ||
          src.includes('/adv/preroll') ||
          src.includes('an.yandex.ru') ||
          src.includes('target.my.com') ||
          src.includes('ad.mail.ru') ||
          src.includes('imasdk.googleapis.com') ||
          src.includes('refpa') ||
          src.includes('1xbet')
        )) {
          return true;
        }
        return false;
      }

      function checkAndFastForwardVideoAd(vid) {
        try {
          if (!vid || vid.paused) return;
          if (isVideoAdActive(vid)) {
            const host = (window.location.hostname || '').toLowerCase();
            const isYT = host.includes('youtube.com') || host.includes('youtu.be');

            // CRITICAL: On YouTube, NEVER manipulate currentTime or playbackRate — it crashes YouTube's MSE media pipeline!
            // Only use safe native skip methods and UI button clicks.
            if (isYT) {
              const ytPlayer = document.getElementById('movie_player');
              if (ytPlayer && typeof ytPlayer.skipAd === 'function') {
                try { ytPlayer.skipAd(); } catch(e){}
              }
              const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button');
              if (skipBtn && typeof skipBtn.click === 'function') {
                skipBtn.click();
              }
              // Mute the ad video but do NOT change playbackRate — YouTube MSE doesn't support rates > 2x
              vid.muted = true;
              return;
            }

            // For other streaming players: mute ad and invoke player skip methods
            vid.muted = true;
            try {
              if (window.cur && window.cur.videoPlayer && typeof window.cur.videoPlayer.skipAd === 'function') {
                window.cur.videoPlayer.skipAd();
              }
              if (window.mvcur && window.mvcur.player && typeof window.mvcur.player.skipAd === 'function') {
                window.mvcur.player.skipAd();
              }
              if (window.videoplayer && typeof window.videoplayer.skipAd === 'function') {
                window.videoplayer.skipAd();
              }
            } catch(e) {}
          }
        } catch(e) {}
      }

      function processAdElements() {
        try {
          // Zero-overhead guard: if no video elements exist on page (e.g. VK Music, Spotify, standard pages), EXIT IMMEDIATELY!
          const firstVideo = document.querySelector('video');
          if (!firstVideo) return;

          const allVideos = document.querySelectorAll('video');
          for (const vid of allVideos) {
            checkAndFastForwardVideoAd(vid);
          }

          // Call native player skip methods if exposed
          try {
            if (window.cur && window.cur.videoPlayer) {
              if (typeof window.cur.videoPlayer.skipAd === 'function') window.cur.videoPlayer.skipAd();
              if (typeof window.cur.videoPlayer.onAdEnd === 'function') window.cur.videoPlayer.onAdEnd();
            }
            if (window.mvcur && window.mvcur.player) {
              if (typeof window.mvcur.player.skipAd === 'function') window.mvcur.player.skipAd();
              if (typeof window.mvcur.player.onAdEnd === 'function') window.mvcur.player.onAdEnd();
            }
            if (window.videoplayer) {
              if (typeof window.videoplayer.skipAd === 'function') window.videoplayer.skipAd();
              if (typeof window.videoplayer.onAdEnd === 'function') window.videoplayer.onAdEnd();
            }
          } catch(e) {}

          // Click explicit ad skip buttons (with debounce and skip-intro exclusion protection!)
          const btns = document.querySelectorAll(targetedSkipSelectors);
          for (const btn of btns) {
            if (isAdSkipButton(btn) && typeof btn.click === 'function') {
              btn.__blackhole_ad_clicked__ = true;
              btn.click();
            }
          }

          // Hide overlays if present
          const overlays = document.querySelectorAll(targetedOverlaySelectors);
          for (const ov of overlays) {
            if (ov && ov.style.display !== 'none') {
              ov.style.setProperty('display', 'none', 'important');
              ov.style.setProperty('visibility', 'hidden', 'important');
            }
          }
        } catch (err) {}
      }

      // Hook video events directly on video elements for instant, 0-polling ad skip
      function attachVideoListeners() {
        const videos = document.querySelectorAll('video');
        for (const vid of videos) {
          if (!vid.__eclipse_hooked__) {
            vid.__eclipse_hooked__ = true;
            vid.addEventListener('timeupdate', () => checkAndFastForwardVideoAd(vid), { passive: true });
            vid.addEventListener('play', () => checkAndFastForwardVideoAd(vid), { passive: true });
          }
        }
      }

      // Check on a relaxed, CPU-friendly 1000ms timer (instead of 50ms brute-force reflow loop)
      setInterval(() => {
        attachVideoListeners();
        processAdElements();
      }, 1000);

      // Light MutationObserver only observing player containers when present
      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (ytPlayer) {
        const playerObserver = new MutationObserver(() => {
          processAdElements();
        });
        playerObserver.observe(ytPlayer, { attributes: true, attributeFilter: ['class'] });
      }
    })();
  `;

  try {
    webFrame.executeJavaScript(universalAdBlockScript);
  } catch (e) {}
}

initAdBlockerEngine();

// 9. VK Audio & Background Multimedia Performance Optimizer
function initBackgroundAudioOptimizer() {
  try {
    const host = (window.location.hostname || '').toLowerCase();
    const isVk = host.includes('vk.com');
    if (!isVk) return;

    let vkStyle = null;
    const applyVkPerformanceMode = () => {
      try {
        if (document.hidden) {
          if (!vkStyle) {
            vkStyle = document.createElement('style');
            vkStyle.id = '__blackhole_vk_perf_fix__';
            vkStyle.textContent = `
              [class*="audio_page_player__visualizer"],
              [class*="AudioVisualizer"],
              .audio_row__cover_back,
              .audio_page_player__waveform,
              canvas {
                animation-play-state: paused !important;
              }
            `;
            (document.head || document.documentElement).appendChild(vkStyle);
          }
        } else {
          if (vkStyle && vkStyle.parentNode) {
            vkStyle.parentNode.removeChild(vkStyle);
            vkStyle = null;
          }
        }
      } catch (e) {}
    };

    document.addEventListener('visibilitychange', applyVkPerformanceMode);
    applyVkPerformanceMode();
  } catch (e) {}
}

initBackgroundAudioOptimizer();
