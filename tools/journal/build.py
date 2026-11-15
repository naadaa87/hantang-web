#!/usr/bin/env python3
"""HANTANG Journal 생성기 — 매일 올리는 짧은 글(/journal/)을 만든다.

원고:  tools/journal/posts/<날짜>-<slug>/post.json + en.html, ja.html, zh-hant.html, zh-hans.html, vi.html, th.html, ru.html
결과:  /journal/<slug>/ 와 언어별 /<언어>/journal/<slug>/, 목록 페이지, 공유 그림(og/),
       sitemap.xml · feed.xml · llms.txt 의 저널 부분, 메인·가이드 목록의 '새 글' 칸, sw.js 버전

쓰는 법 (저장소 맨 위에서):
    python3 tools/journal/build.py            # 전체 다시 만들기
    python3 tools/journal/build.py --check    # 원고 검사만 (파일을 바꾸지 않음)
    python3 tools/journal/build.py --status   # 발행된 글 수와 마지막 발행일

페이지 틀(머리글·바닥글·스타일)은 그 언어의 기존 가이드 페이지에서 그대로 가져온다.
그래서 사이트 디자인이 바뀌어도 다음 빌드 때 저널 페이지가 따라간다.
이 스크립트는 여러 번 돌려도 결과가 같다(저널 부분만 지우고 다시 넣는다).
표준 라이브러리만 쓴다. Pillow 가 있으면 공유 그림도 만든다(없으면 기본 그림을 쓴다).
"""
import datetime
import html
import json
import math
import os
import re
import sys
import unicodedata
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
JDIR = os.path.join(ROOT, 'tools', 'journal')
PDIR = os.path.join(JDIR, 'posts')
BASE = 'https://hantang.kr/'
SHELL = 'first-visit'            # 틀로 쓰는 가이드 글
INDEX_CARDS = 24                 # 목록 페이지에 카드로 보여 줄 글 수 (나머지는 제목 목록)
HOME_CARDS = 4                   # 메인·가이드 목록의 '새 글' 칸에 보여 줄 글 수
FEED_ITEMS = 20
LLMS_ITEMS = 60

LANGS = [  # 코드, 주소 앞부분, hreflang
    ('en', '', 'en'), ('ja', 'ja/', 'ja'), ('zh-hant', 'zh-hant/', 'zh-Hant'), ('zh-hans', 'zh-hans/', 'zh-Hans'),
    ('vi', 'vi/', 'vi'), ('th', 'th/', 'th'), ('ru', 'ru/', 'ru'),
]
PREFIX = {c: p for c, p, _ in LANGS}
HREFLANG = {c: h for c, _, h in LANGS}

T = {
    'en': dict(name='Journal', eyebrow='JOURNAL', h1='One tang a day.',
               lede='Short reads on Korean bath culture: one question, one custom or one place at a time. A new post every night, checked against Korean sources.',
               title='HANTANG Journal: Korean bathhouse stories, tips and answers',
               desc='Daily posts on Korean bathhouses, jjimjilbang and saunas: where the customs come from, the questions travelers ask, places and seasons. New every night.',
               all='All journal posts →', home_h='New in the journal', home_sub='One short read a day on Korean bath culture.',
               latest='LATEST', older='EARLIER POSTS'),
    'ja': dict(name='ジャーナル', eyebrow='JOURNAL', h1='一日ひと風呂。',
               lede='韓国のお風呂文化を、ひとつの疑問、ひとつの習慣、ひとつの場所ずつ。毎晩1本、韓国の資料で確かめてからお届けします。',
               title='HANTANGジャーナル：韓国の銭湯・チムジルバンの話題と豆知識',
               desc='韓国の銭湯・チムジルバン・サウナの話題を毎日更新。習慣の由来、旅行者のよくある疑問、季節やエリアの情報まで。',
               all='ジャーナル一覧 →', home_h='ジャーナル新着', home_sub='韓国のお風呂文化を、毎日1本。',
               latest='新着', older='これまでの記事'),
    'zh-hant': dict(name='日誌', eyebrow='JOURNAL', h1='每天泡一湯。',
                    lede='一次一個疑問、一個習慣、一個地方，聊聊韓國的澡堂文化。每晚更新一篇，內容都對照韓國當地資料查證過。',
                    title='HANTANG 日誌：韓國澡堂、汗蒸幕的故事與小知識',
                    desc='每天更新的韓國澡堂、汗蒸幕與三溫暖專欄：習俗的由來、旅客常見的疑問、季節與地區話題。',
                    all='所有日誌文章 →', home_h='日誌新文章', home_sub='每天一篇，聊韓國的澡堂文化。',
                    latest='最新', older='更早的文章'),
    'zh-hans': dict(name='日志', eyebrow='JOURNAL', h1='每天泡个澡。',
                    lede='一次一个疑问、一个习惯、一个地方，聊聊韩国的澡堂文化。每晚更新一篇，内容都对照韩国当地资料核实过。',
                    title='HANTANG 日志：韩国澡堂、汗蒸幕的故事与小知识',
                    desc='每天更新的韩国澡堂、汗蒸幕与桑拿专栏：习俗的由来、游客常见的疑问、季节与地区话题。',
                    all='全部日志文章 →', home_h='日志新文章', home_sub='每天一篇，聊韩国的澡堂文化。',
                    latest='最新', older='更早的文章'),
    'vi': dict(name='Nhật ký', eyebrow='JOURNAL', h1='Mỗi ngày một chuyện nhà tắm.',
               lede='Mỗi bài một câu hỏi, một thói quen hay một địa điểm trong văn hóa tắm của người Hàn. Bài mới mỗi tối, đã đối chiếu với nguồn tiếng Hàn.',
               title='Nhật ký HANTANG: chuyện nhà tắm và jjimjilbang Hàn Quốc',
               desc='Bài viết mỗi ngày về nhà tắm công cộng, jjimjilbang và xông hơi Hàn Quốc: nguồn gốc các thói quen, giải đáp thắc mắc của du khách, gợi ý theo mùa và khu vực.',
               all='Tất cả bài nhật ký →', home_h='Bài mới trong nhật ký', home_sub='Mỗi ngày một bài ngắn về văn hóa tắm Hàn Quốc.',
               latest='MỚI NHẤT', older='BÀI TRƯỚC ĐÓ'),
    'th': dict(name='บันทึก', eyebrow='JOURNAL', h1='วันละเรื่อง โรงอาบน้ำเกาหลี',
               lede='เล่าวัฒนธรรมการอาบน้ำแบบเกาหลีทีละเรื่อง ทั้งคำถามที่คนสงสัย ธรรมเนียม และสถานที่ มีบทความใหม่ทุกคืน และตรวจสอบกับแหล่งข้อมูลของเกาหลีแล้ว',
               title='บันทึก HANTANG: เรื่องเล่าและเกร็ดความรู้โรงอาบน้ำเกาหลีและจิมจิลบัง',
               desc='บทความใหม่ทุกวันเกี่ยวกับโรงอาบน้ำ จิมจิลบัง และซาวน่าเกาหลี ทั้งที่มาของธรรมเนียม คำถามที่นักท่องเที่ยวถามบ่อย และเรื่องตามฤดูกาล',
               all='บทความทั้งหมดในบันทึก →', home_h='บทความใหม่ในบันทึก', home_sub='วันละเรื่องสั้น ๆ เกี่ยวกับวัฒนธรรมการอาบน้ำของเกาหลี',
               latest='ล่าสุด', older='บทความก่อนหน้า'),
    'ru': dict(name='Журнал', eyebrow='JOURNAL', h1='Одна банная история в день.',
               lede='Корейская банная культура — по одному вопросу, обычаю или месту за раз. Новая заметка каждый вечер, факты сверены с корейскими источниками.',
               title='Журнал HANTANG: истории и советы о корейских банях и чимчильбанах',
               desc='Ежедневные заметки о корейских банях, чимчильбанах и саунах: откуда взялись обычаи, ответы на вопросы путешественников, сезоны и районы.',
               all='Все заметки журнала →', home_h='Новое в журнале', home_sub='Одна короткая заметка в день о корейской банной культуре.',
               latest='НОВОЕ', older='РАНЕЕ'),
}

