// HANTANG service worker — 202611141614
// 페이지: 인터넷 먼저, 실패하면 저장본 → 그래도 없으면 /offline/
// 같은 사이트의 그림·데이터: 저장본을 먼저 보여 주고 뒤에서 새로 받아 둔다
// 다른 사이트(글꼴·지도·관광공사 사진)와 /api/ /admin/ /tools/ /play/ 는 손대지 않는다
const V = 'hantang-202611141614';
const SKIP = /^\/(api|admin|tools|play|partner)\/|^\/(sitemap\.xml|robots\.txt|indexnow-key\.txt|sw\.js)$/;
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then((c) => c.addAll(['/offline/', '/favicon.svg'])).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('hantang-') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || SKIP.test(u.pathname) || u.pathname === '/sw.js') return;
  if (r.mode === 'navigate') {
    // 인터넷 먼저. 4초 넘게 걸리면(로밍·지하) 저장본이 있을 때 그것부터 보여 주고, 새 내용은 받아서 저장해 둔다
    const net = fetch(r).then((res) => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); }
      return res;
    });
    const slow = new Promise((ok) => setTimeout(ok, 4000)).then(() => caches.match(r, { ignoreSearch: true }));
    e.respondWith(Promise.race([net, slow.then((m) => m || net)])
      .catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match('/offline/'))));
    return;
  }
  e.respondWith(caches.open(V).then((c) => c.match(r).then((m) => {
    const net = fetch(r).then((res) => { if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }).catch(() => m);
    return m || net;
  })));
});
