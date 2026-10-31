'use strict';
// Minimal Electron stub for headless checks of the main process.
const os = require('os');
const path = require('path');
const fs = require('fs');

const handlers = {};
const clipboardState = { text: '' };
const userData = path.join(os.tmpdir(), 'notijira-check-userdata');

const noop = () => {};
const app = {
  commandLine: { appendSwitch: noop },
  isPackaged: false,
  getName: () => 'NotiJira',
  getVersion: () => '0.0.0-test',
  setAppUserModelId: noop,
  getPath: () => userData,
  whenReady: () => new Promise(() => {}),
  on: noop,
  quit: noop,
};
class Notification {
  constructor() {}
  static isSupported() { return false; }
  on() { return this; }
  show() { return false; }
}
class BrowserWindow {
  constructor() {}
  static getAllWindows() { return []; }
}
module.exports = {
  app,
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on: noop },
  shell: { openExternal: async () => true },
  Notification,
  clipboard: {
    writeText: (t) => { clipboardState.text = t; },
    readText: () => clipboardState.text,
  },
  BrowserWindow,
  __handlers: handlers,
  __getClipboard: () => clipboardState.text,
  __userData: userData,
  __reset: () => {
    clipboardState.text = '';
    fs.rmSync(userData, { recursive: true, force: true });
  },
};