ICON = ('<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 13a8 8 0 0 0 16 0H4z" stroke="#1E6E9C" stroke-width="2.2" stroke-linejoin="round"/>'
        '<path d="M8.5 9.5c-1.2-1.6 1.2-2.4 0-4M12 9.5c-1.2-1.6 1.2-2.4 0-4M15.5 9.5c-1.2-1.6 1.2-2.4 0-4" stroke="#1E6E9C" stroke-width="2" stroke-linecap="round"/></svg>')

ALLOWED = {'p', 'h2', 'h3', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'em', 'strong', 'b', 'i', 'span', 'div',
           'blockquote', 'br', 'hr', 'figure', 'figcaption', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
           'polygon', 'text', 'tspan', 'title', 'defs', 'marker', 'sup', 'sub', 'small', 'code'}
VOID = {'br', 'hr', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'}
SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = read(path) if os.path.exists(path) else None
    if old != text:
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        return True
    return False


def esc(s):
    return html.escape(s, quote=True)


def rel(depth, lang):
    """사이트 맨 위를 가리키는 상대 경로 + 언어 폴더. depth: 메인 0, 목록 1, 글 2."""
    return '../' * (depth if lang == 'en' else depth + 1) + PREFIX[lang]


# ───────────────────────── 원고 읽기·검사 ─────────────────────────

class Checker(HTMLParser):
    def __init__(self, where):
        super().__init__(convert_charrefs=True)
        self.where = where
        self.stack = []
        self.h2 = 0

    def handle_starttag(self, tag, attrs):
        if tag not in ALLOWED:
            err(f'{self.where}: 쓸 수 없는 태그 <{tag}>')
        for k, v in attrs:
            if k.startswith('on'):
                err(f'{self.where}: 이벤트 속성 {k} 는 쓸 수 없음')
            if k in ('href', 'src') and v and v.strip().lower().startswith('javascript:'):
                err(f'{self.where}: javascript: 주소는 쓸 수 없음')
        if tag == 'h2':
            self.h2 += 1
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag not in ALLOWED:
            err(f'{self.where}: 쓸 수 없는 태그 <{tag}>')

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack or self.stack[-1] != tag:
            err(f'{self.where}: 태그 짝이 맞지 않음 </{tag}> (열린 태그: {self.stack[-3:]})')
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
        else:
            self.stack.pop()


def load_post(dirname):
    d = os.path.join(PDIR, dirname)
    m = re.match(r'^(\d{4}-\d{2}-\d{2})-(.+)$', dirname)
    if not m:
        err(f'{dirname}: 폴더 이름은 YYYY-MM-DD-slug 형식이어야 함')
        return None
    date, slug = m.group(1), m.group(2)
    if not SLUG_RE.match(slug) or len(slug) > 38:
        err(f'{dirname}: slug 는 영문 소문자·숫자·하이픈, 38자 이하')
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        err(f'{dirname}: 날짜가 올바르지 않음')
    try:
        meta = json.loads(read(os.path.join(d, 'post.json')))
    except Exception as e:  # noqa: BLE001
        err(f'{dirname}/post.json: 읽을 수 없음 ({e})')
        return None
    post = dict(dir=dirname, slug=slug, date=date, updated=meta.get('updated') or date, related=meta.get('related') or [],
                sources=meta.get('sources') or [], pillar=meta.get('pillar', ''), langs={})
    if len(post['sources']) < 2:
        err(f'{dirname}: 출처(sources)는 2개 이상 필요')
    for s in post['sources']:
        if not (s.get('title') and str(s.get('url', '')).startswith('https://') and s.get('note')):
            err(f'{dirname}: 출처마다 title, https 주소(url), note(매체·연도)가 필요 → {s}')
    for g in post['related']:
        if not os.path.exists(os.path.join(ROOT, 'guide', g, 'index.html')):
            err(f'{dirname}: related 의 가이드 "{g}" 가 없음')
    for lang, _, _ in LANGS:
        p = os.path.join(d, lang + '.html')
        if not os.path.exists(p):
            err(f'{dirname}: {lang}.html 이 없음 (7개 언어 모두 필요)')
            continue
        raw = read(p)
        if '\n---\n' not in raw:
            err(f'{dirname}/{lang}.html: 머리말과 본문 사이에 --- 줄이 필요')
            continue
        head, body = raw.split('\n---\n', 1)
        fm = {}
        for line in head.strip().splitlines():
            if ':' in line:
                k, v = line.split(':', 1)
                fm[k.strip()] = v.strip()
        for k in ('title', 'description', 'tag'):
            if not fm.get(k):
                err(f'{dirname}/{lang}.html: 머리말에 {k} 가 없음')
        body = body.strip()
        for inc in re.findall(r'\{\{include:([\w.-]+)\}\}', body):
            ip = os.path.join(d, inc)
            if os.path.exists(ip):
                body = body.replace('{{include:%s}}' % inc, read(ip).strip())
            else:
                err(f'{dirname}/{lang}.html: 넣을 파일 {inc} 가 없음')
        ck = Checker(f'{dirname}/{lang}.html')
        ck.feed(body)
        ck.close()
        if ck.stack:
            err(f'{dirname}/{lang}.html: 닫히지 않은 태그 {ck.stack}')
        if ck.h2 < 2:
            err(f'{dirname}/{lang}.html: 소제목(<h2>)이 2개 이상 필요')
        if len(fm.get('title', '')) > 90:
            warn(f'{dirname}/{lang}.html: 제목이 90자를 넘음')
        post['langs'][lang] = dict(title=fm.get('title', ''), desc=fm.get('description', ''), tag=fm.get('tag', ''), body=body)
    if 'en' in post['langs']:
        words = len(re.sub(r'<[^>]+>', ' ', post['langs']['en']['body']).split())
        post['minutes'] = max(2, math.ceil(words / 220))
        if words < 450:
            warn(f'{dirname}: 영어 본문이 {words} 단어로 짧음 (600 단어 이상 권장)')
    return post


def load_posts():
    if not os.path.isdir(PDIR):
        return []
    posts = [load_post(n) for n in sorted(os.listdir(PDIR)) if os.path.isdir(os.path.join(PDIR, n))]
    posts = [p for p in posts if p and len(p['langs']) == len(LANGS)]
    seen = {}
    for p in posts:
        if p['slug'] in seen:
            err(f'slug 가 겹침: {p["dir"]} 와 {seen[p["slug"]]}')
        seen[p['slug']] = p['dir']
    posts.sort(key=lambda p: (p['date'], p['dir']), reverse=True)  # 새 글이 앞
    return posts


# ───────────────────────── 틀에서 가져오는 것 ─────────────────────────

_shell = {}


def shell(lang):
    if lang not in _shell:
        s = read(os.path.join(ROOT, PREFIX[lang], 'guide', SHELL, 'index.html'))
        idx = read(os.path.join(ROOT, PREFIX[lang], 'guide', 'index.html'))
        info = {}
        m = re.search(r'<div class="g-meta"><span>(.*?)</span> · <span>(.*?) <b>', s)
        info['min'] = m.group(1)                       # "9 MIN READ"
        info['upd'] = m.group(2)                       # "Updated"
        info['toc_h'] = re.search(r'<aside class="toc"[^>]*>\s*<h5>(.*?)</h5>', s, re.S).group(1)
        info['toc_aria'] = re.search(r'<aside class="toc" aria-label="([^"]*)"', s).group(1)
        info['crumb_aria'] = re.search(r'<nav class="crumbs" aria-label="([^"]*)"', s).group(1)
        info['src_h'] = re.search(r'<section class="src"><h2>(.*?)</h2>', s).group(1)
        info['play'] = re.search(r'href="([^"]*play/[^"]*)" class="nav-play"', s).group(1)
        cards = {}
        for m in re.finditer(r'<a class="art rv" href="[^"]*?guide/([a-z0-9-]+)/">.*?</a>', idx, re.S):
            cards[m.group(1)] = m.group(0)
        info['cards'] = cards
        _shell[lang] = (s, idx, info)
    return _shell[lang]


def minlabel(lang, n):
    return re.sub(r'\d+', str(n), shell(lang)[2]['min'], count=1)


def og_url(lang, slug):
    name = (PREFIX[lang].replace('/', '-')) + ('journal-' + slug if slug else 'journal') + '.jpg'
    if os.path.exists(os.path.join(ROOT, 'og', name)):
        return BASE + 'og/' + name
    fb = (PREFIX[lang].replace('/', '-')) + 'guide.jpg'      # 그림을 못 만들었을 때: 가이드 목록 그림
    return BASE + 'og/' + fb


def resolve_links(body, lang, where):
    """본문의 href="@guide/…/" 같은 표기를 그 언어의 실제 상대 주소로 바꾼다."""
    r = rel(2, lang)

    def sub(m):
        t = m.group(1)
        if t == 'home':
            return f'href="{r}"'
        if t == 'play':
            return f'href="{shell(lang)[2]["play"]}"'
        path = t if t.endswith('/') else t + '/'
        if path.split('/')[0] not in ('guide', 'baths', 'board', 'journal'):
            err(f'{where}: 알 수 없는 내부 링크 @{t}')
            return m.group(0)
        if path.startswith('journal/'):
            ok = any(n.endswith('-' + path.split('/')[1]) for n in os.listdir(PDIR))
        else:
            ok = os.path.exists(os.path.join(ROOT, PREFIX[lang], path, 'index.html'))
        if not ok:
            err(f'{where}: 내부 링크 대상이 없음 @{t}')
        return f'href="{r}{path}"'

    body = re.sub(r'href="@([^"]+)"', sub, body)
    for m in re.finditer(r'href="([^"]+)"', body):
        u = m.group(1)
        if not (u.startswith('https://') or u.startswith('../') or u.startswith('#')):
            err(f'{where}: 링크는 https:// 또는 @내부표기 만 가능 → {u}')
    return body


def card(post, lang, depth):
    L = post['langs'][lang]
    href = rel(depth, lang) + 'journal/' + post['slug'] + '/'
    return (f'<a class="art rv" href="{href}"><div class="art-thumb">{ICON}</div><div class="art-body">'
            f'<div class="art-tag">{esc(L["tag"])}</div><h4>{esc(L["title"])}</h4><p>{esc(L["desc"])}</p>'
            f'<div class="rt">{post["date"]} · {minlabel(lang, post["minutes"])}</div></div></a>')


def set_meta(s, attr, name, value):
    pat = re.compile(r'(<meta %s="%s" content=")[^"]*(">)' % (attr, re.escape(name)))
    if not pat.search(s):
        err(f'틀에서 <meta {attr}="{name}"> 를 찾지 못함')
    return pat.sub(lambda m: m.group(1) + esc(value) + m.group(2), s, count=1)


def strip_ld(s):
    return re.sub(r'<script type="application/ld\+json">.*?</script>\n?', '', s, flags=re.S)


def ld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, indent=1) + '</script>\n'


