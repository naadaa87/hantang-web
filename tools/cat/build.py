#!/usr/bin/env python3
"""테마(카테고리) 페이지 만들기 — 해수탕, 한증막·숯가마, 스파 워터파크, 24시간 찜질방, 여성 전용.

하는 일
  1) baths/<테마>/ 페이지를 8개 언어로 만든다. 틀은 같은 언어의 온천 페이지(baths/hot-springs/)를 쓴다.
     · 한탕에 지점 페이지가 있는 곳: 그 언어의 지점 페이지에서 이름·소개·주소·대표 사진을 가져온다.
     · 지점 페이지가 없는 곳: entries.json(한국관광공사 관광정보 2026-10-31 자료, 인허가 목록과 대조)과
       i18n/<언어>.json 의 소개 글로 카드를 만든다. 사진은 한국관광공사 공공누리 제1·3유형만 쓴다.
  2) 목록 첫 화면(baths/)에 '테마별로 찾기' 묶음을, 온천 페이지와 각 테마 페이지에 다른 테마로 가는 타일을 넣는다.
  3) sitemap.xml, llms.txt 에 새 주소를 넣는다.

여러 번 돌려도 결과가 같다(표식 <!--cat:...--> 사이를 다시 쓴다).
tools/media/build.py 로 지점 사진을 바꾼 뒤에는 이 파일을 한 번 더 돌린다.

글 고치기: i18n/<언어>.json (화면 글), pages.json (어느 지점이 어느 페이지에, 거르기 꼬리표), entries.json (관광공사 자료 지점의 사실)
사용법: python3 tools/cat/build.py          (저장소 맨 위에서)
        python3 tools/cat/build.py --check  (바꾸지 않고 무엇이 바뀔지만 본다)
"""
import datetime, html, importlib.util, json, os, re, sys
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHECK = '--check' in sys.argv
LANGS = [('en', ''), ('ja', 'ja'), ('zh-Hant', 'zh-hant'), ('zh-Hans', 'zh-hans'), ('vi', 'vi'), ('th', 'th'), ('ru', 'ru'), ('ko', 'ko')]
SITE = 'https://hantang.kr/'
ONLY = [a.split('=', 1)[1] for a in sys.argv if a.startswith('--only=')]
ALL_LANGS = list(LANGS)
if ONLY: LANGS = [x for x in LANGS if x[0] in ONLY[0].split(',')]   # 시험용: 일부 언어만 (sitemap·llms.txt 는 건드리지 않음)
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d')

_spec = importlib.util.spec_from_file_location('media_build', os.path.join(ROOT, 'tools', 'media', 'build.py'))
MB = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MB)   # 사진 출처 문구(언어별)를 같이 쓴다

