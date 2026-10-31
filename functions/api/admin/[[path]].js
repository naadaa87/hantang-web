// /api/admin/* — 업주 신청 검토 (Cloudflare Zero Trust Access 로 잠근 관리자만)
//   GET  /api/admin/list                 신청·게시 목록
//   GET  /api/admin/photo/<id>/<n>       신청 사진
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
  const bad = await guard(request, env); if (bad) return bad;
  const p = Array.isArray(params.path) ? params.path : [];
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
  const bad = await guard(request, env); if (bad) return bad;
  const p = Array.isArray(params.path) ? params.path : [];
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
