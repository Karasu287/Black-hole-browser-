let currentTabs = [];
let currentTabGroups = [];
let activeTabId = null;
let currentSettings = {};
let bookmarks = [];
let currentExtensions = [];
let isIncognitoWindow = false;

// DOM Elements
const tabsListEl = document.getElementById('tabs-list');
const btnNewTab = document.getElementById('btn-new-tab');
const omniboxInput = document.getElementById('omnibox-input');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const iconReload = document.getElementById('icon-reload');
const iconStop = document.getElementById('icon-stop');
const btnHome = document.getElementById('btn-home');
const btnBookmarkToggle = document.getElementById('btn-bookmark-toggle');
const iconStar = document.getElementById('icon-star');
const loadProgressBar = document.getElementById('load-progress-bar');
const bookmarksBar = document.getElementById('bookmarks-bar');
const bookmarksBarList = document.getElementById('bookmarks-bar-list');
const extensionActionIcons = document.getElementById('extension-action-icons');
const memSavedBadge = document.getElementById('mem-saved-badge');
const btnNewWindow = document.getElementById('btn-new-window');
const btnIncognito = document.getElementById('btn-incognito');
const incognitoBadge = document.getElementById('incognito-badge');

// Window Buttons
const btnWinMin = document.getElementById('btn-win-min');
const btnWinMax = document.getElementById('btn-win-max');
const btnWinClose = document.getElementById('btn-win-close');

// Modals
const modalExtensions = document.getElementById('modal-extensions');
const modalSettings = document.getElementById('modal-settings');
const modalHistory = document.getElementById('modal-history');
const modalDownloads = document.getElementById('modal-downloads');
const modalBookmarks = document.getElementById('modal-bookmarks');
const modalMemory = document.getElementById('modal-memory');
const modalPasswords = document.getElementById('modal-passwords');
const modalAddPassword = document.getElementById('modal-add-password');
const modalSavePasswordPrompt = document.getElementById('modal-save-password-prompt');
const modalImportPasswords = document.getElementById('modal-import-passwords');
const modalTabGroup = document.getElementById('modal-tab-group');
const modalUpdatePrompt = document.getElementById('modal-update-prompt');

// Initialize
async function init() {
  setupWindowControls();
  setupNavigation();
  setupOmnibox();
  setupShieldUI();
  setupModals();
  setupSettingsUI();
  setupUpdateSystem();
  setupShortcutsManagerUI();
  setupDownloadsUI();
  setupExtensionsUI();
  setupPasswordManagerUI();
  setupTabGroupsUI();
  setupTabsListDragDrop();
  setupShortcuts();
  setupFindBar();
  setupSplitScreenUI();
  setupVerticalTabsUI();

  // Detect Incognito Mode
  if (window.electronAPI && window.electronAPI.isIncognitoWindow) {
    try {
      isIncognitoWindow = await window.electronAPI.isIncognitoWindow();
    } catch (e) {}
  }

  if (isIncognitoWindow) {
    document.body.classList.add('incognito-mode');
    if (incognitoBadge) incognitoBadge.classList.remove('hidden');
    if (omniboxInput) {
      omniboxInput.placeholder = '🔒 Безопасный поиск инкогнито или адрес сайта...';
    }
  }

  if (btnNewWindow) {
    btnNewWindow.addEventListener('click', () => {
      window.electronAPI.openNewWindow();
    });
  }

  if (btnIncognito) {
    btnIncognito.addEventListener('click', () => {
      window.electronAPI.openIncognitoWindow();
    });
  }

  // Load Initial Data
  currentSettings = await window.electronAPI.getSettings();
  applySettings(currentSettings);

  const topBarEl = document.getElementById('top-bar');
  if (topBarEl && window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      syncTopBarHeight();
    });
    ro.observe(topBarEl);
  }
  window.addEventListener('resize', syncTopBarHeight);
  syncTopBarHeight();

  bookmarks = await window.electronAPI.getBookmarks();
  renderBookmarksBar(bookmarks);

  const tabData = await window.electronAPI.getAllTabs();
  if (tabData && tabData.tabs) {
    currentTabs = tabData.tabs;
    currentTabGroups = tabData.groups || [];
    activeTabId = tabData.activeTabId;
    renderTabs();
  }

  loadExtensions();
  updatePerformanceStats();
  setInterval(() => {
    // Only poll performance stats if window is visible and settings modal is opened
    if (!document.hidden && modalSettings && !modalSettings.classList.contains('hidden')) {
      updatePerformanceStats();
    }
  }, 15000);

  // Listen for main process events
  window.electronAPI.onTabsUpdated((data) => {
    currentTabs = data.tabs;
    currentTabGroups = data.groups || [];
    activeTabId = data.activeTabId;
    renderTabs();
    updateOmniboxForActiveTab();
  });

  window.electronAPI.onTabStateChanged((state) => {
    const idx = currentTabs.findIndex(t => t.id === state.id);
    if (idx >= 0) {
      const prev = currentTabs[idx];
      const hasVisualChanged = prev.title !== state.title ||
                               prev.url !== state.url ||
                               prev.favicon !== state.favicon ||
                               prev.isLoading !== state.isLoading ||
                               prev.isPlayingAudio !== state.isPlayingAudio ||
                               prev.isSleeping !== state.isSleeping ||
                               prev.isPinned !== state.isPinned ||
                               prev.isSplitSecondary !== state.isSplitSecondary;
      currentTabs[idx] = { ...prev, ...state };
      if (hasVisualChanged) {
        renderTabs();
      }
    }
    if (state.id === activeTabId) {
      updateNavControls(state);
    }
  });

  window.electronAPI.onExtensionsUpdated((extensions) => {
    currentExtensions = extensions || [];
    renderExtensionIcons(currentExtensions);
    renderExtensionsGrid(currentExtensions);
    updatePopularExtensionsState(currentExtensions);
  });

  if (window.electronAPI.onOpenModalExtensions) {
    window.electronAPI.onOpenModalExtensions(() => {
      openModal(modalExtensions);
      loadExtensions();
    });
  }

  if (window.electronAPI.onHtmlFullScreenState) {
    window.electronAPI.onHtmlFullScreenState((isFullScreen) => {
      document.body.classList.toggle('html-fullscreen', Boolean(isFullScreen));
    });
  }

  if (window.electronAPI.onThemeChanged) {
    window.electronAPI.onThemeChanged((data) => {
      if (data && data.theme) {
        currentSettings.theme = data.theme;
        applyTheme(data.theme);
        const themeSelect = document.getElementById('setting-theme-select');
        if (themeSelect) themeSelect.value = data.theme;
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onNeonThemeChanged) {
    window.electronAPI.onNeonThemeChanged((data) => {
      if (data && data.neonThemeColor) {
        currentSettings.neonThemeColor = data.neonThemeColor;
        applyNeonTheme(data.neonThemeColor);
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onSettingsChanged) {
    window.electronAPI.onSettingsChanged((s) => {
      if (s) {
        currentSettings = { ...currentSettings, ...s };
        applySettings(currentSettings);
      }
    });
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentSettings.theme === 'system') {
        applyTheme('system');
      }
    });
  }
}

// --- Window Controls ---
function setupWindowControls() {
  btnWinMin.addEventListener('click', () => window.electronAPI.minimizeWindow());
  btnWinMax.addEventListener('click', () => window.electronAPI.maximizeWindow());
  btnWinClose.addEventListener('click', () => window.electronAPI.closeWindow());
}

// --- Tab Drag & Drop Helpers ---
function applyTabReorder(newTabs) {
  currentTabs = newTabs;
  renderTabs();
  if (window.electronAPI && window.electronAPI.reorderTabs) {
    window.electronAPI.reorderTabs(currentTabs.map(t => ({
      id: t.id,
      groupId: t.groupId || null,
      isPinned: Boolean(t.isPinned)
    })));
  }
}

let isDraggingTab = false;
let draggedTabId = null;
let tabDragDroppedInside = false;

function clearDragIndicators() {
  document.querySelectorAll('.dragging, .drag-over-left, .drag-over-right, .drag-over-into-group').forEach(el => {
    el.classList.remove('dragging', 'drag-over-left', 'drag-over-right', 'drag-over-into-group');
  });
}

function setupTabsListDragDrop() {
  const container = document.getElementById('tab-strip-container') || tabsListEl;
  if (!container) return;

  // Auto-focus/raise target window smoothly when a tab is dragged over it
  let windowFocusTimer = null;
  document.addEventListener('dragenter', () => {
    if (!windowFocusTimer) {
      windowFocusTimer = setTimeout(() => {
        windowFocusTimer = null;
        if (window.electronAPI && window.electronAPI.focusWindow) {
          window.electronAPI.focusWindow();
        }
      }, 70);
    }
  });

  // Global dragover to ensure move cursor and prevent drop cancellation
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    if (!document.body.classList.contains('is-tab-dragging')) {
      document.body.classList.add('is-tab-dragging');
    }
  });

  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) {
      document.body.classList.remove('is-tab-dragging');
    }
  });

  window.addEventListener('mouseup', () => {
    document.body.classList.remove('is-tab-dragging');
  });

  window.addEventListener('blur', () => {
    document.body.classList.remove('is-tab-dragging');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.body.classList.remove('is-tab-dragging');
      clearDragIndicators();
    }
  });

  // Global drop fallback if dropped anywhere in the window
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('is-tab-dragging');
    if (e.target.closest('.browser-tab, .tab-group-header, #tab-strip-container')) {
      return;
    }
    e.preventDefault();
    clearDragIndicators();
    tabDragDroppedInside = true;

    let raw = '';
    try { raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'); } catch (err) {}
    let data = null;
    try { data = JSON.parse(raw); } catch (err) {}
    if (!data) return;

    const myWindowId = window.electronAPI && window.electronAPI.windowId;
    const isCrossWindow = Boolean(data.windowId && myWindowId && data.windowId !== myWindowId);

    if (isCrossWindow) {
      const optTab = {
        id: 'opt_tab_' + Date.now(),
        title: data.title || 'Вкладка',
        url: data.url || 'about:blank',
        favicon: data.favicon || '',
        isActive: true,
        isPinned: Boolean(data.isPinned),
        isEntering: true
      };
      currentTabs.forEach(t => t.isActive = false);
      currentTabs.push(optTab);
      renderTabs();

      if (window.electronAPI && window.electronAPI.transferTabBetweenWindows) {
        window.electronAPI.transferTabBetweenWindows({
          sourceWindowId: data.windowId,
          tabId: data.tabId,
          targetIndex: currentTabs.length - 1
        });
      }
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  container.addEventListener('drop', (e) => {
    document.body.classList.remove('is-tab-dragging');
    // Only handle drops on empty areas of tab bar (not on a .browser-tab or .tab-group-header)
    if (!e.target.closest('.browser-tab, .tab-group-header')) {
      e.preventDefault();
      clearDragIndicators();
      tabDragDroppedInside = true;

      let raw = '';
      try { raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'); } catch (err) {}
      let data = null;
      try { data = JSON.parse(raw); } catch (err) {}
      if (!data) return;

      const myWindowId = window.electronAPI && window.electronAPI.windowId;
      const isCrossWindow = Boolean(data.windowId && myWindowId && data.windowId !== myWindowId);

      if (isCrossWindow) {
        const optTab = {
          id: 'opt_tab_' + Date.now(),
          title: data.title || 'Вкладка',
          url: data.url || 'about:blank',
          favicon: data.favicon || '',
          isActive: true,
          isPinned: Boolean(data.isPinned),
          isEntering: true
        };
        currentTabs.forEach(t => t.isActive = false);
        currentTabs.push(optTab);
        renderTabs();

        if (window.electronAPI && window.electronAPI.transferTabBetweenWindows) {
          window.electronAPI.transferTabBetweenWindows({
            sourceWindowId: data.windowId,
            tabId: data.tabId,
            targetIndex: currentTabs.length - 1
          });
        }
        return;
      }

      if (data.type === 'tab' || data.type === 'blackhole-tab') {
        const draggedTab = currentTabs.find(t => t.id === data.tabId);
        if (!draggedTab) return;
        if (!draggedTab.isPinned) draggedTab.groupId = null;
        const remaining = currentTabs.filter(t => t.id !== data.tabId);
        remaining.push(draggedTab);
        applyTabReorder(remaining);
      } else if (data.type === 'group') {
        const groupTabs = currentTabs.filter(t => t.groupId === data.groupId && !t.isPinned);
        if (groupTabs.length === 0) return;
        const remaining = currentTabs.filter(t => t.groupId !== data.groupId || t.isPinned);
        remaining.push(...groupTabs);
        applyTabReorder(remaining);
      }
    }
  });
}

// --- Tabs Management ---
function renderTabs() {
  tabsListEl.innerHTML = '';
  const verticalTabsListEl = document.getElementById('vertical-tabs-list');
  if (verticalTabsListEl) verticalTabsListEl.innerHTML = '';

  const renderedGroupHeaders = new Set();

  currentTabs.forEach((tab) => {
    // If tab belongs to a group, render group header pill before the first tab of that group
    if (tab.groupId && !tab.isPinned) {
      const group = currentTabGroups.find(g => g.id === tab.groupId);
      if (group && !renderedGroupHeaders.has(group.id)) {
        renderedGroupHeaders.add(group.id);

        if (verticalTabsListEl) {
          const vGroupHeader = document.createElement('div');
          vGroupHeader.className = `vtab-group-header group-color-${group.color || 'purple'}`;
          vGroupHeader.style.cssText = 'padding: 6px 10px; font-size: 11px; font-weight: 600; color: #a855f7; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;';
          vGroupHeader.innerHTML = `<span class="tab-group-dot"></span><span>${group.name}</span>`;
          verticalTabsListEl.appendChild(vGroupHeader);
        }

        const groupHeader = document.createElement('div');
        groupHeader.className = `tab-group-header group-color-${group.color || 'purple'} ${group.isCollapsed ? 'collapsed' : ''}`;
        groupHeader.dataset.groupId = group.id;
        groupHeader.draggable = true;
        groupHeader.title = `Папка «${group.name}» (Клик: ${group.isCollapsed ? 'развернуть' : 'свернуть'}, Перетащите: сменить порядок, ПКМ: меню)`;

        const tabsInGroup = currentTabs.filter(t => t.groupId === group.id && !t.isPinned);

        groupHeader.innerHTML = `
          <span class="tab-group-dot"></span>
          <span class="tab-group-title">${group.name}</span>
          <span class="tab-group-count">${tabsInGroup.length}</span>
          <span class="tab-group-chevron">▾</span>
        `;

        // Left click: toggle collapse/expand
        groupHeader.addEventListener('click', (e) => {
          e.stopPropagation();
          window.electronAPI.toggleGroupCollapse(group.id);
        });

        // Right click: group context menu
        groupHeader.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.electronAPI.showGroupContextMenu(group.id, { x: e.clientX, y: e.clientY });
        });

        // Drag and Drop for Folder Header
        groupHeader.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'group', groupId: group.id }));
          document.body.classList.add('is-tab-dragging');
          setTimeout(() => groupHeader.classList.add('dragging'), 0);
        });

        groupHeader.addEventListener('dragend', () => {
          clearDragIndicators();
          groupHeader.classList.remove('dragging');
          document.body.classList.remove('is-tab-dragging');
        });

        groupHeader.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';

          const rect = groupHeader.getBoundingClientRect();
          const isLeft = e.clientX < (rect.left + rect.width / 2);

          try {
            const isGroup = document.querySelector('.tab-group-header.dragging');
            if (isGroup) {
              if (isLeft) {
                groupHeader.classList.add('drag-over-left');
                groupHeader.classList.remove('drag-over-right', 'drag-over-into-group');
              } else {
                groupHeader.classList.add('drag-over-right');
                groupHeader.classList.remove('drag-over-left', 'drag-over-into-group');
              }
            } else {
              groupHeader.classList.add('drag-over-into-group');
              groupHeader.classList.remove('drag-over-left', 'drag-over-right');
            }
          } catch (err) {}
        });

        groupHeader.addEventListener('dragleave', () => {
          groupHeader.classList.remove('drag-over-left', 'drag-over-right', 'drag-over-into-group');
        });

        groupHeader.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          clearDragIndicators();
          document.body.classList.remove('is-tab-dragging');
          tabDragDroppedInside = true;

          let raw = '';
          try { raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'); } catch (err) {}
          let data = null;
          try { data = JSON.parse(raw); } catch (err) {}
          if (!data) return;

          const myWindowId = window.electronAPI && window.electronAPI.windowId;
          const isCrossWindow = Boolean(data.windowId && myWindowId && data.windowId !== myWindowId);

          if (isCrossWindow) {
            const firstGroupTabIdx = currentTabs.findIndex(t => t.groupId === group.id && !t.isPinned);
            const insertIdx = firstGroupTabIdx !== -1 ? firstGroupTabIdx : currentTabs.length;
            if (window.electronAPI && window.electronAPI.transferTabBetweenWindows) {
              window.electronAPI.transferTabBetweenWindows({
                sourceWindowId: data.windowId,
                tabId: data.tabId,
                targetIndex: insertIdx,
                groupId: data.isPinned ? null : group.id
              });
            }
            return;
          }

          if (data.type === 'tab' || data.type === 'blackhole-tab') {
            const draggedTab = currentTabs.find(t => t.id === data.tabId);
            if (!draggedTab || draggedTab.isPinned) return;

            draggedTab.groupId = group.id;

            const remaining = currentTabs.filter(t => t.id !== data.tabId);
            const firstGroupTabIdx = remaining.findIndex(t => t.groupId === group.id && !t.isPinned);
            const insertIdx = firstGroupTabIdx !== -1 ? firstGroupTabIdx : remaining.length;
            remaining.splice(insertIdx, 0, draggedTab);
            applyTabReorder(remaining);
          } else if (data.type === 'group') {
            if (data.groupId === group.id) return;

            const groupTabs = currentTabs.filter(t => t.groupId === data.groupId && !t.isPinned);
            if (groupTabs.length === 0) return;

            const remaining = currentTabs.filter(t => t.groupId !== data.groupId || t.isPinned);
            const rect = groupHeader.getBoundingClientRect();
            const isLeft = e.clientX < (rect.left + rect.width / 2);

            if (isLeft) {
              const targetFirstIdx = remaining.findIndex(t => t.groupId === group.id && !t.isPinned);
              const insertIdx = targetFirstIdx !== -1 ? targetFirstIdx : remaining.length;
              remaining.splice(insertIdx, 0, ...groupTabs);
            } else {
              let targetLastIdx = -1;
              for (let i = remaining.length - 1; i >= 0; i--) {
                if (remaining[i].groupId === group.id && !remaining[i].isPinned) {
                  targetLastIdx = i;
                  break;
                }
              }
              const insertIdx = targetLastIdx !== -1 ? targetLastIdx + 1 : remaining.length;
              remaining.splice(insertIdx, 0, ...groupTabs);
            }
            applyTabReorder(remaining);
          }
        });

        tabsListEl.appendChild(groupHeader);
      }
    }

    const tabGroup = tab.groupId && !tab.isPinned ? currentTabGroups.find(g => g.id === tab.groupId) : null;
    const isGroupCollapsed = tabGroup && tabGroup.isCollapsed;

    const inGroupClass = tabGroup ? `in-group group-color-${tabGroup.color || 'purple'}` : '';
    const groupHiddenClass = (isGroupCollapsed && !tab.isActive) ? 'group-hidden' : '';
    const enteringClass = tab.isEntering ? 'tab-entering' : '';
    if (tab.isEntering) delete tab.isEntering;

    const isSplitSec = Boolean(tab.isSplitSecondary);
    const splitSecClass = isSplitSec ? 'is-split-secondary' : '';

    const tabEl = document.createElement('div');
    tabEl.className = `browser-tab ${tab.isActive ? 'active' : ''} ${splitSecClass} ${tab.isPinned ? 'pinned' : ''} ${tab.isSleeping ? 'sleeping' : ''} ${inGroupClass} ${groupHiddenClass} ${enteringClass}`;
    tabEl.dataset.tabId = tab.id;
    if (tab.groupId) tabEl.dataset.groupId = tab.groupId;
    tabEl.draggable = true;

    // Favicon
    const faviconEl = document.createElement('div');
    faviconEl.className = 'tab-favicon';
    if (tab.isLoading) {
      faviconEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
    } else if (tab.favicon) {
      faviconEl.innerHTML = `<img src="${tab.favicon}" onerror="this.src='https://www.google.com/favicon.ico'">`;
    } else {
      faviconEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
    }
    tabEl.appendChild(faviconEl);

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || 'Новая вкладка';
    tabEl.appendChild(titleEl);

    // Badges (Audio / Sleeping)
    if (tab.isPlayingAudio) {
      const audioBadge = document.createElement('span');
      audioBadge.className = 'tab-badge';
      audioBadge.title = tab.isMuted ? 'Звук выключен' : 'Воспроизводится звук';
      audioBadge.textContent = tab.isMuted ? '🔇' : '🔊';
      audioBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        window.electronAPI.toggleMute(tab.id);
      });
      tabEl.appendChild(audioBadge);
    }

    if (tab.isSleeping) {
      const sleepBadge = document.createElement('span');
      sleepBadge.className = 'tab-badge';
      sleepBadge.title = 'Вкладка в спящем режиме (RAM выгружена)';
      sleepBadge.textContent = '💤';
      tabEl.appendChild(sleepBadge);
    }

    if (tab.isSplitSecondary) {
      const splitBadge = document.createElement('span');
      splitBadge.className = 'tab-badge tab-badge-split';
      splitBadge.title = 'Вторая активная вкладка (Разделение экрана). Нажмите, чтобы сделать основной.';
      splitBadge.textContent = '🪟';
      splitBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.swapSplitScreenTabs) {
          window.electronAPI.swapSplitScreenTabs();
        }
      });
      tabEl.appendChild(splitBadge);
    }

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close-btn';
    closeBtn.title = 'Закрыть вкладку';
    closeBtn.innerHTML = `✕`;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.closeTab(tab.id);
    });
    tabEl.appendChild(closeBtn);

    // Tab Switch Click
    tabEl.addEventListener('click', () => {
      if (tabEl.classList.contains('dragging')) return;
      window.electronAPI.switchTab(tab.id);
    });

    // Middle click to close
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.electronAPI.closeTab(tab.id);
      }
    });

    // Right click context menu
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.electronAPI.showTabContextMenu(tab.id, { x: e.clientX, y: e.clientY });
    });

    // Tab Drag and Drop
    tabEl.addEventListener('dragstart', (e) => {
      if (e.target.closest('.tab-close-btn, .tab-badge')) {
        e.preventDefault();
        return;
      }
      isDraggingTab = true;
      draggedTabId = tab.id;
      tabDragDroppedInside = false;

      e.dataTransfer.effectAllowed = 'move';
      const dragData = {
        type: 'blackhole-tab',
        windowId: window.electronAPI ? window.electronAPI.windowId : null,
        tabId: tab.id,
        isPinned: Boolean(tab.isPinned),
        groupId: tab.groupId || null,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon
      };
      const jsonStr = JSON.stringify(dragData);
      e.dataTransfer.setData('text/plain', jsonStr);
      try { e.dataTransfer.setData('application/json', jsonStr); } catch (err) {}

      // Custom sleek glowing drag ghost
      try {
        const ghost = document.createElement('div');
        ghost.className = 'blackhole-drag-ghost';
        const favHtml = tab.favicon
          ? `<img src="${tab.favicon}" onerror="this.src='https://www.google.com/favicon.ico'">`
          : '🪐';
        const titleTxt = (tab.title || 'Новая вкладка').slice(0, 24);
        ghost.innerHTML = `<span class="ghost-favicon">${favHtml}</span><span class="ghost-title">${titleTxt}</span>`;
        document.body.appendChild(ghost);
        if (e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(ghost, 24, 16);
        }
        requestAnimationFrame(() => ghost.remove());
      } catch (err) {}

      document.body.classList.add('is-tab-dragging');

      if (window.electronAPI && window.electronAPI.startTabDrag) {
        window.electronAPI.startTabDrag({ tabId: tab.id });
      }

      setTimeout(() => tabEl.classList.add('dragging'), 0);
    });

    tabEl.addEventListener('dragend', async (e) => {
      clearDragIndicators();
      tabEl.classList.remove('dragging');
      document.body.classList.remove('is-tab-dragging');
      isDraggingTab = false;

      let isHandled = false;
      if (window.electronAPI && window.electronAPI.endTabDrag) {
        try {
          isHandled = await window.electronAPI.endTabDrag();
        } catch (err) {}
      }

      // Tab Tear-off: drag tab outside top bar to open in a separate window
      // Only tear off if the drag was NOT handled by another window (or inside this window)
      if (!isHandled && !tabDragDroppedInside && draggedTabId === tab.id) {
        const stillExistsInWindow = currentTabs.some(t => t.id === tab.id);
        const isDraggedOutside = (e.clientY > 75 || e.clientY < -20 || e.clientX < -20 || e.clientX > window.innerWidth + 20);
        if (stillExistsInWindow && isDraggedOutside && window.electronAPI && window.electronAPI.moveTabToNewWindow) {
          window.electronAPI.moveTabToNewWindow(tab.id, {
            screenX: e.screenX,
            screenY: e.screenY,
            closeIfSingle: false
          });
        }
      }
      draggedTabId = null;
      tabDragDroppedInside = false;
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      const rect = tabEl.getBoundingClientRect();
      const isLeft = e.clientX < (rect.left + rect.width / 2);

      if (isLeft) {
        tabEl.classList.add('drag-over-left');
        tabEl.classList.remove('drag-over-right');
      } else {
        tabEl.classList.add('drag-over-right');
        tabEl.classList.remove('drag-over-left');
      }
    });

    tabEl.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && tabEl.contains(e.relatedTarget)) return;
      tabEl.classList.remove('drag-over-left', 'drag-over-right');
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearDragIndicators();
      document.body.classList.remove('is-tab-dragging');
      tabDragDroppedInside = true;

      let raw = '';
      try { raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'); } catch (err) {}
      let data = null;
      try { data = JSON.parse(raw); } catch (err) {}
      if (!data) return;

      const myWindowId = window.electronAPI && window.electronAPI.windowId;
      const isCrossWindow = Boolean(data.windowId && myWindowId && data.windowId !== myWindowId);

      const rect = tabEl.getBoundingClientRect();
      const isLeft = e.clientX < (rect.left + rect.width / 2);
      const targetIdx = currentTabs.findIndex(t => t.id === tab.id);

      if (isCrossWindow) {
        const insertIdx = (targetIdx === -1) ? currentTabs.length : (isLeft ? targetIdx : targetIdx + 1);
        // Instant Optimistic UI tab insertion with slide-in animation!
        const optTab = {
          id: 'opt_tab_' + Date.now(),
          title: data.title || 'Вкладка',
          url: data.url || 'about:blank',
          favicon: data.favicon || '',
          isActive: true,
          isPinned: Boolean(data.isPinned),
          groupId: (!data.isPinned && tab.groupId) ? tab.groupId : null,
          isEntering: true
        };
        currentTabs.forEach(t => t.isActive = false);
        currentTabs.splice(insertIdx, 0, optTab);
        renderTabs();

        if (window.electronAPI && window.electronAPI.transferTabBetweenWindows) {
          window.electronAPI.transferTabBetweenWindows({
            sourceWindowId: data.windowId,
            tabId: data.tabId,
            targetIndex: insertIdx,
            groupId: (!data.isPinned && tab.groupId) ? tab.groupId : null
          });
        }
        return;
      }

      if (data.type === 'tab' || data.type === 'blackhole-tab') {
        if (data.tabId === tab.id) return;

        const draggedTab = currentTabs.find(t => t.id === data.tabId);
        if (!draggedTab) return;

        // Group assignment
        if (!draggedTab.isPinned && !tab.isPinned) {
          draggedTab.groupId = tab.groupId || null;
        }

        const remaining = currentTabs.filter(t => t.id !== data.tabId);
        const idx = remaining.findIndex(t => t.id === tab.id);
        if (idx === -1) return;

        const insertIdx = isLeft ? idx : idx + 1;
        remaining.splice(insertIdx, 0, draggedTab);
        applyTabReorder(remaining);
      } else if (data.type === 'group') {
        const groupTabs = currentTabs.filter(t => t.groupId === data.groupId && !t.isPinned);
        if (groupTabs.length === 0) return;

        const remaining = currentTabs.filter(t => t.groupId !== data.groupId || t.isPinned);
        const targetIdx = remaining.findIndex(t => t.id === tab.id);
        if (targetIdx === -1) return;

        const insertIdx = isLeft ? targetIdx : targetIdx + 1;
        remaining.splice(insertIdx, 0, ...groupTabs);
        applyTabReorder(remaining);
      }
    });

    tabsListEl.appendChild(tabEl);

    // Also build Vertical Tab Element for vertical tabs sidebar
    if (verticalTabsListEl) {
      const vtabEl = document.createElement('div');
      vtabEl.className = `vtab-item ${tab.isActive ? 'active' : ''} ${splitSecClass} ${tab.isSleeping ? 'sleeping' : ''}`;
      vtabEl.dataset.tabId = tab.id;
      vtabEl.title = tab.title ? `${tab.title}\n${tab.url || ''}` : 'Вкладка';

      // Favicon
      const vFavEl = document.createElement('div');
      vFavEl.className = 'vtab-favicon';
      if (tab.isLoading) {
        vFavEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
      } else if (tab.favicon) {
        vFavEl.innerHTML = `<img src="${tab.favicon}" onerror="this.src='https://www.google.com/favicon.ico'">`;
      } else {
        vFavEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
      }
      vtabEl.appendChild(vFavEl);

      // Title
      const vTitleEl = document.createElement('span');
      vTitleEl.className = 'vtab-title';
      vTitleEl.textContent = tab.title || 'Новая вкладка';
      vtabEl.appendChild(vTitleEl);

      // Badges
      const vBadgesEl = document.createElement('div');
      vBadgesEl.className = 'vtab-badges';

      if (tab.isPlayingAudio) {
        const audioBadge = document.createElement('span');
        audioBadge.className = 'tab-badge';
        audioBadge.title = tab.isMuted ? 'Звук выключен' : 'Воспроизводится звук';
        audioBadge.textContent = tab.isMuted ? '🔇' : '🔊';
        audioBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          window.electronAPI.toggleMute(tab.id);
        });
        vBadgesEl.appendChild(audioBadge);
      }

      if (tab.isSleeping) {
        const sleepBadge = document.createElement('span');
        sleepBadge.className = 'tab-badge';
        sleepBadge.title = 'Вкладка в спящем режиме (RAM выгружена)';
        sleepBadge.textContent = '💤';
        vBadgesEl.appendChild(sleepBadge);
      }

      if (tab.isSplitSecondary) {
        const splitBadge = document.createElement('span');
        splitBadge.className = 'tab-badge tab-badge-split';
        splitBadge.title = 'Вторая активная вкладка (Разделение экрана). Нажмите, чтобы поменять местами.';
        splitBadge.textContent = '🪟';
        splitBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.electronAPI && window.electronAPI.swapSplitScreenTabs) {
            window.electronAPI.swapSplitScreenTabs();
          }
        });
        vBadgesEl.appendChild(splitBadge);
      }

      vtabEl.appendChild(vBadgesEl);

      // Close button
      const vCloseBtn = document.createElement('button');
      vCloseBtn.className = 'vtab-close-btn';
      vCloseBtn.title = 'Закрыть вкладку';
      vCloseBtn.innerHTML = '✕';
      vCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.electronAPI.closeTab(tab.id);
      });
      vtabEl.appendChild(vCloseBtn);

      // Events
      vtabEl.addEventListener('click', () => {
        window.electronAPI.switchTab(tab.id);
      });

      vtabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.electronAPI.closeTab(tab.id);
        }
      });

      vtabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.electronAPI.showTabContextMenu(tab.id, { x: e.clientX, y: e.clientY });
      });

      verticalTabsListEl.appendChild(vtabEl);
    }
  });

  const vtabCountEl = document.getElementById('vtab-tab-count');
  if (vtabCountEl) {
    const n = currentTabs.length;
    let word = 'вкладок';
    if (n % 10 === 1 && n % 100 !== 11) word = 'вкладка';
    else if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) word = 'вкладки';
    vtabCountEl.textContent = `${n} ${word}`;
  }
}