e = lambda s: html.escape(str(s), quote=True)
def rd(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()
def jl(p): return json.load(open(os.path.join(HERE, p), encoding='utf-8'))
def txt(h): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', h or ''))).strip()

CFG = jl('pages.json'); ENT = jl('entries.json')
MEDIA = json.load(open(os.path.join(ROOT, 'tools', 'media', 'media.json'), encoding='utf-8')).get('places', {})
SLUGS = [s for s in CFG['order'] if s != 'hot-springs']

REGION_OF = [('서울', 'seoul'), ('부산', 'busan'), ('인천', 'incheon'), ('대구', 'daegu'), ('대전', 'daejeon'), ('울산', 'ulsan'),
             ('세종', 'sejong'), ('경기', 'gyeonggi'), ('강원', 'gangwon'), ('충북', 'chungbuk'), ('충청북', 'chungbuk'),
             ('충남', 'chungnam'), ('충청남', 'chungnam'), ('전북', 'jeonbuk'), ('전라북', 'jeonbuk'), ('전남', 'jeonnam-gwangju'),
             ('전라남', 'jeonnam-gwangju'), ('광주광역', 'jeonnam-gwangju'), ('경북', 'gyeongbuk'), ('경상북', 'gyeongbuk'),
             ('경남', 'gyeongnam'), ('경상남', 'gyeongnam'), ('제주', 'jeju')]
def region_of(addr):
    for k, v in REGION_OF:
        if addr.startswith(k): return v
    return 'other'

def page_rel(d, slug): return os.path.join(d, 'baths', slug, 'index.html') if d else os.path.join('baths', slug, 'index.html')
def page_url(d, slug): return SITE + (d + '/' if d else '') + 'baths/%s/' % slug

# ── 지점 페이지에서 그 언어의 카드 재료를 읽는다
_place_cache = {}
def place(pid, lang, d):
    key = (pid, lang)
    if key in _place_cache: return _place_cache[key]
    rel = os.path.join(d, 'baths', 'p', pid, 'index.html') if d else os.path.join('baths', 'p', pid, 'index.html')
    s = rd(rel)
    a = re.search(r'<article\b[^>]*\bdata-hx="%s"[^>]*>' % re.escape(pid), s)
    at = a.group(0)
    attr = lambda n: html.unescape((re.search(r'\b%s="([^"]*)"' % n, at) or [None, ''])[1])
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S).group(1)
    latin = txt(re.split(r'<span', h1, maxsplit=1)[0]) if lang != 'ko' else ''
    lede = re.search(r'<p class="lede"[^>]*>(.*?)</p>', s, re.S)
    seg = s[a.end():a.end() + 1600]
    hero = re.match(r'\s*<div class="(?:dimg|pimg)[^"]*"[^>]*>\s*(<img [^>]*>)\s*(<span class="pcap">.*?</span>)?', seg, re.S)
    il = bool(re.match(r'\s*<div class="(?:dimg|pimg)" data-mx-il=', seg))   # 일러스트는 페이지마다 경로가 달라 카드에서 다시 만든다
    if il: hero = None
    geo = re.search(r'"latitude":\s*"?([\d.]+)"?,\s*"longitude":\s*"?([\d.]+)', s)
    r = dict(name=latin, ko=attr('data-n'), addr=attr('data-addr'), sub=attr('data-sub'),
             lede=(lede.group(1).strip() if lede else ''), lat=geo.group(1) if geo else '', lng=geo.group(2) if geo else '',
             hero_img=(re.search(r'src="([^"]+)"', hero.group(1)).group(1) if hero else ''),
             hero_cap=(hero.group(2) or '') if hero else '', il=il)
    _place_cache[key] = r
    return r

# ── 그 언어 온천 페이지(틀)에서 읽는 것
def template_bits(s):
    root = json.loads(re.search(r'<script type="application/json" id="hxT">(.*?)</script>', s, re.S).group(1))['root']
    regs = re.search(r'<div class="rx-regions">(.*?)</div>', s, re.S).group(1)
    labels = {}
    order = []
    for m in re.finditer(r'<a href="[^"]*baths/([a-z-]+)/">(.*?)<span>', regs):
        labels[m.group(1)] = txt(m.group(2)); order.append(m.group(1))
    hs_count = len(re.findall(r'<article class="pcard"', s))
    hs_name = txt(re.search(r'<nav class="crumbs"[^>]*>(?:(?!</nav>).)*<span>([^<]*)</span></nav>', s, re.S).group(1))
    return root, labels, order, hs_count, hs_name

STYLE = '''<style data-cx>
  .hs2-facts.c3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cx-about{border-radius:18px;background:var(--blue-tint);border:1px solid #CFE2EE;padding:22px 24px;position:relative;overflow:hidden}
  .cx-about h2{font-size:21px;margin:0;line-height:1.35}
  .cx-about p{font-size:14.5px;color:var(--ink);margin-top:10px;line-height:1.7;max-width:640px}
  .cx-about .eb{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--blue)}
  .cx-about a.go{display:inline-block;margin-top:12px;font-weight:700;color:var(--blue)}
  .cx-tips{border:1px solid var(--line);border-radius:18px;background:#fff;padding:18px 20px}
  .cx-tips h2{font-size:17px;margin:0}
  .cx-tips ul{margin:10px 0 0;padding-left:1.1em;font-size:14px;line-height:1.65}
  .cx-tips li{margin-top:7px}.cx-tips li::marker{color:var(--blue)}
  .pcard .pimg.cx-t{aspect-ratio:auto;height:64px;justify-content:flex-start;padding:0 20px;background:linear-gradient(135deg,#EAF3F8 0%,#F3EEE6 100%)}
  .pcard .pimg.cx-t svg{width:32px;height:32px}
  .cx-n{font-size:19px;font-weight:700;margin-top:8px;line-height:1.35;word-break:keep-all}
  .cx-n span{font-family:var(--serif);color:var(--blue);font-size:16px;font-weight:600}
  .cx-d{font-size:14px;color:var(--mute);margin-top:9px;line-height:1.65}
  .cx-h{display:flex;gap:7px;align-items:flex-start;margin-top:9px;font-size:13px;line-height:1.55;color:var(--ink)}
  .cx-h svg{flex:0 0 auto;width:15px;height:15px;margin-top:2px;color:var(--blue)}
  .cx-h small{display:block;color:var(--mute);font-size:12.5px}
  .cx-note{margin-top:22px;font-size:14px;color:var(--ink);border:1px solid var(--line);border-radius:14px;background:var(--stone);padding:14px 16px;max-width:820px;line-height:1.6}
  .cx-note a{color:var(--blue);font-weight:700}
  @media (max-width:560px){.hs2-facts.c3{grid-template-columns:repeat(2,minmax(0,1fr))}.cx-about{padding:18px}}
  ''' + re.sub(r'</?style[^>]*>', '', MB.IL_CSS) + '''
</style>'''

