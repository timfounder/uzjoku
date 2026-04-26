/* OʻzJOKU admin panel — vanilla SPA, no deps.
 * UI organized by site sections (window.ADMIN_SECTIONS) so admins edit
 * named fields ("Заголовок — 1-я строка") and bind photos to specific
 * site slots (hero, rector portrait, news thumbs, …) instead of raw
 * key/value pairs. */
(() => {
  const root = document.getElementById('app');
  const SECTIONS = window.ADMIN_SECTIONS || [];
  const HIDDEN   = new Set(window.ADMIN_HIDDEN_KEYS || []);
  const LANGS    = ['ru', 'uz', 'en'];
  const IMG_PREFIX = 'img_';

  const state = {
    authed: false, configured: true,
    dict: null,             // {ru:{}, uz:{}, en:{}}
    photos: [],             // [{name, url, size, mtime}]
    dirty: new Set(),
    saving: false,
    filter: '',
    activeSection: null,
    pickerSlot: null,       // active photo-slot key when modal is open
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
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, data });
      return data;
    });
  }

  let toastTimer = null;
  function toast(msg, kind = '') {
    let el = document.querySelector('.toast');
    if (!el) { el = h('div', { class: 'toast' }); document.body.appendChild(el); }
    el.className = 'toast show ' + (kind || '');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
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
    if (state.authed) loadAll().then(render); else render();
  }).catch(() => { state.configured = true; render(); });

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

  /* ---------- entry ---------- */
  function render() {
    root.innerHTML = '';
    if (!state.authed) { root.append(renderLogin()); return; }
    root.append(renderApp());
  }

  /* ---------- login ---------- */
  function renderLogin() {
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
    setTimeout(() => pw.focus(), 0);
    return wrap;

    async function onSubmit(e) {
      e.preventDefault();
      err.textContent = ''; submit.disabled = true; submit.textContent = 'Проверка…';
      try {
        await api('/api/login', { method: 'POST', body: { password: pw.value } });
        state.authed = true; await loadAll(); render();
      } catch (e) {
        err.textContent = e.status === 401 ? 'Неверный пароль' : (e.message || 'Ошибка');
        submit.disabled = false; submit.textContent = 'Войти';
      }
    }
  }

  /* ---------- main app ---------- */
  function renderApp() {
    const app = h('div', { class: 'app' });
    app.append(renderTopbar());
    const wrap = h('div', { class: 'workspace' });
    wrap.append(renderSidebar());
    const main = h('main', { class: 'pane' });
    main.append(renderActiveSection());
    wrap.append(main);
    app.append(wrap);
    return app;
  }

  function renderTopbar() {
    const search = h('input', {
      class: 'search', type: 'search', placeholder: 'Поиск по полю или содержимому…',
      value: state.filter,
      oninput: e => { state.filter = e.target.value; rerenderAll(); },
    });
    const saveBtn = h('button', {
      class: 'btn btn-primary',
      onclick: onSave,
      disabled: state.dirty.size === 0 || state.saving,
    }, state.saving ? 'Сохранение…' : (state.dirty.size ? `Сохранить (${state.dirty.size})` : 'Сохранено'));
    return h('div', { class: 'topbar' },
      h('div', { class: 'logo' }, 'O', h('em', {}, 'ʻz'), 'JOKU · admin'),
      search,
      h('div', { class: 'spacer' }),
      h('a', { href: '/', target: '_blank', class: 'btn btn-ghost', title: 'Открыть сайт' }, 'Открыть сайт'),
      saveBtn,
      h('button', { class: 'logout', onclick: onLogout }, 'Выйти'),
    );
  }
  async function onLogout() {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    state.authed = false; render();
  }

  function renderSidebar() {
    const list = h('div', { class: 'side-list' });
    const matchedSections = visibleSections();
    matchedSections.forEach(s => {
      const dirtyCount = countDirtyInSection(s);
      const btn = h('button', {
        class: 'side-link' + (s.id === state.activeSection ? ' active' : '') + (dirtyCount ? ' has-dirty' : ''),
        onclick: () => { state.activeSection = s.id; rerenderAll(); },
      },
        h('span', { class: 'side-title' }, s.title),
        s.photos ? h('span', { class: 'side-photo' }, '🖼') : null,
        dirtyCount ? h('span', { class: 'side-count' }, String(dirtyCount)) : null,
      );
      list.append(btn);
    });
    if (matchedSections.length === 0) {
      list.append(h('div', { class: 'empty' }, 'Ничего не найдено'));
    }
    return h('aside', { class: 'sidebar' }, list);
  }

  function visibleSections() {
    const sections = SECTIONS.slice();
    // append "Other" with leftover keys
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
          hint: 'Ключи, не привязанные ни к одной секции — старые/служебные строки.',
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

  function rerenderAll() {
    const app = root.querySelector('.app');
    if (!app) { render(); return; }
    app.innerHTML = '';
    app.append(renderTopbar().firstChild ? renderTopbar() : renderTopbar());
    const wrap = h('div', { class: 'workspace' });
    wrap.append(renderSidebar());
    const main = h('main', { class: 'pane' });
    main.append(renderActiveSection());
    wrap.append(main);
    app.append(wrap);
  }

  /* ---------- active section ---------- */
  function renderActiveSection() {
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
      const block = h('div', { class: 'photos-block' });
      block.append(h('h2', { class: 'block-title' }, 'Фотографии'));
      for (const p of s.photos) block.append(renderPhotoSlot(p));
      body.append(block);
    }
    if (s.fields && s.fields.length) {
      const block = h('div', { class: 'fields-block' });
      block.append(h('h2', { class: 'block-title' }, 'Тексты'));
      const head2 = h('div', { class: 'lang-head' },
        h('div', {}), h('div', {}, 'RU'), h('div', {}, 'UZ'), h('div', {}, 'EN'),
      );
      block.append(head2);
      for (const f of s.fields) block.append(renderFieldRow(f));
      body.append(block);
    }
    return h('div', { class: 'section' }, head, body);
  }

  /* ---------- photo slot ---------- */
  function renderPhotoSlot(p) {
    const url = state.dict && state.dict.ru ? (state.dict.ru[p.key] || '') : '';
    const dirty = state.dirty.has(p.key);
    const preview = h('div', { class: 'slot-preview' + (url ? '' : ' empty') });
    if (url) preview.append(h('img', { src: url, alt: p.label, loading: 'lazy' }));
    else preview.append(h('span', {}, 'не выбрано'));

    const meta = h('div', { class: 'slot-meta' },
      h('div', { class: 'slot-label' }, p.label, dirty ? h('span', { class: 'dirty-dot' }, ' ●') : null),
      p.hint ? h('div', { class: 'slot-hint' }, p.hint) : null,
      h('div', { class: 'slot-url' + (url ? '' : ' muted') }, url || '— нет фото —'),
    );
    const actions = h('div', { class: 'slot-actions' },
      h('button', { class: 'btn', onclick: () => openPicker(p.key) }, 'Выбрать или загрузить'),
      url ? h('button', { class: 'btn btn-danger', onclick: () => clearSlot(p.key) }, 'Очистить') : null,
    );
    return h('div', { class: 'slot' + (url ? ' has-photo' : '') }, preview, meta, actions);
  }

  function setSlotUrl(slotKey, url) {
    if (!state.dict) return;
    for (const lang of LANGS) state.dict[lang][slotKey] = url;
    state.dirty.add(slotKey);
    rerenderAll();
  }
  function clearSlot(slotKey) { setSlotUrl(slotKey, ''); }

  /* ---------- picker modal ---------- */
  function openPicker(slotKey) {
    state.pickerSlot = slotKey;
    document.body.append(renderPicker());
  }
  function closePicker() {
    state.pickerSlot = null;
    document.querySelector('.modal-backdrop')?.remove();
  }
  function renderPicker() {
    const slotKey = state.pickerSlot;
    const backdrop = h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === backdrop) closePicker(); } });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: false, onchange: e => uploadAndAssign(e.target.files && e.target.files[0]) });
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
        const card = h('button', {
          class: 'lib-item',
          onclick: () => { setSlotUrl(slotKey, f.url); closePicker(); toast('Фото назначено', 'good'); },
        },
          h('img', { src: f.url, alt: f.name, loading: 'lazy' }),
          h('span', { class: 'lib-name', title: f.name }, f.name),
        );
        lib.append(card);
      }
    }

    const slot = SECTIONS.flatMap(s => s.photos || []).find(p => p.key === slotKey);
    const modal = h('div', { class: 'modal' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('div', { class: 'modal-title' }, 'Фото для слота: ' + (slot ? slot.label : slotKey)),
          h('div', { class: 'modal-sub' }, 'Загрузите новое или выберите из уже существующих.'),
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
    );
    backdrop.append(modal);
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
      } catch (e) {
        toast('Ошибка: ' + e.message, 'bad');
      }
    }
  }

  /* ---------- text fields ---------- */
  function renderFieldRow(f) {
    const dirty = state.dirty.has(f.key);
    const row = h('div', { class: 'field-row' + (dirty ? ' dirty' : '') });
    row.append(h('div', { class: 'field-label' },
      h('div', { class: 'field-title' }, f.label),
      h('div', { class: 'field-key' }, f.key),
    ));
    for (const lang of LANGS) row.append(h('div', { class: 'field-cell' }, mkArea(f, lang)));
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
        markDirty();
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

  function markDirty() {
    const btn = root.querySelector('.topbar .btn-primary');
    if (!btn) return;
    btn.disabled = state.dirty.size === 0 || state.saving;
    btn.textContent = state.saving ? 'Сохранение…'
      : (state.dirty.size ? `Сохранить (${state.dirty.size})` : 'Сохранено');
    // refresh sidebar dirty markers
    const side = root.querySelector('.sidebar');
    if (side) { side.replaceWith(renderSidebar()); }
  }

  async function onSave() {
    if (state.saving) return;
    state.saving = true; markDirty();
    try {
      await api('/api/i18n', { method: 'POST', body: state.dict });
      state.dirty.clear();
      toast('Сохранено', 'good');
    } catch (e) {
      toast('Ошибка сохранения: ' + e.message, 'bad');
    } finally {
      state.saving = false; markDirty();
    }
  }
})();
