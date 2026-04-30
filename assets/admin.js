/* OʻzJOKU admin panel — section-based editor with photo slots.
 * Rendering is split into three independent regions (topbar / sidebar /
 * pane) so a state change updates only what changed, never blowing away
 * the user's focus or scroll position. Save always refetches the dict
 * afterwards so the UI matches what was actually written to disk. */
(() => {
  const root = document.getElementById('app');
  const SECTIONS = window.ADMIN_SECTIONS || [];
  const HIDDEN   = new Set(window.ADMIN_HIDDEN_KEYS || []);
  const LANGS    = ['ru', 'uz', 'en'];

  const state = {
    authed: false, configured: true,
    dict: null,
    photos: [],
    dirty: new Set(),
    saving: false,
    filter: '',
    activeSection: null,
    pickerSlot: null,
  };

  /* ---------- DOM helper ---------- */
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return el;
  };

  function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(async r => {
      let data = {};
      try { data = await r.json(); } catch {}
      if (!r.ok) {
        const err = new Error(data.error ? `${data.error}` : `HTTP ${r.status}`);
        err.status = r.status; err.data = data;
        throw err;
      }
      return data;
    });
  }

  let toastTimer = null;
  function toast(msg, kind = '', longLived = false) {
    let el = document.querySelector('.toast');
    if (!el) { el = h('div', { class: 'toast' }); document.body.appendChild(el); }
    el.className = 'toast show ' + (kind || '');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), longLived ? 6000 : 2400);
  }

  function bufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /* ---------- bootstrap ---------- */
  api('/api/me').then(me => {
    state.authed = !!me.authed;
    state.configured = !!me.configured;
    if (state.authed) loadAll().then(renderApp); else renderLoginScreen();
  }).catch(() => { state.configured = true; renderLoginScreen(); });

  async function loadAll() {
    const [dict, uploads] = await Promise.all([
      api('/api/i18n'),
      api('/api/uploads').catch(() => ({ files: [] })),
    ]);
    state.dict = dict;
    state.photos = uploads.files || [];
    state.dirty.clear();
    if (!state.activeSection && SECTIONS[0]) state.activeSection = SECTIONS[0].id;
  }

  /* ---------- login ---------- */
  function renderLoginScreen() {
    root.innerHTML = '';
    const wrap = h('div', { class: 'login-wrap' });
    const err = h('div', { class: 'err' });
    const submit = h('button', { type: 'submit' }, 'Войти');
    const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const card = h('form', { class: 'login', onsubmit: onSubmit },
      h('h1', {}, 'Админ-панель'),
      h('p', {}, state.configured
        ? 'Введите пароль администратора, заданный в переменной ADMIN_PASSWORD.'
        : 'Сервер запущен без ADMIN_PASSWORD/ADMIN_SECRET — админ-панель отключена.'),
      h('div', { class: 'row' }, h('label', {}, 'Пароль'), pw),
      submit, err,
    );
    if (!state.configured) { pw.disabled = true; submit.disabled = true; }
    wrap.append(card);
    root.append(wrap);
    setTimeout(() => pw.focus(), 0);

    async function onSubmit(e) {
      e.preventDefault();
      err.textContent = ''; submit.disabled = true; submit.textContent = 'Проверка…';
      try {
        await api('/api/login', { method: 'POST', body: { password: pw.value } });
        state.authed = true;
        await loadAll();
        renderApp();
      } catch (ex) {
        err.textContent = ex.status === 401 ? 'Неверный пароль' : (ex.message || 'Ошибка');
        submit.disabled = false; submit.textContent = 'Войти';
      }
    }
  }

  /* ---------- main shell (rendered once after login) ---------- */
  function renderApp() {
    root.innerHTML = '';
    const app = h('div', { class: 'app' });
    app.append(buildTopbar());
    const wrap = h('div', { class: 'workspace' });
    wrap.append(buildSidebar());
    wrap.append(h('main', { class: 'pane' }, buildPane()));
    app.append(wrap);
    root.append(app);
    bindBeforeUnload();
  }

  /* ---------- topbar ---------- */
  function buildTopbar() {
    const search = h('input', {
      class: 'search', type: 'search', placeholder: 'Поиск по полю или содержимому…',
      value: state.filter,
      oninput: e => {
        state.filter = e.target.value;
        // re-render only the regions that depend on filter; keep topbar
        // (and the search input itself) intact so focus is preserved
        replaceRegion('.sidebar', buildSidebar());
        replaceRegion('.pane', h('main', { class: 'pane' }, buildPane()));
      },
    });
    const saveBtn = h('button', {
      class: 'btn btn-primary save-btn', onclick: onSave,
    }, '');
    refreshSaveBtn(saveBtn);
    const openSite = h('a', { href: '/', target: '_blank', class: 'btn btn-ghost' }, 'Открыть сайт');
    const logout = h('button', { class: 'logout', onclick: onLogout }, 'Выйти');
    return h('div', { class: 'topbar' },
      h('div', { class: 'logo' }, 'O', h('em', {}, 'ʻz'), 'JOKU · admin'),
      search,
      h('div', { class: 'spacer' }),
      openSite,
      saveBtn,
      logout,
    );
  }

  function refreshSaveBtn(btn) {
    if (!btn) btn = root.querySelector('.save-btn');
    if (!btn) return;
    const dn = state.dirty.size;
    btn.disabled = (dn === 0) || state.saving;
    btn.textContent = state.saving ? 'Сохранение…' : (dn ? `Сохранить (${dn})` : 'Сохранено');
    btn.classList.toggle('is-saving', state.saving);
  }

  async function onLogout() {
    if (state.dirty.size && !confirm('Есть несохранённые изменения. Выйти и потерять их?')) return;
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    state.authed = false;
    state.dirty.clear();
    renderLoginScreen();
  }

  /* ---------- sidebar ---------- */
  function buildSidebar() {
    const list = h('div', { class: 'side-list' });
    const sections = visibleSections();
    sections.forEach(s => {
      const dn = countDirtyInSection(s);
      list.append(h('button', {
        class: 'side-link' + (s.id === state.activeSection ? ' active' : '') + (dn ? ' has-dirty' : ''),
        onclick: () => {
          state.activeSection = s.id;
          // re-render sidebar (active marker) and pane (new section)
          replaceRegion('.sidebar', buildSidebar());
          replaceRegion('.pane', h('main', { class: 'pane' }, buildPane()));
        },
      },
        h('span', { class: 'side-title' }, s.title),
        s.photos ? h('span', { class: 'side-photo', title: 'есть фото-слоты' }, '🖼') : null,
        dn ? h('span', { class: 'side-count' }, String(dn)) : null,
      ));
    });
    if (sections.length === 0) list.append(h('div', { class: 'empty' }, 'Ничего не найдено'));
    return h('aside', { class: 'sidebar' }, list);
  }

  function visibleSections() {
    const sections = SECTIONS.slice();
    const known = new Set();
    for (const s of sections) {
      for (const f of (s.fields || [])) known.add(f.key);
      for (const p of (s.photos || [])) known.add(p.key);
    }
    if (state.dict) {
      const leftover = Object.keys(state.dict.ru || {})
        .filter(k => !known.has(k) && !HIDDEN.has(k));
      if (leftover.length) {
        sections.push({
          id: '_other', title: 'Прочие ключи',
          hint: 'Ключи, не привязанные ни к одной секции — старые/служебные.',
          fields: leftover.map(k => ({ key: k, label: k })),
        });
      }
    }
    const f = state.filter.trim().toLowerCase();
    if (!f) return sections;
    return sections.filter(s => sectionMatches(s, f));
  }

  function sectionMatches(s, f) {
    if (s.title.toLowerCase().includes(f)) return true;
    for (const fd of (s.fields || [])) {
      if (fd.label.toLowerCase().includes(f)) return true;
      if (fd.key.toLowerCase().includes(f)) return true;
      for (const lang of LANGS) {
        const v = state.dict && state.dict[lang] && state.dict[lang][fd.key];
        if (typeof v === 'string' && v.toLowerCase().includes(f)) return true;
      }
    }
    for (const p of (s.photos || [])) {
      if (p.label.toLowerCase().includes(f)) return true;
      if (p.key.toLowerCase().includes(f)) return true;
    }
    return false;
  }

  function countDirtyInSection(s) {
    let n = 0;
    for (const f of (s.fields || [])) if (state.dirty.has(f.key)) n++;
    for (const p of (s.photos || [])) if (state.dirty.has(p.key)) n++;
    return n;
  }

  /* ---------- pane (active section body) ---------- */
  function buildPane() {
    const sections = visibleSections();
    let s = sections.find(x => x.id === state.activeSection);
    if (!s) { s = sections[0]; if (s) state.activeSection = s.id; }
    if (!s) return h('div', { class: 'empty pane-empty' }, 'Нет секций для отображения');

    const head = h('div', { class: 'section-head' },
      h('h1', {}, s.title),
      s.hint ? h('p', { class: 'hint' }, s.hint) : null,
      s.open ? h('a', { href: s.open, target: '_blank', class: 'open-site' }, 'Открыть на сайте ↗') : null,
    );

    const body = h('div', { class: 'section-body' });

    if (s.photos && s.photos.length) {
      const block = h('div', { class: 'photos-block' },
        h('h2', { class: 'block-title' }, 'Фотографии'),
      );
      for (const p of s.photos) block.append(buildPhotoSlot(p));
      body.append(block);
    }

    if (s.fields && s.fields.length) {
      const block = h('div', { class: 'fields-block' },
        h('h2', { class: 'block-title' }, 'Тексты'),
        h('div', { class: 'lang-head' }, h('div', {}), h('div', {}, 'RU'), h('div', {}, 'UZ'), h('div', {}, 'EN')),
      );
      const rows = h('div', { class: 'rows' });
      for (const f of s.fields) rows.append(buildFieldRow(f));
      block.append(rows);
      body.append(block);
    }

    return h('div', { class: 'section' }, head, body);
  }

  function refreshPane() {
    replaceRegion('.pane', h('main', { class: 'pane' }, buildPane()));
  }

  /* ---------- photo slot ---------- */
  function buildPhotoSlot(p) {
    const url = state.dict && state.dict.ru ? (state.dict.ru[p.key] || '') : '';
    const dirty = state.dirty.has(p.key);
    const preview = h('div', { class: 'slot-preview' + (url ? '' : ' empty') });
    if (url) preview.append(h('img', { src: url, alt: p.label, loading: 'lazy' }));
    else preview.append(h('span', {}, 'не выбрано'));

    return h('div', { class: 'slot' + (url ? ' has-photo' : '') + (dirty ? ' dirty' : '') },
      preview,
      h('div', { class: 'slot-meta' },
        h('div', { class: 'slot-label' }, p.label, dirty ? h('span', { class: 'dirty-dot', title: 'не сохранено' }, ' ●') : null),
        p.hint ? h('div', { class: 'slot-hint' }, p.hint) : null,
        h('div', { class: 'slot-url' + (url ? '' : ' muted') }, url || '— нет фото —'),
      ),
      h('div', { class: 'slot-actions' },
        h('button', { class: 'btn', onclick: () => openPicker(p.key) }, 'Выбрать или загрузить'),
        url ? h('button', { class: 'btn btn-danger', onclick: () => clearSlot(p.key) }, 'Очистить') : null,
      ),
    );
  }

  function setSlotUrl(slotKey, url) {
    if (!state.dict) return;
    for (const lang of LANGS) {
      if (!state.dict[lang]) state.dict[lang] = {};
      state.dict[lang][slotKey] = url;
    }
    state.dirty.add(slotKey);
    refreshSaveBtn();
    replaceRegion('.sidebar', buildSidebar());
    refreshPane();
  }
  function clearSlot(slotKey) { setSlotUrl(slotKey, ''); }

  /* ---------- picker modal ---------- */
  function openPicker(slotKey) {
    state.pickerSlot = slotKey;
    document.body.append(buildPicker());
  }
  function closePicker() {
    state.pickerSlot = null;
    document.querySelector('.modal-backdrop')?.remove();
  }
  function buildPicker() {
    const slotKey = state.pickerSlot;
    const slot = SECTIONS.flatMap(s => s.photos || []).find(p => p.key === slotKey);

    const backdrop = h('div', {
      class: 'modal-backdrop',
      onclick: e => { if (e.target === backdrop) closePicker(); },
    });
    const onEsc = e => { if (e.key === 'Escape') { closePicker(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);

    const fileInput = h('input', { type: 'file', accept: 'image/*', onchange: e => uploadAndAssign(e.target.files && e.target.files[0]) });
    const dz = h('div', { class: 'dz' },
      h('strong', {}, 'Загрузить новое фото'),
      h('small', {}, 'jpg / png / webp / svg / avif · до 25 MB'),
      h('button', { class: 'btn btn-primary', onclick: () => fileInput.click() }, 'Выбрать файл'),
      fileInput,
    );
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) uploadAndAssign(f);
    });

    const lib = h('div', { class: 'lib-grid' });
    if (state.photos.length === 0) {
      lib.append(h('div', { class: 'empty' }, 'Библиотека пуста — загрузите первое фото слева.'));
    } else {
      for (const f of state.photos) {
        lib.append(h('button', {
          class: 'lib-item',
          onclick: () => { setSlotUrl(slotKey, f.url); toast('Фото назначено в слот', 'good'); closePicker(); },
        },
          h('img', { src: f.url, alt: f.name, loading: 'lazy' }),
          h('span', { class: 'lib-name', title: f.name }, f.name),
        ));
      }
    }

    backdrop.append(h('div', { class: 'modal' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('div', { class: 'modal-title' }, 'Фото для слота: ' + (slot ? slot.label : slotKey)),
          h('div', { class: 'modal-sub' }, 'Загрузите новое или выберите из уже существующих. Назначение сразу попадёт в слот, но не забудьте нажать «Сохранить».'),
        ),
        h('button', { class: 'modal-close', onclick: closePicker, title: 'Закрыть' }, '×'),
      ),
      h('div', { class: 'modal-body' },
        h('div', { class: 'modal-col' }, dz),
        h('div', { class: 'modal-col modal-col-wide' },
          h('div', { class: 'lib-head' }, 'Библиотека (' + state.photos.length + ')'),
          lib,
        ),
      ),
    ));
    return backdrop;

    async function uploadAndAssign(file) {
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const dataBase64 = bufferToBase64(buf);
        const resp = await api('/api/upload', { method: 'POST', body: {
          name: file.name, contentType: file.type || 'application/octet-stream', dataBase64,
        }});
        state.photos.unshift({ name: resp.name, url: resp.url, size: resp.size, mtime: Date.now() });
        setSlotUrl(slotKey, resp.url);
        toast('Загружено и назначено', 'good');
        closePicker();
      } catch (ex) {
        toast(formatError('Ошибка загрузки', ex), 'bad', true);
      }
    }
  }

  /* ---------- text fields ---------- */
  function buildFieldRow(f) {
    const dirty = state.dirty.has(f.key);
    const row = h('div', { class: 'field-row' + (dirty ? ' dirty' : ''), 'data-key': f.key });
    row.append(h('div', { class: 'field-label' },
      h('div', { class: 'field-title' }, f.label),
      h('div', { class: 'field-key' }, f.key),
    ));
    for (const lang of LANGS) row.append(h('div', { class: 'field-cell', 'data-lang': lang.toUpperCase() }, mkArea(f, lang)));
    return row;
  }

  function mkArea(f, lang) {
    const v = state.dict && state.dict[lang] ? (state.dict[lang][f.key] ?? '') : '';
    const cls = f.type === 'html' ? 'ta html-mode' : (f.type === 'multi' ? 'ta multi' : 'ta');
    const ta = h('textarea', {
      class: cls, spellcheck: f.type !== 'html', value: v,
      oninput: e => {
        if (!state.dict[lang]) state.dict[lang] = {};
        state.dict[lang][f.key] = e.target.value;
        state.dirty.add(f.key);
        // mark this row dirty without rebuilding the textarea (would lose focus)
        const row = e.target.closest('.field-row');
        if (row) row.classList.add('dirty');
        refreshSaveBtn();
        // sidebar count is cheap to refresh; no focus impact (sidebar is elsewhere)
        replaceRegion('.sidebar', buildSidebar());
        autosize(e.target);
      },
    });
    requestAnimationFrame(() => autosize(ta));
    return ta;
  }
  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(600, ta.scrollHeight + 2) + 'px';
  }

  /* ---------- save ---------- */
  async function onSave() {
    if (state.saving || state.dirty.size === 0) return;
    state.saving = true; refreshSaveBtn();
    try {
      await api('/api/i18n', { method: 'POST', body: state.dict });
      // refetch from disk to make sure UI matches what was actually written
      const fresh = await api('/api/i18n');
      state.dict = fresh;
      state.dirty.clear();
      // also refresh photo library in case any uploads happened in parallel
      try { state.photos = (await api('/api/uploads')).files || []; } catch {}
      // full repaint of sidebar + pane → all dirty highlights gone
      replaceRegion('.sidebar', buildSidebar());
      refreshPane();
      flashSaved();
      toast('Сохранено', 'good');
    } catch (ex) {
      console.error('save failed', ex);
      toast(formatError('Не удалось сохранить', ex), 'bad', true);
    } finally {
      state.saving = false; refreshSaveBtn();
    }
  }

  function flashSaved() {
    document.querySelectorAll('.field-row, .slot').forEach(el => {
      el.classList.remove('dirty');
      el.classList.add('flash-ok');
      setTimeout(() => el.classList.remove('flash-ok'), 700);
    });
  }

  function formatError(prefix, ex) {
    let msg = prefix;
    if (ex && ex.status) msg += ` (HTTP ${ex.status})`;
    if (ex && ex.message) msg += ': ' + ex.message;
    return msg;
  }

  /* ---------- region replacement ---------- */
  function replaceRegion(selector, fresh) {
    const cur = root.querySelector(selector);
    if (cur) cur.replaceWith(fresh);
  }

  /* ---------- unload guard ---------- */
  function bindBeforeUnload() {
    if (window.__uzj_admin_unload_bound) return;
    window.__uzj_admin_unload_bound = true;
    window.addEventListener('beforeunload', e => {
      if (state.dirty.size > 0 && !state.saving) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }
})();