def must_sub(pat, repl, s, what, flags=re.S):
    new, n = re.subn(pat, lambda m: repl, s, count=1, flags=flags)
    if n != 1:
        err(f'틀에서 {what} 자리를 찾지 못함')
    return new


# ───────────────────────── 글 페이지 ─────────────────────────

def build_post(post, lang):
    s, _, info = shell(lang)
    L = post['langs'][lang]
    t = T[lang]
    slug = post['slug']
    url = BASE + PREFIX[lang] + 'journal/' + slug + '/'
    where = f'{post["dir"]}/{lang}.html'
    s = s.replace('guide/%s/' % SHELL, 'journal/%s/' % slug)
    full = L['title'] + ' — HANTANG'
    s = must_sub(r'<title>.*?</title>', '<title>' + esc(full) + '</title>', s, '<title>')
    s = set_meta(s, 'name', 'description', L['desc'])
    s = set_meta(s, 'property', 'og:title', full)
    s = set_meta(s, 'property', 'og:description', L['desc'])
    s = set_meta(s, 'property', 'og:image', og_url(lang, slug))
    s = set_meta(s, 'property', 'og:image:alt', L['title'])
    s = set_meta(s, 'name', 'twitter:title', full)
    s = set_meta(s, 'name', 'twitter:description', L['desc'])
    s = set_meta(s, 'name', 'twitter:image', og_url(lang, slug))
    s = strip_ld(s)
    jl = ld({'@context': 'https://schema.org', '@type': 'Article', 'image': og_url(lang, slug), 'headline': L['title'],
             'description': L['desc'], 'inLanguage': HREFLANG[lang], 'datePublished': post['date'], 'dateModified': post['updated'],
             'author': {'@type': 'Organization', 'name': 'HANTANG'}, 'publisher': {'@type': 'Organization', 'name': 'HANTANG'},
             'mainEntityOfPage': url})
    jl += ld({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'HANTANG', 'item': BASE + PREFIX[lang]},
        {'@type': 'ListItem', 'position': 2, 'name': t['name'], 'item': BASE + PREFIX[lang] + 'journal/'},
        {'@type': 'ListItem', 'position': 3, 'name': L['title'], 'item': url}]})
    s = s.replace('<style>', jl + '<style>', 1)

    r = rel(2, lang)
    head = (f'<header class="g-head">\n  <div class="wrap">\n    <nav class="crumbs" aria-label="{info["crumb_aria"]}">'
            f'<a href="{r}">HANTANG</a><span>›</span><a href="{r}journal/">{esc(t["name"])}</a><span>›</span><span>{esc(L["tag"])}</span></nav>\n'
            f'    <div class="eyebrow">{esc(L["tag"])}</div>\n    <h1>{esc(L["title"])}</h1>\n    <p class="lede">{esc(L["desc"])}</p>\n'
            f'    <div class="g-meta"><span>{minlabel(lang, post["minutes"])}</span> · <span>{info["upd"]} <b>{post["updated"]}</b></span></div>\n'
            f'  </div>\n</header>')
    s = must_sub(r'<header class="g-head">.*?</header>', head, s, '글 머리(g-head)')

    body = resolve_links(L['body'], lang, where)
    toc = []
    n = 0

    def h2(m):
        nonlocal n
        n += 1
        toc.append((n, re.sub(r'<[^>]+>', '', m.group(1))))
        return f'<h2 id="s{n}">{m.group(1)}</h2>'

    body = re.sub(r'<h2>(.*?)</h2>', h2, body, flags=re.S)
    toc_html = ''.join(f'    <a href="#s{i}">{txt}</a>\n' for i, txt in toc)
    src = ''.join(f'<li><a href="{esc(x["url"])}">{esc(x["title"])}</a> — {esc(x["note"])}</li>\n' for x in post['sources'])
    block = (f'<div class="g-body">\n  <aside class="toc" aria-label="{info["toc_aria"]}">\n    <h5>{info["toc_h"]}</h5>\n{toc_html}'
             f'    <a class="toc-all" href="{r}journal/">{esc(t["all"])}</a>\n  </aside>\n  <main>\n    <article class="prose">\n{body}\n\n    </article>\n'
             f'    <section class="src"><h2>{info["src_h"]}</h2><ol>\n{src}</ol></section>\n  </main>\n</div>')
    s = must_sub(r'<div class="g-body">.*?</main>\s*</div>', block, s, '본문(g-body)')
    s = must_sub(r'data-target="guide:[a-z0-9-]+"', f'data-target="guide:j-{slug}"', s, '댓글 칸')

    # 아래쪽 '관련 가이드' 카드
    a = s.find('<div class="art-grid">', s.find('class="g-next"'))
    b = s.find('<a class="all"', a)
    if a < 0 or b < 0:
        err('틀에서 관련 가이드 자리를 찾지 못함')
    else:
        rel_cards = ''
        for g in post['related'][:4]:
            c = info['cards'].get(g)
            if c:
                rel_cards += re.sub(r'href="[^"]*?guide/', f'href="{r}guide/', c, count=1)
        if rel_cards:
            s = s[:a] + '<div class="art-grid">' + rel_cards + '</div>' + s[b:]
    return s


