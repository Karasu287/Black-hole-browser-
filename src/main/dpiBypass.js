const { app, session, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, execSync } = require('child_process');
const storage = require('./storage');

class DpiBypassManager {
  constructor() {
    this.process = null;
    this.port = 19808;
    this.enabled = true;
    this.isRunning = false;
    this.engine = 'none'; // 'system-zapret' | 'bundled-zapret' | 'byedpi' | 'none'
    this._pollInterval = null;
  }

  isSystemZapretRunning() {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq winws.exe" /NH 2>nul', { windowsHide: true }).toString();
      return out.toLowerCase().includes('winws.exe');
    } catch (e) {
      return false;
    }
  }

  getWinwsBinaryPath() {
    const candidates = [
      path.join(__dirname, 'bin', 'zapret', 'winws.exe'),
      path.join(app.getAppPath(), 'src', 'main', 'bin', 'zapret', 'winws.exe'),
      path.join(process.resourcesPath || '', 'app', 'src', 'main', 'bin', 'zapret', 'winws.exe'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'main', 'bin', 'zapret', 'winws.exe'),
      'C:\\Users\\Karasu\\Documents\\zapret-discord-youtube-1.10.3\\bin\\winws.exe'
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  getCiadpiBinaryPath() {
    const candidates = [
      path.join(__dirname, 'bin', 'ciadpi.exe'),
      path.join(app.getAppPath(), 'src', 'main', 'bin', 'ciadpi.exe'),
      path.join(process.resourcesPath || '', 'app', 'src', 'main', 'bin', 'ciadpi.exe'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'main', 'bin', 'ciadpi.exe')
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  waitForPort(port, maxAttempts = 15, delayMs = 60) {
    return new Promise(async (resolve) => {
      for (let i = 0; i < maxAttempts; i++) {
        const isUp = await new Promise(r => {
          const sock = new net.Socket();
          sock.setTimeout(120);
          sock.once('connect', () => { sock.destroy(); r(true); });
          sock.once('error', () => { sock.destroy(); r(false); });
          sock.once('timeout', () => { sock.destroy(); r(false); });
          sock.connect(port, '127.0.0.1');
        });
        if (isUp) return resolve(true);
        await new Promise(r => setTimeout(r, delayMs));
      }
      resolve(false);
    });
  }

  async init() {
    const settings = storage.getSettings();
    this.enabled = settings.youtubeDpiBypassEnabled !== false;

    if (this.enabled) {
      await this.start();
    }

    // Monitor for changes in system Zapret state every 10 seconds
    if (!this._pollInterval) {
      this._pollInterval = setInterval(() => {
        if (!this.enabled) return;
        const systemRunning = this.isSystemZapretRunning();
        if (systemRunning && this.engine !== 'system-zapret') {
          console.log('[Black hole Browser] ⚡ External Zapret detected! Switching to direct transparent mode.');
          this.stopProcessOnly();
          this.engine = 'system-zapret';
          this.isRunning = true;
          this.applyProxyToSessions(false);
          this.broadcastState();
        } else if (!systemRunning && this.engine === 'system-zapret') {
          console.log('[Black hole Browser] ⚡ External Zapret stopped! Launching internal bypass.');
          this.start();
        }
      }, 10000);
    }

    const cleanup = () => this.stop();
    app.on('will-quit', cleanup);
    app.on('before-quit', cleanup);
    process.on('exit', cleanup);
  }

  async start() {
    if (!this.enabled) return false;

    // 1. Check if Zapret (winws.exe) is ALREADY running on the user's PC (e.g. Flowseal service)
    if (this.isSystemZapretRunning()) {
      console.log('[Black hole Browser] ⚡ System Zapret (Flowseal / WinWS) active on OS! Using direct transparent mode.');
      this.stopProcessOnly();
      this.engine = 'system-zapret';
      this.isRunning = true;
      this.applyProxyToSessions(false); // DIRECT mode: WinDivert filters packets transparently!
      this.broadcastState();
      return true;
    }

    // 2. Try launching bundled Flowseal Zapret (winws.exe)
    const winwsPath = this.getWinwsBinaryPath();
    if (winwsPath) {
      const started = await this.startBundledZapret(winwsPath);
      if (started) {
        return true;
      }
    }

    // 3. Fallback: launch ByeDPI (ciadpi.exe) with local proxy if WinDivert driver cannot be loaded
    console.log('[Black hole Browser] Zapret requires driver privileges, falling back to ByeDPI proxy engine.');
    return await this.startByeDpi();
  }

  async startBundledZapret(winwsPath) {
    try {
      const zapretBinDir = path.dirname(winwsPath);
      const zapretListsDir = path.join(zapretBinDir, 'lists');
      const listGoogle = path.join(zapretListsDir, 'list-google.txt');
      const fakeTls = path.join(zapretBinDir, 'tls_clienthello_www_google_com.bin');
      const fakeQuic = path.join(zapretBinDir, 'quic_initial_www_google_com.bin');

      // Flowseal proven desync configuration for YouTube
      const args = [
        '--wf-tcp=80,443',
        '--wf-udp=443',
        '--filter-udp=443',
        `--hostlist=${listGoogle}`,
        '--dpi-desync=fake',
        '--dpi-desync-repeats=6',
        `--dpi-desync-fake-quic=${fakeQuic}`,
        '--new',
        '--filter-tcp=443',
        `--hostlist=${listGoogle}`,
        '--ip-id=zero',
        '--dpi-desync=fake,multisplit',
        '--dpi-desync-split-seqovl=681',
        '--dpi-desync-split-pos=1',
        '--dpi-desync-fooling=ts',
        '--dpi-desync-repeats=8',
        `--dpi-desync-split-seqovl-pattern=${fakeTls}`,
        `--dpi-desync-fake-tls=${fakeTls}`
      ];

      this.process = spawn(winwsPath, args, {
        cwd: zapretBinDir,
        windowsHide: true,
        stdio: 'ignore',
        detached: false
      });

      let failedEarly = false;
      this.process.on('error', () => {
        failedEarly = true;
      });

      this.process.on('exit', () => {
        if (this.engine === 'bundled-zapret') {
          this.isRunning = false;
          this.process = null;
          this.engine = 'none';
          this.applyProxyToSessions(false);
          this.broadcastState();
        }
      });

      // Wait 400ms to verify winws doesn't exit immediately (e.g. WinDivert driver error code 5)
      await new Promise(r => setTimeout(r, 400));
      if (failedEarly || !this.process || this.process.exitCode !== null) {
        this.process = null;
        return false;
      }

      this.isRunning = true;
      this.engine = 'bundled-zapret';
      this.applyProxyToSessions(false); // WinDivert works transparently, no proxy needed!
      this.broadcastState();
      console.log('[Black hole Browser] ⚡ Built-in Flowseal Zapret (winws) active! Direct packet desynchronization enabled.');
      return true;
    } catch (e) {
      return false;
    }
  }

  async startByeDpi() {
    const binPath = this.getCiadpiBinaryPath();
    if (!binPath) {
      console.warn('[Black hole Browser] DPI Bypass: ciadpi.exe binary not found');
      return false;
    }

    try {
      try {
        execSync('taskkill /F /IM ciadpi.exe /T 2>nul || exit 0', { windowsHide: true, shell: true });
      } catch (e) {}

      const args = [
        '-i', '127.0.0.1',
        '-p', String(this.port),
        '--split', '1',
        '--disorder', '3+s',
        '--auto=torst',
        '-T', '2',
        '--tlsrec', '1+s'
      ];

      this.process = spawn(binPath, args, {
        windowsHide: true,
        stdio: 'ignore',
        detached: false
      });

      this.process.on('error', (err) => {
        console.error('[Black hole Browser] DPI Bypass error:', err);
        this.isRunning = false;
        this.process = null;
        this.applyProxyToSessions(false);
      });

      this.process.on('exit', (code) => {
        console.log(`[Black hole Browser] DPI Bypass exited with code ${code}`);
        this.isRunning = false;
        this.process = null;
        this.applyProxyToSessions(false);
      });

      const isListening = await this.waitForPort(this.port, 15, 60);
      if (!isListening) {
        console.warn(`[Black hole Browser] DPI Bypass: Port ${this.port} did not respond, aborting proxy set`);
        this.stop();
        return false;
      }

      this.isRunning = true;
      this.engine = 'byedpi';
      this.applyProxyToSessions(true);
      this.broadcastState();
      console.log(`[Black hole Browser] ⚡ YouTube DPI Bypass (ByeDPI) active on 127.0.0.1:${this.port}`);
      return true;
    } catch (e) {
      console.error('[Black hole Browser] Failed to launch ByeDPI:', e);
      this.isRunning = false;
      this.applyProxyToSessions(false);
      return false;
    }
  }

  stopProcessOnly() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
    }
  }

  stop() {
    this.stopProcessOnly();
    this.applyProxyToSessions(false);
    this.isRunning = false;
    this.engine = 'none';
    this.broadcastState();
  }

  applyProxyToSessions(enable) {
    const sessions = [session.defaultSession];
    try {
      sessions.push(session.fromPartition('incognito'));
    } catch (e) {}

    // IMPORTANT: Proxy is ONLY applied when running ByeDPI local proxy.
    // When using Zapret (system or bundled winws), WinDivert works at the kernel driver layer
    // and requires standard DIRECT connections!
    if (enable && this.isRunning && this.engine === 'byedpi') {
      const pacScript = `
        function FindProxyForURL(url, host) {
          if (!host) return "DIRECT";
          host = ("" + host).toLowerCase();
          if (
            host === "googlevideo.com" || dnsDomainIs(host, ".googlevideo.com") ||
            host === "youtube.com" || dnsDomainIs(host, ".youtube.com") ||
            host === "youtu.be" || dnsDomainIs(host, ".youtu.be") ||
            host === "ytimg.com" || dnsDomainIs(host, ".ytimg.com") ||
            host === "ggpht.com" || dnsDomainIs(host, ".ggpht.com") ||
            host === "youtube-nocookie.com" || dnsDomainIs(host, ".youtube-nocookie.com") ||
            host === "youtubekids.com" || dnsDomainIs(host, ".youtubekids.com") ||
            host === "youtubei.googleapis.com" ||
            host === "jnn-pa.googleapis.com" ||
            host === "gvt1.com" || dnsDomainIs(host, ".gvt1.com") ||
            host === "video.google.com" || dnsDomainIs(host, ".video.google.com")
          ) {
            return "SOCKS5 127.0.0.1:${this.port}; SOCKS 127.0.0.1:${this.port}; DIRECT";
          }
          return "DIRECT";
        }
      `.trim();

      const pacDataUri = `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pacScript).toString('base64')}`;

      for (const ses of sessions) {
        if (ses && typeof ses.setProxy === 'function') {
          ses.setProxy({ pacScript: pacDataUri }).catch((e) => {
            console.warn('[Black hole Browser] Failed to set proxy on session:', e);
          });
        }
      }
    } else {
      // Direct connections for Zapret or when bypass is disabled
      for (const ses of sessions) {
        if (ses && typeof ses.setProxy === 'function') {
          ses.setProxy({ mode: 'direct' }).catch(() => {});
        }
      }
    }
  }

  broadcastState() {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('dpi-bypass-state-changed', this.getStatus());
      }
    });
  }

  async toggle(enable) {
    const targetState = typeof enable === 'boolean' ? enable : !this.enabled;
    this.enabled = targetState;
    storage.updateSettings({ youtubeDpiBypassEnabled: this.enabled });

    if (this.enabled) {
      await this.start();
    } else {
      this.stop();
    }

    this.broadcastState();
    return this.enabled;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      active: this.isRunning,
      engine: this.engine,
      port: this.port
    };
  }
}

const defaultDpiBypass = new DpiBypassManager();
module.exports = defaultDpiBypass;
