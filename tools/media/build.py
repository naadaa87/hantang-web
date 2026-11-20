#!/usr/bin/env python3
"""지점 사진·영상 넣기 — tools/media/media.json 을 읽어 사이트 페이지에 반영한다.

하는 일
  1) 지점 상세 페이지(baths/p/<지점>/, 8개 언어)에 '사진·영상' 영역을 넣는다.
  2) 대표 사진이 없던 지점 카드(상세·목록 페이지)에 대표 사진을 넣는다 (media.json 에 hero 가 켜진 지점만).
  3) 온천 페이지(baths/hot-springs/) 카드에 사진 줄을 넣는다.
  4) 바뀐 페이지의 sitemap.xml 수정일을 오늘로 바꾼다.

여러 번 돌려도 결과가 같다(표식 사이를 다시 쓴다). media.json 에서 지운 항목은 페이지에서도 빠진다.
사이트를 다시 만들거나 다른 도구가 페이지를 덮어쓴 뒤에는 이 파일을 한 번 더 돌린다.

사진 원칙: 재사용이 허락된 사진만 쓴다 — 한국관광공사 관광정보(공공누리 1·3유형, 원본 그대로 링크),
위키미디어 공용(퍼블릭 도메인·CC0·CC BY·CC BY-SA, 작성자·라이선스 표기). 사진마다 출처를 적는다.
네이버·카카오·블로그·인스타그램 사진은 쓰지 않는다. 영상은 유튜브 퍼가기(임베드)로만 보여 준다.

사용법: python3 tools/media/build.py          (저장소 맨 위에서)
        python3 tools/media/build.py --check  (바꾸지 않고 무엇이 바뀔지만 본다)
"""
import datetime, hashlib, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHECK = '--check' in sys.argv
LANGS = [('en', ''), ('ja', 'ja'), ('zh-Hant', 'zh-hant'), ('zh-Hans', 'zh-hans'), ('vi', 'vi'), ('th', 'th'), ('ru', 'ru'), ('ko', 'ko')]