# ───────────────────────── 목록 페이지 ─────────────────────────

def journal_ld(posts, lang):
    t = T[lang]
    url = BASE + PREFIX[lang] + 'journal/'
    out = ld({'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': t['h1'], 'description': t['lede'],
              'inLanguage': HREFLANG[lang], 'url': url,
              'hasPart': [{'@type': 'Article', 'headline': p['langs'][lang]['title'], 'datePublished': p['date'],
                           'url': url + p['slug'] + '/'} for p in posts[:INDEX_CARDS]]})
    out += ld({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'HANTANG', 'item': BASE + PREFIX[lang]},
        {'@type': 'ListItem', 'position': 2, 'name': t['name'], 'item': url}]})
    return out


def build_index(posts, lang):
    _, s, info = shell(lang)
    s = re.sub(r'<!-- journal:start -->.*?<!-- journal:end -->', '', s, flags=re.S)
    t = T[lang]
    full = t['title'] + ' — HANTANG' if 'HANTANG' not in t['title'] else t['title']
    s = re.sub(r'((?:href|content)="https://hantang\.kr/(?:[a-z-]+/)?)guide/"', r'\1journal/"', s)
    s = re.sub(r'(href="(?:\.\./)+(?:[a-z-]+/)?)guide/"( hreflang=)', r'\1journal/"\2', s)
    s = must_sub(r'<title>.*?</title>', '<title>' + esc(full) + '</title>', s, '<title>')
    s = set_meta(s, 'name', 'description', t['desc'])
    s = set_meta(s, 'property', 'og:title', full)
    s = set_meta(s, 'property', 'og:description', t['desc'])
    s = set_meta(s, 'property', 'og:image', og_url(lang, ''))
    s = set_meta(s, 'property', 'og:image:alt', t['title'])
    s = set_meta(s, 'name', 'twitter:title', full)
    s = set_meta(s, 'name', 'twitter:description', t['desc'])
    s = set_meta(s, 'name', 'twitter:image', og_url(lang, ''))
    s = strip_ld(s)
    s = s.replace('<style>', journal_ld(posts, lang) + '<style>', 1)
    r = rel(1, lang)
    cards = ''.join(card(p, lang, 1) for p in posts[:INDEX_CARDS])
    older = ''
    if len(posts) > INDEX_CARDS:
        items = ''.join(f'<li><a href="{r}journal/{p["slug"]}/">{esc(p["langs"][lang]["title"])}</a> <span style="color:var(--mute);font-size:12.5px">· {p["date"]}</span></li>'
                        for p in posts[INDEX_CARDS:])
        older = (f'<div class="rv" style="margin-top:56px"><div class="sec-eyebrow">{esc(t["older"])}</div></div>'
                 f'<ul style="margin-top:16px;padding-left:1.2em;line-height:1.9;font-size:15px">{items}</ul>')
    block = (f'<header class="g-head"><div class="wrap"><nav class="crumbs" aria-label="{info["crumb_aria"]}"><a href="{r}">HANTANG</a><span>›</span>'
             f'<span>{esc(t["name"])}</span></nav><div class="eyebrow">{esc(t["eyebrow"])}</div><h1>{esc(t["h1"])}</h1><p class="lede">{esc(t["lede"])}</p></div></header>'
             f'<section style="padding-top:20px"><div class="wrap" style="padding-bottom:70px"><div class="rv" style="margin-top:46px">'
             f'<div class="sec-eyebrow">{esc(t["latest"])}</div></div><div class="art-grid" style="margin-top:18px">{cards}</div>{older}</div></section>\n\n')
    a = s.find('<header class="g-head">')
    b = s.find('<footer')
    if a < 0 or b < 0:
        err('목록 틀에서 머리·바닥글 자리를 찾지 못함')
        return s
    return s[:a] + block + s[b:]


