'use strict';
// Minimal Electron stub for headless checks of the main process.
const os = require('os');
const path = require('path');
const fs = require('fs');

const handlers = {};
const clipboardState = { text: '' };
const userData = path.join(os.tmpdir(), 'notijira-check-userdata');

// Atajos globales: se puede forzar que un registro falle para comprobar que el
// anterior se conserva (S7). `__shortcuts` expone el estado a las comprobaciones.
const shortcutState = {
  registered: new Set(),
  callbacks: {},
  failure: null,
  isRegistered: (accelerator) => shortcutState.registered.has(accelerator),
  unregisterAll: () => {
    shortcutState.registered.clear();
    shortcutState.callbacks = {};
  },
};
const globalShortcut = {
  register: (accelerator, callback) => {
    if (shortcutState.failure === accelerator) return false;
    shortcutState.registered.add(accelerator);
    shortcutState.callbacks[accelerator] = callback;
    return true;
  },
  unregister: (accelerator) => {
    shortcutState.registered.delete(accelerator);
    delete shortcutState.callbacks[accelerator];
  },
  unregisterAll: shortcutState.unregisterAll,
  isRegistered: shortcutState.isRegistered,
};

const noop = () => {};
const appListeners = {};
const app = {
  commandLine: { appendSwitch: noop },
  isPackaged: false,
  getName: () => 'NotiJira',
  getVersion: () => '0.0.0-test',
  setAppUserModelId: noop,
  getPath: () => userData,
  whenReady: () => new Promise(() => {}),
  on: (type, handler) => {
    (appListeners[type] = appListeners[type] || []).push(handler);
  },
  quit: noop,
  setLoginItemSettings: (options) => {
    loginCalls.push(options);
  },
  requestSingleInstanceLock: () => true,
};
class Notification {
  constructor() {}
  static isSupported() { return false; }
  on() { return this; }
  show() { return false; }
}
// Ventanas suficientes para la ventana de captura: visibilidad, posicion y el
// canal capture:shown.
const windows = [];
class BrowserWindow {
  constructor(options) {
    this.options = options || {};
    this.visible = false;
    this.destroyed = false;
    this.listeners = {};
    this.sent = [];
    this.webContents = {
      isLoading: () => false,
      send: (channel, payload) => {
        this.sent.push({ channel, payload });
      },
    };
    windows.push(this);
  }
  static getAllWindows() {
    return windows.filter((win) => !win.destroyed);
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  isMinimized() {
    return false;
  }
  restore() {}
  getSize() {
    return [520, 620];
  }
  setPosition() {}
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  focus() {}
  loadFile() {
    return Promise.resolve();
  }
  on(type, handler) {
    this.listeners[type] = handler;
  }
  close() {
    this.destroyed = true;
    this.visible = false;
    if (this.listeners.closed) this.listeners.closed();
  }
}
const trayState = { created: false, toolTip: '', menu: null, listeners: {} };
const loginCalls = [];
class Tray {
  constructor() {
    trayState.created = true;
  }
  setToolTip(text) { trayState.toolTip = text; }
  setContextMenu(menu) { trayState.menu = menu; }
  on(type, handler) { trayState.listeners[type] = handler; }
}
module.exports = {
  app,
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on: noop },
  shell: {
    openExternal: async () => true,
    openPath: async () => '',
  },
  Notification,
  clipboard: {
    writeText: (t) => { clipboardState.text = t; },
    readText: () => clipboardState.text,
  },
  globalShortcut,
  Tray,
  Menu: { buildFromTemplate: (items) => items },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  BrowserWindow,
  __handlers: handlers,
  __getClipboard: () => clipboardState.text,
  __shortcuts: shortcutState,
  __tray: trayState,
  __loginCalls: loginCalls,
  __windows: windows,
  __appListeners: appListeners,
  __fire: (type, ...args) => {
    const queued = appListeners[type] || [];
    queued.forEach((handler) => handler(...args));
    return queued.length;
  },
  __setShortcutFailure: (accelerator) => { shortcutState.failure = accelerator || null; },
  __userData: userData,
  __reset: () => {
    clipboardState.text = '';
    shortcutState.failure = null;
    loginCalls.length = 0;
    fs.rmSync(userData, { recursive: true, force: true });
  },
};
