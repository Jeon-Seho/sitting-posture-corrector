# FE 작업 명령과 검사

> 작성자: klaod-tech(FE) · 작성: 2026-10-12 · 최신화: 2026-10-26(WS 계약 시험 `tests/test_realtime_ws_v2.py`는 `python tools/dev.py setup`으로 만든 `.venv`에서 통과 — 같은 `dev.py test`의 `test_deploy_configuration` 3개는 Docker가 없어 오류) · 2026-10-25(브랜치 이름 V3로, 지운 `referenceRuleCases` 명령 삭제, CEP·`schema_V1_1.sql` 문구 정리) · 2026-10-21(브랜치 V3) · FE(`feature/frontend-features-and-integrationV3`). 공통 개발 흐름은 [개발 흐름](../development.md)과 [품질 기준](../quality.md)을 따른다.
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
python tools/dev.py test              # Python 시험 전체
python tools/dev.py check-frontend    # 프론트 시험 → 타입 검사 → 빌드
npm --prefix frontend run typecheck   # 타입 검사만 (2026-10-29 추가)
npm --prefix frontend run lint        # 프론트·브라우저 prototype 코드 스타일 (2026-10-29 추가)
python tools/dev.py check-backend     # Java 기본 시험·Checkstyle·빌드 (JDK 17·21, Gradle Wrapper 사용)
python tools/dev.py check             # Python·프론트·백엔드 기본 검사

# Python 부분 시험 (빠른 확인)
.venv/Scripts/python.exe -m unittest tests.test_inference_v2
.venv/Scripts/python.exe -m unittest tests.test_dataset_preparation

# 프론트 부분 검사 (frontend 폴더에서)
cd frontend
npx vitest run <파일 이름>            # 바꾼 파일의 시험만
npx tsc -b                            # 타입 오류만
cd ..

# 2026-10-29 추가: 필요한 기능만 수동 확인 (저장소 루트에서)
node tools/browser/appearance.mjs <Vite URL> "<Chrome 경로>" "<캡처 폴더>"
node tools/browser/jwt-integration.mjs <Vite URL> "<Chrome 경로>"
# 시험 API·DB와 연결한 browser-smoke Vite, 시험 계정 환경변수 준비
node tools/browser/midnight.mjs <browser-smoke Vite URL> "<Chrome 경로>" "<캡처 폴더>"

# 가짜 서버로 화면 보기 (frontend 폴더에서, 실제 BE·DB 없이 — 판정은 단순 규칙, 저장 없음)
node scripts/fake-server.mjs          # 127.0.0.1:8090(Vite /api 중계 기본 주소). 다른 터미널에서 npm run dev, 아무 이메일·비밀번호로 로그인
FAKE_ACCESS_SECONDS=120 node scripts/fake-server.mjs   # access 토큰 2분: 미리 갱신(A8)이 도는지 보기

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

2026-10-29 추가: 현재 프론트 검사는 `check-frontend`를 사용하고, FE PR CI는 `typecheck`·`lint`를 실행한다. `npm run check`에는 lint가 포함되지 않는다.

| 명령 | 검증하는 것 | 언제 |
|---|---|---|
| `python tools/dev.py check-frontend` | Vitest → Node 아이콘·콘솔 정책 단위 시험 → `tsc -b` → `vite build` | 프론트 코드를 고칠 때마다 |
| `python tools/dev.py test` | 남은 Python 시험(계약·v2 추론·인증·자료 준비·개인 학습·배포 보호). | Python·연구 도구를 바꿀 때와 기본 전체 검사 |
| `.venv/Scripts/python.exe -m unittest tests.test_inference_v2` | 추론 서비스 v2와 합성 계약 예제가 맞는지(빠른 부분 확인) | 판정 규칙이나 계약을 바꿨을 때 |
| `.venv/Scripts/python.exe -m unittest tests.test_dataset_preparation` | 자료 준비 도구가 예전 수집 CSV(v1·v2)를 그대로 읽는지(빠른 부분 확인) | 수집 CSV를 바꿨을 때 |
| `npm --prefix frontend run typecheck` | TypeScript 타입 검사(`tsc --noEmit`) | 타입 오류만 먼저 확인할 때 (2026-10-29 추가) |
| `npm --prefix frontend run lint` | `frontend/src`·`model/prototype`의 ESLint 검사 | 프론트·브라우저 prototype 코드를 바꿨을 때 (2026-10-29 추가) |

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

작업을 마칠 때는 돌린 명령과 못 돌린 명령(이유 포함)을 함께 보고한다.

## 검사별로 실제 확인하는 것 (2026-10-12 정리)

`make check`와 `check-local`은 Python 시험 → 프론트 시험·타입·빌드 → 백엔드 기본 검사를 실행한다. Windows는 `python tools/dev.py <대상>`.

현재 프론트 단계는 `npm run check`의 Vitest·Node 아이콘/콘솔 정책 단위 시험·TypeScript·Vite 빌드이며, 전체 저장소 검사의 현재 범위는 [개발 흐름](../development.md)·[품질 기준](../quality.md)을 따른다.

