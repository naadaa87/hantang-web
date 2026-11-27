#!/usr/bin/env python3
"""검색·AI 답변 노출 보강 (tools/seo/)

하는 일 (여러 번 돌려도 결과는 같다)
  1) 가이드 15편의 검색용 제목(<title>, og:title, twitter:title)을 titles.json 대로 맞춘다. 본문 제목(h1)은 그대로.
  2) 지점 상세(84곳), 관광지 주변(25곳), 지역 목록(16곳) 페이지 아래에 '자주 묻는 질문'을 붙인다.
     답은 그 페이지에 이미 있는 사실(요금·영업시간·문신 규정·가는 길, 거리·종류별 수, 구별 수)만 옮긴다.
     같은 내용을 FAQPage 구조화 데이터로도 넣어 검색엔진·AI 답변이 읽기 쉽게 한다.
  3) 용어집 페이지(/guide/glossary/, 7개 언어)를 glossary.json 으로 만든다. DefinedTermSet 구조화 데이터 포함.
     가이드 목록에 카드를, 가이드 글 옆 목차에 용어집 링크를 넣는다.
  4) sitemap.xml: 용어집 주소를 넣고, 이번에 바뀐 페이지의 날짜(lastmod)를 오늘로 바꾸고,
     지점 상세에 일러스트·공유 그림 주소를 이미지 정보로 붙인다(IndexNow 가 바뀐 주소를 자동으로 알린다).
  5) llms.txt 에 용어집과 '자주 묻는 질문' 안내를 넣는다.

사용법 (저장소 맨 위에서):  python3 tools/seo/build.py          바꾸기
                             python3 tools/seo/build.py --check  바뀔 파일 수만 보기
순서: tools/media/build.py → tools/cat/build.py → tools/seo/build.py (사진·일러스트가 바뀐 뒤 마지막에 한 번)
"""
import datetime, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BASE = 'https://hantang.kr/'
CHECK = '--check' in sys.argv
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d')

LANGS = [('en', '', 'en'), ('ja', 'ja/', 'ja'), ('zh-hant', 'zh-hant/', 'zh-Hant'), ('zh-hans', 'zh-hans/', 'zh-Hans'),
         ('vi', 'vi/', 'vi'), ('th', 'th/', 'th'), ('ru', 'ru/', 'ru'), ('ko', 'ko/', 'ko')]
PREFIX = {c: p for c, p, _ in LANGS}
HREFLANG = {c: h for c, _, h in LANGS}
FOREIGN = [c for c, _, _ in LANGS if c != 'ko']

changed = []          # 바뀐 페이지 (저장소 기준 경로)
written = {}


def rd(rel):
    return open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, new, old=None):
    if old is None:
        p = os.path.join(ROOT, rel)
        old = open(p, encoding='utf-8').read() if os.path.exists(p) else None
    if new == old:
        return False
    changed.append(rel)
    if not CHECK:
        p = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w', encoding='utf-8').write(new)
    return True


def e(s):
    return html.escape(s, quote=True)


def text(h):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', h))).strip()


def root_of(rel):
    return '../' * rel.count('/')


def url_of(rel):
    return BASE + rel[:-len('index.html')] if rel.endswith('index.html') else BASE + rel


def ld(obj, tag='faq'):
    return '<script type="application/ld+json" data-seo="%s">' % tag + json.dumps(obj, ensure_ascii=False, indent=1) + '</script>'


