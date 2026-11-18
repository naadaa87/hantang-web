/* HANTANG 방문 통계 — 페이지를 떠날 때 한 번 /api/an 으로 보낸다.
   쿠키를 쓰지 않는다. 브라우저에는 "오늘 이미 왔는지"를 알기 위한 날짜만 남긴다(hantang.an).
   Do Not Track·GPC 를 켠 브라우저, 관리자 화면, 자동화 브라우저에서는 아무것도 보내지 않는다. */
(function () {
  'use strict';
  var nav = navigator, loc = location;
  try {
    if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl || nav.webdriver) return;
    if (localStorage.getItem('hantang.noan') === '1') return;
  } catch (e) {}
  if (/^\/admin(\/|$)/.test(loc.pathname) || !/(^|\.)hantang\.kr$|\.pages\.dev$|^127\.0\.0\.1$|^localhost$/.test(loc.hostname)) return;
  if (window.__hxAn) return; window.__hxAn = 1;

  var EP = '/api/an';
  function kst() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  // 오늘 처음인지, 예전에 온 적이 있는지 (날짜만 저장)
  var isNew = 1, ret = 0;
  try {
    var st = JSON.parse(localStorage.getItem('hantang.an') || 'null') || {}, today = kst();
    if (st.d === today) isNew = 0; else { ret = st.d ? 1 : 0; localStorage.setItem('hantang.an', JSON.stringify({ d: today })); }
  } catch (e) {}

  var ref = '', entry = 1;
  try { if (document.referrer) { var rh = new URL(document.referrer).hostname; ref = rh; entry = rh !== loc.hostname ? 1 : 0; } } catch (e) {}
  var q = new URLSearchParams(loc.search), utm = {};
  ['source', 'medium', 'campaign'].forEach(function (k) { var v = q.get('utm_' + k); if (v) utm[k] = v.slice(0, 60); });

  // 머문 시간: 화면이 보이고, 2분 안에 손을 움직인 동안만 5초씩 센다 (한 페이지 최대 30분)
  var acc = 0, lastAct = Date.now(), maxDepth = 0, sentAcc = 0, sent = false, evs = [];
  function act() { lastAct = Date.now(); }
  ['scroll', 'pointerdown', 'keydown', 'touchstart', 'mousemove'].forEach(function (t) { addEventListener(t, act, { passive: true }); });
  setInterval(function () { if (document.visibilityState === 'visible' && Date.now() - lastAct < 120000 && acc < 1800) acc += 5; }, 5000);
  function depth() {
    var h = document.documentElement, b = document.body, tot = Math.max(h.scrollHeight, b ? b.scrollHeight : 0);
    if (tot > 0) maxDepth = Math.max(maxDepth, Math.min(100, Math.round((scrollY + innerHeight) / tot * 100)));
  }
  addEventListener('scroll', function () { if (!depth.t) depth.t = setTimeout(function () { depth.t = 0; depth(); }, 300); }, { passive: true });
  addEventListener('load', depth);

  // 지점 상세 페이지면 이름을 함께 보낸다 (통계 화면에 이름을 보여 주려고)
  var placeName = '', placeArea = '';
  if (/\/baths\/p\/[^/]+\/$/.test(loc.pathname)) {
    var h1 = document.querySelector('h1'); placeName = h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    var card = document.querySelector('[data-hx]'); if (card && card.dataset.addr) placeArea = card.dataset.addr.split(' ').slice(0, 2).join(' ');
  }

  function placeOf(el) {
    var c = el && el.closest ? el.closest('[data-hx]') : null;
    if (!c && el && el.closest && el.closest('#hxSheet') && window.hxCur) { var id = window.hxCur(); c = id ? document.getElementById(id) : null; }
    if (!c) return null;
    var url = '';
    var a = c.querySelector('a.pl-link, a[href*="/baths/p/"]'); if (a) { try { url = new URL(a.href).pathname; } catch (e) {} }
    return { p: c.dataset.cur || c.dataset.hx, n: (c.dataset.n || '').slice(0, 80), a: (c.dataset.addr || '').split(' ').slice(0, 2).join(' '), u: url || (/\/baths\/p\//.test(loc.pathname) ? loc.pathname : '') };
  }
  function track(e, v, el) {
    if (evs.length >= 30) return;
    var x = { e: e, v: String(v || '').slice(0, 40) }, p = el ? placeOf(el) : null;
    if (p && p.p) { x.p = p.p; x.n = p.n; x.a = p.a; x.u = p.u; }
    evs.push(x);
  }
  window.hxTrack = function (e, v) { track(e, v, null); };
  function provider(href) {
    if (/naver\.(com|me)/.test(href)) return 'naver';
    if (/kakao\.com|kko\.to/.test(href)) return 'kakao';
    if (/google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/.test(href)) return 'google';
    return '';
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('a,button') : null;
    if (!t) return;
    try {
      var an = t.getAttribute('data-an'); if (an) return track(an.split(':')[0], an.split(':')[1] || '', t);
      if (t.classList.contains('hx-go')) return track('route', 'card', t);
      if (t.id === 'hxCopy') return track('route', 'copy', t);
      if (t.classList.contains('hx-fav')) { if (t.getAttribute('aria-pressed') !== 'true') track('save', '', t); return; }
      if (t.classList.contains('hx-rev')) return track('review', 'open', t);
      if (t.closest('#shGrid')) return track('share', t.getAttribute('data-k') || t.getAttribute('data-copy') || (t.getAttribute('data-qr') ? 'qr' : ''), null);
      if (t.id === 'shNative') return track('share', 'native', null);
      if (t.closest('.lang-pop')) return track('lang', (t.getAttribute('lang') || t.getAttribute('data-l') || t.textContent || '').trim().slice(0, 12), null);
      if (t.tagName !== 'A' || !t.href) return;
      var u = new URL(t.href, loc.href);
      if (u.hostname === loc.hostname) {
        if (/^\/play(\/|$)/.test(u.pathname)) track('game', '', null);
        else if (/^\/partner(\/|$)/.test(u.pathname)) track('partner', '', null);
        return;
      }
      var pv = provider(u.href);
      if (pv) return track(t.closest('#hxSheet') ? 'route' : 'map', pv, t);
      if (/^(https?):$/.test(u.protocol)) {
        if (t.closest('[data-hx]')) return track('site', u.hostname.replace(/^www\./, ''), t);
        track('out', u.hostname.replace(/^www\./, ''), null);
      }
    } catch (e) {}
  }, true);

  function send(kind) {
    var b = { k: kind, p: loc.pathname, s: kind === 'v' ? acc : acc - sentAcc, e: entry, ev: evs };
    if (entry) { b.r = ref; if (utm.source) { b.us = utm.source; b.um = utm.medium || ''; b.uc = utm.campaign || ''; } }
    if (kind === 'v') {
      depth(); b.dp = maxDepth; b.n = isNew; b.rt = ret; b.l = (nav.language || '').toLowerCase().split('-')[0];
      if (placeName) { b.pn = placeName; b.pa = placeArea; }
    }
    var body = JSON.stringify(b);
    try {
      if (!(nav.sendBeacon && nav.sendBeacon(EP, new Blob([body], { type: 'text/plain' })))) fetch(EP, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } });
    } catch (e) {}
    sentAcc = acc; evs = [];
  }
  function flush() {
    if (!sent) { sent = true; send('v'); return; }
    if (acc - sentAcc >= 5 || evs.length) send('x');
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
})();
