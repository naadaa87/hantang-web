// /api/admin/* — 업주 신청 검토 (Cloudflare Zero Trust Access 로 잠근 관리자만)
//   GET  /api/admin/list                 신청·게시 목록
//   GET  /api/admin/photo/<id>/<n>       신청 사진
//   GET/POST /api/admin/community     회원 글·후기·댓글·회원 관리 (D1)
//   GET  /api/admin/kpi?days=28        방문 통계·지점 인기·커뮤니티·업주 신청 KPI (D1·KV)
//   POST /api/admin/decide {id, action: approve|hold|reject|unpublish|delete, pub:{...}, photos:[n,...]}
// ── 공통 도구 (개발용 소스 site/functions/_lib/common.js 에서 붙임) ──
// 한탕 업장 등록 — Cloudflare Pages Functions 공통 도구
// KV 바인딩 이름: HANTANG_KV  (Pages 프로젝트 → 설정 → 바인딩 → KV 네임스페이스)
// 관리자 API 는 Cloudflare Zero Trust Access 로 잠그고, 환경 변수 ACCESS_TEAM_DOMAIN·ACCESS_AUD 로 토큰을 다시 확인한다.

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra },
  });
}

// 업주에게 보이는 업종 이름 → 사이트 유형
const TYPES = {
  bath: '목욕탕(대중탕)', bathjjim: '목욕탕 + 찜질방', jjim: '찜질방', kiln: '한증막·불가마', sauna: '사우나(남성·여성)',
  seshin: '세신샵', private: '1인·프라이빗 목욕/사우나', spa: '스파·온천 리조트', hotel: '호텔 사우나', other: '기타',
};
const TYPE_EN = {
  bath: 'Neighborhood bath', bathjjim: 'Bath + jjimjilbang', jjim: 'Jjimjilbang', kiln: 'Hanjeungmak', sauna: 'Sauna',
  seshin: 'Scrub shop', private: 'Private bath', spa: 'Spa / hot spring resort', hotel: 'Hotel sauna', other: 'Bath business',
};

const REGIONS = [
  [/^서울/, 'seoul'], [/^부산/, 'busan'], [/^인천/, 'incheon'], [/^대구/, 'daegu'], [/^대전/, 'daejeon'], [/^울산/, 'ulsan'], [/^세종/, 'sejong'],
  [/^경기/, 'gyeonggi'], [/^강원/, 'gangwon'], [/^충(청)?북/, 'chungbuk'], [/^충(청)?남/, 'chungnam'], [/^전(라)?북|^전북특별/, 'jeonbuk'],
  [/^전(라)?남|^광주|^전남광주/, 'jeonnam-gwangju'], [/^경(상)?북/, 'gyeongbuk'], [/^경(상)?남/, 'gyeongnam'], [/^제주/, 'jeju'],
];
function regionOf(addr) {
  const a = String(addr || '').trim();
  for (const [re, slug] of REGIONS) if (re.test(a)) return slug;
  return '';
}

function clean(v, max = 500) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function newId() {
  const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '');
  const r = crypto.getRandomValues(new Uint8Array(4));
  return d + '-' + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
}

// data:image/...;base64,... → {type, bytes}  (JPEG·PNG·WebP 만, 2 MB 이하)
function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const bin = atob(m[2]);
  if (bin.length > 2 * 1024 * 1024) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8, png = bytes[0] === 0x89 && bytes[1] === 0x50, webp = bin.slice(8, 12) === 'WEBP';
  if (!(jpg || png || webp)) return null;
  return { type: jpg ? 'image/jpeg' : png ? 'image/png' : 'image/webp', bytes };
}