T = {
 'en': dict(sec='Photos & videos', photos='Photos', videos='Videos',
            kto='Photo: Korea Tourism Organization (KOGL Type {n})', commons='Photo: {by}, Wikimedia Commons ({lic})', unknown='Unknown author',
            vnote='Videos belong to their creators and play from YouTube. The player loads only after you press play.',
            pnote='Tap a photo to see it larger, with its source and licence.',
            watch='Watch on YouTube', official='Official channel', play='Play video', close='Close', prev='Previous', next='Next'),
 'ko': dict(sec='사진·영상', photos='사진', videos='영상',
            kto='사진: 한국관광공사(공공누리 제{n}유형)', commons='사진: {by}, 위키미디어 공용({lic})', unknown='작자 미상',
            vnote='영상은 각 제작자의 유튜브 영상입니다. 재생을 누르기 전에는 유튜브 플레이어를 불러오지 않습니다.',
            pnote='사진을 누르면 크게 볼 수 있고, 출처와 라이선스도 함께 나옵니다.',
            watch='유튜브에서 보기', official='공식 채널', play='영상 재생', close='닫기', prev='이전', next='다음'),
 'ja': dict(sec='写真・動画', photos='写真', videos='動画',
            kto='写真：韓国観光公社（KOGL 第{n}類型）', commons='写真：{by}、Wikimedia Commons（{lic}）', unknown='作者不明',
            vnote='動画は各制作者のYouTube動画です。再生ボタンを押すまで、YouTubeのプレーヤーは読み込まれません。',
            pnote='写真をタップすると大きく表示され、出典とライセンスも確認できます。',
            watch='YouTubeで見る', official='公式チャンネル', play='動画を再生', close='閉じる', prev='前へ', next='次へ'),
 'zh-Hant': dict(sec='照片與影片', photos='照片', videos='影片',
            kto='照片：韓國觀光公社（KOGL 第 {n} 類）', commons='照片：{by}，Wikimedia Commons（{lic}）', unknown='作者不詳',
            vnote='影片皆為各創作者的 YouTube 影片，按下播放後才會載入 YouTube 播放器。',
            pnote='點選照片可放大檢視，並顯示來源與授權。',
            watch='在 YouTube 觀看', official='官方頻道', play='播放影片', close='關閉', prev='上一張', next='下一張'),
 'zh-Hans': dict(sec='照片与视频', photos='照片', videos='视频',
            kto='照片：韩国观光公社（KOGL 第{n}类）', commons='照片：{by}，维基共享资源（{lic}）', unknown='作者不详',
            vnote='视频均为各创作者的 YouTube 视频，点击播放后才会加载 YouTube 播放器。',
            pnote='点击照片可放大查看，并显示来源与授权。',
            watch='在 YouTube 观看', official='官方频道', play='播放视频', close='关闭', prev='上一张', next='下一张'),
 'vi': dict(sec='Ảnh và video', photos='Ảnh', videos='Video',
            kto='Ảnh: Tổng cục Du lịch Hàn Quốc (KOGL Loại {n})', commons='Ảnh: {by}, Wikimedia Commons ({lic})', unknown='Không rõ tác giả',
            vnote='Video thuộc về người đăng và được phát từ YouTube. Trình phát chỉ được tải sau khi bạn bấm phát.',
            pnote='Chạm vào ảnh để xem lớn hơn, kèm nguồn và giấy phép.',
            watch='Xem trên YouTube', official='Kênh chính thức', play='Phát video', close='Đóng', prev='Trước', next='Sau'),
 'th': dict(sec='ภาพถ่ายและวิดีโอ', photos='ภาพถ่าย', videos='วิดีโอ',
            kto='ภาพ: องค์การส่งเสริมการท่องเที่ยวเกาหลี (KOGL ประเภทที่ {n})', commons='ภาพ: {by} · Wikimedia Commons ({lic})', unknown='ไม่ทราบชื่อผู้ถ่าย',
            vnote='วิดีโอเป็นของผู้สร้างแต่ละรายและเล่นจาก YouTube ตัวเล่นจะโหลดก็ต่อเมื่อกดเล่นเท่านั้น',
            pnote='แตะที่ภาพเพื่อดูขนาดใหญ่ พร้อมแหล่งที่มาและสัญญาอนุญาต',
            watch='ดูบน YouTube', official='ช่องทางการ', play='เล่นวิดีโอ', close='ปิด', prev='ก่อนหน้า', next='ถัดไป'),
 'ru': dict(sec='Фото и видео', photos='Фото', videos='Видео',
            kto='Фото: Корейская организация по туризму (KOGL, тип {n})', commons='Фото: {by}, Wikimedia Commons ({lic})', unknown='Автор неизвестен',
            vnote='Видео принадлежат их авторам и воспроизводятся с YouTube. Плеер загружается только после нажатия кнопки воспроизведения.',
            pnote='Нажмите на фото, чтобы увеличить его и увидеть источник и лицензию.',
            watch='Смотреть на YouTube', official='Официальный канал', play='Воспроизвести видео', close='Закрыть', prev='Назад', next='Вперёд'),
}
VLANG = {'en': 'English', 'ko': '한국어', 'ja': '日本語', 'zh': '中文', 'th': 'ไทย'}
VLANG_ATTR = {'zh': 'zh'}
MAX_VIDEOS = 3

e = lambda s: html.escape(str(s), quote=True)
def rd(p): return open(p, encoding='utf-8').read()
def ver():
    h = hashlib.sha1()
    for f in ('assets/mx.css', 'assets/mx.js'): h.update(open(os.path.join(ROOT, f), 'rb').read())
    return h.hexdigest()[:8]
VER = ver()

def credit(p, lang):
    t = T[lang]
    if p['kind'] == 'kto':
        n = p['lic'][-1]
        return t['kto'].format(n=n), 'https://www.kogl.or.kr/info/licenseType%s.do' % n
    return t['commons'].format(by=p.get('by') or t['unknown'], lic=p['lic']), p['page']

def cap_of(p, lang):
    c = p.get('cap')
    return (c.get(lang) or c.get('en')) if c else ''

def srcset(p):
    if p['kind'] == 'commons' and p.get('thumb') and p['thumb'] != p['src'] and p['w'] > 500:
        return ' srcset="%s 500w, %s %dw" sizes="(max-width:760px) 50vw, 320px"' % (e(p['thumb']), e(p['src']), p['w'])
    return ''

