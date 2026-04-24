/* OʻzJOKU admin panel — vanilla SPA, no deps */
(() => {
  const root = document.getElementById('app');
  const state = {
    authed: false,
    configured: true,
    tab: 'texts',
    dict: null,        // {ru:{}, uz:{}, en:{}}
    dirty: new Set(),  // keys with unsaved edits
    newKeys: new Set(),// keys added in this session
    filter: '',
    saving: false,
    photos: [],
    uploading: 0,
  };

  /* ---------- helpers ---------- */
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

  /* ---------- bootstrap ---------- */
  api('/api/me').then(me => {
    state.authed = !!me.authed;
    state.configured = !!me.configured;
    if (state.authed) loadAll().then(render);
    else render();
  }).catch(() => { state.configured = true; render(); });

  async function loadAll() {
    const [dict, uploads] = await Promise.all([
      api('/api/i18n'),
      api('/api/uploads').catch(() => ({ files: [] })),
    ]);
    state.dict = dict;
    state.photos = uploads.files || [];
    state.dirty.clear();
    state.newKeys.clear();
  }

  /* ---------- render entry ---------- */
  function render() {
    root.innerHTML = '';
    if (!state.authed) { root.append(renderLogin()); return; }
    root.append(renderApp());
  }

  /* ---------- login ---------- */
  function renderLogin() {
    const wrap = h('div', { class: 'login-wrap' });
    const card = h('form', { class: 'login', onsubmit: onSubmit });
    const err = h('div', { class: 'err' });
    const submit = h('button', { type: 'submit' }, 'Войти');
    const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    card.append(
      h('h1', {}, 'Админ-панель'),
      h('p', {}, state.configured
        ? 'Введите пароль администратора, заданный в переменной ADMIN_PASSWORD.'
        : 'Сервер запущен без ADMIN_PASSWORD/ADMIN_SECRET — админ-панель отключена.'),
      h('div', { class: 'row' },
        h('label', { for: 'pw' }, 'Пароль'),
        pw,
      ),
      submit, err,
    );
    if (!state.configured) { pw.disabled = true; submit.disabled = true; }
    wrap.append(card);
    setTimeout(() => pw.focus(), 0);
    return wrap;

    async function onSubmit(e) {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true; submit.textContent = 'Проверка…';
      try {
        await api('/api/login', { method: 'POST', body: { password: pw.value } });
        state.authed = true;
        await loadAll();
        render();
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
    const main = h('main');
    if (state.tab === 'texts') main.append(renderTexts());
    else if (state.tab === 'photos') main.append(renderPhotos());
    app.append(main);
    return app;
  }

  function renderTopbar() {
    const tabs = h('div', { class: 'tabs' },
      tabBtn('texts',  'Тексты'),
      tabBtn('photos', 'Фото'),
    );
    const meta = h('div', { class: 'meta' },
      state.dict ? `RU ${Object.keys(state.dict.ru).length} · UZ ${Object.keys(state.dict.uz).length} · EN ${Object.keys(state.dict.en).length}` : '');
    const logout = h('button', { class: 'logout', onclick: onLogout }, 'Выйти');
    return h('div', { class: 'topbar' },
      h('div', { class: 'logo' }, 'O', h('em', {}, 'ʻz'), 'JOKU · admin'),
      tabs,
      h('div', { class: 'spacer' }),
      meta,
      logout,
    );
  }
  function tabBtn(id, label) {
    return h('button', {
      class: state.tab === id ? 'active' : '',
      onclick: () => { state.tab = id; render(); },
    }, label);
  }
  async function onLogout() {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    state.authed = false; render();
  }

  /* ---------- texts tab ---------- */
  function renderTexts() {
    const dict = state.dict || { ru: {}, uz: {}, en: {} };
    const allKeys = uniqOrdered([...Object.keys(dict.ru), ...Object.keys(dict.uz), ...Object.keys(dict.en)]);
    const filter = state.filter.trim().toLowerCase();
    const matches = allKeys.filter(k => {
      if (!filter) return true;
      if (k.toLowerCase().includes(filter)) return true;
      for (const lang of ['ru','uz','en']) {
        const v = dict[lang][k];
        if (typeof v === 'string' && v.toLowerCase().includes(filter)) return true;
      }
      return false;
    });

    const search = h('input', {
      type: 'search', placeholder: 'Поиск по ключу или тексту…',
      value: state.filter,
      oninput: e => { state.filter = e.target.value; rerenderTexts(); },
    });
    const saveBtn = h('button', {
      class: 'btn btn-primary',
      onclick: onSave,
      disabled: state.dirty.size === 0 || state.saving,
    }, state.saving ? 'Сохранение…' : (state.dirty.size ? `Сохранить (${state.dirty.size})` : 'Сохранено'));
    const reloadBtn = h('button', {
      class: 'btn btn-ghost',
      onclick: () => loadAll().then(render),
    }, 'Перечитать');

    const toolbar = h('div', { class: 'toolbar' },
      search,
      h('div', { class: 'count' }, `${matches.length} / ${allKeys.length}`),
      h('div', { class: 'right' }, reloadBtn, saveBtn),
    );

    const head = h('div', { class: 'grid-head' },
      h('div', {}, 'Ключ'),
      h('div', {}, 'RU'),
      h('div', {}, 'UZ'),
      h('div', {}, 'EN'),
      h('div', {}, ''),
    );
    const rows = h('div');
    matches.forEach(k => rows.append(rowFor(k)));

    const grid = h('div', { class: 'grid' }, head, rows, renderAddRow());
    if (matches.length === 0) {
      grid.append(h('div', { class: 'empty' }, 'Ничего не найдено'));
    }

    return h('div', {},
      toolbar,
      grid,
    );

    function rerenderTexts() {
      const main = root.querySelector('main');
      main.innerHTML = '';
      main.append(renderTexts());
    }

    function rowFor(key) {
      const isNew = state.newKeys.has(key);
      const isDirty = state.dirty.has(key);
      const row = h('div', { class: 'grid-row' + (isDirty ? ' dirty' : '') + (isNew ? ' new' : '') });
      row.append(h('div', { class: 'cell-key' }, h('span', { class: 'label' }, key)));
      for (const lang of ['ru','uz','en']) {
        row.append(h('div', { class: 'cell-text' }, mkArea(key, lang)));
      }
      row.append(h('div', { class: 'cell-actions' },
        isNew
          ? h('button', { title: 'Удалить новый ключ', onclick: () => removeNewKey(key) }, '×')
          : null,
      ));
      return row;
    }
    function mkArea(key, lang) {
      const v = dict[lang][key];
      const isHtml = typeof v === 'string' && v.includes('<') && v.includes('>');
      const ta = h('textarea', {
        class: isHtml ? 'html-mode' : '',
        spellcheck: false,
        value: v ?? '',
        oninput: e => {
          dict[lang][key] = e.target.value;
          state.dirty.add(key);
          updateSaveButton();
          autosize(e.target);
        },
      });
      requestAnimationFrame(() => autosize(ta));
      return ta;
    }
    function autosize(ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(400, ta.scrollHeight + 2) + 'px';
    }
    function updateSaveButton() {
      saveBtn.disabled = state.dirty.size === 0 || state.saving;
      saveBtn.textContent = state.saving
        ? 'Сохранение…'
        : (state.dirty.size ? `Сохранить (${state.dirty.size})` : 'Сохранено');
    }
    function removeNewKey(key) {
      delete dict.ru[key]; delete dict.uz[key]; delete dict.en[key];
      state.newKeys.delete(key);
      state.dirty.delete(key);
      rerenderTexts();
    }
    function renderAddRow() {
      const keyInput = h('input', { placeholder: 'новый_ключ', spellcheck: false });
      const ruI = h('input', { placeholder: 'RU' });
      const uzI = h('input', { placeholder: 'UZ' });
      const enI = h('input', { placeholder: 'EN' });
      const btn = h('button', { onclick: addKey }, '+');
      return h('div', { class: 'add-row' },
        h('div', {}, keyInput),
        h('div', {}, ruI),
        h('div', {}, uzI),
        h('div', {}, enI),
        h('div', { class: 'add-btn' }, btn),
      );
      function addKey() {
        const key = keyInput.value.trim();
        if (!key) { toast('Укажите ключ', 'bad'); return; }
        if (!/^[a-zA-Z0-9_]+$/.test(key)) { toast('Ключ: только латиница, цифры и подчёркивание', 'bad'); return; }
        if (dict.ru[key] !== undefined || dict.uz[key] !== undefined || dict.en[key] !== undefined) {
          toast('Такой ключ уже есть', 'bad'); return;
        }
        dict.ru[key] = ruI.value;
        dict.uz[key] = uzI.value;
        dict.en[key] = enI.value;
        state.dirty.add(key);
        state.newKeys.add(key);
        rerenderTexts();
      }
    }
    async function onSave() {
      if (state.saving) return;
      state.saving = true; updateSaveButton();
      try {
        await api('/api/i18n', { method: 'POST', body: state.dict });
        state.dirty.clear();
        state.newKeys.clear();
        toast('Сохранено', 'good');
      } catch (e) {
        toast('Ошибка сохранения: ' + e.message, 'bad');
      } finally {
        state.saving = false;
        updateSaveButton();
      }
    }
  }

  function uniqOrdered(arr) {
    const seen = new Set(); const out = [];
    for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
    return out;
  }

  /* ---------- photos tab ---------- */
  function renderPhotos() {
    const dz = h('div', { class: 'dropzone', tabindex: 0 },
      h('strong', {}, state.uploading ? `Загрузка… ${state.uploading}` : 'Перетащите фото сюда'),
      h('small', {}, 'или нажмите, чтобы выбрать файлы (jpg, png, webp, svg, до 25 MB)'),
      h('input', { type: 'file', multiple: true, accept: 'image/*', onchange: e => uploadFiles(e.target.files) }),
    );
    dz.addEventListener('click', () => dz.querySelector('input').click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag');
      uploadFiles(e.dataTransfer.files);
    });

    const grid = h('div', { class: 'photo-grid' });
    if (state.photos.length === 0) {
      grid.append(h('div', { class: 'empty' }, 'Пока нет загруженных фото.'));
    } else {
      for (const f of state.photos) grid.append(photoCard(f));
    }
    return h('div', { class: 'photos' }, dz, grid);

    function photoCard(f) {
      return h('div', { class: 'photo-card' },
        h('div', { class: 'thumb' }, h('img', { src: f.url, alt: f.name, loading: 'lazy' })),
        h('div', { class: 'meta' },
          h('div', { class: 'name', title: f.name }, f.name),
          h('div', { class: 'url',  title: f.url  }, f.url),
          h('div', {}, h('small', { style: 'color:var(--muted)' }, fmtBytes(f.size))),
          h('div', { class: 'actions' },
            h('button', { onclick: () => copyUrl(f.url) }, 'Копировать URL'),
            h('button', { class: 'del', onclick: () => del(f) }, 'Удалить'),
          ),
        ),
      );
    }
    async function copyUrl(url) {
      try { await navigator.clipboard.writeText(url); toast('Скопировано', 'good'); }
      catch { toast(url, ''); }
    }
    async function del(f) {
      if (!confirm(`Удалить ${f.name}?`)) return;
      try {
        await api('/api/upload/' + encodeURIComponent(f.name), { method: 'DELETE' });
        state.photos = state.photos.filter(x => x.name !== f.name);
        rerender();
        toast('Удалено', 'good');
      } catch (e) { toast('Ошибка: ' + e.message, 'bad'); }
    }
    async function uploadFiles(files) {
      if (!files || !files.length) return;
      for (const file of Array.from(files)) await uploadOne(file);
    }
    async function uploadOne(file) {
      state.uploading++; rerender();
      try {
        const buf = await file.arrayBuffer();
        const dataBase64 = bufferToBase64(buf);
        const resp = await api('/api/upload', { method: 'POST', body: {
          name: file.name, contentType: file.type || 'application/octet-stream', dataBase64,
        }});
        state.photos.unshift({ name: resp.name, url: resp.url, size: resp.size, mtime: Date.now() });
        toast(file.name + ' загружено', 'good');
      } catch (e) {
        toast('Ошибка загрузки ' + file.name + ': ' + e.message, 'bad');
      } finally {
        state.uploading--; rerender();
      }
    }
    function rerender() {
      const main = root.querySelector('main');
      main.innerHTML = '';
      main.append(renderPhotos());
    }
  }

  function bufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
})();