# ─────────────────────────── 문구 ───────────────────────────
L10N = {
 'en': dict(faq='Quick answers', sep=', ', end='.', glo='Glossary of bath words',
            note_place='Answers repeat the facts on this page, with the date each was checked.',
            note_list='Answers are counted from the licence data on this page.',
            q_price='How much does {n} cost?', q_hours='What are the opening hours of {n}?', q_tattoo='Can I go to {n} with tattoos?',
            q_booking='How do I book {n}?', q_access='How do I get to {n}?', q_water='What kind of water does {n} use?',
            session='Session', addr='Address in Korean (for a taxi)',
            n_q1='Is there a jjimjilbang or sauna near {a}?', n_close='Closest', n_q2='What kinds of bathhouses are near {a}?',
            n_q3='Which places near {a} does HANTANG cover in detail?',
            r_q1='How many bathhouses and jjimjilbangs are there in {r}?',
            r_a1='{N} licensed bathhouses, saunas and jjimjilbangs are recorded as operating in {r} (Ministry of the Interior and Safety licence data, {d}).',
            r_type='By type', r_q2='Which districts in {r} have the most bathhouses?', r_q3='Which places in {r} does HANTANG cover in detail?',
            r_q4='Are there lists for popular areas in {r}?', yes='Yes: '),
 'ja': dict(faq='よくある質問', sep='、', end='。', glo='お風呂用語集',
            note_place='回答はこのページの情報をまとめたもので、確認した時期を添えています。',
            note_list='回答はこのページの営業許可データから数えています。',
            q_price='{n}の料金はいくら？', q_hours='{n}の営業時間は？', q_tattoo='{n}はタトゥーがあっても入れる？',
            q_booking='{n}の予約方法は？', q_access='{n}への行き方は？', q_water='{n}のお湯（泉質）は？',
            session='利用時間', addr='韓国語の住所（タクシー用）',
            n_q1='{a}の近くにチムジルバンやサウナはある？', n_close='近い順に', n_q2='{a}周辺にはどんな種類のお風呂がある？',
            n_q3='{a}周辺でHANTANGが詳しく紹介している施設は？',
            r_q1='{r}にはチムジルバンや銭湯がいくつある？',
            r_a1='{r}で営業中として記録されている許可済みの銭湯・サウナ・チムジルバンは{N}件です（行政安全部の営業許可データ、{d}時点）。',
            r_type='種類別', r_q2='{r}で銭湯・サウナが多い地区は？', r_q3='{r}でHANTANGが詳しく紹介している施設は？',
            r_q4='{r}の人気エリア別の一覧はある？', yes='あります：'),
 'zh-hant': dict(faq='常見問題', sep='、', end='。', glo='澡堂用語',
            note_place='答案整理自本頁資訊，並標註查證時間。',
            note_list='答案依本頁的營業許可資料計算。',
            q_price='{n}多少錢？', q_hours='{n}的營業時間是幾點到幾點？', q_tattoo='有刺青可以去{n}嗎？',
            q_booking='{n}要怎麼預約？', q_access='怎麼去{n}？', q_water='{n}用的是什麼水？',
            session='使用時間', addr='韓文地址（給計程車司機看）',
            n_q1='{a}附近有汗蒸幕或三溫暖嗎？', n_close='最近的是', n_q2='{a}附近有哪些類型的澡堂？',
            n_q3='{a}附近有哪些地方 HANTANG 有詳細介紹？',
            r_q1='{r}有多少間澡堂和汗蒸幕？',
            r_a1='{r}共有 {N} 間合法登記、紀錄為營業中的澡堂、三溫暖與汗蒸幕（行政安全部營業許可資料，{d}）。',
            r_type='依類型', r_q2='{r}哪些區的澡堂最多？', r_q3='HANTANG 詳細介紹了{r}的哪些地方？',
            r_q4='有{r}熱門區域的周邊清單嗎？', yes='有：'),
 'zh-hans': dict(faq='常见问题', sep='、', end='。', glo='澡堂用语',
            note_place='答案整理自本页信息，并标注核实时间。',
            note_list='答案按本页的营业许可数据统计。',
            q_price='{n}多少钱？', q_hours='{n}营业时间是几点到几点？', q_tattoo='有纹身可以去{n}吗？',
            q_booking='{n}怎么预约？', q_access='怎么去{n}？', q_water='{n}用的是什么水？',
            session='时长', addr='韩文地址（给出租车司机看）',
            n_q1='{a}附近有汗蒸幕或桑拿吗？', n_close='最近的是', n_q2='{a}附近有哪些类型的澡堂？',
            n_q3='{a}附近有哪些地方 HANTANG 有详细介绍？',
            r_q1='{r}有多少家澡堂和汗蒸幕？',
            r_a1='{r}共有{N}家持证、登记为营业中的澡堂、桑拿和汗蒸幕（行政安全部营业许可数据，{d}）。',
            r_type='按类型', r_q2='{r}哪些区的澡堂最多？', r_q3='HANTANG 详细介绍了{r}的哪些地方？',
            r_q4='有{r}热门区域的周边清单吗？', yes='有：'),
 'vi': dict(faq='Câu hỏi thường gặp', sep=', ', end='.', glo='Từ điển nhà tắm',
            note_place='Câu trả lời lấy từ thông tin trên trang này, kèm thời điểm kiểm tra.',
            note_list='Câu trả lời được đếm từ dữ liệu giấy phép trên trang này.',
            q_price='{n} giá bao nhiêu?', q_hours='{n} mở cửa lúc mấy giờ?', q_tattoo='Có hình xăm có vào {n} được không?',
            q_booking='Đặt chỗ ở {n} như thế nào?', q_access='Đến {n} bằng cách nào?', q_water='{n} dùng loại nước gì?',
            session='Thời lượng', addr='Địa chỉ tiếng Hàn (đưa tài xế taxi)',
            n_q1='Gần {a} có jjimjilbang hay phòng xông hơi không?', n_close='Gần nhất', n_q2='Quanh {a} có những loại nhà tắm nào?',
            n_q3='Nơi nào gần {a} được HANTANG giới thiệu chi tiết?',
            r_q1='{r} có bao nhiêu nhà tắm và jjimjilbang?',
            r_a1='{r} có {N} nhà tắm, phòng xông hơi và jjimjilbang được cấp phép và đang hoạt động (dữ liệu giấy phép của Bộ Nội vụ và An toàn, {d}).',
            r_type='Theo loại hình', r_q2='Khu vực nào ở {r} có nhiều nhà tắm nhất?', r_q3='HANTANG giới thiệu chi tiết những nơi nào ở {r}?',
            r_q4='Có danh sách theo các khu vực nổi tiếng ở {r} không?', yes='Có: '),
 'th': dict(faq='คำถามที่พบบ่อย', sep=', ', end='', glo='คำศัพท์โรงอาบน้ำ',
            note_place='คำตอบสรุปจากข้อมูลในหน้านี้ พร้อมวันที่ตรวจสอบ',
            note_list='คำตอบนับจากข้อมูลใบอนุญาตในหน้านี้',
            q_price='{n} ราคาเท่าไร', q_hours='{n} เปิดกี่โมงถึงกี่โมง', q_tattoo='มีรอยสักเข้า {n} ได้ไหม',
            q_booking='จอง {n} ได้อย่างไร', q_access='ไป {n} อย่างไร', q_water='{n} ใช้น้ำแบบไหน',
            session='ระยะเวลา', addr='ที่อยู่ภาษาเกาหลี (ยื่นให้คนขับแท็กซี่)',
            n_q1='ใกล้{a}มีจิมจิลบังหรือซาวน่าไหม', n_close='ใกล้ที่สุด', n_q2='รอบ{a}มีโรงอาบน้ำแบบไหนบ้าง',
            n_q3='ที่ไหนใกล้{a}ที่ HANTANG แนะนำไว้ละเอียด',
            r_q1='{r}มีโรงอาบน้ำและจิมจิลบังกี่แห่ง',
            r_a1='{r}มีโรงอาบน้ำ ซาวน่า และจิมจิลบังที่มีใบอนุญาตและบันทึกว่ายังเปิดอยู่ {N} แห่ง (ข้อมูลใบอนุญาตของกระทรวงมหาดไทยและความปลอดภัย ณ {d})',
            r_type='แยกตามประเภท', r_q2='เขตไหนใน{r}มีโรงอาบน้ำมากที่สุด', r_q3='HANTANG แนะนำที่ไหนใน{r}แบบละเอียดบ้าง',
            r_q4='มีรายชื่อตามย่านยอดนิยมใน{r}ไหม', yes='มี: '),
 'ru': dict(faq='Частые вопросы', sep=', ', end='.', glo='Словарь бани',
            note_place='Ответы повторяют данные этой страницы с датой проверки.',
            note_list='Ответы посчитаны по данным лицензий на этой странице.',
            q_price='Сколько стоит {n}?', q_hours='Какие часы работы у {n}?', q_tattoo='Можно ли в {n} с татуировками?',
            q_booking='Как забронировать {n}?', q_access='Как добраться до {n}?', q_water='Какая вода в {n}?',
            session='Сеанс', addr='Адрес на корейском (для такси)',
            n_q1='{a}: есть ли рядом чимчильбан или сауна?', n_close='Ближайшие', n_q2='{a}: какие бани есть поблизости?',
            n_q3='{a}: о каких местах рядом у HANTANG есть подробные страницы?',
            r_q1='{r}: сколько здесь бань и чимчильбанов?',
            r_a1='{r}: {N} лицензированных бань, саун и чимчильбанов числятся действующими (данные лицензий Министерства внутренних дел и безопасности на {d}).',
            r_type='По типам', r_q2='{r}: в каких районах больше всего бань?', r_q3='{r}: какие места HANTANG описывает подробно?',
            r_q4='{r}: есть ли списки по популярным районам?', yes='Да: '),
 'ko': dict(faq='자주 묻는 질문', sep=', ', end='.', glo='',
            note_place='답변은 이 페이지의 내용을 옮긴 것이며, 확인한 시점을 함께 적었습니다.',
            note_list='답변은 이 페이지의 인허가 자료로 센 숫자입니다.',
            q_price='{n} 요금은 얼마인가요?', q_hours='{n} 영업시간은 어떻게 되나요?', q_tattoo='문신(타투)이 있어도 {n}에 갈 수 있나요?',
            q_booking='{n} 예약은 어떻게 하나요?', q_access='{n}까지 어떻게 가나요?', q_water='{n}의 물은 어떤가요?',
            session='이용 시간', addr='한글 주소(택시 기사님께 보여 주세요)',
            n_q1='{a} 근처에 찜질방이나 사우나가 있나요?', n_close='가까운 곳', n_q2='{a} 주변에는 어떤 목욕탕이 있나요?',
            n_q3='{a} 근처에서 한탕이 자세히 소개한 곳은 어디인가요?',
            r_q1='{r}에는 목욕탕·찜질방이 몇 곳 있나요?',
            r_a1='{r}에서 영업 중으로 기록된 인허가 목욕탕·사우나·찜질방은 {N}곳입니다(행정안전부 인허가 자료, {d} 기준).',
            r_type='종류별', r_q2='{r}에서 목욕탕이 가장 많은 구·시·군은 어디인가요?', r_q3='한탕이 자세히 소개한 {r}의 시설은 어디인가요?',
            r_q4='{r}의 인기 지역별 목록이 있나요?', yes='있습니다: '),
}

