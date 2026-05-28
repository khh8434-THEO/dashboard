# 미래사업본부 통합 대시보드

4개 대시보드(일간 실적 · 주간 Sync · 약사 VOC · 재고 관리)를 하나의 페이지에서 보고, 매일 오전 8시(KST) 핵심 지표를 자동으로 새로고침합니다.

## 디렉토리

```
.
├── index.html
├── data.json                          # GitHub Actions가 매일 자동 갱신
├── package.json
├── scripts/
│   └── update-dashboard.js            # Playwright 추출 스크립트
├── .github/
│   └── workflows/
│       └── update-dashboard.yml       # 매일 23:00 UTC (= 08:00 KST) cron
└── README.md
```

## 배포

1. 새 GitHub 레포 생성 (또는 기존 레포 사용)
2. 이 폴더의 **모든 파일**을 레포 루트에 push (.github 폴더 포함)
3. Settings → Pages → Source: main / root → 저장
4. Settings → Actions → General → Workflow permissions → **"Read and write permissions"** 체크 → 저장
5. (선택) Actions 탭 → "Update dashboard data" → Run workflow 로 첫 데이터 채우기

## cron

`.github/workflows/update-dashboard.yml`의 `0 23 * * *` = 매일 08:00 KST.
수정 시 `HH:MM UTC = HH+9:MM KST` 환산.

## 문제 해결

| 증상 | 해결 |
| --- | --- |
| 카드에 "—"만 보임 | data.json 비어있음. Actions 한 번 수동 실행 |
| "동기화 실패" 뱃지 | 해당 대시보드 DOM 변경 가능. `scripts/update-dashboard.js` 정규식 갱신 |
| iframe 빈 화면 | 원본이 X-Frame-Options 차단. "새 창에서" 링크 사용 |
| Actions 미실행 | 60일 비활성 시 cron 자동 정지. Actions 탭에서 재활성화 |
| 커밋 권한 오류 | Workflow permissions = "Read and write" 확인 |

파마브로스 · 미래사업본부 내부용
