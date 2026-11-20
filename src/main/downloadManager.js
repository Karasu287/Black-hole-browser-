const { BrowserWindow, app, session } = require('electron');
const path = require('path');
const storage = require('./storage');
const popupManager = require('./popupManager');
const extensionManager = require('./extensionManager');

class DownloadManager {
  constructor() {
    this.activeDownloads = new Map(); // downloadId -> DownloadItem
  }

  setupSessionDownloads(ses) {
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

      this.activeDownloads.set(downloadId, item);

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
        isPaused: false,
        canResume: item.canResume(),
        mimeType,
        startTime: Date.now()
      };
      storage.addDownloadRecord(initialRecord);
      this.broadcastDownloadUpdated(initialRecord);

      item.on('updated', (e, state) => {
        const currentFilename = resolveFileName();
        const isPaused = item.isPaused();
        const canResume = item.canResume();
        let recordState = 'progressing';
        if (isPaused) {
          recordState = 'paused';
        } else if (state === 'interrupted') {
          recordState = 'interrupted';
        }

        const updatedRecord = {
          id: downloadId,
          filename: currentFilename,
          fileName: currentFilename,
          url,
          savePath: item.getSavePath() || '',
          fileSize: item.getTotalBytes(),
          totalBytes: item.getTotalBytes(),
          receivedBytes: item.getReceivedBytes(),
          state: recordState,
          isPaused: isPaused,
          canResume: canResume,
          mimeType
        };
        storage.addDownloadRecord(updatedRecord);
        this.broadcastDownloadUpdated(updatedRecord);
      });

      item.once('done', (e, state) => {
        this.activeDownloads.delete(downloadId);
        const currentFilename = resolveFileName();
        let recordState = 'completed';
        if (state === 'cancelled') {
          recordState = 'cancelled';
        } else if (state !== 'completed') {
          recordState = 'interrupted';
        }

        const finalRecord = {
          id: downloadId,
          filename: currentFilename,
          fileName: currentFilename,
          url,
          savePath: item.getSavePath() || '',
          fileSize: item.getTotalBytes(),
          totalBytes: item.getTotalBytes(),
          receivedBytes: item.getReceivedBytes(),
          state: recordState,
          isPaused: false,
          canResume: false,
          mimeType,
          completedTime: Date.now()
        };
        storage.addDownloadRecord(finalRecord);
        this.broadcastDownloadUpdated(finalRecord);

        // Show floating VirusTotal toast over active page
        if (state === 'completed' && finalRecord.savePath) {
          popupManager.showVirusTotalToast(finalRecord);
        }
      });
    });
  }

  broadcastDownloadUpdated(record) {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('download-updated', record);
      }
    });
  }

  pauseDownload(id) {
    const item = this.activeDownloads.get(id);
    if (item && !item.isPaused()) {
      try {
        item.pause();
        const updatedRecord = {
          id,
          state: 'paused',
          isPaused: true,
          canResume: item.canResume()
        };
        storage.addDownloadRecord(updatedRecord);
        const full = (storage.getDownloads(200) || []).find(d => d.id === id) || updatedRecord;
        this.broadcastDownloadUpdated(full);
        return { success: true };
      } catch (e) {
        console.error('[DownloadManager] pause error:', e);
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'Download not found or already paused' };
  }

  resumeDownload(id) {
    const item = this.activeDownloads.get(id);
    if (item && (item.canResume() || item.isPaused())) {
      try {
        item.resume();
        const updatedRecord = {
          id,
          state: 'progressing',
          isPaused: false,
          canResume: true
        };
        storage.addDownloadRecord(updatedRecord);
        const full = (storage.getDownloads(200) || []).find(d => d.id === id) || updatedRecord;
        this.broadcastDownloadUpdated(full);
        return { success: true };
      } catch (e) {
        console.error('[DownloadManager] resume error:', e);
        return { success: false, error: e.message };
      }
    }

    // Fallback: If not in active memory, check if recorded item can be restarted via URL
    const existing = (storage.getDownloads(200) || []).find(d => d.id === id);
    if (existing && existing.url) {
      try {
        session.defaultSession.downloadURL(existing.url);
        return { success: true, restarted: true };
      } catch (e) {
        console.error('[DownloadManager] restart downloadURL error:', e);
        return { success: false, error: e.message };
      }
    }

    return { success: false, error: 'Download cannot be resumed' };
  }

  cancelDownload(id) {
    const item = this.activeDownloads.get(id);
    if (item) {
      try {
        item.cancel();
        this.activeDownloads.delete(id);
      } catch (e) {
        console.error('[DownloadManager] cancel error:', e);
      }
    }
    const updatedRecord = {
      id,
      state: 'cancelled',
      isPaused: false,
      canResume: false
    };
    storage.addDownloadRecord(updatedRecord);
    const full = (storage.getDownloads(200) || []).find(d => d.id === id) || updatedRecord;
    this.broadcastDownloadUpdated(full);
    return { success: true };
  }

  getActiveDownload(id) {
    return this.activeDownloads.get(id);
  }

  hasActiveDownload(id) {
    return this.activeDownloads.has(id);
  }
}

module.exports = new DownloadManager();