// ── Cloudflare Access 토큰 확인 (관리자) ──
function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
let certCache = { at: 0, keys: [] };
async function verifyAccess(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = env.ACCESS_AUD || '';
  if (!team || !aud) return { ok: false, why: 'not_configured' };
  let token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') || '');
    token = m && m[1];
  }
  if (!token) return { ok: false, why: 'no_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, why: 'bad_token' };
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch (e) { return { ok: false, why: 'bad_token' }; }
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { ok: false, why: 'bad_aud' };
  if (payload.iss !== 'https://' + team) return { ok: false, why: 'bad_iss' };
  if (!payload.exp || payload.exp * 1000 < Date.now()) return { ok: false, why: 'expired' };
  if (Date.now() - certCache.at > 3600e3 || !certCache.keys.some((k) => k.kid === header.kid)) {
    const r = await fetch('https://' + team + '/cdn-cgi/access/certs');
    if (!r.ok) return { ok: false, why: 'certs' };
    certCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = certCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, why: 'unknown_key' };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return good ? { ok: true, email: payload.email || '' } : { ok: false, why: 'bad_signature' };
}
// ── 여기부터 이 경로의 처리 ──
// ── 공통 도구 (개발용 소스 site/functions/_lib/community.js 에서 붙임) ──
// 한탕 회원·찜·후기·게시판 — Cloudflare Pages Functions 공통 도구
// 데이터베이스: Cloudflare D1, 바인딩 이름 HANTANG_DB (Pages 프로젝트 → 설정 → 바인딩 → D1 데이터베이스)
// 표는 처음 요청 때 저절로 만든다 (CREATE TABLE IF NOT EXISTS). 바인딩이 없으면 모든 API 가 503 not_configured 를 돌려준다.
//
// 비밀번호: 브라우저가 PBKDF2-SHA256(비밀번호, 'hantang|' + 소문자 닉네임, 120,000회)로 늘린 값(key)만 보낸다.
// 서버는 key 에 사용자별 무작위 소금(salt)을 붙여 SHA-256 으로 한 번 더 감싸 저장한다 → 무료 요금제 CPU 한도(10ms) 안에서 동작.
// 세션: 무작위 토큰을 HttpOnly 쿠키(ht_s)로, 토큰의 SHA-256 만 DB 에 둔다. ht_in=1 은 화면이 로그인 여부만 아는 표시 쿠키(비밀 아님).
// 연락처·이메일은 받지 않는다. 접속 IP 는 횟수 제한 키로만 잠깐(최대 하루) 쓰고 저장하지 않는다.

const HC_FOLDERS = { en: '', ja: 'ja/', 'zh-Hant': 'zh-hant/', 'zh-Hans': 'zh-hans/', vi: 'vi/', th: 'th/', ru: 'ru/', ko: 'ko/' };
const HC_LANGS = Object.keys(HC_FOLDERS);
const HC_CATS = ['free', 'qna', 'tips'];

const HC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, nick TEXT NOT NULL UNIQUE COLLATE NOCASE, key_hash TEXT NOT NULL, salt TEXT NOT NULL, rec_hash TEXT NOT NULL, lang TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok')`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS saved (user_id INTEGER NOT NULL, place TEXT NOT NULL, name TEXT, url TEXT, sub TEXT, at INTEGER, PRIMARY KEY (user_id, place))`,
  `CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, target TEXT NOT NULL, user_id INTEGER NOT NULL, anon INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, rating INTEGER, lang TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', reports INTEGER NOT NULL DEFAULT 0, tname TEXT, turl TEXT)`,
  `CREATE INDEX IF NOT EXISTS comments_target ON comments(target, id)`,
  `CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id, id)`,
  `CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, cat TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, user_id INTEGER NOT NULL, anon INTEGER NOT NULL DEFAULT 0, lang TEXT, created INTEGER NOT NULL, updated INTEGER, status TEXT NOT NULL DEFAULT 'ok', reports INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, ncomments INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS posts_list ON posts(status, id)`,
  `CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, id)`,
  `CREATE TABLE IF NOT EXISTS likes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, reason TEXT, created INTEGER NOT NULL, UNIQUE (kind, item_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)`,
];
let hcReady = false;

async function hcDb(env) {
  const d = env.HANTANG_DB;
  if (!d) return null;
  if (!hcReady) { await d.batch(HC_SCHEMA.map((s) => d.prepare(s))); hcReady = true; }
  return d;
}

