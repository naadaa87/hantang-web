// POST /api/partner — 업주 등록 신청 접수 (공개)
// 저장: sub:<id> (신청 내용, 담당자 연락처 포함 — 공개하지 않음), subph:<id>:<n> (사진)
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

const FEATURES = ['men', 'women', 'jjim', 'sleep', 'h24', 'parking', 'towel', 'seshin', 'private', 'women_only', 'sauna_hot', 'cold_pool', 'foreign_card', 'english'];

export async function onRequestPost({ request, env }) {
  if (!env.HANTANG_KV) return json({ ok: false, error: 'not_configured' }, 503);
  const kv = env.HANTANG_KV;
  // 같은 곳에서 한 시간에 5번까지
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = 'rl:' + ip + ':' + new Date().toISOString().slice(0, 13);
  const n = parseInt((await kv.get(rl)) || '0', 10);
  if (n >= 5) return json({ ok: false, error: 'too_many' }, 429);
  await kv.put(rl, String(n + 1), { expirationTtl: 3700 });

  if ((request.headers.get('content-length') | 0) > 12 * 1024 * 1024) return json({ ok: false, error: 'too_large' }, 413);
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }
  if (b.website) return json({ ok: true, id: 'ok' });            // 자동 등록 방지용 빈칸
  if (Date.now() - Number(b.t0 || 0) < 15000) return json({ ok: false, error: 'too_fast' }, 400);

  const f = {
    name_ko: clean(b.name_ko, 80), name_en: clean(b.name_en, 80), type: TYPES[b.type] ? b.type : 'other',
    address: clean(b.address, 160), address2: clean(b.address2, 80), claim: /^[kb]\d{6,40}$/.test(b.claim || '') ? b.claim : '',
    hours: clean(b.hours, 120), closed: clean(b.closed, 80),
    price_bath: clean(b.price_bath, 60), price_jjim: clean(b.price_jjim, 60), price_seshin: clean(b.price_seshin, 80), price_other: clean(b.price_other, 160),
    english: ['yes', 'some', 'no'].includes(b.english) ? b.english : '', tattoo: ['ok', 'cover', 'no', 'ask'].includes(b.tattoo) ? b.tattoo : '',
    features: Array.isArray(b.features) ? b.features.filter((x) => FEATURES.includes(x)).slice(0, 20) : [],
    booking: clean(b.booking, 160), url: /^https?:\/\/\S{3,300}$/.test(b.url || '') ? clean(b.url, 300) : '',
    instagram: clean(b.instagram, 60), desc_ko: clean(b.desc_ko, 600), msg_foreign: clean(b.msg_foreign, 300),
    biz_no: clean(b.biz_no, 30),
    contact_name: clean(b.contact_name, 40), contact_phone: clean(b.contact_phone, 30), contact_email: clean(b.contact_email, 100), contact_role: clean(b.contact_role, 20),
    agree_privacy: b.agree_privacy === true, agree_photo: b.agree_photo === true,
  };
  const need = [];
  if (!f.name_ko) need.push('name_ko');
  if (!f.address) need.push('address');
  if (!f.contact_name) need.push('contact_name');
  if (!/^[0-9+\-\s()]{8,20}$/.test(f.contact_phone)) need.push('contact_phone');
  if (f.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact_email)) need.push('contact_email');
  if (!f.agree_privacy) need.push('agree_privacy');
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, 5) : [];
  if (photos.length && !f.agree_photo) need.push('agree_photo');
  if (need.length) return json({ ok: false, error: 'missing', fields: need }, 400);

  const imgs = [];
  for (const p of photos) {
    const img = decodeImage(p);
    if (!img) return json({ ok: false, error: 'bad_photo' }, 400);
    imgs.push(img);
  }
  const id = newId();
  for (let i = 0; i < imgs.length; i++) {
    await kv.put(`subph:${id}:${i}`, imgs[i].bytes, { metadata: { type: imgs[i].type } });
  }
  const rec = { id, status: 'pending', created: new Date().toISOString(), region: regionOf(f.address), photos: imgs.length, ...f };
  await kv.put('sub:' + id, JSON.stringify(rec), { metadata: { status: 'pending', name: f.name_ko, created: rec.created } });
  return json({ ok: true, id });
}

export async function onRequest() {
  return json({ ok: false, error: 'method' }, 405, { allow: 'POST' });
}
