/**
 * Host-half tests for the MMSC workbench controller.
 *
 * The plugin is exercised through a fake Cordis context: routes registered via
 * `connection.fetch.register` are captured and called with real Requests, so
 * the supervisor (spawn / stop / status) runs for real against a temporary
 * config store. The workbench server itself is covered by its own tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.resolve(here, '..');
const pluginDir = path.join(root, 'dsh-plugin', 'mmsc-workbench');

/** Minimal Cordis stand-in: records route handlers and effects. */
function makeContext() {
  const routes = new Map();
  const disposers = [];
  const ctx = {
    effect(factory) {
      const dispose = factory();
      // Real Cordis rejects an effect whose factory does not return a disposer,
      // which aborts the whole load. Mirror that so the mistake cannot come back.
      if (typeof dispose !== 'function') {
        throw new TypeError('effect factory must return a disposer');
      }
      disposers.push(dispose);
      return dispose;
    },
    inject(_names, callback) {
      callback(ctx);
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      },
    },
    routes,
    disposeAll() {
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
  return ctx;
}

async function boot({ home } = {}) {
  const previous = process.env.DSH_HOME;
  if (home) process.env.DSH_HOME = home;
  const ctx = makeContext();
  const module = await import(`${new URL(`file:///${pluginDir.replace(/\\/g, '/')}/index.js`).href}?t=${Date.now()}-${Math.random()}`);
  module.apply(ctx);
  const call = async (route, payload) => {
    const handler = ctx.routes.get(`/api/mmsc/${route}`);
    assert.ok(handler, `route ${route} registered`);
    const request = new Request(`http://127.0.0.1/api/mmsc/${route}`, {
      method: handler.methods?.includes('POST') ? 'POST' : 'GET',
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    });
    const response = await handler.fetch(request);
    return { status: response.status, body: await response.json() };
  };
  return { ctx, call, restore: () => (process.env.DSH_HOME = previous) };
}

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mmsc-home-'));

test('apply registers every route the settings panel calls', async () => {
  const home = tempHome();
  const { ctx, restore } = await boot({ home });
  try {
    const expected = ['ping', 'status', 'config', 'start', 'stop', 'restart', 'open'];
    for (const name of expected) {
      assert.ok(ctx.routes.has(`/api/mmsc/${name}`), `route ${name} registered`);
    }
  } finally {
    ctx.disposeAll();
    restore();
  }
});

test('status route describes config, repo and service before anything is started', async () => {
  const home = tempHome();
  const { call, restore, ctx } = await boot({ home });
  try {
    const { status, body } = await call('status');
    assert.equal(status, 200);
    assert.equal(body.service.status, 'stopped');
    assert.equal(body.config.port, 5599);
    assert.equal(body.repo.exists, true, 'repo root resolves from the plugin directory');
    assert.equal(body.repo.bin.endsWith('kjsftb.mjs'), true);
    assert.match(body.api.base, /^\/api\/mmsc$/);
    assert.deepEqual(fs.readdirSync(home), [], 'reading status must not write the store');
  } finally {
    ctx.disposeAll();
    restore();
  }
});

test('config route persists a sanitized port and pack directory', async () => {
  const home = tempHome();
  const { call, restore, ctx } = await boot({ home });
  try {
    const { body } = await call('config', { port: 70000, packDir: 'D:\\packs\\demo', autoOpen: false });
    assert.equal(body.config.port, 5599, 'out-of-range port falls back to the default');
    assert.equal(body.config.packDir, 'D:\\packs\\demo');
    assert.equal(body.config.autoOpen, false);

    const stored = JSON.parse(fs.readFileSync(path.join(home, 'mmsc-workbench.json'), 'utf8'));
    assert.equal(stored.packDir, 'D:\\packs\\demo');

    const second = await call('config', { port: 6123 });
    assert.equal(second.body.config.port, 6123);
    assert.equal(second.body.config.packDir, 'D:\\packs\\demo', 'fields merge instead of resetting');
  } finally {
    ctx.disposeAll();
    restore();
  }
});

test('start reports a running workbench with a URL and stop releases it', async () => {
  const home = tempHome();
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'mmsc-pack-'));
  fs.mkdirSync(path.join(pack, 'mods'), { recursive: true });
  const { call, restore, ctx } = await boot({ home });
  try {
    await call('config', { packDir: pack, port: 5633 });
    const started = await call('start', {});
    assert.equal(started.status, 200);
    assert.equal(started.body.result.ok ?? true, true);

    // The child prints "kjsftb workbench: <url>" once it is listening.
    const deadline = Date.now() + 20000;
    let body = started.body;
    while (Date.now() < deadline && body.service.status !== 'running') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      body = (await call('status')).body;
    }
    assert.equal(body.service.status, 'running', `workbench did not come up: ${body.service.log}`);
    assert.match(body.service.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(body.service.pid > 0);

    const fetched = await fetch(`${body.service.url}/api/v1/version`);
    assert.equal(fetched.status, 200);
    const version = await fetched.json();
    assert.equal(version.name, 'kjsftb-workbench');
    assert.equal(version.apiVersion, 'v1');

    const stopped = await call('stop', {});
    assert.equal(stopped.body.service.status, 'stopped');
    assert.equal(stopped.body.service.pid, null);
    await assert.rejects(fetch(`${body.service.url}/api/v1/version`, { signal: AbortSignal.timeout(1500) }));
  } finally {
    ctx.disposeAll();
    restore();
  }
});

test('restart keeps the port and returns a fresh pid', async () => {
  const home = tempHome();
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'mmsc-pack-'));
  const { call, restore, ctx } = await boot({ home });
  try {
    await call('config', { packDir: pack, port: 5634 });
    const first = await call('start', {});
    const waitRunning = async () => {
      const deadline = Date.now() + 20000;
      let body = first.body;
      while (Date.now() < deadline && body.service.status !== 'running') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        body = (await call('status')).body;
      }
      return body;
    };
    const running = await waitRunning();
    assert.equal(running.service.status, 'running');

    const restarted = await call('restart', {});
    assert.equal(restarted.status, 200);
    const deadline = Date.now() + 20000;
    let after = restarted.body;
    while (Date.now() < deadline && after.service.status !== 'running') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      after = (await call('status')).body;
    }
    assert.equal(after.service.status, 'running', after.service.log);
    assert.notEqual(after.service.pid, running.service.pid, 'restart must replace the child');
    assert.equal(new URL(after.service.url).port, '5634', 'restart keeps the configured port');
  } finally {
    ctx.disposeAll();
    restore();
  }
});
