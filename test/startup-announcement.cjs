"use strict";
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const expected = [
  '[AdvantageAir] Native Advantage Air v4 is available as a separate Homebridge plugin!',
  '[AdvantageAir] Package: homebridge-advantageair',
  '[AdvantageAir] Your existing v3 setup is unaffected; migration is optional and manual.',
  '[AdvantageAir] Compatibility and migration guide: ' +
    'https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/v3-migration.md',
];
const formatted = expected.map(message => '\u001b[94m' + message + '\u001b[39m');
function run(code, colour = '0') {
  const env = { ...process.env, FORCE_COLOR: colour };
  delete env.NO_COLOR;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root, encoding: 'utf8', env, timeout: 15000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout;
}
const setup = `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  import { EventEmitter } from 'node:events';
  const require = createRequire(process.cwd() + '/package.json');
  const expected = ${JSON.stringify(formatted)};
  const messages = [];
  console.info = message => messages.push(message);
  const api = new EventEmitter();
  const registrations = [];
  api.registerPlatform = (...args) => registrations.push(args);
  const initialise = () => require('./index.js').default(api);
`;
// Controlled clock in each disposable child process; no real 30-second waits.
const clock = `
  let now = 0;
  const timers = new Map();
  const handles = [];
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 30000);
    const handle = { referenced: true, unref() { this.referenced = false; } };
    handles.push(handle);
    timers.set(handle, { callback, due: now + delay });
    return handle;
  };
  globalThis.clearTimeout = handle => timers.delete(handle);
  const tick = ms => {
    now += ms;
    for (const [handle, timer] of timers) {
      if (timer.due <= now) { timers.delete(handle); timer.callback(); }
    }
  };
`;

test('Cmd4-only loading waits for launch then exactly 30 seconds, with exact wording', () => {
  run(setup + clock + `
    initialise();
    assert.equal(registrations[0][0], 'cmd4AdvantageAir');
    assert.equal(typeof registrations[0][1], 'function');
    assert.equal(timers.size, 0);
    tick(60000);
    assert.deepEqual(messages, []);
    api.emit('didFinishLaunching');
    assert.equal(timers.size, 1);
    assert.equal(handles[0].referenced, false);
    tick(29999);
    assert.deepEqual(messages, []);
    tick(1);
    assert.deepEqual(messages, expected);
    assert.equal(timers.size, 0);
    assert.equal(api.listenerCount('didFinishLaunching'), 0);
    assert.equal(api.listenerCount('shutdown'), 0);
  `);
});

test('reinitialisation, module reload, repeated launch and constructors cannot duplicate notice', () => {
  run(setup + clock + `
    for (let i = 0; i < 10; i++) initialise();
    delete require.cache[require.resolve('./index.js')];
    initialise();
    assert.equal(registrations.length, 11);
    assert.equal(api.listenerCount('didFinishLaunching'), 1);
    assert.equal(api.listenerCount('shutdown'), 1);
    const Platform = registrations[0][1];
    for (let i = 0; i < 10; i++) {
      const config = { name: 'Controller ' + i };
      const instance = new Platform({ debug() {} }, config, api);
      assert.equal(instance.config, config);
      assert.equal(instance.api, api);
    }
    assert.deepEqual(messages, []);
    for (let i = 0; i < 10; i++) api.emit('didFinishLaunching');
    assert.equal(handles.length, 1);
    tick(30000);
    delete require.cache[require.resolve('./index.js')];
    initialise();
    api.emit('didFinishLaunching');
    api.emit('shutdown');
    tick(60000);
    assert.deepEqual(messages, expected);
    assert.equal(handles.length, 1);
  `);
});

test('shutdown before or after launch cancels notice and removes lifecycle listeners', () => {
  for (const launch of [false, true]) {
    run(setup + clock + `
      initialise();
      if (${launch}) { api.emit('didFinishLaunching'); tick(29999); }
      api.emit('shutdown');
      initialise();
      api.emit('didFinishLaunching');
      tick(60000);
      assert.deepEqual(messages, []);
      assert.equal(timers.size, 0);
      assert.equal(api.listenerCount('didFinishLaunching'), 0);
      assert.equal(api.listenerCount('shutdown'), 0);
    `);
  }
});