// --- Tab Groups (Folders) Controller ---
let targetTabIdForNewGroup = null;
let editingGroupId = null;
let selectedGroupColor = 'purple';

function setupTabGroupsUI() {
  const modal = document.getElementById('modal-tab-group');
  const nameInput = document.getElementById('tab-group-name-input');
  const modalTitle = document.getElementById('tab-group-modal-title');
  const colorPicker = document.getElementById('tab-group-color-picker');
  const btnSave = document.getElementById('btn-tab-group-save');
  const btnCancel = document.getElementById('btn-tab-group-cancel');

  if (colorPicker) {
    colorPicker.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        colorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        selectedGroupColor = dot.dataset.color || 'purple';
      });
    });
  }

  function openCreateModal(tabId) {
    targetTabIdForNewGroup = tabId;
    editingGroupId = null;
    modalTitle.innerHTML = `📁 Новая папка с вкладками`;

    const tab = currentTabs.find(t => t.id === tabId);
    nameInput.value = (tab && tab.title && tab.title !== 'Новая вкладка')
      ? tab.title.split(' - ')[0].substring(0, 20)
      : 'Папка';
    selectedGroupColor = 'purple';

    if (colorPicker) {
      colorPicker.querySelectorAll('.color-dot').forEach(d => {
        d.classList.toggle('active', d.dataset.color === 'purple');
      });
    }

    openModal(modal);
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
  }

  function openEditModal(groupId) {
    const group = currentTabGroups.find(g => g.id === groupId);
    if (!group) return;

    editingGroupId = groupId;
    targetTabIdForNewGroup = null;
    modalTitle.innerHTML = `🎨 Настроить папку «${group.name}»`;
    nameInput.value = group.name;
    selectedGroupColor = group.color || 'purple';

    if (colorPicker) {
      colorPicker.querySelectorAll('.color-dot').forEach(d => {
        d.classList.toggle('active', d.dataset.color === selectedGroupColor);
      });
    }

    openModal(modal);
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const name = nameInput.value.trim() || 'Папка';
      const color = selectedGroupColor;

      if (editingGroupId) {
        await window.electronAPI.updateTabGroup(editingGroupId, { name, color });
      } else if (targetTabIdForNewGroup) {
        await window.electronAPI.createTabGroup({
          name,
          color,
          tabIds: [targetTabIdForNewGroup]
        });
      }
      closeModal(modal);
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      closeModal(modal);
    });
  }

  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSave.click();
      if (e.key === 'Escape') closeModal(modal);
    });
  }

  // Prompt Listeners from Electron Main Process
  if (window.electronAPI.onPromptCreateTabGroup) {
    window.electronAPI.onPromptCreateTabGroup((data) => {
      if (data && data.tabId) {
        openCreateModal(data.tabId);
      }
    });
  }

  if (window.electronAPI.onPromptEditTabGroup) {
    window.electronAPI.onPromptEditTabGroup((data) => {
      if (data && data.groupId) {
        openEditModal(data.groupId);
      }
    });
  }
}

btnNewTab.addEventListener('click', () => {
  window.electronAPI.createTab({ url: isIncognitoWindow ? 'eclipse://incognito' : 'eclipse://newtab', active: true });
});

// --- Navigation ---
function setupNavigation() {
  btnBack.addEventListener('click', () => window.electronAPI.goBack());
  btnForward.addEventListener('click', () => window.electronAPI.goForward());
  
  btnReload.addEventListener('click', () => {
    const activeTab = currentTabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.isLoading) {
      window.electronAPI.stop();
    } else {
      window.electronAPI.reload();
    }
  });

  btnHome.addEventListener('click', () => {
    window.electronAPI.navigate(isIncognitoWindow ? 'eclipse://incognito' : 'eclipse://newtab');
  });

  btnBookmarkToggle.addEventListener('click', async () => {
    const activeTab = currentTabs.find(t => t.id === activeTabId);
    if (!activeTab || !activeTab.url || activeTab.url.startsWith('eclipse://')) return;

    const isBm = await window.electronAPI.isBookmarked(activeTab.url);
    if (isBm) {
      const existing = bookmarks.find(b => b.url === activeTab.url);
      if (existing) {
        bookmarks = await window.electronAPI.removeBookmark(existing.id);
      }
    } else {
      const added = await window.electronAPI.addBookmark({
        title: activeTab.title || 'Страница',
        url: activeTab.url,
        favicon: activeTab.favicon
      });
      bookmarks.unshift(added);
    }
    renderBookmarksBar(bookmarks);
    updateBookmarkStar(activeTab.url);
  });
}

let currentNavTabId = null;
let currentNavIsLoading = false;
let loadProgressTimeout = null;

function updateNavControls(tab) {
  btnBack.disabled = !tab.canGoBack;
  btnForward.disabled = !tab.canGoForward;

  const isSameTab = (currentNavTabId === tab.id);
  const wasLoading = isSameTab ? currentNavIsLoading : false;
  currentNavTabId = tab.id;
  currentNavIsLoading = Boolean(tab.isLoading);

  if (loadProgressTimeout) {
    clearTimeout(loadProgressTimeout);
    loadProgressTimeout = null;
  }

  if (tab.isLoading) {
    iconReload.classList.add('hidden');
    iconStop.classList.remove('hidden');
    loadProgressBar.classList.add('loading');
    loadProgressBar.style.width = '70%';
  } else {
    iconReload.classList.remove('hidden');
    iconStop.classList.add('hidden');
    if (wasLoading) {
      loadProgressBar.style.width = '100%';
      loadProgressTimeout = setTimeout(() => {
        loadProgressBar.classList.remove('loading');
        loadProgressBar.style.width = '0%';
        loadProgressTimeout = null;
      }, 200);
    } else {
      loadProgressBar.classList.remove('loading');
      loadProgressBar.style.width = '0%';
    }
  }

  if (document.activeElement !== omniboxInput) {
    if (tab.url && !tab.url.startsWith('eclipse://') && !tab.url.startsWith('about:')) {
      omniboxInput.value = tab.url;
    } else {
      omniboxInput.value = '';
    }
  }

  updateBookmarkStar(tab.url);
  if (window.refreshShieldStatus) {
    window.refreshShieldStatus();
  }
}