THEME_STYLE = '''<style data-cx-th>
  .cx-themes{margin-top:44px}
  .cx-themes .sec-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--blue)}
  .cx-th{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
  .cx-th a{display:grid;grid-template-columns:40px minmax(0,1fr);gap:4px 12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff;color:var(--ink);text-decoration:none;min-width:0}
  .cx-th a:hover{border-color:var(--blue)}
  .cx-th a.on{border-color:var(--blue);background:var(--blue-tint)}
  .cx-th svg{grid-row:span 2;width:40px;height:40px;color:var(--blue)}
  .cx-th b{font-size:15.5px;line-height:1.3;word-break:keep-all}
  .cx-th b small{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--mute);margin-left:6px}
  .cx-th span{font-size:12.5px;color:var(--mute);line-height:1.45}
  @media (max-width:860px){.cx-th{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:520px){.cx-th{grid-template-columns:1fr}}
</style>'''

CLOCK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.6V8l2.3 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

def count_txt(T, n): return T['ui']['count_one'] if n == 1 else T['ui']['count'].format(n=n)

def hours_html(en, T):
    U = T['ui']; parts = []
    for lab, t in en['hours']:
        if t == '@24': t2 = U['h24s'] if lab else U['h24']
        else: t2 = t
        parts.append(('%s %s' % (U['hl'][lab], t2)) if lab else t2)
    line = ' · '.join(parts)
    if en.get('last'): line += (' (' + U['last'].format(t=en['last']) + ')') if line else U['last'].format(t=en['last'])
    if en.get('closed'):
        c = U['closed'][en['closed']]
        line = (line + ' · ' + c) if line else c
    notes = ' '.join(U['notes'][n] for n in en.get('notes', []))
    if not line and not notes: return ''
    return '<div class="cx-h">%s<div>%s%s</div></div>' % (CLOCK, e(line), ('<small>%s</small>' % e(notes)) if notes else '')

def strip(photos, hid, name_ko, lang):
    """카드 안의 사진 줄(첫 사진은 카드 맨 위에 쓰고 나머지)."""
    if not photos: return ''
    items = []; creds = []
    for i, (u, n) in enumerate(photos):
        cr, cl = MB.credit({'kind': 'kto', 'lic': 'KOGL-%d' % n}, lang)
        if (cr, cl) not in creds: creds.append((cr, cl))
        th = u.replace('_image2_', '_image3_')
        items.append('<a class="mx-a" href="%s" data-an="photo:%s" data-cr="%s" data-cl="%s" target="_blank" rel="noopener" referrerpolicy="no-referrer">'
                     '<img src="%s" alt="%s %d" lang="ko" loading="lazy" decoding="async" referrerpolicy="no-referrer" height="92" onerror="this.onerror=null;this.src=this.parentNode.href"></a>'
                     % (e(u), e(hid), e(cr), e(cl), e(th), e(name_ko), i + 2))
    return '<div class="mx-strip">%s</div><div class="mx-sc">%s</div>' % (''.join(items), ' · '.join('<a href="%s" target="_blank" rel="noopener">%s</a>' % (e(cl), e(cr)) for cr, cl in creds))