# 지점 카드 표의 항목 이름 (언어별)
DK = {
 'en': {'HOURS': 'hours', 'Booking': 'booking', 'ADDRESS': 'addr', 'PRICES': 'price', 'TATTOOS': 'tattoo', 'WATER': 'water', 'GETTING THERE': 'access', 'Session': 'session'},
 'ja': {'営業時間': 'hours', '予約': 'booking', '住所': 'addr', '料金': 'price', 'タトゥー': 'tattoo', '泉質': 'water', 'アクセス': 'access', '利用時間': 'session'},
 'zh-hant': {'營業時間': 'hours', '預約方式': 'booking', '地址': 'addr', '價格': 'price', '刺青': 'tattoo', '水源': 'water', '交通': 'access', '使用時間': 'session'},
 'zh-hans': {'营业时间': 'hours', '预约': 'booking', '地址': 'addr', '价格': 'price', '纹身': 'tattoo', '水质': 'water', '交通': 'access', '时长': 'session'},
 'vi': {'GIỜ MỞ CỬA': 'hours', 'ĐẶT CHỖ': 'booking', 'ĐỊA CHỈ': 'addr', 'GIÁ VÉ': 'price', 'HÌNH XĂM': 'tattoo', 'LOẠI NƯỚC': 'water', 'CÁCH ĐI': 'access', 'THỜI LƯỢNG': 'session'},
 'th': {'เวลาเปิด': 'hours', 'การจอง': 'booking', 'ที่อยู่': 'addr', 'ราคา': 'price', 'รอยสัก': 'tattoo', 'ประเภทน้ำ': 'water', 'การเดินทาง': 'access', 'ระยะเวลา': 'session'},
 'ru': {'ЧАСЫ РАБОТЫ': 'hours', 'БРОНЬ': 'booking', 'АДРЕС': 'addr', 'ЦЕНЫ': 'price', 'ТАТУ': 'tattoo', 'ВОДА': 'water', 'КАК ДОБРАТЬСЯ': 'access', 'СЕАНС': 'session'},
 'ko': {'영업시간': 'hours', '예약': 'booking', '주소': 'addr', '요금': 'price', '문신(타투)': 'tattoo', '물': 'water', '가는 길': 'access', '이용 시간': 'session'},
}

SEO_CSS = ('<style data-seo>.sfaq{margin-top:44px;border:1px solid var(--line);border-radius:18px;padding:22px 24px 18px;background:#fff}'
           '.sfaq h2{font-size:22px;margin:0 0 6px}.sfaq-i{border-top:1px solid var(--line);padding:14px 0}.sfaq-i:first-of-type{border-top:0}'
           '.sfaq-i h3{font-size:16px;line-height:1.45;margin:0;word-break:keep-all}.sfaq-i p{margin:6px 0 0;font-size:14.5px;line-height:1.7;color:var(--mute)}'
           '.sfaq-i p a{color:var(--blue);font-weight:700}.sfaq-n{font-size:12.5px;color:var(--mute);margin:8px 0 0}'
           '@media (max-width:560px){.sfaq{padding:18px 16px 14px}}</style>')