function updateOmniboxForActiveTab() {
  const activeTab = currentTabs.find(t => t.id === activeTabId);
  if (activeTab) {
    updateNavControls(activeTab);
  }
}

async function updateBookmarkStar(url) {
  if (!url || url.startsWith('eclipse://')) {
    btnBookmarkToggle.classList.remove('bookmarked');
    return;
  }
  const isBm = await window.electronAPI.isBookmarked(url);
  if (isBm) {
    btnBookmarkToggle.classList.add('bookmarked');
    iconStar.setAttribute('fill', '#fbbf24');
  } else {
    btnBookmarkToggle.classList.remove('bookmarked');
    iconStar.setAttribute('fill', 'none');
  }
}

// --- Omnibox ---
function setupOmnibox() {
  omniboxInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = omniboxInput.value.trim();
      if (val) {
        window.electronAPI.navigate(val);
        omniboxInput.blur();
      }
    } else if (e.key === 'Escape') {
      updateOmniboxForActiveTab();
      omniboxInput.blur();
    }
  });

  omniboxInput.addEventListener('focus', () => {
    omniboxInput.select();
  });
}

// --- Bookmarks Bar ---
function renderBookmarksBar(bms) {
  bookmarksBarList.innerHTML = '';
  bms.slice(0, 14).forEach((bm) => {
    const item = document.createElement('div');
    item.className = 'bm-item';
    item.title = bm.url;

    if (bm.favicon) {
      const img = document.createElement('img');
      img.src = bm.favicon;
      img.onerror = () => { img.style.display = 'none'; };
      item.appendChild(img);
    }

    const span = document.createElement('span');
    span.textContent = bm.title;
    item.appendChild(span);

    item.addEventListener('click', () => {
      window.electronAPI.navigate(bm.url);
    });

    bookmarksBarList.appendChild(item);
  });
}

// --- Extensions System ---
async function loadExtensions() {
  const exts = await window.electronAPI.getExtensions();
  currentExtensions = exts || [];
  renderExtensionIcons(currentExtensions);
  renderExtensionsGrid(currentExtensions);
  updatePopularExtensionsState(currentExtensions);
}

function updatePopularExtensionsState(installedExtensions) {
  const installedIds = new Set((installedExtensions || []).map(e => e.id));
  document.querySelectorAll('.popular-ext-card').forEach(card => {
    const extId = card.dataset.id;
    const btn = card.querySelector('.btn-install-popular');
    if (btn) {
      if (installedIds.has(extId)) {
        btn.textContent = '✓ Установлено';
        btn.disabled = true;
        btn.classList.remove('btn-primary', 'btn-outline');
        btn.classList.add('btn-secondary');
      } else {
        btn.textContent = 'Установить';
        btn.disabled = false;
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-outline');
      }
    }
  });
}

function renderExtensionIcons(extensions) {
  extensionActionIcons.innerHTML = '';

  const activeExts = (extensions || []).filter(e => e.enabled && (e.isPinned !== false) && e.hasPopup);
  activeExts.forEach((ext) => {
    const btn = document.createElement('button');
    btn.className = 'extension-action-btn';
    btn.title = `${ext.name} (v${ext.version})`;

    if (ext.icon) {
      btn.innerHTML = `<img src="${ext.icon}" alt="${ext.name}">`;
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btn.getBoundingClientRect();
      window.electronAPI.openExtensionPopup(ext.id, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.electronAPI.showExtensionContextMenu) {
        window.electronAPI.showExtensionContextMenu(ext.id, { x: e.clientX, y: e.clientY });
      }
    });

    extensionActionIcons.appendChild(btn);
  });
}

function renderExtensionsGrid(extensions, searchQuery = '') {
  const grid = document.getElementById('extensions-grid');
  const countBadge = document.getElementById('extensions-count-badge');
  if (!grid) return;
  grid.innerHTML = '';

  const allExts = extensions || [];
  if (countBadge) countBadge.textContent = allExts.length;

  const query = (searchQuery || '').trim().toLowerCase();
  const filtered = query
    ? allExts.filter(e =>
        (e.name && e.name.toLowerCase().includes(query)) ||
        (e.description && e.description.toLowerCase().includes(query)) ||
        (e.id && e.id.toLowerCase().includes(query))
      )
    : allExts;

  if (filtered.length === 0) {
    if (query) {
      grid.innerHTML = `<div style="text-align:center; padding: 24px; color: var(--text-muted);">Ничего не найдено по запросу "${searchQuery}"</div>`;
    } else {
      grid.innerHTML = `<div style="text-align:center; padding: 24px; color: var(--text-muted);">Нет установленных расширений. Добавьте .CRX/.ZIP или установите из каталога выше.</div>`;
    }
    return;
  }

  filtered.forEach((ext) => {
    const card = document.createElement('div');
    card.className = `ext-card ${ext.enabled ? '' : 'disabled'}`;

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = 'ext-icon';
    if (ext.icon) {
      iconDiv.innerHTML = `<img src="${ext.icon}" alt="${ext.name}">`;
    } else {
      iconDiv.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path></svg>`;
    }
    card.appendChild(iconDiv);

    // Info
    const infoDiv = document.createElement('div');
    infoDiv.className = 'ext-info';
    infoDiv.innerHTML = `
      <div>
        <span class="ext-name">${ext.name}</span>
        <span class="ext-version">v${ext.version} (MV${ext.manifestVersion})</span>
      </div>
      <div class="ext-desc">${ext.description || 'Без описания'}</div>
      <div class="ext-details-row">
        <span class="ext-id-tag">ID: ${ext.id}</span>
      </div>
    `;
    card.appendChild(infoDiv);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'ext-actions';

    // Pin button
    const isPinned = ext.isPinned !== false;
    const pinBtn = document.createElement('button');
    pinBtn.className = `ext-btn-pin ${isPinned ? 'pinned' : ''}`;
    pinBtn.title = isPinned ? 'Закреплено на панели инструментов' : 'Закрепить на панели инструментов';
    pinBtn.innerHTML = `<span>📌</span><span>${isPinned ? 'Закреплено' : 'Закрепить'}</span>`;
    pinBtn.addEventListener('click', async () => {
      await window.electronAPI.toggleExtensionPin(ext.id, !isPinned);
      loadExtensions();
    });
    actionsDiv.appendChild(pinBtn);

    // Options Button
    const optBtn = document.createElement('button');
    optBtn.className = 'ext-btn-options';
    optBtn.title = 'Открыть настройки и параметры расширения';
    optBtn.innerHTML = `<span>⚙️</span><span>Параметры</span>`;
    optBtn.addEventListener('click', () => {
      closeModal(modalExtensions);
      window.electronAPI.openExtensionOptions(ext.id);
    });
    actionsDiv.appendChild(optBtn);

    // VirusTotal Check Button
    const vtBtn = document.createElement('button');
    vtBtn.className = 'ext-btn-vt';
    vtBtn.title = 'Проверить расширение в VirusTotal';
    vtBtn.innerHTML = `<span>🛡️</span><span>VirusTotal</span>`;
    vtBtn.addEventListener('click', () => {
      closeModal(modalExtensions);
      if (window.electronAPI && window.electronAPI.checkVirusTotal) {
        window.electronAPI.checkVirusTotal(`https://chromewebstore.google.com/detail/${ext.id}`);
      }
    });
    actionsDiv.appendChild(vtBtn);

    // Toggle switch
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle-switch';
    toggleLabel.title = ext.enabled ? 'Отключить расширение' : 'Включить расширение';
    toggleLabel.innerHTML = `
      <input type="checkbox" ${ext.enabled ? 'checked' : ''}>
      <span class="slider"></span>
    `;
    toggleLabel.querySelector('input').addEventListener('change', async (e) => {
      await window.electronAPI.toggleExtension(ext.id, e.target.checked);
      loadExtensions();
    });
    actionsDiv.appendChild(toggleLabel);

    // Remove Button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-btn-delete';
    removeBtn.title = 'Полностью удалить расширение из браузера';
    removeBtn.innerHTML = `<span>🗑️</span><span>Удалить</span>`;
    removeBtn.addEventListener('click', async () => {
      if (confirm(`Вы действительно хотите удалить расширение "${ext.name}"?`)) {
        await window.electronAPI.removeExtension(ext.id);
        loadExtensions();
      }
    });
    actionsDiv.appendChild(removeBtn);

    card.appendChild(actionsDiv);
    grid.appendChild(card);
  });
}

function setupExtensionsUI() {
  const btnExtMenu = document.getElementById('btn-extensions-menu');
  const dropdownExt = document.getElementById('dropdown-extensions');
  const btnQuickManage = document.getElementById('btn-quick-manage-ext');
  const btnDropdownManage = document.getElementById('btn-dropdown-manage');
  const btnDropdownWebstore = document.getElementById('btn-dropdown-webstore');
  const searchInput = document.getElementById('extensions-search-input');

  const btnInstallCrx = document.getElementById('btn-install-crx');
  const btnInstallDir = document.getElementById('btn-install-dir');
  const dropZone = document.getElementById('extension-drop-zone');
  const btnInstallWebstore = document.getElementById('btn-install-webstore');
  const webstoreExtInput = document.getElementById('webstore-ext-input');
  const btnOpenWebstore = document.getElementById('btn-open-webstore');

  // Open Full Extensions Manager Modal on clicking puzzle icon
  if (btnExtMenu) {
    btnExtMenu.addEventListener('click', () => {
      openModal(modalExtensions);
      loadExtensions();
    });
  }

  // Extensions Live Search Filter
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderExtensionsGrid(currentExtensions, searchInput.value);
    });
  }

  // Web Store Online Installer
  if (btnInstallWebstore && webstoreExtInput) {
    const handleWebstoreInstall = async () => {
      const val = webstoreExtInput.value.trim();
      if (!val) {
        alert('Пожалуйста, введите ссылку на расширение из Chrome Web Store или 32-значный ID.');
        return;
      }

      btnInstallWebstore.disabled = true;
      const originalText = btnInstallWebstore.textContent;
      btnInstallWebstore.textContent = '⏳ Установка...';

      try {
        const res = await window.electronAPI.installExtensionFromWebStore(val);
        if (res && res.success) {
          webstoreExtInput.value = '';
          await loadExtensions();
          alert(`🎉 Расширение "${(res.extension && res.extension.name) || 'Chrome'}" успешно установлено!`);
        } else {
          alert('Ошибка установки: ' + ((res && res.error) || 'Неизвестная ошибка'));
        }
      } catch (err) {
        alert('Ошибка связи: ' + err.message);
      } finally {
        btnInstallWebstore.disabled = false;
        btnInstallWebstore.textContent = originalText;
      }
    };

    btnInstallWebstore.addEventListener('click', handleWebstoreInstall);
    webstoreExtInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleWebstoreInstall();
    });
  }

  // Open Web Store Button
  if (btnOpenWebstore) {
    btnOpenWebstore.addEventListener('click', () => {
      closeModal(modalExtensions);
      window.electronAPI.createTab({ url: 'https://chromewebstore.google.com' });
    });
  }

  // Popular Extensions 1-Click Install Buttons
  document.querySelectorAll('.btn-install-popular').forEach(btn => {
    btn.addEventListener('click', async () => {
      const extId = btn.dataset.id;
      if (!extId) return;

      btn.disabled = true;
      btn.textContent = '⏳...';

      try {
        const res = await window.electronAPI.installExtensionFromWebStore(extId);
        if (res && res.success) {
          await loadExtensions();
        } else {
          alert('Ошибка установки: ' + ((res && res.error) || 'Неизвестная ошибка'));
          btn.disabled = false;
          btn.textContent = 'Установить';
        }
      } catch (err) {
        alert('Ошибка: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Установить';
      }
    });
  });

  if (btnInstallCrx) {
    btnInstallCrx.addEventListener('click', async () => {
      const res = await window.electronAPI.installExtensionFileDialog();
      if (res && res.success) {
        loadExtensions();
      } else if (res && res.error) {
        alert('Ошибка установки расширения: ' + res.error);
      }
    });
  }

  if (btnInstallDir) {
    btnInstallDir.addEventListener('click', async () => {
      const res = await window.electronAPI.installExtensionDirDialog();
      if (res && res.success) {
        loadExtensions();
      } else if (res && res.error) {
        alert('Ошибка установки расширения: ' + res.error);
      }
    });
  }

  // Drag & Drop
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const filePath = file.path;
        if (filePath) {
          const res = await window.electronAPI.installExtensionFromPath(filePath);
          if (res && res.success) {
            loadExtensions();
          } else if (res && res.error) {
            alert('Ошибка установки: ' + res.error);
          }
        }
      }
    });
  }
}

// --- Modals Management ---
function setupModals() {
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      if (modalId) {
        closeModal(document.getElementById(modalId));
      }
    });
  });

  // Close on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    });
  });

  // History button (Toggle Chrome-style floating history bubble)
  const btnHistoryMenu = document.getElementById('btn-history-menu');
  if (btnHistoryMenu) {
    btnHistoryMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btnHistoryMenu.getBoundingClientRect();
      if (window.electronAPI && window.electronAPI.toggleHistoryBubble) {
        window.electronAPI.toggleHistoryBubble({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        });
      }
    });
  }

  // Downloads button (Toggle Chrome-style floating downloads bubble)
  const btnDownloadsMenu = document.getElementById('btn-downloads-menu');
  if (btnDownloadsMenu) {
    btnDownloadsMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btnDownloadsMenu.getBoundingClientRect();
      if (window.electronAPI && window.electronAPI.toggleDownloadsBubble) {
        window.electronAPI.toggleDownloadsBubble({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        });
      }
    });
  }

  // Bookmarks button
  document.getElementById('btn-bookmarks-menu').addEventListener('click', async () => {
    openModal(modalBookmarks);
    renderFullBookmarks();
  });

  // Memory stats button
  document.getElementById('btn-memory-saver').addEventListener('click', async () => {
    openModal(modalMemory);
    updatePerformanceStats();
  });

  // Settings button
  document.getElementById('btn-settings-menu').addEventListener('click', () => {
    openModal(modalSettings);
  });

  // Extensions button
  const btnExtMenu = document.getElementById('btn-extensions-menu');
  if (btnExtMenu) {
    btnExtMenu.addEventListener('click', () => {
      openModal(modalExtensions);
      loadExtensions();
    });
  }
}

function syncTopBarHeight() {
  const topBar = document.getElementById('top-bar');
  if (topBar && window.electronAPI && window.electronAPI.setTopBarHeight) {
    const h = Math.ceil(topBar.getBoundingClientRect().height);
    if (h > 0) {
      window.electronAPI.setTopBarHeight(h);
    }
  }
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.remove('hidden');
  if (modal === modalSettings) {
    updateDefaultBrowserUI();
  }
  if (window.electronAPI && window.electronAPI.setModalState) {
    window.electronAPI.setModalState(true);
  }
}

function closeModal(modal) {
  if (modal) {
    modal.classList.add('hidden');
    if (modal.id === 'modal-downloads-bubble') {
      const bubble = document.getElementById('downloads-bubble');
      if (bubble) bubble.classList.add('hidden');
    }
  }
  const anyOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(m => !m.classList.contains('hidden'));
  if (!anyOpen && window.electronAPI && window.electronAPI.setModalState) {
    window.electronAPI.setModalState(false);
  }
  syncTopBarHeight();
}

// --- Settings & Preferences ---
let defaultBrowserPollInterval = null;

async function updateDefaultBrowserUI() {
  const btn = document.getElementById('btn-set-default-browser');
  const status = document.getElementById('default-browser-status');
  if (!btn || !status || !window.electronAPI || !window.electronAPI.checkIsDefaultBrowser) return;

  try {
    const isDefault = await window.electronAPI.checkIsDefaultBrowser();
    if (isDefault) {
      btn.textContent = '✓ По умолчанию';
      btn.className = 'btn btn-secondary';
      btn.disabled = false;
      btn.title = 'Black hole Browser уже назначен браузером по умолчанию (клик: открыть параметры Windows)';
      status.innerHTML = '<span style="color: #4ade80; font-weight: 500;">✓ Black hole Browser установлен как браузер по умолчанию</span>';
      if (defaultBrowserPollInterval) {
        clearInterval(defaultBrowserPollInterval);
        defaultBrowserPollInterval = null;
      }
    } else {
      btn.textContent = 'Сделать по умолчанию';
      btn.className = 'btn btn-primary';
      btn.disabled = false;
      btn.title = 'Назначить Black hole Browser основным браузером для всех ссылок и страниц';
      status.textContent = 'Открывать веб-страницы и ссылки (HTTP/HTTPS) в Black hole Browser';
    }
  } catch (err) {
    console.error('Failed to check default browser status:', err);
  }
}