# ── 지점 상세 페이지: 사진·영상 영역
def photo_fig(p, i, pid, name, lang):
    cr, cl = credit(p, lang); cap = cap_of(p, lang)
    alt = cap or '%s %d' % (name, i + 1)
    thumb = p['thumb'] if (p['kind'] == 'commons' and p.get('thumb')) else p['src']
    a = ('<a class="mx-a" href="%s" data-an="photo:%s" data-cr="%s" data-cl="%s"%s target="_blank" rel="noopener" referrerpolicy="no-referrer">'
         % (e(p['src']), e(pid), e(cr), e(cl), (' data-cap="%s"' % e(cap)) if cap else ''))
    img = ('<img src="%s"%s alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="%d" height="%d">'
           % (e(thumb), srcset(p), e(alt), p['w'], p['h']))
    fc = '<figcaption>%s<a href="%s" target="_blank" rel="noopener">%s</a></figcaption>' % (('<b>%s</b>' % e(cap)) if cap else '', e(cl), e(cr))
    return '<figure class="mx-f">%s%s</a>%s</figure>' % (a, img, fc)

def vid_order(vs, lang):
    base = 'zh' if lang.startswith('zh') else lang
    def rank(v):
        l = v.get('lang', 'ko')
        if l == base: return 0
        if lang == 'ko': return 1 if l == 'en' else 2
        if l == 'en': return 1
        if l == 'ko': return 2
        return 3
    return sorted(vs, key=lambda v: (rank(v), vs.index(v)))[:MAX_VIDEOS]

def mmss(sec):
    h, r = divmod(int(sec), 3600); m, s = divmod(r, 60)
    return ('%d:%02d:%02d' % (h, m, s)) if h else ('%d:%02d' % (m, s))

def video_fig(v, pid, lang):
    t = T[lang]; hq = v.get('thumb') == 'hq720'
    meta = [e(v['channel']), VLANG.get(v.get('lang'), '')]
    if v.get('official'): meta.append('<span class="mx-of">%s</span>' % e(t['official']))
    if v.get('pub'): meta.append(v['pub'][:4])
    vl = VLANG_ATTR.get(v.get('lang'), v.get('lang', 'ko'))
    return ('<figure class="mx-v"><div class="mx-vp"><button type="button" class="mx-play" data-yt="%s"%s data-an="video:%s" data-title="%s" aria-label="%s">'
            '<img src="https://i.ytimg.com/vi/%s/%s.jpg" alt="" loading="lazy" decoding="async" width="%d" height="%d">'
            '<span class="mx-ic" aria-hidden="true"></span><span class="mx-len">%s</span></button></div>'
            '<figcaption><span class="mx-vt" lang="%s">%s</span><span class="mx-vm">%s</span>'
            '<a href="https://www.youtube.com/watch?v=%s" target="_blank" rel="noopener">%s ↗</a></figcaption></figure>'
            % (e(v['id']), ' data-v="1"' if v.get('vert') else '', e(pid), e(v['title']), e(t['play'] + ': ' + v['title']), e(v['id']), 'hq720' if hq else 'mqdefault',
               1280 if hq else 320, 720 if hq else 180, mmss(v['sec']), e(vl), e(v['title']),
               ' · '.join(x for x in meta if x), e(v['id']), e(t['watch'])))

def place_block(pid, m, name, lang, hero_src):
    t = T[lang]
    photos = m.get('photos') or []
    if len(photos) == 1 and hero_src and photos[0]['src'] == hero_src: photos = []   # 대표 사진 한 장뿐이면 되풀이하지 않는다
    videos = vid_order(m.get('videos') or [], lang)
    if not photos and not videos: return ''
    tj = json.dumps({'close': t['close'], 'prev': t['prev'], 'next': t['next']}, ensure_ascii=False)
    both = bool(photos and videos)
    out = ['<section class="mx" id="media" data-mx-t="%s">' % e(tj),
           '<h2 class="mx-h">%s</h2>' % e(t['sec'] if both else (t['photos'] if photos else t['videos']))]
    if photos:
        if both: out.append('<h3 class="mx-sub">%s</h3>' % e(t['photos']))
        n = len(photos)
        out.append('<div class="mx-grid%s">%s</div>' % (' mx-n%d' % n if n < 3 else '', ''.join(photo_fig(p, i, pid, name, lang) for i, p in enumerate(photos))))
        out.append('<p class="mx-note">%s</p>' % e(t['pnote']))
    if videos:
        if both: out.append('<h3 class="mx-sub">%s</h3>' % e(t['videos']))
        out.append('<div class="mx-vids">%s</div>' % ''.join(video_fig(v, pid, lang) for v in videos))
        out.append('<p class="mx-note">%s</p>' % e(t['vnote']))
    out.append('</section>')
    return ''.join(out)