# ───────────────────────── 다른 파일에 저널 끼워 넣기 ─────────────────────────

def strip_block(s):
    return re.sub(r'\s*<!-- journal:start -->.*?<!-- journal:end -->', '', s, flags=re.S)


def inject_home(posts, lang):
    p = os.path.join(ROOT, PREFIX[lang], 'index.html')
    s = strip_block(read(p))
    t = T[lang]
    r = rel(0, lang)
    cards = ''.join(card(x, lang, 0) for x in posts[:HOME_CARDS])
    block = (f'\n    <!-- journal:start --><div class="rv" style="margin-top:54px"><div class="sec-eyebrow">{esc(t["eyebrow"])}</div>'
             f'<h2>{esc(t["home_h"])}</h2><p class="sec-sub">{esc(t["home_sub"])}</p></div><div class="art-grid">{cards}</div>'
             f'<div class="rv" style="margin-top:26px"><a class="all-guides" href="{r}journal/">{esc(t["all"])}</a></div><!-- journal:end -->')
    m = re.search(r'<a class="all-guides" href="[^"]*guide/">[^<]*</a></div>', s)
    if not m:
        warn(f'{PREFIX[lang]}index.html: 가이드 섹션을 찾지 못해 메인 화면에는 새 글 칸을 넣지 못함')
        return False
    return write(p, s[:m.end()] + block + s[m.end():])


