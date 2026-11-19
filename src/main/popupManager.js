const { BrowserWindow, session, nativeTheme } = require('electron');
const path = require('path');
const storage = require('./storage');
const viewManager = require('./viewManager');

class PopupManager {
  constructor() {
    this.activePopupWindow = null;
    this.activePopupType = null; // 'downloads' | 'history'
    this.activeToastWindow = null;
    this.mainWindow = null;
    this.isDragging = false;
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  closeVirusTotalToast() {
    if (this.activeToastWindow && !this.activeToastWindow.isDestroyed()) {
      try {
        this.activeToastWindow.close();
      } catch (e) {}
    }
    this.activeToastWindow = null;
  }

  showVirusTotalToast(downloadItem, anchorBounds = {}) {
    this.closeVirusTotalToast();

    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const mainBounds = this.mainWindow.getBounds();
    const toastWidth = 330;
    const toastHeight = 125;

    let toastX = Math.round(mainBounds.x + mainBounds.width - toastWidth - 16);
    let toastY = Math.round(mainBounds.y + 74);

    if (anchorBounds && typeof anchorBounds.x === 'number') {
      toastX = Math.round(mainBounds.x + anchorBounds.x - toastWidth + (anchorBounds.width || 30) + 4);
    }
    if (anchorBounds && typeof anchorBounds.y === 'number') {
      toastY = Math.round(mainBounds.y + anchorBounds.y + (anchorBounds.height || 30) + 4);
    }

    toastX = Math.max(mainBounds.x + 10, Math.min(mainBounds.x + mainBounds.width - toastWidth - 10, toastX));

    this.activeToastWindow = new BrowserWindow({
      width: toastWidth,
      height: toastHeight,
      x: toastX,
      y: toastY,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      parent: this.mainWindow,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    this.activeToastWindow._isToast = true;

    const filePath = path.join(__dirname, '../renderer/virustotal_toast.html');
    const fn = downloadItem.filename || downloadItem.fileName || 'Файл';
    const sp = downloadItem.savePath || '';

    this.activeToastWindow.loadFile(filePath, {
      query: {
        filename: fn,
        savePath: sp,
        id: downloadItem.id || ''
      }
    }).catch(err => {
      console.warn('[PopupManager] Failed to load virustotal_toast.html:', err);
    });

    this.activeToastWindow.once('ready-to-show', () => {
      if (this.activeToastWindow && !this.activeToastWindow.isDestroyed()) {
        this.activeToastWindow.showInactive();
      }
    });

    this.activeToastWindow.on('closed', () => {
      this.activeToastWindow = null;
    });
  }

  closePopup() {
    this.isDragging = false;
    if (this.activePopupWindow && !this.activePopupWindow.isDestroyed()) {
      try {
        this.activePopupWindow.close();
      } catch (e) {}
    }
    this.activePopupWindow = null;
    this.activePopupType = null;

    // Remove dimmer on active tab
    if (viewManager && typeof viewManager.removeTabDimming === 'function') {
      viewManager.removeTabDimming();
    }
  }

  togglePopup(type, anchorBounds = {}) {
    if (this.activePopupType === type && this.activePopupWindow && !this.activePopupWindow.isDestroyed()) {
      this.closePopup();
      return;
    }
    this.openPopup(type, anchorBounds);
  }

  openPopup(type, anchorBounds = {}) {
    this.closePopup();

    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const settings = storage.getSettings();
    const dimmingEnabled = settings.bubbleDimmingEnabled !== false;
    const dimmingOpacity = (typeof settings.bubbleDimmingOpacity === 'number') ? settings.bubbleDimmingOpacity : 0.35;

    // Apply dimmer to active tab if dimming is enabled and > 0
    if (dimmingEnabled && dimmingOpacity > 0 && viewManager && typeof viewManager.setTabDimming === 'function') {
      viewManager.setTabDimming(null, dimmingOpacity);
    }

    const mainBounds = this.mainWindow.getBounds();
    const popupWidth = 390;
    const popupHeight = 500;

    // Calculate position relative to anchor (button in toolbar) or top right
    let popupX;
    if (anchorBounds && typeof anchorBounds.x === 'number') {
      popupX = Math.round(mainBounds.x + anchorBounds.x - popupWidth + (anchorBounds.width || 30) + 4);
    } else {
      popupX = Math.round(mainBounds.x + mainBounds.width - popupWidth - 14);
    }

    let popupY;
    if (anchorBounds && typeof anchorBounds.y === 'number') {
      popupY = Math.round(mainBounds.y + anchorBounds.y + (anchorBounds.height || 30) + 4);
    } else {
      popupY = Math.round(mainBounds.y + 74);
    }

    // Ensure within screen bounds
    popupX = Math.max(mainBounds.x + 10, Math.min(mainBounds.x + mainBounds.width - popupWidth - 10, popupX));

    this.activePopupWindow = new BrowserWindow({
      width: popupWidth,
      height: popupHeight,
      x: popupX,
      y: popupY,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      parent: this.mainWindow,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    this.activePopupWindow._isPopup = true;

    const htmlFile = type === 'history' ? 'history_bubble.html' : 'downloads_bubble.html';
    const filePath = path.join(__dirname, `../renderer/${htmlFile}`);

    this.activePopupWindow.loadFile(filePath).catch(err => {
      console.warn(`[PopupManager] Failed to load ${htmlFile}:`, err);
    });

    this.activePopupWindow.once('ready-to-show', () => {
      if (this.activePopupWindow && !this.activePopupWindow.isDestroyed()) {
        this.activePopupWindow.show();
      }
    });

    this.activePopupWindow.on('blur', () => {
      if (this.isDragging) {
        return;
      }
      setTimeout(() => {
        if (!this.isDragging) {
          this.closePopup();
        }
      }, 120);
    });

    this.activePopupWindow.on('closed', () => {
      this.activePopupWindow = null;
      this.activePopupType = null;
      this.isDragging = false;
      if (viewManager && typeof viewManager.removeTabDimming === 'function') {
        viewManager.removeTabDimming();
      }
    });
  }
}

module.exports = new PopupManager();