# ── 공통: 스타일·스크립트 연결
RE_BLOCK = re.compile(r'<!--mx:b-->.*?<!--mx:e-->', re.S)
RE_LINK = re.compile(r'<link rel="stylesheet" href="[^"]*assets/mx\.css[^"]*" data-mx>\n?')
RE_SCRIPT = re.compile(r'<script src="[^"]*assets/mx\.js[^"]*" defer data-mx></script>\n?')

def assets(s, root, need):
    s = RE_LINK.sub('', s); s = RE_SCRIPT.sub('', s)
    if need:
        s = s.replace('</head>', '<link rel="stylesheet" href="%sassets/mx.css?v=%s" data-mx>\n</head>' % (root, VER), 1)
        s = s.replace('</body>', '<script src="%sassets/mx.js?v=%s" defer data-mx></script>\n</body>' % (root, VER), 1)
    return s

# ── 대표 사진 (카드 맨 위)
RE_PLACEHOLDER = r'<div class="(dimg ill|pimg nop)"><svg aria-hidden="true"><use href="#(ty-[a-z]+)"/></svg></div>'
RE_HERO = r'<div class="(dimg|pimg)" data-mx-hero="(ty-[a-z]+)">.*?</span></div>'

def hero_html(cls, icon, p, alt, lang):
    cr, cl = credit(p, lang)
    return ('<div class="%s" data-mx-hero="%s"><img src="%s" alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
            '<span class="pcap"><a href="%s" target="_blank" rel="noopener">%s</a></span></div>' % (cls, icon, e(p['src']), e(alt), e(cl), e(cr)))

def patch_hero(s, pid, m, lang):
    """data-hx 가 pid 인 카드들의 맨 위 그림을 media.json 에 맞춘다. (바뀐 글, 대표 사진 주소) 를 돌려준다."""
    want = (m.get('photos') or [None])[0] if m.get('hero') else None
    out = []; pos = 0; hero_src = None
    for a in re.finditer(r'<article\b[^>]*\bdata-hx="%s"[^>]*>' % re.escape(pid), s):
        head_end = a.end(); alt = html.unescape((re.search(r'data-n="([^"]*)"', a.group(0)) or [None, pid])[1])
        seg = s[head_end:head_end + 1400]
        m1 = re.match(r'\s*' + RE_PLACEHOLDER, seg); m2 = re.match(r'\s*' + RE_HERO, seg, re.S)
        mm = m1 or m2
        if not mm:
            g = re.match(r'\s*<div class="(?:dimg|pimg)"><img src="([^"]+)"', seg)
            if g and hero_src is None: hero_src = html.unescape(g.group(1))
            continue
        lead = re.match(r'\s*', seg).group(0)
        if m1: cls = m1.group(1).split()[0]; icon = m1.group(2)
        else: cls = m2.group(1); icon = m2.group(2)
        if want:
            new = hero_html(cls, icon, want, alt, lang); hero_src = want['src']
        else:
            new = '<div class="%s"><svg aria-hidden="true"><use href="#%s"/></svg></div>' % ('dimg ill' if cls == 'dimg' else 'pimg nop', icon)
        out.append(s[pos:head_end] + lead + new); pos = head_end + mm.end()
    out.append(s[pos:])
    return ''.join(out), hero_src

def set_ld_image(s, urls):
    """LocalBusiness 구조화 데이터에 사진 주소를 넣는다 (검색엔진이 사진을 알 수 있도록)."""
    def fix(mo):
        mine = bool(mo.group(1))
        if not urls and not mine: return mo.group(0)
        try: d = json.loads(mo.group(2))
        except Exception: return mo.group(0)
        if not isinstance(d, dict) or d.get('@type') != 'LocalBusiness': return mo.group(0)
        if urls: d['image'] = urls[:3]
        else: d.pop('image', None)
        return '<script type="application/ld+json"%s>%s</script>' % (' data-mx-img' if urls else '', json.dumps(d, ensure_ascii=False, indent=1))
    return re.sub(r'<script type="application/ld\+json"( data-mx-img)?>(.*?)</script>', fix, s, flags=re.S)

# ── 온천 페이지: 카드 안 사진 줄
RE_STRIP = re.compile(r'<!--mx:s-->.*?<!--mx:/s-->', re.S)