def inject_guide_index(posts, lang):
    p = os.path.join(ROOT, PREFIX[lang], 'guide', 'index.html')
    s = strip_block(read(p))
    t = T[lang]
    r = rel(1, lang)
    cards = ''.join(card(x, lang, 1) for x in posts[:HOME_CARDS])
    block = (f'<!-- journal:start --><div class="rv" style="margin-top:60px"><div class="sec-eyebrow">{esc(t["eyebrow"])} · {esc(t["home_h"])}</div></div>'
             f'<div class="art-grid" style="margin-top:18px">{cards}</div><div class="rv" style="margin-top:22px">'
             f'<a href="{r}journal/" style="color:var(--blue);font-weight:700">{esc(t["all"])}</a></div><!-- journal:end -->')
    b = s.find('<footer')
    a = s.rfind('</div></section>', 0, b)
    if a < 0:
        warn(f'{PREFIX[lang]}guide/index.html: 넣을 자리를 찾지 못함')
        return False
    return write(p, s[:a] + block + s[a:])


def url_block(loc, lastmod, alts):
    x = f'  <url>\n    <loc>{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n'
    for h, u in alts:
        x += f'    <xhtml:link rel="alternate" hreflang="{h}" href="{u}"/>\n'
    return x + '  </url>\n'


def update_sitemap(posts):
    p = os.path.join(ROOT, 'sitemap.xml')
    s = read(p)
    s = re.sub(r'  <url>\n    <loc>https://hantang\.kr/(?:[a-z-]+/)?journal/[^<]*</loc>.*?</url>\n', '', s, flags=re.S)
    add = ''
    if posts:
        def alts(path):
            a = [(HREFLANG[c], BASE + PREFIX[c] + path) for c, _, _ in LANGS]
            return a + [('x-default', BASE + path)]
        latest = max(x['updated'] for x in posts)
        for c, _, _ in LANGS:
            add += url_block(BASE + PREFIX[c] + 'journal/', latest, alts('journal/'))
        for x in posts:
            for c, _, _ in LANGS:
                add += url_block(BASE + PREFIX[c] + 'journal/' + x['slug'] + '/', x['updated'], alts('journal/' + x['slug'] + '/'))
    if '</urlset>' not in s:
        err('sitemap.xml 형식이 예상과 다름')
        return False
    s = s.replace('</urlset>', add + '</urlset>')
    return write(p, s)


def update_feed(posts, lang):
    p = os.path.join(ROOT, PREFIX[lang], 'feed.xml')
    if not os.path.exists(p):
        warn(f'{PREFIX[lang]}feed.xml 이 없음')
        return False
    s = read(p)
    s = re.sub(r'  <item>(?:(?!</item>).)*?<link>https://hantang\.kr/(?:[a-z-]+/)?journal/.*?</item>\n', '', s, flags=re.S)
    items = ''
    for x in posts[:FEED_ITEMS]:
        L = x['langs'][lang]
        u = BASE + PREFIX[lang] + 'journal/' + x['slug'] + '/'
        d = datetime.date.fromisoformat(x['date'])
        pub = d.strftime('%a, %d %b %Y') + ' 23:00:00 +0900'
        items += (f'  <item>\n    <title>{esc(L["title"])} — HANTANG</title>\n    <link>{u}</link>\n    <guid isPermaLink="true">{u}</guid>\n'
                  f'    <description>{esc(L["desc"])}</description>\n    <pubDate>{pub}</pubDate>\n  </item>\n')
    m = re.search(r'<atom:link [^>]*/>\n', s)
    if not m:
        warn(f'{PREFIX[lang]}feed.xml: 넣을 자리를 찾지 못함')
        return False
    return write(p, s[:m.end()] + items + s[m.end():])


