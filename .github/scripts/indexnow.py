"""sitemap.xml 에서 lastmod 가 바뀐 주소만 골라 IndexNow 로 보낸다.

- 키 파일: https://hantang.kr/indexnow-key.txt (키 값은 공개되어도 괜찮은 값이다)
- 실패해도 배포에는 영향이 없다. 결과만 로그에 남긴다.
"""
import json
import os
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

HOST = 'hantang.kr'
KEY = open('indexnow-key.txt', encoding='utf-8').read().strip()
KEY_URL = f'https://{HOST}/indexnow-key.txt'
ENDPOINTS = ['https://api.indexnow.org/indexnow', 'https://searchadvisor.naver.com/indexnow']
NS = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}


def entries(xml_text):
    if not xml_text:
        return {}
    root = ET.fromstring(xml_text)
    out = {}
    for u in root.findall('s:url', NS):
        loc = (u.findtext('s:loc', default='', namespaces=NS) or '').strip()
        mod = (u.findtext('s:lastmod', default='', namespaces=NS) or '').strip()
        if loc.startswith(f'https://{HOST}/'):
            out[loc] = mod
    return out


def previous():
    try:
        return subprocess.run(['git', 'show', 'HEAD~1:sitemap.xml'], capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return ''


now = entries(open('sitemap.xml', encoding='utf-8').read())
if os.environ.get('SEND_ALL') == '1':
    urls = list(now)
else:
    before = entries(previous())
    urls = [u for u, m in now.items() if before.get(u) != m]

print(f'sitemap: {len(now)} URLs, to send: {len(urls)}')
if not urls:
    sys.exit(0)

ok = False
for i in range(0, len(urls), 9000):
    body = json.dumps({'host': HOST, 'key': KEY, 'keyLocation': KEY_URL, 'urlList': urls[i:i + 9000]}).encode()
    for ep in ENDPOINTS:
        req = urllib.request.Request(ep, data=body, headers={'content-type': 'application/json; charset=utf-8'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f'{ep}: HTTP {r.status}')
                ok = ok or r.status in (200, 202)
        except urllib.error.HTTPError as e:
            print(f'{ep}: HTTP {e.code} {e.read()[:200]!r}')
        except Exception as e:  # 네트워크 오류도 기록만 한다
            print(f'{ep}: {e}')
print('done' if ok else 'no endpoint accepted the list (see above)')