function setupSettingsUI() {
  // Settings Navigation Tabs
  document.querySelectorAll('.settings-nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tabId = tabBtn.dataset.tab;
      document.querySelectorAll('.settings-nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-tab-pane').forEach(p => p.classList.remove('active'));
      tabBtn.classList.add('active');
      const pane = document.getElementById('settings-tab-' + tabId);
      if (pane) pane.classList.add('active');
      if (tabId === 'shortcuts') {
        renderShortcutsList();
      }
      if (tabId === 'shield' && window.refreshShieldStatus) {
        window.refreshShieldStatus();
      }
      if (tabId === 'updates' && window.loadUpdatesSettingsUI) {
        window.loadUpdatesSettingsUI();
      }
    });
  });

  const searchSelect = document.getElementById('setting-search-engine');
  const sleepToggle = document.getElementById('setting-tab-sleep-toggle');
  const sleepMinutes = document.getElementById('setting-tab-sleep-minutes');
  const bookmarksToggle = document.getElementById('setting-bookmarks-toggle');
  const restoreToggle = document.getElementById('setting-restore-session-toggle');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnSetDefault = document.getElementById('btn-set-default-browser');

  if (btnSetDefault) {
    btnSetDefault.addEventListener('click', async () => {
      const status = document.getElementById('default-browser-status');
      btnSetDefault.textContent = 'Открытие параметров...';
      btnSetDefault.disabled = true;
      if (status) {
        status.innerHTML = '<span style="color: #c084fc;">Открыты параметры Windows. Выберите Black hole Browser в качестве браузера по умолчанию.</span>';
      }

      try {
        await window.electronAPI.setAsDefaultBrowser();
        btnSetDefault.disabled = false;
        btnSetDefault.textContent = 'Открыть параметры';

        // Start polling for default browser change for 20 seconds
        if (defaultBrowserPollInterval) clearInterval(defaultBrowserPollInterval);
        let checksCount = 0;
        defaultBrowserPollInterval = setInterval(async () => {
          checksCount++;
          await updateDefaultBrowserUI();
          if (checksCount >= 20 && defaultBrowserPollInterval) {
            clearInterval(defaultBrowserPollInterval);
            defaultBrowserPollInterval = null;
          }
        }, 1000);
      } catch (err) {
        console.error('Failed to set default browser:', err);
        btnSetDefault.disabled = false;
        updateDefaultBrowserUI();
      }
    });
  }

  // Auto-refresh default browser status when returning focus to window
  window.addEventListener('focus', () => {
    if (modalSettings && !modalSettings.classList.contains('hidden')) {
      updateDefaultBrowserUI();
    }
  });

  const themeSelect = document.getElementById('setting-theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      applyTheme(val);
      await saveSetting('theme', val);
    });
  }

  // Neon theme color presets & picker in Settings
  document.querySelectorAll('.settings-neon-dot').forEach(dot => {
    dot.addEventListener('click', async () => {
      const color = dot.dataset.color;
      if (color) {
        applyNeonTheme(color);
        await saveSetting('neonThemeColor', color);
      }
    });
  });

  const neonPicker = document.getElementById('settings-neon-color-picker');
  if (neonPicker) {
    neonPicker.addEventListener('input', (e) => {
      applyNeonTheme(e.target.value);
    });
    neonPicker.addEventListener('change', async (e) => {
      applyNeonTheme(e.target.value);
      await saveSetting('neonThemeColor', e.target.value);
    });
  }

  // New tab background buttons in Settings
  const btnSelectBg = document.getElementById('btn-settings-select-bg');
  if (btnSelectBg) {
    btnSelectBg.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.selectBackgroundImage) {
        const res = await window.electronAPI.selectBackgroundImage();
        if (res && res.success && res.dataUrl) {
          await window.electronAPI.updateSettings({
            newTabBackgroundType: 'custom',
            newTabBackgroundImage: res.dataUrl
          });
          const summary = document.getElementById('settings-bg-summary');
          if (summary) summary.textContent = 'Установлен кастомный фон';
        }
      }
    });
  }

  const btnResetBg = document.getElementById('btn-settings-reset-bg');
  if (btnResetBg) {
    btnResetBg.addEventListener('click', async () => {
      await window.electronAPI.updateSettings({
        newTabBackgroundType: 'default',
        newTabBackgroundImage: ''
      });
      const summary = document.getElementById('settings-bg-summary');
      if (summary) summary.textContent = 'Используется стандартный фон';
    });
  }

  const webDarkToggle = document.getElementById('setting-web-dark-toggle');
  if (webDarkToggle) {
    webDarkToggle.addEventListener('change', async (e) => {
      await saveSetting('websiteDarkTheme', e.target.checked);
    });
  }

  const bubbleDimmingToggle = document.getElementById('setting-bubble-dimming-toggle');
  const bubbleDimmingItem = document.getElementById('setting-bubble-dimming-opacity-item');
  if (bubbleDimmingToggle) {
    bubbleDimmingToggle.addEventListener('change', async (e) => {
      await saveSetting('bubbleDimmingEnabled', e.target.checked);
      if (bubbleDimmingItem) {
        bubbleDimmingItem.style.opacity = e.target.checked ? '1' : '0.45';
        bubbleDimmingItem.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
    });
  }

  const bubbleDimmingRange = document.getElementById('setting-bubble-dimming-opacity-range');
  const bubbleDimmingBadge = document.getElementById('setting-bubble-dimming-opacity-badge');
  if (bubbleDimmingRange) {
    bubbleDimmingRange.addEventListener('input', (e) => {
      const pct = parseInt(e.target.value, 10) || 0;
      if (bubbleDimmingBadge) {
        bubbleDimmingBadge.textContent = `${pct}%`;
      }
    });

    bubbleDimmingRange.addEventListener('change', async (e) => {
      const pct = parseInt(e.target.value, 10) || 0;
      const opacityVal = Math.round(pct) / 100;
      await saveSetting('bubbleDimmingOpacity', opacityVal);
    });
  }

  searchSelect.addEventListener('change', (e) => {
    saveSetting('searchEngine', e.target.value);
  });

  sleepToggle.addEventListener('change', (e) => {
    saveSetting('tabSleepEnabled', e.target.checked);
  });

  sleepMinutes.addEventListener('change', (e) => {
    saveSetting('tabSleepMinutes', parseInt(e.target.value, 10));
  });

  const gameOptToggle = document.getElementById('setting-game-optimization-toggle');
  if (gameOptToggle) {
    gameOptToggle.addEventListener('change', (e) => {
      saveSetting('gameOptimizationEnabled', e.target.checked);
    });
  }

  bookmarksToggle.addEventListener('change', (e) => {
    saveSetting('showBookmarksBar', e.target.checked);
    toggleBookmarksBar(e.target.checked);
  });

  restoreToggle.addEventListener('change', (e) => {
    saveSetting('restoreSessionOnStartup', e.target.checked);
  });

  const openNewTabToggle = document.getElementById('setting-open-new-tab-toggle');
  if (openNewTabToggle) {
    openNewTabToggle.addEventListener('change', (e) => {
      saveSetting('openNewTabOnStartup', e.target.checked);
    });
  }

  btnClearCache.addEventListener('click', async () => {
    if (confirm('Очистить весь кэш и временные файлы?')) {
      const res = await window.electronAPI.clearCache();
      if (res && res.success) {
        alert('Кэш успешно очищен!');
      }
    }
  });

  // AdBlock Settings
  const adblockToggle = document.getElementById('setting-adblock-toggle');
  const ytAdblockToggle = document.getElementById('setting-yt-adblock-toggle');
  const btnResetAdblockStats = document.getElementById('btn-reset-adblock-stats');

  if (adblockToggle) {
    adblockToggle.addEventListener('change', async (e) => {
      await window.electronAPI.toggleAdBlock(e.target.checked);
      if (window.refreshShieldStatus) window.refreshShieldStatus();
    });
  }

  if (ytAdblockToggle) {
    ytAdblockToggle.addEventListener('change', (e) => {
      saveSetting('adBlockYouTubeAutoSkip', e.target.checked);
    });
  }

  const dpiBypassToggle = document.getElementById('setting-dpi-bypass-toggle');
  if (dpiBypassToggle) {
    dpiBypassToggle.addEventListener('change', async (e) => {
      saveSetting('youtubeDpiBypassEnabled', e.target.checked);
      if (window.electronAPI && typeof window.electronAPI.toggleDpiBypass === 'function') {
        await window.electronAPI.toggleDpiBypass(e.target.checked);
      }
    });
  }

  const pipAutoToggle = document.getElementById('setting-pip-auto-toggle');
  if (pipAutoToggle) {
    pipAutoToggle.addEventListener('change', (e) => {
      saveSetting('pipAutoTabSwitch', e.target.checked);
    });
  }

  const pipButtonToggle = document.getElementById('setting-pip-button-toggle');
  if (pipButtonToggle) {
    pipButtonToggle.addEventListener('change', (e) => {
      saveSetting('pipFloatingButtonEnabled', e.target.checked);
    });
  }

  const pipSeekStep = document.getElementById('setting-pip-seek-step');
  if (pipSeekStep) {
    pipSeekStep.addEventListener('change', (e) => {
      saveSetting('pipSeekStepSeconds', parseInt(e.target.value, 10) || 10);
    });
  }

  if (btnResetAdblockStats) {
    btnResetAdblockStats.addEventListener('click', async () => {
      await window.electronAPI.resetAdBlockStats();
      if (window.refreshShieldStatus) window.refreshShieldStatus();
      const statsText = document.getElementById('setting-adblock-stats-text');
      if (statsText) statsText.textContent = 'Всего заблокировано элементов: 0';
    });
  }

  // Easter Egg: 3 clicks on 'made by Karasu x Gemini' plays "Взгляни в бездну"
  const settingsCreditsEl = document.getElementById('settings-credits');
  if (settingsCreditsEl) {
    let creditClickCount = 0;
    let creditClickTimer = null;
    let easterAudio = null;

    settingsCreditsEl.addEventListener('click', () => {
      creditClickCount++;
      clearTimeout(creditClickTimer);
      creditClickTimer = setTimeout(() => {
        creditClickCount = 0;
      }, 1500);

      // Visual click pulse
      settingsCreditsEl.classList.add('credits-pulse');
      setTimeout(() => settingsCreditsEl.classList.remove('credits-pulse'), 300);

      if (creditClickCount >= 3) {
        creditClickCount = 0;

        // Play the uploaded abyss voice line
        try {
          if (!easterAudio) {
            easterAudio = new Audio('assets/abyss.mp3');
          }
          easterAudio.currentTime = 0;
          easterAudio.play().catch((err) => {
            console.warn('Easter egg audio play error:', err);
            const fallbackAudio = new Audio('abyss.mp3');
            fallbackAudio.play().catch(() => {});
          });
        } catch (err) {
          console.error('Audio initialization error:', err);
        }

        // Cosmic void pulse animation on settings modal
        if (modalSettings) {
          modalSettings.classList.add('abyss-activated');
          setTimeout(() => {
            modalSettings.classList.remove('abyss-activated');
          }, 3500);
        }
      }
    });
  }
}

// --- Version Tracking & Update System ---
let currentUpdateInfo = null;
let downloadedInstallerFile = null;
let isUpdateDownloading = false;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setupUpdateSystem() {
  if (!window.electronAPI) return;

  const btnClosePrompt = document.getElementById('btn-update-prompt-close');
  const btnLater = document.getElementById('btn-update-prompt-later');
  const btnSkip = document.getElementById('btn-update-prompt-skip');
  const btnAction = document.getElementById('btn-update-prompt-action');
  const btnChannel = document.getElementById('btn-update-prompt-channel');
  const navUpdateDot = document.getElementById('nav-update-dot');
  const tabUpdateDot = document.getElementById('tab-update-dot');

  // Close / Remind Later
  if (btnClosePrompt) {
    btnClosePrompt.addEventListener('click', () => {
      closeModal(modalUpdatePrompt);
    });
  }

  if (btnLater) {
    btnLater.addEventListener('click', () => {
      closeModal(modalUpdatePrompt);
    });
  }

  // Skip version
  if (btnSkip) {
    btnSkip.addEventListener('click', async () => {
      if (currentUpdateInfo && currentUpdateInfo.newVersion) {
        await window.electronAPI.dismissUpdate(currentUpdateInfo.newVersion);
      }
      closeModal(modalUpdatePrompt);
      if (navUpdateDot) navUpdateDot.classList.add('hidden');
      if (tabUpdateDot) tabUpdateDot.classList.add('hidden');
    });
  }

  // External Channel / Release Page
  if (btnChannel) {
    btnChannel.addEventListener('click', () => {
      const url = (currentUpdateInfo && (currentUpdateInfo.pageUrl || currentUpdateInfo.downloadUrl));
      if (url && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(url);
      }
    });
  }

  // Update Action: Download -> Install & Relaunch
  if (btnAction) {
    btnAction.addEventListener('click', async () => {
      if (downloadedInstallerFile) {
        // Step 2: Installer already downloaded -> Install and restart
        btnAction.disabled = true;
        btnAction.textContent = '🚀 Запуск установщика...';
        try {
          await window.electronAPI.installUpdate(downloadedInstallerFile);
        } catch (err) {
          alert('Ошибка запуска установщика: ' + err.message);
          btnAction.disabled = false;
        }
        return;
      }

      if (!currentUpdateInfo) return;

      const downloadUrl = currentUpdateInfo.downloadUrl;
      const isDirectExe = downloadUrl && downloadUrl.toLowerCase().endsWith('.exe');

      if (!isDirectExe && currentUpdateInfo.pageUrl) {
        // If not a direct .exe, open web page / Telegram
        if (window.electronAPI.openExternal) {
          window.electronAPI.openExternal(currentUpdateInfo.pageUrl || downloadUrl);
        }
        closeModal(modalUpdatePrompt);
        return;
      }

      if (!downloadUrl) {
        if (currentUpdateInfo.pageUrl && window.electronAPI.openExternal) {
          window.electronAPI.openExternal(currentUpdateInfo.pageUrl);
        }
        return;
      }

      // Step 1: Start Download
      isUpdateDownloading = true;
      btnAction.disabled = true;
      btnAction.textContent = '⏳ Загрузка...';

      const progressBox = document.getElementById('update-progress-container');
      const progressBar = document.getElementById('update-progress-bar');
      const progressPercent = document.getElementById('update-progress-percent');
      const progressStatus = document.getElementById('update-progress-status');

      if (progressBox) progressBox.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (progressPercent) progressPercent.textContent = '0%';
      if (progressStatus) progressStatus.textContent = 'Подключение к серверу...';

      try {
        await window.electronAPI.downloadUpdate(downloadUrl);
      } catch (err) {
        isUpdateDownloading = false;
        btnAction.disabled = false;
        btnAction.textContent = '📥 Скачать и обновить';
        if (progressStatus) progressStatus.textContent = 'Ошибка загрузки: ' + err.message;
        if (currentUpdateInfo.pageUrl && btnChannel) {
          btnChannel.classList.remove('hidden');
        }
      }
    });
  }

  // Settings Tab Updates Elements
  const btnCheckNow = document.getElementById('btn-check-updates-now');
  const iconCheckSpin = document.getElementById('icon-check-spin');
  const statusIndicator = document.getElementById('settings-status-indicator');
  const statusText = document.getElementById('settings-update-status-text');
  const currentVersionEl = document.getElementById('settings-current-version');
  const autoCheckToggle = document.getElementById('toggle-auto-check-updates');
  const feedUrlInput = document.getElementById('input-update-feed-url');
  const btnSaveFeed = document.getElementById('btn-save-update-feed');
  const btnResetFeed = document.getElementById('btn-reset-update-feed');

  // Inline update card in settings
  const settingsAvailCard = document.getElementById('settings-update-available-card');
  const settingsAvailVer = document.getElementById('settings-avail-version');
  const settingsAvailChangelog = document.getElementById('settings-avail-changelog');
  const btnSettingsUpdateNow = document.getElementById('btn-settings-update-now');
  const btnSettingsOpenPage = document.getElementById('btn-settings-open-page');

  // Helpers to format bytes & speed
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 МБ';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(1) + ' МБ';
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 КБ/с';
    if (bytesPerSec > 1024 * 1024) {
      return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' МБ/с';
    }
    return Math.round(bytesPerSec / 1024) + ' КБ/с';
  }

  // Load update settings into settings tab
  async function loadUpdateSettingsTab() {
    try {
      const info = await window.electronAPI.getVersionInfo();
      if (!info) return;

      if (currentVersionEl) currentVersionEl.textContent = 'v' + info.currentVersion;
      if (autoCheckToggle) autoCheckToggle.checked = info.autoCheckUpdates;
      if (feedUrlInput) feedUrlInput.value = info.updateFeedUrl;

      if (info.lastUpdateCheckTime) {
        const d = new Date(info.lastUpdateCheckTime);
        const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (statusText) statusText.textContent = 'Последняя проверка: ' + timeStr;
        if (statusIndicator) {
          statusIndicator.className = 'status-indicator-dot status-up-to-date';
        }
      } else {
        if (statusText) statusText.textContent = 'Нажмите «Проверить сейчас» для поиска обновлений';
        if (statusIndicator) {
          statusIndicator.className = 'status-indicator-dot';
        }
      }

      if (info.latestUpdateInfo) {
        showSettingsAvailableCard(info.latestUpdateInfo);
      }
    } catch (e) {
      console.warn('Failed to load version info:', e);
    }
  }

  window.loadUpdatesSettingsUI = loadUpdateSettingsTab;

  // Toggle Auto-check in settings
  if (autoCheckToggle) {
    autoCheckToggle.addEventListener('change', async (e) => {
      await window.electronAPI.saveUpdateSettings({ autoCheckUpdates: e.target.checked });
    });
  }

  // Save custom feed URL
  if (btnSaveFeed) {
    btnSaveFeed.addEventListener('click', async () => {
      const val = (feedUrlInput && feedUrlInput.value) ? feedUrlInput.value.trim() : '';
      if (!val) return;
      await window.electronAPI.saveUpdateSettings({ updateFeedUrl: val });
      btnSaveFeed.textContent = '✓ Сохранено';
      setTimeout(() => { btnSaveFeed.textContent = 'Сохранить'; }, 1500);
    });
  }

  // Reset feed URL to default
  if (btnResetFeed) {
    btnResetFeed.addEventListener('click', async () => {
      const info = await window.electronAPI.getVersionInfo();
      const defaultUrl = (info && info.defaultFeedUrl) || 'https://raw.githubusercontent.com/Karasu287/Black-hole-browser-/main/version.json';
      if (feedUrlInput) feedUrlInput.value = defaultUrl;
      await window.electronAPI.saveUpdateSettings({ updateFeedUrl: defaultUrl });
      btnResetFeed.textContent = '✓ Сброшено';
      setTimeout(() => { btnResetFeed.textContent = 'По умолчанию'; }, 1500);
    });
  }

  // Check Updates Now button
  if (btnCheckNow) {
    btnCheckNow.addEventListener('click', async () => {
      if (iconCheckSpin) iconCheckSpin.classList.add('spin-anim');
      btnCheckNow.disabled = true;
      if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-checking';
      if (statusText) statusText.textContent = 'Проверка наличия обновлений...';

      try {
        const res = await window.electronAPI.checkForUpdates();
        if (res && res.updateAvailable) {
          // Handled via onUpdateAvailable
        } else if (res && res.error) {
          if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-error';
          if (statusText) statusText.textContent = 'Ошибка проверки: ' + res.error;
        } else {
          if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-up-to-date';
          if (statusText) statusText.textContent = `У вас установлена последняя версия (v${(res && res.currentVersion) || '1.14.0'})`;
          if (settingsAvailCard) settingsAvailCard.classList.add('hidden');
        }
      } catch (err) {
        if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-error';
        if (statusText) statusText.textContent = 'Сбой сети: ' + err.message;
      } finally {
        if (iconCheckSpin) iconCheckSpin.classList.remove('spin-anim');
        btnCheckNow.disabled = false;
      }
    });
  }

  // Settings update action button
  if (btnSettingsUpdateNow) {
    btnSettingsUpdateNow.addEventListener('click', () => {
      if (currentUpdateInfo) {
        showUpdatePromptModal(currentUpdateInfo);
      }
    });
  }

  if (btnSettingsOpenPage) {
    btnSettingsOpenPage.addEventListener('click', () => {
      const url = currentUpdateInfo && (currentUpdateInfo.pageUrl || currentUpdateInfo.downloadUrl);
      if (url && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(url);
      }
    });
  }

  function showSettingsAvailableCard(info) {
    if (!settingsAvailCard) return;
    settingsAvailCard.classList.remove('hidden');
    if (settingsAvailVer) settingsAvailVer.textContent = 'v' + info.newVersion;
    if (settingsAvailChangelog && info.changelog) {
      settingsAvailChangelog.innerHTML = info.changelog.map(c => `<div>✦ ${escapeHtml(c)}</div>`).join('');
    }
    if (btnSettingsOpenPage) {
      if (info.pageUrl) {
        btnSettingsOpenPage.classList.remove('hidden');
      } else {
        btnSettingsOpenPage.classList.add('hidden');
      }
    }
  }

  function showUpdatePromptModal(info) {
    currentUpdateInfo = info;

    // Show indicator dots
    if (navUpdateDot) navUpdateDot.classList.remove('hidden');
    if (tabUpdateDot) tabUpdateDot.classList.remove('hidden');

    // Update settings status if open
    if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-available';
    if (statusText) statusText.textContent = `Доступна новая версия: v${info.newVersion}`;
    showSettingsAvailableCard(info);

    // Populate modal fields
    const titleEl = document.getElementById('update-prompt-title');
    const currEl = document.getElementById('update-prompt-ver-curr');
    const newEl = document.getElementById('update-prompt-ver-new');
    const dateEl = document.getElementById('update-prompt-ver-date');
    const changelogEl = document.getElementById('update-prompt-changelog');

    if (titleEl) titleEl.textContent = info.title || `Black Hole Browser v${info.newVersion}`;
    if (currEl) currEl.textContent = 'v' + info.currentVersion;
    if (newEl) newEl.textContent = 'v' + info.newVersion;
    if (dateEl) dateEl.textContent = info.releaseDate ? `(${info.releaseDate})` : '';

    if (changelogEl) {
      if (info.changelog && info.changelog.length > 0) {
        changelogEl.innerHTML = info.changelog.map(item => `
          <div class="update-changelog-item">
            <span class="update-bullet">✦</span>
            <span>${escapeHtml(item)}</span>
          </div>
        `).join('');
      } else {
        changelogEl.innerHTML = '<div class="update-changelog-item"><span>Улучшения стабильности и производительности.</span></div>';
      }
    }

    // Channel / page button
    if (btnChannel) {
      if (info.pageUrl) {
        btnChannel.classList.remove('hidden');
      } else {
        btnChannel.classList.add('hidden');
      }
    }

    // Reset progress and action button
    const progressBox = document.getElementById('update-progress-container');
    if (progressBox) progressBox.classList.add('hidden');

    if (downloadedInstallerFile) {
      btnAction.textContent = '🚀 Перезапустить и установить';
      btnAction.className = 'btn btn-primary btn-success-glow';
      btnAction.disabled = false;
    } else {
      btnAction.textContent = '📥 Скачать и обновить';
      btnAction.className = 'btn btn-primary btn-glow';
      btnAction.disabled = false;
    }

    openModal(modalUpdatePrompt);
  }

  // --- IPC Listeners ---
  window.electronAPI.onUpdateAvailable((info) => {
    showUpdatePromptModal(info);
  });

  window.electronAPI.onUpdateNotAvailable((data) => {
    if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-up-to-date';
    if (statusText) statusText.textContent = `У вас установлена последняя версия (v${(data && data.currentVersion) || '1.14.0'})`;
    if (settingsAvailCard) settingsAvailCard.classList.add('hidden');
  });

  window.electronAPI.onUpdateDownloadProgress((progress) => {
    const progressBox = document.getElementById('update-progress-container');
    const progressBar = document.getElementById('update-progress-bar');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressMeta = document.getElementById('update-progress-meta');
    const progressStatus = document.getElementById('update-progress-status');

    if (progressBox) progressBox.classList.remove('hidden');
    if (progressBar) progressBar.style.width = `${progress.percent}%`;
    if (progressPercent) progressPercent.textContent = `${progress.percent}%`;
    if (progressStatus) progressStatus.textContent = 'Загрузка обновления...';
    if (progressMeta) {
      progressMeta.textContent = `${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.totalBytes)} (${formatSpeed(progress.speed)})`;
    }
  });

  window.electronAPI.onUpdateDownloadComplete(({ installerPath }) => {
    downloadedInstallerFile = installerPath;
    isUpdateDownloading = false;

    const progressBar = document.getElementById('update-progress-bar');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressStatus = document.getElementById('update-progress-status');

    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.style.background = '#10b981';
      progressBar.style.boxShadow = '0 0 16px rgba(16, 185, 129, 0.8)';
    }
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressStatus) progressStatus.textContent = '✅ Загрузка завершена! Установщик готов к запуску.';

    if (btnAction) {
      btnAction.disabled = false;
      btnAction.textContent = '🚀 Перезапустить и установить';
      btnAction.className = 'btn btn-primary btn-success-glow';
    }

    if (btnSettingsUpdateNow) {
      btnSettingsUpdateNow.disabled = false;
      btnSettingsUpdateNow.textContent = '🚀 Перезапустить и установить';
      btnSettingsUpdateNow.className = 'btn btn-primary btn-success-glow';
    }
  });

  window.electronAPI.onUpdateError((err) => {
    isUpdateDownloading = false;
    if (statusIndicator) statusIndicator.className = 'status-indicator-dot status-error';
    if (statusText) statusText.textContent = 'Ошибка: ' + (err.error || err.message || err);
    if (btnAction) {
      btnAction.disabled = false;
      btnAction.textContent = '📥 Попробовать снова';
    }
  });
}

