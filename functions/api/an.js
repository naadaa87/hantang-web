// /api/an — 방문 통계 비콘 (assets/an.js 가 페이지를 떠날 때 한 번 보낸다)
//   쿠키를 쓰지 않고, IP 는 저장하지 않으며, 날짜별 합계만 D1(HANTANG_DB)에 더한다.
//   D1 이 없거나, 다른 사이트에서 왔거나, 로봇이면 아무것도 하지 않고 204 를 돌려준다.
// ── 공통 도구 (개발용 소스 site/functions/_lib/analytics.js 에서 붙임) ──
// 방문 통계 (한탕 자체 집계) — 쿠키·IP·개인 식별값을 저장하지 않고 "날짜별 합계"만 D1 에 쌓는다.
// 다른 _lib 파일과 함께 붙여 넣어지므로 이름은 모두 an 으로 시작하고, 여기서는 다른 파일을 import 하지 않는다.
const AN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS an_day (day TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0,
     visitors INTEGER NOT NULL DEFAULT 0, ret INTEGER NOT NULL DEFAULT 0, eng_sec INTEGER NOT NULL DEFAULT 0,
     engaged INTEGER NOT NULL DEFAULT 0, place_views INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS an_page (day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, entries INTEGER NOT NULL DEFAULT 0,
     eng_sec INTEGER NOT NULL DEFAULT 0, engaged INTEGER NOT NULL DEFAULT 0, deep INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))`,
  `CREATE TABLE IF NOT EXISTS an_seg (day TEXT NOT NULL, cc TEXT NOT NULL, dev TEXT NOT NULL, src TEXT NOT NULL, blang TEXT NOT NULL, site TEXT NOT NULL,
     views INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0, eng_sec INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, cc, dev, src, blang, site))`,
  `CREATE TABLE IF NOT EXISTS an_cmp (day TEXT NOT NULL, src TEXT NOT NULL, med TEXT NOT NULL, cmp TEXT NOT NULL, visits INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, src, med, cmp))`,
  `CREATE TABLE IF NOT EXISTS an_place (day TEXT NOT NULL, place TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, maps INTEGER NOT NULL DEFAULT 0,
     route INTEGER NOT NULL DEFAULT 0, saves INTEGER NOT NULL DEFAULT 0, reviews INTEGER NOT NULL DEFAULT 0, sites INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, place))`,
  `CREATE TABLE IF NOT EXISTS an_place_meta (place TEXT PRIMARY KEY, name TEXT, area TEXT, url TEXT)`,
  `CREATE TABLE IF NOT EXISTS an_evt (day TEXT NOT NULL, ev TEXT NOT NULL, v TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, ev, v))`,
];
let anReady = false;
async function anDb(env) {
  const d = env.HANTANG_DB;
  if (!d) return null;
  if (!anReady) { await d.batch(AN_SCHEMA.map((s) => d.prepare(s))); anReady = true; }
  return d;
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
function anDay(ms = Date.now()) { return new Date(ms + 9 * 3600e3).toISOString().slice(0, 10); }
function anShift(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10); }

const AN_FOLDERS = { ja: 'ja', 'zh-hant': 'zh-Hant', 'zh-hans': 'zh-Hans', vi: 'vi', th: 'th', ru: 'ru', ko: 'ko' };
const AN_BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|httpclient|phantom|puppeteer|playwright/i;
// 지점 행동 → an_place 열
const AN_PLACE_COL = { map: 'maps', route: 'route', save: 'saves', review: 'reviews', site: 'sites' };
const AN_EVENTS = new Set(['map', 'route', 'save', 'review', 'site', 'share', 'lang', 'out', 'game', 'partner', 'signup', 'login', 'post', 'comment', 'review_post', 'filter']);

const anStr = (s, n, re) => { s = String(s == null ? '' : s).trim().slice(0, n); return re && !re.test(s) ? '' : s; };
const anInt = (x, lo, hi) => { x = Math.round(Number(x) || 0); return Math.max(lo, Math.min(hi, x)); };
const anText = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function anIsBot(ua) { return !ua || AN_BOT.test(ua); }
function anDevice(ua) {
  if (/iPad|Tablet|Android(?!.*Mobile)|Silk|Kindle/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}
function anPath(p) {
  p = String(p || '').split(/[?#]/)[0].replace(/\/index\.html$/, '/');
  if (!/^\/[A-Za-z0-9\-._~%/]{0,160}$/.test(p) || /\/\//.test(p)) return '';
  if (/^\/(admin|api|tools|offline)(\/|$)/.test(p)) return '';
  return p;
}
function anSite(path) { const f = path.split('/')[1]; return AN_FOLDERS[f] || 'en'; }
function anPlaceFromPath(path) { const m = path.match(/^\/(?:[a-z-]+\/)?baths\/p\/([A-Za-z0-9_.-]{1,80})\/$/); return m ? m[1] : ''; }

// 들어온 경로 이름 붙이기 (이전 페이지의 도메인만 받는다)
const AN_SRC = [
  [/(^|\.)google\./, 'google'], [/(^|\.)naver\.com$/, 'naver'], [/(^|\.)daum\.net$|(^|\.)kakao\.com$/, 'daum·kakao'], [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)yahoo\./, 'yahoo'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'], [/(^|\.)yandex\./, 'yandex'], [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, 'chatgpt'], [/(^|\.)perplexity\.ai$/, 'perplexity'], [/(^|\.)(claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, 'ai-other'],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, 'instagram'], [/(^|\.)(facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com)$/, 'facebook'],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, 'x'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)(line\.me)$/, 'line'], [/(^|\.)(threads\.net|threads\.com)$/, 'threads'], [/(^|\.)pinterest\./, 'pinterest'],
  [/(^|\.)tripadvisor\./, 'tripadvisor'], [/(^|\.)(xiaohongshu\.com|xhslink\.com)$/, 'xiaohongshu'], [/(^|\.)(weibo\.com|weibo\.cn)$/, 'weibo'],
  [/(^|\.)vk\.com$/, 'vk'], [/(^|\.)(hantang-web\.pages\.dev)$/, '(internal)'],
];
function anSource(refHost, utmSource) {
  const u = anStr(utmSource, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (u) return 'utm:' + u;
  const h = anStr(refHost, 100).toLowerCase().replace(/^www\./, '');
  if (!h) return '(direct)';
  for (const [re, name] of AN_SRC) if (re.test(h)) return name;
  return /^[a-z0-9.-]+$/.test(h) ? h : '(other)';
}

// 비콘 한 번을 D1 에 반영. b = 브라우저가 보낸 값, cf = request.cf
async function anRecord(d, b, ua, cf) {
  const path = anPath(b.p);
  if (!path) return;
  const day = anDay(), kind = b.k === 'x' ? 'x' : 'v';
  const s = anInt(b.s, 0, 1800), depth = anInt(b.dp, 0, 100);
  const entry = kind === 'v' && b.e ? 1 : 0;
  const src = b.e ? anSource(b.r, b.us) : '(internal)';   // 이어 보내는 비콘(x)도 같은 묶음에 시간을 더한다
  const cc = /^[A-Z]{2}$/.test((cf && cf.country) || '') ? cf.country : 'XX';
  const dev = anDevice(ua), blang = anStr(b.l, 3, /^[a-z]{2,3}$/) || 'xx', site = anSite(path);
  const isNew = kind === 'v' && b.n ? 1 : 0, ret = isNew && b.rt ? 1 : 0;
  const views = kind === 'v' ? 1 : 0, engaged = kind === 'v' && s >= 10 ? 1 : 0, deep = kind === 'v' && depth >= 75 ? 1 : 0;
  const placeId = anPlaceFromPath(path);
  const st = [];
  st.push(d.prepare(`INSERT INTO an_day (day, views, visits, visitors, ret, eng_sec, engaged, place_views) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET views = views + excluded.views, visits = visits + excluded.visits, visitors = visitors + excluded.visitors,
    ret = ret + excluded.ret, eng_sec = eng_sec + excluded.eng_sec, engaged = engaged + excluded.engaged, place_views = place_views + excluded.place_views`)
    .bind(day, views, entry, isNew, ret, s, engaged, placeId && views ? 1 : 0));
  st.push(d.prepare(`INSERT INTO an_page (day, path, views, entries, eng_sec, engaged, deep) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, path) DO UPDATE SET views = views + excluded.views, entries = entries + excluded.entries, eng_sec = eng_sec + excluded.eng_sec,
    engaged = engaged + excluded.engaged, deep = deep + excluded.deep`).bind(day, path, views, entry, s, engaged, deep));
  st.push(d.prepare(`INSERT INTO an_seg (day, cc, dev, src, blang, site, views, visits, visitors, eng_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, cc, dev, src, blang, site) DO UPDATE SET views = views + excluded.views, visits = visits + excluded.visits,
    visitors = visitors + excluded.visitors, eng_sec = eng_sec + excluded.eng_sec`).bind(day, cc, dev, src, blang, site, views, entry, isNew, s));
  if (entry && b.us) {
    st.push(d.prepare(`INSERT INTO an_cmp (day, src, med, cmp, visits) VALUES (?, ?, ?, ?, 1) ON CONFLICT(day, src, med, cmp) DO UPDATE SET visits = visits + 1`)
      .bind(day, anStr(b.us, 40).toLowerCase(), anStr(b.um, 40).toLowerCase(), anStr(b.uc, 60).toLowerCase()));
  }
  const meta = (id, name, area, url) => {
    if (!name) return;
    st.push(d.prepare(`INSERT INTO an_place_meta (place, name, area, url) VALUES (?, ?, ?, ?)
      ON CONFLICT(place) DO UPDATE SET name = excluded.name, area = COALESCE(NULLIF(excluded.area, ''), area), url = COALESCE(NULLIF(excluded.url, ''), url)
      WHERE name IS NOT excluded.name OR (excluded.area != '' AND area IS NOT excluded.area) OR (excluded.url != '' AND url IS NOT excluded.url)`)
      .bind(id, anText(name, 80), anText(area, 40), url || ''));
  };
  if (placeId && views) {
    st.push(d.prepare(`INSERT INTO an_place (day, place, views) VALUES (?, ?, 1) ON CONFLICT(day, place) DO UPDATE SET views = views + 1`).bind(day, placeId));
    meta(placeId, b.pn, b.pa, path);
  }
  // 버튼·링크 (같은 비콘 안의 같은 행동은 합쳐서 한 번에)
  const evs = {}, places = {};
  for (const e of (Array.isArray(b.ev) ? b.ev.slice(0, 30) : [])) {
    const ev = anStr(e && e.e, 20);
    if (!AN_EVENTS.has(ev)) continue;
    const v = anStr(e.v, 40).toLowerCase().replace(/[^a-z0-9._:\-]/g, '') || '-';
    evs[ev + '|' + v] = (evs[ev + '|' + v] || 0) + 1;
    const pid = anStr(e.p, 80, /^[A-Za-z0-9_.:-]{1,80}$/);
    if (pid && AN_PLACE_COL[ev]) {
      const k = pid; places[k] = places[k] || { maps: 0, route: 0, saves: 0, reviews: 0, sites: 0 };
      places[k][AN_PLACE_COL[ev]]++;
      meta(pid, e.n, e.a, anPath(e.u));
    }
  }
  for (const [k, n] of Object.entries(evs)) {
    const [ev, v] = k.split('|');
    st.push(d.prepare(`INSERT INTO an_evt (day, ev, v, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, ev, v) DO UPDATE SET n = n + excluded.n`).bind(day, ev, v, n));
  }
  for (const [pid, c] of Object.entries(places)) {
    st.push(d.prepare(`INSERT INTO an_place (day, place, maps, route, saves, reviews, sites) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, place) DO UPDATE SET maps = maps + excluded.maps, route = route + excluded.route, saves = saves + excluded.saves,
      reviews = reviews + excluded.reviews, sites = sites + excluded.sites`).bind(day, pid, c.maps, c.route, c.saves, c.reviews, c.sites));
  }
  await d.batch(st);
}

// 관리자 KPI: 기간(days)과 바로 앞 같은 길이 기간의 합계
async function anReport(d, days) {
  const end = anDay(), start = anShift(end, -(days - 1)), pStart = anShift(start, -days), pEnd = anShift(start, -1);
  const all = async (sql, ...a) => (await d.prepare(sql).bind(...a).all()).results || [];
  const sum = `SUM(views) AS views, SUM(visits) AS visits, SUM(visitors) AS visitors, SUM(eng_sec) AS eng_sec`;
  const dim = (col) => all(`SELECT ${col} AS k, ${sum} FROM an_seg WHERE day BETWEEN ? AND ? GROUP BY ${col} ORDER BY views DESC LIMIT 200`, start, end);
  const [series, pages, cc, dev, src, blang, site, cmp, places, evts, prevPlaces] = await Promise.all([
    all('SELECT * FROM an_day WHERE day BETWEEN ? AND ? ORDER BY day', pStart, end),
    all(`SELECT path, SUM(views) AS views, SUM(entries) AS entries, SUM(eng_sec) AS eng_sec, SUM(engaged) AS engaged, SUM(deep) AS deep
         FROM an_page WHERE day BETWEEN ? AND ? GROUP BY path ORDER BY views DESC LIMIT 800`, start, end),
    dim('cc'), dim('dev'), dim('src'), dim('blang'), dim('site'),
    all('SELECT src, med, cmp, SUM(visits) AS visits FROM an_cmp WHERE day BETWEEN ? AND ? GROUP BY src, med, cmp ORDER BY visits DESC LIMIT 100', start, end),
    all(`SELECT p.place, SUM(p.views) AS views, SUM(p.maps) AS maps, SUM(p.route) AS route, SUM(p.saves) AS saves, SUM(p.reviews) AS reviews, SUM(p.sites) AS sites,
           m.name, m.area, m.url FROM an_place p LEFT JOIN an_place_meta m ON m.place = p.place WHERE p.day BETWEEN ? AND ?
         GROUP BY p.place ORDER BY (SUM(p.maps) + SUM(p.route) + SUM(p.saves) + SUM(p.reviews) + SUM(p.sites)) DESC, SUM(p.views) DESC LIMIT 300`, start, end),
    all('SELECT ev, v, SUM(n) AS n FROM an_evt WHERE day BETWEEN ? AND ? GROUP BY ev, v ORDER BY n DESC LIMIT 300', start, end),
    all(`SELECT place, SUM(views) + SUM(maps) + SUM(route) + SUM(saves) + SUM(reviews) + SUM(sites) AS act FROM an_place WHERE day BETWEEN ? AND ? GROUP BY place`, pStart, pEnd),
  ]);
  const first = await d.prepare('SELECT MIN(day) AS d FROM an_day').first();
  return { range: { start, end, pStart, pEnd, days, since: first && first.d }, series, pages, dims: { cc, dev, src, blang, site }, cmp, places, evts, prevPlaces };
}
// ── 여기부터 이 경로의 처리 ──

const seen = new Map();   // 같은 작업자(isolate) 안에서만 쓰는 가벼운 횟수 제한
function tooMany(ip) {
  const t = Date.now(), r = seen.get(ip);
  if (!r || t - r.t > 600e3) { seen.set(ip, { t, n: 1 }); if (seen.size > 5000) seen.clear(); return false; }
  return ++r.n > 200;
}
const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const o = request.headers.get('Origin');
  if (o) { try { if (new URL(o).host !== new URL(request.url).host) return done(); } catch (e) { return done(); } }
  const ua = request.headers.get('user-agent') || '';
  if (anIsBot(ua) || !env.HANTANG_DB) return done();
  if (tooMany(request.headers.get('CF-Connecting-IP') || '0')) return done();
  let b;
  try { const t = await request.text(); if (!t || t.length > 6000) return done(); b = JSON.parse(t); } catch (e) { return done(); }
  if (!b || typeof b !== 'object') return done();
  ctx.waitUntil((async () => { try { const d = await anDb(env); if (d) await anRecord(d, b, ua, request.cf || {}); } catch (e) {} })());
  return done();
}
export async function onRequestGet() { return new Response(null, { status: 405 }); }