def lang_of(rel):
    for c, p, _ in LANGS:
        if p and rel.startswith(p):
            return c
    return 'en'


def faq_block(lang, qas, note):
    """qas: [(질문, 답 HTML)] → 보이는 질문 목록 + FAQPage 구조화 데이터."""
    t = L10N[lang]
    items = ''.join('<div class="sfaq-i"><h3>%s</h3><p>%s</p></div>' % (e(q), a) for q, a in qas)
    data = {'@context': 'https://schema.org', '@type': 'FAQPage', 'inLanguage': HREFLANG[lang],
            'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': text(a)}} for q, a in qas]}
    return ('<!--seo:faq--><section class="sfaq" id="qa"><h2>%s</h2>%s<p class="sfaq-n">%s</p></section>%s<!--/seo:faq-->'
            % (e(t['faq']), items, e(note), ld(data)))


def strip_faq(s):
    return re.sub(r'<!--seo:faq-->.*?<!--/seo:faq-->', '', s, flags=re.S)


def add_css(s):
    """FAQ 모양을 넣는다. tools/media 가 관리하는 mx.css 링크·일러스트 모양보다 앞에 둬서 두 도구가 서로 자리를 바꾸지 않게 한다."""
    s = re.sub(r'<style data-seo>.*?</style>\n?', '', s, flags=re.S)
    if 'class="sfaq"' in s:
        head_end = s.find('</head>')
        cand = [m.start() for m in (re.search(r'<link rel="stylesheet" href="[^"]*assets/mx\.css[^"]*" data-mx>', s), re.search(r'<style data-il>', s)) if m and m.start() < head_end]
        at = min(cand) if cand else head_end
        s = s[:at] + SEO_CSS + '\n' + s[at:]
    return s


CJK = ('ja', 'zh-hant', 'zh-hans')


def colon(lang):
    return '：' if lang in CJK else ': '


def join(lang):
    return '' if lang in CJK else ' '


def end(lang, s):
    s = s.rstrip()
    return s if (not L10N[lang]['end'] or s.endswith(('.', '。', '?', '!', '？', ')', '）'))) else s + L10N[lang]['end']


# ───────────────────── 지점 이름 (상세 페이지가 있는 곳) ─────────────────────
_names = {}


def place_name(pid, lang):
    k = (pid, lang)
    if k not in _names:
        rel = PREFIX[lang] + 'baths/p/%s/index.html' % pid
        name = None
        if os.path.exists(os.path.join(ROOT, rel)):
            s = rd(rel)
            a = re.search(r'<article\b[^>]*\bdata-hx="%s"[^>]*>' % re.escape(pid), s)
            if a:
                h = re.search(r'<h3[^>]*>(.*?)</h3>', s[a.end():a.end() + 4000], re.S)
                if h:
                    name = text(re.split(r'<span', h.group(1), maxsplit=1)[0])
        _names[k] = name
    return _names[k]


# ─────────────────────────── 1) 가이드 제목 ───────────────────────────
def set_meta(s, attr, name, value):
    return re.sub(r'(<meta %s="%s" content=")[^"]*(">)' % (attr, re.escape(name)), lambda m: m.group(1) + e(value) + m.group(2), s, count=1)


def do_titles():
    titles = json.load(open(os.path.join(HERE, 'titles.json'), encoding='utf-8'))
    for slug, per in titles.items():
        if slug.startswith('_'):
            continue
        for lang, t in per.items():
            rel = PREFIX[lang] + 'guide/%s/index.html' % slug
            if not t or not os.path.exists(os.path.join(ROOT, rel)):
                continue
            old = rd(rel)
            s = re.sub(r'<title>.*?</title>', lambda m: '<title>' + e(t) + '</title>', old, count=1, flags=re.S)
            s = set_meta(s, 'property', 'og:title', t)
            s = set_meta(s, 'name', 'twitter:title', t)
            wr(rel, s, old)


# ─────────────────────────── 2) 지점 상세 FAQ ───────────────────────────
def do_places():
    for c, p, _ in LANGS:
        base = os.path.join(ROOT, p, 'baths', 'p')
        for pid in sorted(os.listdir(base)):
            rel = p + 'baths/p/%s/index.html' % pid
            if not os.path.exists(os.path.join(ROOT, rel)):
                continue
            old = rd(rel)
            s = strip_faq(old)
            a = re.search(r'<article\b[^>]*\bdata-hx="%s"[^>]*>' % re.escape(pid), s)
            if not a:
                continue
            seg = s[a.end():s.find('</article>', a.end())]
            facts = {}
            for k, v in re.findall(r'<div class="dr"><span class="dk">(.*?)</span><span class="dv">(.*?)</span></div>', seg, re.S):
                key = DK[c].get(text(k))
                if key and text(v):
                    facts[key] = text(v)
            n = place_name(pid, c) or pid
            t = L10N[c]
            qas = []
            if 'price' in facts:
                ans = facts['price'] + (' · %s%s%s' % (t['session'], colon(c), facts['session']) if 'session' in facts else '')
                qas.append((t['q_price'].format(n=n), e(ans)))
            elif 'session' in facts:
                qas.append((t['q_price'].format(n=n), e('%s%s%s' % (t['session'], colon(c), facts['session']))))
            if 'hours' in facts:
                qas.append((t['q_hours'].format(n=n), e(facts['hours'])))
            if 'tattoo' in facts:
                qas.append((t['q_tattoo'].format(n=n), e(facts['tattoo'])))
            if 'booking' in facts:
                qas.append((t['q_booking'].format(n=n), e(facts['booking'])))
            if 'access' in facts or 'addr' in facts:
                parts = []
                if 'access' in facts:
                    parts.append(e(end(c, facts['access'])))
                if 'addr' in facts:
                    parts.append('%s%s<span lang="ko">%s</span>' % (e(t['addr']), colon(c), e(facts['addr'])))
                qas.append((t['q_access'].format(n=n), join(c).join(parts)))
            if 'water' in facts:
                qas.append((t['q_water'].format(n=n), e(facts['water'])))
            if len(qas) >= 2:
                block = faq_block(c, qas, t['note_place'])
                anchor = s.find('<!--mx:b-->')                       # 사진·영상 영역(tools/media)보다 앞
                if anchor < 0:
                    anchor = s.find('<section class="pl-rev" id="reviews">')
                if anchor < 0:
                    anchor = s.find('</article></div>') + len('</article></div>')
                s = s[:anchor] + block + s[anchor:]
            wr(rel, add_css(s), old)


