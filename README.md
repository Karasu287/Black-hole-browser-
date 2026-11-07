# 🌌 Black hole Browser (v1.14.0)

[![GitHub Release](https://img.shields.io/github/v/release/Karasu287/Black-hole-browser-?color=a855f7&label=Release)](https://github.com/Karasu287/Black-hole-browser-/releases)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-brightgreen.svg)](https://github.com/Karasu287/Black-hole-browser-/releases)

An ultra-fast, deeply optimized web browser powered by **Chromium (Blink + V8)** featuring an **OLED Dark** aesthetic, built-in ad blocker (**Black hole Shield**), native support for **Google Chrome Extensions (Manifest V2 & V3)**, context media menu, 1-click automatic updates, and cross-window tab dragging.

---

[🇬🇧 English Description](#-english-description) • [🇷🇺 Русское описание](#-русское-описание)

---

## 🇬🇧 English Description

### 🚀 Key Features

#### 1. 🔄 1-Click Auto-Updates (Auto-Update Engine)
- **Background Checks**: Automatically checks for new versions on startup and every 4 hours via GitHub Releases.
- **Cyberpunk Prompt**: Displays a floating prompt with the formatted changelog, real-time download progress bar (MB, % and speed), and 1-click installation.
- **Dedicated Settings Tab**: Full update manager in Settings with manual check button and custom feed URL options.

#### 2. 🪟 Seamless Cross-Window Tab Dragging
- Freely move any tab between different open browser windows (e.g., YouTube, VK, docs) without creating duplicate windows.
- Full page state, URL, and navigation history are seamlessly preserved.

#### 3. 🛡️ Built-in Ad Blocker (Black hole Shield)
- **Network-Level Filtering**: Intercepts and blocks unwanted requests via `session.defaultSession.webRequest.onBeforeRequest` without third-party extensions.
- **Banners & Trackers Blocking**: Google Ads, DoubleClick, Yandex Direct, Yandex Metrika, AdFox, Mail.ru, Criteo, Taboola, Outbrain, betting sites, and trackers.
- **Universal Video Ad Auto-Skip (YouTube, Kodik, Alloha, VideoCDN, Rutube, etc.)**:
  - Instant forward seek of pre-rolls and mid-rolls.
  - Automatic clicking of "Skip" buttons with anti-spam debounce.
  - Anti-adblock and clickunder/popunder protection.
- **Quick Shield Controls**:
  - 🛡️ icon in the address bar with live blocked element count.
  - 1-click whitelist toggle for the current domain.

#### 4. 🧩 Google Chrome Extensions Support
- Full support for **Manifest V2** and **Manifest V3**.
- 1-click installation:
  - Directly from **Chrome Web Store**.
  - From **`.crx`** and **`.zip`** archives.
  - From unpacked extension folders (`manifest.json`).
  - Simple **Drag & Drop** into the Extensions Manager.
- Interactive toolbar with extension popup support.

#### 5. ⚡ Extreme Optimization & Memory Saver
- **Tab Hibernation**: Automatically unloads idle background tabs from RAM (freeing up to **80% RAM**). Audio tabs are protected from sleeping.
- **Game Booster (CPU Prioritization)**: Drops browser priority when games (Dota 2, CS2, etc.) are focused, dedicating 100% CPU/GPU resources to gaming while background music continues with 0% CPU overhead.
- **Hardware Acceleration**: Zero-copy tile rasterization and OOP GPU canvas rendering for smooth 60/120+ FPS.

#### 6. 📁 Tab Groups & Folders
- 8 cyber color schemes for custom tab folders.
- 1-click group collapse and expand.
- Drag-and-drop tab organization.

#### 7. 🔑 Password Manager
- Autofill and save prompts on login forms.
- Import from Chrome, Edge, Yandex Browser, Opera, CSV, and JSON.
- Export to CSV.

### 🕹 Hotkeys & Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + T` | Open new tab |
| `Ctrl + W` | Close current tab |
| `Ctrl + Shift + T` | Reopen closed tab |
| `Ctrl + R` / `F5` | Reload page |
| `Ctrl + Shift + R` | Hard reload (bypass cache) |
| `Ctrl + L` | Focus address bar |
| `Ctrl + D` | Bookmark / unbookmark page |
| `Ctrl + H` | Fullscreen History |
| `Ctrl + J` | Fullscreen Downloads |
| `Ctrl + B` | Bookmarks Manager |
| `Ctrl + Shift + B` | Toggle Bookmarks Bar |
| `Ctrl + F` | Find in page |
| `Ctrl + 1` .. `Ctrl + 9` | Switch to tab 1..9 |
| `Esc` | Close modal / search bar |

### 📦 Installation & Setup
- **Windows Installer**: Download `Black_Hole_Browser_Setup_v1.14.0.exe` from [Releases](https://github.com/Karasu287/Black-hole-browser-/releases).
- **Run from Source**:
```powershell
npm install
npm start
```

---

## 🇷🇺 Русское описание

### 🚀 Ключевые возможности

#### 1. 🔄 Автоматическое отслеживание обновлений в 1 клик
- Встроенный менеджер версий с регулярной фоновой проверкой через GitHub Releases.
- Киберпанк-уведомление с оформленным списком изменений (Changelog), полосой прогресса скачивания в реальном времени и автоматической установкой в 1 клик.
- Полноценная вкладка **«Обновления»** в настройках браузера.

#### 2. 🪟 Бесшовный перенос вкладок между окнами
- Свободный перенос вкладок между любыми открытыми окнами браузера без создания лишних окон-дубликатов.
- Полное сохранение истории навигации, состояния страниц и аудиопотоков.

#### 3. 🛡️ Встроенный блокировщик рекламы (Black hole Shield)
- Сетевой уровень фильтрации баннеров, трекеров, кликандеров и всплывающих окон.
- Автоматический пропуск рекламы в видеоплеерах (YouTube, Kodik, Alloha, Rutube и др.).
- Быстрое управление белым списком для сайтов в 1 клик.

#### 4. 🧩 Поддержка расширений Google Chrome
- Нативная поддержка стандартов **Manifest V2** и **Manifest V3**.
- Установка напрямую из Chrome Web Store или перетаскиванием файлов `.crx`, `.zip` и папок.

#### 5. ⚡ Игровой режим и экстремальная оптимизация
- **Game Booster**: автоматическое снижение приоритета браузера при запуске игр (Dota 2, CS2 и др.), отдавая 100% мощности процессора и видеокарты игре.
- **Tab Hibernation**: выгрузка неактивных вкладок из RAM (освобождение до 80% памяти).
- 0% CPU при воспроизведении фоновой музыки и аппаратное ускорение GPU.

#### 6. 📁 Папки и группировка вкладок (Tab Groups)
- 8 неоновых цветовых тем, сворачивание и разворачивание папок в один клик.

#### 7. 🔑 Менеджер паролей
- Автозаполнение, надежное локальное шифрование, импорт и экспорт.
