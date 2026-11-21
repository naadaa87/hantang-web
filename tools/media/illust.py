#!/usr/bin/env python3
"""지점 일러스트 넣기 준비 — ChatGPT 로 만든 PNG(지점 ID.png)를 사이트용 그림으로 바꾼다.

하는 일
  1) assets/illust/<ID>-960.webp, -640.webp, -400.webp 를 만든다 (16:9, 화면 크기에 맞춰 골라 쓰임).
  2) 지점 상세 페이지가 있는 ID 는 공유 미리보기 그림 og/p-<ID>.jpg(1200×630)도 만든다.
  3) tools/media/illust.json 에 ID 와 판(v, 원본 PNG 지문)을 적는다. 그림을 바꿔 다시 넣으면 판이 바뀌어
     방문자 브라우저에 남은 옛 그림 대신 새 그림이 뜬다.

그다음 python3 tools/media/build.py → python3 tools/cat/build.py 순서로 돌리면 페이지에 반영된다.

원칙: 일러스트는 실제 사진이 없는 지점에만 쓴다. 사진(media.json 의 hero, 또는 다른 도구가 넣은 대표 사진)이
있으면 사진이 먼저다. 그림 왼쪽 아래에는 사이트가 'Illustration' 표시를 붙인다(PNG 에는 글자를 넣지 않는다).

사용법: python3 tools/media/illust.py <PNG 폴더>            (저장소 맨 위에서)
        python3 tools/media/illust.py <PNG 폴더> --og-all   (이미 있는 공유 그림도 다시 만든다)
        python3 tools/media/illust.py --remove <ID>          (그 지점 일러스트를 뺀다)
"""
import hashlib, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'assets', 'illust')
LIST = os.path.join(HERE, 'illust.json')
SIZES = ((960, 78), (640, 75), (400, 72))   # (가로, WebP 품질)

def load():
    return json.load(open(LIST, encoding='utf-8')) if os.path.exists(LIST) else {}

