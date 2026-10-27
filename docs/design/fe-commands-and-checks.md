# FE 작업 명령과 검사

> 작성자: klaod-tech(FE) · 작성: 2026-10-12 · 최신화: 2026-10-26(`check-browser`의 `camera-preview.mjs`에서 웹 작은 창 항목 정리, WS 계약 시험 `tests/test_realtime_ws_v2.py`는 `python tools/dev.py setup`으로 만든 `.venv`에서 통과 — 같은 `dev.py test`의 `test_deploy_configuration` 3개는 Docker가 없어 오류) · 2026-10-25(브랜치 이름 V3로, 지운 `referenceRuleCases` 명령 삭제, CEP·`schema_V1_1.sql` 문구 정리) · 2026-10-21(브랜치 V3, `check-browser`는 서버 전용 시나리오 필요) · FE(`feature/frontend-features-and-integrationV3`). 공통 개발 흐름은 [개발 흐름](../development.md)과 [품질 기준](../quality.md)을 따른다.
> 이 문서는 FE가 실제로 쓰는 명령과 각 검사가 확인하는 것을 모은 것이다. 직접 설치할 프로그램은 [requirements-front.txt](../../requirements-front.txt).

## 명령 모음 (복사해서 쓰기)

저장소 루트에서 실행한다. `make`가 있으면 `python tools/dev.py <대상>` 대신 `make <대상>`을 써도 같다. 설명은 바로 아래 절.

```sh
# 다른 PC 작업 받기 (10/21부터 작업 브랜치 V3)
git fetch origin
git log --oneline HEAD..origin/feature/frontend-features-and-integrationV3
git merge --ff-only origin/feature/frontend-features-and-integrationV3
git log --oneline HEAD..origin/develop     # develop에 새로 들어온 것(받을 때는 git merge origin/develop)

# 바뀐 파일 확인 (.vscode/는 커밋하지 않는다)
git status --short
git diff --stat

# 자동 검사
python tools/dev.py check-repo        # 문서 링크·금지 파일
python tools/dev.py test              # Python 시험 전체
python tools/dev.py check-frontend    # 프론트 시험 → 타입 검사 → 빌드
python tools/dev.py check-browser     # 실제 Chrome 합성 흐름 (약 75개)
python tools/dev.py check-backend     # Java 서버 시험 (JDK 17 필요, Gradle Wrapper 사용)
python tools/dev.py check-compose     # Docker·MySQL 계정·영구 저장 (Docker 필요)
python tools/dev.py check             # 위 전체

# Python 부분 시험 (빠른 확인)
.venv/Scripts/python.exe -m unittest tests.test_inference_v2
.venv/Scripts/python.exe -m unittest tests.test_dataset_preparation

# 프론트 부분 검사 (frontend 폴더에서)
cd frontend
npx vitest run <파일 이름>            # 바꾼 파일의 시험만
npx tsc -b                            # 타입 오류만
cd ..

# 데스크톱 앱 (frontend 폴더에서, 창·팝업 구조는 FE 제안서 8.4)
npm run desktop                       # 개발 서버(5174)를 띄우고 Electron 창. 창을 닫으면 서버도 끈다
npm run desktop:dev                   # 이미 켜 둔 개발 서버(5173)에 창만 붙인다
npm run dev                           # 브라우저로 같은 화면
npm run desktop:pack                  # 실행 파일 다시 만들기(아이콘을 바꾼 뒤 등)
POSEGOOD_DEBUG_PORT=9333 npm run desktop   # 개발 실행에서만 127.0.0.1 CDP 포트(화면 자동 점검)

# Vercel 배포 갱신 (포크 klaod-tech/sitting-posture-corrector, 원격 이름 fork, 배포 4장 1단계)
git remote add fork https://github.com/klaod-tech/sitting-posture-corrector.git   # 처음 한 번
git fetch origin && git push fork origin/develop:develop   # 원래 저장소 develop → 포크 develop(Vercel 운영)

# 남은 옛 이름 찾기 / 팀 브랜치 원본 읽기
grep -rn "<단어>" docs frontend/src
git show origin/<브랜치>:<파일 경로>
```

직접 설치해야 하는 프로그램(JDK 17, Chrome, Docker 등)과 환경변수는 [requirements-front.txt](../../requirements-front.txt)에 모아 둔다.
Git Bash에서 한글 출력이 깨지면 앞에 `PYTHONIOENCODING=utf-8`을 붙인다.

## 지금 실제로 쓰는 명령과 검증 (2026-10-12, Windows 노트북)

위 명령 모음의 설명이다. 각 검사가 안에서 무엇을 하는지는 아래 아래 「검사별로 실제 확인하는 것」을 본다.
화면 스크린샷과 실제 카메라 구동은 서버 연결 전까지 제외한다.

### 1. 자동 검사

