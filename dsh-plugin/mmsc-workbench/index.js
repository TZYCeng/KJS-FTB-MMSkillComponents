/**
 * Host half of the MMSC workbench controller.
 *
 * This plugin does not implement the workbench itself: it owns the settings
 * section "魔改工作台", persists the port / pack directory, and supervises the
 * `kjsftb ui` child process (start, stop, restart, open in browser). The
 * workbench is a separate zero-dependency server, which keeps the two halves
 * loosely coupled and lets the browser UI be replaced without touching DSH.
 *
 * DSH-only: the browser half (client.js) renders inside the DeepSeek Harness
 * Web UI settings dialog. A non-DSH host must not load `./client` — it would
 * fail on the missing `window.__ModuleLoader__` bridge.
 *
 * @module index.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Same-origin route prefix; the client resolves it against document.baseURI. */
const API = '/api/mmsc';
/** Package directory: the repository keeps this plugin at dsh-plugin/mmsc-workbench. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Settings namespace and loader row id. */
const ENTRY = 'mmsc-workbench';

const DEFAULTS = {
  port: 5599,
  packDir: '',
  autoOpen: true,
  repoPath: '',
};

/** `$DSH_HOME/mmsc-workbench.json`; the profile patch layer is not a store. */
function storeFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'mmsc-workbench.json');
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return sanitize({ ...DEFAULTS, ...parsed });
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(config) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(temp, file);
}

/** Drop values the supervisor cannot use instead of trusting the file. */
function sanitize(input) {
  const port = Number(input.port);
  return {
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULTS.port,
    packDir: typeof input.packDir === 'string' ? input.packDir : '',
    autoOpen: input.autoOpen !== false,
    repoPath: typeof input.repoPath === 'string' ? input.repoPath : '',
  };
}