def save(d):
    json.dump(dict(sorted(d.items())), open(LIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(LIST, 'a', encoding='utf-8').write('\n')

def kto_ids():
    p = os.path.join(ROOT, 'tools', 'cat', 'entries.json')
    return {'kto-' + k for k in json.load(open(p, encoding='utf-8'))} if os.path.exists(p) else set()

def place_meta(pid):
    """영어 지점 페이지에서 이름·한글 이름·위치 줄을 읽는다."""
    s = open(os.path.join(ROOT, 'baths', 'p', pid, 'index.html'), encoding='utf-8').read()
    a = re.search(r'<article\b[^>]*\bdata-hx="%s"[^>]*>' % re.escape(pid), s).group(0)
    attr = lambda n: html.unescape((re.search(r'\b%s="([^"]*)"' % n, a) or [None, ''])[1])
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S).group(1)
    en = html.unescape(re.sub(r'<[^>]+>', '', re.split(r'<span', h1, maxsplit=1)[0])).strip()
    return en, attr('data-n'), attr('data-sub')

# ── 공유 미리보기 그림 (1200×630): 위는 일러스트, 왼쪽 아래 이름표, 맨 아래는 한탕 띠
def font(names, size, index=0):
    from PIL import ImageFont
    for base in ('/usr/share/fonts', '/usr/local/share/fonts', os.path.expanduser('~/.fonts')):
        for dp, _, fs in os.walk(base):
            for n in names:
                if n in fs: return ImageFont.truetype(os.path.join(dp, n), size, index=index)
    raise RuntimeError('글꼴 없음: %s' % names)

def wrap(d, text, f, maxw):
    """한 줄에 들어가면 한 줄, 아니면 두 줄 길이가 비슷해지도록 나눈다."""
    ws = text.split()
    if d.textlength(text, font=f) <= maxw or len(ws) < 2: return [text]
    best = None
    for i in range(1, len(ws)):
        a, b = ' '.join(ws[:i]), ' '.join(ws[i:])
        m = max(d.textlength(a, font=f), d.textlength(b, font=f))
        if best is None or m < best[0]: best = (m, [a, b])
    return best[1] if best[0] <= maxw else best[1] + ['…']

def make_og(im, pid, out):
    from PIL import Image, ImageDraw
    W, H, BAND = 1200, 630, 540
    en, ko, sub = place_meta(pid)
    canvas = Image.new('RGB', (W, H), '#FFFFFF')
    art = im.resize((W, round(W * im.height / im.width)), Image.LANCZOS)
    top = max(0, (art.height - BAND) // 2)
    canvas.paste(art.crop((0, top, W, top + BAND)), (0, 0))
    canvas.paste(Image.open(os.path.join(ROOT, 'og', 'guide.jpg')).convert('RGB').crop((0, BAND, W, H)), (0, BAND))

    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    fe = font(['NotoSansCJK-Bold.ttc'], 17, 1)
    fs = 42
    while True:
        fn = font(['NotoSerifCJK-Bold.ttc'], fs, 1)
        lines = wrap(d, en or ko, fn, 560)
        if len(lines) <= 2 or fs <= 32: break
        fs -= 4
    lines = lines[:2]
    fk = font(['NotoSerifCJK-SemiBold.ttc', 'NotoSerifCJK-Bold.ttc'], 25, 1)
    parts = [p for p in sub.split(' · ') if p]
    eb = (' · '.join([parts[0], parts[-1]]) if len(parts) > 2 else sub).upper()
    ebw = sum(d.textlength(c, font=fe) + 3 for c in eb)
    lh = round(fs * 1.22)
    show_ko = bool(en) and ko and ko != en
    bw = max([ebw] + [d.textlength(l, font=fn) for l in lines] + ([d.textlength(ko, font=fk)] if show_ko else [])) + 56
    bh = 24 + 28 + len(lines) * lh + (38 if show_ko else 0) + 16
    x0, y0 = 40, BAND - 32 - bh
    d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), 16, fill=(255, 255, 255, 238))
    x, y = x0 + 28, y0 + 22
    for c in eb:
        d.text((x, y), c, font=fe, fill='#1E6E9C'); x += d.textlength(c, font=fe) + 3
    y += 30
    for l in lines:
        d.text((x0 + 28, y), l, font=fn, fill='#1B1A18'); y += lh
    if show_ko: d.text((x0 + 28, y + 2), ko, font=fk, fill='#1E6E9C')
    fc = font(['NotoSansCJK-Medium.ttc', 'NotoSansCJK-Regular.ttc'], 17, 1)
    t = 'ILLUSTRATION'; tw = sum(d.textlength(c, font=fc) + 2 for c in t)
    d.rounded_rectangle((W - 44 - tw - 28, 30, W - 44, 64), 8, fill=(27, 26, 24, 150))
    x = W - 44 - tw - 14
    for c in t:
        d.text((x, 36), c, font=fc, fill='#FFFFFF'); x += d.textlength(c, font=fc) + 2
    canvas = Image.alpha_composite(canvas.convert('RGBA'), ov).convert('RGB')
    canvas.save(out, 'JPEG', quality=84, optimize=True, progressive=True)

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    data = load()
    if '--remove' in sys.argv:
        for pid in args:
            data.pop(pid, None)
            for w, _ in SIZES:
                p = os.path.join(OUT, '%s-%d.webp' % (pid, w))
                if os.path.exists(p): os.remove(p)
            og = os.path.join(ROOT, 'og', 'p-%s.jpg' % pid)
            if os.path.exists(og): os.remove(og)
            print('뺌:', pid)
        save(data); return
    if not args: print(__doc__); sys.exit(1)
    from PIL import Image
    src = args[0]; os.makedirs(OUT, exist_ok=True)
    places = set(os.listdir(os.path.join(ROOT, 'baths', 'p'))); ktos = kto_ids()
    made = og_made = 0; skipped = []
    for fn in sorted(os.listdir(src)):
        if not fn.lower().endswith('.png'): continue
        pid = fn[:-4]
        if pid not in places and pid not in ktos: skipped.append(fn); continue
        raw = open(os.path.join(src, fn), 'rb').read()
        v = hashlib.sha1(raw).hexdigest()[:8]
        im = Image.open(os.path.join(src, fn)).convert('RGB')
        if abs(im.width / im.height - 16 / 9) > 0.02:          # 16:9 가 아니면 가운데를 16:9 로 자른다
            h = round(im.width * 9 / 16)
            if h <= im.height: im = im.crop((0, (im.height - h) // 2, im.width, (im.height - h) // 2 + h))
            else:
                w = round(im.height * 16 / 9); im = im.crop(((im.width - w) // 2, 0, (im.width - w) // 2 + w, im.height))
        same = data.get(pid, {}).get('v') == v and all(os.path.exists(os.path.join(OUT, '%s-%d.webp' % (pid, w))) for w, _ in SIZES)
        if not same:
            for w, q in SIZES:
                im.resize((w, round(w * 9 / 16)), Image.LANCZOS).save(os.path.join(OUT, '%s-%d.webp' % (pid, w)), 'WEBP', quality=q, method=6)
            made += 1
        if pid in places:
            og = os.path.join(ROOT, 'og', 'p-%s.jpg' % pid)
            if not same or not os.path.exists(og) or '--og-all' in sys.argv:
                make_og(im, pid, og); og_made += 1
        data[pid] = {'v': v}
    save(data)
    print('완료: 새로 만든 그림 %d곳 · 공유 그림 %d장 · 전체 %d곳' % (made, og_made, len(data)))
    if skipped: print('!! 지점 ID 와 맞지 않아 건너뜀:', ', '.join(skipped))

if __name__ == '__main__':
    main()
