/* MMSC workbench front-end: plain JS, no build step. */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  // This file is one implementation of the workbench API, not the API itself:
  // it only speaks the versioned REST contract in docs/API.md, so a rebuilt
  // frontend can replace it. Point window.MMSC_API_BASE at another server (or
  // reset the version with window.MMSC_API_VERSION) to decouple the two.
  const API_BASE = String(window.MMSC_API_BASE ?? '').replace(/\/+$/, '');
  const API_VERSION = String(window.MMSC_API_VERSION ?? 'v1');
  const apiUrl = (path) => {
    if (!path.startsWith('/api/')) return `${API_BASE}${path}`;
    return `${API_BASE}/api/${API_VERSION}/${path.slice('/api/'.length)}`;
  };

  const VIEWS = ['overview', 'items', 'recipes', 'quests', 'settings'];
  const VIEW_TITLES = { overview: '总览', items: '物品', recipes: '合成', quests: '任务', settings: '设置' };

  const state = {
    open: false,
    root: null,
    name: null,
    detection: null,
    summary: '',
    packs: [],
    stations: [],
    settings: {},
    items: { q: '', mod: '', page: 0, limit: 120, withIcon: false, total: 0 },
    selectedItem: null,
    recipes: { station: '', type: '', q: '', offset: 0, total: 0 },
    quests: null,
    questChapter: '',
    view: 'overview',
    busy: 0,
  };

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function busy(on) {
    state.busy += on ? 1 : -1;
    $('#pillBusy').style.display = state.busy > 0 ? '' : 'none';
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.toggle('err', Boolean(isError));
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 4200);
  }

  async function api(path, options = {}) {
    const res = await fetch(apiUrl(path), options);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data;
  }

  const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function withBusy(fn) {
    busy(true);
    try {
      return await fn();
    } finally {
      busy(false);
    }
  }

  function iconNode(rec, size = 34) {
    const box = el('div', 'icon');
    box.style.width = `${size}px`;
    box.style.height = `${size}px`;
    box.style.flex = `0 0 ${size}px`;
    if (rec?.icon) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = apiUrl(`/api/icon?jar=${encodeURIComponent(rec.icon.jar)}&entry=${encodeURIComponent(rec.icon.entry)}`);
      img.onerror = () => {
        img.remove();
        box.textContent = (rec.name ?? rec.id ?? '?').slice(0, 2);
      };
      box.appendChild(img);
    } else {
      box.textContent = (rec?.name ?? rec?.id ?? '?').slice(0, 2);
    }
    return box;
  }

  function iconImg(id, size = 16) {
    const img = document.createElement('img');
    img.className = 'mini-icon';
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    img.alt = '';
    img.src = apiUrl(`/api/icon-by-id?id=${encodeURIComponent(id)}`);
    img.addEventListener('error', () => img.remove());
    return img;
  }

  function chip(text, tag = false) {
    return el('span', `chip${tag ? ' tag' : ''}`, text);
  }

  function ingredientChips(list) {
    const wrap = el('div', 'chips');
    if (!list?.length) {
      wrap.appendChild(el('span', 'hint', '（无）'));
      return wrap;
    }
    for (const ing of list) {
      if (ing.tag) {
        wrap.appendChild(chip(`#${ing.tag}`, true));
        continue;
      }
      const node = chip(ing.count && ing.count > 1 ? `${ing.count}x ${ing.id}` : ing.id);
      node.prepend(iconImg(ing.id, 16));
      node.title = ing.id;
      wrap.appendChild(node);
    }
    return wrap;
  }

  function craftGrid(grid) {
    const wrap = el('div', 'craft-grid');
    const filled = [];
    grid.forEach((row, r) => row.forEach((slot, c) => slot && filled.push([r, c, slot])));
    if (!filled.length) return wrap;
    const minR = Math.min(...filled.map(([r]) => r));
    const maxR = Math.max(...filled.map(([r]) => r));
    const minC = Math.min(...filled.map(([, c]) => c));
    const maxC = Math.max(...filled.map(([, c]) => c));
    const cols = maxC - minC + 1;
    wrap.style.gridTemplateColumns = `repeat(${cols}, 42px)`;
    for (let r = minR; r <= maxR; r += 1) {
      for (let c = minC; c <= maxC; c += 1) {
        const slot = grid[r]?.[c];
        const cell = el('div', `craft-cell${slot ? '' : ' empty'}`);
        if (slot) {
          if (slot.tag) {
            cell.appendChild(el('span', 'tagtext', `#${slot.tag}`));
          } else {
            const img = iconImg(slot.id, 30);
            const path = slot.id.split(':').pop();
            const initials = path
              .split(/[_\-\/.]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase();
            const label = el('span', 'lbl', initials || path.slice(0, 2));
            cell.appendChild(img);
            cell.appendChild(label);
            img.addEventListener('load', () => label.remove());
            img.addEventListener('error', () => {
              img.remove();
              label.classList.add('show');
            });
            cell.title = slot.id;
          }
          if (slot.count > 1) cell.appendChild(el('span', 'count', String(slot.count)));
        }
        wrap.appendChild(cell);
      }
    }
    return wrap;
  }

  // ------------------------------------------------------------- navigation
  function showView(name) {
    if (!VIEWS.includes(name)) name = 'overview';
    state.view = name;
    if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
    for (const button of $$('#nav button')) button.classList.toggle('active', button.dataset.view === name);
    for (const view of $$('.view')) view.classList.toggle('active', view.id === `view-${name}`);
    $('#viewTitle').textContent = VIEW_TITLES[name] ?? name;
    if (name === 'items') renderItems();
    if (name === 'recipes') loadRecipes();
    if (name === 'quests') loadQuests();
    if (name === 'settings') renderSettings();
    if (name === 'overview') renderOverview();
  }

  for (const button of $$('#nav button')) button.addEventListener('click', () => showView(button.dataset.view));
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (name && name !== state.view) showView(name);
  });

  // ------------------------------------------------------------ pack switch
  function renderPackButton() {
    $('#packBtnText').textContent = state.open ? state.name ?? state.root : '未打开整合包';
    $('#packBtn').title = state.open ? state.root : '还没有选择整合包';
  }

  async function togglePackMenu(force) {
    const menu = $('#packMenu');
    const show = force ?? menu.hidden;
    if (!show) {
      menu.hidden = true;
      return;
    }
    menu.hidden = false;
    menu.innerHTML = '';
    if (!state.packs.length) {
      menu.appendChild(el('div', 'hint', '还没有保存的整合包。'));
    }
    for (const pack of state.packs) {
      const row = el('div', `pack-row${pack.active ? ' active' : ''}`);
      const main = el('button', 'pack-main');
      main.appendChild(el('b', null, pack.name ?? pack.path.split(/[\\/]/).pop()));
      main.appendChild(el('small', null, pack.path));
      if (!pack.exists) {
        main.disabled = true;
        main.appendChild(el('small', 'err', '目录不存在'));
      }
      main.addEventListener('click', () => selectPack(pack.path));
      row.appendChild(main);
      if (!pack.active) {
        const forget = el('button', 'ghost tiny', '移除');
        forget.title = '从列表里移除（不会删除文件）';
        forget.addEventListener('click', async (event) => {
          event.stopPropagation();
          await withBusy(() => post('/api/packs', { op: 'remove', dir: pack.path }));
          await refreshState();
          togglePackMenu(true);
        });
        row.appendChild(forget);
      }
      menu.appendChild(row);
    }
    const add = el('button', 'pack-add', '＋ 添加整合包…');
    add.addEventListener('click', () => {
      menu.hidden = true;
      showView('settings');
      $('#setRoot').focus();
    });
    menu.appendChild(add);
  }

  $('#packBtn').addEventListener('click', () => togglePackMenu());
  document.addEventListener('click', (event) => {
    if (!$('#packSwitch').contains(event.target)) $('#packMenu').hidden = true;
  });

  async function selectPack(dir) {
    $('#packMenu').hidden = true;
    try {
      await withBusy(() => post('/api/packs', { op: 'select', dir }));
      resetIndexedViews();
      await refreshState();
      toast(`已切换到 ${state.name ?? dir}`);
      showView(state.view === 'settings' ? 'overview' : state.view);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function resetIndexedViews() {
    state.selectedItem = null;
    state.items.page = 0;
    state.items.q = '';
    state.recipes = { station: '', type: '', q: '', offset: 0, total: 0 };
    state.quests = null;
    state.questChapter = '';
    $('#itemSearch').value = '';
    $('#recipeSearch').value = '';
    $('#recipeType').value = '';
    $('#recipeType').dataset.filled = '';
    $('#recipeType').innerHTML = '<option value="">全部类型</option>';
    $('#itemMod').dataset.filled = '';
    $('#itemMod').innerHTML = '<option value="">全部模组</option>';
    $('#recipeList').innerHTML = '';
    $('#itemGrid').innerHTML = '';
    $('#editLog').innerHTML = '<div class="empty">右侧会显示这个工作台写入的改动。</div>';
  }

  // ------------------------------------------------------------------ state
  async function refreshState() {
    const data = await api('/api/state');
    state.open = Boolean(data.open);
    state.root = data.root ?? null;
    state.name = data.name ?? (data.root ? data.root.split(/[\\/]/).pop() : null);
    state.detection = data.detection ?? null;
    state.summary = data.summary ?? '';
    state.packs = data.packs ?? [];
    state.stations = data.stations ?? [];
    state.settings = data.settings ?? {};
    renderPackButton();
    renderVersionLine();
    if (!state.open) {
      $('#versionLine').textContent = '未打开整合包';
      return data;
    }
    renderStationBar();
    fillRecipeTypes(data.recipeTypes);
    fillModFilter(data.mods ?? []);
    applyQuestBackground();
    return data;
  }

  function renderVersionLine() {
    const box = $('#versionLine');
    if (!state.open || !state.detection) {
      box.textContent = '未打开整合包';
      return;
    }
    const d = state.detection;
    const mc = d.minecraft ?? {};
    const kjs = d.kubejs ?? {};
    const loader = mc.loader ? `${mc.loader}${mc.loaderVersion ? ` ${mc.loaderVersion}` : ''}` : '加载器未知';
    const mcText = mc.version ? `${mc.version} · ${loader}` : `MC 版本未知 · ${loader}`;
    const genLabel = kjs.generationLabel || kjs.generation || '未知代际';
    let kjsText;
    if (kjs.version) {
      kjsText = `KubeJS ${kjs.version} · ${genLabel}`;
    } else if (kjs.installed) {
      kjsText = `KubeJS 版本未知 · 按 ${genLabel} 处理${kjs.generationAssumed ? '（假设）' : ''}`;
    } else {
      kjsText = '未检测到 KubeJS';
    }
    box.innerHTML = '';
    const line1 = el('div', null, mcText);
    line1.title = `判定依据: ${mc.source ?? '未知'}`;
    const line2 = el('div', null, kjsText);
    line2.title = `判定依据: ${kjs.generationSource ?? '未知'}`;
    box.append(line1, line2);
  }

  // --------------------------------------------------------------- overview
  async function renderOverview() {
    const body = $('#overviewBody');
    const data = await withBusy(() => refreshState());
    body.innerHTML = '';
    if (!data.open) {
      body.innerHTML = '<div class="empty">还没有打开整合包。点右上角的整合包下拉框添加一个目录，或者到「设置」里填路径。</div>';
      return;
    }
    const d = state.detection;
    const cards = el('div', 'cards');
    const addCard = (k, v, s) => {
      const card = el('div', 'card');
      card.appendChild(el('div', 'k', k));
      card.appendChild(el('div', 'v', v));
      if (s) card.appendChild(el('div', 's', s));
      cards.appendChild(card);
    };
    const syntaxHint = (kjs) => {
      if (!kjs?.installed) return '';
      if (kjs.onEvent === 'removed') return 'ServerEvents.recipes(event => …)';
      if (kjs.onEvent === 'throws') return 'ServerEvents.recipes(...); onEvent() 会抛错';
      return "onEvent('recipes', event => …)";
    };
    addCard('整合包', d.name ?? state.name, state.root);
    addCard('Minecraft', d.minecraft?.version ?? '未检测到', d.minecraft?.loader ? `${d.minecraft.loader} ${d.minecraft.loaderVersion ?? ''}`.trim() : '没有启动器清单');
    addCard('KubeJS', d.kubejs?.installed ? (d.kubejs.version ?? '已安装') : '未安装', syntaxHint(d.kubejs));
    addCard('FTB Quests', d.ftbQuests?.installed ? (d.ftbQuests.version ?? '已安装') : '未安装', d.ftbQuests?.hasLangFiles ? '任务文本在 lang/ 里' : '');
    addCard('物品', data.items?.items ?? 0, `${data.items?.withIcon ?? 0} 个有图标 · ${data.items?.jars ?? 0} 个 jar`);
    addCard('合成', data.recipes?.recipes ?? 0, `${data.recipes?.scriptOps ?? 0} 条脚本改动`);
    addCard('任务', data.quests?.quests ?? 0, `${data.quests?.chapters ?? 0} 个章节`);
    body.appendChild(cards);

    if (d.warnings?.length) {
      const panel = el('div', 'panel');
      panel.appendChild(el('h2', null, '检测提示'));
      const list = el('div', 'warn-list');
      for (const warning of d.warnings) list.appendChild(el('div', 'warn-item', `· ${warning}`));
      panel.appendChild(list);
      body.appendChild(panel);
    }

    const exportsPanel = el('div', 'panel');
    exportsPanel.appendChild(el('h2', null, '怎么用'));
    const hints = el('div', 'hint');
    hints.innerHTML = [
      '物品页：搜索全部物品，点开任意物品能看到「怎么合成」和「用来做什么」。',
      '合成页：按工作方块筛配方，也可以图形化新建配方；改动会写进 <code>kubejs/server_scripts/zz_kjsftb_edits.js</code>，进游戏 <code>/reload</code> 生效。',
      '任务页：读 FTB Quests 的 SNBT，按章节画成图；右上角可以给任务界面换背景图。',
      '想让物品清单 100% 准确？进游戏跑一次 <code>/kubejs export</code>，再点「重新检测」。',
    ].join('<br />');
    exportsPanel.appendChild(hints);
    body.appendChild(exportsPanel);
  }

  // ------------------------------------------------------------------ items
  let itemTimer = null;
  async function renderItems(resetPage = false) {
    if (!state.open) {
      $('#itemGrid').innerHTML = '<div class="empty">先打开一个整合包。</div>';
      return;
    }
    if (resetPage) state.items.page = 0;
    const params = new URLSearchParams({
      q: state.items.q,
      mod: state.items.mod,
      limit: String(state.items.limit),
      offset: String(state.items.page * state.items.limit),
      withIcon: state.items.withIcon ? '1' : '0',
    });
    const data = await withBusy(() => api(`/api/items?${params}`));
    state.items.total = data.total;
    const grid = $('#itemGrid');
    grid.innerHTML = '';
    if (!data.items.length) grid.innerHTML = '<div class="empty">没有匹配的物品。</div>';
    for (const rec of data.items) {
      const node = el('div', 'item');
      node.title = `${rec.name}\n${rec.id}${rec.mod ? `\nmod: ${rec.mod}` : ''}`;
      node.appendChild(iconNode(rec));
      const meta = el('div', 'meta');
      const name = el('div', 'name', rec.name);
      name.title = rec.name;
      const id = el('div', 'id', rec.id);
      id.title = rec.id;
      meta.append(name, id);
      node.appendChild(meta);
      node.addEventListener('click', () => selectItem(rec));
      grid.appendChild(node);
    }
    const from = state.items.total ? state.items.page * state.items.limit + 1 : 0;
    const to = Math.min(state.items.total, (state.items.page + 1) * state.items.limit);
    $('#itemCount').textContent = `${from}-${to} / 共 ${state.items.total} 个物品`;
    $('#itemPrev').disabled = state.items.page === 0;
    $('#itemNext').disabled = to >= state.items.total;
    if (state.selectedItem) selectItem(state.selectedItem, true);
  }

  function fillModFilter(mods) {
    const select = $('#itemMod');
    if (select.dataset.filled) return;
    select.dataset.filled = '1';
    for (const mod of mods) {
      const option = document.createElement('option');
      option.value = mod.id;
      option.textContent = `${mod.name ?? mod.id} (${mod.id})`;
      select.appendChild(option);
    }
  }

  async function selectItem(rec, silent = false) {
    state.selectedItem = rec;
    const panel = $('#itemDetail');
    panel.innerHTML = '';
    const header = el('div');
    header.style.display = 'flex';
    header.style.gap = '10px';
    header.style.alignItems = 'center';
    header.appendChild(iconNode(rec, 44));
    const titleWrap = el('div');
    titleWrap.style.minWidth = '0';
    titleWrap.appendChild(el('h3', null, rec.name));
    titleWrap.appendChild(el('div', 'sub', rec.id));
    header.appendChild(titleWrap);
    panel.appendChild(header);

    const outSection = el('section');
    outSection.appendChild(el('h4', null, '产出（怎么合成）'));
    const outBody = el('div');
    outBody.appendChild(el('div', 'hint', '加载中…'));
    outSection.appendChild(outBody);
    panel.appendChild(outSection);

    const inSection = el('section');
    inSection.appendChild(el('h4', null, '用途（用它合成什么）'));
    const inBody = el('div');
    inBody.appendChild(el('div', 'hint', '加载中…'));
    inSection.appendChild(inBody);
    panel.appendChild(inSection);

    const actions = el('section');
    const newButton = el('button', 'primary', '以它为产物新建配方');
    newButton.addEventListener('click', () => openRecipeBuilder({ output: rec.id }));
    actions.appendChild(newButton);
    panel.appendChild(actions);

    if (!silent) showView('items');

    try {
      const [out, use] = await Promise.all([
        api(`/api/recipes?output=${encodeURIComponent(rec.id)}`),
        api(`/api/recipes?input=${encodeURIComponent(rec.id)}`),
      ]);
      outBody.innerHTML = '';
      outBody.appendChild(recipeMiniList(out.recipes, '没有已知配方（可能是模组自定义机器、或来自数据包未扫描到）。'));
      inBody.innerHTML = '';
      inBody.appendChild(recipeMiniList(use.recipes, '没有配方把它当材料。'));
    } catch (err) {
      outBody.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  }

  function recipeMiniList(list, emptyText) {
    const wrap = el('div');
    if (!list.length) {
      wrap.appendChild(el('div', 'hint', emptyText));
      return wrap;
    }
    for (const recipe of list.slice(0, 40)) {
      const row = el('div', 'recipe');
      const head = el('div', 'head');
      head.appendChild(el('span', 'type', String(recipe.type).replace(/^minecraft:/, '')));
      head.appendChild(el('span', 'rid', recipe.id));
      row.appendChild(head);
      const body = el('div', 'body');
      const inputs = el('div', 'row');
      inputs.appendChild(el('b', null, '材料'));
      inputs.appendChild(ingredientChips(recipe.inputs));
      body.appendChild(inputs);
      const outputs = el('div', 'row');
      outputs.appendChild(el('b', null, '产出'));
      outputs.appendChild(ingredientChips(recipe.outputs));
      body.appendChild(outputs);
      row.appendChild(body);
      wrap.appendChild(row);
    }
    if (list.length > 40) wrap.appendChild(el('div', 'hint', `还有 ${list.length - 40} 条未显示`));
    return wrap;
  }

  $('#itemSearch').addEventListener('input', (event) => {
    clearTimeout(itemTimer);
    itemTimer = setTimeout(() => {
      state.items.q = event.target.value.trim();
      renderItems(true);
    }, 220);
  });
  $('#itemMod').addEventListener('change', (event) => {
    state.items.mod = event.target.value;
    renderItems(true);
  });
  $('#itemOnlyIcon').addEventListener('change', (event) => {
    state.items.withIcon = event.target.checked;
    renderItems(true);
  });
  $('#itemPrev').addEventListener('click', () => {
    state.items.page = Math.max(0, state.items.page - 1);
    renderItems();
  });
  $('#itemNext').addEventListener('click', () => {
    state.items.page += 1;
    renderItems();
  });

  // ---------------------------------------------------------------- recipes
  function renderStationBar() {
    const bar = $('#stationBar');
    bar.innerHTML = '';
    const all = { id: '', label: '全部', count: state.stations.reduce((sum, s) => sum + (s.count ?? 0), 0) };
    for (const station of [all, ...state.stations]) {
      const button = el('button', `station${state.recipes.station === station.id ? ' active' : ''}`);
      button.appendChild(el('span', null, station.label));
      button.appendChild(el('span', 'count', String(station.count ?? 0)));
      button.addEventListener('click', () => {
        state.recipes.station = station.id;
        renderStationBar();
        loadRecipes('', false);
      });
      bar.appendChild(button);
    }
  }

  let recipeTimer = null;
  async function loadRecipes(query = $('#recipeSearch').value.trim(), append = false) {
    if (!state.open) {
      $('#recipeList').innerHTML = '<div class="empty">先打开一个整合包。</div>';
      return;
    }
    if (!append) state.recipes.offset = 0;
    const params = new URLSearchParams({ limit: '40', offset: String(state.recipes.offset) });
    if (state.recipes.station) params.set('station', state.recipes.station);
    const type = $('#recipeType').value;
    if (type) params.set('type', type);
    if (query) params.set(query.includes(':') ? 'output' : 'q', query);
    const data = await withBusy(() => api(`/api/recipes?${params}`));
    const list = $('#recipeList');
    if (!append) list.innerHTML = '';
    if (!data.recipes.length && !append) list.innerHTML = '<div class="empty">没有匹配的配方。</div>';
    for (const recipe of data.recipes) list.appendChild(recipeCard(recipe));
    state.recipes.offset += data.recipes.length;
    state.recipes.total = data.total;
    $('#recipeCount').textContent = `${data.total} 条配方${query ? '（已筛选）' : ''}${state.recipes.station ? '（按工作方块）' : ''}`;
    $('#recipeMore').disabled = state.recipes.offset >= data.total;
    $('#recipeMoreHint').textContent = state.recipes.offset >= data.total ? '' : `已显示 ${state.recipes.offset} / ${data.total}`;
    loadEdits();
  }

  function fillRecipeTypes(types) {
    const select = $('#recipeType');
    if (select.dataset.filled || !types) return;
    select.dataset.filled = '1';
    for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = `${type.replace(/^minecraft:/, '')} (${count})`;
      select.appendChild(option);
    }
  }

  function recipeCard(recipe) {
    const row = el('div', 'recipe');
    const head = el('div', 'head');
    head.appendChild(el('span', 'type', String(recipe.type).replace(/^minecraft:/, '')));
    head.appendChild(el('span', 'rid', recipe.id));
    if (recipe.source === 'script') head.appendChild(el('span', 'chip tag', '脚本'));
    head.appendChild(el('span', 'spacer')).style.flex = '1';
    const remove = el('button', 'danger', '删除配方');
    remove.addEventListener('click', async () => {
      if (!confirm(`删除配方 ${recipe.id}？会写进 zz_kjsftb_edits.js，进游戏 /reload 后生效。`)) return;
      await withBusy(() => post('/api/edit', { op: 'remove', id: recipe.id }));
      toast(`已加入删除列表：${recipe.id}`);
      loadRecipes();
    });
    head.appendChild(remove);
    row.appendChild(head);

    const body = el('div', 'body');
    if (recipe.grid) {
      body.appendChild(craftGrid(recipe.grid));
    } else {
      const inputs = el('div', 'row');
      inputs.appendChild(el('b', null, '材料'));
      inputs.appendChild(ingredientChips(recipe.inputs));
      body.appendChild(inputs);
    }
    const outputs = el('div', 'row');
    outputs.appendChild(el('b', null, '产出'));
    if (recipe.outputs?.length) outputs.appendChild(ingredientChips(recipe.outputs));
    else outputs.appendChild(el('span', 'hint', '由模组逻辑生成，没有固定产出'));
    body.appendChild(outputs);
    if (recipe.file) {
      const file = el('div', 'row');
      file.appendChild(el('b', null, '来源'));
      file.appendChild(el('span', 'hint', recipe.file));
      body.appendChild(file);
    }
    row.appendChild(body);
    return row;
  }

  async function loadEdits() {
    const box = $('#editLog');
    try {
      const edits = await api('/api/edits');
      box.innerHTML = '';
      box.appendChild(el('h3', null, `工作台写入的改动（${edits.recipes.length}）`));
      box.appendChild(el('div', 'sub', 'kubejs/server_scripts/zz_kjsftb_edits.js'));
      if (!edits.recipes.length) {
        box.appendChild(el('div', 'hint', '还没有改动。'));
        return;
      }
      edits.recipes.forEach((edit, index) => {
        const row = el('div', 'recipe');
        const head = el('div', 'head');
        head.appendChild(el('span', 'type', edit.kind === 'remove' ? 'remove' : (edit.spec?.kind ?? 'add')));
        head.appendChild(el('span', 'rid', edit.kind === 'remove' ? edit.id : (edit.spec?.output ?? '')));
        head.appendChild(el('span', 'spacer')).style.flex = '1';
        const drop = el('button', 'ghost', '撤销');
        drop.addEventListener('click', async () => {
          await withBusy(() => post('/api/edit', { op: 'drop', index }));
          loadEdits();
        });
        head.appendChild(drop);
        row.appendChild(head);
        box.appendChild(row);
      });
      const clear = el('button', 'danger', '清空全部改动');
      clear.style.marginTop = '10px';
      clear.addEventListener('click', async () => {
        if (!confirm('清空工作台写入的所有改动？')) return;
        await withBusy(() => post('/api/edit', { op: 'clear' }));
        toast('已清空');
        loadRecipes();
      });
      box.appendChild(clear);
    } catch (err) {
      box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  }

  $('#recipeSearch').addEventListener('input', (event) => {
    clearTimeout(recipeTimer);
    recipeTimer = setTimeout(() => loadRecipes(event.target.value.trim()), 250);
  });
  $('#recipeType').addEventListener('change', () => loadRecipes());
  $('#recipeMore').addEventListener('click', () => loadRecipes($('#recipeSearch').value.trim(), true));
  $('#btnNewRecipe').addEventListener('click', () => openRecipeBuilder());

  // ------------------------------------------------------------- item picker
  const picker = { onPick: null, q: '', page: 0, limit: 48, total: 0, timer: null };

  function openPicker({ title = '选择物品', onPick }) {
    picker.onPick = onPick;
    picker.q = '';
    picker.page = 0;
    $('#pickerTitle').textContent = title;
    $('#pickerSearch').value = '';
    $('#pickerCustom').value = '';
    $('#picker').classList.add('open');
    loadPicker();
    setTimeout(() => $('#pickerSearch').focus(), 30);
  }

  function closePicker() {
    $('#picker').classList.remove('open');
    picker.onPick = null;
  }

  async function loadPicker() {
    if (!state.open) return;
    const params = new URLSearchParams({ q: picker.q, limit: String(picker.limit), offset: String(picker.page * picker.limit) });
    const data = await api(`/api/items?${params}`);
    picker.total = data.total;
    const grid = $('#pickerGrid');
    grid.innerHTML = '';
    if (!data.items.length) grid.innerHTML = '<div class="empty">没有匹配的物品。</div>';
    for (const rec of data.items) {
      const node = el('div', 'item');
      node.title = `${rec.name}\n${rec.id}`;
      node.appendChild(iconNode(rec, 30));
      node.appendChild(el('div', 'name', rec.name));
      node.appendChild(el('div', 'id', rec.id));
      node.addEventListener('click', () => {
        picker.onPick?.({ id: rec.id });
        closePicker();
      });
      grid.appendChild(node);
    }
    const from = picker.total ? picker.page * picker.limit + 1 : 0;
    const to = Math.min(picker.total, (picker.page + 1) * picker.limit);
    $('#pickerCount').textContent = `${from}-${to} / ${picker.total}`;
    $('#pickerPrev').disabled = picker.page === 0;
    $('#pickerNext').disabled = to >= picker.total;
  }

  $('#pickerSearch').addEventListener('input', (event) => {
    clearTimeout(picker.timer);
    picker.timer = setTimeout(() => {
      picker.q = event.target.value.trim();
      picker.page = 0;
      loadPicker();
    }, 200);
  });
  $('#pickerPrev').addEventListener('click', () => {
    picker.page = Math.max(0, picker.page - 1);
    loadPicker();
  });
  $('#pickerNext').addEventListener('click', () => {
    picker.page += 1;
    loadPicker();
  });
  $('#pickerUse').addEventListener('click', () => {
    const raw = $('#pickerCustom').value.trim();
    if (!raw) return;
    const tag = raw.startsWith('#');
    picker.onPick?.(tag ? { tag: raw.slice(1) } : { id: raw });
    closePicker();
  });
  $('#pickerClose').addEventListener('click', closePicker);
  $('#picker').addEventListener('click', (event) => {
    if (event.target.id === 'picker') closePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if ($('#picker').classList.contains('open')) closePicker();
      else $('#modal').classList.remove('open');
    }
  });

  // ---------------------------------------------------------- recipe builder
  const STATION_kinds = [
    { id: 'crafting', label: '工作台', kind: 'crafting' },
    { id: 'smelting', label: '熔炉', kind: 'smelting' },
    { id: 'blasting', label: '高炉', kind: 'blasting' },
    { id: 'smoking', label: '烟熏炉', kind: 'smoking' },
    { id: 'campfire', label: '营火', kind: 'campfireCooking' },
    { id: 'stonecutting', label: '切石机', kind: 'stonecutting' },
    { id: 'smithing', label: '锻造台', kind: 'smithing' },
    { id: 'smithingTrim', label: '锻造纹饰', kind: 'smithingTrim' },
    { id: 'custom', label: '自定义 JSON', kind: 'custom' },
  ];

  function slotNode(value, { onPick, onClear, size = 48 } = {}) {
    const node = el('div', `slot${value ? ' filled' : ''}`);
    node.style.width = `${size}px`;
    node.style.height = `${size}px`;
    if (value?.tag) {
      node.appendChild(el('span', 'tagtext', `#${value.tag}`));
    } else if (value?.id) {
      const img = iconImg(value.id, size - 14);
      node.appendChild(img);
      const label = el('span', 'lbl', value.id.split(':').pop());
      node.appendChild(label);
      img.addEventListener('load', () => label.remove());
      img.addEventListener('error', () => {
        img.remove();
        label.classList.add('show');
      });
      node.title = value.id;
      if (value.count > 1) node.appendChild(el('span', 'count', String(value.count)));
    } else {
      node.appendChild(el('span', 'plus', '＋'));
    }
    node.addEventListener('click', () => onPick?.());
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onClear?.();
    });
    return node;
  }

  function openRecipeBuilder(prefill = {}) {
    const body = $('#modalBody');
    body.innerHTML = '';
    const wrap = el('div', 'builder');
    const header = el('div', 'builder-head');
    header.appendChild(el('h2', null, '新建配方'));
    const close = el('button', 'ghost', '×');
    close.addEventListener('click', () => $('#modal').classList.remove('open'));
    header.appendChild(close);
    wrap.appendChild(header);

    const model = {
      station: 'crafting',
      ordered: true,
      cells: Array.from({ length: 9 }, () => null),
      ingredients: [],
      output: prefill.output ? { id: prefill.output, count: 1 } : null,
      count: 1,
      input: null,
      template: null,
      base: null,
      addition: null,
      xp: '0.1',
      time: '200',
      raw: '',
    };

    const stationBar = el('div', 'stations');
    wrap.appendChild(stationBar);
    const stage = el('div', 'builder-stage');
    wrap.appendChild(stage);
    const error = el('div', 'error');
    const actions = el('div', 'builder-actions');
    const submit = el('button', 'primary', '写入改动');
    const cancel = el('button', 'ghost', '取消');
    actions.append(submit, cancel);
    wrap.append(error, actions);
    body.appendChild(wrap);

    const pickFor = (apply, title = '选择物品') => () =>
      openPicker({ title, onPick: (value) => { apply(value); renderStage(); } });

    function renderStationBar() {
      stationBar.innerHTML = '';
      for (const station of STATION_kinds) {
        const button = el('button', `station${model.station === station.id ? ' active' : ''}`, station.label);
        button.addEventListener('click', () => {
          model.station = station.id;
          renderStationBar();
          renderStage();
        });
        stationBar.appendChild(button);
      }
    }

    function renderStage() {
      stage.innerHTML = '';
      const station = STATION_kinds.find((s) => s.id === model.station);

      if (model.station === 'crafting') {
        const modeRow = el('div', 'row-inline');
        const ordered = el('button', `seg${model.ordered ? ' active' : ''}`, '有序合成');
        const shapeless = el('button', `seg${model.ordered ? '' : ' active'}`, '无序合成');
        ordered.addEventListener('click', () => { model.ordered = true; renderStage(); });
        shapeless.addEventListener('click', () => { model.ordered = false; renderStage(); });
        modeRow.append(ordered, shapeless);
        stage.appendChild(modeRow);
      }

      if (model.station === 'custom') {
        const area = el('textarea', 'json');
        area.rows = 12;
        area.placeholder = '{"type":"minecraft:crafting_shaped", ...}';
        area.value = model.raw;
        area.addEventListener('input', () => { model.raw = area.value; });
        stage.appendChild(area);
        return;
      }

      const layout = el('div', 'workbench-layout');

      if (model.station === 'crafting' && model.ordered) {
        const grid = el('div', 'slot-grid');
        for (let i = 0; i < 9; i += 1) {
          grid.appendChild(
            slotNode(model.cells[i], {
              onPick: pickFor((value) => { model.cells[i] = value; }),
              onClear: () => { model.cells[i] = null; renderStage(); },
            }),
          );
        }
        const arrow = el('div', 'arrow', '→');
        const out = slotNode(model.output, {
          onPick: pickFor((value) => { model.output = { ...value, count: model.count }; }, '选择产物'),
          onClear: () => { model.output = null; renderStage(); },
          size: 56,
        });
        layout.append(grid, arrow, out);
      } else if (model.station === 'crafting') {
        const list = el('div', 'slot-row');
        list.appendChild(slotNode(null, { onPick: () => { model.ingredients.push({ id: 'minecraft:stone' }); renderStage(); } }));
        model.ingredients.forEach((ing, index) => {
          list.appendChild(
            slotNode(ing, {
              onPick: pickFor((value) => { model.ingredients[index] = value; }),
              onClear: () => { model.ingredients.splice(index, 1); renderStage(); },
            }),
          );
        });
        const arrow = el('div', 'arrow', '→');
        const out = slotNode(model.output, {
          onPick: pickFor((value) => { model.output = { ...value, count: model.count }; }, '选择产物'),
          onClear: () => { model.output = null; renderStage(); },
          size: 56,
        });
        layout.append(list, arrow, out);
      } else if (['smelting', 'blasting', 'smoking', 'campfire'].includes(model.station)) {
        const input = slotNode(model.input, {
          onPick: pickFor((value) => { model.input = value; }, '选择输入'),
          onClear: () => { model.input = null; renderStage(); },
          size: 56,
        });
        const arrow = el('div', 'arrow', '→');
        const out = slotNode(model.output, {
          onPick: pickFor((value) => { model.output = { ...value, count: model.count }; }, '选择产物'),
          onClear: () => { model.output = null; renderStage(); },
          size: 56,
        });
        layout.append(input, arrow, out);
      } else if (model.station === 'stonecutting') {
        const input = slotNode(model.input, {
          onPick: pickFor((value) => { model.input = value; }, '选择输入'),
          onClear: () => { model.input = null; renderStage(); },
          size: 56,
        });
        const arrow = el('div', 'arrow', '→');
        const out = slotNode(model.output, {
          onPick: pickFor((value) => { model.output = { ...value, count: model.count }; }, '选择产物'),
          onClear: () => { model.output = null; renderStage(); },
          size: 56,
        });
        layout.append(input, arrow, out);
      } else {
        // smithing / smithingTrim
        if (model.station === 'smithing') {
          layout.appendChild(
            slotNode(model.template, {
              onPick: pickFor((value) => { model.template = value; }, '选择模板（可空）'),
              onClear: () => { model.template = null; renderStage(); },
            }),
          );
        }
        layout.appendChild(
          slotNode(model.base, {
            onPick: pickFor((value) => { model.base = value; }, '选择底材'),
            onClear: () => { model.base = null; renderStage(); },
          }),
        );
        layout.appendChild(el('div', 'arrow', '＋'));
        layout.appendChild(
          slotNode(model.addition, {
            onPick: pickFor((value) => { model.addition = value; }, '选择添加物'),
            onClear: () => { model.addition = null; renderStage(); },
          }),
        );
        layout.appendChild(el('div', 'arrow', '→'));
        layout.appendChild(
          slotNode(model.output, {
            onPick: pickFor((value) => { model.output = { ...value, count: model.count }; }, '选择产物'),
            onClear: () => { model.output = null; renderStage(); },
            size: 56,
          }),
        );
      }

      stage.appendChild(layout);

      const numbers = el('div', 'row-inline');
      const addField = (label, node) => {
        const box = el('label', 'field');
        box.appendChild(el('span', null, label));
        box.appendChild(node);
        numbers.appendChild(box);
      };
      const num = (value, onChange, min = '0') => {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = min;
        input.value = String(value);
        input.addEventListener('input', () => onChange(input.value));
        return input;
      };
      if (model.station !== 'custom') {
        addField('产出数量', num(model.count, (value) => { model.count = Math.max(1, Number(value) || 1); if (model.output) model.output.count = model.count; }, '1'));
      }
      if (['smelting', 'blasting', 'smoking', 'campfire'].includes(model.station)) {
        addField('经验', num(model.xp, (value) => { model.xp = value; }));
        addField('时间 (tick)', num(model.time, (value) => { model.time = value; }, '1'));
      }
      stage.appendChild(numbers);
      stage.appendChild(el('div', 'hint', '点格子选物品；右键格子清空。选择产物后点「写入改动」生成脚本。'));
    }

    renderStationBar();
    renderStage();
    cancel.addEventListener('click', () => $('#modal').classList.remove('open'));
    submit.addEventListener('click', async () => {
      error.textContent = '';
      let spec;
      try {
        spec = buildSpec(model);
      } catch (err) {
        error.textContent = err.message;
        return;
      }
      try {
        await withBusy(() => post('/api/edit', { op: 'add', spec }));
        $('#modal').classList.remove('open');
        toast('已写入 zz_kjsftb_edits.js，进游戏 /reload 生效');
        if (state.view === 'recipes') loadRecipes();
      } catch (err) {
        error.textContent = err.message;
      }
    });
    $('#modal').classList.add('open');
  }

  function buildSpec(model) {
    const station = STATION_kinds.find((s) => s.id === model.station);
    const kind = station.kind;
    if (kind === 'custom') {
      let json;
      try {
        json = JSON.parse(model.raw);
      } catch (err) {
        throw new Error(`JSON 解析失败：${err.message}`);
      }
      return { kind: 'custom', json };
    }
    if (!model.output?.id && !model.output?.tag) throw new Error('请选择产物');
    const output = model.output.id;
    const count = Math.max(1, Number(model.count) || 1);

    if (kind === 'crafting' && model.ordered) {
      const filled = [];
      model.cells.forEach((cell, i) => {
        if (cell) filled.push([Math.floor(i / 3), i % 3, cell]);
      });
      if (!filled.length) throw new Error('至少放一个材料');
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const map = new Map();
      const keyMap = {};
      const pattern = ['', '', ''];
      for (const [r, c, cell] of filled) {
        const token = cell.tag ? `#${cell.tag}` : cell.id;
        if (!map.has(token)) {
          map.set(token, letters[map.size]);
          keyMap[letters[map.size - 1]] = token;
        }
        pattern[r] += map.get(token);
      }
      const rows = pattern.filter(Boolean);
      return { kind: 'shaped', output, count, pattern: rows, key: keyMap };
    }
    if (kind === 'crafting') {
      const list = model.ingredients.filter(Boolean).map((ing) => (ing.tag ? `#${ing.tag}` : ing.id));
      if (!list.length) throw new Error('至少放一个材料');
      return { kind: 'shapeless', output, count, ingredients: list };
    }
    if (['smelting', 'blasting', 'smoking', 'campfireCooking'].includes(kind)) {
      if (!model.input?.id) throw new Error('请选择输入');
      return { kind, output, count, input: model.input.id, xp: Number(model.xp) || 0, cookingTime: Number(model.time) || 200 };
    }
    if (kind === 'stonecutting') {
      if (!model.input?.id) throw new Error('请选择输入');
      return { kind, output, count, input: model.input.id };
    }
    if (kind === 'smithing') {
      if (!model.base?.id || !model.addition?.id) throw new Error('请选择底材与添加物');
      const spec = { kind, base: model.base.id, addition: model.addition.id, output, count };
      if (model.template?.id) spec.template = model.template.id;
      return spec;
    }
    if (kind === 'smithingTrim') {
      if (!model.template?.id) throw new Error('纹饰需要模板');
      if (!model.base?.id || !model.addition?.id) throw new Error('请选择底材与添加物');
      return { kind, template: model.template.id, base: model.base.id, addition: model.addition.id };
    }
    throw new Error('不支持的类型');
  }

  // ----------------------------------------------------------------- quests
  async function loadQuests() {
    if (!state.open) {
      $('#questCanvas').innerHTML = '<div class="empty">先打开一个整合包。</div>';
      return;
    }
    const data = await withBusy(() => api('/api/quests'));
    state.quests = data;
    const select = $('#questChapter');
    select.innerHTML = '<option value="">全部章节</option>';
    for (const chapter of data.chapters ?? []) {
      const option = document.createElement('option');
      option.value = chapter.file;
      option.textContent = chapter.title || chapter.filename || chapter.file;
      select.appendChild(option);
    }
    select.value = state.questChapter;
    $('#questCount').textContent = `${data.quests?.length ?? 0} 个任务 · ${data.chapters?.length ?? 0} 个章节`;
    applyQuestBackground();
    drawQuests();
  }

  $('#questChapter').addEventListener('change', (event) => {
    state.questChapter = event.target.value;
    drawQuests();
  });
  $('#questFit').addEventListener('click', () => drawQuests(true));

  function applyQuestBackground() {
    const canvas = $('#questCanvas');
    const ext = state.settings?.background;
    if (ext) {
      canvas.classList.add('has-bg');
      canvas.style.setProperty('--quest-bg', `url("${apiUrl('/api/background')}?v=${state.settings.backgroundAt ?? ''}")`);
    } else {
      canvas.classList.remove('has-bg');
      canvas.style.removeProperty('--quest-bg');
    }
  }

  $('#questBgFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await withBusy(() => post('/api/background', { type: file.type, data: reader.result }));
        state.settings.background = file.type.split('/').pop();
        await refreshState();
        applyQuestBackground();
        toast('任务背景已更新');
      } catch (err) {
        toast(err.message, true);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  });

  $('#questBgClear').addEventListener('click', async () => {
    try {
      await withBusy(() => post('/api/background', { clear: true }));
      state.settings.background = null;
      applyQuestBackground();
      toast('背景已移除');
    } catch (err) {
      toast(err.message, true);
    }
  });

  function drawQuests(autoFit = true) {
    const canvas = $('#questCanvas');
    const data = state.quests;
    canvas.innerHTML = '';
    if (!data || !data.quests?.length) {
      canvas.innerHTML = '<div class="empty">没有读到任务。确认 config/ftbquests/quests 里有章节文件。</div>';
      return;
    }
    const quests = state.questChapter ? data.quests.filter((q) => q.chapter === state.questChapter || q.chapter + '.snbt' === state.questChapter) : data.quests;

    // FTB stores quest positions in chapter units (often 0.5 steps), so snap
    // distinct x/y values onto a grid: it keeps the reading order and stops
    // long ids from stacking on top of each other
    const byChapter = new Map();
    for (const quest of quests) {
      if (!byChapter.has(quest.chapter)) byChapter.set(quest.chapter, []);
      byChapter.get(quest.chapter).push(quest);
    }
    const nodeW = 150;
    const nodeH = 46;
    const colW = nodeW + 26;
    const rowH = nodeH + 20;
    const positions = new Map();
    const chapterLabels = [];
    let offsetX = 0;
    for (const [chapter, list] of byChapter) {
      const uniq = (values) => [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
      const cols = uniq(list.map((q) => q.x));
      const rows = uniq(list.map((q) => q.y));
      for (const quest of list) {
        const col = cols.indexOf(Math.round(quest.x * 100) / 100);
        const row = rows.indexOf(Math.round(quest.y * 100) / 100);
        positions.set(quest.id, { x: offsetX + col * colW, y: row * rowH + 56, quest });
      }
      const chapterInfo = (data.chapters ?? []).find((c) => c.file === chapter || c.filename === chapter);
      chapterLabels.push({ label: chapterInfo?.title || chapter, x: offsetX, y: 28 });
      offsetX += Math.max(320, cols.length * colW + 90);
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pos of positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + nodeW);
      maxY = Math.max(maxY, pos.y + nodeH);
    }
    const pad = 60;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${width} ${height}`);

    const linkGroup = document.createElementNS(svg.namespaceURI, 'g');
    const nodeGroup = document.createElementNS(svg.namespaceURI, 'g');
    svg.append(linkGroup, nodeGroup);

    for (const pos of positions.values()) {
      for (const dep of pos.quest.dependencies ?? []) {
        const from = positions.get(dep);
        if (!from) continue;
        const path = document.createElementNS(svg.namespaceURI, 'path');
        const x1 = from.x + nodeW / 2;
        const y1 = from.y + nodeH / 2;
        const x2 = pos.x + nodeW / 2;
        const y2 = pos.y + nodeH / 2;
        const midX = (x1 + x2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class', 'quest-link');
        linkGroup.appendChild(path);
      }
    }

    for (const label of chapterLabels) {
      const text = document.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('x', label.x);
      text.setAttribute('y', label.y);
      text.setAttribute('class', 'quest-chapter-label');
      text.textContent = label.label;
      linkGroup.appendChild(text);
    }

    const GENERIC_ICONS = /^(custom_icon|book|unknown|missing|item|icon)$/i;
    const iconName = (icon) => {
      const id = typeof icon === 'string' ? icon : icon?.id;
      if (typeof id !== 'string') return '';
      const path = id.replace(/^[a-z0-9_.-]+:/i, '');
      // A custom_icon points at a texture, not at an item: it says nothing useful
      // about the quest, so fall back to the id label instead.
      if (GENERIC_ICONS.test(path) || /\bcustom_icon\b/i.test(path)) return '';
      return path;
    };
    const fitText = (value, max) => {
      const text = String(value ?? '');
      let width = 0;
      let out = '';
      for (const ch of text) {
        const next = /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
        if (width + next > max) return `${out}…`;
        width += next;
        out += ch;
      }
      return out;
    };

    for (const pos of positions.values()) {
      const group = document.createElementNS(svg.namespaceURI, 'g');
      group.setAttribute('class', 'quest-node');
      group.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      rect.setAttribute('width', nodeW);
      rect.setAttribute('height', nodeH);
      rect.setAttribute('rx', 8);
      group.appendChild(rect);
      const shortId = pos.quest.id ? `任务 ${pos.quest.id.slice(0, 6)}` : '任务';
      const label = pos.quest.title || pos.quest.subtitle || shortId;
      const detail = pos.quest.title
        ? pos.quest.subtitle || pos.quest.tasks?.map((t) => t.type).filter(Boolean).join(', ') || ''
        : iconName(pos.quest.icon) || pos.quest.tasks?.map((t) => t.type).filter(Boolean).join(', ') || '';
      const title = document.createElementNS(svg.namespaceURI, 'text');
      title.setAttribute('x', 9);
      title.setAttribute('y', 19);
      title.textContent = fitText(label, 34);
      group.appendChild(title);
      const idText = document.createElementNS(svg.namespaceURI, 'text');
      idText.setAttribute('x', 9);
      idText.setAttribute('y', 34);
      idText.setAttribute('class', 'qid');
      idText.textContent = fitText(detail || 'quest', 44);
      group.appendChild(idText);
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        showQuestDetail(pos.quest);
      });
      nodeGroup.appendChild(group);
    }

    canvas.appendChild(svg);
    if (autoFit || !canvas.dataset.fitted) canvas.dataset.fitted = '1';
    enablePanZoom(svg, canvas);
  }

  function enablePanZoom(svg, canvas) {
    let dragging = false;
    let start = null;
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const box = svg.viewBox.baseVal;
      const factor = event.deltaY > 0 ? 1.12 : 0.89;
      const rect = svg.getBoundingClientRect();
      const mx = box.x + ((event.clientX - rect.left) / rect.width) * box.width;
      const my = box.y + ((event.clientY - rect.top) / rect.height) * box.height;
      const nextW = box.width * factor;
      const nextH = box.height * factor;
      if (nextW < 120 || nextW > 40000) return;
      svg.setAttribute('viewBox', `${mx - (mx - box.x) * factor} ${my - (my - box.y) * factor} ${nextW} ${nextH}`);
    });
    svg.addEventListener('pointerdown', (event) => {
      dragging = true;
      start = { x: event.clientX, y: event.clientY };
      svg.classList.add('dragging');
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const box = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - start.x) / rect.width) * box.width;
      const dy = ((event.clientY - start.y) / rect.height) * box.height;
      svg.setAttribute('viewBox', `${box.x - dx} ${box.y - dy} ${box.width} ${box.height}`);
      start.x = event.clientX;
      start.y = event.clientY;
    });
    svg.addEventListener('pointerup', () => {
      dragging = false;
      svg.classList.remove('dragging');
    });
  }

  function showQuestDetail(quest) {
    const panel = $('#questDetail');
    panel.innerHTML = '';
    panel.appendChild(el('h3', null, quest.title || quest.id));
    panel.appendChild(el('div', 'sub', quest.id ?? ''));
    const chapter = el('section');
    chapter.appendChild(el('h4', null, '章节'));
    chapter.appendChild(el('div', 'hint', quest.chapter));
    panel.appendChild(chapter);
    const tasks = el('section');
    tasks.appendChild(el('h4', null, `任务（${quest.tasks?.length ?? 0}）`));
    if (!quest.tasks?.length) tasks.appendChild(el('div', 'hint', '没有任务'));
    for (const task of quest.tasks ?? []) {
      const row = el('div', 'row');
      row.appendChild(chip(task.type ?? '?'));
      row.appendChild(el('span', 'hint', task.id ?? ''));
      tasks.appendChild(row);
    }
    panel.appendChild(tasks);
    const rewards = el('section');
    rewards.appendChild(el('h4', null, `奖励（${quest.rewards?.length ?? 0}）`));
    if (!quest.rewards?.length) rewards.appendChild(el('div', 'hint', '没有奖励'));
    for (const reward of quest.rewards ?? []) {
      const row = el('div', 'row');
      row.appendChild(chip(reward.type ?? '?'));
      row.appendChild(el('span', 'hint', reward.id ?? ''));
      rewards.appendChild(row);
    }
    panel.appendChild(rewards);
    if (quest.description) {
      const description = el('section');
      description.appendChild(el('h4', null, '描述'));
      description.appendChild(el('div', 'hint', String(quest.description)));
      panel.appendChild(description);
    }
  }

  // --------------------------------------------------------------- settings
  async function renderSettings() {
    const data = await refreshState();
    $('#setRoot').value = '';
    $('#setClientJar').value = state.settings?.clientJar ?? '';
    renderPackTable(data.packs ?? []);
  }

  function renderPackTable(packs) {
    const box = $('#packTable');
    box.innerHTML = '';
    if (!packs.length) {
      box.appendChild(el('div', 'hint', '还没有保存的整合包。'));
      return;
    }
    const table = el('div', 'pack-table');
    for (const pack of packs) {
      const row = el('div', `pack-line${pack.active ? ' active' : ''}`);
      const info = el('div', 'pack-info');
      info.appendChild(el('b', null, pack.name ?? pack.path));
      info.appendChild(el('small', null, pack.path));
      row.appendChild(info);
      const open = el('button', pack.active ? 'ghost' : 'primary', pack.active ? '当前' : '打开');
      open.disabled = pack.active || !pack.exists;
      open.addEventListener('click', () => selectPack(pack.path));
      row.appendChild(open);
      const rename = el('button', 'ghost', '重命名');
      rename.addEventListener('click', async () => {
        const name = prompt('显示名称', pack.name ?? '');
        if (name === null) return;
        await withBusy(() => post('/api/packs', { op: 'rename', dir: pack.path, name }));
        await refreshState();
      });
      row.appendChild(rename);
      const remove = el('button', 'danger', '移除');
      remove.addEventListener('click', async () => {
        if (!confirm(`从列表移除 ${pack.path}？（不会删除文件）`)) return;
        await withBusy(() => post('/api/packs', { op: 'remove', dir: pack.path }));
        await refreshState();
        renderSettings();
      });
      row.appendChild(remove);
      table.appendChild(row);
    }
    box.appendChild(table);
  }

  $('#setOpen').addEventListener('click', async () => {
    const dir = $('#setRoot').value.trim();
    if (!dir) return;
    try {
      await withBusy(() => post('/api/packs', { op: 'add', dir }));
      resetIndexedViews();
      await refreshState();
      toast('已添加并打开');
      renderSettings();
      showView('overview');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#setSaveClient').addEventListener('click', async () => {
    try {
      await withBusy(() => post('/api/settings', { clientJar: $('#setClientJar').value.trim() }));
      await withBusy(() => post('/api/refresh', { scope: 'items' }));
      toast('已保存，物品索引已重扫');
      await refreshState();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#btnRescan').addEventListener('click', async () => {
    if (!state.open) return showView('settings');
    try {
      await withBusy(() => post('/api/refresh', { scope: 'all' }));
      await refreshState();
      toast('已重新检测');
      showView(state.view);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ------------------------------------------------------------------- boot
  function renderBrand() {
    $('#brandLogo').innerHTML = `
      <svg viewBox="0 0 16 16" width="30" height="30" aria-hidden="true">
        <rect width="16" height="16" rx="2" fill="#4f9c3f"/>
        <rect x="1" y="1" width="4" height="3" fill="#63b552"/>
        <rect x="7" y="2" width="3" height="2" fill="#3f8a34"/>
        <rect x="12" y="1" width="3" height="4" fill="#63b552"/>
        <rect x="2" y="7" width="2" height="3" fill="#3f8a34"/>
        <rect x="13" y="8" width="2" height="2" fill="#63b552"/>
        <rect x="2" y="3" width="4" height="4" fill="#111"/>
        <rect x="10" y="3" width="4" height="4" fill="#111"/>
        <rect x="4" y="9" width="8" height="3" fill="#111"/>
        <rect x="4" y="12" width="3" height="3" fill="#111"/>
        <rect x="9" y="12" width="3" height="3" fill="#111"/>
      </svg>`;
  }

  (async function boot() {
    renderBrand();
    try {
      const data = await refreshState();
      const wanted = location.hash.slice(1);
      showView(VIEWS.includes(wanted) ? wanted : data.open ? 'overview' : 'settings');
    } catch (err) {
      toast(err.message, true);
    }
  })();
})();