| # | 대상 | 실제로 실행하는 것 | 확인하는 것 | 필요한 것 |
|---|---|---|---|---|
| ② | `test` | `tests/`에서 Python `unittest` 발견 실행 | 남은 계약·프레임/실시간 예제, v2 추론·내부 인증, 자료 준비·개인 학습의 합성 시험, 배포 비밀값·백업·복원 보호. 구형 v1 전용·저장소·개발 프로세스 mock·benchmark 시험은 제외 | `.venv` |
| ③ | `check-frontend` | `npm run check` = Vitest → Node 단위 시험 → `tsc -b` → `vite build` | 프론트 단위·컴포넌트 시험, 아이콘·콘솔 정책 단위 시험, **타입 검사**, 배포 빌드. 실제 Chrome 실행은 별도 | Node 24 |
| ④ | `check-backend` | Gradle `build`(`backend/`) | Java 기본 시험·Checkstyle·빌드 | JDK 17·21 |

### 작업 종류별로 돌리는 검사

| 바꾼 것 | 최소로 돌리는 검사 |
|---|---|
| 문서만 | `git diff --check`와 변경한 로컬 링크 확인 |
| 프론트 코드 | ③, 화면 흐름이 바뀌면 아래 수동 점검 추가 |
| 판정 가능 프레임 검사(`model/prototype/pose.ts`) | ③. 앱의 판정 규칙과 `referenceRuleCases` 시험은 지웠다(10/21·10/22). 규칙이 바뀌면 서버 쪽 ② `tests.test_inference_v2` |
| 계약(`contracts/`) | ② ③ |
| 서버(`backend/`, `model/inference/`) | ② ④ |
| 계정·DB·배포 | [품질 기준](../quality.md)의 해당 범위 확인 |

2026-10-29 추가: 문서 변경은 `git diff --check`와 바뀐 링크를 확인한다. 테마·레이아웃 변경은 준비된 Vite·Chrome에서 `appearance.mjs`, 인증·프로필 연결 변경은 시험 API·DB·Vite·Chrome에서 `jwt-integration.mjs`를 별도로 실행한다. 두 브라우저 점검은 기본 검사·CI에 자동 연결하지 않는다.

자정 브라우저 검사는 준비된 시험 API·DB와 연결한 `browser-smoke` 모드 Vite, Chrome에서 `midnight.mjs`를 직접 실행한다([준비와 범위](../../frontend/README.md)). `POSEGOOD_MIDNIGHT_EMAIL`·`POSEGOOD_MIDNIGHT_PASSWORD`의 합성 시험 계정으로 실제 등록·측정·자정 전후 카메라 유지·날짜별 로컬 보관·R1 조회·오늘/달력 표시를 확인한다. 서버 시작 시각은 KST 자정 전 10초 이내로 준비하며 REST/WS 응답은 실제 서버가 제공한다. 서버의 자정 세션 전환은 별도 검증이다. 기본 검사·CI에 연결하지 않으며 계산의 세부 경계는 기존 FE 검사의 `dailyMeasurement.test.ts`가 확인한다.

### 이 저장소 검사로 잡지 못하는 것 (빈틈)

- **기본 자동 검사에서 제외한 범위:** 수집 화면의 폭별 배치·Chrome 영상 미리보기와 종료, 컨테이너 재생성 후 기록 보존·제공 자산 해시·실제 백업 복원은 기본 자동 검사에 없다. 수집 미리보기의 `tools/browser/camera-preview.mjs`는 보존했으며 수동 실행 진입점 연결과 새로고침 뒤 재로그인 보완이 남아 있다. 필요한 동작은 시험 환경에서 별도 확인한다. `console-policy` 단위 시험 성공도 실제 브라우저의 HTTP 응답·로그 개수 대조 성공을 뜻하지 않는다.
- **실제 카메라·MediaPipe 정확도:** 모든 자동 검사는 합성 입력이다. 실제 촬영(사람이 직접 찍은 csv 재생)으로만 확인한다.
- **문장 검사:** 오래된 설명(예: 없어진 기능을 설명하는 문서)은 자동 검사가 못 잡는다. 바꾼 기능 이름으로 `rg`를 돌려 직접 찾는다.
- **코드 스타일 검사(ESLint 등):** 프론트에 lint 단계가 없다. 타입 검사(`tsc -b`)만 있다.
  - 2026-10-29 추가: 현재는 `npm --prefix frontend run lint`와 FE PR CI의 lint 단계가 있다. 위 문장은 도입 전 기록이며, `check-frontend` 성공과 lint 성공은 구분한다.
- **데스크톱 패키지:** Electron EXE 검사(`node scripts/smoke-desktop.mjs`)는 `make check`에 없다. 패키징을 바꿀 때 따로 실행한다.
- **다른 팀 서버:** DevOps Kafka 경로·입출구 서버와의 실제 왕복은 이 저장소에 없다(T-13).

### 빌드 도구

백엔드 빌드는 BE가 정한 대로 따른다([ADR 0020](../decisions/0020-single-api-decision-engine.md) 1절, [BE 계획 0028](../plans/active/0028-backend-java17-boot4-gradle.md)). FE는 따로 설정하지 않는다.

### PC별 제약

2026-10-29 추가: 아래 항목은 해당 날짜 PC의 기록이다. 현재 프론트 개발은 Node.js 24 이상을 사용하며, `make`가 없는 Windows에서는 `python tools/dev.py check-frontend` 또는 `npm --prefix frontend run check`를 사용할 수 있다. 수동 브라우저 점검에는 해당 PC의 Chrome 경로를 지정한다.

- Windows 노트북: JDK 17(Temurin 17.0.20.1, 10/15 설치)이 있어 Gradle Wrapper가 찾아 쓴다. ②는 `test_deploy_configuration`의 Windows 제약 오류 3개가 원래 있다.
- Windows PC(10/11): Docker가 있다.
