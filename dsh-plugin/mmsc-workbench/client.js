/**
 * Browser half of the MMSC workbench controller — DSH ONLY.
 *
 * This file is loaded exclusively by the DeepSeek Harness web client through
 * `window.__ModuleLoader__`; it registers Settings → 魔改工作台. It has no
 * meaning outside DSH: a non-DSH host (or a plain browser) must not load it,
 * because the loader bridge and the `settings.section` slot only exist there.
 * The guard below keeps such a host harmless instead of throwing.
 *
 * The page only talks to this plugin's own host routes (/api/mmsc/*), which
 * supervise the separate `kjsftb ui` server. Nothing here renders or proxies
 * the workbench UI itself.
 */
(function () {
  const loader = typeof window === 'undefined' ? undefined : window.__ModuleLoader__;
  if (!loader || typeof loader.load !== 'function') return;

  loader.load({
    id: '@tzyc/mmsc-workbench',
    factory(require) {
      const React = require('react');
      const h = React.createElement;

      /** Host entry id from cordis.patch.yml. */
      const ENTRY = 'mmsc-workbench';
      /** Settings section id (also the settings navigation key). */
      const SECTION_ID = 'mmsc-workbench';
      /** Same-origin host route prefix, resolved against the page base. */
      const API = (() => {
        try {
          return new URL('api/mmsc', document.baseURI).pathname;
        } catch {
          return '/api/mmsc';
        }
      })();

      const DICT = {
        zh: {
          nav: '魔改工作台',
          title: '魔改工作台',
          intro:
            '本地网页工作台：浏览整合包全部物品与合成表、图形化增删配方、查看 FTB Quests 任务节点。这里只负责它的端口与服务，不代替工作台界面。',
          status: '服务状态',
          running: '运行中',
          stopped: '已停止',
          starting: '启动中',
          error: '出错',
          port: '端口',
          portHint: '1–65535，改动后会自动重启服务',
          packDir: '整合包目录',
          packDirHint: '留空则启动后在页面里选；也可以是任意整合包文件夹的绝对路径',
          autoOpen: '启动后自动打开浏览器',
          repo: '工具仓库',
          repoHint: '默认为本插件所在仓库；换目录时填仓库根路径',
          save: '保存',
          start: '启动',
          stop: '停止',
          restart: '重启',
          open: '在浏览器打开',
          reload: '刷新状态',
          saving: '保存中…',
          startingLabel: '正在启动…',
          url: '地址',
          pid: '进程',
          log: '启动日志',
          emptyLog: '（暂无输出）',
          loadFailed: '无法读取工作台状态：{message}',
          pingOk: '主机路由已连通（{api}/ping · pid {pid} · {entry}）',
          pingFailed: '主机路由不可达（{api}/ping）：{message}',
          restartHint: 'host 行只在 DSH 启动时装配，重启桌面应用后再打开本页。',
        hostOffline: '面板未接通',
        hostControls: '主机半未接通时，启动 / 停止 / 重启 / 保存不可用；「打开」仍会直接用端口访问工作台。',
        probeUp: '工作台端口 {port} 可访问',
        probeDown: '工作台端口 {port} 未响应（未启动或端口不同）',
        probeUnknown: '正在探测工作台端口…',
          actionFailed: '操作失败：{message}',
          notFound:
            '没有找到 bin/kjsftb.mjs。请确认「工具仓库」指向 KJS-FTB-MMSkillComponents 仓库根目录，或安装后重新填写。',
          saved: '已保存',
          started: '已启动：{url}',
          stoppedLabel: '已停止',
          opened: '已在浏览器打开：{url}',
          hint: '工作台 API 文档见仓库 docs/API.md；本设置页仅在 DSH 中渲染。',
        },
        en: {
          nav: 'Modpack workbench',
          title: 'Modpack workbench',
          intro:
            'Local web workbench for a Minecraft modpack: browse items and recipes, edit crafting recipes, inspect FTB Quests nodes. This page only controls its port and process.',
          status: 'Service',
          running: 'running',
          stopped: 'stopped',
          starting: 'starting',
          error: 'error',
          port: 'Port',
          portHint: '1–65535; changing it restarts the service',
          packDir: 'Pack directory',
          packDirHint: 'Empty means "pick inside the page"; or an absolute pack folder',
          autoOpen: 'Open the browser after start',
          repo: 'Repository',
          repoHint: 'Defaults to the repository this plugin lives in',
          save: 'Save',
          start: 'Start',
          stop: 'Stop',
          restart: 'Restart',
          open: 'Open in browser',
          reload: 'Refresh',
          saving: 'Saving…',
          startingLabel: 'Starting…',
          url: 'URL',
          pid: 'PID',
          log: 'Startup log',
          emptyLog: '(no output yet)',
          loadFailed: 'Cannot read workbench status: {message}',
          pingOk: 'Host route reachable ({api}/ping · pid {pid} · {entry})',
          pingFailed: 'Host route unreachable ({api}/ping): {message}',
          restartHint: 'The host row mounts only at DSH startup - restart the desktop app, then reopen this page.',
        hostOffline: 'Panel offline',
        hostControls: 'Start / stop / restart / save need the host half; Open still reaches the workbench port directly.',
        probeUp: 'Workbench port {port} is reachable',
        probeDown: 'Workbench port {port} does not answer (not started, or a different port)',
        probeUnknown: 'Probing the workbench port…',
          actionFailed: 'Action failed: {message}',
          notFound: 'bin/kjsftb.mjs was not found. Point "Repository" at the KJS-FTB-MMSkillComponents root.',
          saved: 'Saved',
          started: 'Started: {url}',
          stoppedLabel: 'Stopped',
          opened: 'Opened in browser: {url}',
          hint: 'Workbench API docs: docs/API.md. This settings page renders inside DSH only.',
        },
      };

      /** Fill `{name}` placeholders. */
      const fmt = (text, vars) =>
        String(text).replace(/\{(\w+)\}/g, (whole, key) => (vars && key in vars ? String(vars[key]) : whole));

      const css = {
        root: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px 18px' },
        title: { fontSize: 18, fontWeight: 700 },
        intro: { fontSize: 13, lineHeight: 1.6, opacity: 0.78, maxWidth: 720 },
        card: {
          border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        },
        row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
        label: { fontSize: 13, fontWeight: 600, minWidth: 92 },
        input: {
          flex: '1 1 220px',
          minWidth: 180,
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
          background: 'color-mix(in srgb, currentColor 4%, transparent)',
          color: 'inherit',
          font: 'inherit',
        },
        hint: { fontSize: 12, opacity: 0.6, marginLeft: 102 },
        button: {
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
          background: 'color-mix(in srgb, currentColor 6%, transparent)',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 13,
        },
        primary: {
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, currentColor 32%, transparent)',
          background: 'color-mix(in srgb, currentColor 16%, transparent)',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 13,
          fontWeight: 600,
        },
        pill: (ok) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 10px',
          borderRadius: 999,
          fontSize: 12,
          border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
          background: ok
            ? 'color-mix(in srgb, #22c55e 18%, transparent)'
            : 'color-mix(in srgb, currentColor 8%, transparent)',
        }),
        kv: { display: 'grid', gridTemplateColumns: '92px 1fr', gap: '6px 12px', fontSize: 13 },
        key: { opacity: 0.6 },
        value: { wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
        log: {
          margin: 0,
          maxHeight: 180,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          padding: 10,
          borderRadius: 8,
          background: 'color-mix(in srgb, currentColor 6%, transparent)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        },
        error: { fontSize: 13, color: '#ef4444' },
        ok: { fontSize: 13, color: '#22c55e' },
      };

      /** The only network surface of this page. */
      async function call(path, options) {
        const response = await fetch(`${API}/${path}`, options);
        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (!response.ok) {
          const detail = data && data.error ? data.error : text ? text.slice(0, 300) : '(empty body)';
          throw new Error(`HTTP ${response.status} · ${detail}`);
        }
        return data;
      }

      const post = (path, body) =>
        call(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });

      function Field(props) {
        return h(
          'div',
          null,
          h(
            'div',
            { style: css.row },
            h('span', { style: css.label }, props.label),
            props.children,
          ),
          props.hint ? h('div', { style: css.hint }, props.hint) : null,
        );
      }

      /** Shown before the Host answers, so the controls are never a dead end. */
      const BLANK_FORM = { port: '5599', packDir: '', autoOpen: true, repoPath: '' };

      function WorkbenchSection(props) {
        const [data, setData] = React.useState(null);
        const [form, setForm] = React.useState(BLANK_FORM);
        const [busy, setBusy] = React.useState('');
        const [error, setError] = React.useState('');
        /** Host-half failure: the panel keeps working, only its controls degrade. */
        const [hostError, setHostError] = React.useState('');
        const [notice, setNotice] = React.useState('');
        /** Direct browser probe of the workbench port, independent of the Host. */
        const [probe, setProbe] = React.useState('unknown');

        const lang = (() => {
          try {
            const raw = document.documentElement.lang || navigator.language || 'zh';
            return String(raw).toLowerCase().startsWith('zh') ? 'zh' : 'en';
          } catch {
            return 'zh';
          }
        })();
        const t = (key, vars) => fmt((DICT[lang] || DICT.en)[key] ?? key, vars);

        /** Seed the form once, so the 5s poll never overwrites half-typed input. */
        const seeded = React.useRef(false);

        const adopt = React.useCallback((next) => {
          setData(next);
          if (next && next.config && !seeded.current) {
            seeded.current = true;
            setForm({
              port: String(next.config.port),
              packDir: next.config.packDir ?? '',
              autoOpen: next.config.autoOpen !== false,
              repoPath: next.config.repoPath ?? '',
            });
          }
        }, []);

        const pinged = React.useRef(false);
        const portRef = React.useRef(form.port);
        portRef.current = form.port;

        /** Talk to the workbench directly: works even when the Host half is dead. */
        const probeWorkbench = React.useCallback(async () => {
          const port = Number(portRef.current) || 5599;
          try {
            const response = await fetch(`http://127.0.0.1:${port}/api/v1/version`, {
              signal: AbortSignal.timeout(1500),
            });
            setProbe(response.ok ? 'up' : 'down');
            return response.ok;
          } catch {
            setProbe('down');
            return false;
          }
        }, []);

        const refresh = React.useCallback(async () => {
          if (!pinged.current) {
            pinged.current = true;
            try {
              const ping = await call('ping');
              setHostError('');
              setNotice(
                t('pingOk', { api: API, pid: ping?.pid ?? '?', entry: ping?.entry ?? '?' }),
              );
            } catch (pingError) {
              let base = API;
              try {
                base = `${document.baseURI} → ${API}`;
              } catch {
                base = API;
              }
              setHostError(
                t('pingFailed', { api: base, message: pingError.message }) + ' · ' + t('restartHint'),
              );
            }
          }
          await probeWorkbench();
          try {
            adopt(await call('status'));
          } catch (error) {
            setHostError(t('loadFailed', { message: error.message }));
          }
        }, [adopt, probeWorkbench, t]);

        React.useEffect(() => {
          refresh();
          const timer = setInterval(refresh, 5000);
          return () => clearInterval(timer);
        }, [refresh]);

        const run = async (label, action) => {
          setBusy(label);
          setNotice('');
          setError('');
          try {
            const result = await action();
            if (result) adopt(result);
            return result;
          } catch (error) {
            setError(t('actionFailed', { message: error.message }));
            return null;
          } finally {
            setBusy('');
          }
        };

        const draft = () =>
          form
            ? {
                port: Number(form.port) || undefined,
                packDir: form.packDir.trim(),
                autoOpen: Boolean(form.autoOpen),
                repoPath: form.repoPath.trim(),
              }
            : {};

        const save = () =>
          run('save', async () => {
            const result = await post('config', draft());
            setNotice(t('saved'));
            return result;
          });

        const start = () =>
          run('start', async () => {
            const result = await post('start', draft());
            if (result?.service?.url) setNotice(t('started', { url: result.service.url }));
            return result;
          });

        const stop = () =>
          run('stop', async () => {
            const result = await post('stop');
            setNotice(t('stoppedLabel'));
            return result;
          });

        const restart = () =>
          run('restart', async () => {
            const result = await post('restart', draft());
            if (result?.service?.url) setNotice(t('started', { url: result.service.url }));
            return result;
          });

        const localUrl = () => `http://127.0.0.1:${Number(form.port) || 5599}/`;

        const open = () =>
          run('open', async () => {
            // Without the Host half there is no /api/mmsc/open, but the browser
            // can still reach the workbench port directly.
            if (!data) {
              const url = localUrl();
              try {
                window.open(url, '_blank', 'noopener');
              } catch {
                // popup blocked; the URL is shown in the notice either way
              }
              setNotice(t('opened', { url }));
              return null;
            }
            const result = await post('open');
            if (result?.url) setNotice(t('opened', { url: result.url }));
            return result;
          });

        const service = data?.service ?? {};
        const running = service.status === 'running';
        const hostReady = Boolean(data);
        const probeLabel =
          probe === 'up' ? t('probeUp', { port: Number(form.port) || 5599 }) : probe === 'down'
            ? t('probeDown', { port: Number(form.port) || 5599 })
            : t('probeUnknown');
        const statusLabel = hostReady
          ? { running: t('running'), starting: t('starting'), error: t('error'), stopped: t('stopped') }[
              service.status
            ] ?? service.status
          : t('hostOffline');

        const disabled = Boolean(busy);

        return h(
          'div',
          { style: css.root },
          h('div', { style: { fontSize: 18, fontWeight: 700 } }, t('title')),
          h('div', { style: css.intro }, t('intro')),

          h(
            'div',
            { style: css.card },
            h(
              'div',
              { style: css.row },
              h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('status')),
              h('span', { style: css.pill(running) }, statusLabel),
              h('span', { style: css.hint }, probeLabel),
              service.url
                ? h(
                    'button',
                    { style: css.button, onClick: open, disabled },
                    service.url,
                  )
                : null,
              h(
                'button',
                { style: css.button, onClick: () => refresh(), disabled },
                t('reload'),
              ),
            ),
            h(
              'div',
              { style: css.kv },
              h('span', { style: css.key }, t('url')),
              h('span', { style: css.value }, service.url ?? '—'),
              h('span', { style: css.key }, t('pid')),
              h('span', { style: css.value }, service.pid ? String(service.pid) : '—'),
              h('span', { style: css.key }, t('repo')),
              h('span', { style: css.value }, data?.repo?.path ?? '—'),
            ),
            data?.repo && data.repo.exists === false
              ? h('div', { style: css.error }, t('notFound'))
              : null,
            service.log
              ? h(
                  'details',
                  null,
                  h('summary', { style: { fontSize: 12, opacity: 0.7, cursor: 'pointer' } }, t('log')),
                  h('pre', { style: css.log }, service.log),
                )
              : null,
          ),

          h(
            'div',
            { style: css.card },
            h(
              Field,
              { label: t('port'), hint: t('portHint') },
              h('input', {
                style: { ...css.input, flex: '0 1 140px' },
                type: 'number',
                min: 1,
                max: 65535,
                value: form.port,
                disabled,
                onChange: (event) => setForm({ ...form, port: event.target.value }),
              }),
              h(
                'label',
                { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 } },
                h('input', {
                  type: 'checkbox',
                  checked: form.autoOpen,
                  disabled,
                  onChange: (event) => setForm({ ...form, autoOpen: event.target.checked }),
                }),
                t('autoOpen'),
              ),
            ),
            h(
              Field,
              { label: t('packDir'), hint: t('packDirHint') },
              h('input', {
                style: css.input,
                type: 'text',
                placeholder: 'D:\\packs\\MyModpack',
                value: form.packDir,
                disabled,
                onChange: (event) => setForm({ ...form, packDir: event.target.value }),
              }),
            ),
            h(
              Field,
              { label: t('repo'), hint: t('repoHint') },
              h('input', {
                style: css.input,
                type: 'text',
                placeholder: 'D:\\code\\KJS-FTB-MMSkillComponents',
                value: form.repoPath,
                disabled,
                onChange: (event) => setForm({ ...form, repoPath: event.target.value }),
              }),
            ),
            h(
              'div',
              { style: css.row },
              h('button', { style: css.primary, onClick: save, disabled: !hostReady || disabled }, busy === 'save' ? t('saving') : t('save')),
              h('button', { style: css.button, onClick: start, disabled: !hostReady || disabled }, t('start')),
              h('button', { style: css.button, onClick: restart, disabled: !hostReady || disabled }, t('restart')),
              h('button', { style: css.button, onClick: stop, disabled: !hostReady || disabled }, t('stop')),
              h('button', { style: css.button, onClick: open, disabled }, t('open')),
            ),
            hostError ? h('div', { style: css.error }, hostError) : null,
            hostError ? h('div', { style: css.hint }, t('hostControls')) : null,
            error ? h('div', { style: css.error }, error) : null,
            !error && notice ? h('div', { style: css.ok }, notice) : null,
          ),

          h('div', { style: css.hint }, t('hint')),
          props && props.close
            ? h(
                'div',
                { style: { ...css.row, justifyContent: 'flex-end' } },
                h('button', { style: css.button, onClick: props.close }, lang === 'zh' ? '关闭' : 'Close'),
              )
            : null,
        );
      }

      const inject = ['slots'];

      function apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: SECTION_ID,
                  order: 17,
                  label: () => (DICT[
                    (() => {
                      try {
                        return String(document.documentElement.lang || navigator.language || 'zh')
                          .toLowerCase()
                          .startsWith('zh')
                          ? 'zh'
                          : 'en';
                      } catch {
                        return 'zh';
                      }
                    })()
                  ] || DICT.zh).nav,
                },
                WorkbenchSection,
              ),
            ),
          'mmsc-workbench: settings section',
        );
      }

      return { inject, apply };
    },
  });
})();
