// GET /api/photo/<id>/<n> — 게시된 업장 사진 (업주가 사용을 허락한 사진만, 승인 때 복사해 둔 것)
export async function onRequestGet({ params, env }) {
  const p = Array.isArray(params.path) ? params.path : [];
  if (!env.HANTANG_KV || p.length !== 2 || !/^[0-9a-f-]{6,40}$/.test(p[0]) || !/^\d$/.test(p[1])) return new Response('Not found', { status: 404 });
  const r = await env.HANTANG_KV.getWithMetadata(`pubph:${p[0]}:${p[1]}`, 'arrayBuffer');
  if (!r || !r.value) return new Response('Not found', { status: 404 });
  return new Response(r.value, {
    headers: { 'content-type': (r.metadata && r.metadata.type) || 'image/jpeg', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' },
  });
}