# ─────────────────────────── 3) 관광지 주변 FAQ ───────────────────────────
def rows(s):
    out = []
    for m in re.finditer(r'<li class="pl"([^>]*)>(.*?)</li>', s, re.S):
        at, body = m.group(1), m.group(2)
        g = lambda k: html.unescape((re.search(r'\b%s="([^"]*)"' % k, at) or [None, ''])[1])
        d = re.search(r'<span class="pdist">([^<]*)</span>', body)
        dist = d.group(1).strip() if d else ''
        km = re.search(r'[\d.]+', dist)
        out.append(dict(n=g('data-n'), cur=g('data-cur'), sub=g('data-sub'), t=g('data-t'), d=g('data-d'), dist=dist,
                        km=float(km.group(0)) if km else 1e9))
    return out


def kind_of(sub):
    parts = [x.strip() for x in sub.split('·')]
    return parts[1] if len(parts) > 1 else ''


def do_near():
    for c, p, _ in LANGS:
        base = os.path.join(ROOT, p, 'baths', 'near')
        if not os.path.isdir(base):
            continue
        for area in sorted(os.listdir(base)):
            rel = p + 'baths/near/%s/index.html' % area
            if not os.path.exists(os.path.join(ROOT, rel)):
                continue
            old = rd(rel)
            s = strip_faq(old)
            t = L10N[c]
            crumb = re.search(r'<span>›</span><span>([^<]*)</span></nav>', s)
            meta = re.search(r'<div class="nr-meta"><span><b>(.*?)</b></span>(?:<span>(.*?)</span>)?</div>', s, re.S)
            anchor = s.find('<h2 class="rx-d" style="border:0;margin-top:44px">')
            if not (crumb and meta and anchor > 0):
                wr(rel, add_css(s), old)
                continue
            a = text(crumb.group(1))
            rs = rows(s)
            if not rs:
                wr(rel, add_css(s), old)
                continue
            close = sorted(rs, key=lambda r: r['km'])[:3]
            fmt = lambda r: '<span lang="ko">%s</span> (%s)' % (e(r['n']), e(t['sep'].join(x for x in (kind_of(r['sub']), r['dist']) if x)))
            a1 = e(end(c, text(meta.group(1)))) + (join(c) + e(end(c, text(meta.group(2)))) if meta.group(2) else '')
            a1 += '%s%s%s%s%s' % (join(c), e(t['n_close']), colon(c), t['sep'].join(fmt(r) for r in close), t['end'])
            qas = [(t['n_q1'].format(a=a), a1)]
            groups = []
            for g in re.finditer(r'<h2 class="rx-d">(.*?)<small>(.*?)</small></h2>', s, re.S):
                num = re.search(r'\d[\d,.]*', text(g.group(2)))
                if num:
                    groups.append('%s%s%s' % (text(g.group(1)), colon(c), num.group(0)))
            if len(groups) >= 1:
                qas.append((t['n_q2'].format(a=a), e(end(c, t['sep'].join(groups)))))
            cur = [r for r in sorted(rs, key=lambda r: r['km']) if r['cur'] and place_name(r['cur'], c)]
            if cur:
                r0 = root_of(rel)
                links = t['sep'].join('<a href="%sbaths/p/%s/">%s</a> (%s)' % (r0 + PREFIX[c], r['cur'], e(place_name(r['cur'], c)), e(r['dist']))
                                      for r in cur[:8])
                qas.append((t['n_q3'].format(a=a), links + t['end']))
            s = s[:anchor] + faq_block(c, qas, t['note_list']) + s[anchor:]
            wr(rel, add_css(s), old)


# ─────────────────────────── 4) 지역 목록 FAQ ───────────────────────────
REGIONS = ['seoul', 'busan', 'incheon', 'daegu', 'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon', 'chungbuk', 'chungnam',
           'jeonbuk', 'jeonnam-gwangju', 'gyeongbuk', 'gyeongnam', 'jeju']