def tile(icon, label=''):
    return '<div class="pimg cx-t"><svg aria-hidden="true"><use href="#%s"/></svg></div>' % icon

def card_kto(cid, tags, T, lang, root, icon, ld):
    en = ENT[cid]; U = T['ui']
    hid = 'kto-' + cid
    kind = U['kinds'][en['kind']]; city = U['cities'][en['city']]
    sub = '%s · %s' % (kind, city)
    name = en['ko'] if lang == 'ko' else en['en']
    h3 = e(name) if lang == 'ko' else '%s <span lang="ko">%s</span>' % (e(name), e(en['ko']))
    photos = en['photos']
    if photos:
        u, n = photos[0]; cr, cl = MB.credit({'kind': 'kto', 'lic': 'KOGL-%d' % n}, lang)
        top = ('<div class="pimg"><img src="%s" alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
               '<span class="pcap"><a href="%s" target="_blank" rel="noopener">%s</a></span></div>' % (e(u), e(en['ko']), e(cl), e(cr)))
    elif hid in MB.ILL:
        top = MB.il_html('pimg', icon, hid, name, lang, root)
    else:
        top = tile(icon, kind)
    chips = ''.join('<span class="hs2-tag w">%s</span>' % e(U['tags'][t]) for t in tags)
    desc = T['desc'][cid]
    site = ''
    if en['site']:
        lab = U['insta'] if 'instagram.com' in en['site'] else U['site']
        site = '<div class="hs2-more"><a href="%s" target="_blank" rel="noopener" data-an="site:%s">%s</a></div>' % (e(en['site']), e(hid), e(lab))
    body = ('<div class="pbody"><div class="hs-kind">%s</div><h3 class="cx-n">%s</h3>%s<p class="cx-d">%s</p>%s'
            '<div class="pa" lang="ko" style="margin-top:8px;font-size:13.5px">%s</div>%s%s<div class="hx-links"></div></div>'
            % (e(sub), h3, ('<div class="hs2-tags">%s</div>' % chips) if chips else '', e(desc), hours_html(en, T), e(en['addr']),
               strip(photos[1:], hid, en['ko'], lang), site))
    item = {'@type': 'TouristAttraction', 'name': (en['en'] + ' ' + en['ko']) if lang != 'ko' else en['ko'],
            'address': {'@type': 'PostalAddress', 'streetAddress': en['addr'], 'addressCountry': 'KR'},
            'geo': {'@type': 'GeoCoordinates', 'latitude': en['lat'], 'longitude': en['lng']}, 'description': desc}
    if photos: item['image'] = photos[0][0]
    ld.append((hid, item))
    return ('<article class="pcard" id="%s" data-f="%s" data-hx="%s" data-n="%s" data-addr="%s" data-lat="%s" data-lng="%s" data-sub="%s">%s%s</article>'
            % (hid, ' '.join(tags), hid, e(en['ko']), e(en['addr']), en['lat'], en['lng'], e(sub), top, body)), en['region']

