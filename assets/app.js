/* UZJOKU — app logic: routing, i18n, reveal, count-up, theme */
(function(){
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  /* -------- News data (used on home + news page + article bind) -------- */
  const NEWS = [
    {i:1, key:'n1', art:'blue'},
    {i:2, key:'n2', art:'sky'},
    {i:3, key:'n3', art:'indigo'},
    {i:4, key:'n4', art:'navy'},
    {i:5, key:'n5', art:'blue'},
  ];

  /* -------- i18n -------- */
  let lang = localStorage.getItem('uzj_lang') || 'ru';
  function applyI18n(){
    const dict = window.I18N[lang];
    if (!dict) return;
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (dict[k] !== undefined) el.textContent = dict[k];
    });
    $$('#lang-switcher button').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    renderHomeNews();
    renderNewsFull();
    rebindNewsPlaceholders();
  }
  function setLang(l){ lang = l; localStorage.setItem('uzj_lang', l); applyI18n(); }

  /* -------- Theme -------- */
  let theme = localStorage.getItem('uzj_theme') || (window.TWEAK_DEFAULTS && window.TWEAK_DEFAULTS.theme) || 'light';
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', theme);
    $$('[data-theme]').forEach(b => {
      if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.theme === theme);
    });
  }
  function setTheme(t){
    theme = t;
    localStorage.setItem('uzj_theme', t);
    applyTheme();
    if (window.parent !== window) {
      window.parent.postMessage({type:'__edit_mode_set_keys', edits:{theme:t}}, '*');
    }
  }

  /* -------- Routing -------- */
  function goTo(pageId){
    const target = $(`.page[data-page-id="${pageId}"]`);
    if (!target) return;
    $$('.page.active').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    $$('.nav-list button').forEach(b => b.classList.toggle('active',
      b.dataset.page === pageId || (pageId === 'faculty' && b.dataset.page === 'faculties')));
    window.scrollTo({top:0, behavior:'instant'});
    // re-run reveal + counters on the new page
    requestAnimationFrame(() => {
      revealScan(target);
      countScan(target);
    });
    localStorage.setItem('uzj_page', pageId);
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-page]');
    if (el){ e.preventDefault(); goTo(el.dataset.page); }
  });

  /* -------- News rendering -------- */
  function newsCard(n, variant){
    const d = window.I18N[lang];
    const cat = d[`${n.key}_cat`] || '';
    const title = d[`${n.key}_title`] || '';
    const desc = d[`${n.key}_desc`] || d['n1_desc'] || '';
    const date = d[`${n.key}_date`] || '';
    const variantClass = {big:'nc-big', side:'nc-side', small:'nc-small', full:''}[variant] || '';
    return `
      <a class="nc ${variantClass}" data-page="article">
        <div class="nc-thumb"><div class="nc-thumb-inner ${n.art}"></div>
          <span class="nc-cat">${cat}</span>
          <span class="nc-date">${date}</span>
        </div>
        <div class="nc-body">
          <h3>${title}</h3>
          <p>${desc}</p>
          <div class="nc-foot"><span>READ STORY</span><span class="go">→</span></div>
        </div>
      </a>`;
  }
  function renderHomeNews(){
    const host = $('#home-news'); if (!host) return;
    host.innerHTML =
      newsCard(NEWS[0], 'big') +
      newsCard(NEWS[1], 'side') +
      newsCard(NEWS[2], 'small') +
      newsCard(NEWS[3], 'small') +
      newsCard(NEWS[4], 'small');
  }
  function renderNewsFull(){
    const host = $('#news-full'); if (!host) return;
    host.innerHTML = [...NEWS, ...NEWS].map(n => newsCard(n, 'full')).join('');
  }
  function rebindNewsPlaceholders(){
    const d = window.I18N[lang];
    $$('[data-news-bind]').forEach(el => {
      const [type, idx] = el.dataset.newsBind.split(':');
      const n = NEWS[Number(idx)-1];
      if (n && type === 'title') el.textContent = d[`${n.key}_title`] || '';
    });
  }

  /* -------- Ticker -------- */
  function buildTicker(){
    const track = $('#ticker-track'); if (!track) return;
    const items = [
      'Admission 2026 · open',
      'Scopus Q3 · Media & Communications Review',
      '22 programs · 3 languages',
      'Dual-degree · EJP Paris',
      'BBC Academy summer school',
      '4K studio · on air',
      'Data-journalism lab',
      'Veritas · Libertas · Responsibilitas'
    ];
    const html = items.map(t => `<span class="ticker-item">${t}<span class="d">◆</span></span>`).join('');
    track.innerHTML = html + html;
  }

  /* -------- Scroll reveal -------- */
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting){
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -80px 0px' });
  function revealScan(root=document){
    $$('.reveal', root).forEach(el => { if (!el.classList.contains('in')) io.observe(el); });
    $$('.stat-card', root).forEach(el => { if (!el.classList.contains('in')) io.observe(el); });
  }

  /* -------- Count-up -------- */
  const countIo = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting){
        animateCount(en.target);
        countIo.unobserve(en.target);
      }
    });
  }, { threshold: 0.4 });
  function animateCount(el){
    const target = parseFloat(el.dataset.count) || 0;
    const dur = 1600;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const fmt = (v) => target >= 1000 ? Math.round(v).toLocaleString('ru-RU').replace(/,/g,' ') : Math.round(v).toString();
    function tick(now){
      const t = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * ease(t));
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(target);
    }
    requestAnimationFrame(tick);
  }
  function countScan(root=document){
    $$('.count', root).forEach(el => countIo.observe(el));
  }

  /* -------- Parallax on hero bg + frosted nav opacity -------- */
  function onScroll(){
    const y = window.scrollY;
    const bg = $('#hero-bg');
    if (bg) bg.style.transform = `translate3d(0, ${y * 0.18}px, 0)`;
    const nav = $('#nav');
    if (nav){
      const s = Math.min(1, y / 80);
      nav.style.boxShadow = s > 0.3 ? '0 1px 20px rgba(10,30,60,0.06)' : 'none';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* -------- Tweaks / edit mode -------- */
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === '__activate_edit_mode') $('#tweaks').classList.add('show');
    if (e.data.type === '__deactivate_edit_mode') $('#tweaks').classList.remove('show');
  });
  // Listener ready → announce.
  try { window.parent.postMessage({type:'__edit_mode_available'}, '*'); } catch(_){}

  /* -------- Init -------- */
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    applyI18n();
    buildTicker();

    // Restore last page
    const saved = localStorage.getItem('uzj_page');
    if (saved && $(`.page[data-page-id="${saved}"]`)) goTo(saved);
    else { revealScan(); countScan(); }

    // Lang buttons
    $$('#lang-switcher button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
    // Theme buttons (there are multiple sets — announce + tweaks)
    $$('[data-theme]').forEach(b => {
      if (b.tagName === 'BUTTON') b.addEventListener('click', () => setTheme(b.dataset.theme));
    });
  });
})();
