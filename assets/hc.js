/* HANTANG 회원·찜·후기·게시판 — 모든 페이지에서 불러온다 (defer)
   문구와 경로는 페이지 안의 <script type="application/json" id="hcT"> 에서 읽는다.
   서버: /api/auth/*, /api/saved, /api/comments, /api/board, /api/config (Cloudflare Pages Functions + D1) */
(function () {
  'use strict';
  var tEl = document.getElementById('hcT');
  if (!tEl) return;
  var C = JSON.parse(tEl.textContent), S = {}, LANG = C.lang, ROOT = C.root, sP = null;
  // 화면 문구는 필요할 때 한 번만 받아 온다 (assets/hc.<언어>.json)
  function strings() {
    if (!sP) sP = fetch(ROOT + 'assets/hc.' + LANG + '.json?v=' + C.v).then(function (r) { return r.json(); }).then(function (j) { S = j; return S; }, function () { return S; });
    return sP;
  }
  var NICK_KEY = 'hantang.me', SAVED_KEY = 'hantang.saved.v1', SYNC_KEY = 'hantang.sync';
  var GTL = { en: 'en', ja: 'ja', 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh-CN', vi: 'vi', th: 'th', ru: 'ru', ko: 'ko' };

  // ── 작은 도구 ──
  function $(sel, el) { return (el || document).querySelector(sel); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  function txt(k) { var d = document.createElement('textarea'); d.innerHTML = S[k] || k; return d.value; }
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="nofollow ugc noopener">$1</a>'); }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : (def && typeof def === 'object' ? JSON.parse(v) : v); } catch (e) { return def; } }
  function flag() { return /(?:^|;\s*)ht_in=1/.test(document.cookie); }
  function nick() { return flag() ? load(NICK_KEY, '') : ''; }
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' }) : null;
  function ago(sec) {
    var d = Date.now() / 1000 - sec;
    if (!rtf || d > 86400 * 30) return new Date(sec * 1000).toLocaleDateString(LANG);
    if (d < 60) return rtf.format(0, 'second');
    if (d < 3600) return rtf.format(-Math.floor(d / 60), 'minute');
    if (d < 86400) return rtf.format(-Math.floor(d / 3600), 'hour');
    return rtf.format(-Math.floor(d / 86400), 'day');
  }
  function translateUrl(s) { return 'https://translate.google.com/?sl=auto&tl=' + (GTL[LANG] || 'en') + '&op=translate&text=' + encodeURIComponent(String(s).slice(0, 1800)); }
  var cssDone = false;
  function css() { if (cssDone) return; cssDone = true; document.head.appendChild(h('link', { rel: 'stylesheet', href: ROOT + 'assets/hc.css?v=' + C.v })); }

  var ERR = { nick_taken: 'err_nick_taken', nick_bad: 'err_nick_bad', login: 'err_login', rate: 'err_rate', not_configured: 'err_off', code: 'err_code',
    short: 'err_short', links: 'err_links', banned: 'err_banned', rating: 'err_rating', agree: 'err_agree', captcha: 'err_rate', net: 'err_net' };
  function errText(code) { return txt(ERR[code] || 'err_net'); }

  function api(path, body, method) {
    var o = { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
    if (body) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(ROOT + 'api/' + path, o).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'net' }; }).then(function (j) { j._status = r.status; return j; });
    }, function () { return { ok: false, error: 'net' }; });
  }

  // ── 비밀번호를 브라우저에서 늘린다 (서버에는 이 값만 간다) ──
  function deriveKey(n, pw) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('hantang|' + n.normalize('NFC').trim().toLowerCase()), iterations: 120000 }, k, 256);
    }).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
  }
  var NICK_RE = /^[\p{L}\p{M}\p{N}_.\-]{2,20}$/u;

  // ── 상단 로그인 단추 ──
  function paintNav() {
    var n = nick();
    document.querySelectorAll('[data-hc-me]').forEach(function (a) {
      if (!a.dataset.l) a.dataset.l = a.textContent;
      a.textContent = n ? n : a.dataset.l;
      a.classList.toggle('in', !!n);
      a.href = C.me_url;
    });
  }

  // ── 대화상자 ──
  function dialog(title, wide) {
    css();
    var body = h('div', { class: 'hc' });
    var x = h('button', { type: 'button', class: 'hc-x', 'aria-label': 'close', text: '×' });
    var d = h('dialog', { class: 'hc-dlg' + (wide ? ' wide' : '') }, [h('div', { class: 'hc-in' }, [h('div', { class: 'hc-top' }, [h('h2', { text: title }), x]), body])]);
    document.body.appendChild(d);
    function close() { if (d.close) d.close(); d.remove(); }
    x.addEventListener('click', close);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    d.addEventListener('cancel', function () { setTimeout(function () { d.remove(); }, 0); });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    return { el: body, close: close, dlg: d };
  }
  function busy(btn, on) { btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = txt('me_wait'); } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

  // ── 가입·로그인 ──
  var cfgP = null;
  function cfg() { if (!cfgP) cfgP = api('config').then(function (j) { return j && j.ok ? j : { ready: false }; }); return cfgP; }
  function loggedIn(n, quiet) {
    store(NICK_KEY, n); paintNav();
    syncSaved(true).then(function (added) { if (added && !quiet) toast(txt('me_sync')); });
    document.dispatchEvent(new CustomEvent('hc:login', { detail: { nick: n } }));
  }
  function toast(m) {
    css();
    var t = h('div', { class: 'hc', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1B1A18;color:#fff;padding:12px 18px;border-radius:12px;z-index:9999;max-width:calc(100vw - 32px);font-size:14px', text: m });
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3600);
  }
  function authForm(mode, done, host) {
    // host: 대화상자 안 또는 마이페이지 안. mode: login | signup | recover
    host.innerHTML = '';
    var inDlg = host.closest && host.closest('dialog'), dlgT = inDlg && inDlg.querySelector('.hc-top h2');
    if (dlgT) dlgT.textContent = txt(mode === 'signup' ? 'me_signup' : mode === 'recover' ? 'me_recover_h' : 'me_login');
    var tabs = h('div', { class: 'hc-tabs', role: 'tablist' });
    [['login', 'me_login'], ['signup', 'me_signup']].forEach(function (m) {
      tabs.appendChild(h('button', { type: 'button', class: mode === m[0] ? 'on' : '', text: txt(m[1]), onclick: function () { authForm(m[0], done, host); } }));
    });
    if (mode !== 'recover') host.appendChild(tabs); else if (!dlgT) host.appendChild(h('h3', { text: txt('me_recover_h'), style: 'font-size:17px;margin:6px 0 0' }));
    var f = h('form', { novalidate: true });
    var t0 = Date.now();
    var nk = h('input', { type: 'text', name: 'nick', autocomplete: 'username', maxlength: '20', required: true, autocapitalize: 'off', spellcheck: 'false' });
    f.appendChild(h('label', { class: 'hc-f' }, [h('span', { text: txt('me_nick') }), nk, mode === 'signup' ? h('small', { text: txt('me_nick_hint') }) : null]));
    var code = null;
    if (mode === 'recover') { code = h('input', { type: 'text', autocomplete: 'off', maxlength: '24', placeholder: 'XXXX-XXXX-XXXX-XXXX' }); f.appendChild(h('label', { class: 'hc-f' }, [h('span', { text: txt('me_code') }), code])); }
    var pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', minlength: '8', maxlength: '200', required: true });
    f.appendChild(h('label', { class: 'hc-f' }, [h('span', { text: txt(mode === 'recover' ? 'me_newpw' : 'me_pw') }), pw, mode !== 'login' ? h('small', { text: txt('me_pw_hint') }) : null]));
    var pw2 = null, agree = null, ts = null;
    if (mode !== 'login') { pw2 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '200' }); f.appendChild(h('label', { class: 'hc-f' }, [h('span', { text: txt('me_pw2') }), pw2])); }
    if (mode === 'signup') {
      agree = h('input', { type: 'checkbox' });
      var lab = h('label', { class: 'hc-chk' }, [agree, h('span', { html: fmt(esc(txt('me_agree')), { terms: '<a href="' + C.terms_url + '" target="_blank">' + esc(txt('foot_terms')) + '</a>', privacy: '<a href="' + C.privacy_url + '" target="_blank">' + esc(txt('foot_privacy')) + '</a>' }) })]);
      f.appendChild(lab);
      ts = h('div', { style: 'margin-top:12px' }); f.appendChild(ts);
      cfg().then(function (c) { if (c.turnstile) turnstile(ts, c.turnstile); });
    }
    var hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'hc-hp', 'aria-hidden': 'true' });
    f.appendChild(hp);
    var err = h('div', { class: 'hc-err', role: 'alert' });
    var btn = h('button', { type: 'submit', class: 'hc-btn pri', style: 'width:100%;justify-content:center;margin-top:14px', text: txt(mode === 'login' ? 'me_login' : mode === 'signup' ? 'me_signup' : 'me_submit') });
    f.appendChild(err); f.appendChild(btn);
    if (mode === 'login') f.appendChild(h('div', { style: 'margin-top:12px;text-align:center' }, [h('button', { type: 'button', class: 'hc-link', text: txt('me_forgot'), onclick: function () { authForm('recover', done, host); } })]));
    else if (mode === 'recover') f.appendChild(h('div', { style: 'margin-top:12px;text-align:center' }, [h('button', { type: 'button', class: 'hc-link', text: '← ' + txt('me_login'), onclick: function () { authForm('login', done, host); } })]));
    host.appendChild(f);
    host.appendChild(h('p', { class: 'hc-why', text: txt('me_why') }));
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      var n = nk.value.normalize('NFC').trim();
      if (!NICK_RE.test(n)) { err.textContent = txt('err_nick_bad'); return; }
      if (pw.value.length < 8) { err.textContent = txt('err_pw_short'); return; }
      if (pw2 && pw2.value !== pw.value) { err.textContent = txt('err_pw_match'); return; }
      if (agree && !agree.checked) { err.textContent = txt('err_agree'); return; }
      if (!window.crypto || !crypto.subtle) { err.textContent = txt('err_net'); return; }
      busy(btn, true);
      deriveKey(n, pw.value).then(function (key) {
        var body = mode === 'signup' ? { nick: n, key: key, agree: true, lang: LANG, hp: hp.value, t0: Date.now() - t0, ts: (ts && ts.dataset.token) || '' }
          : mode === 'login' ? { nick: n, key: key } : { nick: n, code: code.value, newkey: key };
        return api('auth/' + mode, body);
      }).then(function (j) {
        busy(btn, false);
        if (!j.ok) { err.textContent = errText(j.error); return; }
        loggedIn(j.nick);
        if (j.recovery) { if (inDlg) { if (inDlg.close) inDlg.close(); inDlg.remove(); } showRecovery(j.recovery, done); } else done && done();
      });
    });
    setTimeout(function () { nk.focus(); }, 50);
  }
  function turnstile(box, key) {
    function draw() { window.turnstile.render(box, { sitekey: key, callback: function (t) { box.dataset.token = t; } }); }
    if (window.turnstile) return draw();
    var s = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    s.onload = draw; document.head.appendChild(s);
  }
  function showRecovery(code, done) {
    var d = dialog(txt('me_rec_h'));
    d.el.appendChild(h('p', { text: txt('me_rec_p'), style: 'margin:10px 0 0' }));
    d.el.appendChild(h('div', { class: 'hc-code', text: code }));
    var box = d.el.querySelector('.hc-code');
    function pick() { var r = document.createRange(); r.selectNodeContents(box); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    var cp = h('button', { type: 'button', class: 'hc-btn', text: '⧉ ' + txt('sh_copy'), onclick: function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(function () { cp.textContent = '✓ ' + txt('sh_copy'); }, pick); else pick();
    } });
    d.el.appendChild(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [cp, h('button', { type: 'button', class: 'hc-btn pri', text: txt('me_rec_done'), onclick: function () { d.close(); done && done(); } })]));
  }
  function needLogin(after) {
    Promise.all([cfg(), strings()]).then(function (r) { var c = r[0];
      if (!c.ready) { toast(txt('err_off')); return; }
      var d = dialog(txt('me_login'));
      authForm('login', function () { d.close(); after && after(); }, d.el);
    });
  }
  window.hcLogin = needLogin;

  // ── 찜 목록 동기화 ──
  function syncSaved(force) {
    if (!flag()) return Promise.resolve(0);
    var last = +load(SYNC_KEY, '0');
    if (!force && Date.now() - last < 10 * 60e3) return Promise.resolve(0);
    var local = load(SAVED_KEY, {}), before = Object.keys(local).length;
    return api('saved', { op: 'merge', items: local }).then(function (j) {
      if (j._status === 401) { store(NICK_KEY, null); paintNav(); return 0; }
      if (!j.ok) return 0;
      store(SAVED_KEY, j.items); store(SYNC_KEY, String(Date.now()));
      document.dispatchEvent(new Event('hx:synced'));
      return before ? 1 : 0;
    });
  }
  document.addEventListener('hx:saved', function (e) {
    if (!flag() || !e.detail) return;
    var x = e.detail;
    api('saved', { op: 'set', id: x.id, on: x.on, n: x.item && x.item.n, u: x.item && x.item.u, t: x.item && x.item.t, at: x.item && x.item.at });
  });

  // ── 후기·댓글 ──
  function authorName(a) {
    if (a.anon) return a.no ? fmt(txt('cm_anon_n'), { n: a.no }) : txt('cm_anon_name');
    if (a.gone || !a.name) return txt('cm_deleted_user');
    return a.name;
  }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }
  function thread(el, opt) {
    css();
    var target = opt.target, isPlace = target.indexOf('place:') === 0;
    var h1 = document.querySelector('h1');
    var ref = opt.ref || { n: (h1 ? h1.textContent : document.title).replace(/\s+/g, ' ').trim().slice(0, 80), u: location.pathname + (el.id ? '#' + el.id : '') };
    el.classList.add('hc', 'hc-thread'); el.innerHTML = '';
    var sum = h('div', { class: 'hc-sum' }), list = h('ol', { class: 'hc-list' }), moreBtn = h('button', { type: 'button', class: 'hc-btn hc-more', text: txt('cm_more'), hidden: true });
    var formBox = h('div');
    el.appendChild(sum); el.appendChild(formBox); el.appendChild(list); el.appendChild(moreBtn);
    if (isPlace) el.appendChild(h('p', { class: 'hc-note', text: txt('rv_note') }));
    var oldest = 0;
    function item(c) {
      var li = h('li', { class: 'hc-item', id: 'c' + c.id });
      var who = h('div', { class: 'hc-who' }, [h('b', { text: authorName(c.author) }), c.op ? h('span', { class: 'hc-tag op', text: txt('cm_author') }) : null,
        c.author.mine ? h('span', { class: 'hc-tag op', text: txt('cm_mine') }) : null,
        c.rating ? h('span', { style: 'color:#E3A008', text: stars(c.rating) }) : null, h('span', { text: ago(c.created) }),
        c.lang && c.lang !== LANG ? h('span', { class: 'hc-tag lang', text: (C.langs[c.lang] || c.lang) }) : null]);
      li.appendChild(who);
      if (c.status !== 'ok') { li.appendChild(h('div', { class: 'hc-hidden', text: '—' })); return li; }
      li.appendChild(h('div', { class: 'hc-text', html: linkify(c.body) }));
      var acts = h('div', { class: 'hc-acts' });
      if (c.lang !== LANG) acts.appendChild(h('a', { class: 'hc-link', href: translateUrl(c.body), target: '_blank', rel: 'noopener', text: txt('cm_translate') }));
      if (c.author.mine) acts.appendChild(h('button', { type: 'button', class: 'hc-link', text: txt('cm_delete'), onclick: function () {
        if (!confirm(txt('cm_delete_q'))) return;
        api('comments', { op: 'delete', id: c.id }).then(function (j) { if (j.ok) li.remove(); });
      } }));
      else acts.appendChild(h('button', { type: 'button', class: 'hc-link', text: txt('cm_report'), onclick: function () {
        if (!flag()) return needLogin();
        if (!confirm(txt('cm_report_q'))) return;
        api('comments', { op: 'report', id: c.id }).then(function (j) { if (j.ok) toast(txt('ok_reported')); });
      } }));
      li.appendChild(acts);
      return li;
    }
    function fetchPage(reset) {
      return api('comments?target=' + encodeURIComponent(target) + (oldest && !reset ? '&before=' + oldest : '')).then(function (j) {
        if (!j.ok) { sum.textContent = j.error === 'not_configured' ? txt('err_off') : ''; formBox.innerHTML = ''; return; }
        if (reset) list.innerHTML = '';
        if (isPlace) sum.innerHTML = j.count ? '<span class="stars">' + stars(j.avg || 0) + '</span><span>' + esc(fmt(txt('rv_avg'), { avg: j.avg, n: j.count })) + '</span>' : '';
        if (!j.items.length && reset) list.appendChild(h('li', { class: 'hc-empty', text: txt(isPlace ? 'rv_none' : 'cm_none') }));
        j.items.forEach(function (c) { list.appendChild(item(c)); oldest = c.id; });
        moreBtn.hidden = !j.more;
        if (opt.onCount) opt.onCount(j.count || 0);
        if (reset && /^#c\d+$/.test(location.hash)) { var go = document.getElementById(location.hash.slice(1)); if (go && el.contains(go)) go.scrollIntoView({ block: 'center' }); }
      });
    }
    moreBtn.addEventListener('click', function () { fetchPage(false); });
    function drawForm() {
      formBox.innerHTML = '';
      if (!flag()) {
        formBox.appendChild(h('button', { type: 'button', class: 'hc-btn pri', style: 'margin-top:12px', text: (isPlace ? '★ ' + txt('rv_write') : txt('cm_login')), onclick: function () { needLogin(drawForm); } }));
        return;
      }
      var rating = 0, starBox = null, t0 = Date.now();
      var f = h('form', { class: 'hc-form', novalidate: true });
      if (isPlace) {
        starBox = h('div', { class: 'hc-stars', role: 'radiogroup', 'aria-label': txt('rv_rating') });
        for (var i = 1; i <= 5; i++) (function (n) {
          starBox.appendChild(h('button', { type: 'button', role: 'radio', 'aria-label': n + '/5', text: '★', onclick: function () {
            rating = n; [].forEach.call(starBox.children, function (b, k) { b.classList.toggle('on', k < n); b.setAttribute('aria-checked', k === n - 1); });
          } }));
        })(i);
        f.appendChild(h('div', { class: 'row', style: 'margin-top:0' }, [h('b', { text: txt('rv_rating') }), starBox]));
      }
      var ta = h('textarea', { class: 'hc-ta', maxlength: '2000', placeholder: txt(isPlace ? 'rv_ph' : 'cm_ph'), 'aria-label': txt(isPlace ? 'rv_write' : 'cm_h'), style: 'margin-top:' + (isPlace ? '10px' : '0') });
      var anon = h('input', { type: 'checkbox' });
      var hp = h('input', { type: 'text', tabindex: '-1', autocomplete: 'off', class: 'hc-hp', 'aria-hidden': 'true' });
      var err = h('div', { class: 'hc-err', role: 'alert' });
      var btn = h('button', { type: 'submit', class: 'hc-btn pri', text: txt('cm_send') });
      f.appendChild(ta); f.appendChild(hp);
      f.appendChild(h('div', { class: 'row' }, [h('label', { class: 'hc-chk', style: 'margin:0' }, [anon, h('span', { text: txt('cm_anon') })]), btn]));
      f.appendChild(err);
      f.addEventListener('submit', function (e) {
        e.preventDefault(); err.textContent = '';
        if (isPlace && !rating) { err.textContent = txt('err_rating'); return; }
        if (ta.value.trim().length < (isPlace ? 5 : 2)) { err.textContent = txt('err_short'); return; }
        busy(btn, true);
        api('comments', { op: 'add', target: target, body: ta.value, rating: rating || null, anon: anon.checked, lang: LANG, hp: hp.value, t0: Date.now() - t0, ref: ref }).then(function (j) {
          busy(btn, false);
          if (j._status === 401) { store(NICK_KEY, null); paintNav(); return needLogin(drawForm); }
          if (!j.ok) { err.textContent = errText(j.error); return; }
          ta.value = ''; oldest = 0; fetchPage(true);
        });
      });
      formBox.appendChild(f);
    }
    drawForm();
    document.addEventListener('hc:login', drawForm);
    return fetchPage(true);
  }
  function lazy(el, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); fn(); } }, { rootMargin: '300px 0px' });
    io.observe(el);
  }
  // 목록의 ★ 후기 단추 → 후기 창
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.hx-rev'); if (!b) return;
    var el = b.closest('[data-hx]'); if (!el) return;
    var tg = 'place:' + (el.dataset.cur || el.dataset.hx);
    var here = [].filter.call(document.querySelectorAll('[data-hc="thread"]'), function (x) { return x.dataset.target === tg; })[0];
    if (here) { (here.closest('section') || here).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    var url = el.dataset.cur ? C.baths_url + 'p/' + el.dataset.cur + '/' : location.pathname + '#' + (el.id || el.dataset.hx);
    strings().then(function () {
      var d = dialog(txt('rv_h') + ' · ' + (el.dataset.n || ''), true);
      var box = h('div'); d.el.appendChild(box);
      thread(box, { target: tg, ref: { n: (el.dataset.n || '').slice(0, 80), u: url } });
    });
  });

  // ── 게시판 목록 ──
  var CATS = ['all', 'free', 'qna', 'tips'];
  function board(el) {
    css(); el.classList.add('hc');
    var q = new URLSearchParams(location.search);
    var st = { cat: CATS.indexOf(q.get('cat')) > 0 ? q.get('cat') : 'all', mine: q.get('lang') === 'mine', q: q.get('q') || '', page: Math.max(1, +q.get('page') || 1) };
    var cats = h('div', { class: 'hc-cats', role: 'tablist' });
    CATS.forEach(function (c) { cats.appendChild(h('button', { type: 'button', 'data-c': c, text: txt('bd_cat_' + c), onclick: function () { st.cat = c; st.page = 1; go(); } })); });
    var sel = h('select', { 'aria-label': txt('bd_lang_all') }, [h('option', { value: 'all', text: txt('bd_lang_all') }), h('option', { value: 'mine', text: txt('bd_lang_mine') })]);
    sel.addEventListener('change', function () { st.mine = sel.value === 'mine'; st.page = 1; go(); });
    var search = h('input', { type: 'search', class: 'hc-in', placeholder: txt('bd_search'), maxlength: '60', value: st.q });
    var sform = h('form', { class: 'grow', role: 'search', onsubmit: function (e) { e.preventDefault(); st.q = search.value.trim(); st.page = 1; go(); } }, [search]);
    var write = h('button', { type: 'button', class: 'hc-btn pri', text: '✎ ' + txt('bd_write'), onclick: function () { if (!flag()) return needLogin(openWrite); openWrite(); } });
    var bar = h('div', { class: 'hc-bar' }, [cats, sel, sform, write]);
    var writeBox = h('div'), list = h('ul', { class: 'hc-posts' }), pager = h('div', { class: 'hc-pager' });
    el.appendChild(bar); el.appendChild(writeBox); el.appendChild(list); el.appendChild(pager);
    el.appendChild(h('div', { class: 'hc-rules', html: '<b>' + esc(txt('bd_rules_h')) + '</b> · ' + esc(txt('bd_rules')) }));
    function go() {
      var p = new URLSearchParams(); if (st.cat !== 'all') p.set('cat', st.cat); if (st.mine) p.set('lang', 'mine'); if (st.q) p.set('q', st.q); if (st.page > 1) p.set('page', st.page);
      history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
      [].forEach.call(cats.children, function (b) { b.classList.toggle('on', b.dataset.c === st.cat); b.setAttribute('aria-selected', b.dataset.c === st.cat); });
      sel.value = st.mine ? 'mine' : 'all';
      list.innerHTML = '<li class="hc-empty">…</li>'; pager.innerHTML = '';
      var a = new URLSearchParams(); if (st.cat !== 'all') a.set('cat', st.cat); if (st.mine) a.set('lang', LANG); if (st.q) a.set('q', st.q); a.set('page', st.page);
      api('board?' + a).then(function (j) {
        list.innerHTML = '';
        if (!j.ok) { list.appendChild(h('li', { class: 'hc-empty', text: errText(j.error) })); return; }
        if (!j.items.length) list.appendChild(h('li', { class: 'hc-empty', text: txt('bd_empty') }));
        j.items.forEach(function (p) {
          list.appendChild(h('li', null, [h('a', { class: 'p', href: p.url }, [
            h('div', { class: 'hc-who' }, [h('span', { class: 'hc-cat', text: txt('bd_cat_' + p.cat) }), p.lang !== LANG ? h('span', { class: 'hc-tag lang', text: C.langs[p.lang] || p.lang }) : null]),
            h('h3', { text: p.title }), h('p', { text: p.excerpt }),
            h('div', { class: 'hc-who', style: 'margin-top:6px' }, [h('b', { text: authorName(p.author) }), h('span', { text: ago(p.created) }),
              h('span', { text: '💬 ' + p.ncomments }), h('span', { text: '♥ ' + p.likes })])])]));
        });
        if (st.page > 1) pager.appendChild(h('button', { type: 'button', class: 'hc-btn', text: '← ' + txt('bd_newer'), onclick: function () { st.page--; go(); scrollTo(0, el.offsetTop - 80); } }));
        else pager.appendChild(h('span'));
        if (j.more) pager.appendChild(h('button', { type: 'button', class: 'hc-btn', text: txt('bd_older') + ' →', onclick: function () { st.page++; go(); scrollTo(0, el.offsetTop - 80); } }));
      });
    }
    function openWrite() {
      writeBox.innerHTML = '';
      writeBox.appendChild(editor(null, function (j) { location.href = j.url; }, function () { writeBox.innerHTML = ''; }));
    }
    go();
  }
  function editor(post, saved, cancel) {
    var t0 = Date.now();
    var f = h('form', { class: 'hc-write', novalidate: true });
    var cat = h('select', { class: 'hc-in' }, ['free', 'qna', 'tips'].map(function (c) { return h('option', { value: c, text: txt('bd_cat_' + c) }); }));
    var title = h('input', { type: 'text', class: 'hc-in', maxlength: '100', placeholder: txt('bd_t'), value: post ? post.title : '' });
    var body = h('textarea', { class: 'hc-ta', maxlength: '8000', placeholder: txt('bd_body'), style: 'min-height:200px' });
    if (post) body.value = post.body;
    var anon = h('input', { type: 'checkbox' }), hp = h('input', { type: 'text', tabindex: '-1', autocomplete: 'off', class: 'hc-hp', 'aria-hidden': 'true' });
    var err = h('div', { class: 'hc-err', role: 'alert' }), btn = h('button', { type: 'submit', class: 'hc-btn pri', text: txt(post ? 'bd_save' : 'cm_send') });
    if (!post) f.appendChild(h('label', { class: 'hc-f', style: 'margin-top:0' }, [h('span', { text: txt('bd_cat') }), cat]));
    f.appendChild(h('label', { class: 'hc-f' }, [h('span', { text: txt('bd_t') }), title]));
    f.appendChild(h('div', { class: 'hc-f' }, [body])); f.appendChild(hp);
    f.appendChild(h('div', { class: 'row', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px' }, [
      post ? h('span') : h('label', { class: 'hc-chk', style: 'margin:0' }, [anon, h('span', { text: txt('cm_anon') })]),
      h('div', { style: 'display:flex;gap:8px' }, [h('button', { type: 'button', class: 'hc-btn', text: txt('bd_cancel'), onclick: cancel }), btn])]));
    f.appendChild(err);
    f.appendChild(h('p', { class: 'hc-note', text: txt('bd_rules') }));
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (title.value.trim().length < 2 || body.value.trim().length < 5) { err.textContent = txt('err_short'); return; }
      busy(btn, true);
      var req = post ? { op: 'edit', id: post.id, title: title.value, body: body.value } : { op: 'add', cat: cat.value, title: title.value, body: body.value, anon: anon.checked, lang: LANG, hp: hp.value, t0: Date.now() - t0 };
      api('board', req).then(function (j) {
        busy(btn, false);
        if (j._status === 401) { store(NICK_KEY, null); paintNav(); return needLogin(); }
        if (!j.ok) { err.textContent = errText(j.error); return; }
        saved(j);
      });
    });
    setTimeout(function () { title.focus(); }, 50);
    return f;
  }

  // ── 게시글 ──
  function post(el) {
    css(); el.classList.add('hc');
    var id = +(el.dataset.post || new URLSearchParams(location.search).get('id') || 0);
    var ssr = $('[data-ssr]', el);
    if (!id) { el.innerHTML = '<p class="hc-empty">' + esc(txt('bd_empty')) + '</p>'; return; }
    api('board?id=' + id).then(function (j) {
      if (!j.ok) { if (!ssr) el.innerHTML = '<p class="hc-empty">' + esc(errText(j.error === 'not_found' ? 'short' : j.error)) + '</p>'; return; }
      var p = j.post;
      el.innerHTML = '';
      var art = h('article', { class: 'hc-post' }, [
        h('div', { class: 'hc-who' }, [h('a', { href: C.board_url + (p.cat ? '?cat=' + p.cat : ''), class: 'hc-cat', text: txt('bd_cat_' + p.cat) }), p.lang !== LANG ? h('span', { class: 'hc-tag lang', text: C.langs[p.lang] || p.lang }) : null]),
        h('h1', { text: p.title }),
        h('div', { class: 'hc-meta' }, [h('b', { text: authorName(p.author), style: 'color:var(--ink)' }), p.author.mine ? h('span', { class: 'hc-tag op', text: txt('cm_mine') }) : null, h('span', { text: ago(p.created) })]),
        h('div', { class: 'hc-body', html: linkify(p.body) })]);
      var acts = h('div', { class: 'hc-acts' });
      var like = h('button', { type: 'button', class: 'hc-btn hc-like' + (p.liked ? ' on' : ''), text: '♥ ' + txt('bd_like') + ' ' + p.likes, onclick: function () {
        if (!flag()) return needLogin();
        api('board', { op: 'like', id: p.id }).then(function (r) { if (r.ok) { like.classList.toggle('on', r.liked); like.textContent = '♥ ' + txt('bd_like') + ' ' + r.likes; } });
      } });
      acts.appendChild(like);
      if (p.lang !== LANG) acts.appendChild(h('a', { class: 'hc-btn', href: translateUrl(p.title + '\n\n' + p.body), target: '_blank', rel: 'noopener', text: '文A ' + txt('cm_translate') }));
      acts.appendChild(h('button', { type: 'button', class: 'hc-btn', text: '↗', 'aria-label': 'share', onclick: function () { if (window.hpShare) hpShare({ url: location.href, title: p.title, text: '' }); } }));
      if (p.author.mine) {
        acts.appendChild(h('button', { type: 'button', class: 'hc-btn', text: txt('bd_edit'), onclick: function () {
          art.replaceWith(editor(p, function () { location.reload(); }, function () { location.reload(); }));
        } }));
        acts.appendChild(h('button', { type: 'button', class: 'hc-btn', text: txt('cm_delete'), onclick: function () {
          if (!confirm(txt('cm_delete_q'))) return;
          api('board', { op: 'delete', id: p.id }).then(function (r) { if (r.ok) location.href = C.board_url; });
        } }));
      } else acts.appendChild(h('button', { type: 'button', class: 'hc-btn', text: txt('cm_report'), onclick: function () {
        if (!flag()) return needLogin();
        if (!confirm(txt('cm_report_q'))) return;
        api('board', { op: 'report', id: p.id }).then(function (r) { if (r.ok) toast(txt('ok_reported')); });
      } }));
      art.appendChild(acts);
      el.appendChild(art);
      var cnt = h('h2', { text: fmt(txt('bd_comments'), { n: p.ncomments }), style: 'font-size:19px;margin-top:34px' });
      el.appendChild(cnt);
      var th = h('div', { id: 'comments' }); el.appendChild(th);
      thread(th, { target: 'post:' + p.id, ref: { n: p.title.slice(0, 80), u: location.pathname }, onCount: function (n) { cnt.textContent = fmt(txt('bd_comments'), { n: n }); } });
      el.appendChild(h('p', { style: 'margin-top:26px' }, [h('a', { href: C.board_url, class: 'hc-btn', text: '← ' + txt('bd_back') })]));
    });
  }

  // ── 마이페이지 ──
  function me(el) {
    css(); el.classList.add('hc'); el.innerHTML = '';
    cfg().then(function (c) {
      if (!c.ready) { el.appendChild(h('div', { class: 'hc-box', text: txt('err_off') })); return; }
      if (!flag()) {
        var box = h('div', { class: 'hc-box', style: 'max-width:460px' }); el.appendChild(box);
        authForm(location.hash === '#signup' ? 'signup' : 'login', function () { me(el); }, box); return;
      }
      api('auth/me').then(function (j) {
        if (!j.ok) { store(NICK_KEY, null); paintNav(); return me(el); }
        store(NICK_KEY, j.nick); paintNav();
        el.appendChild(h('div', { class: 'hc-me-head' }, [h('h2', { text: fmt(txt('me_hello'), { nick: j.nick }), style: 'font-size:24px;margin:0' }),
          h('button', { type: 'button', class: 'hc-btn', text: txt('me_logout'), onclick: function () { api('auth/logout', {}).then(function () { store(NICK_KEY, null); store(SYNC_KEY, null); paintNav(); me(el); }); } })]));
        // 찜 목록
        var sv = h('div', { class: 'hc-box' }, [h('h2', { text: '♡ ' + txt('hx_saved_h') })]), ul = h('ul', { class: 'hc-saved' });
        sv.appendChild(ul); el.appendChild(sv);
        syncSaved(true).then(function () {
          var s = load(SAVED_KEY, {}), ks = Object.keys(s).sort(function (a, b) { return (s[b].at || 0) - (s[a].at || 0); });
          if (!ks.length) ul.appendChild(h('li', { class: 'hc-empty', text: txt('me_none') }));
          ks.forEach(function (k) { ul.appendChild(h('li', null, [h('a', { href: s[k].u || '#' }, [s[k].n || k, s[k].t ? h('small', { text: s[k].t }) : null])])); });
        });
        // 내 글·후기
        var mine = h('div', { class: 'hc-box' }, [h('h2', { text: txt('me_posts_h') })]), ml = h('ul', { class: 'hc-saved' });
        mine.appendChild(ml); el.appendChild(mine);
        api('comments?mine=1').then(function (r) {
          if (!r.ok) return;
          var rows = [];
          (r.posts || []).forEach(function (p) { rows.push({ at: p.created, html: h('a', { href: ROOT + (C.folders[p.lang] || '') + 'board/p/' + p.id }, [p.title, h('small', { text: txt('bd_cat_' + p.cat) + ' · ' + ago(p.created) })]) }); });
          (r.comments || []).forEach(function (c) {
            var href = '#', what = c.tname || c.target;
            if (c.target.indexOf('post:') === 0) href = ROOT + 'board/p/' + c.target.slice(5) + '#c' + c.id;
            else if (c.target.indexOf('guide:') === 0) href = C.guide_url + c.target.slice(6) + '/#c' + c.id;
            else if (c.target.indexOf('place:') === 0) { href = c.turl || (C.baths_url + 'p/' + c.target.slice(6) + '/'); what = (c.rating ? stars(c.rating) + ' ' : '') + (c.tname || c.target.slice(6)); }
            if (c.turl && c.target.indexOf('place:') !== 0) href = c.turl.split('#')[0] + '#c' + c.id;
            rows.push({ at: c.created, html: h('a', { href: href }, [c.body.slice(0, 80), h('small', { text: what + ' · ' + ago(c.created) })]) });
          });
          rows.sort(function (a, b) { return b.at - a.at; });
          if (!rows.length) ml.appendChild(h('li', { class: 'hc-empty', text: txt('me_none') }));
          rows.forEach(function (x) { ml.appendChild(h('li', null, [x.html])); });
        });
        // 비밀번호 바꾸기·탈퇴
        el.appendChild(pwBox(j.nick)); el.appendChild(delBox(j.nick, el));
      });
    });
  }
  function pwBox(n) {
    var cur = h('input', { type: 'password', autocomplete: 'current-password', class: 'hc-in' }), nw = h('input', { type: 'password', autocomplete: 'new-password', class: 'hc-in' });
    var err = h('div', { class: 'hc-err', role: 'alert' }), btn = h('button', { type: 'submit', class: 'hc-btn', text: txt('me_change_pw'), style: 'margin-top:12px' });
    var f = h('form', { class: 'hc-box', novalidate: true }, [h('h2', { text: txt('me_change_pw') }), h('label', { class: 'hc-f' }, [h('span', { text: txt('me_curpw') }), cur]),
      h('label', { class: 'hc-f' }, [h('span', { text: txt('me_newpw') }), nw, h('small', { text: txt('me_pw_hint') })]), btn, err]);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.className = 'hc-err'; err.textContent = '';
      if (nw.value.length < 8) { err.textContent = txt('err_pw_short'); return; }
      busy(btn, true);
      Promise.all([deriveKey(n, cur.value), deriveKey(n, nw.value)]).then(function (k) { return api('auth/password', { key: k[0], newkey: k[1] }); }).then(function (j) {
        busy(btn, false);
        if (!j.ok) { err.textContent = errText(j.error); return; }
        err.className = 'hc-ok'; err.textContent = '✓ ' + txt('ok_saved'); cur.value = nw.value = '';
      });
    });
    return f;
  }
  function delBox(n, root) {
    var pw = h('input', { type: 'password', autocomplete: 'current-password', class: 'hc-in' });
    var err = h('div', { class: 'hc-err', role: 'alert' }), btn = h('button', { type: 'submit', class: 'hc-btn', text: txt('me_delete'), style: 'margin-top:12px;border-color:#E0B4B0;color:#B3261E' });
    var f = h('form', { class: 'hc-box', novalidate: true }, [h('h2', { text: txt('me_delete') }), h('p', { class: 'hc-note', text: txt('me_delete_p'), style: 'margin-top:0' }),
      h('label', { class: 'hc-f' }, [h('span', { text: txt('me_pw') }), pw]), btn, err]);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (!confirm(txt('me_delete') + '?')) return;
      busy(btn, true);
      deriveKey(n, pw.value).then(function (k) { return api('auth/delete', { key: k }); }).then(function (j) {
        busy(btn, false);
        if (!j.ok) { err.textContent = errText(j.error); return; }
        store(NICK_KEY, null); store(SYNC_KEY, null); paintNav(); me(root);
      });
    });
    return f;
  }

  // ── 시작 ──
  paintNav();
  if (flag() && !load(NICK_KEY, '')) api('auth/me').then(function (j) { if (j.ok) { store(NICK_KEY, j.nick); paintNav(); } });
  syncSaved(false);
  document.querySelectorAll('[data-hc]').forEach(function (el) {
    var k = el.dataset.hc;
    if (k === 'thread') (/^#c\d+$/.test(location.hash) ? function (x, f) { f(); } : lazy)(el, function () { strings().then(function () { thread(el, { target: el.dataset.target }); }); });
    else strings().then(function () {
      if (k === 'board') board(el);
      else if (k === 'post') post(el);
      else if (k === 'me') me(el);
    });
  });
})();