def card_place(pid, tags, T, lang, d, root, icon, ld):
    p = place(pid, lang, d); U = T['ui']
    name = p['ko'] if lang == 'ko' else (p['name'] or p['ko'])
    h3 = e(name) if lang == 'ko' else '%s <span lang="ko">%s</span>' % (e(name), e(p['ko']))
    if p['il'] and pid in MB.ILL:
        top = MB.il_html('pimg', icon, pid, name, lang, root); img = ''
    elif p['hero_img']:
        top = '<div class="pimg"><img src="%s" alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer">%s</div>' % (e(p['hero_img']), e(p['ko']), p['hero_cap'])
        img = p['hero_img']
    else:
        ph = (MEDIA.get(pid, {}).get('photos') or [None])[0]
        if ph:
            cr, cl = MB.credit(ph, lang)
            top = ('<div class="pimg"><img src="%s" alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
                   '<span class="pcap"><a href="%s" target="_blank" rel="noopener">%s</a></span></div>' % (e(ph['src']), e(MB.cap_of(ph, lang) or p['ko']), e(cl), e(cr)))
            img = ph['src']
        else:
            top = tile(icon, p['sub'].split(' · ')[-1]); img = ''
    chips = ''.join('<span class="hs2-tag w">%s</span>' % e(U['tags'][t]) for t in tags)
    over = T.get('override', {}).get(pid)
    lede = e(over) if over else p['lede']
    link = '%sbaths/p/%s/' % (root, pid)
    body = ('<div class="pbody"><div class="hs-kind">%s</div><h3 class="cx-n">%s</h3>%s<p class="cx-d">%s</p>'
            '%s<div class="hs2-more"><a href="%s">%s</a></div><div class="hx-links"></div></div>'
            % (e(p['sub']), h3, ('<div class="hs2-tags">%s</div>' % chips) if chips else '', lede,
               ('<div class="pa" lang="ko" style="margin-top:8px;font-size:13.5px">%s</div>' % e(p['addr'])) if p['addr'] else '', link, e(U['more'])))
    geo = (' data-lat="%s" data-lng="%s"' % (p['lat'], p['lng'])) if p['lat'] else ''
    item = {'@type': 'TouristAttraction', 'name': (name + ' ' + p['ko']) if lang != 'ko' else p['ko'],
            'address': {'@type': 'PostalAddress', 'streetAddress': p['addr'], 'addressCountry': 'KR'},
            'url': page_url(d, 'p/' + pid), 'description': over or txt(p['lede'])}
    if p['lat']: item['geo'] = {'@type': 'GeoCoordinates', 'latitude': float(p['lat']), 'longitude': float(p['lng'])}
    if img: item['image'] = img
    ld.append((pid, item))
    return ('<article class="pcard" id="%s" data-f="%s" data-hx="%s" data-n="%s" data-addr="%s"%s data-sub="%s">%s%s</article>'
            % (pid, ' '.join(tags), pid, e(p['ko']), e(p['addr']), geo, e(p['sub']), top, body)), (CFG.get('region_fix', {}).get(pid) or region_of(p['addr']))

def themes_block(T, root, cur, counts, hs_name, with_style=True):
    U = T['ui']; tiles = []
    for slug in CFG['order']:
        name = hs_name if slug == 'hot-springs' else U['names'][slug]
        on = ' class="on" aria-current="page"' if slug == cur else ''
        tiles.append('<a href="%sbaths/%s/"%s><svg aria-hidden="true"><use href="#%s"/></svg><b>%s<small>%d</small></b><span>%s</span></a>'
                     % (root, slug, on, CFG['icons'][slug], e(name), counts[slug], e(U['tiles'][slug])))
    return ('<!--cat:themes-->%s<div class="cx-themes" id="themes"><div class="sec-eyebrow">%s</div><h2 style="font-size:22px;margin-top:6px">%s</h2><div class="cx-th">%s</div></div><!--cat:/themes-->'
            % (THEME_STYLE if with_style else '', e(U['themes_eb']), e(U['themes_h']), ''.join(tiles)))

RE_THEMES = re.compile(r'<!--cat:themes-->.*?<!--cat:/themes-->', re.S)