def strip_html(hid, photos, name_ko, lang):
    items = []; credits = []
    for i, p in enumerate(photos):
        cr, cl = credit(p, lang)
        if (cr, cl) not in credits: credits.append((cr, cl))
        cap = cap_of(p, lang); capl = ''
        if not cap and p.get('title_ko') and p['title_ko'] != name_ko: cap = p['title_ko']; capl = 'ko'
        if p['kind'] == 'kto':
            th, tw, thh = p.get('thumb') or p['src'], p.get('tw', 300), p.get('th', 200)
            fb = ' onerror="this.onerror=null;this.src=this.parentNode.href"'
        else:
            th, tw, thh, fb = p.get('thumb') or p['src'], p['w'], p['h'], ''
        w = max(40, round(92 * tw / thh))
        alt = cap or p.get('title_ko') or '%s %d' % (name_ko, i + 1)
        items.append('<a class="mx-a" href="%s" data-an="photo:hs-%s" data-cr="%s" data-cl="%s"%s%s target="_blank" rel="noopener" referrerpolicy="no-referrer">'
                     '<img src="%s" alt="%s"%s loading="lazy" decoding="async" referrerpolicy="no-referrer" width="%d" height="92"%s></a>'
                     % (e(p['src']), e(hid), e(cr), e(cl), (' data-cap="%s"' % e(cap)) if cap else '', (' data-capl="%s"' % capl) if capl else '',
                        e(th), e(alt), ' lang="ko"' if (capl or not cap) else '', w, fb))
    cred = ' · '.join('<a href="%s" target="_blank" rel="noopener">%s</a>' % (e(cl), e(cr)) for cr, cl in credits)
    return '<!--mx:s--><div class="mx-strip">%s</div><div class="mx-sc">%s</div><!--mx:/s-->' % (''.join(items), cred)

RE_HS_HERO = re.compile(r'<div class="pimg" data-mx-hs>.*?</div><!--mx:tile (.*?) -->', re.S)

def patch_springs(s, springs, lang):
    """온천 카드: 사진이 없어 온도만 보이던 카드는 맨 위에 사진을 넣고, 나머지 사진은 카드 안에 한 줄로 넣는다."""
    s = RE_STRIP.sub('', s)
    s = RE_HS_HERO.sub(lambda mo: mo.group(1), s)      # 먼저 원래 모양으로 되돌린 뒤 다시 넣는다
    n = 0; heroes = 0
    def card(mo):
        nonlocal n, heroes
        hid = mo.group(1); body = mo.group(0)
        m = springs.get(hid); photos = list((m or {}).get('photos') or [])
        if not photos: return body
        name_ko = html.unescape((re.search(r'data-n="([^"]*)"', body) or [None, hid])[1])
        hero_src = None
        top = re.match(r'(<article[^>]*>)(<div class="pimg[^"]*">.*?</div>)(?=<div class="pbody">)', body, re.S)
        if top:
            tile = top.group(2)
            if 'hs2-t' in tile and '--' not in tile:
                p = photos[0]; cr, cl = credit(p, lang)
                deg = re.search(r'<b>([\d.]+)<span>°C</span></b>', tile)
                alt = p.get('title_ko') or cap_of(p, 'ko') or name_ko
                hero = ('<div class="pimg" data-mx-hs><img src="%s" alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
                        '<span class="pcap"><a href="%s" target="_blank" rel="noopener">%s</a></span>%s</div><!--mx:tile %s -->'
                        % (e(p['src']), e(alt), e(cl), e(cr), ('<span class="hs2-deg">%s°C</span>' % deg.group(1)) if deg else '', tile))
                body = body[:top.start(2)] + hero + body[top.end(2):]
                hero_src = p['src']; heroes += 1
            else:
                g = re.search(r'<img src="([^"]+)"', tile)
                if g: hero_src = html.unescape(g.group(1))
        rest = [p for p in photos if p['src'] != hero_src]
        if rest:
            block = strip_html(hid, rest, name_ko, lang)
            for anchor in ('<div class="hs2-more">', '<div class="hx-links">'):
                i = body.find(anchor)
                if i >= 0: n += 1; body = body[:i] + block + body[i:]; break
        return body
    s = re.sub(r'<article class="pcard" id="([^"]+)"[^>]*>.*?</article>', card, s, flags=re.S)
    tj = json.dumps({'close': T[lang]['close'], 'prev': T[lang]['prev'], 'next': T[lang]['next']}, ensure_ascii=False)
    s = re.sub(r'(<body\b[^>]*?)(?: data-mx-t="[^"]*")?>', lambda mo: mo.group(1) + (' data-mx-t="%s"' % e(tj) if (n or heroes) else '') + '>', s, count=1)
    return s, n, heroes

