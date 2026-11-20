'use strict';
// Minimal DOM/IPC harness so the real renderer/renderer.js can be driven
// headlessly. It only stubs what the copy flow touches: element lookups,
// classList, listeners and window.api.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Elements that start with the `hidden` class in renderer/index.html, so the
// checks observe the same initial state as the running app.
const INITIALLY_HIDDEN = new Set([
  'modal',
  'searchModal',
  'copyModal',
  'gitlabSelection',
  'copyAttachmentsNote',
  'searchResults',
  'statusBar',
]);

function makeElement(id, tag) {
  const el = {
    id: id || '',
    tagName: (tag || 'div').toUpperCase(),
    type: '',
    value: '',
    textContent: '',
    className: '',
    checked: false,
    disabled: false,
    dataset: {},
    children: [],
    listeners: {},
    _classes: new Set(),
    _html: '',
  };
  if (INITIALLY_HIDDEN.has(el.id)) el._classes.add('hidden');

  el.classList = {
    add: (...names) => names.forEach((name) => el._classes.add(name)),
    remove: (...names) => names.forEach((name) => el._classes.delete(name)),
    contains: (name) => el._classes.has(name),
    toggle: (name, force) => {
      const on = force === undefined ? !el._classes.has(name) : !!force;
      if (on) el._classes.add(name);
      else el._classes.delete(name);
      return on;
    },
  };

  Object.defineProperty(el, 'className', {
    get: () => Array.from(el._classes).join(' '),
    set: (value) => {
      el._classes.clear();
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => el._classes.add(name));
    },
  });

  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html,
    set: (value) => {
      el._html = value;
      if (value === '') el.children = [];
    },
  });

  el.appendChild = (child) => {
    el.children.push(child);
    return child;
  };
  el.addEventListener = (type, handler) => {
    (el.listeners[type] = el.listeners[type] || []).push(handler);
  };
  el.dispatch = (type, event) => {
    const queued = el.listeners[type] || [];
    queued.forEach((handler) => handler(event || { preventDefault: () => {}, target: el }));
    return queued.length;
  };
  el.focus = () => {};
  el.setAttribute = (name, value) => {
    el[name] = String(value);
  };
  el.getAttribute = (name) => el[name];
  el.querySelector = () => makeElement(`${el.id}-child`, 'span');
  el.optionTexts = () =>
    el.children.map((child) => child.textContent).filter((text) => text !== '');

  return el;
}

// Fake clock so the renderer's debounce timers are driven by the checks, never
// by wall time. Advancing also flushes promise callbacks.
function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    async advance(ms) {
      const target = now + Math.max(0, Number(ms) || 0);
      for (let guard = 0; guard < 200; guard++) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, timer] = due[0];
        timers.delete(id);
        now = Math.max(now, timer.at);
        timer.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = Math.max(now, target);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

// Mirrors preload.js; every entry is recorded so tests can assert on calls.
function createHarness(options = {}) {
  const clock = createClock();
  const apiResults = Object.assign(
    {
      getConfig: { baseUrl: 'https://jira.example', apiToken: 'jira-token' },
      saveConfig: { ok: true },
      testConnection: { ok: true, displayName: 'Ana' },
      getNotifications: { ok: true, notifications: [] },
      searchIssues: {
        ok: true,
        results: [
          {
            key: 'AAA-1',
            summary: 'Tarea de prueba',
            status: 'Abierta',
            issuetype: 'Tarea',
            updated: '2026-11-01T10:00:00.000Z',
            webUrl: 'https://jira.example/browse/AAA-1',
          },
        ],
      },
      getIssueCopyData: {
        ok: true,
        issue: { key: 'AAA-1', summary: 'Tarea', url: 'https://jira.example/browse/AAA-1' },
        sections: [{ id: 'customfield_10090', label: 'Entrada', empty: false, preview: '' }],
        comments: [],
        attachments: [],
      },
      getGitlabProjects: { ok: true, projects: [{ id: 41, pathWithNamespace: 'equipo/notijira' }] },
      getGitlabBranches: {
        ok: true,
        branches: [{ name: 'main' }, { name: 'feature/mr' }],
      },
      copyIssue: { ok: true, sections: 1, comments: 0, attachments: 0, folder: '' },
      openExternal: true,
      notify: true,
    },
    options.apiResults || {}
  );

  const calls = [];
  const elements = new Map();
  const api = {};
  for (const name of Object.keys(apiResults)) {
    api[name] = (...args) => {
      calls.push({ name, args });
      const value = apiResults[name];
      return typeof value === 'function' ? value(...args) : Promise.resolve(value);
    };
  }

  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement: (tag) => makeElement('', tag),
    querySelectorAll: () => [],
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  };

  const context = {
    document,
    localStorage,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    JSON,
    Date,
    Math,
    Set,
    Map,
    URL,
    String,
    Number,
    Object,
    Array,
    Boolean,
    Error,
    RegExp,
  };
  context.window = { api, AudioContext: undefined, webkitAudioContext: undefined };

  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'renderer', 'renderer.js'),
    'utf8'
  );
  vm.runInNewContext(source, context, { filename: 'renderer.js' });

  return {
    api,
    calls,
    context,
    advance: clock.advance,
    el: (id) => document.getElementById(id),
    isHidden: (id) => document.getElementById(id).classList.contains('hidden'),
  };
}

module.exports = { createHarness, makeElement };
