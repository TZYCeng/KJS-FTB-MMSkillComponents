/* KJS workbench front-end: plain JS, no build step. */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const state = {
    open: false,
    root: null,
    detection: null,
    summary: null,
    items: { q: '', mod: '', page: 0, limit: 120, withIcon: false, total: 0 },
    selectedItem: null,
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

  function chip(text, tag = false) {
    const node = el('span', `chip${tag ? ' tag' : ''}`, text);
    return node;
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
            const label = el('span', 'lbl', slot.id.split(':').pop());
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
    const titles = { overview: '总览', items: '物品', recipes: '合成表', quests: '任务节点', settings: '设置' };
    $('#viewTitle').textContent = titles[name] ?? name;
    if (name === 'items') renderItems();
    if (name === 'recipes') loadRecipes();
    if (name === 'quests') loadQuests();
    if (name === 'settings') renderSettings();
    if (name === 'overview') renderOverview();
  }

  const VIEWS = ['overview', 'items', 'recipes', 'quests', 'settings'];

  for (const button of $$('#nav button')) {
    button.addEventListener('click', () => showView(button.dataset.view));
  }

  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (name && name !== state.view) showView(name);
  });

  // ------------------------------------------------------------------ state
  async function refreshState() {
    const data = await api('/api/state');
    state.open = Boolean(data.open);
    state.root = data.root ?? null;
    state.detection = data.detection ?? null;
    state.summary = data.summary ?? '';
    if (!state.open) {
      $('#packMini').textContent = '未打开整合包';
      $('#pillPack').textContent = '—';
      return data;
    }
    $('#packMini').innerHTML = `<b>${esc(state.root.split(/[\\/]/).pop())}</b>${esc(state.root)}`;
    const mc = state.detection?.minecraft?.version ?? 'MC ?';
    const gen = state.detection?.kubejs?.generation ?? '?';
    $('#pillPack').textContent = `${mc} · ${gen}${state.detection?.kubejs?.generationAssumed ? ' (假设)' : ''}`;
    $('#pillPack').title = `${state.detection?.kubejs?.generationLabel ?? ''}\n判定依据: ${state.detection?.kubejs?.generationSource ?? '未知'}`;
    fillRecipeTypes(data.recipeTypes);
    applyBackground(data.settings);
    return data;
  }

  function applyBackground(settings) {
    const ext = settings?.background;
    if (ext) {
      document.body.classList.add('has-bg');
      document.body.style.setProperty('--bg-image', `url("${apiUrl('/api/background')}?v=${settings.backgroundAt ?? ''}")`);
    } else {
      document.body.classList.remove('has-bg');
      document.body.style.removeProperty('--bg-image');
    }
  }

  // --------------------------------------------------------------- overview
  async function renderOverview() {
    const body = $('#overviewBody');
    const data = await withBusy(() => refreshState());
    body.innerHTML = '';
    if (!data.open) {
      body.innerHTML = '<div class="empty">还没有打开整合包。到「设置」里填一个整合包目录，或者在启动时用 <code>kjsftb ui &lt;目录&gt;</code> 直接打开。</div>';
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
    addCard('整合包', d.name ?? state.root.split(/[\\/]/).pop(), state.root);
    addCard('Minecraft', d.minecraft?.version ?? '?', `${d.minecraft?.loader ?? '?'} ${d.minecraft?.loaderVersion ?? ''}`);
    addCard('KubeJS', d.kubejs?.installed ? (d.kubejs.version ?? '已安装') : '未安装', `${d.kubejs?.generationLabel ?? d.kubejs?.generation ?? ''} · ${d.kubejs?.syntax ?? ''}`);
    addCard('FTB Quests', d.ftbQuests?.installed ? (d.ftbQuests.version ?? '已安装') : '未安装', d.ftbQuests?.hasLangFiles ? '任务文本在 lang/ 里' : '');
    addCard('物品', data.items?.items ?? 0, `${data.items?.withIcon ?? 0} 个有图标 · ${data.items?.jars ?? 0} 个 jar`);
    addCard('合成表', data.recipes?.recipes ?? 0, `${data.recipes?.scriptOps ?? 0} 条脚本改动`);
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
      '物品页：SQL 式搜索，点开任意物品能看到「怎么合成」和「用来做什么」。',
      '合成表页：按产出物品搜索已有配方，可以直接删除，也可以新建配方；所有改动会写进 <code>kubejs/server_scripts/zz_kjsftb_edits.js</code>，进游戏 <code>/reload</code> 生效。',
      '任务节点页：读 FTB Quests 的 SNBT，按章节画成图；点节点看任务/奖励。',
      '想让物品清单 100% 准确？进游戏跑一次 <code>/kubejs export</code>，再点「重新扫描」。',
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
    if (!data.items.length) {
      grid.innerHTML = '<div class="empty">没有匹配的物品。</div>';
    }
    for (const rec of data.items) {
      const node = el('div', 'item');
      node.title = `${rec.name}\n${rec.id}${rec.mod ? `\nmod: ${rec.mod}` : ''}`;
      node.appendChild(iconNode(rec));
      const meta = el('div', 'meta');
      const name = el('div', 'name', rec.name);
      name.title = rec.name;
      const id = el('div', 'id', rec.id);
      id.title = rec.id;
      meta.appendChild(name);
      meta.appendChild(id);
      node.appendChild(meta);
      node.addEventListener('click', () => selectItem(rec));
      grid.appendChild(node);
    }
    const from = state.items.total ? state.items.page * state.items.limit + 1 : 0;
    const to = Math.min(state.items.total, (state.items.page + 1) * state.items.limit);
    $('#itemCount').textContent = `${from}-${to} / 共 ${state.items.total} 个物品`;
    $('#itemPrev').disabled = state.items.page === 0;
    $('#itemNext').disabled = to >= state.items.total;
    if (!$('#itemMod').dataset.filled) fillModFilter(data.mods ?? []);
    if (state.selectedItem) selectItem(state.selectedItem, true);
  }

  async function fillModFilter(mods) {
    const select = $('#itemMod');
    const list = mods.length ? mods : (await api('/api/state')).mods ?? [];
    for (const mod of list) {
      const option = document.createElement('option');
      option.value = mod.id;
      option.textContent = `${mod.name ?? mod.id} (${mod.id})`;
      select.appendChild(option);
    }
    select.dataset.filled = '1';
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
    newButton.addEventListener('click', () => openRecipeModal({ output: rec.id }));
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
      head.appendChild(el('span', 'type', recipe.type.replace(/^minecraft:/, '')));
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
  let recipeTimer = null;
  let recipeOffset = 0;
  async function loadRecipes(query = $('#recipeSearch').value.trim(), append = false) {
    if (!state.open) {
      $('#recipeList').innerHTML = '<div class="empty">先打开一个整合包。</div>';
      return;
    }
    if (!append) recipeOffset = 0;
    const params = new URLSearchParams({ limit: '40', offset: String(recipeOffset) });
    const type = $('#recipeType').value;
    if (type) params.set('type', type);
    if (query) params.set(query.includes(':') ? 'output' : 'q', query);
    const data = await withBusy(() => api(`/api/recipes?${params}`));
    const list = $('#recipeList');
    if (!append) list.innerHTML = '';
    if (!data.recipes.length && !append) list.innerHTML = '<div class="empty">没有匹配的配方。</div>';
    for (const recipe of data.recipes) list.appendChild(recipeCard(recipe));
    recipeOffset += data.recipes.length;
    $('#recipeCount').textContent = `${data.total} 条配方${query ? '（已筛选）' : ''}`;
    $('#recipeMore').disabled = recipeOffset >= data.total;
    $('#recipeMoreHint').textContent = recipeOffset >= data.total ? '' : `已显示 ${recipeOffset} / ${data.total}`;
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
    head.appendChild(el('span', 'type', recipe.type.replace(/^minecraft:/, '')));
    head.appendChild(el('span', 'rid', recipe.id));
    if (recipe.source === 'script') head.appendChild(el('span', 'chip tag', '脚本'));
    head.appendChild(el('span', 'spacer')).style.flex = '1';
    const remove = el('button', 'danger', '删除配方');
    remove.addEventListener('click', async () => {
      if (!confirm(`删除配方 ${recipe.id}？会写进 zz_kjsftb_edits.js，进游戏 /reload 后生效。`)) return;
      await withBusy(() => api('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'remove', id: recipe.id }) }));
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
          await withBusy(() => api('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'drop', index }) }));
          loadEdits();
        });
        head.appendChild(drop);
        row.appendChild(head);
        box.appendChild(row);
      });
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
  $('#btnClearEdits').addEventListener('click', async () => {
    if (!confirm('清空工作台写入的所有改动？')) return;
    await withBusy(() => api('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'clear' }) }));
    toast('已清空');
    loadRecipes();
  });
  $('#btnNewRecipe').addEventListener('click', () => openRecipeModal());

  // ----------------------------------------------------------- recipe modal
  const RECIPE_KINDS = [
    ['shaped', '有序合成（工作台）'],
    ['shapeless', '无序合成'],
    ['smelting', '熔炉'],
    ['blasting', '高炉'],
    ['smoking', '烟熏炉'],
    ['campfireCooking', '营火'],
    ['stonecutting', '切石机'],
    ['smithing', '锻造台（升级）'],
    ['smithingTrim', '锻造台（纹饰）'],
    ['custom', '自定义 JSON'],
  ];

  function openRecipeModal(prefill = {}) {
    const backdrop = $('#modal');
    const body = $('#modalBody');
    body.innerHTML = '';
    body.appendChild(el('h2', null, '新建配方'));

    const grid = el('div', 'form-grid');
    const addRow = (label, node) => {
      const labelNode = el('label', null, label);
      grid.appendChild(labelNode);
      grid.appendChild(node);
      node.__label = labelNode;
      return node;
    };

    const kind = document.createElement('select');
    for (const [value, label] of RECIPE_KINDS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      kind.appendChild(option);
    }
    addRow('类型', kind);

    const output = document.createElement('input');
    output.type = 'text';
    output.placeholder = 'minecraft:chest';
    output.value = prefill.output ?? '';
    addRow('产出物品 id', output);

    const count = document.createElement('input');
    count.type = 'number';
    count.min = '1';
    count.value = '1';
    addRow('产出数量', count);

    const inputs = document.createElement('textarea');
    inputs.rows = 4;
    inputs.placeholder = '一行一个材料，例如：\n#minecraft:planks\nminecraft:stick';
    addRow('材料（shapeless / 烹饪类）', inputs);

    const pattern = document.createElement('textarea');
    pattern.rows = 3;
    pattern.placeholder = 'AAA\nABA\nAAA';
    addRow('合成图案（shaped，3 行）', pattern);

    const key = document.createElement('textarea');
    key.rows = 2;
    key.placeholder = 'A=minecraft:oak_planks\nB=#minecraft:planks';
    addRow('图案映射（shaped）', key);

    const template = document.createElement('input');
    template.type = 'text';
    template.placeholder = 'minecraft:netherite_upgrade_smithing_template（可空）';
    addRow('锻造模板（smithing）', template);

    const raw = document.createElement('textarea');
    raw.rows = 6;
    raw.placeholder = '{"type":"minecraft:crafting_shaped", ...}';
    addRow('自定义 JSON', raw);

    body.appendChild(grid);

    const actions = el('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '14px';
    const submit = el('button', 'primary', '写入改动');
    const cancel = el('button', 'ghost', '取消');
    actions.append(submit, cancel);
    body.appendChild(actions);
    const error = el('div', 'error');
    body.appendChild(error);

    const sync = () => {
      const kindValue = kind.value;
      // hide the label and its control together: hiding only the control would
      // shift every following cell one column to the left
      const show = (node, on) => {
        const label = node.__label;
        for (const child of [node, label]) {
          if (child) child.style.display = on ? '' : 'none';
        }
      };
      show(inputs, ['shapeless'].includes(kindValue));
      show(pattern, kindValue === 'shaped');
      show(key, kindValue === 'shaped');
      show(template, kindValue === 'smithing');
      show(raw, kindValue === 'custom');
      show(count, kindValue !== 'custom');
    };
    kind.addEventListener('change', sync);
    sync();

    cancel.addEventListener('click', () => backdrop.classList.remove('open'));
    submit.addEventListener('click', async () => {
      error.textContent = '';
      let spec;
      try {
        spec = buildSpec(kind.value, { output: output.value.trim(), count: Number(count.value) || 1, inputs: inputs.value, pattern: pattern.value, key: key.value, template: template.value.trim(), raw: raw.value });
      } catch (err) {
        error.textContent = err.message;
        return;
      }
      try {
        await withBusy(() => api('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'add', spec }) }));
        backdrop.classList.remove('open');
        toast('已写入 zz_kjsftb_edits.js，进游戏 /reload 生效');
        if (state.view === 'recipes') loadRecipes();
      } catch (err) {
        error.textContent = err.message;
      }
    });
    backdrop.classList.add('open');
  }

  function buildSpec(kindValue, form) {
    const lines = form.inputs.split('\n').map((s) => s.trim()).filter(Boolean);
    if (kindValue === 'custom') {
      let json;
      try {
        json = JSON.parse(form.raw);
      } catch (err) {
        throw new Error(`JSON 解析失败：${err.message}`);
      }
      return { kind: 'custom', json };
    }
    if (!form.output) throw new Error('请填产出物品 id');
    if (kindValue === 'shaped') {
      const rows = form.pattern.split('\n').map((s) => s.trim()).filter(Boolean);
      if (rows.length === 0) throw new Error('请填合成图案');
      const keyMap = {};
      for (const line of form.key.split('\n').map((s) => s.trim()).filter(Boolean)) {
        const m = /^(\S)\s*=\s*(.+)$/.exec(line);
        if (m) keyMap[m[1]] = m[2];
      }
      if (Object.keys(keyMap).length === 0) throw new Error('请填图案映射，例如 A=minecraft:oak_planks');
      return { kind: 'shaped', output: form.output, count: form.count, pattern: rows, key: keyMap };
    }
    if (kindValue === 'shapeless') {
      if (!lines.length) throw new Error('请至少填一个材料');
      return { kind: 'shapeless', output: form.output, count: form.count, ingredients: lines };
    }
    if (['smelting', 'blasting', 'smoking', 'campfireCooking', 'stonecutting'].includes(kindValue)) {
      if (!lines.length) throw new Error('请填输入材料');
      return { kind: kindValue, output: form.output, count: form.count, input: lines[0] };
    }
    if (kindValue === 'smithing') {
      if (lines.length < 2) throw new Error('锻造需要 base 与 addition 两行材料');
      return { kind: 'smithing', output: form.output, count: form.count, base: lines[0], addition: lines[1], ...(form.template ? { template: form.template } : {}) };
    }
    if (kindValue === 'smithingTrim') {
      if (!form.template) throw new Error('纹饰需要模板物品');
      if (lines.length < 2) throw new Error('纹饰需要 base 与 addition 两行材料');
      return { kind: 'smithingTrim', template: form.template, base: lines[0], addition: lines[1] };
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
      option.textContent = chapter.filename ?? chapter.file;
      select.appendChild(option);
    }
    select.value = state.questChapter;
    $('#questCount').textContent = `${data.quests?.length ?? 0} 个任务 · ${data.chapters?.length ?? 0} 个章节`;
    drawQuests();
  }

  $('#questChapter').addEventListener('change', (event) => {
    state.questChapter = event.target.value;
    drawQuests();
  });
  $('#questFit').addEventListener('click', () => drawQuests(true));

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
      chapterLabels.push({ label: chapter, x: offsetX, y: 28 });
      offsetX += Math.max(320, cols.length * colW + 90);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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

    const iconName = (icon) => {
      const id = typeof icon === 'string' ? icon : icon?.id;
      return typeof id === 'string' ? id.replace(/^[a-z0-9_.-]+:/i, '') : '';
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
      const label = pos.quest.title || pos.quest.subtitle || iconName(pos.quest.icon) || pos.quest.id || '';
      const detail = pos.quest.title
        ? pos.quest.subtitle || pos.quest.tasks?.map((t) => t.type).filter(Boolean).join(', ') || ''
        : pos.quest.tasks?.map((t) => t.type).filter(Boolean).join(', ') || '';
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
    if (autoFit || !canvas.dataset.fitted) {
      canvas.dataset.fitted = '1';
    }
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
      start = { x: event.clientX, y: event.clientY, box: svg.viewBox.baseVal.toString() };
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
      description.appendChild(el('div', 'hint', Array.isArray(quest.description) ? quest.description.join('\n') : String(quest.description)));
      panel.appendChild(description);
    }
  }

  // --------------------------------------------------------------- settings
  async function renderSettings() {
    const data = await api('/api/state');
    $('#setRoot').value = data.root ?? '';
    const settings = data.settings ?? {};
    $('#setClientJar').value = settings.clientJar ?? '';
    applyBackground(settings);
  }

  $('#setOpen').addEventListener('click', async () => {
    const dir = $('#setRoot').value.trim();
    if (!dir) return;
    try {
      await withBusy(async () => {
        await api('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir }) });
      });
      toast('已打开整合包');
      await refreshState();
      $('#itemMod').dataset.filled = '';
      showView('overview');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#setSaveClient').addEventListener('click', async () => {
    try {
      await withBusy(() => api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientJar: $('#setClientJar').value.trim() }) }));
      toast('已保存，下次扫描会使用客户端 jar');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#bgFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await withBusy(() => api('/api/background', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: file.type, data: reader.result }) }));
        toast('背景已更新');
        await refreshState();
      } catch (err) {
        toast(err.message, true);
      }
    };
    reader.readAsDataURL(file);
  });

  $('#bgClear').addEventListener('click', async () => {
    try {
      await withBusy(() => api('/api/background', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clear: true }) }));
      document.body.classList.remove('has-bg');
      toast('背景已移除');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#btnOpen').addEventListener('click', () => showView('settings'));
  $('#btnRescan').addEventListener('click', async () => {
    if (!state.open) return showView('settings');
    try {
      await withBusy(async () => {
        await api('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: state.root }) });
      });
      await refreshState();
      toast('已重新扫描');
      showView(state.view);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ------------------------------------------------------------------- boot
  (async function boot() {
    try {
      const data = await refreshState();
      const wanted = location.hash.slice(1);
      showView(VIEWS.includes(wanted) ? wanted : data.open ? 'overview' : 'settings');
    } catch (err) {
      toast(err.message, true);
    }
  })();
})();