def do_regions():
    for c, p, _ in LANGS:
        for reg in REGIONS:
            rel = p + 'baths/%s/index.html' % reg
            if not os.path.exists(os.path.join(ROOT, rel)):
                continue
            old = rd(rel)
            s = strip_faq(old)
            t = L10N[c]
            crumb = re.search(r'<span>›</span><span>([^<]*)</span></nav>', s)
            anchor = s.find('<div class="rx-note">')
            rs = rows(s)
            if not (crumb and anchor > 0 and rs):
                wr(rel, add_css(s), old)
                continue
            r = text(crumb.group(1))
            note = s[anchor:s.find('</div>', anchor)]
            d = re.search(r'20\d\d-\d\d-\d\d', note)
            d = d.group(0) if d else ''
            labels = {m.group(1): text(m.group(2)) for m in re.finditer(r'<button class="ctab" data-ft="([a-z]+)">(.*?)</button>', s)}
            counts = {}
            for x in rs:
                counts[x['t']] = counts.get(x['t'], 0) + 1
            types = t['sep'].join('%s %d' % (labels.get(k, k), v) for k, v in sorted(counts.items(), key=lambda kv: -kv[1]) if k in labels)
            a1 = e(t['r_a1'].format(r=r, N=len(rs), d=d))
            if types:
                a1 += '%s%s%s%s%s' % (join(c), e(t['r_type']), colon(c), e(types), t['end'])
            qas = [(t['r_q1'].format(r=r), a1)]
            opts = []
            for m in re.finditer(r'<option value="[^"]+">(.*?)</option>', s[s.find('id="rxD"'):s.find('</select>', s.find('id="rxD"'))]):
                o = text(m.group(1))
                num = re.search(r'\((\d+)\)\s*$', o)
                if num:
                    opts.append((int(num.group(1)), o))
            if len(opts) >= 2:
                top = sorted(opts, key=lambda x: -x[0])[:5]
                qas.append((t['r_q2'].format(r=r), e(end(c, t['sep'].join(o for _, o in top)))))
            r0 = root_of(rel)
            seen, cur = set(), []
            for x in rs:
                if x['cur'] and x['cur'] not in seen and place_name(x['cur'], c):
                    seen.add(x['cur'])
                    cur.append(x['cur'])
            if cur:
                links = t['sep'].join('<a href="%sbaths/p/%s/">%s</a>' % (r0 + PREFIX[c], pid, e(place_name(pid, c))) for pid in cur[:12])
                qas.append((t['r_q3'].format(r=r), links + t['end']))
            chips = re.search(r'<div class="nr-chips"[^>]*>(.*?)</div>', s, re.S)
            if chips:
                near = [(m.group(1), text(m.group(2)).lstrip('⌖ ').strip()) for m in re.finditer(r'<a href="([^"]*baths/near/[a-z-]+/)">(.*?)</a>', chips.group(1))]
                if near:
                    qas.append((t['r_q4'].format(r=r), e(t['yes']) + t['sep'].join('<a href="%s">%s</a>' % (h, e(n)) for h, n in near) + t['end']))
            s = s[:anchor] + faq_block(c, qas, t['note_list']) + s[anchor:]
            wr(rel, add_css(s), old)


# ─────────────────────────── 5) 용어집 ───────────────────────────
GL = json.load(open(os.path.join(HERE, 'glossary.json'), encoding='utf-8'))
SHELL = 'first-visit'


def guide_h1(slug, lang):
    rel = PREFIX[lang] + 'guide/%s/index.html' % slug
    s = rd(rel)
    return text(re.search(r'<h1>(.*?)</h1>', s, re.S).group(1))