async function saveSetting(key, val) {
  currentSettings[key] = val;
  await window.electronAPI.updateSettings({ [key]: val });
}

function applyTheme(theme) {
  const isLight = theme === 'light' || (theme === 'system' && window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('theme-light', isLight);
  try {
    localStorage.setItem('eclipse_theme', theme);
  } catch (e) {}
}

function hexToRgbValues(hexColor) {
  if (!hexColor) return { r: 168, g: 85, b: 247 };
  let c = hexColor.trim().replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (c.length !== 6) return { r: 168, g: 85, b: 247 };
  const num = parseInt(c, 16);
  if (isNaN(num)) return { r: 168, g: 85, b: 247 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function applyNeonTheme(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return;
  const rgb = hexToRgbValues(hexColor);
  const root = document.documentElement;

  root.style.setProperty('--accent-primary', hexColor);
  root.style.setProperty('--border-focus', hexColor);
  root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
  root.style.setProperty('--accent-glow-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`);

  const hoverR = Math.min(255, Math.floor(rgb.r * 1.18));
  const hoverG = Math.min(255, Math.floor(rgb.g * 1.18));
  const hoverB = Math.min(255, Math.floor(rgb.b * 1.18));
  const hoverHex = `#${((1 << 24) + (hoverR << 16) + (hoverG << 8) + hoverB).toString(16).slice(1)}`;
  root.style.setProperty('--accent-hover', hoverHex);

  document.querySelectorAll('.settings-neon-dot').forEach(dot => {
    const dotColor = (dot.dataset.color || '').toLowerCase();
    dot.classList.toggle('active', dotColor === hexColor.toLowerCase());
  });

  const picker = document.getElementById('settings-neon-color-picker');
  if (picker && picker.value.toLowerCase() !== hexColor.toLowerCase()) {
    picker.value = hexColor;
  }
}

function applySettings(settings) {
  applyNeonTheme(settings.neonThemeColor || '#a855f7');

  const bgSummary = document.getElementById('settings-bg-summary');
  if (bgSummary) {
    if (settings.newTabBackgroundType === 'custom' && settings.newTabBackgroundImage) {
      bgSummary.textContent = `Кастомный фон активен (затенение ${settings.newTabBackgroundDim !== undefined ? settings.newTabBackgroundDim : 30}%)`;
    } else {
      bgSummary.textContent = 'Используется стандартный фон';
    }
  }

  const themeSelect = document.getElementById('setting-theme-select');
  if (themeSelect) {
    themeSelect.value = settings.theme || 'dark';
  }
  applyTheme(settings.theme || 'dark');

  const webDarkToggle = document.getElementById('setting-web-dark-toggle');
  if (webDarkToggle) {
    webDarkToggle.checked = settings.websiteDarkTheme !== false;
  }

  const bubbleDimmingToggle = document.getElementById('setting-bubble-dimming-toggle');
  const bubbleDimmingItem = document.getElementById('setting-bubble-dimming-opacity-item');
  const isDimmingEnabled = settings.bubbleDimmingEnabled !== false;
  if (bubbleDimmingToggle) {
    bubbleDimmingToggle.checked = isDimmingEnabled;
  }
  if (bubbleDimmingItem) {
    bubbleDimmingItem.style.opacity = isDimmingEnabled ? '1' : '0.45';
    bubbleDimmingItem.style.pointerEvents = isDimmingEnabled ? 'auto' : 'none';
  }

  const bubbleDimmingRange = document.getElementById('setting-bubble-dimming-opacity-range');
  const bubbleDimmingBadge = document.getElementById('setting-bubble-dimming-opacity-badge');
  if (bubbleDimmingRange) {
    const rawVal = settings.bubbleDimmingOpacity !== undefined ? settings.bubbleDimmingOpacity : 0.35;
    const pct = Math.min(100, Math.max(0, Math.round(Number(rawVal) * 100)));
    bubbleDimmingRange.value = pct;
    if (bubbleDimmingBadge) {
      bubbleDimmingBadge.textContent = `${pct}%`;
    }
  }

  document.getElementById('setting-search-engine').value = settings.searchEngine || 'google';
  document.getElementById('setting-tab-sleep-toggle').checked = settings.tabSleepEnabled !== false;
  document.getElementById('setting-tab-sleep-minutes').value = settings.tabSleepMinutes || 10;
  const gameOptEl = document.getElementById('setting-game-optimization-toggle');
  if (gameOptEl) gameOptEl.checked = settings.gameOptimizationEnabled !== false;
  document.getElementById('setting-bookmarks-toggle').checked = settings.showBookmarksBar !== false;
  document.getElementById('setting-restore-session-toggle').checked = settings.restoreSessionOnStartup !== false;
  const openNewTabEl = document.getElementById('setting-open-new-tab-toggle');
  if (openNewTabEl) openNewTabEl.checked = settings.openNewTabOnStartup !== false;

  const adblockToggle = document.getElementById('setting-adblock-toggle');
  if (adblockToggle) adblockToggle.checked = settings.adBlockerEnabled !== false;

  const ytAdblockToggle = document.getElementById('setting-yt-adblock-toggle');
  if (ytAdblockToggle) ytAdblockToggle.checked = settings.adBlockYouTubeAutoSkip !== false;

  const dpiBypassToggle = document.getElementById('setting-dpi-bypass-toggle');
  if (dpiBypassToggle) dpiBypassToggle.checked = settings.youtubeDpiBypassEnabled !== false;

  const vtabToggle = document.getElementById('setting-vertical-tabs-toggle');
  if (vtabToggle) vtabToggle.checked = Boolean(settings.verticalTabsEnabled);

  const vtabCollapsedToggle = document.getElementById('setting-vertical-tabs-collapsed-toggle');
  if (vtabCollapsedToggle) vtabCollapsedToggle.checked = Boolean(settings.verticalTabsCollapsed);

  const pipAutoToggle = document.getElementById('setting-pip-auto-toggle');
  if (pipAutoToggle) pipAutoToggle.checked = settings.pipAutoTabSwitch !== false;

  const pipButtonToggle = document.getElementById('setting-pip-button-toggle');
  if (pipButtonToggle) pipButtonToggle.checked = settings.pipFloatingButtonEnabled !== false;

  const pipSeekStep = document.getElementById('setting-pip-seek-step');
  if (pipSeekStep) pipSeekStep.value = String(settings.pipSeekStepSeconds || 10);

  toggleBookmarksBar(settings.showBookmarksBar !== false);
  updateDefaultBrowserUI();
  if (window.refreshShieldStatus) window.refreshShieldStatus();
}

// --- Black hole Shield (AdBlock) UI Controller ---
function setupShieldUI() {
  const btnShield = document.getElementById('btn-shield');
  const shieldBadge = document.getElementById('shield-badge');
  const modalShield = document.getElementById('modal-shield');
  const shieldStatusTag = document.getElementById('shield-status-tag');
  const shieldDomainEl = document.getElementById('shield-current-domain');
  const shieldTabBlockedEl = document.getElementById('shield-tab-blocked-count');
  const shieldTotalBlockedEl = document.getElementById('shield-total-blocked-count');
  const shieldDomainToggle = document.getElementById('shield-domain-toggle');
  const shieldGlobalToggle = document.getElementById('shield-global-toggle');
  const btnShieldOpenSettings = document.getElementById('btn-shield-open-settings');

  if (!btnShield || !modalShield) return;

  async function refreshShieldStatus() {
    const activeTab = currentTabs.find(t => t.id === activeTabId);
    let domain = '';
    if (activeTab && activeTab.url && !activeTab.url.startsWith('eclipse://') && !activeTab.url.startsWith('about:')) {
      try {
        domain = new URL(activeTab.url).hostname;
      } catch (e) {}
    }

    try {
      const status = await window.electronAPI.getAdBlockStatus(domain, activeTabId);
      if (!status) return;

      // Update badge on Omnibox button
      if (shieldBadge) {
        const tabCount = status.tabBlocked || 0;
        shieldBadge.textContent = tabCount > 99 ? '99+' : tabCount;
        if (!status.enabled || status.isWhitelisted) {
          btnShield.classList.add('shield-disabled');
        } else {
          btnShield.classList.remove('shield-disabled');
        }
      }

      // Update modal UI elements
      if (shieldDomainEl) {
        shieldDomainEl.textContent = domain ? domain : 'Внутренняя страница';
      }
      if (shieldStatusTag) {
        if (!status.enabled) {
          shieldStatusTag.textContent = 'ОТКЛЮЧЕН';
          shieldStatusTag.classList.remove('active');
        } else if (status.isWhitelisted) {
          shieldStatusTag.textContent = 'ПАУЗА НА САЙТЕ';
          shieldStatusTag.classList.remove('active');
        } else {
          shieldStatusTag.textContent = 'АКТИВЕН';
          shieldStatusTag.classList.add('active');
        }
      }
      if (shieldTabBlockedEl) {
        shieldTabBlockedEl.textContent = status.tabBlocked || 0;
      }
      if (shieldTotalBlockedEl) {
        shieldTotalBlockedEl.textContent = status.totalBlocked || 0;
      }
      if (shieldDomainToggle) {
        shieldDomainToggle.disabled = !domain || !status.enabled;
        shieldDomainToggle.checked = !status.isWhitelisted;
      }
      if (shieldGlobalToggle) {
        shieldGlobalToggle.checked = Boolean(status.enabled);
      }

      // Update Settings stats text
      const settingStatsDesc = document.getElementById('setting-adblock-stats-text');
      if (settingStatsDesc) {
        settingStatsDesc.textContent = `Всего заблокировано элементов: ${status.totalBlocked || 0}`;
      }
    } catch (err) {
      console.warn('Failed to get adblock status:', err);
    }
  }

  btnShield.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(modalShield);
    refreshShieldStatus();
  });

  // Toggle domain whitelist
  if (shieldDomainToggle) {
    shieldDomainToggle.addEventListener('change', async (e) => {
      const activeTab = currentTabs.find(t => t.id === activeTabId);
      if (!activeTab || !activeTab.url) return;
      try {
        const domain = new URL(activeTab.url).hostname;
        if (domain) {
          await window.electronAPI.toggleAdBlockWhitelist(domain);
          await refreshShieldStatus();
          window.electronAPI.reload();
        }
      } catch (err) {}
    });
  }

  // Toggle global adblock state
  if (shieldGlobalToggle) {
    shieldGlobalToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await window.electronAPI.toggleAdBlock(enabled);
      const settingAdblockToggle = document.getElementById('setting-adblock-toggle');
      if (settingAdblockToggle) settingAdblockToggle.checked = enabled;
      await refreshShieldStatus();
    });
  }

  // Settings button in shield modal
  if (btnShieldOpenSettings) {
    btnShieldOpenSettings.addEventListener('click', () => {
      closeModal(modalShield);
      openModal(modalSettings);
    });
  }

  // Listen for live blocked updates from main process
  if (window.electronAPI.onAdBlockTabStatsUpdated) {
    window.electronAPI.onAdBlockTabStatsUpdated(() => {
      refreshShieldStatus();
    });
  }

  if (window.electronAPI.onAdBlockStateChanged) {
    window.electronAPI.onAdBlockStateChanged(() => {
      refreshShieldStatus();
    });
  }

  window.refreshShieldStatus = refreshShieldStatus;
}

function toggleBookmarksBar(show) {
  if (show) {
    bookmarksBar.classList.remove('hidden');
  } else {
    bookmarksBar.classList.add('hidden');
  }
  syncTopBarHeight();
}

// --- History List ---
async function renderHistory() {
  const history = await window.electronAPI.getHistory(100);
  const listEl = document.getElementById('history-list');
  const searchInput = document.getElementById('history-search-input');
  const btnClearHistory = document.getElementById('btn-clear-history');

  function renderFiltered(items) {
    listEl.innerHTML = '';
    if (items.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">История пуста</div>`;
      return;
    }

    items.forEach(h => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const timeStr = new Date(h.visitTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
        <div class="item-info">
          <span style="font-size:11px; color:var(--text-muted);">${timeStr}</span>
          <div class="item-text">
            <div class="item-title">${h.title}</div>
            <div class="item-url">${h.url}</div>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        window.electronAPI.navigate(h.url);
        closeModal(modalHistory);
      });

      listEl.appendChild(item);
    });
  }

  renderFiltered(history);

  searchInput.oninput = (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = history.filter(h => (h.title && h.title.toLowerCase().includes(q)) || (h.url && h.url.toLowerCase().includes(q)));
    renderFiltered(filtered);
  };

  btnClearHistory.onclick = async () => {
    if (confirm('Очистить всю историю посещений?')) {
      await window.electronAPI.clearHistory();
      renderFiltered([]);
    }
  };
}

// --- Full Bookmarks Modal ---
async function renderFullBookmarks() {
  const bms = await window.electronAPI.getBookmarks();
  const listEl = document.getElementById('bookmarks-full-list');
  listEl.innerHTML = '';

  if (bms.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">Нет закладок</div>`;
    return;
  }

  bms.forEach(bm => {
    const item = document.createElement('div');
    item.className = 'bm-full-item';

    item.innerHTML = `
      <div class="item-info">
        <div class="item-text">
          <div class="item-title">${bm.title}</div>
          <div class="item-url">${bm.url}</div>
        </div>
      </div>
    `;

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-btn';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Удалить';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      const updated = await window.electronAPI.removeBookmark(bm.id);
      bookmarks = updated;
      renderBookmarksBar(bookmarks);
      renderFullBookmarks();
    };
    item.appendChild(delBtn);

    item.addEventListener('click', () => {
      window.electronAPI.navigate(bm.url);
      closeModal(modalBookmarks);
    });

    listEl.appendChild(item);
  });
}

// --- Performance Stats Widget ---
async function updatePerformanceStats() {
  const stats = await window.electronAPI.getPerformanceStats();
  if (!stats) return;

  memSavedBadge.textContent = `${stats.estimatedSavedRamMb} МБ`;

  const statSavedEl = document.getElementById('stat-mem-saved');
  const statActiveEl = document.getElementById('stat-active-tabs');
  const statSleepEl = document.getElementById('stat-sleeping-tabs');

  if (statSavedEl) statSavedEl.textContent = `${stats.estimatedSavedRamMb} МБ`;
  if (statActiveEl) statActiveEl.textContent = `${stats.activeTabs}`;
  if (statSleepEl) statSleepEl.textContent = `${stats.sleepingTabs}`;
}

