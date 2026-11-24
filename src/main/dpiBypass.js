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
  }

  getBinaryPath() {
    const candidates = [
      path.join(__dirname, 'bin', 'ciadpi.exe'),
      path.join(app.getAppPath(), 'src', 'main', 'bin', 'ciadpi.exe'),
      path.join(process.resourcesPath || '', 'app', 'src', 'main', 'bin', 'ciadpi.exe'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'main', 'bin', 'ciadpi.exe'),
      path.join(__dirname, '..', '..', 'bin', 'ciadpi.exe')
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

    // Ensure clean child process shutdown on browser exit
    const cleanup = () => this.stop();
    app.on('will-quit', cleanup);
    app.on('before-quit', cleanup);
    process.on('exit', cleanup);
  }

  async start() {
    if (this.isRunning && this.process) return true;

    const binPath = this.getBinaryPath();
    if (!binPath) {
      console.warn('[Black hole Browser] DPI Bypass: ciadpi.exe binary not found');
      return false;
    }

    try {
      // 1. Kill any orphaned ciadpi process lingering from crashes or previous sessions
      try {
        execSync('taskkill /F /IM ciadpi.exe /T 2>nul || exit 0', { windowsHide: true, shell: true });
      } catch (e) {}

      // 2. Desynchronization parameters tuned specifically for Russian TSPU / YouTube unthrottling
      // Uses split + disorder with 2s timeout and TLS record fragmentation
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
        // CRITICAL: Immediately reset sessions to DIRECT if process dies, preventing browser hangs
        this.applyProxyToSessions(false);
      });

      // 3. Verify that the proxy socket is actually listening before applying proxy to Chromium sessions
      const isListening = await this.waitForPort(this.port, 15, 60);
      if (!isListening) {
        console.warn(`[Black hole Browser] DPI Bypass: Port ${this.port} did not respond, aborting proxy set`);
        this.stop();
        return false;
      }

      this.isRunning = true;
      this.applyProxyToSessions(true);
      console.log(`[Black hole Browser] ⚡ YouTube DPI Bypass active on 127.0.0.1:${this.port}`);
      return true;
    } catch (e) {
      console.error('[Black hole Browser] Failed to launch DPI Bypass:', e);
      this.isRunning = false;
      this.applyProxyToSessions(false);
      return false;
    }
  }

  stop() {
    this.applyProxyToSessions(false);
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
    }
    this.isRunning = false;
  }

  applyProxyToSessions(enable) {
    const sessions = [session.defaultSession];
    try {
      sessions.push(session.fromPartition('incognito'));
    } catch (e) {}

    if (enable && this.isRunning) {
      // PAC script targeting only Google / YouTube media & interface endpoints
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
      // Reset to direct connections
      for (const ses of sessions) {
        if (ses && typeof ses.setProxy === 'function') {
          ses.setProxy({ mode: 'direct' }).catch(() => {});
        }
      }
    }
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

    // Notify all windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('dpi-bypass-state-changed', {
          enabled: this.enabled,
          active: this.isRunning
        });
      }
    });

    return this.enabled;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      active: this.isRunning,
      port: this.port
    };
  }
}

const defaultDpiBypass = new DpiBypassManager();
module.exports = defaultDpiBypass;
