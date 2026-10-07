# lee 브랜치 변경 사항 정리

- 분야: 프론트
- 작업: GP-0042

브랜치별 변경 기록이다. 최신 브랜치를 위에 둔다. `lee_dev4`는 2026-10-05에 삭제했으며 내용은 `lee_app1`에 모두 들어 있다.

## lee_app1: jin_app과 develop 통합 (2026-10-05)

- 브랜치: `lee_app1` (개인 작업 브랜치, 열린 PR 없음). 나중에 develop으로 병합한다.
- 합친 두 브랜치: `jin_app`(`b1db41b`, 지성 백엔드 + 우진 데스크톱 앱, 태그 `v0.1.0-preview.20261002`)와
  `develop`(`213e441`, 유진 DB 스키마 V0.3, PR #8).
- 병합 커밋: `719e8c7`(jin_app + develop), `030b0a3`(그 결과 + 기존 lee_app1).

### 1. 두 브랜치에 없고 lee_app1에만 있는 것

| 내용 | 위치 | 비고 |
| --- | --- | --- |
| 새 Windows PC 설치 스크립트 | `tools/setup-windows.ps1` | Git·Node·Python 설치, 저장소, setup, 앱 바탕화면 바로가기. GP-0066 |
| DB 건의안 | `database/proposals/0001-v03-supplement.md` | V0.3 보완 마이그레이션 11개. 담당자에게는 디스코드로 전달. GP-0067 |
| DB 전환 계획 | `docs/plans/active/0021-db-schema-v03-alignment.md` | V1 → V0.3, 건의안 승인 대기. GP-0068 |
| Kafka 계획 | `docs/plans/active/0022-kafka-realtime-pipeline.md` | 프론트가 WebSocket 게이트웨이까지 담당. GP-0069 |

### 2. 충돌을 어떻게 정리했나

jin_app + develop은 `database/README.md` 하나, 그 결과 + lee_app1은 18개 파일이 충돌했다.

| 파일 | 선택 | 이유 |
| --- | --- | --- |
| `database/README.md` | develop 문서 + '현재 백엔드 코드와의 관계' 절 추가 | DB 기준을 V0.3으로 정함. 코드는 아직 V1 테이블 사용 |
| `frontend/electron/main.cjs`, `package.json`, lock | jin_app | 우진이 lee_app1의 Electron을 가져가 패키징·시작 프로그램까지 발전시킨 버전 |
| `src/ServiceApp.tsx` | jin_app(삭제, `src/app/`로 이동) | 지성의 구조 정리를 따름 |
| `pages/LoginPage.tsx`, `styles.css`, `DESIGN.md` | jin_app | 새 데스크톱 디자인 기준 |
| `pages/AuthPage.tsx`(로그인 미리보기, 소셜 버튼) | 삭제 | 새 디자인에서 쓰지 않음. 필요하면 커밋 `8aaac7a`에서 복원 |
| `tools/dev.py`, `Makefile`, `.gitignore` | jin_app 기반 개발 명령과 로컬 산출물 제외 | 제품 개발 흐름 유지 |
| `README.md`, `docs/architecture.md`, `frontend/README.md` 등 문서 | jin_app 본문 | 더 최신 |
| `docs/index.md`, `docs/quality.md` | 제품 문서와 검증 명령 | 최신 기준으로 유지 |
| `docs/team-requirements.md` | jin_app 본문 + lee_app1의 팀 기능 목록을 16절로 추가 | 제품 요구 보존 |

### 3. 이번에 정한 방향

- DB: 구조는 develop의 V0.3을 따른다. 빠진 부분은 기존 구현(V1)으로 채우도록 건의했다(운영 테이블, 동의 `service-v1`·학습용 선택 동의, 기록 원문, 나이·직업).
- 판정 정책 값: 어차피 교체할 값이므로 V0.3 시드 `DEFAULT_TEMP`(임계 0.5·3초·2초·재알림 30초)를 임시로 쓴다. 로컬 앱 기본값(0.7·60초)과는 아직 다르다.
- 시간 판정: 지금은 Esper CEP를 쓰고, 정상 동작이 확인된 뒤 v4의 상태 머신 서비스로 교체할지 정한다. 둘을 동시에 돌리지 않는다.
- 인증: JWT는 서버 발급·검증·만료·무효화가 필요하므로 서버 담당과 함께 진행한다. 그 전까지 기존 세션 쿠키를 유지한다.
- Kafka: jin_app 결정(변화량 3개만 전송, CEP 단일 판정)을 따른다. v4 초안과 다른 점은 계획 0022에서 팀 확인을 받는다.

### 4. 브랜치·PR 정리

- PR #7(`lee_app1` → develop)은 댓글 없이 닫았다. 개인 브랜치로 쓰며 건의안이 PR에 실리지 않게 하기 위해서다.
- `lee_app2`(통합 작업용)와 `lee_dev4`는 내용이 `lee_app1`에 들어 있어 삭제했다.
- develop에는 아직 Electron이 없다. jin_app 또는 lee_app1이 develop에 들어갈 때 함께 들어간다.
  그때 충돌은 `030b0a3`에서 이미 정리했다(develop이 그 사이 바뀌면 다시 맞춘다).

### 5. 검증 결과

- 저장소 구조·링크 검사 통과. 프론트 테스트 242개·타입 검사·빌드 통과.
- Python 152개 중 3개 오류: 배포 백업 테스트의 Windows 파일 잠금(`WinError 32`). jin_app에서도 같은 기존 문제다.
- 미실행: `check-backend`·`check-compose`·`check-browser`(이 PC에 Maven 없음, JDK 25, Docker 데몬 꺼짐). 서버 전체는 Docker만 있으면
  `python tools/compose_init.py` → `docker compose up -d --build --wait`로 띄울 수 있다(집에서 확인 예정).

## lee_dev4: main 대비 로직 정리 (2026-09-28)

- 작성: 2026-09-28
- 브랜치: `lee_dev4`. 기준은 `main`(PR #5, `jin_dev3` 반영).
- 원칙: `jin_dev3`의 화면 구성과 디자인은 그대로 두고, 로직과 사용자가 요청한 문구·버튼 정리만 반영했다.
- 상세 기록: [계획 0009](plans/completed/0009-service-logic-integration.md). 결정: [ADR 0009](decisions/0009-cross-platform-dev-entry.md), [ADR 0010](decisions/0010-record-comparison.md).

### 1. 화면에서 달라진 점

| 화면 | 변경 | 파일 |
| --- | --- | --- |
| 측정 준비 | `실제 웹캠 / 발표용 시연` 선택과 시연용 준비 화면을 제거했다. 새 측정은 항상 실제 웹캠이다. | `pages/SetupPage.tsx`, `ServiceApp.tsx` |
| 측정 준비 | 화면 위 안내 칸("내 기준 자세 등록: …", "현재 카메라 위치에 맞는 기준을 확인하세요.")을 제거했다. | `ServiceApp.tsx` |
| 자세 등록 | `카메라 · 기준 다시 준비`(측정 준비로 이동) 버튼 대신, 화면 안에 `카메라 켜기/끄기`와 `기준 자세 등록/다시 등록`(진행률 표시) 버튼을 두었다. 촬영 중에는 둘 다 비활성이다. | `pages/CollectionPage.tsx` |
| 대시보드(실제 기록) | `처음과 최근 비교` 표를 추가했다. 첫 측정일부터 7일과 최근 7일을 비교한다. 표 모양은 예시 대시보드와 같다. | `components/RecordComparison.tsx`, `lib/comparison.ts` |
| 홈·대시보드(실제 기록) | 실제 웹캠·합성 시연 기록을 구분 없이 합산해 보여 준다. 기록 줄마다 입력 종류를 표시한다. | `ServiceApp.tsx` |
| 프로필 설정 → 회원 탈퇴 | `탈퇴하기` → 동의 체크(선택) → `삭제하기` → 화면 중앙 확인 창 → `확인` 순서다. 동의 여부가 삭제를 막지 않는다. 안내 문구는 확인 창에만 나온다. 확인 창은 `취소`, 바깥 클릭, Esc로 닫힌다. | `ServiceApp.tsx`, `styles.css` |
| 설정 | 오른쪽 아래 "이 화면의 값은 이 브라우저에만 저장됩니다…" 칸을 제거했다. | `pages/SettingsPage.tsx` |
| 로그인 | 로그인 직후 "저장했습니다." 알림이 뜨지 않는다. 프로필 저장 시에만 뜬다. | `ServiceApp.tsx` |

`styles.css`에는 확인 창용 스타일 3줄(`.confirm-backdrop`, `.confirm-dialog`)만 추가했다. 기존 색 변수와 로그인 카드의 상단 굵은 선을 따랐다. `DashboardPage.tsx`는 비교 표를 재사용하려고 `CompareRow`, `Row`에 `export`만 붙였다.

### 2. 화면에 보이지 않는 로직

- **저장값 읽기 검증** (`lib/serviceStore.ts`): 브라우저에 저장된 프로필·기록·중간 저장·설정을 읽을 때 형식을 확인한다. 맞지 않는 기록은 버리고, 설정은 빠진 항목을 기본값으로 채운다. 지금은 더미 데이터 기준이라, 필드가 늘면 `parse*` 함수를 함께 고친다.
- **순수 함수 분리**: 프로필 검증(`validateProfile`), 중단된 측정을 기록으로 저장(`recordFromDraft`), 처음·최근 비교 계산(`compareFirstAndRecent`). 모두 단위 테스트가 있다.
- **제거한 것**: 측정 모드 기억(`posegood.v2.mode`). 시연 선택이 없어져 필요 없어졌다. 예전에 저장된 시연 기록과 중간 저장은 그대로 읽는다.

### 3. Windows 검증 명령

`make`가 없는 Windows에서도 같은 검증을 돌릴 수 있게 `tools/dev.py`를 추가했다. `Makefile`은 이 스크립트를 호출만 한다. CI와 `make check` 사용법은 그대로다.

```sh
python tools/dev.py setup   # 최초 1회
python tools/dev.py dev     # 개발 서버
python tools/dev.py check   # 저장소 검사 + Python 테스트 + 프론트 테스트·타입·빌드
```

### 4. 팀이 정해야 할 임시값

| 항목 | 현재 값 | 바꾸는 곳 |
| --- | --- | --- |
| 처음·최근 비교 구간 길이 | 7일 | `frontend/src/lib/comparison.ts`의 `COMPARE_RULES.days` |
| 비교에 필요한 구간당 최소 유효 측정 시간 | 30분(미만이면 "참고용" 표시) | `COMPARE_RULES.minValidSeconds` |

기록에 판정 규칙 버전이 저장되지 않는다. 판정 방식이 바뀌면 처음·최근 비교가 서로 다른 방식으로 계산되므로 버전 저장이 필요하다.

### 5. 검증 결과

- Windows 11에서 `python tools/dev.py check` 통과: 저장소 검사, Python 11개, 프론트 40개, 타입/빌드.
- 헤드리스 Edge와 가짜 카메라, 합성 더미 기록으로 각 변경을 확인했다. 기록 합산 값, 중단 측정 저장, 저장값 손상 처리, 비교 표의 상태 4가지, 자세 등록 카메라 버튼, 탈퇴 확인 창, 제거한 안내 칸을 확인했다. 콘솔 오류는 없었다.
- 이 브랜치를 `main`에 로컬로 시험 병합했을 때 충돌이 없었다(시연 선택 제거 이전 시점 기준).
- 미검증:
  - 실제 웹캠으로 기준 등록을 끝낸 뒤 측정·자세 촬영까지 가는 흐름
  - 소리 재생, 장시간 백그라운드
  - Linux의 `make` 경로와 Python 3.9 실행. CI에서 확인된다.

### 6. 남은 일

1. 예시 대시보드의 초기 구간 모델 버전 `lstm-v0.2.4`는 사실과 다르다. LSTM은 아직 연결되지 않았다. 디자인 담당과 표기를 정한다.
2. 대시보드 통계 칸에서 "4시간 46분"처럼 긴 값이 줄바꿈된다(디자인 영역).
3. 계정·서버가 연결되면 기록 집계 기준(사용자별, 시연 기록 포함 여부)과 저장값 검증 규칙을 다시 정한다.