def update_llms(posts):
    p = os.path.join(ROOT, 'llms.txt')
    s = read(p)
    s = re.sub(r'## Journal \(English\)\n.*?(?=\n## )', '', s, flags=re.S).replace('\n\n\n', '\n\n')
    if posts:
        sec = '## Journal (English)\nShort daily posts; each answers one question or explains one custom, with sources.\n'
        for x in posts[:LLMS_ITEMS]:
            L = x['langs']['en']
            sec += f'- [{L["title"]}]({BASE}journal/{x["slug"]}/) ({x["date"]}): {L["desc"]}\n'
        if '## Directory' in s:
            s = s.replace('## Directory', sec + '\n## Directory', 1)
        else:
            s = s.rstrip('\n') + '\n\n' + sec
    return write(p, s)


def update_headers():
    p = os.path.join(ROOT, '_headers')
    s = read(p)
    if '/journal/*' in s:
        return False
    s = s.replace('/guide/*\n  Content-Language: en\n', '/guide/*\n  Content-Language: en\n/journal/*\n  Content-Language: en\n', 1)
    return write(p, s)


def bump_sw():
    p = os.path.join(ROOT, 'sw.js')
    s = read(p)
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y%m%d%H%M')
    s2 = re.sub(r"(// HANTANG service worker — )\d+", r'\g<1>' + now, s, count=1)
    s2 = re.sub(r"(const V = 'hantang-)\d+(')", r'\g<1>' + now + r'\2', s2, count=1)
    return write(p, s2)


# ───────────────────────── 공유 그림 (1200×630) ─────────────────────────

FONT_DIRS = ['/usr/share/fonts', '/usr/local/share/fonts', os.path.expanduser('~/.fonts')]


def find_font(names):
    for base in FONT_DIRS:
        for dp, _, fs in os.walk(base):
            for n in names:
                if n in fs:
                    return os.path.join(dp, n)
    return None


def clusters(text):
    """결합 문자(태국어 모음·성조 등)를 앞 글자에 붙여서 나눈다."""
    out = []
    for ch in text:
        if out and unicodedata.category(ch) in ('Mn', 'Mc', 'Me'):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def wrap_text(draw, text, font, maxw, mode):
    """mode: 'word' 띄어쓰기 단위, 'char' 글자 단위(한자·가나), 'thai' 띄어쓰기 우선 + 넘치면 글자 단위."""
    lines, cur = [], ''
    if mode == 'char':
        for ch in clusters(text):
            if cur and draw.textlength(cur + ch, font=font) > maxw and ch not in '、。，．！？：；）」』”’…':
                lines.append(cur)
                cur = ch.lstrip()
            else:
                cur += ch
    else:
        for w in text.split():
            if cur and draw.textlength(cur + ' ' + w, font=font) > maxw:
                lines.append(cur)
                cur = ''
            cur = (cur + ' ' + w).strip()
            while mode == 'thai' and draw.textlength(cur, font=font) > maxw:   # 한 덩어리가 너무 길면 글자 단위로
                cl, part = clusters(cur), ''
                while cl and draw.textlength(part + cl[0], font=font) <= maxw:
                    part += cl.pop(0)
                lines.append(part)
                cur = ''.join(cl)
    if cur:
        lines.append(cur)
    return lines