test('missing lifecycle API is non-disruptive; real unreferenced timer permits process exit', () => {
  run(setup + `
    require('./index.js').default({ registerPlatform: api.registerPlatform });
    assert.equal(registrations.length, 1);
    assert.deepEqual(messages, []);
    initialise();
    api.emit('didFinishLaunching');
  `);
});

test('separate processes each receive one group of four consistently prefixed lines', () => {
  for (let i = 0; i < 2; i++) {
    const output = run(setup + clock + `
      initialise(); api.emit('didFinishLaunching'); tick(30000);
      assert.deepEqual(messages, expected);
      for (const message of messages) console.log(message);
    `);
    assert.deepEqual(output.trim().split(/\r?\n/), formatted);
  }
});

test('private Bright Blue notice ignores detection without changing shared Chalk or unrelated logs', () => {
  for (const colour of ['0', '1']) {
    run(setup + clock + `
      const sharedChalk = require('chalk');
      const originalLevel = sharedChalk.level;
      const unrelated = sharedChalk.green('Other plugin output');
      console.info('Unrelated before');
      initialise(); api.emit('didFinishLaunching'); tick(30000);
      console.info('Unrelated after');
      assert.equal(sharedChalk.level, originalLevel);
      assert.equal(sharedChalk.green('Other plugin output'), unrelated);
      assert.deepEqual(messages, ['Unrelated before', ...expected, 'Unrelated after']);
      const esc = String.fromCharCode(27);
      const plain = messages.slice(1, 5).map(message =>
        message.replaceAll(esc + '[94m', '').replaceAll(esc + '[39m', ''));
      assert.deepEqual(plain, ${JSON.stringify(expected)});
    `, colour);
  }
});

test('legacy package and lock versions remain consistent', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.equal(manifest.name, 'homebridge-cmd4-advantageair');
  assert.equal(manifest.version, '3.12.4');
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
});

// Actual loader/API only: no bridge server, pairing, storage or controller.
test('actual Homebridge loader registers without constructing platform; launch and shutdown work', {
  skip: !process.env.AA_TEST_HOMEBRIDGE_DIST,
}, () => {
  for (const shutdown of [false, true]) {
    run(`
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import { pathToFileURL } from 'node:url';
      const dist = process.env.AA_TEST_HOMEBRIDGE_DIST;
      const { Plugin } = await import(pathToFileURL(path.join(dist, 'plugin.js')));
      const { HomebridgeAPI } = await import(pathToFileURL(path.join(dist, 'api.js')));
      const manifest = JSON.parse(fs.readFileSync('package.json'));
      const plugin = new Plugin(manifest.name, process.cwd(), manifest);
      const api = new HomebridgeAPI();
      api.on('registerPlatform', (name, constructor) => plugin.registerPlatform(name, constructor));
      await plugin.load();
      const messages = [];
      console.info = message => messages.push(message);
      ${clock}
      await plugin.initialize(api);
      assert.equal(typeof plugin.getPlatformConstructor('cmd4AdvantageAir'), 'function');
      assert.equal(timers.size, 0);
      assert.deepEqual(messages, []);
      api.signalFinished();
      api.signalFinished();
      assert.equal(handles.length, 1);
      assert.equal(handles[0].referenced, false);
      tick(29999);
      assert.deepEqual(messages, []);
      if (${shutdown}) api.signalShutdown();
      tick(1);
      assert.deepEqual(messages, ${shutdown ? '[]' : JSON.stringify(formatted)});
      assert.equal(timers.size, 0);
      assert.equal(api.listenerCount('didFinishLaunching'), 0);
      assert.equal(api.listenerCount('shutdown'), 0);
    `);
  }
});