def build_page(slug, lang, d, tpl, T, counts):
    P = CFG['pages'][slug]; X = T['pages'][slug]; U = T['ui']
    root, labels, rorder, hs_count, hs_name = template_bits(tpl)
    s = tpl
    url = page_url(d, slug)
    # 머리
    title = X['title']; desc = X['desc']
    s = re.sub(r'<title>.*?</title>', '<title>%s</title>' % e(title), s, count=1, flags=re.S)
    for pat in (r'(<meta name="description" content=")[^"]*', r'(<meta property="og:description" content=")[^"]*', r'(<meta name="twitter:description" content=")[^"]*'):
        s = re.sub(pat, lambda m: m.group(1) + e(desc), s, count=1)
    for pat in (r'(<meta property="og:title" content=")[^"]*', r'(<meta name="twitter:title" content=")[^"]*'):
        s = re.sub(pat, lambda m: m.group(1) + e(title), s, count=1)
    s = re.sub(r'(<meta property="og:image:alt" content=")[^"]*', lambda m: m.group(1) + e(X['h1']), s, count=1)
    # 구조화 데이터
    ld_items = []
    # 본문 카드
    groups = {}
    for iid, tags in P['items']:
        if iid.isdigit(): html_, reg = card_kto(iid, tags, T, lang, root, P['icon'], ld_items)
        else: html_, reg = card_place(iid, tags, T, lang, d, root, P['icon'], ld_items)
        groups.setdefault(reg, []).append(html_)
    n_all = len(P['items'])
    regs = []
    for r in rorder + ['other']:
        if r not in groups: continue
        regs.append('<div class="hs2-reg" id="r-%s"><h2>%s <small>%s</small></h2><div class="pc-grid">%s</div></div>'
                    % (r, e(labels.get(r, r)), e(count_txt(T, len(groups[r]))), ''.join(groups[r])))
    missing = [r for r in groups if r not in rorder]
    if missing: print('!! 지역 이름을 못 찾음:', slug, lang, missing)
    # 숫자 상자
    facts = []
    for f in P['facts']:
        if f == '@count': big, lab = str(n_all), U['count_fact']
        elif f.startswith('@count:'):
            t = f.split(':', 1)[1]; big = str(sum(1 for _, tg in P['items'] if t in tg)); lab = X['facts'][f]
        else: big, lab = X['facts'][f]
        facts.append('<div class="hs2-fact"><b>%s</b><span>%s</span></div>' % (e(big), e(lab)))
    # 소개·가이드
    g = P.get('guide'); guide = ''
    if g and os.path.exists(os.path.join(ROOT, d, 'guide', g, 'index.html') if d else os.path.join(ROOT, 'guide', g, 'index.html')):
        gh = txt(re.search(r'<h1[^>]*>(.*?)</h1>', rd(os.path.join(d, 'guide', g, 'index.html') if d else os.path.join('guide', g, 'index.html')), re.S).group(1))
        guide = '<a class="go" href="%sguide/%s/">%s →</a>' % (root, g, e(gh))
    about = '<div class="cx-about"><div class="eb">%s</div><h2 style="margin-top:8px">%s</h2>%s%s</div>' % (
        e(X['eyebrow']), e(X['about_h']), ''.join('<p>%s</p>' % e(p) for p in X['about']), guide)
    tips = '<div class="cx-tips"><h2>%s</h2><ul>%s</ul></div>' % (e(X['tips_h']), ''.join('<li>%s</li>' % e(t) for t in X['tips']))
    filt = '<div class="hs2-filter" role="group" aria-label="%s"><button type="button" data-hsf="all" aria-pressed="true" class="on">%s</button>%s</div>' % (
        e(U['filter_aria']), e(U['all']), ''.join('<button type="button" data-hsf="%s" aria-pressed="false">%s</button>' % (f, e(U['tags'][f])) for f in P['filters']))
    note = ''
    if X.get('note'):
        sp = place('spa-slick-eunpyeong', lang, d)
        nm = sp['ko'] if lang == 'ko' else (sp['name'] or sp['ko'])
        note = '<p class="cx-note">%s</p>' % e(X['note']).replace('{link}', '<a href="%sbaths/p/spa-slick-eunpyeong/">%s</a>' % (root, e(nm)))
    # 사진 출처 모음
    by = {}
    for iid, _ in P['items']:
        if iid.isdigit() and ENT[iid]['photos']:
            for _, n in ENT[iid]['photos'][:1]: by.setdefault(n, []).append(ENT[iid]['ko'])
    cred = '<br>'.join('<a href="%s" target="_blank" rel="noopener">%s</a>: <span lang="ko">%s</span>' % (
        e(MB.credit({'kind': 'kto', 'lic': 'KOGL-%d' % n}, lang)[1]), e(MB.credit({'kind': 'kto', 'lic': 'KOGL-%d' % n}, lang)[0]), e(', '.join(v)))
        for n, v in sorted(by.items(), reverse=True))
    main = (STYLE + '<!--cat:main--><div class="hs2-facts c3">%s</div><div class="hs2-lead">%s%s</div>%s%s'
            '<div class="rx-none" id="hsNone" hidden>%s</div>%s<p class="hs2-note">%s</p><div class="rx-credits">%s</div><!--cat:/main-->'
            % (''.join(facts), about, tips, filt, ''.join(regs), e(U['none']), note, e(U['src']), cred))
    a = s.index('<div class="hs2-facts">'); b = s.index('<h2 class="rx-d" style="border:0;margin-top:44px">')
    s = s[:a] + main + s[b:]
    s = RE_THEMES.sub('', s)
    # 온천 페이지 주소 → 이 페이지 주소 (머리말, 언어 고르기, 공유 그림)
    s = s.replace('baths/hot-springs/', 'baths/%s/' % slug).replace('baths-hot-springs.jpg', 'baths-%s.jpg' % slug)
    # 머리글(경로·제목)
    s = re.sub(r'(<nav class="crumbs"[^>]*>(?:(?!</nav>).)*)<span>[^<]*</span>(</nav>)', lambda m: m.group(1) + '<span>%s</span>' % e(U['names'][slug]) + m.group(2), s, count=1, flags=re.S)
    s = re.sub(r'(<header class="g-head">.*?<div class="eyebrow">)(.*?)(</div><h1>).*?(</h1><p class="lede">).*?(</p>)',
               lambda m: m.group(1) + e(X['eyebrow']) + m.group(3) + e(X['h1']) + m.group(4) + e(X['lede']) + m.group(5), s, count=1, flags=re.S)
    # 다른 테마 타일 (다른 지역 앞)
    b = s.index('<h2 class="rx-d" style="border:0;margin-top:44px">')
    s = s[:b] + themes_block(T, root, slug, counts, hs_name) + s[b:]
    # 구조화 데이터
    def ld_fix(m):
        dct = json.loads(m.group(1))
        t = dct.get('@type')
        if t == 'CollectionPage': dct['name'] = X['h1']; dct['url'] = url; dct['description'] = desc
        elif t == 'BreadcrumbList':
            dct['itemListElement'][-1]['name'] = U['names'][slug]; dct['itemListElement'][-1]['item'] = url
        elif t == 'ItemList':
            dct['name'] = X['h1']; dct['numberOfItems'] = len(ld_items)
            lst = []
            for i, (hid, it) in enumerate(ld_items):
                it = dict(it); it.setdefault('url', url + '#' + hid)
                lst.append({'@type': 'ListItem', 'position': i + 1, 'item': it})
            dct['itemListElement'] = lst
        return '<script type="application/ld+json">%s</script>' % json.dumps(dct, ensure_ascii=False)
    s = re.sub(r'<script type="application/ld\+json">(.*?)</script>', ld_fix, s, flags=re.S)
    return s