function out(data, status = 200, headers = {}) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x)); else h.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers: h });
}
const notReady = () => out({ ok: false, error: 'not_configured' }, 503);
const nowSec = () => Math.floor(Date.now() / 1000);

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
}
function randHex(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, '0')).join(''); }
function sameKey(a, b) {   // 길이가 같을 때 끝까지 비교 (시간 차이로 맞춰 보기 어렵게)
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// 복구 코드: 헷갈리는 글자(0 O 1 I L) 없이 16자, 4자씩
const REC_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecovery() {
  const r = crypto.getRandomValues(new Uint8Array(16));
  const s = Array.from(r, (x) => REC_ABC[x % REC_ABC.length]).join('');
  return s.match(/.{4}/g).join('-');
}
const normRec = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function clientIp(request) { return request.headers.get('CF-Connecting-IP') || request.headers.get('x-real-ip') || '0'; }

// 다른 사이트에서 보낸 요청 막기 (쿠키 로그인 보호)
function sameOrigin(request) {
  const o = request.headers.get('Origin');
  if (!o) return true;
  try { return new URL(o).host === new URL(request.url).host; } catch (e) { return false; }
}

// 횟수 제한: k 를 window 초 동안 limit 번까지
async function hit(d, k, limit, windowSec) {
  const t = nowSec();
  const r = await d.prepare(`INSERT INTO hits (k, n, exp) VALUES (?1, 1, ?2)
    ON CONFLICT(k) DO UPDATE SET n = CASE WHEN hits.exp < ?3 THEN 1 ELSE hits.n + 1 END, exp = CASE WHEN hits.exp < ?3 THEN ?2 ELSE hits.exp END
    RETURNING n`).bind(k, t + windowSec, t).first();
  if (Math.random() < 0.02) await d.prepare('DELETE FROM hits WHERE exp < ?').bind(t).run();
  return !r || r.n <= limit;
}

const RESERVED = /admin|hantang|한탕|운영자|관리자|manager|moderator|official|anonymous|익명|匿名|ẩn danh|ไม่ระบุชื่อ|аноним|deleted|system/i;
function nickOk(n) {
  return typeof n === 'string' && /^[\p{L}\p{M}\p{N}_.\-]{2,20}$/u.test(n) && !RESERVED.test(n);
}
function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
}
const linkCount = (s) => (String(s).match(/https?:\/\/|www\./gi) || []).length;
const langOk = (l) => (HC_LANGS.includes(l) ? l : 'en');