// --- Password Manager ---
function setupPasswordManagerUI() {
  const btnPasswordsMenu = document.getElementById('btn-passwords-menu');
  const btnAddPasswordManual = document.getElementById('btn-add-password-manual');
  const btnSaveNewPassword = document.getElementById('btn-save-new-password');
  const addOrigin = document.getElementById('add-pwd-origin');
  const addUsername = document.getElementById('add-pwd-username');
  const addPassword = document.getElementById('add-pwd-password');
  const searchInput = document.getElementById('passwords-search-input');

  // Prompt Toast buttons
  const btnPromptSave = document.getElementById('btn-prompt-save');
  const btnPromptNever = document.getElementById('btn-prompt-never');
  const btnPromptClose = document.getElementById('btn-prompt-close');
  const promptOriginText = document.getElementById('prompt-origin-text');
  const promptUsernameInput = document.getElementById('prompt-username-input');
  const promptPasswordInput = document.getElementById('prompt-password-input');

  let currentPendingCredential = null;

  // Open Passwords Manager Modal
  if (btnPasswordsMenu) {
    btnPasswordsMenu.addEventListener('click', () => {
      openModal(modalPasswords);
      renderPasswordsList();
    });
  }

  // Open Add Password Manual Modal
  if (btnAddPasswordManual) {
    btnAddPasswordManual.addEventListener('click', () => {
      openModal(modalAddPassword);
    });
  }

  // Save manual password
  if (btnSaveNewPassword) {
    btnSaveNewPassword.addEventListener('click', async () => {
      const origin = addOrigin.value.trim();
      const username = addUsername.value.trim();
      const password = addPassword.value;

      if (!origin || !password) {
        alert('Пожалуйста, укажите адрес сайта и пароль.');
        return;
      }

      await window.electronAPI.savePassword({ origin, username, password });
      addOrigin.value = '';
      addUsername.value = '';
      addPassword.value = '';
      closeModal(modalAddPassword);
      renderPasswordsList();
    });
  }

  // Search in passwords
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderPasswordsList(searchInput.value.trim());
    });
  }

  // Handle Save Password Prompt from web tabs
  if (window.electronAPI && window.electronAPI.onPromptSavePassword) {
    window.electronAPI.onPromptSavePassword((data) => {
      if (!data || !data.password) return;
      currentPendingCredential = data;
      promptOriginText.textContent = data.origin.replace(/^https?:\/\//i, '');
      promptUsernameInput.value = data.username || '';
      promptPasswordInput.value = data.password || '';
      openModal(modalSavePasswordPrompt);
    });
  }

  // Save button in prompt
  if (btnPromptSave) {
    btnPromptSave.addEventListener('click', async () => {
      if (currentPendingCredential) {
        const origin = currentPendingCredential.origin;
        const username = promptUsernameInput.value.trim();
        const password = promptPasswordInput.value;
        await window.electronAPI.savePassword({ origin, username, password });
      }
      closeModal(modalSavePasswordPrompt);
    });
  }

  // Never / Close button in prompt
  if (btnPromptNever) {
    btnPromptNever.addEventListener('click', () => {
      closeModal(modalSavePasswordPrompt);
    });
  }

  // --- Password Import & Migration System ---
  const btnImportPasswordsModal = document.getElementById('btn-import-passwords-modal');
  const btnExportPasswords = document.getElementById('btn-export-passwords');
  const dropZone = document.getElementById('password-drop-zone');
  const btnSelectFile = document.getElementById('btn-select-password-file');
  const previewArea = document.getElementById('import-preview-area');
  const previewBadge = document.getElementById('preview-count-badge');
  const previewTbody = document.getElementById('import-preview-tbody');
  const btnConfirmImport = document.getElementById('btn-confirm-import');
  const btnCancelImport = document.getElementById('btn-cancel-import');
  const overwriteToggle = document.getElementById('import-overwrite-toggle');

  let pendingImportList = [];

  if (btnImportPasswordsModal) {
    btnImportPasswordsModal.addEventListener('click', () => {
      openModal(modalImportPasswords);
      if (previewArea) previewArea.classList.add('hidden');
      pendingImportList = [];
    });
  }

  // Guide tabs
  const guides = {
    chrome: '<strong>Google Chrome:</strong> Меню ➔ Настройки ➔ Автозаполнение и пароли ➔ Менеджер паролей ➔ вкладка «Настройки» ➔ пункт «Экспорт паролей» ➔ скачайте файл <code>.csv</code>.',
    yandex: '<strong>Яндекс Браузер:</strong> Меню ➔ Настройки ➔ Пароли и карты ➔ меню «три точки» (справа вверху) ➔ Экспортировать пароли в файл <code>.csv</code>.',
    edge: '<strong>Microsoft Edge:</strong> Настройки ➔ Профили ➔ Пароли ➔ кнопка «...» (рядом с Добавить пароль) ➔ Экспорт паролей ➔ сохраните файл <code>.csv</code>.',
    firefox: '<strong>Mozilla Firefox:</strong> Меню ➔ Пароли (about:logins) ➔ меню «три точки» в правом углу ➔ Экспорт логинов и паролей ➔ сохраните файл <code>.csv</code>.',
    opera: '<strong>Opera / Opera GX:</strong> Настройки (Alt+P) ➔ Дополнительно ➔ Автозаполнение ➔ Пароли ➔ три точки ➔ Экспорт паролей.',
    other: '<strong>Bitwarden / 1Password / KeePass:</strong> Инструменты ➔ Экспорт хранилища ➔ выберите формат <code>.csv</code> или <code>.json</code>.'
  };

  document.querySelectorAll('.browser-badge').forEach(badge => {
    badge.addEventListener('click', () => {
      document.querySelectorAll('.browser-badge').forEach(b => b.classList.remove('active'));
      badge.classList.add('active');
      const guideKey = badge.dataset.guide;
      const guideTextEl = document.getElementById('guide-step-instruction');
      if (guideTextEl && guides[guideKey]) {
        guideTextEl.innerHTML = guides[guideKey];
      }
    });
  });

  function displayImportPreview(items) {
    pendingImportList = items || [];
    if (pendingImportList.length === 0) {
      alert('В выбранном файле не найдено корректных логинов или паролей. Убедитесь, что файл содержит данные в формате CSV или JSON.');
      if (previewArea) previewArea.classList.add('hidden');
      return;
    }

    if (previewBadge) previewBadge.textContent = `Найдено аккаунтов: ${pendingImportList.length}`;
    if (previewTbody) {
      previewTbody.innerHTML = '';
      const previewSlice = pendingImportList.slice(0, 30);
      previewSlice.forEach(item => {
        const tr = document.createElement('tr');
        let cleanOrigin = item.origin;
        try { cleanOrigin = new URL(item.origin).hostname; } catch (e) {}
        tr.innerHTML = `
          <td style="font-weight:500;">${cleanOrigin}</td>
          <td style="color:var(--text-secondary);">${item.username || '—'}</td>
          <td style="font-family:monospace; letter-spacing:1px; color:var(--text-muted);">••••••••</td>
        `;
        previewTbody.appendChild(tr);
      });

      if (pendingImportList.length > 30) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="3" style="text-align:center; color:var(--text-muted); font-size:11px; padding: 10px;">... и ещё ${pendingImportList.length - 30} аккаунтов</td>`;
        previewTbody.appendChild(tr);
      }
    }

    if (previewArea) {
      previewArea.classList.remove('hidden');
      previewArea.scrollIntoView({ behavior: 'smooth' });
    }
  }

  if (btnSelectFile) {
    btnSelectFile.addEventListener('click', async () => {
      const res = await window.electronAPI.importPasswordsFileDialog();
      if (res && res.success && res.items) {
        displayImportPreview(res.items);
      } else if (res && res.error) {
        alert(res.error);
      }
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = async (event) => {
          const text = event.target.result;
          const res = await window.electronAPI.parsePasswordsContent(text);
          if (res && res.success && res.items) {
            displayImportPreview(res.items);
          } else if (res && res.error) {
            alert('Ошибка парсинга файла: ' + res.error);
          }
        };
        reader.readAsText(file);
      }
    });
  }

  if (btnCancelImport) {
    btnCancelImport.addEventListener('click', () => {
      if (previewArea) previewArea.classList.add('hidden');
      pendingImportList = [];
    });
  }

  if (btnConfirmImport) {
    btnConfirmImport.addEventListener('click', async () => {
      if (pendingImportList.length === 0) return;
      const overwrite = overwriteToggle ? overwriteToggle.checked : true;
      const res = await window.electronAPI.batchImportPasswords(pendingImportList, { overwrite });
      if (res && res.success) {
        alert(`🎉 Успешно перенесено паролей: ${res.importedCount} новых, ${res.updatedCount} обновлено (всего в базе: ${res.totalPasswords}).`);
        if (previewArea) previewArea.classList.add('hidden');
        pendingImportList = [];
        closeModal(modalImportPasswords);
        renderPasswordsList();
      } else {
        alert('Ошибка импорта: ' + (res ? res.error : 'Неизвестная ошибка'));
      }
    });
  }

  if (btnExportPasswords) {
    btnExportPasswords.addEventListener('click', async () => {
      const res = await window.electronAPI.exportPasswordsFileDialog();
      if (res && res.success) {
        alert(`Пароли успешно экспортированы в файл:\n${res.filePath}\n(сохранено аккаунтов: ${res.count})`);
      } else if (res && res.error) {
        alert('Ошибка экспорта: ' + res.error);
      }
    });
  }
}

async function renderPasswordsList(searchQuery = '') {
  const listEl = document.getElementById('passwords-list');
  if (!listEl) return;

  const passwords = await window.electronAPI.getPasswords();
  listEl.innerHTML = '';

  const q = searchQuery.toLowerCase();
  const filtered = passwords.filter(p =>
    (p.origin && p.origin.toLowerCase().includes(q)) ||
    (p.username && p.username.toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding: 24px; color: var(--text-muted);">
      ${passwords.length === 0 ? 'Нет сохранённых паролей. Браузер автоматически предложит сохранить пароль при входе на любой сайт.' : 'Ничего не найдено'}
    </div>`;
    return;
  }

  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'password-item';

    // Main info
    const mainDiv = document.createElement('div');
    mainDiv.className = 'pwd-main';

    let cleanOrigin = p.origin;
    try {
      cleanOrigin = new URL(p.origin).hostname;
    } catch (e) {}

    mainDiv.innerHTML = `
      <div class="pwd-site">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        <span>${cleanOrigin}</span>
      </div>
      <div class="pwd-user">👤 ${p.username || 'Без логина'}</div>
    `;
    item.appendChild(mainDiv);

    // Password view / mask box
    const secretBox = document.createElement('div');
    secretBox.className = 'pwd-secret-box';

    const pwdText = document.createElement('span');
    pwdText.className = 'pwd-text';
    pwdText.textContent = '••••••••';
    secretBox.appendChild(pwdText);

    // Toggle eye button
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'mini-btn';
    eyeBtn.title = 'Показать / скрыть пароль';
    eyeBtn.innerHTML = '👁';
    let isRevealed = false;
    eyeBtn.onclick = () => {
      isRevealed = !isRevealed;
      pwdText.textContent = isRevealed ? p.password : '••••••••';
    };
    secretBox.appendChild(eyeBtn);

    // Copy password button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'mini-btn';
    copyBtn.title = 'Скопировать пароль';
    copyBtn.innerHTML = '📋';
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(p.password);
      copyBtn.innerHTML = '✓';
      setTimeout(() => { copyBtn.innerHTML = '📋'; }, 1500);
    };
    secretBox.appendChild(copyBtn);

    item.appendChild(secretBox);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'pwd-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mini-btn';
    deleteBtn.title = 'Удалить аккаунт';
    deleteBtn.innerHTML = '🗑';
    deleteBtn.onclick = async () => {
      if (confirm(`Удалить сохранённый пароль для «${cleanOrigin}»?`)) {
        await window.electronAPI.deletePassword(p.id);
        renderPasswordsList(searchQuery);
      }
    };
    actionsDiv.appendChild(deleteBtn);

    item.appendChild(actionsDiv);
    listEl.appendChild(item);
  });
}

// --- Find In Page Bar ---
function setupFindBar() {
  const findBar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  const findPrev = document.getElementById('find-prev');
  const findNext = document.getElementById('find-next');
  const findClose = document.getElementById('find-close');

  findInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text) {
      window.electronAPI.findInPage(text, true, false);
    } else {
      window.electronAPI.stopFind('clearSelection');
    }
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      window.electronAPI.findInPage(findInput.value, !e.shiftKey, true);
    } else if (e.key === 'Escape') {
      findBar.classList.add('hidden');
      window.electronAPI.stopFind('clearSelection');
    }
  });

  findNext.addEventListener('click', () => {
    if (findInput.value) window.electronAPI.findInPage(findInput.value, true, true);
  });

  findPrev.addEventListener('click', () => {
    if (findInput.value) window.electronAPI.findInPage(findInput.value, false, true);
  });

  findClose.addEventListener('click', () => {
    findBar.classList.add('hidden');
    window.electronAPI.stopFind('clearSelection');
  });
}

// --- Shortcuts Manager ---
let cachedShortcuts = [];
let currentShortcutFilter = 'all';
let currentShortcutSearch = '';
let listeningShortcutId = null;

async function setupShortcutsManagerUI() {
  const searchInput = document.getElementById('shortcuts-search-input');
  const btnResetAll = document.getElementById('btn-reset-shortcuts');
  const filterPills = document.querySelectorAll('.shortcuts-filter-pills .filter-pill');

  try {
    if (window.electronAPI && window.electronAPI.getShortcuts) {
      cachedShortcuts = await window.electronAPI.getShortcuts();
    }
  } catch (e) {
    console.error('Failed to load shortcuts:', e);
  }

  if (filterPills) {
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentShortcutFilter = pill.dataset.filter || 'all';
        renderShortcutsList();
      });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentShortcutSearch = e.target.value.toLowerCase().trim();
      renderShortcutsList();
    });
  }

  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      if (confirm('Сбросить все горячие клавиши к значениям по умолчанию?')) {
        listeningShortcutId = null;
        cachedShortcuts = await window.electronAPI.resetShortcuts();
        renderShortcutsList();
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onShortcutsUpdated) {
    window.electronAPI.onShortcutsUpdated((shortcuts) => {
      cachedShortcuts = shortcuts || [];
      renderShortcutsList();
    });
  }

  // Key combination capture listener when recording a shortcut
  window.addEventListener('keydown', async (e) => {
    if (!listeningShortcutId) return;

    e.preventDefault();
    e.stopPropagation();

    // Cancel on Escape
    if (e.key === 'Escape') {
      listeningShortcutId = null;
      renderShortcutsList();
      return;
    }

    // Ignore solitary modifiers
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      return;
    }

    // Build combination string
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let keyPart = '';
    const code = e.code || '';
    const rawKey = e.key || '';

    // Function keys
    if (/^F[1-9][0-2]?$/i.test(rawKey)) {
      keyPart = rawKey.toUpperCase();
    } else if (code.startsWith('Digit')) {
      keyPart = code.replace('Digit', '');
    } else if (code.startsWith('Key')) {
      keyPart = code.replace('Key', '');
    } else if (rawKey === 'Tab') {
      keyPart = 'Tab';
    } else if (rawKey === 'Enter') {
      keyPart = 'Enter';
    } else if (rawKey === 'Delete') {
      keyPart = 'Delete';
    } else if (rawKey === 'Backspace') {
      keyPart = 'Backspace';
    } else if (rawKey === ' ' || code === 'Space') {
      keyPart = 'Space';
    } else if (rawKey === '=' || rawKey === '+') {
      keyPart = '=';
    } else if (rawKey === '-' || rawKey === '_') {
      keyPart = '-';
    } else if (rawKey === ',' || rawKey === '<' || rawKey === 'б' || rawKey === 'Б') {
      keyPart = ',';
    } else if (rawKey === '.' || rawKey === '>' || rawKey === 'ю' || rawKey === 'Ю') {
      keyPart = '.';
    } else if (rawKey === '/' || rawKey === '?') {
      keyPart = '/';
    } else if (rawKey === '`' || rawKey === '~' || rawKey === 'ё' || rawKey === 'Ё') {
      keyPart = '`';
    } else if (rawKey.length === 1) {
      keyPart = rawKey.toUpperCase();
    } else {
      keyPart = rawKey;
    }

    // If no modifiers and it's a normal letter/number that's not F-key, require modifier
    if (parts.length === 0 && !/^F\d+$/i.test(keyPart) && !['Delete', 'Insert'].includes(keyPart)) {
      alert('Горячая клавиша должна содержать модификатор (Ctrl, Alt или Shift) либо быть функциональной клавишей (F1-F12).');
      return;
    }

    parts.push(keyPart);
    const newCombo = parts.join('+');

    const targetId = listeningShortcutId;
    listeningShortcutId = null;

    try {
      cachedShortcuts = await window.electronAPI.updateShortcut(targetId, {
        key: newCombo,
        enabled: true
      });
      renderShortcutsList();
    } catch (err) {
      console.error('Failed to update shortcut:', err);
    }
  }, true);
}