def patch_hotsprings(s, T, counts, hs_name, root):
    s = RE_THEMES.sub('', s)
    b = s.index('<h2 class="rx-d" style="border:0;margin-top:44px">')
    return s[:b] + themes_block(T, root, 'hot-springs', counts, hs_name) + s[b:]

RE_HUB = re.compile(r'<!--cat:hub-->.*?<!--cat:/hub-->', re.S)
RE_HUBQ = re.compile(r'<!--cat:q-->.*?<!--cat:/q-->', re.S)
def patch_hub(s, T, counts, hs_name):
    s = RE_HUB.sub('', s); s = RE_HUBQ.sub('', s)
    m = re.search(r'<a href="([^"]*)baths/hot-springs/">', s)
    if not m: print('!! 목록 첫 화면에서 온천 링크를 못 찾음'); return s
    root = m.group(1); U = T['ui']
    blk = themes_block(T, root, None, counts, hs_name)
    blk = blk.replace('<!--cat:themes-->', '<!--cat:hub-->', 1).replace('<!--cat:/themes-->', '<!--cat:/hub-->')
    blk = blk.replace('<div class="cx-themes" id="themes"><div class="sec-eyebrow">%s</div><h2 style="font-size:22px;margin-top:6px">%s</h2>' % (e(U['themes_eb']), e(U['themes_h'])),
                      '<div class="cx-themes" id="themes" style="margin-top:56px"><div class="sec-eyebrow">%s</div><h2 style="font-size:26px;margin-top:6px">%s</h2><p style="color:var(--mute);margin-top:8px;max-width:760px">%s</p>' % (e(U['themes_eb']), e(U['hub_h']), e(U['hub_p'])))
    i = s.find('<div style="margin-top:56px"><div class="sec-eyebrow">')
    if i < 0: print('!! 목록 첫 화면에서 넣을 자리를 못 찾음'); return s
    s = s[:i] + blk + s[i:]
    q = s.find('<a href="#saved">', s.find('<div class="hub-q">'))
    if q > 0: s = s[:q] + '<!--cat:q--><a href="#themes">%s</a><!--cat:/q-->' % e(U['hub_q']) + s[q:]
    return s