/** Repository root candidates, most specific first. */
function repoCandidates(config) {
  return [
    config.repoPath,
    process.env.MMSC_REPO,
    path.resolve(HERE, '..', '..'),
    'D:\\code\\KJS-FTB-MMSkillComponents',
    path.join(os.homedir(), 'KJS-FTB-MMSkillComponents'),
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

function resolveRepo(config) {
  for (const candidate of new Set(repoCandidates(config))) {
    const bin = path.join(candidate, 'bin', 'kjsftb.mjs');
    if (fs.existsSync(bin)) return { path: candidate, bin, exists: true };
  }
  const fallback = path.resolve(HERE, '..', '..');
  return { path: fallback, bin: path.join(fallback, 'bin', 'kjsftb.mjs'), exists: false };
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Supervises exactly one child: the workbench HTTP server. */
function createSupervisor() {
  let child = null;
  let status = 'stopped';
  let url = null;
  let startedAt = null;
  let lastError = null;
  let log = '';
  let lastConfig = { ...DEFAULTS };

  const append = (chunk) => {
    log = `${log}${chunk}`.slice(-4000);
  };

  function snapshot() {
    return {
      status,
      pid: child?.pid ?? null,
      url,
      startedAt,
      lastError,
      log: log.trim(),
    };
  }

  async function stop() {
    const running = child;
    child = null;
    status = 'stopped';
    url = null;
    startedAt = null;
    if (!running) return snapshot();
    try {
      running.kill();
    } catch {
      // already gone
    }
    // Give the child a moment to release the port before a restart binds it.
    await new Promise((resolve) => setTimeout(resolve, 350));
    return snapshot();
  }

  function start(config) {
    if (child) return { ok: false, error: 'workbench is already running', ...snapshot() };
    lastConfig = sanitize({ ...lastConfig, ...config });
    const repo = resolveRepo(lastConfig);
    if (!repo.exists) {
      status = 'error';
      lastError = `kjsftb not found at ${repo.bin}`;
      return { ok: false, error: lastError, ...snapshot() };
    }
    const args = [repo.bin, 'ui'];
    if (lastConfig.packDir) args.push(lastConfig.packDir);
    args.push('--port', String(lastConfig.port), '--no-open');

    lastError = null;
    log = '';
    status = 'starting';
    try {
      child = spawn(process.execPath, args, {
        cwd: repo.path,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      status = 'error';
      lastError = String(error?.message ?? error);
      return { ok: false, error: lastError, ...snapshot() };
    }

    startedAt = Date.now();
    const current = child;
    current.stdout?.setEncoding('utf8');
    current.stderr?.setEncoding('utf8');
    current.stdout?.on('data', (chunk) => {
      append(chunk);
      const match = /kjsftb workbench:\s*(\S+)/.exec(String(chunk));
      if (match) {
        url = match[1];
        status = 'running';
      }
    });
    current.stderr?.on('data', append);
    current.on('error', (error) => {
      status = 'error';
      lastError = String(error?.message ?? error);
    });
    current.on('exit', (code) => {
      if (child === current) {
        child = null;
        url = null;
        if (status !== 'stopped') {
          status = code === 0 ? 'stopped' : 'error';
          if (code !== 0) lastError = lastError ?? `workbench exited with code ${code}`;
        }
      }
    });
    return { ok: true, ...snapshot() };
  }

  async function restart(config) {
    await stop();
    return start(config);
  }

  return {
    snapshot,
    config: () => lastConfig,
    start,
    stop,
    restart,
    get running() {
      return Boolean(child);
    },
  };
}

function openInBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

export function apply(ctx) {
  const supervisor = createSupervisor();
  let config = readConfig();

  const describe = () => {
    const repo = resolveRepo(config);
    const service = supervisor.snapshot();
    return {
      config,
      repo: { path: repo.path, bin: repo.bin, exists: repo.exists },
      service: {
        ...service,
        url: service.url ?? (service.status === 'running' ? `http://127.0.0.1:${config.port}` : null),
      },
      api: { base: API, version: 'v1', workbench: `${API}/status` },
      dsh: { home: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), entry: ENTRY },
    };
  };

  const saveConfig = (patch) => {
    const next = sanitize({ ...config, ...patch });
    writeConfig(next);
    const portChanged = next.port !== config.port;
    const repoChanged = next.repoPath !== config.repoPath;
    config = next;
    return { portChanged, repoChanged };
  };

  // Register directly, the way dsh-model-visibility does: wrapping ctx.inject
  // in ctx.effect makes the effect factory return `undefined`, which aborts the
  // row before any route exists.
  ctx.inject(['connection'], (scope) => {
        const register = (route) =>
          scope.effect(
            () => scope.connection.fetch.register(route),
            `mmsc-workbench: ${route.path}`,
          );

        /** Read a JSON body, tolerating an absent one. */
        const body = async (request) => {
          try {
            const text = await request.text();
            return text ? JSON.parse(text) : {};
          } catch {
            return {};
          }
        };

        // Diagnostic route: answers without touching config, repo scan or the
        // child process, so the settings page can distinguish "route not
        // reachable" from "status handler failed".
        register({
          path: `${API}/ping`,
          methods: ['GET'],
          async fetch() {
            return json({ ok: true, entry: ENTRY, pid: process.pid, api: API });
          },
        });

        register({
          path: `${API}/status`,
          methods: ['GET'],
          async fetch() {
            return json(describe());
          },
        });

        register({
          path: `${API}/config`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const patch = await body(request);
            const changes = saveConfig(patch);
            const report = { ok: true, changes, ...describe() };
            if (supervisor.running && (changes.portChanged || changes.repoChanged)) {
              await supervisor.restart(config);
              Object.assign(report, describe(), { restarted: true });
            }
            return json(report);
          },
        });

        register({
          path: `${API}/start`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const patch = await body(request);
            if (Object.keys(patch).length > 0) saveConfig(patch);
            const result = supervisor.running ? supervisor.snapshot() : supervisor.start(config);
            return json({ ok: true, result, ...describe() });
          },
        });

        register({
          path: `${API}/stop`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch() {
            await supervisor.stop();
            return json({ ok: true, ...describe() });
          },
        });

        register({
          path: `${API}/restart`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const patch = await body(request);
            if (Object.keys(patch).length > 0) saveConfig(patch);
            const result = await supervisor.restart(config);
            return json({ ok: true, result, ...describe() });
          },
        });

        register({
          path: `${API}/open`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch() {
            const service = supervisor.snapshot();
            const target = service.url ?? `http://127.0.0.1:${config.port}`;
            const opened = openInBrowser(target);
            return json({ ok: opened, url: target, ...describe() });
          },
        });
  });

  // Never leave an orphaned server behind when the plugin is unloaded.
  ctx.effect(() => () => void supervisor.stop(), 'mmsc-workbench: shutdown');
}

export const inject = ['connection'];
export const dshOnly = true;
