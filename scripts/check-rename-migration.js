'use strict';
// Comprueba que el renombrado a desTajo no pierda los datos de la version
// anterior: Electron deriva la carpeta de usuario del nombre de la app, asi que
// el primer arranque copia configuracion, incidencias y copias desde NotiJira.
// Run with: npm run check:rename   (node + assert, no test framework).
const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const stubPath = path.join(__dirname, 'test-support', 'electron-stub.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return stubPath;
  return origResolve.call(this, request, parent, ...rest);
};

const stub = require(stubPath);
const mainPath = path.join(REPO, 'main.js');
const bugId = 'b-20260101000000-abcd';

const userData = () => stub.__paths.userData;
const appData = () => stub.__paths.appData;
const legacyPackaged = () => path.join(appData(), 'NotiJira');
const legacyDev = () => path.join(appData(), 'notijira');
const marker = () => path.join(userData(), '.renamed-from-notijira');

function reset() {
  fs.rmSync(userData(), { recursive: true, force: true });
  fs.rmSync(appData(), { recursive: true, force: true });
}

function seedLegacy(dir, withConfig = true) {
  fs.mkdirSync(path.join(dir, 'bugs', bugId), { recursive: true });
  fs.mkdirSync(path.join(dir, 'copied', 'AAA-1'), { recursive: true });
  if (withConfig) {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ baseUrl: 'https://jira.example', apiToken: 'tok' }),
      'utf-8'
    );
  }
  fs.writeFileSync(
    path.join(dir, 'bugs', bugId, 'nota.json'),
    JSON.stringify({ id: bugId, title: 'Vieja' }),
    'utf-8'
  );
  fs.writeFileSync(path.join(dir, 'copied', 'AAA-1', 'nota.md'), '# viejo', 'utf-8');
}

function loadMain() {
  delete require.cache[require.resolve(mainPath)];
  require(mainPath);
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

// Arranque de la version anterior: carpeta empaquetada con configuracion.
reset();
seedLegacy(legacyPackaged());
loadMain();

check('R1 la configuracion anterior se copia a la carpeta nueva', () => {
  const copied = path.join(userData(), 'config.json');
  assert.equal(fs.existsSync(copied), true, 'no hay config.json en la carpeta nueva');
  assert.equal(JSON.parse(fs.readFileSync(copied, 'utf-8')).apiToken, 'tok');
});

check('R2 las incidencias capturadas sobreviven al renombrado', () => {
  assert.equal(
    fs.existsSync(path.join(userData(), 'bugs', bugId, 'nota.json')),
    true
  );
});

check('R3 las copias descargadas sobreviven al renombrado', () => {
  assert.equal(
    fs.existsSync(path.join(userData(), 'copied', 'AAA-1', 'nota.md')),
    true
  );
});

check('R4 la carpeta anterior queda intacta: se copia, no se mueve', () => {
  assert.equal(fs.existsSync(path.join(legacyPackaged(), 'config.json')), true);
  assert.equal(
    fs.existsSync(path.join(legacyPackaged(), 'bugs', bugId, 'nota.json')),
    true
  );
});

check('R5 una configuracion ya existente no se sobrescribe', () => {
  fs.rmSync(marker(), { force: true });
  fs.writeFileSync(
    path.join(userData(), 'config.json'),
    JSON.stringify({ apiToken: 'nuevo' }),
    'utf-8'
  );
  loadMain();
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(userData(), 'config.json'), 'utf-8'))
      .apiToken,
    'nuevo'
  );
});

check('R6 sin configuracion anterior tambien se copian las incidencias', () => {
  reset();
  seedLegacy(legacyPackaged(), false);
  loadMain();
  assert.equal(
    fs.existsSync(path.join(userData(), 'bugs', bugId, 'nota.json')),
    true
  );
  assert.equal(fs.existsSync(marker()), true, 'falta la marca de migracion');
});

check('R7 la carpeta de desarrollo en minusculas tambien migra', () => {
  reset();
  seedLegacy(legacyDev());
  loadMain();
  assert.equal(fs.existsSync(path.join(userData(), 'config.json')), true);
});

let failed = 0;
for (const item of checks) {
  try {
    item.fn();
    console.log('  ok  - ' + item.name);
  } catch (err) {
    failed += 1;
    console.error('  FAIL - ' + item.name + ': ' + err.message);
  }
}
console.log(`RENAME CHECKS: ${checks.length - failed}/${checks.length}`);
process.exitCode = failed ? 1 : 0;