# ── 실행
def main():
    data = json.load(open(os.path.join(HERE, 'media.json'), encoding='utf-8'))
    places, springs = data.get('places', {}), data.get('springs', {})
    changed = []; stats = dict(pages=0, photos=0, videos=0, heroes=0, strips=0, hs_heroes=0)
    def save(rel, new, old):
        if new != old:
            changed.append(rel)
            if not CHECK: open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(new)

    for lang, d in LANGS:
        base = os.path.join(d, 'baths') if d else 'baths'
        root_of = lambda rel: '../' * rel.count('/')
        # 1) 지점 상세
        pdir = os.path.join(ROOT, base, 'p')
        for pid in sorted(os.listdir(pdir)):
            rel = os.path.join(base, 'p', pid, 'index.html'); old = rd(os.path.join(ROOT, rel)); s = old
            m = places.get(pid, {})
            s, hero_src = patch_hero(s, pid, m, lang)
            h1 = re.search(r'<h1>(.*?)</h1>', s, re.S)
            name = html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'<span.*', '', h1.group(1), flags=re.S))).strip() if h1 else ''
            if not name: name = html.unescape((re.search(r'data-n="([^"]*)"', s) or [None, pid])[1])
            block = place_block(pid, m, name, lang, hero_src)
            s = RE_BLOCK.sub('', s)
            if block:
                anchor = '<section class="pl-rev" id="reviews">'
                if anchor not in s: print('!! 후기 영역을 못 찾음:', rel); continue
                s = s.replace(anchor, '<!--mx:b-->' + block + '<!--mx:e-->' + anchor, 1)
            s = assets(s, root_of(rel), bool(block))
            imgs = [p['src'] for p in (m.get('photos') or [])]
            s = set_ld_image(s, imgs)
            save(rel, s, old)
            if lang == 'en' and block:
                stats['pages'] += 1; stats['photos'] += block.count('class="mx-f"'); stats['videos'] += block.count('class="mx-v"')
        # 2) 목록 페이지의 카드 대표 사진
        heroes = {pid: m for pid, m in places.items() if m.get('hero')}
        for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
            if os.sep + 'p' + os.sep in dp + os.sep or dp.endswith(os.sep + 'p'): continue
            if 'index.html' not in fn: continue
            rel = os.path.relpath(os.path.join(dp, 'index.html'), ROOT); old = rd(os.path.join(ROOT, rel)); s = old
            if 'data-mx-hero' in s or any('data-hx="%s"' % pid in s for pid in heroes):
                for pid in sorted(set(re.findall(r'data-hx="([^"]+)"', s))):
                    if pid in heroes or 'data-mx-hero' in s:
                        s, _ = patch_hero(s, pid, places.get(pid, {}), lang)
                if s != old and '.pcap' not in s: print('!! 사진 출처 표시 모양(.pcap)이 없는 페이지:', rel)
            # 3) 온천 페이지
            if rel.replace(os.sep, '/').endswith('baths/hot-springs/index.html'):
                s, n, hh = patch_springs(s, springs, lang)
                s = assets(s, root_of(rel), (n + hh) > 0)
                if lang == 'en': stats['strips'] = n; stats['hs_heroes'] = hh
            save(rel, s, old)
        if lang == 'en': stats['heroes'] = len(heroes)

    # 4) sitemap 수정일
    sm = os.path.join(ROOT, 'sitemap.xml')
    if changed and os.path.exists(sm):
        x = rd(sm); today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d'); k = 0
        for rel in changed:
            url = 'https://hantang.kr/' + rel.replace(os.sep, '/')[:-len('index.html')]
            x2 = re.sub(r'(<loc>%s</loc>\s*<lastmod>)[^<]*(</lastmod>)' % re.escape(url), r'\g<1>%s\g<2>' % today, x)
            if x2 != x: k += 1; x = x2
        if not CHECK: open(sm, 'w', encoding='utf-8').write(x)
        print('sitemap 수정일 %d곳' % k)
    print('%s: 바뀐 파일 %d개 · 사진·영상 영역 %d곳(영어 기준 사진 %d장, 영상 %d편) · 지점 대표 사진 %d곳 · 온천 카드 대표 사진 %d곳, 사진 줄 %d곳'
          % ('확인만' if CHECK else '완료', len(changed), stats['pages'], stats['photos'], stats['videos'], stats['heroes'], stats['hs_heroes'], stats['strips']))

if __name__ == '__main__':
    main()