const COOKIE = (name, value, maxAge, httpOnly) => `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;
async function startSession(d, userId) {
  const token = randHex(32), t = nowSec(), life = 180 * 86400;
  await d.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)').bind(await sha(token), userId, t, t + life).run();
  return { 'set-cookie': [COOKIE('ht_s', token, life, true), COOKIE('ht_in', '1', life, false)] };
}
function endCookies() { return { 'set-cookie': [COOKIE('ht_s', '', 0, true), COOKIE('ht_in', '', 0, false)] }; }

async function currentUser(request, d) {
  const m = /(?:^|;\s*)ht_s=([0-9a-f]{64})/.exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  const row = await d.prepare(`SELECT u.id, u.nick, u.status, u.created, u.lang, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires > ?`).bind(await sha(m[1]), nowSec()).first();
  if (!row || row.status === 'deleted') return null;
  return row;
}

async function readJson(request) {
  try {
    const t = await request.text();
    if (t.length > 40000) return null;
    return JSON.parse(t);
  } catch (e) { return null; }
}

// 선택: Cloudflare Turnstile (봇 막기). TURNSTILE_SECRET 환경 변수가 있을 때만 확인한다.
async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const f = new FormData(); f.append('secret', env.TURNSTILE_SECRET); f.append('response', token); f.append('remoteip', ip);
  try {
    const r = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f })).json();
    return !!r.success;
  } catch (e) { return false; }
}

// 글쓴이 이름: 익명이면 이름을 보내지 않는다 (번호만)
function authorOf(row, viewer, anonNo) {
  const deleted = row.ustatus === 'deleted' || !row.nick;
  return {
    anon: !!row.anon,
    name: row.anon ? null : (deleted ? null : row.nick),
    gone: !row.anon && deleted,
    no: row.anon ? (anonNo || 0) : 0,
    mine: !!(viewer && viewer.id === row.user_id),
  };
}

// ── 게시글 페이지를 검색엔진이 읽을 수 있게 서버에서 채운다 (/<언어>/board/p/<번호>) ──
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="nofollow ugc noopener" target="_blank">$1</a>').split(/\n{2,}/).map((p) => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
async function renderPost(ctx, folder) {
  const { request, env, params } = ctx;
  const id = parseInt(params.id, 10);
  const shell = await env.ASSETS.fetch(new URL('/' + folder + 'board/post/', request.url));
  if (!shell.ok) return shell;
  let page = await shell.text();
  const d = await hcDb(env);
  let post = null;
  if (d && id > 0) {
    post = await d.prepare('SELECT p.*, u.nick, u.status AS ustatus FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?').bind(id).first();
  }
  const base = new URL(request.url).origin + '/';
  if (!post || post.status !== 'ok') {
    return new Response(page, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
  }
  const want = HC_FOLDERS[post.lang] ?? '';
  if (want !== folder) return Response.redirect(base + want + 'board/p/' + id, 301);
  // 검색엔진에는 늘 정식 주소(hantang.kr)를 알린다. 빈 틀에 이미 들어 있는 canonical 의 주소를 그대로 쓴다.
  const cm = page.match(/<link rel="canonical" href="(https?:\/\/[^/"]+)\//);
  const url = (cm ? cm[1] + '/' : base) + folder + 'board/p/' + id;
  const desc = post.body.replace(/\s+/g, ' ').slice(0, 150);
  const rows = (await d.prepare(`SELECT c.id, c.body, c.anon, c.user_id, c.created, u.nick, u.status AS ustatus FROM comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.target = ? AND c.status = 'ok' ORDER BY c.id LIMIT 50`).bind('post:' + id).all()).results || [];
  const who = (r) => (r.anon ? '—' : esc(r.nick || '—'));
  const body = `<article class="hc-post" data-ssr="1"><h1>${esc(post.title)}</h1><div class="hc-meta"><span>${who(post)}</span> · <time datetime="${new Date(post.created * 1000).toISOString()}">${new Date(post.created * 1000).toISOString().slice(0, 10)}</time></div>`
    + `<div class="hc-body">${para(post.body)}</div></article>`
    + (rows.length ? `<ol class="hc-ssr-comments">${rows.map((r) => `<li><b>${who(r)}</b> ${para(r.body)}</li>`).join('')}</ol>` : '');
  const qa = post.cat === 'qna' && rows.length > 0;   // 답이 없는 질문은 QAPage 로 내지 않는다
  const ld = { '@context': 'https://schema.org', '@type': qa ? 'QAPage' : 'DiscussionForumPosting' };
  if (qa) {
    ld.mainEntity = { '@type': 'Question', name: post.title, text: post.body.slice(0, 2000), dateCreated: new Date(post.created * 1000).toISOString(), answerCount: rows.length,
      author: { '@type': 'Person', name: post.anon ? 'Anonymous' : (post.nick || 'Member') },
      suggestedAnswer: rows.slice(0, 10).map((r) => ({ '@type': 'Answer', text: r.body.slice(0, 1500), dateCreated: new Date(r.created * 1000).toISOString(), author: { '@type': 'Person', name: r.anon ? 'Anonymous' : (r.nick || 'Member') } })) };
  } else {
    Object.assign(ld, { headline: post.title, text: post.body.slice(0, 2000), url, datePublished: new Date(post.created * 1000).toISOString(),
      author: { '@type': 'Person', name: post.anon ? 'Anonymous' : (post.nick || 'Member') }, commentCount: rows.length,
      interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: post.likes } });
  }
  page = page
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(post.title)} — HANTANG</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(post.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta name="robots" content="noindex[^"]*">/, '<meta name="robots" content="index,follow,max-image-preview:large">')
    .replace(/\n?<link rel="alternate" hreflang="[^"]*" href="[^"]*">/g, '')
    .replace('<!--HC_POST-->', body)
    .replace('<!--HC_LD-->', '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>')
    .replace('data-post=""', `data-post="${id}"`);
  return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}
// ── 여기부터 이 경로의 처리 ──
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
const AN_EVENTS = new Set(['map', 'route', 'save', 'review', 'site', 'share', 'lang', 'out', 'game', 'partner', 'signup', 'login', 'post', 'comment', 'review_post', 'filter', 'video', 'photo']);

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

// ── 회원 글·후기·댓글 관리 (GET /api/admin/community?kind=…, POST /api/admin/community {op, kind, id}) ──
async function community(request, env, method) {
  const v = await verifyAccess(request, env);
  if (!v.ok) return json({ ok: false, error: 'forbidden', why: v.why }, 403);
  const d = await hcDb(env);
  if (!d) return json({ ok: false, error: 'not_configured', what: 'HANTANG_DB' }, 503);
  if (method === 'GET') {
    const q = new URL(request.url).searchParams, kind = q.get('kind') || 'posts', only = q.get('status') || '';
    const st = ['ok', 'hold', 'hidden'].includes(only) ? `AND x.status = '${only}'` : "AND x.status != 'deleted'";
    if (kind === 'posts') return json({ ok: true, items: (await d.prepare(`SELECT x.id, x.cat, x.title, substr(x.body,1,300) AS body, x.lang, x.anon, x.created, x.status, x.reports, x.likes, x.ncomments, u.nick, u.id AS uid FROM posts x LEFT JOIN users u ON u.id = x.user_id WHERE 1 ${st} ORDER BY x.id DESC LIMIT 200`).all()).results });
    if (kind === 'comments') return json({ ok: true, items: (await d.prepare(`SELECT x.id, x.target, x.tname, x.turl, substr(x.body,1,300) AS body, x.rating, x.lang, x.anon, x.created, x.status, x.reports, u.nick, u.id AS uid FROM comments x LEFT JOIN users u ON u.id = x.user_id WHERE 1 ${st} ORDER BY x.id DESC LIMIT 300`).all()).results });
    if (kind === 'reports') return json({ ok: true, items: (await d.prepare(`SELECT r.kind, r.item_id, COUNT(*) AS n, GROUP_CONCAT(r.reason, ' / ') AS reasons, MAX(r.created) AS last FROM reports r GROUP BY r.kind, r.item_id ORDER BY last DESC LIMIT 200`).all()).results });
    if (kind === 'users') return json({ ok: true, items: (await d.prepare(`SELECT u.id, u.nick, u.lang, u.created, u.status, (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS posts, (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comments FROM users u ORDER BY u.id DESC LIMIT 300`).all()).results, total: (await d.prepare('SELECT COUNT(*) AS n FROM users').first()).n });
    return json({ ok: false, error: 'not_found' }, 404);
  }
  let b; try { b = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }
  const id = parseInt(b.id, 10); if (!(id > 0)) return json({ ok: false, error: 'bad_id' }, 400);
  const table = b.kind === 'post' ? 'posts' : b.kind === 'comment' ? 'comments' : b.kind === 'user' ? 'users' : '';
  if (!table) return json({ ok: false, error: 'kind' }, 400);
  if (table === 'users') {
    if (b.op === 'ban') await d.batch([d.prepare("UPDATE users SET status = 'banned' WHERE id = ? AND status != 'deleted'").bind(id), d.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]);
    else if (b.op === 'unban') await d.prepare("UPDATE users SET status = 'ok' WHERE id = ? AND status = 'banned'").bind(id).run();
    else if (b.op === 'hide_all') await d.batch([d.prepare("UPDATE posts SET status = 'hidden' WHERE user_id = ? AND status != 'deleted'").bind(id), d.prepare("UPDATE comments SET status = 'hidden' WHERE user_id = ? AND status != 'deleted'").bind(id)]);
    else return json({ ok: false, error: 'action' }, 400);
    return json({ ok: true });
  }
  const to = { hide: 'hidden', show: 'ok', delete: 'deleted' }[b.op];
  if (!to) return json({ ok: false, error: 'action' }, 400);
  await d.prepare(`UPDATE ${table} SET status = ?${b.op === 'show' ? ', reports = 0' : ''} WHERE id = ?`).bind(to, id).run();
  if (b.op === 'show') await d.prepare('DELETE FROM reports WHERE kind = ? AND item_id = ?').bind(b.kind, id).run();
  return json({ ok: true, status: to, at: nowSec() });
}

// ── KPI (GET /api/admin/kpi?days=28) ──
async function kpi(request, env) {
  const v = await verifyAccess(request, env);
  if (!v.ok) return json({ ok: false, error: 'forbidden', why: v.why }, 403);
  const d = await anDb(env);
  if (!d) return json({ ok: false, error: 'not_configured', what: 'HANTANG_DB' }, 503);
  const days = Math.max(1, Math.min(365, parseInt(new URL(request.url).searchParams.get('days'), 10) || 28));
  const r = await anReport(d, days);
  // 커뮤니티 (회원·글·후기) — 테이블은 hcDb 가 만든다
  const ts = (day) => Math.floor(Date.parse(day + 'T00:00:00+09:00') / 1000);
  const from = ts(r.range.start), to = ts(anShift(r.range.end, 1)), pFrom = ts(r.range.pStart);
  let community = null;
  try {
    const h = await hcDb(env);
    const one = async (sql, ...a) => (await h.prepare(sql).bind(...a).first()) || {};
    const cnt = async (table, extra = '') => {
      const x = await one(`SELECT SUM(CASE WHEN created >= ? AND created < ? THEN 1 ELSE 0 END) AS cur, SUM(CASE WHEN created >= ? AND created < ? THEN 1 ELSE 0 END) AS prev, COUNT(*) AS total FROM ${table} WHERE 1 ${extra}`, from, to, pFrom, from);
      return { cur: x.cur || 0, prev: x.prev || 0, total: x.total || 0 };
    };
    community = {
      users: await cnt('users', "AND status != 'deleted'"),
      posts: await cnt('posts', "AND status != 'deleted'"),
      reviews: await cnt('comments', "AND status != 'deleted' AND target LIKE 'place:%' AND rating IS NOT NULL"),
      comments: await cnt('comments', "AND status != 'deleted' AND NOT (target LIKE 'place:%' AND rating IS NOT NULL)"),
      saved: await one('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM saved'),
      hold: (await one("SELECT (SELECT COUNT(*) FROM posts WHERE status = 'hold') + (SELECT COUNT(*) FROM comments WHERE status = 'hold') AS n")).n || 0,
      rated: (await h.prepare(`SELECT target, MAX(tname) AS name, MAX(turl) AS url, COUNT(*) AS n, ROUND(AVG(rating), 2) AS avg FROM comments
                WHERE status = 'ok' AND target LIKE 'place:%' AND rating IS NOT NULL GROUP BY target ORDER BY n DESC, avg DESC LIMIT 20`).all()).results || [],
      savedTop: (await h.prepare('SELECT place, MAX(name) AS name, MAX(url) AS url, COUNT(*) AS n FROM saved GROUP BY place ORDER BY n DESC LIMIT 20').all()).results || [],
    };
  } catch (e) { community = null; }
  // 업주 등록 신청 (KV)
  let partner = null;
  if (env.HANTANG_KV) {
    try {
      partner = { total: 0, pending: 0, hold: 0, approved: 0, rejected: 0, cur: 0 };
      let cursor, n = 0;
      do {
        const pg = await env.HANTANG_KV.list({ prefix: 'sub:', cursor });
        for (const k of pg.keys) {
          if (++n > 400) break;
          const x = await env.HANTANG_KV.get(k.name, 'json'); if (!x) continue;
          partner.total++; partner[x.status] = (partner[x.status] || 0) + 1;
          if (x.created && Date.parse(x.created) / 1000 >= from) partner.cur++;
        }
        cursor = pg.list_complete || n > 400 ? null : pg.cursor;
      } while (cursor);
    } catch (e) { partner = null; }
  }
  return json({ ok: true, today: anDay(), ...r, community, partner });
}

const PUBLIC_FIELDS = ['name_ko', 'name_en', 'address', 'hours', 'closed', 'prices', 'booking', 'url', 'desc_ko', 'desc_en', 'region', 'claim', 'type', 'english', 'tattoo', 'features'];

// 검색엔진(Bing·Naver·Yandex·Seznam 등 IndexNow 참여 엔진)에 사이트맵의 주소를 한 번에 알린다
async function indexNow(request) {
  const origin = new URL(request.url).origin, host = new URL(request.url).host;
  const key = ((await (await fetch(origin + '/indexnow-key.txt')).text()) || '').trim();
  if (!/^[0-9a-f]{32}$/.test(key)) return json({ ok: false, error: 'key' }, 500);
  const xml = await (await fetch(origin + '/sitemap.xml')).text();
  const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (m) => m[1]).map((u) => u.replace(/^https?:\/\/[^/]+/, origin)).slice(0, 10000);
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: origin + '/indexnow-key.txt', urlList: urls }),
  });
  return json({ ok: r.status === 200 || r.status === 202, status: r.status, sent: urls.length });
}

async function guard(request, env) {
  const v = await verifyAccess(request, env);
  if (!v.ok) return json({ ok: false, error: 'forbidden', why: v.why }, 403);
  if (!env.HANTANG_KV) return json({ ok: false, error: 'not_configured' }, 503);
  return null;
}

export async function onRequestGet({ request, env, params }) {
  const p = Array.isArray(params.path) ? params.path : [];
  if (p[0] === 'community') return community(request, env, 'GET');
  if (p[0] === 'kpi') return kpi(request, env);
  const bad = await guard(request, env); if (bad) return bad;
  const kv = env.HANTANG_KV;
  if (p[0] === 'list') {
    const out = [];
    let cursor;
    do {
      const page = await kv.list({ prefix: 'sub:', cursor });
      for (const k of page.keys) { const v = await kv.get(k.name, 'json'); if (v) out.push(v); }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    out.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    return json({ ok: true, items: out });
  }
  if (p[0] === 'photo' && p.length === 3 && /^[0-9a-f-]{6,40}$/.test(p[1]) && /^\d$/.test(p[2])) {
    const r = await kv.getWithMetadata(`subph:${p[1]}:${p[2]}`, 'arrayBuffer');
    if (!r || !r.value) return new Response('Not found', { status: 404 });
    return new Response(r.value, { headers: { 'content-type': (r.metadata && r.metadata.type) || 'image/jpeg', 'cache-control': 'private, no-store' } });
  }
  if (p[0] === 'whoami') { const v = await verifyAccess(request, env); return json({ ok: true, email: v.email }); }
  return json({ ok: false, error: 'not_found' }, 404);
}

export async function onRequestPost({ request, env, params }) {
  const p = Array.isArray(params.path) ? params.path : [];
  if (p[0] === 'community') return community(request, env, 'POST');
  const bad = await guard(request, env); if (bad) return bad;
  if (p[0] === 'indexnow') return indexNow(request);
  if (p[0] !== 'decide') return json({ ok: false, error: 'not_found' }, 404);
  const kv = env.HANTANG_KV;
  let b; try { b = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{6,40}$/.test(id)) return json({ ok: false, error: 'bad_id' }, 400);
  const rec = await kv.get('sub:' + id, 'json');
  if (!rec) return json({ ok: false, error: 'not_found' }, 404);
  const who = (await verifyAccess(request, env)).email || '';
  const now = new Date().toISOString();

  async function unpublish() {
    await kv.delete('pub:' + id);
    for (let i = 0; i < 5; i++) await kv.delete(`pubph:${id}:${i}`);
  }
  if (b.action === 'approve') {
    const src = b.pub || {};
    const pub = { id, updated: now };
    for (const k of PUBLIC_FIELDS) {
      if (k === 'features') pub.features = Array.isArray(src.features) ? src.features.slice(0, 20).map((x) => clean(x, 30)) : rec.features || [];
      else pub[k] = clean(src[k] != null ? src[k] : rec[k], k.startsWith('desc') ? 800 : 300);
    }
    if (pub.url && !/^https?:\/\//.test(pub.url)) pub.url = '';
    if (!/^[a-z-]{4,20}$/.test(pub.region)) return json({ ok: false, error: 'region' }, 400);
    pub.type_label = TYPE_EN[pub.type] || TYPE_EN.other;
    // 게시할 사진: 업주가 사용을 허락한 경우에만
    await unpublish();
    const pick = rec.agree_photo && Array.isArray(b.photos) ? b.photos.filter((n) => Number.isInteger(n) && n >= 0 && n < (rec.photos || 0)).slice(0, 5) : [];
    pub.photos = [];
    for (let j = 0; j < pick.length; j++) {
      const r = await kv.getWithMetadata(`subph:${id}:${pick[j]}`, 'arrayBuffer');
      if (r && r.value) { await kv.put(`pubph:${id}:${j}`, r.value, { metadata: r.metadata }); pub.photos.push(`${id}/${j}`); }
    }
    await kv.put('pub:' + id, JSON.stringify(pub), { metadata: { region: pub.region } });
    rec.status = 'approved';
  } else if (b.action === 'hold') {
    rec.status = 'hold';
  } else if (b.action === 'reject') {
    await unpublish(); rec.status = 'rejected';
  } else if (b.action === 'unpublish') {
    await unpublish(); rec.status = 'hold';
  } else if (b.action === 'delete') {
    await unpublish();
    for (let i = 0; i < 5; i++) await kv.delete(`subph:${id}:${i}`);
    await kv.delete('sub:' + id);
    return json({ ok: true, deleted: id });
  } else {
    return json({ ok: false, error: 'action' }, 400);
  }
  rec.note = clean(b.note, 300);
  rec.decided = now; rec.decided_by = who;
  await kv.put('sub:' + id, JSON.stringify(rec), { metadata: { status: rec.status, name: rec.name_ko, created: rec.created } });
  return json({ ok: true, status: rec.status });
}
