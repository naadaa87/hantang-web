/* HANTANG 지점 사진·영상 — 사진 크게 보기와 영상 재생.
   영상은 재생 단추를 누른 뒤에만 유튜브 플레이어(youtube-nocookie.com)를 불러온다. */
(function () {
  'use strict';
  if (window.__mx) return; window.__mx = 1;
  var doc = document, lb = null, list = [], at = 0;
  function T(k, d) { var s = doc.querySelector('[data-mx-t]'); try { return (s && JSON.parse(s.getAttribute('data-mx-t'))[k]) || d; } catch (e) { return d; } }

  // ── 영상
  function play(btn) {
    var id = btn.getAttribute('data-yt'); if (!/^[\w-]{11}$/.test(id)) return;
    var box = btn.parentNode, f = doc.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&hl=' + encodeURIComponent((doc.documentElement.lang || 'en').toLowerCase());
    f.title = btn.getAttribute('data-title') || 'YouTube';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
    f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin'; f.loading = 'eager';
    if (btn.getAttribute('data-v')) box.classList.add('mx-tall');   // 세로 영상(쇼츠)은 재생할 때 세로로 넓힌다
    box.replaceChild(f, btn);
  }

  // ── 사진 크게 보기
  function build() {
    lb = doc.createElement('dialog'); lb.className = 'mx-lb';
    lb.innerHTML = '<div class="mx-lb-in"><img alt=""><div class="mx-lb-c"></div><div class="mx-lb-n"></div></div>' +
      '<button type="button" class="mx-x"></button><button type="button" class="mx-pv">‹</button><button type="button" class="mx-nx">›</button>';
    lb.querySelector('.mx-x').textContent = '×';
    lb.querySelector('.mx-x').setAttribute('aria-label', T('close', 'Close'));
    lb.querySelector('.mx-pv').setAttribute('aria-label', T('prev', 'Previous'));
    lb.querySelector('.mx-nx').setAttribute('aria-label', T('next', 'Next'));
    lb.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('mx-x') || t === lb || t.classList.contains('mx-lb-in')) return lb.close();
      if (t.classList.contains('mx-pv')) return show(at - 1);
      if (t.classList.contains('mx-nx')) return show(at + 1);
    });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(at - 1); else if (e.key === 'ArrowRight') show(at + 1);
    });
    var x0 = null;
    lb.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 48) show(at + (dx < 0 ? 1 : -1));
    }, { passive: true });
    doc.body.appendChild(lb);
  }
  function show(i) {
    if (!list.length) return;
    at = (i + list.length) % list.length;
    var a = list[at], img = lb.querySelector('img'), c = lb.querySelector('.mx-lb-c');
    img.referrerPolicy = 'no-referrer';
    img.src = a.href; img.alt = (a.querySelector('img') || {}).alt || '';
    c.textContent = '';
    var cap = a.getAttribute('data-cap'), cr = a.getAttribute('data-cr'), cl = a.getAttribute('data-cl');
    if (cap) { var b = doc.createElement('b'); b.textContent = cap; if (a.getAttribute('data-capl')) b.lang = a.getAttribute('data-capl'); c.appendChild(b); }
    if (cr) {
      if (cl) { var l = doc.createElement('a'); l.href = cl; l.target = '_blank'; l.rel = 'noopener'; l.textContent = cr; c.appendChild(l); }
      else c.appendChild(doc.createTextNode(cr));
    }
    lb.querySelector('.mx-lb-n').textContent = list.length > 1 ? (at + 1) + ' / ' + list.length : '';
    if (list.length < 2) lb.setAttribute('data-one', ''); else lb.removeAttribute('data-one');
  }
  function open(a) {
    if (!('HTMLDialogElement' in window)) return false;
    var scope = a.closest('.mx-grid, .mx-strip') || doc;
    list = [].slice.call(scope.querySelectorAll('a.mx-a'));
    if (!lb) build();
    show(Math.max(0, list.indexOf(a)));
    if (!lb.open) lb.showModal();
    return true;
  }

  doc.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.mx-play, a.mx-a') : null; if (!t) return;
    if (t.classList.contains('mx-play')) { play(t); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    if (open(t)) e.preventDefault();
  });
})();
