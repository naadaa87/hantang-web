# HANTANG 한탕 — Korea Sauna & Bath Guide

한탕 공식 홈페이지 정적 사이트입니다. 빌드 과정 없이 그대로 배포됩니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 페이지 (전체 스타일·스크립트 포함 단일 파일) |
| `404.html` | 없는 주소 접속 시 페이지 (Cloudflare Pages가 자동 인식) |
| `favicon.svg` | 브라우저 탭 아이콘 (탕 심볼) |
| `og.png` | 카톡·SNS 공유 시 미리보기 이미지 (1200×630) |
| `robots.txt` | 검색엔진 수집 허용 설정 |
| `sitemap.xml` | 검색엔진용 사이트맵 |

## 배포 순서 (GitHub 연동 → Cloudflare Pages)

1. **GitHub 저장소 만들기**
   - github.com → New repository → 이름 예: `hantang` → Public → Create
   - 이 폴더의 파일 전체를 업로드 (Add file → Upload files → 드래그)

2. **Cloudflare Pages 연결**
   - Cloudflare 대시보드 → Workers & Pages → Create → **Pages** → Connect to Git
   - 방금 만든 저장소 선택
   - 설정값: Framework preset **None** / Build command **비워두기** / Build output directory **`/`**
   - Save and Deploy → 1~2분 뒤 `프로젝트명.pages.dev` 주소 발급

3. **이후 수정·업데이트**
   - GitHub에서 파일을 수정해 커밋하면 Cloudflare가 자동으로 재배포합니다. 별도 조작이 필요 없습니다.
   - (참고) GitHub 없이 Workers & Pages → Upload assets로 zip 직접 업로드하는 방식도 가능하지만, 자동 배포가 안 되므로 이번에는 Git 연동을 권합니다.

4. **도메인 연결 (선택)**
   - Pages 프로젝트 → Custom domains → 도메인 입력 (예: `hantang.kr`)
   - 도메인 네임서버를 Cloudflare로 옮겨두면 인증서까지 자동 처리됩니다.

## 배포 전·후 수정 포인트

- **도메인 주소**: `index.html` 상단의 `canonical`, `og:url`, `og:image` 세 곳과 `sitemap.xml`, `robots.txt`의 주소가 `https://hantang.kr/`로 되어 있습니다. 다른 도메인을 쓰면 이 다섯 곳만 바꾸면 됩니다. 도메인 연결 전에는 발급받은 `*.pages.dev` 주소로 바꿔도 됩니다.
- **시설 카드 데이터**: `index.html`에서 `⛳ 시설 카드 데이터` 주석 사이가 시설 목록입니다. 현재는 전부 예시 데이터이므로 실사 후 실제 시설로 교체하세요. 카드 하나를 복사해 붙여 넣고 이름·수치·배지만 바꾸는 방식입니다. 도시 필터는 `data-city="seoul"` 또는 `"busan"` 값으로 동작합니다.
- **이메일 폼**: PASS 웨이트리스트 폼은 현재 화면 데모입니다. 실제 수집은 [Formspree](https://formspree.io) 무료 플랜으로 form 태그에 action 주소만 넣으면 5분 내 연동됩니다.
- **문의 메일**: `hello@hantang.kr`로 적어두었습니다. 실제 사용할 주소로 교체하세요.
- **언어**: 영문 단일 버전입니다. 일본어·한국어 페이지는 추후 `/ja/`, `/ko/` 폴더로 추가하고 sitemap에 반영하면 됩니다.

## 다음 단계 제안

1. 도메인 확보·연결 후 Google Search Console과 Bing Webmaster에 sitemap 제출
2. 서울·부산 실사 데이터로 시설 카드 교체 (초기 20~30곳이면 충분)
3. Guides 섹션의 아티클 4종을 실제 페이지로 제작 — 검색·AI 유입의 엔진
4. Formspree 연동으로 웨이트리스트 수집 시작