| 명령 | 검증하는 것 | 언제 |
|---|---|---|
| `python tools/dev.py check-repo` | 문서 링크가 실제 파일을 가리키는지, 금지 파일(영상·자료·비밀값)이 없는지 | 문서를 고칠 때마다 |
| `python tools/dev.py check-frontend` | `vitest run`(프론트 시험) → `tsc -b`(타입 오류) → `vite build`(배포 빌드) | 프론트 코드를 고칠 때마다 |
| `python tools/dev.py check-browser` | 실제 Chrome에서 합성 입력으로 화면 흐름 약 75개 항목. 앱·API·추론을 띄운다(CEP는 10/22 PR #63으로 지워짐). 10/21 V3부터 서버 전용 시나리오로 다시 써야 한다(4번 표) | 화면 흐름이나 판정 규칙을 바꿨을 때 |
| `python tools/dev.py test` | Python 시험 전체(계약, 추론, 자료 준비 도구 등). `test_deploy_configuration`의 Windows 제약 오류 3개는 원래 난다 | 매 작업 끝(관련 모듈만 고르지 않는다) |
| `.venv/Scripts/python.exe -m unittest tests.test_inference_v2` | 추론 서비스 v2와 합성 계약 예제가 맞는지(빠른 부분 확인) | 판정 규칙이나 계약을 바꿨을 때 |
| `.venv/Scripts/python.exe -m unittest tests.test_dataset_preparation` | 자료 준비 도구가 예전 수집 CSV(v1·v2)를 그대로 읽는지(빠른 부분 확인) | 수집 CSV를 바꿨을 때 |

### 2. 빠른 부분 검사 (`frontend`에서)

| 명령 | 검증하는 것 |
|---|---|
| `npx vitest run <파일>` | 바꾼 파일의 시험만 먼저 확인한다 |
| `npx tsc -b` | 코드를 고친 직후 타입 오류만 확인한다 |

### 3. 검사 외 확인 명령

| 명령 | 목적 |
|---|---|
| `git status --short`, `git diff --stat` | 바뀐 파일이 의도한 것뿐인지 확인한다. `.vscode/`는 커밋하지 않는다 |
| `git fetch` 후 `git log HEAD..origin/feature/frontend-features-and-integrationV3` | 다른 PC에서 올린 커밋이 있는지 확인한다 |
| `git merge --ff-only origin/feature/frontend-features-and-integrationV3` | 충돌 없이 받을 수 있을 때만 원격 브랜치를 받는다 |
| `grep -rn "<단어>"` (또는 `rg`) | 없어진 기능 이름이 남은 문서·코드를 찾는다(자동 검사가 못 잡는 오래된 설명) |
| `git show <브랜치>:<파일>` | 팀 브랜치(DB 스키마, 팀 API 계약)를 받지 않고 원본 그대로 읽는다 |

### 4. 지금 못 돌리는 것

| 명령 | 이유 |
|---|---|
| `python tools/dev.py check-compose` | 10/13~ DB 초기화 스크립트가 지워진 `schema_V1_1.sql`을 찾아 실패했다. 10/25 기준 그 참조는 `infra`·`tools`·`database`에 없다. 계정 브라우저 시나리오(⑥)가 깨진 것은 그대로라 다시 돌려 확인해야 한다 |
| `python tools/dev.py check` | 위 때문에 전체를 한 번에 돌릴 수 없다 |
| `python tools/dev.py check-browser` | 10/14부터 첫 단계에서 실패한다. 수집 화면의 `<select id="capture-task">`가 `SelectMenu`로 바뀌었는데(`9f3bc92`) `camera-preview.mjs`가 아직 `options`를 읽는다. 그 뒤에도 "first episode confirms at exactly 3 seconds"(원인 미확인)와 재연결 항목(ADR 0024)을 고쳐야 한다(계획 0030 G1~G3). **10/21 V3:** 앱이 서버 전용이 되어 시나리오의 로컬 측정·「서버 판정 사용」·이어하기가 없어졌다. 가짜 서버나 8088 환경으로 다시 써야 한다(G6). **10/26:** 웹 작은 창을 지워(ADR 0028) `camera-preview.mjs`의 떠 있는 창·문서 PiP 항목을 「작은 창 없음·카메라 끄기」 확인으로 바꿨다(앞의 `options` 문제는 그대로) |

정리: 프론트·문서·Python·Java 서버는 매번 검증하고, 브라우저 흐름과 실제 DB(Compose)는 지금 검증하지 못한다.
작업을 마칠 때는 돌린 명령과 못 돌린 명령(이유 포함)을 함께 보고한다.

## 검사별로 실제 확인하는 것 (2026-10-12 정리)

`make check` = `check-local`(①~⑤) + `check-compose`(⑥). Windows는 `python tools/dev.py <대상>`.

| # | 대상 | 실제로 실행하는 것 | 확인하는 것 | 필요한 것 |
|---|---|---|---|---|
| ① | `check-repo` | `tools/check_repository.py` | 저장소 구조, **Markdown 상대 링크가 실제 파일을 가리키는지**, 영상·자료·비밀값 같은 금지 파일 경로가 없는지 | Python만 |
| ② | `test` | `tests/`의 Python `unittest` 전체(18개 파일) | 계약 JSON 스키마·예제(`contracts/`, 실시간 WebSocket v2 포함), 추론 서비스(v1·v2, 내부 인증, 오류 응답), 실시간 계약, 자료 준비·개인 학습 도구(합성 자료), 배포 설정, 서버 개발 도구, 저장소 검사 도구 | `.venv` |
| ③ | `check-frontend` | `npm run check` = `vitest run` → `tsc -b` → `vite build` | 프론트 단위·컴포넌트 시험(화면 흐름·판정 가능 프레임 검사·저장·가짜 서버로 측정·등록·계정. 앱 판정 규칙 시험은 10/21 지움), **타입 검사**, 배포 빌드 | Node 24 |
| ④ | `check-backend` | Gradle `build`(`backend/`) → 실제 MySQL 통합 시험 → `tools/service_smoke.py` | Java API·판정 엔진 시험, 실제 MySQL 저장, 실제 API→추론 HTTP 왕복(합성) | JDK 17, MySQL 또는 Docker |
| ⑤ | `check-browser` | `tools/browser_smoke.py` → `tools/browser/scenarios.mjs` | 실제 Chrome(독립 임시 프로필)으로 앱을 열어 **합성 입력**으로 자세 등록 → 측정 → 사건 확정 시각·복귀·재연결·새로고침 복구·기록 화면·탈퇴 확인창(키보드 초점) 등 약 75개 항목. 실제 카메라는 쓰지 않음 | ④의 JAR, Chrome |
| ⑥ | `check-compose` | `tools/compose_smoke.py` | 격리된 실제 Docker Compose(MySQL 포함)로 계정 가입·로그인·영구 저장·재시작 후 복구·백업 복원, **계정 브라우저 시나리오**(`tools/browser/accounts.mjs`) | Docker 실행 중. **2026-10-13부터 계정 브라우저 시나리오는 깨진다**: 프론트 계정 모드(`VITE_SERVER_ACCOUNTS`)를 지웠다. Compose·Dockerfile·`compose_smoke.py`·`account_browser_smoke.*`는 다른 팀원 파일이라 그대로 두었다 |

### 작업 종류별로 돌리는 검사

| 바꾼 것 | 최소로 돌리는 검사 |
|---|---|
| 문서만 | ① (링크 확인) |
| 프론트 코드 | ① ③, 화면 흐름이 바뀌면 ⑤ |
| 판정 가능 프레임 검사(`model/prototype/pose.ts`) | ③. 앱의 판정 규칙과 `referenceRuleCases` 시험은 지웠다(10/21·10/22). 규칙이 바뀌면 서버 쪽 ② `tests.test_inference_v2` |
| 계약(`contracts/`) | ① ② ③ |
| 서버(`backend/`, `model/inference/`) | ② ④ ⑤ |
| 계정·DB·배포 | ⑥ |

### 이 저장소 검사로 잡지 못하는 것 (빈틈)

- **실제 카메라·MediaPipe 정확도:** 모든 자동 검사는 합성 입력이다. 실제 촬영(사람이 직접 찍은 csv 재생)으로만 확인한다.
- **문장 검사:** 오래된 설명(예: 없어진 기능을 설명하는 문서)은 ①이 못 잡는다. 바꾼 기능 이름으로 `rg`를 돌려 직접 찾는다.
- **코드 스타일 검사(ESLint 등):** 프론트에 lint 단계가 없다. 타입 검사(`tsc -b`)만 있다.
- **데스크톱 패키지:** Electron EXE 검사(`node scripts/smoke-desktop.mjs`)는 `make check`에 없다. 패키징을 바꿀 때 따로 실행한다.
- **다른 팀 서버:** DevOps Kafka 경로·입출구 서버와의 실제 왕복은 이 저장소에 없다(T-13).

### 빌드 도구

백엔드 빌드는 BE가 정한 대로 따른다([ADR 0020](../decisions/0020-single-api-decision-engine.md) 1절, [BE 계획 0028](../plans/active/0028-backend-java17-boot4-gradle.md)). FE는 따로 설정하지 않는다. Compose 이미지·CI 반영 전까지 `check-compose`는 실패한다(BE 계획 0028). `make check` 실패 원인은 [계획 0030](../plans/active/0030-make-check-failures.md).

### PC별 제약

- Windows 노트북: JDK 17(Temurin 17.0.20.1, 10/15 설치)이 있어 Gradle Wrapper가 찾아 쓴다. ②는 `test_deploy_configuration`의 Windows 제약 오류 3개가 원래 있다.
- Windows PC(10/11): Docker가 있다.
- ⑥은 DB 초기화 스크립트(`infra/mysql/initdb/10-posegood-schema.sh`)가 지워진 `schema_V1_1.sql`을 찾아 실패한다(10/14에도 `database/schema`에는 V2_2·V2_3만 있음, `develop`도 같음). DB 담당 브랜치가 들어오기 전까지 실패한다.
