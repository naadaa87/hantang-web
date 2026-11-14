// /api/auth/* — 닉네임 회원 (이메일·전화번호를 받지 않는다)
//   POST signup   {nick, key, agree, lang, hp, t0, ts}  → {ok, nick, recovery}
//   POST login    {nick, key}                           → {ok, nick}
//   POST logout
//   GET  me                                             → {ok, nick, created}
//   POST password {key, newkey}
//   POST recover  {nick, code, newkey}                  → {ok, nick, recovery}
//   POST delete   {key}
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

const KEY_RE = /^[0-9a-f]{64}$/;

export async function onRequestGet({ request, env, params }) {
  const d = await hcDb(env); if (!d) return notReady();
  const p = Array.isArray(params.path) ? params.path : [];
  if (p[0] !== 'me') return out({ ok: false, error: 'not_found' }, 404);
  const u = await currentUser(request, d);
  if (!u) return out({ ok: false, error: 'login' }, 401, endCookies());
  return out({ ok: true, nick: u.nick, created: u.created, status: u.status });
}

export async function onRequestPost({ request, env, params }) {
  const d = await hcDb(env); if (!d) return notReady();
  if (!sameOrigin(request)) return out({ ok: false, error: 'origin' }, 403);
  const p = Array.isArray(params.path) ? params.path : [];
  const b = (await readJson(request)) || {};
  const ip = clientIp(request), t = nowSec();

  if (p[0] === 'signup') {
    if (b.hp) return out({ ok: false, error: 'bad_request' }, 400);
    if (!(await hit(d, 'su:' + ip, 6, 86400))) return out({ ok: false, error: 'rate' }, 429);
    if (!(await turnstileOk(env, b.ts, ip))) return out({ ok: false, error: 'captcha' }, 400);
    const nick = String(b.nick || '').normalize('NFC').trim();
    if (!nickOk(nick)) return out({ ok: false, error: 'nick_bad' }, 400);
    if (!KEY_RE.test(b.key || '')) return out({ ok: false, error: 'bad_request' }, 400);
    if (b.agree !== true) return out({ ok: false, error: 'agree' }, 400);
    if (Number(b.t0) < 2500) return out({ ok: false, error: 'rate' }, 429);   // 2.5초 안에 채운 양식은 로봇으로 본다
    const salt = randHex(16), rec = newRecovery();
    try {
      const r = await d.prepare('INSERT INTO users (nick, key_hash, salt, rec_hash, lang, created) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(nick, await sha(salt + b.key), salt, await sha(salt + normRec(rec)), langOk(b.lang), t).first();
      return out({ ok: true, nick, recovery: rec }, 200, await startSession(d, r.id));
    } catch (e) {
      if (/UNIQUE/i.test(String(e && e.message))) return out({ ok: false, error: 'nick_taken' }, 409);
      throw e;
    }
  }

  if (p[0] === 'login') {
    const nick = String(b.nick || '').normalize('NFC').trim();
    if (!(await hit(d, 'li:' + ip, 30, 3600)) || !(await hit(d, 'ln:' + nick.toLowerCase(), 12, 3600))) return out({ ok: false, error: 'rate' }, 429);
    const u = await d.prepare("SELECT id, nick, key_hash, salt, status FROM users WHERE nick = ? AND status != 'deleted'").bind(nick).first();
    if (!u || !KEY_RE.test(b.key || '') || !sameKey(await sha(u.salt + b.key), u.key_hash)) return out({ ok: false, error: 'login' }, 401);
    return out({ ok: true, nick: u.nick }, 200, await startSession(d, u.id));
  }

  if (p[0] === 'logout') {
    const m = /(?:^|;\s*)ht_s=([0-9a-f]{64})/.exec(request.headers.get('Cookie') || '');
    if (m) await d.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(m[1])).run();
    return out({ ok: true }, 200, endCookies());
  }

  if (p[0] === 'recover') {
    if (!(await hit(d, 'rc:' + ip, 10, 3600))) return out({ ok: false, error: 'rate' }, 429);
    const nick = String(b.nick || '').normalize('NFC').trim();
    const u = await d.prepare("SELECT id, nick, salt, rec_hash FROM users WHERE nick = ? AND status != 'deleted'").bind(nick).first();
    if (!u || !KEY_RE.test(b.newkey || '') || !sameKey(await sha(u.salt + normRec(b.code)), u.rec_hash)) return out({ ok: false, error: 'code' }, 400);
    const rec = newRecovery();
    await d.batch([
      d.prepare('UPDATE users SET key_hash = ?, rec_hash = ? WHERE id = ?').bind(await sha(u.salt + b.newkey), await sha(u.salt + normRec(rec)), u.id),
      d.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    ]);
    return out({ ok: true, nick: u.nick, recovery: rec }, 200, await startSession(d, u.id));
  }

  // 아래는 로그인한 사람만
  const me = await currentUser(request, d);
  if (!me) return out({ ok: false, error: 'login' }, 401, endCookies());
  const full = await d.prepare('SELECT key_hash, salt FROM users WHERE id = ?').bind(me.id).first();
  if (!(await hit(d, 'pw:' + me.id, 10, 3600))) return out({ ok: false, error: 'rate' }, 429);
  const okKey = KEY_RE.test(b.key || '') && sameKey(await sha(full.salt + b.key), full.key_hash);

  if (p[0] === 'password') {
    if (!okKey) return out({ ok: false, error: 'login' }, 401);
    if (!KEY_RE.test(b.newkey || '')) return out({ ok: false, error: 'bad_request' }, 400);
    await d.batch([
      d.prepare('UPDATE users SET key_hash = ? WHERE id = ?').bind(await sha(full.salt + b.newkey), me.id),
      d.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(me.id, me.token_hash),
    ]);
    return out({ ok: true });
  }

  if (p[0] === 'delete') {
    if (!okKey) return out({ ok: false, error: 'login' }, 401);
    // 글·후기는 남기되 '탈퇴한 회원'으로 보이게, 로그인 정보·찜 목록은 지운다
    await d.batch([
      d.prepare("UPDATE users SET status = 'deleted', nick = ?, key_hash = '', rec_hash = '' WHERE id = ?").bind('deleted-' + me.id + '-' + randHex(3), me.id),
      d.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id),
      d.prepare('DELETE FROM saved WHERE user_id = ?').bind(me.id),
      d.prepare('DELETE FROM likes WHERE user_id = ?').bind(me.id),
    ]);
    return out({ ok: true }, 200, endCookies());
  }

  return out({ ok: false, error: 'not_found' }, 404);
}