def must(pat, repl, s, what):
    new, n = re.subn(pat, lambda m: repl, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('용어집 틀에서 %s 자리를 찾지 못함' % what)
    return new


def build_glossary(lang):
    P = GL['page'][lang]
    src = PREFIX[lang] + 'guide/%s/index.html' % SHELL
    s = rd(src)
    rel = PREFIX[lang] + 'guide/glossary/index.html'
    url = url_of(rel)
    r0 = root_of(rel)
    s = s.replace('guide/%s/' % SHELL, 'guide/glossary/')
    s = must(r'<title>.*?</title>', '<title>' + e(P['title']) + '</title>', s, '<title>')
    s = set_meta(s, 'name', 'description', P['desc'])
    for attr, k, v in (('property', 'og:title', P['title']), ('property', 'og:description', P['desc']), ('property', 'og:image:alt', P['h1']),
                       ('name', 'twitter:title', P['title']), ('name', 'twitter:description', P['desc'])):
        s = set_meta(s, attr, k, v)
    og = BASE + 'og/' + PREFIX[lang].replace('/', '-') + 'guide-bath-types.jpg'
    s = set_meta(s, 'property', 'og:image', og)
    s = set_meta(s, 'name', 'twitter:image', og)
    s = re.sub(r'<script type="application/ld\+json"[^>]*>.*?</script>\n?', '', s, flags=re.S)

    crumb = re.search(r'<nav class="crumbs" aria-label="([^"]*)"><a href="([^"]*)">HANTANG</a><span>›</span><a href="([^"]*)">(.*?)</a>', s)
    guides_label = text(crumb.group(4))
    meta = re.search(r'<div class="g-meta"><span>(.*?)</span> · <span>(.*?) <b>', s)
    toc = re.search(r'<aside class="toc" aria-label="([^"]*)">\s*<h5>(.*?)</h5>', s, re.S)
    srch = re.search(r'<section class="src"><h2>(.*?)</h2>', s).group(1)
    all_link = re.search(r'<a class="toc-all" href="([^"]*)">(.*?)</a>', s)

    terms = GL['terms']
    words = 0
    body = '<p>%s</p>\n' % e(P['lede'])
    toc_html = ''
    defined = []
    for i, sec in enumerate(GL['sections'], 1):
        body += '<h2 id="s%d">%s</h2>\n' % (i, e(sec['name'][lang]))
        toc_html += '    <a href="#s%d">%s</a>\n' % (i, e(sec['name'][lang]))
        for tid in sec['terms']:
            T = terms[tid]
            name, d = T[lang]
            words += len(d.split())
            kparts = [x.strip() for x in T['ko'].split('·') if x.strip()]
            ko = '' if all(x.split('/')[0] in name for x in kparts) else ' <span class="ko-run" lang="ko">%s</span>' % e(T['ko'])
            rparts = [x.strip() for x in T['rom'].split('·') if x.strip() and x.strip().lower() not in name.lower()]
            rom = (' <em>%s</em>' % e(' · '.join(rparts))) if rparts else ''
            more = '<a href="%sguide/%s/">%s</a>' % (r0 + PREFIX[lang], T['see'], e(guide_h1(T['see'], lang)))
            body += '<h3 id="t-%s">%s%s%s</h3>\n<p>%s <span style="color:var(--mute);font-size:13.5px">%s %s</span></p>\n' % (
                tid, e(name), ko, rom, e(d), e(P['more']), more)
            alt = [x for x in [T['ko']] + [y.strip() for y in T['rom'].split('·')] if x]
            defined.append({'@type': 'DefinedTerm', 'name': name, 'alternateName': alt, 'description': d,
                            'url': url + '#t-' + tid, 'inDefinedTermSet': url})
    used = []
    for tid in terms:
        if terms[tid]['see'] not in used:
            used.append(terms[tid]['see'])
    src_items = '<li>%s</li>\n' % e(P['src_note']) + ''.join(
        '<li><a href="%sguide/%s/">%s</a> — HANTANG</li>\n' % (r0 + PREFIX[lang], g, e(guide_h1(g, lang))) for g in used)

    minutes = max(4, round(words / 200)) if lang in ('en', 'vi', 'ru') else max(4, round(len(re.sub(r'\s', '', ''.join(t[lang][1] for t in terms.values()))) / 500))
    min_label = re.sub(r'\d+', str(minutes), meta.group(1), count=1)
    head = ('<header class="g-head">\n  <div class="wrap">\n    <nav class="crumbs" aria-label="%s"><a href="%s">HANTANG</a><span>›</span><a href="%s">%s</a><span>›</span><span>%s</span></nav>\n'
            '    <div class="eyebrow">%s</div>\n    <h1>%s</h1>\n    <p class="lede">%s</p>\n'
            '    <div class="g-meta"><span>%s</span> · <span>%s <b>%s</b></span></div>\n  </div>\n</header>') % (
        crumb.group(1), crumb.group(2), crumb.group(3), e(guides_label), e(P['tag']), e(P['tag']), e(P['h1']), e(P['desc']),
        min_label, meta.group(2), TODAY_GLOSSARY)
    s = must(r'<header class="g-head">.*?</header>', head, s, 'g-head')
    block = ('<div class="g-body">\n  <aside class="toc" aria-label="%s">\n    <h5>%s</h5>\n%s    <a class="toc-all" href="%s">%s</a>\n  </aside>\n'
             '  <main>\n    <article class="prose">\n%s\n    </article>\n    <section class="src"><h2>%s</h2><ol>\n%s</ol></section>\n  </main>\n</div>') % (
        toc.group(1), toc.group(2), toc_html, all_link.group(1), all_link.group(2), body, srch, src_items)
    s = must(r'<div class="g-body">.*?</main>\s*</div>', block, s, 'g-body')
    s = must(r'data-target="guide:[a-z0-9-]+"', 'data-target="guide:glossary"', s, '댓글 칸')

    # 아래 '관련 가이드' 카드
    idx = rd(PREFIX[lang] + 'guide/index.html')
    cards = {m.group(1): m.group(0) for m in re.finditer(r'<a class="art rv" href="[^"]*?guide/([a-z0-9-]+)/">.*?</a>', idx, re.S)}
    a = s.find('<div class="art-grid">', s.find('class="g-next"'))
    b = s.find('<a class="all"', a)
    if a > 0 and b > 0:
        rc = ''.join(re.sub(r'href="[^"]*?guide/', 'href="%sguide/' % (r0 + PREFIX[lang]), cards[g], count=1)
                     for g in ('bath-types', 'rooms', 'seshin', 'phrases') if g in cards)
        s = s[:a] + '<div class="art-grid">' + rc + '</div>' + s[b:]

    lds = ld({'@context': 'https://schema.org', '@type': 'DefinedTermSet', 'name': P['h1'], 'description': P['desc'], 'url': url,
              'inLanguage': HREFLANG[lang], 'hasDefinedTerm': defined}, 'glossary')
    lds += ld({'@context': 'https://schema.org', '@type': 'Article', 'headline': P['h1'], 'description': P['desc'], 'image': og,
               'inLanguage': HREFLANG[lang], 'datePublished': GL_PUBLISHED, 'dateModified': TODAY_GLOSSARY,
               'author': {'@type': 'Organization', 'name': 'HANTANG'}, 'publisher': {'@type': 'Organization', 'name': 'HANTANG'},
               'mainEntityOfPage': url}, 'glossary')
    lds += ld({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'HANTANG', 'item': BASE + PREFIX[lang]},
        {'@type': 'ListItem', 'position': 2, 'name': guides_label, 'item': BASE + PREFIX[lang] + 'guide/'},
        {'@type': 'ListItem', 'position': 3, 'name': P['h1'], 'item': url}]}, 'glossary')
    s = s.replace('<style>', lds + '\n<style>', 1)
    return rel, s


def glossary_stamp():
    """용어집 내용이 바뀐 날만 '업데이트' 날짜를 바꾼다 (매번 오늘 날짜로 바뀌지 않게)."""
    p = os.path.join(HERE, 'glossary.stamp.json')
    raw = open(os.path.join(HERE, 'glossary.json'), 'rb').read()
    import hashlib
    h = hashlib.sha1(raw).hexdigest()[:12]
    st = json.load(open(p)) if os.path.exists(p) else {}
    if st.get('hash') != h:
        st = {'hash': h, 'updated': TODAY, 'published': st.get('published', TODAY)}
        if not CHECK:
            json.dump(st, open(p, 'w'), indent=1)
    return st['published'], st['updated']