def sitemap(x):
    for slug in SLUGS:
        for lang, d in ALL_LANGS:
            u = page_url(d, slug)
            alts = ''.join('\n    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (l2, page_url(d2, slug)) for l2, d2 in ALL_LANGS)
            alts += '\n    <xhtml:link rel="alternate" hreflang="x-default" href="%s"/>' % page_url('', slug)
            blk = '<url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>%s\n  </url>' % (u, TODAY, alts)
            pat = re.compile(r'<url>\s*<loc>%s</loc>.*?</url>' % re.escape(u), re.S)
            if pat.search(x):
                old = pat.search(x).group(0)
                keep = re.sub(r'<lastmod>[^<]*</lastmod>', '<lastmod>%s</lastmod>' % (re.search(r'<lastmod>([^<]*)</lastmod>', old).group(1)), blk)
                x = pat.sub(lambda m: keep, x, 1)
            else:
                anchor = re.search(r'<url>\s*<loc>%s</loc>.*?</url>' % re.escape(page_url(d, 'hot-springs')), x, re.S)
                x = x[:anchor.end()] + '\n  ' + blk + x[anchor.end():]
    return x

def main():
    changed = []
    def save(rel, new):
        p = os.path.join(ROOT, rel)
        old = open(p, encoding='utf-8').read() if os.path.exists(p) else None
        if new != old:
            changed.append(rel)
            if not CHECK:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, 'w', encoding='utf-8').write(new)
    counts = {slug: len(CFG['pages'][slug]['items']) for slug in SLUGS}
    for lang, d in LANGS:
        T = json.load(open(os.path.join(HERE, 'i18n', lang + '.json'), encoding='utf-8'))
        hs_rel = page_rel(d, 'hot-springs'); tpl = rd(hs_rel)
        root, labels, rorder, hs_count, hs_name = template_bits(tpl)
        tpl_page = re.sub(r'<style data-il>.*?</style>\n?', '', tpl, flags=re.S)   # 일러스트 표시 모양은 STYLE 에 따로 있다
        counts['hot-springs'] = hs_count
        for slug in SLUGS:
            new = build_page(slug, lang, d, tpl_page, T, counts)
            # 이전 판과 내용이 같으면 sitemap 날짜를 그대로 둔다
            save(page_rel(d, slug), new)
        save(hs_rel, patch_hotsprings(tpl, T, counts, hs_name, root))
        hub = os.path.join(d, 'baths', 'index.html') if d else os.path.join('baths', 'index.html')
        save(hub, patch_hub(rd(hub), T, counts, hs_name))
    if ONLY:
        print('일부 언어만 만들었습니다(sitemap·llms.txt 는 그대로): %d개 파일' % len(changed)); return
    # sitemap
    sm = 'sitemap.xml'; x = rd(sm); x2 = sitemap(x)
    for rel in changed:
        u = SITE + rel.replace(os.sep, '/')[:-len('index.html')]
        x2 = re.sub(r'(<loc>%s</loc>\s*<lastmod>)[^<]*(</lastmod>)' % re.escape(u), r'\g<1>%s\g<2>' % TODAY, x2)
    save(sm, x2)
    # llms.txt
    T = json.load(open(os.path.join(HERE, 'i18n', 'en.json'), encoding='utf-8'))
    l = rd('llms.txt'); l = re.sub(r'\n- Themes: [^\n]*', '', l)
    line = '\n- Themes: ' + ', '.join('[%s](%s)' % (T['ui']['names'][s_], page_url('', s_)) for s_ in SLUGS)
    i = l.find('\n', l.find('[Hot-spring towns and foot baths]'))
    if i > 0: l = l[:i] + line + l[i:]
    save('llms.txt', l)
    print('%s: 바뀐 파일 %d개' % ('확인만' if CHECK else '완료', len(changed)))
    for c in changed[:60]: print('  ', c)

if __name__ == '__main__':
    main()