function renderShortcutsList() {
  const container = document.getElementById('shortcuts-container');
  if (!container) return;

  if (!cachedShortcuts || cachedShortcuts.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">Загрузка горячих клавиш...</div>`;
    return;
  }

  const filtered = cachedShortcuts.filter(s => {
    if (currentShortcutFilter !== 'all' && s.category !== currentShortcutFilter) {
      return false;
    }
    if (currentShortcutSearch) {
      const q = currentShortcutSearch;
      const matchName = s.name && s.name.toLowerCase().includes(q);
      const matchDesc = s.description && s.description.toLowerCase().includes(q);
      const matchKey = s.key && s.key.toLowerCase().includes(q);
      const matchDefault = s.defaultKey && s.defaultKey.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchKey && !matchDefault) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">Горячих клавиш по запросу «${currentShortcutSearch}» не найдено</div>`;
    return;
  }

  // Group by category
  const categories = [
    { id: 'tabs', title: 'Вкладки и Окна' },
    { id: 'nav', title: 'Навигация и Страница' },
    { id: 'tools', title: 'Инструменты и Панели' }
  ];

  container.innerHTML = '';

  categories.forEach(cat => {
    const itemsInCat = filtered.filter(s => s.category === cat.id);
    if (itemsInCat.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'shortcut-category-group';
    groupEl.innerHTML = `<div class="shortcut-category-title">${cat.title}</div>`;

    itemsInCat.forEach(s => {
      const row = document.createElement('div');
      row.className = `shortcut-row ${!s.enabled ? 'disabled' : ''}`;
      row.dataset.id = s.id;

      // Render key badge caps
      const isListening = listeningShortcutId === s.id;
      let keyBadgeHtml = '';

      if (isListening) {
        keyBadgeHtml = `<button class="shortcut-key-btn listening" title="Нажмите клавиши на клавиатуре или Esc для отмены">● Нажмите комбинацию... (Esc)</button>`;
      } else {
        const keys = (s.key || '').split('+').map(k => `<span class="keycap">${k.trim()}</span>`).join(' + ');
        keyBadgeHtml = `<button class="shortcut-key-btn ${!s.enabled ? 'disabled-key' : ''}" title="Нажмите, чтобы изменить горячую клавишу">${keys}</button>`;
      }

      const isModified = s.key !== s.defaultKey || !s.enabled;
      const resetBtnHtml = isModified 
        ? `<button class="btn-reset-single-key" title="Сбросить на значение по умолчанию (${s.defaultKey})">↺</button>`
        : '';

      row.innerHTML = `
        <div class="shortcut-info">
          <div class="shortcut-name">${s.name}</div>
          <div class="shortcut-desc">${s.description}</div>
        </div>
        <div class="shortcut-actions">
          <div class="shortcut-keys-wrapper">
            ${keyBadgeHtml}
            ${resetBtnHtml}
          </div>
          <label class="toggle-switch" title="${s.enabled ? 'Отключить горячую клавишу' : 'Включить горячую клавишу'}">
            <input type="checkbox" class="shortcut-toggle-input" ${s.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;

      // Key button click -> record new combo
      const keyBtn = row.querySelector('.shortcut-key-btn');
      if (keyBtn && !isListening) {
        keyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!s.enabled) return;
          listeningShortcutId = s.id;
          renderShortcutsList();
        });
      }

      // Single reset button
      const resetBtn = row.querySelector('.btn-reset-single-key');
      if (resetBtn) {
        resetBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          cachedShortcuts = await window.electronAPI.updateShortcut(s.id, {
            key: s.defaultKey,
            enabled: true
          });
          renderShortcutsList();
        });
      }

      // Toggle switch
      const toggleInput = row.querySelector('.shortcut-toggle-input');
      if (toggleInput) {
        toggleInput.addEventListener('change', async (e) => {
          const checked = e.target.checked;
          s.enabled = checked;
          row.classList.toggle('disabled', !checked);
          cachedShortcuts = await window.electronAPI.toggleShortcut(s.id, checked);
          renderShortcutsList();
        });
      }

      groupEl.appendChild(row);
    });

    container.appendChild(groupEl);
  });
}

// --- Downloads Manager (Chrome-Style Compact Bubble & Drag-and-Drop) ---
let currentDownloads = [];
let currentDownloadsSearch = '';
const fileIconCache = new Map(); // savePath -> dataUrl

function getCachedOrFallbackIcon(fn, mimeType, savePath, onIconLoaded) {
  if (savePath && fileIconCache.has(savePath)) {
    const dataUrl = fileIconCache.get(savePath);
    if (dataUrl) {
      return `<img class="native-file-icon" src="${dataUrl}" alt="" draggable="false">`;
    }
  }

  // Request native icon asynchronously if available
  if (savePath && window.electronAPI && window.electronAPI.getDownloadFileIcon && !fileIconCache.has(savePath)) {
    fileIconCache.set(savePath, null); // mark requested
    window.electronAPI.getDownloadFileIcon(savePath).then(dataUrl => {
      if (dataUrl) {
        fileIconCache.set(savePath, dataUrl);
        if (typeof onIconLoaded === 'function') {
          onIconLoaded(dataUrl);
        }
      }
    }).catch(() => {});
  }

  return getFileIcon(fn, mimeType);
}

function attachDownloadDrag(element, savePath) {
  if (!element || !savePath) return;
  element.setAttribute('draggable', 'true');
  element.title = 'Перетяните файл в любую программу (CapCut, Premiere, Telegram и др.) или на рабочий стол';
  element.addEventListener('dragstart', (e) => {
    e.preventDefault();
    element.classList.add('is-dragging');
    if (window.electronAPI && window.electronAPI.startDownloadDrag) {
      window.electronAPI.startDownloadDrag(savePath);
    }
  });
  element.addEventListener('dragend', () => {
    element.classList.remove('is-dragging');
    if (window.electronAPI && window.electronAPI.endDownloadDrag) {
      window.electronAPI.endDownloadDrag();
    }
  });
}

function updateDownloadsToolbarBadge() {
  const badge = document.getElementById('downloads-toolbar-badge');
  const bubbleCount = document.getElementById('downloads-bubble-active-count');
  if (!badge) return;

  const progressingCount = (currentDownloads || []).filter(d => d.state === 'progressing' || d.state === 'paused' || d.isPaused).length;
  if (progressingCount > 0) {
    badge.classList.remove('hidden');
    badge.classList.add('progressing');
    if (bubbleCount) {
      bubbleCount.textContent = `${progressingCount} акт.`;
      bubbleCount.classList.remove('hidden');
    }
  } else {
    badge.classList.remove('progressing');
    if ((currentDownloads || []).length > 0) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    if (bubbleCount) {
      bubbleCount.classList.add('hidden');
    }
  }
}

let completedNotifiedDownloadIds = new Set();
let vtToastInterval = null;

function showVirusTotalDownloadToast(downloadItem) {
  if (!downloadItem || !downloadItem.savePath || downloadItem.state !== 'completed') return;
  if (completedNotifiedDownloadIds.has(downloadItem.id)) return;
  completedNotifiedDownloadIds.add(downloadItem.id);

  const toast = document.getElementById('virustotal-prompt-toast');
  if (!toast) return;

  const btnDownloads = document.getElementById('btn-downloads-menu');
  if (btnDownloads) {
    const rect = btnDownloads.getBoundingClientRect();
    const rightOffset = Math.max(16, window.innerWidth - rect.right - 10);
    toast.style.right = `${rightOffset}px`;
    toast.style.top = `${rect.bottom + 8}px`;
  }

  const fn = resolveDownloadFileName(downloadItem);
  const filenameEl = document.getElementById('vt-toast-filename');
  if (filenameEl) {
    filenameEl.textContent = fn;
    filenameEl.title = downloadItem.savePath;
  }

  toast._currentSavePath = downloadItem.savePath;
  toast.classList.remove('hidden');

  // Start 12s countdown timer with visual progress bar
  const progressFill = document.getElementById('vt-toast-progress-fill');
  if (progressFill) progressFill.style.width = '100%';

  if (vtToastInterval) clearInterval(vtToastInterval);

  const duration = 12000;
  const start = Date.now();
  
  vtToastInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const pct = Math.max(0, 100 - (elapsed / duration) * 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (elapsed >= duration) {
      clearInterval(vtToastInterval);
      toast.classList.add('hidden');
    }
  }, 100);
}

function initVirusTotalToast() {
  const toast = document.getElementById('virustotal-prompt-toast');
  if (!toast) return;

  const btnScan = document.getElementById('vt-toast-scan-btn');
  const btnClose = document.getElementById('vt-toast-close');
  const btnDismiss = document.getElementById('vt-toast-dismiss-btn');

  if (btnScan) {
    btnScan.addEventListener('click', () => {
      if (toast._currentSavePath && window.electronAPI && window.electronAPI.checkVirusTotal) {
        window.electronAPI.checkVirusTotal(toast._currentSavePath);
      }
      toast.classList.add('hidden');
      if (vtToastInterval) clearInterval(vtToastInterval);
    });
  }

  const hideToast = () => {
    toast.classList.add('hidden');
    if (vtToastInterval) clearInterval(vtToastInterval);
  };

  if (btnClose) btnClose.addEventListener('click', hideToast);
  if (btnDismiss) btnDismiss.addEventListener('click', hideToast);
}

function setupDownloadsUI() {
  initVirusTotalToast();
  const btnOpenFolder = document.getElementById('btn-open-downloads-folder');
  const btnClearDownloads = document.getElementById('btn-clear-downloads');
  const searchInput = document.getElementById('downloads-search-input');

  if (btnOpenFolder) {
    btnOpenFolder.addEventListener('click', () => {
      window.electronAPI.openDownloadsFolder();
    });
  }

  if (btnClearDownloads) {
    btnClearDownloads.addEventListener('click', async () => {
      if (confirm('Очистить историю загрузок? Сами файлы останутся на диске.')) {
        await window.electronAPI.clearDownloads();
        currentDownloads = [];
        renderDownloadsList();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentDownloadsSearch = searchInput.value.toLowerCase().trim();
      renderDownloadsList();
    });
  }

  // Real-time download progress updates from main process
  if (window.electronAPI && window.electronAPI.onDownloadUpdated) {
    window.electronAPI.onDownloadUpdated((downloadItem) => {
      const isNew = !currentDownloads.some(d => d.id === downloadItem.id);
      const idx = currentDownloads.findIndex(d => d.id === downloadItem.id);
      if (idx >= 0) {
        currentDownloads[idx] = { ...currentDownloads[idx], ...downloadItem };
      } else {
        currentDownloads.unshift(downloadItem);
      }

      updateDownloadsToolbarBadge();

      // If a download just finished, prompt the user with the VirusTotal toast
      if (downloadItem.state === 'completed' && downloadItem.savePath) {
        showVirusTotalDownloadToast(downloadItem);
      }

      // If a brand new download started, trigger the floating downloads bubble popup
      if (isNew && downloadItem.state === 'progressing') {
        const btnDownloads = document.getElementById('btn-downloads-menu');
        if (btnDownloads && window.electronAPI && window.electronAPI.toggleDownloadsBubble) {
          const rect = btnDownloads.getBoundingClientRect();
          window.electronAPI.toggleDownloadsBubble({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          });
        }
      }

      if (modalDownloads && !modalDownloads.classList.contains('hidden')) {
        renderDownloadsList();
      }
    });
  }
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes <= 0) return '0 Б';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getFileIcon(filename = '', mimeType = '') {
  const cleanName = (filename || '').trim();
  const ext = cleanName.includes('.') ? cleanName.split('.').pop().toLowerCase() : '';
  const mime = (mimeType || '').toLowerCase();

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'].includes(ext) || mime.startsWith('image/')) {
    return '🖼️';
  }
  if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', '3gp'].includes(ext) || mime.startsWith('video/')) {
    return '🎬';
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus'].includes(ext) || mime.startsWith('audio/')) {
    return '🎵';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab'].includes(ext) || mime.includes('zip') || mime.includes('compressed') || mime.includes('archive')) {
    return '📦';
  }
  if (['exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'jar'].includes(ext)) {
    return '⚡';
  }
  if (['crx', 'xpi'].includes(ext)) {
    return '🧩';
  }
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'epub'].includes(ext) || mime.includes('pdf') || mime.includes('document') || mime.includes('sheet') || mime.includes('text')) {
    return '📄';
  }
  if (['js', 'html', 'css', 'json', 'py', 'cpp', 'c', 'cs', 'ts', 'jsx', 'tsx', 'php', 'rb', 'go', 'rs', 'java', 'xml', 'sql', 'sh'].includes(ext)) {
    return '📜';
  }
  if (['torrent'].includes(ext)) {
    return '🧲';
  }
  return '📄';
}

function resolveDownloadFileName(item) {
  if (!item) return 'Файл';
  let fn = item.filename || item.fileName || '';
  if (!fn || fn === 'download' || fn === 'Без названия' || fn.trim() === '') {
    if (item.savePath) {
      const parts = item.savePath.split(/[/\\]/);
      const last = parts[parts.length - 1];
      if (last && last.trim()) fn = decodeURIComponent(last);
    }
    if (!fn || fn === 'download') {
      if (item.url && !item.url.startsWith('data:') && !item.url.startsWith('blob:')) {
        try {
          const u = new URL(item.url);
          const segs = u.pathname.split('/').filter(Boolean);
          if (segs.length > 0) fn = decodeURIComponent(segs[segs.length - 1]);
        } catch (e) {}
      }
    }
  }
  return fn || 'Файл';
}

async function renderDownloadsList() {
  const listEl = document.getElementById('downloads-list');
  if (!listEl) return;

  try {
    currentDownloads = await window.electronAPI.getDownloads(100);
  } catch (e) {
    console.error('Failed to get downloads:', e);
  }

  updateDownloadsToolbarBadge();

  const q = currentDownloadsSearch;
  const filtered = (currentDownloads || []).filter(d => {
    const fn = resolveDownloadFileName(d).toLowerCase();
    const url = (d.url || '').toLowerCase();
    const sp = (d.savePath || '').toLowerCase();
    return fn.includes(q) || url.includes(q) || sp.includes(q);
  });

  listEl.innerHTML = '';

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color: var(--text-muted);">
        <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" stroke-width="1.5" fill="none" style="opacity:0.4; margin-bottom:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <div>${(currentDownloads || []).length === 0 ? 'История загрузок пуста' : 'Ничего не найдено'}</div>
      </div>
    `;
    return;
  }

  filtered.forEach(d => {
    const card = document.createElement('div');
    card.className = 'download-card';

    const fn = resolveDownloadFileName(d);
    const isCompleted = d.state === 'completed';
    const isPaused = d.state === 'paused' || d.isPaused === true;
    const isProgressing = d.state === 'progressing' && !isPaused;
    const isCancelled = d.state === 'cancelled';
    const isInterrupted = d.state === 'interrupted';

    let stateBadgeText = 'Завершено';
    let stateBadgeClass = 'state-completed';

    const totalBytes = d.fileSize || d.totalBytes || 0;
    const receivedBytes = d.receivedBytes || 0;

    if (isProgressing) {
      const pct = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
      stateBadgeText = `Скачивается (${pct}%)`;
      stateBadgeClass = 'state-progressing';
    } else if (isPaused) {
      const pct = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
      stateBadgeText = `На паузе (${pct}%)`;
      stateBadgeClass = 'state-paused';
    } else if (isCancelled) {
      stateBadgeText = 'Отменено';
      stateBadgeClass = 'state-cancelled';
    } else if (isInterrupted) {
      stateBadgeText = 'Прервано';
      stateBadgeClass = 'state-interrupted';
    }

    const sizeStr = totalBytes > 0 
      ? formatBytes(totalBytes) 
      : (receivedBytes > 0 ? formatBytes(receivedBytes) : '—');

    const dateStr = d.startTime 
      ? new Date(d.startTime).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';

    card.innerHTML = `
      <div class="download-icon" id="modal-icon-${d.id}">
        ${getCachedOrFallbackIcon(fn, d.mimeType, d.savePath, (dataUrl) => {
          const iconEl = card.querySelector(`#modal-icon-${d.id}`);
          if (iconEl) iconEl.innerHTML = `<img class="native-file-icon" src="${dataUrl}" alt="" draggable="false">`;
        })}
      </div>
      <div class="download-info">
        <div class="download-name" title="${fn}">${fn}</div>
        <div class="download-meta">
          <span>${sizeStr}</span>
          ${dateStr ? `<span>•</span><span>${dateStr}</span>` : ''}
          <span class="download-state-badge ${stateBadgeClass}">${stateBadgeText}</span>
        </div>
        ${(isProgressing || isPaused) && totalBytes > 0 ? `
          <div class="download-progress-bar-wrap">
            <div class="download-progress-bar-fill ${isPaused ? 'paused' : ''}" style="width: ${Math.min(100, Math.round((receivedBytes / totalBytes) * 100))}%; ${isPaused ? 'background: linear-gradient(90deg, #f59e0b, #d97706);' : ''}"></div>
          </div>
        ` : ''}
      </div>
      <div class="download-actions">
        ${isProgressing ? `
          <button class="btn btn-secondary btn-sm btn-pause-download" title="Приостановить загрузку">⏸ Пауза</button>
          <button class="btn btn-secondary btn-sm btn-cancel-download" title="Отменить загрузку">✕ Отмена</button>
        ` : ''}
        ${isPaused ? `
          <button class="btn btn-secondary btn-sm btn-resume-download" title="Возобновить загрузку">▶ Возобновить</button>
          <button class="btn btn-secondary btn-sm btn-cancel-download" title="Отменить загрузку">✕ Отмена</button>
        ` : ''}
        ${isInterrupted ? `
          <button class="btn btn-secondary btn-sm btn-resume-download" title="Повторить загрузку">🔄 Повторить</button>
        ` : ''}
        ${isCompleted && d.savePath ? `
          <button class="btn btn-secondary btn-sm btn-open-file" title="Открыть файл">Открыть</button>
          <button class="btn btn-secondary btn-sm btn-show-folder" title="Показать в папке">Показать в папке</button>
        ` : ''}
      </div>
    `;

    if (d.savePath && (isCompleted || isProgressing || isPaused)) {
      attachDownloadDrag(card, d.savePath);
    }

    const btnPause = card.querySelector('.btn-pause-download');
    if (btnPause) {
      btnPause.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.pauseDownload) {
          await window.electronAPI.pauseDownload(d.id);
          renderDownloadsList();
        }
      });
    }

    const btnResume = card.querySelector('.btn-resume-download');
    if (btnResume) {
      btnResume.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.resumeDownload) {
          await window.electronAPI.resumeDownload(d.id);
          renderDownloadsList();
        }
      });
    }

    const btnCancel = card.querySelector('.btn-cancel-download');
    if (btnCancel) {
      btnCancel.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.cancelDownload) {
          await window.electronAPI.cancelDownload(d.id);
          renderDownloadsList();
        }
      });
    }

    const btnOpenFile = card.querySelector('.btn-open-file');
    if (btnOpenFile) {
      btnOpenFile.addEventListener('click', (e) => {
        e.stopPropagation();
        window.electronAPI.openDownloadFile(d.savePath);
      });
    }

    const btnShowFolder = card.querySelector('.btn-show-folder');
    if (btnShowFolder) {
      btnShowFolder.addEventListener('click', (e) => {
        e.stopPropagation();
        window.electronAPI.showDownloadInFolder(d.savePath);
      });
    }

    listEl.appendChild(card);
  });
}

function isShortcutMatched(e, shortcut) {
  if (!shortcut || !shortcut.enabled || !shortcut.key) return false;

  const parts = shortcut.key.split('+').map(p => p.trim());
  const needCtrl = parts.includes('Ctrl');
  const needAlt = parts.includes('Alt');
  const needShift = parts.includes('Shift');

  const isCtrl = Boolean(e.ctrlKey || e.metaKey);
  const isAlt = Boolean(e.altKey);
  const isShift = Boolean(e.shiftKey);

  if (needCtrl !== isCtrl) return false;
  if (needAlt !== isAlt) return false;
  if (needShift !== isShift) return false;

  const keyPart = parts[parts.length - 1];
  const code = e.code || '';
  const key = (e.key || '').toLowerCase();

  // Handle Ctrl+1..9
  if (shortcut.id === 'tab-digits' || keyPart === '1..9') {
    return code.startsWith('Digit') || /^[1-9]$/.test(key);
  }

  // Function keys
  if (/^F[1-9][0-2]?$/i.test(keyPart)) {
    return e.key.toUpperCase() === keyPart.toUpperCase();
  }

  // Letters (English and Russian layout tolerance)
  if (keyPart.length === 1 && /[A-Z]/i.test(keyPart)) {
    const expectedCode = 'Key' + keyPart.toUpperCase();
    if (code === expectedCode) return true;
    
    // Russian layout mapping
    const ruToEn = {
      'ф': 'A', 'и': 'B', 'с': 'C', 'в': 'D', 'у': 'E', 'а': 'F', 'п': 'G',
      'р': 'H', 'ш': 'I', 'о': 'J', 'л': 'K', 'д': 'L', 'ь': 'M', 'т': 'N',
      'щ': 'O', 'з': 'P', 'й': 'Q', 'к': 'R', 'ы': 'S', 'е': 'T', 'г': 'U',
      'м': 'V', 'ц': 'W', 'ч': 'X', 'н': 'Y', 'я': 'Z'
    };
    if (ruToEn[key] === keyPart.toUpperCase()) return true;
    if (key === keyPart.toLowerCase()) return true;
  }

  // Digits
  if (/^\d$/.test(keyPart)) {
    return code === 'Digit' + keyPart || key === keyPart;
  }

  // Symbols and Special Keys
  if (keyPart === 'Tab') return e.key === 'Tab';
  if (keyPart === 'Enter') return e.key === 'Enter';
  if (keyPart === 'Delete') return e.key === 'Delete';
  if (keyPart === 'Backspace') return e.key === 'Backspace';
  if (keyPart === 'Space') return e.key === ' ' || code === 'Space';
  if (keyPart === '=') return key === '=' || key === '+' || code === 'Equal';
  if (keyPart === '-') return key === '-' || key === '_' || code === 'Minus';
  if (keyPart === ',') return key === ',' || key === '<' || key === 'б' || code === 'Comma';
  if (keyPart === '.') return key === '.' || key === '>' || key === 'ю' || code === 'Period';
  if (keyPart === '/') return key === '/' || key === '?' || code === 'Slash';
  if (keyPart === '`') return key === '`' || key === '~' || key === 'ё' || code === 'Backquote';

  return false;
}

// --- Keyboard Shortcuts ---
function setupShortcuts() {
  window.addEventListener('keydown', (e) => {
    // If we are currently capturing a new shortcut in settings, don't execute actions
    if (listeningShortcutId) return;

    if (e.key === 'Escape') {
      const anyModalOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(m => !m.classList.contains('hidden'));
      if (anyModalOpen) {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        const bubble = document.getElementById('downloads-bubble');
        if (bubble) bubble.classList.add('hidden');
        if (window.electronAPI && window.electronAPI.setModalState) {
          window.electronAPI.setModalState(false);
        }
      }
      const findBar = document.getElementById('find-bar');
      if (findBar && !findBar.classList.contains('hidden')) {
        findBar.classList.add('hidden');
        window.electronAPI.stopFind('clearSelection');
      }
      return;
    }

    // Direct standard shortcuts fallback
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 'N' || e.code === 'KeyN')) {
      e.preventDefault();
      window.electronAPI.openNewWindow();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р' || e.code === 'KeyH')) {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.createTab) {
        window.electronAPI.createTab({ url: 'eclipse://history', active: true });
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J' || e.key === 'о' || e.key === 'О' || e.code === 'KeyJ')) {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.createTab) {
        window.electronAPI.createTab({ url: 'eclipse://downloads', active: true });
      }
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы' || e.code === 'KeyS')) {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.toggleSplitScreen) {
        window.electronAPI.toggleSplitScreen();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М' || e.code === 'KeyV')) {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.toggleVerticalTabs) {
        window.electronAPI.toggleVerticalTabs();
      }
      return;
    }

    // Match against cached shortcuts
    const matched = (cachedShortcuts || []).find(s => isShortcutMatched(e, s));
    if (!matched) return;

    e.preventDefault();

    switch (matched.id) {
      case 'new-tab':
        window.electronAPI.createTab({ url: isIncognitoWindow ? 'eclipse://incognito' : 'eclipse://newtab', active: true });
        break;
      case 'new-window':
        window.electronAPI.openNewWindow();
        break;
      case 'move-tab-new-window':
        if (activeTabId && window.electronAPI.moveTabToNewWindow) {
          window.electronAPI.moveTabToNewWindow(activeTabId);
        }
        break;
      case 'close-tab':
        if (activeTabId) window.electronAPI.closeTab(activeTabId);
        break;
      case 'restore-tab':
        window.electronAPI.restoreLastClosedTab();
        break;
      case 'new-incognito':
        window.electronAPI.openIncognitoWindow();
        break;
      case 'next-tab':
        window.electronAPI.switchToNextTab();
        break;
      case 'prev-tab':
        window.electronAPI.switchToPrevTab();
        break;
      case 'duplicate-tab':
        if (activeTabId) {
          const tab = currentTabs.find(t => t.id === activeTabId);
          if (tab && tab.url) {
            window.electronAPI.createTab({ url: tab.url, active: true });
          }
        }
        break;
      case 'tab-digits': {
        const code = e.code || '';
        const key = (e.key || '').toLowerCase();
        const digitStr = code.startsWith('Digit') ? code.replace('Digit', '') : key;
        const idx = parseInt(digitStr, 10) - 1;
        if (idx >= 0 && idx < currentTabs.length) {
          window.electronAPI.switchTab(currentTabs[idx].id);
        }
        break;
      }
      case 'reload-page':
        window.electronAPI.reload();
        break;
      case 'hard-reload':
        window.electronAPI.reload(true);
        break;
      case 'focus-omnibox':
        if (omniboxInput) {
          omniboxInput.focus();
          omniboxInput.select();
        }
        break;
      case 'find-in-page': {
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        if (findBar && findInput) {
          findBar.classList.remove('hidden');
          findInput.focus();
          findInput.select();
        }
        break;
      }
      case 'zoom-in':
        if (activeTabId && window.electronAPI.zoomIn) window.electronAPI.zoomIn(activeTabId);
        break;
      case 'zoom-out':
        if (activeTabId && window.electronAPI.zoomOut) window.electronAPI.zoomOut(activeTabId);
        break;
      case 'zoom-reset':
        if (activeTabId && window.electronAPI.zoomReset) window.electronAPI.zoomReset(activeTabId);
        break;
      case 'fullscreen':
        // Full screen toggle
        break;
      case 'open-history': {
        if (window.electronAPI && window.electronAPI.createTab) {
          window.electronAPI.createTab({ url: 'eclipse://history', active: true });
        } else {
          openModal(modalHistory);
          renderHistory();
        }
        break;
      }
      case 'open-downloads': {
        if (window.electronAPI && window.electronAPI.createTab) {
          window.electronAPI.createTab({ url: 'eclipse://downloads', active: true });
        } else {
          openModal(modalDownloads);
          renderDownloadsList();
        }
        break;
      }
      case 'open-bookmarks':
        openModal(modalBookmarks);
        renderFullBookmarks();
        break;
      case 'bookmark-page':
        if (btnBookmarkToggle) btnBookmarkToggle.click();
        break;
      case 'toggle-bookmarks-bar': {
        const toggle = document.getElementById('setting-bookmarks-toggle');
        if (toggle) {
          toggle.checked = !toggle.checked;
          toggle.dispatchEvent(new Event('change'));
        }
        break;
      }
      case 'open-settings':
        openModal(modalSettings);
        break;
      case 'open-passwords':
        openModal(modalPasswords);
        renderPasswordsList();
        break;
      case 'open-extensions':
        openModal(modalExtensions);
        loadExtensions();
        break;
      case 'toggle-shield':
        openModal(document.getElementById('modal-shield'));
        if (window.refreshShieldStatus) window.refreshShieldStatus();
        break;
      case 'toggle-pip':
        if (activeTabId && window.electronAPI && window.electronAPI.togglePictureInPicture) {
          window.electronAPI.togglePictureInPicture(activeTabId);
        }
        break;
      case 'split-screen':
        if (window.electronAPI && window.electronAPI.toggleSplitScreen) {
          window.electronAPI.toggleSplitScreen();
        }
        break;
      case 'toggle-vertical-tabs':
        if (window.electronAPI && window.electronAPI.toggleVerticalTabs) {
          window.electronAPI.toggleVerticalTabs();
        }
        break;
      case 'clear-cache': {
        const btnClearCache = document.getElementById('btn-clear-cache');
        if (btnClearCache) btnClearCache.click();
        break;
      }
      case 'devtools':
        if (activeTabId && window.electronAPI && window.electronAPI.toggleDevTools) {
          window.electronAPI.toggleDevTools(activeTabId);
        }
        break;
    }
  });

  // Listen for forwarded triggers from WebContentsView (via viewManager.js)
  if (window.electronAPI) {
    if (window.electronAPI.onFocusOmnibox) {
      window.electronAPI.onFocusOmnibox(() => {
        if (omniboxInput) {
          omniboxInput.focus();
          omniboxInput.select();
        }
      });
    }

    if (window.electronAPI.onTriggerBookmarkShortcut) {
      window.electronAPI.onTriggerBookmarkShortcut(() => {
        if (btnBookmarkToggle) btnBookmarkToggle.click();
      });
    }

    if (window.electronAPI.onTriggerFindShortcut) {
      window.electronAPI.onTriggerFindShortcut(() => {
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        if (findBar && findInput) {
          findBar.classList.remove('hidden');
          findInput.focus();
          findInput.select();
        }
      });
    }

    if (window.electronAPI.onTriggerHistory) {
      window.electronAPI.onTriggerHistory(() => {
        const btnHistory = document.getElementById('btn-history-menu');
        if (btnHistory && window.electronAPI && window.electronAPI.toggleHistoryBubble) {
          const rect = btnHistory.getBoundingClientRect();
          window.electronAPI.toggleHistoryBubble({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          });
        } else {
          openModal(modalHistory);
          renderHistory();
        }
      });
    }

    if (window.electronAPI.onTriggerDownloads) {
      window.electronAPI.onTriggerDownloads(() => {
        const btnDownloads = document.getElementById('btn-downloads-menu');
        if (btnDownloads && window.electronAPI && window.electronAPI.toggleDownloadsBubble) {
          const rect = btnDownloads.getBoundingClientRect();
          window.electronAPI.toggleDownloadsBubble({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          });
        } else {
          openModal(modalDownloads);
          renderDownloadsList();
        }
      });
    }

    if (window.electronAPI.onTriggerDownloadsModal) {
      window.electronAPI.onTriggerDownloadsModal(() => {
        openModal(modalDownloads);
        renderDownloadsList();
      });
    }

    if (window.electronAPI.onTriggerHistoryModal) {
      window.electronAPI.onTriggerHistoryModal(() => {
        openModal(modalHistory);
        renderHistory();
      });
    }

    if (window.electronAPI.onTriggerBookmarks) {
      window.electronAPI.onTriggerBookmarks(() => {
        openModal(modalBookmarks);
        renderFullBookmarks();
      });
    }

    if (window.electronAPI.onTriggerToggleBookmarksBar) {
      window.electronAPI.onTriggerToggleBookmarksBar(() => {
        const toggle = document.getElementById('setting-bookmarks-toggle');
        if (toggle) {
          toggle.checked = !toggle.checked;
          toggle.dispatchEvent(new Event('change'));
        }
      });
    }

    if (window.electronAPI.onTriggerSettings) {
      window.electronAPI.onTriggerSettings(() => {
        openModal(modalSettings);
      });
    }

    if (window.electronAPI.onTriggerPasswords) {
      window.electronAPI.onTriggerPasswords(() => {
        openModal(modalPasswords);
        renderPasswordsList();
      });
    }

    if (window.electronAPI.onTriggerExtensions) {
      window.electronAPI.onTriggerExtensions(() => {
        openModal(modalExtensions);
        loadExtensions();
      });
    }

    if (window.electronAPI.onTriggerShield) {
      window.electronAPI.onTriggerShield(() => {
        openModal(document.getElementById('modal-shield'));
        if (window.refreshShieldStatus) window.refreshShieldStatus();
      });
    }

    if (window.electronAPI.onTriggerClearCache) {
      window.electronAPI.onTriggerClearCache(() => {
        const btnClearCache = document.getElementById('btn-clear-cache');
        if (btnClearCache) btnClearCache.click();
      });
    }
  }
}

// --- Split Screen (2 Tabs Side-by-Side) UI Controller ---
function setupSplitScreenUI() {
  const btnSplitScreen = document.getElementById('btn-split-screen');
  const splitBadge = document.getElementById('split-screen-badge');
  const splitDivider = document.getElementById('split-screen-divider');
  const btnSplitSwap = document.getElementById('btn-split-swap');
  const btnSplitClose = document.getElementById('btn-split-close');

  function updateSplitUI(state) {
    if (!state) return;
    if (state.isActive) {
      if (btnSplitScreen) {
        btnSplitScreen.classList.add('active');
        btnSplitScreen.title = 'Разделение экрана активно (Alt+S). ПКМ: меню настроек и пропорций.';
      }
      if (splitBadge) splitBadge.classList.remove('hidden');
      if (splitDivider) {
        splitDivider.classList.remove('hidden');
        const ratio = typeof state.splitRatio === 'number' ? state.splitRatio : 0.5;
        const sidebarOffset = currentVtabState && currentVtabState.enabled
          ? (currentVtabState.collapsed ? 52 : 240)
          : 0;
        const winWidth = window.innerWidth || document.documentElement.clientWidth;
        const contentWidth = Math.max(200, winWidth - sidebarOffset);
        splitDivider.style.left = `${sidebarOffset + Math.floor(contentWidth * ratio)}px`;
      }
    } else {
      if (btnSplitScreen) {
        btnSplitScreen.classList.remove('active');
        btnSplitScreen.title = 'Разделить экран (2 вкладки рядом) (Alt+S)';
      }
      if (splitBadge) splitBadge.classList.add('hidden');
      if (splitDivider) splitDivider.classList.add('hidden');
    }
  }

  // Left click on toolbar button toggles split screen
  if (btnSplitScreen) {
    btnSplitScreen.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.electronAPI && window.electronAPI.toggleSplitScreen) {
        window.electronAPI.toggleSplitScreen();
      }
    });

    // Right click on toolbar button shows context menu with ratio presets (50/50, 70/30, 30/70, swap, close)
    btnSplitScreen.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.electronAPI && window.electronAPI.showSplitScreenMenu) {
        window.electronAPI.showSplitScreenMenu({ x: e.clientX, y: e.clientY });
      }
    });
  }

  // Swap button on divider
  if (btnSplitSwap) {
    btnSplitSwap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.electronAPI && window.electronAPI.swapSplitScreenTabs) {
        window.electronAPI.swapSplitScreenTabs();
      }
    });
  }

  // Close button on divider
  if (btnSplitClose) {
    btnSplitClose.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.electronAPI && window.electronAPI.toggleSplitScreen) {
        window.electronAPI.toggleSplitScreen();
      }
    });
  }

  // Interactive Drag & Resize Divider
  let isDraggingDivider = false;
  if (splitDivider) {
    splitDivider.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.split-mini-btn')) return;
      isDraggingDivider = true;
      try {
        splitDivider.setPointerCapture(e.pointerId);
      } catch (err) {}
      document.body.classList.add('is-resizing-split');
      e.preventDefault();
    });

    splitDivider.addEventListener('pointermove', (e) => {
      if (!isDraggingDivider) return;
      const sidebarOffset = currentVtabState && currentVtabState.enabled
        ? (currentVtabState.collapsed ? 52 : 240)
        : 0;
      const winWidth = window.innerWidth || document.documentElement.clientWidth;
      const contentWidth = Math.max(200, winWidth - sidebarOffset);
      const ratio = Math.max(0.2, Math.min(0.8, (e.clientX - sidebarOffset) / contentWidth));
      splitDivider.style.left = `${sidebarOffset + Math.floor(contentWidth * ratio)}px`;
      if (window.electronAPI && window.electronAPI.setSplitScreenRatio) {
        window.electronAPI.setSplitScreenRatio(ratio);
      }
    });

    const stopDragging = (e) => {
      if (isDraggingDivider) {
        isDraggingDivider = false;
        try {
          if (e && e.pointerId) splitDivider.releasePointerCapture(e.pointerId);
        } catch (err) {}
        document.body.classList.remove('is-resizing-split');
      }
    };

    splitDivider.addEventListener('pointerup', stopDragging);
    splitDivider.addEventListener('pointercancel', stopDragging);
    window.addEventListener('mouseup', stopDragging);
  }

  // Listen for split screen state events from main process
  if (window.electronAPI && window.electronAPI.onSplitScreenStateChanged) {
    window.electronAPI.onSplitScreenStateChanged((state) => {
      updateSplitUI(state);
    });
  }

  // Fetch initial state
  if (window.electronAPI && window.electronAPI.getSplitScreenState) {
    window.electronAPI.getSplitScreenState().then((state) => {
      if (state) updateSplitUI(state);
    }).catch(() => {});
  }
}

// --- Vertical Tabs UI Controller ---
let currentVtabState = { enabled: false, collapsed: false, width: 240, collapsedWidth: 52 };

function setupVerticalTabsUI() {
  const btnToggleStrip = document.getElementById('btn-toggle-vertical-tabs-strip');
  const btnCollapse = document.getElementById('btn-vtab-collapse');
  const btnNewTab = document.getElementById('btn-vtab-new-tab');
  const btnReturnHorizontal = document.getElementById('btn-vtab-return-horizontal');
  const settingToggle = document.getElementById('setting-vertical-tabs-toggle');
  const settingCollapsedToggle = document.getElementById('setting-vertical-tabs-collapsed-toggle');

  function applyState(state) {
    if (!state) return;
    currentVtabState = state;

    if (state.enabled) {
      document.body.classList.add('vertical-tabs-enabled');
      if (btnToggleStrip) {
        btnToggleStrip.classList.add('active');
        btnToggleStrip.title = 'Вертикальные вкладки активны (Ctrl+Shift+V)';
      }
      if (settingToggle) settingToggle.checked = true;
    } else {
      document.body.classList.remove('vertical-tabs-enabled');
      if (btnToggleStrip) {
        btnToggleStrip.classList.remove('active');
        btnToggleStrip.title = 'Переключить на вертикальные вкладки (Ctrl+Shift+V)';
      }
      if (settingToggle) settingToggle.checked = false;
    }

    if (state.collapsed) {
      document.body.classList.add('vertical-tabs-collapsed');
      if (settingCollapsedToggle) settingCollapsedToggle.checked = true;
    } else {
      document.body.classList.remove('vertical-tabs-collapsed');
      if (settingCollapsedToggle) settingCollapsedToggle.checked = false;
    }

    // Measure topBar and sync
    syncTopBarHeight();

    // Re-render tabs to ensure vertical list is updated
    renderTabs();

    // Update split screen divider position if active
    if (window.electronAPI && window.electronAPI.getSplitScreenState) {
      window.electronAPI.getSplitScreenState().then((s) => {
        const splitDivider = document.getElementById('split-screen-divider');
        if (splitDivider && s && s.isActive) {
          const sidebarOffset = state.enabled ? (state.collapsed ? 52 : 240) : 0;
          const winWidth = window.innerWidth || document.documentElement.clientWidth;
          const contentWidth = Math.max(200, winWidth - sidebarOffset);
          const ratio = typeof s.splitRatio === 'number' ? s.splitRatio : 0.5;
          splitDivider.style.left = `${sidebarOffset + Math.floor(contentWidth * ratio)}px`;
        }
      }).catch(() => {});
    }
  }

  // Toggle buttons
  btnToggleStrip?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.toggleVerticalTabs) {
      window.electronAPI.toggleVerticalTabs();
    }
  });

  btnCollapse?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.toggleVerticalTabsCollapse) {
      window.electronAPI.toggleVerticalTabsCollapse();
    }
  });

  btnNewTab?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.createTab) {
      window.electronAPI.createTab({ url: isIncognitoWindow ? 'eclipse://incognito' : 'eclipse://newtab', active: true });
    }
  });

  btnReturnHorizontal?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.setVerticalTabs) {
      window.electronAPI.setVerticalTabs({ enabled: false });
    }
  });

  // Settings switches
  settingToggle?.addEventListener('change', (e) => {
    if (window.electronAPI && window.electronAPI.setVerticalTabs) {
      window.electronAPI.setVerticalTabs({ enabled: e.target.checked });
    }
  });

  settingCollapsedToggle?.addEventListener('change', (e) => {
    if (window.electronAPI && window.electronAPI.setVerticalTabs) {
      window.electronAPI.setVerticalTabs({ collapsed: e.target.checked });
    }
  });

  // Event listener from main process
  if (window.electronAPI && window.electronAPI.onVerticalTabsStateChanged) {
    window.electronAPI.onVerticalTabsStateChanged((state) => {
      applyState(state);
    });
  }

  // Fetch initial state
  if (window.electronAPI && window.electronAPI.getVerticalTabsState) {
    window.electronAPI.getVerticalTabsState().then((state) => {
      if (state) applyState(state);
    }).catch(() => {});
  }
}

// Start
window.addEventListener('DOMContentLoaded', init);