def make_og(lang, tag, title, desc, out):
    from PIL import Image, ImageDraw, ImageFont
    base = Image.open(os.path.join(ROOT, 'og', 'guide.jpg')).convert('RGB')   # 심볼과 아래 띠를 여기서 가져온다
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), '#FFFFFF')
    d = ImageDraw.Draw(img)
    for y in range(0, 221):                       # 위쪽에서 옅어지는 타일 격자
        g = int(240 + 15 * y / 220)
        for x in range(46, W, 46):
            img.putpixel((x, y), (g, g, g))
    for y in (46, 92, 138, 184):
        g = int(240 + 15 * y / 220)
        d.line([(0, y), (W, y)], fill=(g, g, g))
    box = (86, 143, 192, 254)
    sym = base.crop(box)
    mask = sym.convert('L').point(lambda v: 0 if v > 215 else min(255, int((215 - v) * 2.2)))
    img.paste(sym, box[:2], mask)
    img.paste(base.crop((0, 540, W, H)), (0, 540))
    serif = {'ja': ('NotoSerifCJK-Bold.ttc', 0), 'zh-hans': ('NotoSerifCJK-Bold.ttc', 2), 'zh-hant': ('NotoSerifCJK-Bold.ttc', 3),
             'en': ('NotoSerifCJK-Bold.ttc', 0), 'vi': ('DejaVuSerif-Bold.ttf', 0), 'ru': ('DejaVuSerif-Bold.ttf', 0), 'th': ('Loma-Bold.otf', 0)}[lang]
    sans = {'ja': ('NotoSansCJK-Regular.ttc', 0), 'zh-hans': ('NotoSansCJK-Regular.ttc', 2), 'zh-hant': ('NotoSansCJK-Regular.ttc', 3),
            'en': ('NotoSansCJK-Regular.ttc', 0), 'vi': ('DejaVuSans.ttf', 0), 'ru': ('DejaVuSans.ttf', 0), 'th': ('Loma.otf', 0)}[lang]
    sp, tp = find_font([serif[0]]), find_font([sans[0]])
    bp = find_font(['NotoSansCJK-Bold.ttc', 'DejaVuSans-Bold.ttf']) if lang not in ('th',) else find_font(['Loma-Bold.otf'])
    if lang in ('vi', 'ru'):
        bp = find_font(['DejaVuSans-Bold.ttf'])
    if not (sp and tp and bp):
        raise RuntimeError('글꼴 없음')
    mode = 'char' if lang in ('ja', 'zh-hans', 'zh-hant') else 'thai' if lang == 'th' else 'word'
    x0, maxw = 281, 840
    size = 58
    while True:
        ft = ImageFont.truetype(sp, size, index=serif[1])
        lines = wrap_text(d, title, ft, maxw, mode)
        if len(lines) <= 3 or size <= 38:
            break
        size -= 4
    lines = lines[:3]
    lh = int(size * 1.32)
    fd = ImageFont.truetype(tp, 27, index=sans[1])
    dl = wrap_text(d, desc, fd, maxw, mode)
    if len(dl) > 2:
        dl = dl[:2]
        dl[1] = dl[1].rstrip(' ,.、。，') + '…'
    total = 44 + len(lines) * lh + 26 + len(dl) * 42
    y = max(120, 318 - total // 2)
    fe = ImageFont.truetype(bp, 22, index=serif[1] if bp.endswith('.ttc') else 0)
    xx = x0
    for ch in clusters(tag):                       # 자간을 넓힌 작은 머리글
        d.text((xx, y), ch, font=fe, fill='#1E6E9C')
        xx += d.textlength(ch, font=fe) + (2 if lang == 'th' else 5)
    y += 44
    for ln in lines:
        d.text((x0, y), ln, font=ft, fill='#1B1A18')
        y += lh
    y += 26
    for ln in dl:
        d.text((x0, y), ln, font=fd, fill='#7A756D')
        y += 42
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, 'JPEG', quality=88, optimize=True)


def build_og(posts):
    made = 0
    try:
        import PIL  # noqa: F401
    except ImportError:
        warn('Pillow 가 없어 공유 그림을 만들지 못함 (pip install pillow --break-system-packages). 기본 그림을 씀')
        return 0
    jobs = []
    for lang, _, _ in LANGS:
        pre = PREFIX[lang].replace('/', '-')
        t = T[lang]
        jobs.append((lang, t['eyebrow'], t['h1'], t['lede'], os.path.join(ROOT, 'og', pre + 'journal.jpg')))
        for x in posts:
            L = x['langs'][lang]
            jobs.append((lang, L['tag'], L['title'], L['desc'], os.path.join(ROOT, 'og', f'{pre}journal-{x["slug"]}.jpg')))
    for lang, tag, title, desc, out in jobs:
        if os.path.exists(out) and '--og-all' not in sys.argv:
            continue
        try:
            make_og(lang, tag, title, desc, out)
            made += 1
        except Exception as e:  # noqa: BLE001
            warn(f'공유 그림 실패 {os.path.basename(out)}: {e}')
    return made


# ───────────────────────── 실행 ─────────────────────────

def main():
    posts = load_posts()
    if '--status' in sys.argv:
        print(json.dumps({'posts': len(posts), 'latest': posts[0]['date'] if posts else None,
                          'slugs': [p['dir'] for p in posts[:10]]}, ensure_ascii=False, indent=1))
        return 0
    for p in posts:                                  # 링크 검사 (언어별)
        for lang, _, _ in LANGS:
            resolve_links(p['langs'][lang]['body'], lang, f'{p["dir"]}/{lang}.html')
    if errors or '--check' in sys.argv:
        for w in warnings:
            print('주의:', w)
        for e in errors:
            print('오류:', e)
        print(f'검사 끝: 글 {len(posts)}편, 오류 {len(errors)}건, 주의 {len(warnings)}건')
        return 1 if errors else 0

    changed = 0
    og_made = build_og(posts)
    outputs = {}
    for lang, _, _ in LANGS:
        outputs[os.path.join(ROOT, PREFIX[lang], 'journal', 'index.html')] = build_index(posts, lang)
        for p in posts:
            outputs[os.path.join(ROOT, PREFIX[lang], 'journal', p['slug'], 'index.html')] = build_post(p, lang)
    if errors:
        for e in errors:
            print('오류:', e)
        print('오류가 있어 아무 파일도 바꾸지 않았습니다.')
        return 1
    for path, text in outputs.items():
        changed += write(path, text)
    for lang, _, _ in LANGS:
        changed += inject_home(posts, lang)
        changed += inject_guide_index(posts, lang)
        changed += update_feed(posts, lang)
    changed += update_sitemap(posts)
    changed += update_llms(posts)
    changed += update_headers()
    if changed or og_made:
        bump_sw()
    for w in warnings:
        print('주의:', w)
    for e in errors:
        print('오류:', e)
    print(f'완료: 글 {len(posts)}편 × {len(LANGS)}개 언어, 바뀐 파일 {changed}개, 새 공유 그림 {og_made}장')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
