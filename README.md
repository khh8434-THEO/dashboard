# 미래사업본부 통합 대시보드

4개 대시보드(일간 실적 · 주간 Sync · 약사 VOC · 재고 관리)를 하나의 페이지에서 보고, 매일 오전 8시(KST) 핵심 지표를 자동으로 새로고침합니다.

## 디렉토리

```
.
├── index.html                          # 메인 페이지 (탭 + iframe + KPI 카드)
├── data.json                           # KPI 데이터 — GitHub Actions가 매일 자동 갱신
├── package.json                        # Playwright 의존성
├── scripts/
│   └── update-dashboard.js             # 4개 대시보드를 헤드리스 크롬으로 열고 KPI 추출
├── .github/
│   └── workflows/
│       └── update-dashboard.yml        # 매일 23:00 UTC (= 08:00 KST) cron
└── README.md
```

## 배포 — GitHub Pages

1. **새 레포 생성** — 예: `future-business-hub` (Public 권장. Private 이면 Pages 사용에 Pro 필요)
2. **이 디렉토리 전체를 푸시**
   ```bash
   git init
   git add .
   git commit -m "init: future-business-hub"
   git branch -M main
   git remote add origin https://github.com/<username>/future-business-hub.git
   git push -u origin main
   ```
3. **GitHub Pages 활성화** — Repo → Settings → Pages
   - Source: **Deploy from a branch**
   - Branch: **main** / Folder: **/ (root)**
   - 저장 후 1~2분 내 `https://<username>.github.io/future-business-hub/` 에서 접근 가능

## 매일 자동 갱신 — GitHub Actions

워크플로우는 이미 포함되어 있습니다 (`.github/workflows/update-dashboard.yml`).

### 1) Actions 쓰기 권한 활성화
Repo → Settings → **Actions** → **General** → "Workflow permissions" 에서
**"Read and write permissions"** 를 선택하고 저장하세요.
(이 옵션이 켜져 있어야 워크플로우가 `data.json` 커밋·푸시를 할 수 있습니다.)

### 2) 첫 실행 확인 (선택)
Repo → **Actions** 탭 → "Update dashboard data" 워크플로우 선택 → **Run workflow** 버튼으로 즉시 실행 가능합니다.
실행 후 `data.json` 에 실제 값이 채워지면 정상.

### 스케줄
- cron: `0 23 * * *` → 매일 **08:00 KST**
- GitHub Actions cron은 5~30분 정도 지연될 수 있습니다 (공식 사양)
- 시간을 바꾸려면 `update-dashboard.yml` 의 cron 값만 수정 (`HH:MM UTC = HH+9:MM KST`)

## 추출되는 데이터

`data.json` 구조:

```jsonc
{
  "updatedAt": "2026-05-28T23:00:00.000Z",
  "daily":  { "ok": true, "lastUpdate": "2026.05.27 16:25", "period": "2025.01 ~ ..." },
  "weekly": { "ok": true, "baseDate": "...", "latestMonth": "5월", "achievement": "92%" },
  "stock":  { "ok": true, "urgentOrder": 2, "reviewOrder": 5, "expiry6m": 1, "expiry6to9m": 3, "expiry9to12m": 8 },
  "voc":    { "ok": true, "total": 124, "pending": 12 }
}
```

각 섹션은 독립적으로 추출되어 한 곳이 실패해도 나머지는 정상 갱신됩니다. 실패 시 해당 섹션은 `ok: false` 로 기록되고 메인 페이지의 카드 상단에 "동기화 실패" 뱃지가 표시됩니다.

## 로컬에서 테스트

```bash
npm install
npx playwright install chromium
npm run update    # data.json 갱신
# 그 후 index.html 을 브라우저로 열면 KPI 가 채워집니다
# (단, 로컬 파일 프로토콜에서는 fetch('./data.json') 이 CORS 제약을 받을 수 있음.
#  python3 -m http.server 8000 같은 정적 서버로 띄워서 확인 권장.)
```

## 문제 해결

| 증상 | 원인 / 해결 |
| --- | --- |
| 카드에 "—" 만 보임 | data.json 이 아직 비어 있거나 fetch 실패. Actions 한 번 수동 실행 또는 정적 서버로 띄워 확인. |
| 카드 상단 "동기화 실패" | 해당 대시보드의 DOM 구조가 바뀌었을 수 있음. `scripts/update-dashboard.js` 의 정규식 패턴을 갱신. |
| iframe 빈 화면 | 원본 대시보드가 `X-Frame-Options: DENY` 를 보내면 임베드 차단됨. 카드 우측 하단 "새 창에서" 링크로 대체. |
| Actions 가 실행 안 됨 | 레포가 60일 비활성이면 schedule cron 이 자동 꺼짐. Actions 탭에서 다시 활성화 버튼 클릭. |
| 커밋 권한 오류 | Settings → Actions → General → Workflow permissions = "Read and write" 확인. |

## 라이선스 / 내부용

파마브로스 · 미래사업본부 내부용. 외부 배포 금지.