def do_glossary():
    global GL_PUBLISHED, TODAY_GLOSSARY
    GL_PUBLISHED, TODAY_GLOSSARY = glossary_stamp()
    for lang in FOREIGN:
        rel, s = build_glossary(lang)
        wr(rel, s)
        # 가이드 목록 카드
        hub = PREFIX[lang] + 'guide/index.html'
        old = rd(hub)
        s2 = re.sub(r'<!--seo:gcard-->.*?<!--/seo:gcard-->', '', old, flags=re.S)
        m = re.search(r'<a class="art rv" href="([^"]*?)guide/phrases/">(.*?)</a>', s2, re.S)
        if m:
            P = GL['page'][lang]
            thumb = re.search(r'<div class="art-thumb">.*?</div>', m.group(2), re.S).group(0)
            rt = re.search(r'<div class="rt">(.*?)</div>', m.group(2)).group(1)
            card = ('<!--seo:gcard--><a class="art rv" href="%sguide/glossary/">%s<div class="art-body"><div class="art-tag">%s</div><h4>%s</h4><p>%s</p>'
                    '<div class="rt">%s</div></div></a><!--/seo:gcard-->') % (m.group(1), thumb, e(P['tag']), e(P['h1']), e(P['card']),
                                                                               re.sub(r'\d+', '5', rt, count=1))
            s2 = s2[:m.end()] + card + s2[m.end():]
        wr(hub, s2, old)
        # 가이드 글 목차 옆 링크
        gdir = os.path.join(ROOT, PREFIX[lang], 'guide')
        for g in sorted(os.listdir(gdir)):
            rel2 = PREFIX[lang] + 'guide/%s/index.html' % g
            if g == 'glossary' or not os.path.exists(os.path.join(ROOT, rel2)):
                continue
            old = rd(rel2)
            s3 = re.sub(r'<!--seo:glo-->.*?<!--/seo:glo-->', '', old, flags=re.S)
            m = re.search(r'<a class="toc-all" href="([^"]*?)guide/">[^<]*</a>', s3)
            if m:
                s3 = s3[:m.end()] + '<!--seo:glo--><a class="toc-all" href="%sguide/glossary/">%s →</a><!--/seo:glo-->' % (
                    m.group(1), e(L10N[lang]['glo'])) + s3[m.end():]
            wr(rel2, s3, old)


# ─────────────────────────── 6) 그 밖의 손질 ───────────────────────────
def do_misc():
    old = rd('index.html')
    s = old.replace('bathhouses — checked in person."', 'bathhouses — from dated, published sources."')
    wr('index.html', s, old)


# ─────────────────────────── 7) sitemap · llms.txt ───────────────────────────
def do_sitemap():
    rel = 'sitemap.xml'
    old = rd(rel)
    s = old
    if 'xmlns:image=' not in s:
        s = s.replace('xmlns:xhtml="http://www.w3.org/1999/xhtml">', 'xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">', 1)
    # 용어집 주소
    s = re.sub(r'  <url>\n    <loc>https://hantang\.kr/(?:[a-z-]+/)?guide/glossary/</loc>.*?</url>\n', '', s, flags=re.S)
    alts = [(HREFLANG[c], BASE + PREFIX[c] + 'guide/glossary/') for c in FOREIGN] + [('x-default', BASE + 'guide/glossary/')]
    add = ''
    for c in FOREIGN:
        add += '  <url>\n    <loc>%sguide/glossary/</loc>\n    <lastmod>%s</lastmod>\n' % (BASE + PREFIX[c], TODAY_GLOSSARY)
        add += ''.join('    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>\n' % (h, u) for h, u in alts) + '  </url>\n'
    j = re.search(r'  <url>\n    <loc>https://hantang\.kr/(?:[a-z-]+/)?journal/', s)   # 저널 주소(tools/journal 이 맨 뒤에 다시 붙임)보다 앞
    at = j.start() if j else s.rfind('</urlset>')
    s = s[:at] + add + s[at:]
    # 바뀐 페이지 날짜, 지점 이미지
    ill = json.load(open(os.path.join(ROOT, 'tools', 'media', 'illust.json'), encoding='utf-8'))
    urls = {url_of(r): r for r in changed if r.endswith('index.html')}

    def fix(m):
        block = m.group(0)
        loc = re.search(r'<loc>([^<]+)</loc>', block).group(1)
        if loc in urls and '/guide/glossary/' not in loc:
            block = re.sub(r'<lastmod>[^<]*</lastmod>', '<lastmod>%s</lastmod>' % TODAY, block, count=1)
        block = re.sub(r'    <image:image>.*?</image:image>\n', '', block, flags=re.S)
        pm = re.match(r'https://hantang\.kr/(?:[a-z-]+/)?baths/p/([a-z0-9-]+)/$', loc)
        if pm:
            pid = pm.group(1)
            imgs = []
            if pid in ill:
                imgs.append(BASE + 'assets/illust/%s-960.webp' % pid)
            if os.path.exists(os.path.join(ROOT, 'og', 'p-%s.jpg' % pid)):
                imgs.append(BASE + 'og/p-%s.jpg' % pid)
            if imgs:
                block = block.replace('  </url>', ''.join('    <image:image><image:loc>%s</image:loc></image:image>\n' % u for u in imgs) + '  </url>')
        return block
    s = re.sub(r'  <url>\n.*?  </url>', fix, s, flags=re.S)
    wr(rel, s, old)


def do_llms():
    rel = 'llms.txt'
    old = rd(rel)
    s = re.sub(r'- \[Glossary of Korean bath words\][^\n]*\n', '', old)
    s = re.sub(r'\nPlace, nearby-area and region pages end with "Quick answers"[^\n]*\n', '\n', s)
    line = ('- [Glossary of Korean bath words](%sguide/glossary/): %s\n' % (BASE, GL['page']['en']['desc']))
    s = s.replace('## Guides (English)\n', '## Guides (English)\n' + line, 1)
    note = ('Place, nearby-area and region pages end with "Quick answers": short questions and answers built only from the facts on that page '
            '(price, hours, tattoo policy, directions, counts from the licence data), each with the date it was checked.\n')
    i = s.find('\n## ')
    if i > 0:
        s = s[:i] + '\n' + note + s[i:]
    s = re.sub(r'\n{3,}', '\n\n', s)
    wr(rel, s, old)


def main():
    do_titles()
    do_places()
    do_near()
    do_regions()
    do_glossary()
    do_misc()
    do_sitemap()
    do_llms()
    kinds = {}
    for r in changed:
        k = 'place' if '/p/' in r else 'near' if '/near/' in r else 'glossary' if 'glossary' in r else 'guide' if '/guide/' in r or r.startswith('guide/') else 'other'
        kinds[k] = kinds.get(k, 0) + 1
    print('%s: 바뀐 파일 %d개 %s' % ('확인만' if CHECK else '완료', len(changed), kinds))


if __name__ == '__main__':
    main()
