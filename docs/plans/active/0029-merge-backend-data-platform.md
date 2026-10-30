# BE·DB·DevOps 통합 브랜치와 FE 브랜치 합치기

- 상태: in_progress (10/15 PR #48, 10/21 PR #60으로 FE → develop(#60에는 10/15 BE 코드도 함께). 10/21 BE 브랜치가 develop을 받았고(`d87d497`), FE는 V3 `feature/frontend-features-and-integrationV3`에 BE 브랜치를 받아(`ed7f953`) 작업. 남은 것: BE 브랜치가 develop에 들어오기(겹치는 파일 `docs/index.md` 하나))
- 담당: FE(klaod-tech)가 계획·문서 충돌 정리, 실시간·REST 맞추기는 BE와 함께
- 시작일: 2026-10-14
- 대상: `feature/frontend-features-and-integration`(우리) ← `feat/backend-data-platform-architecture`(BE·DB·DevOps)
- 관련: [연동 명세](../../design/api-ws-spec.md), [FE 제안서](../../design/fe-server-proposal.md), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md),
  [ADR 0024 연결이 끊기면 세션 종료](../../decisions/0024-session-ends-on-lost-connection.md), [계획 0023](0023-frontend-server-only.md), [계획 0030](0030-make-check-failures.md)

## 문제와 완료 기준

BE 브랜치에는 백엔드 재작성(단일 API, DB V2.3), Java 17·Spring Boot 4·Gradle 전환, DevOps 플랫폼이 들어 있다.
FE 브랜치에는 연동 명세·WebSocket v2 계약·가입 화면 변경이 있다. 두 쪽이 API·WS를 서로 다르게 전제하고 있어,
글자 충돌보다 **내용 충돌**(경로·계약·문서 번호)이 더 크다.

완료 기준:

- 문서 9개 충돌을 풀고, 같은 번호의 ADR·계획이 남지 않는다.
- 실시간 경로는 `/v2/realtime`으로 정해졌다(10/15, Q1). 합친 뒤 연동 명세·계약 README·ADR에 v2 하나로 적혀 있다.
- 합친 뒤 `check-repo`, `test`, `check-frontend`, `check-backend`(Gradle)를 돌리고 결과를 아래에 기록한다.

## 범위와 제외

- 바꾸는 것: 충돌 난 공용 문서, FE 문서·계약, 번호가 겹친 ADR·계획 정리.
- BE·DB·DevOps 코드(`backend/`, `platform/`, `database/`, `infra/`)는 BE 쪽 내용을 그대로 받는다. 고칠 일이 생기면 BE에 요청한다.
- 계정 서버 연결(F12)은 BE 담당이다(BE 계획 0027과 같은 일). 합칠 때 BE 쪽 내용을 살린다.
- 기록·달력 화면은 lellon0403 담당이라 이 계획에서 건드리지 않는다.

## 미리 합쳐 본 결과 (2026-10-14, `git merge-tree`, 작업 폴더 변경 없음)

- 공통 조상: `953e11e`(PR #45). 그 뒤 우리 30커밋·61파일(`docs/`·`contracts/`·`frontend/`), BE 36커밋·328파일(`backend/`·`platform/`·`tools/`).
- BE의 「프론트·model 코드를 develop 기준으로 되돌림」(`ff2314d`)은 공통 조상보다 앞이라 우리 프론트 코드와 충돌하지 않는다.

### 글자 충돌 (문서 9개)

| 파일 | 종류 | 푸는 원칙 |
|---|---|---|
| `README.md` | 내용 | 두 쪽을 합친다. 빌드 도구·실행법은 BE(Gradle), FE 안내는 우리 |
| `contracts/README.md` | 내용 | 두 쪽 계약 목록을 합친다(BE `accounts.v2.md`·`consent-documents.v2.md` + 우리 WebSocket v2) |
| `contracts/realtime/README.md` | 내용 | v2가 현재라고 적는다(Q1, 10/15). v1 부분은 BE가 v2로 바꾸면 지운다 |
| `docs/architecture.md` | 내용 | 서버 구조는 BE, 앱이 보내는 것·판정은 서버가 한다는 부분은 우리(ADR 0021) |
| `docs/code-structure.md` | 내용 | `backend/` 구조는 BE, `frontend/` 구조는 우리 |
| `docs/design/fe-commands-and-checks.md` | 내용 | 우리 것을 기준으로, BE가 바꾼 빌드 도구(JDK 17·Gradle Wrapper) 내용을 반영 |
| `docs/index.md` | 내용 | 두 쪽을 합친다. FE 절은 우리, 계획·ADR 목록은 번호 정리 뒤 기준 |
| `docs/design/fe-server-integration-map.md` | 우리가 지움 / BE가 고침 | 지운 채로 둔다. BE가 고친 문구(JDK 17·Gradle, ADR 0023 링크)는 [FE 명령과 검사(지움)](../../removed-docs.md)에 옮긴다 |
| `docs/plans/active/0022-kafka-realtime-pipeline.md` | 우리가 지움 / BE가 고침 | 지운 채로 둔다. BE가 더한 기록(ADR 0020, `/v1/realtime` 유지)과 Gradle 문구는 [지운 문서 기록](../../removed-docs.md)에 남긴다. BE가 이 계획을 계속 쓴다면 되살린다 |

### 내용 충돌 (글자 충돌로 안 잡힘)

| # | 항목 | 우리 | BE 브랜치 |
|---|---|---|---|
| 1 | 실시간 WS | `/v2/realtime` 좌표 스트림(ADR 0021, [계약 v2](../../../contracts/realtime/realtime-ws.v2.schema.json)) | `/v1/realtime`만 있음. BE ADR 0022는 「특징 v2·실시간 v1 유지, 좌표 스트림 제외」 |
| 2 | REST 빠진 것 | R1b `GET /v2/records/{id}`, T1 `GET /v2/stats/daily`, `closed(limit_reached)` (`RECORD_ARCHIVED`는 10/15 BE의 409 `CONFLICT`에 맞춤) | 없음 |
| 3 | REST 남은 것 | `POST /v2/records`는 없애기로 함 | 아직 있음 |
| 4 | ADR 번호 | ~~`0022-session-ends-on-lost-connection`~~ → **10/15 해결: FE가 0024로 옮겼다**(`0024-session-ends-on-lost-connection`) | `0022-db-v23-feature-v2-integration` 그대로 |
| 5 | 계획 번호·내용 | ~~`0028-backend-build-gradle`~~ → **10/15 해결:** 전환 부분을 빼고 [0030](0030-make-check-failures.md)(`make check` 실패 원인·G1~G5)으로 옮겼다 | `0028-backend-java17-boot4-gradle`(이미 전환, ADR 0023) |

### BE 브랜치 문서와 FE 설계의 차이 (10/15 확인)

BE 브랜치의 `docs/design/` 중 우리 파일(`fe-server-proposal`·`api-ws-spec`·`consent-proposal` 등)은 BE가 고치지 않은 공통 조상(10/14 오전) 판이다. 합치면 우리 최신판이 그대로 들어간다(`fe-commands-and-checks`만 양쪽이 고쳐 충돌).
우리가 지운 `frontend-platform-seams`·`setup-framing-and-pause-display`·`unmeasurable-handling`은 BE가 고치지 않아 합치면 지워진다.

BE가 쓴 문서(`contracts/accounts.v2.md`, BE ADR 0020·0022, BE 계획 0027, BE가 고친 `docs/architecture.md`)는 「서버를 먼저 돌려 보려고 섞은 v1」 기준이라 FE 설계와 다르다. BE가 v2로 간다고 확인했으므로(10/15) 질문하지 않고, 합칠 때 아래처럼 정리한다.

| # | 항목 | BE 문서 | FE 설계(기준) | 합칠 때 |
|---|---|---|---|---|
| D1 | 측정 중 전송 | 특징 변화량(입력 v2)을 `/v1/realtime`·`POST /sessions/{id}/features`로 | 관절 좌표 프레임(`posture.frames.v1`)을 `/v2/realtime`으로(ADR 0021) | v2. BE ADR·`accounts.v2.md` 89행·`architecture.md` 머리말에 「임시, v2로 간다」 |
| D2 | 자세 등록 | 앱이 관절 9개 평균 좌표를 계산해 `POST /v2/baselines`(표본 20개·3,000ms 이상), 앱이 저장된 좌표로 기준 특징을 다시 만든다(계획 0027 1·4, `accounts.v2.md` 77행) | 앱은 WS `purpose:"calibration"`으로 프레임만 보내고 서버가 `calibration_result`로 등록한다. 앱은 평균·기준 특징을 계산하지 않는다(연동 명세 5·6.2, BE 명세 10/13에도 있음) | ~~v2~~ **10/20 전체 회의로 바뀜: 앱이 관절 9개 3초 평균을 내서 B1로 보낸다**(FE 제안서 3.3, 10/21 V3에서 연결). 앱의 평균은 프레임 수로 나눈 단순 평균이다 |
| D3 | 기록 저장 | 앱이 `POST /records`로 기록을 보냄 | 서버가 측정 종료 때 저장, 앱은 안 부름 | FE 제안서 1장 B-1 |
| D4 | 가입 규칙 표(계획 0027 3절) | 「지금 프론트」를 문서 버전 `terms-2026-10`, 이름 50자, 나이 1~120 등으로 적음 | 10/13~14에 이미 `service-v2`, `[{type,document_version}]`, 이름 30자, 나이 14~120, 72바이트로 맞춤. 남은 것은 12자 검사(서버 연결 때) | 표를 「끝남」으로 |
| D5 | 담당 | 계획 0027 「담당 미정」에 계정(2·3절)과 세션·등록 전송(1·4·5절)이 함께 있음 | 계정 연결(F12)은 BE, 서버로 보내는 처리·등록 전송(F1~F3)은 FE | 0027을 둘로 나눠 적도록 알린다 |
| D6 | 개발 프록시(0027 7절) | Vite `/api` 프록시 `ws: true`로 `/v1/realtime` | `/api/v2/realtime`(연동 명세 1장) | 경로만 v2로 |
| D7 | 구형 `check-browser`(0027 8절) | 당시 `run_browser()`의 임시 MySQL·v1 세션 불일치 | [계획 0030](0030-make-check-failures.md)의 복구 과제는 도구 삭제로 폐기됨 | 구형 게이트 복원·원인 추가 과제 없음. 현재 기본 검사와 명시적 연결 점검은 [품질 기준](../../quality.md)을 따름 |
| D8 | 링크 | 계획 0027·`architecture.md`가 우리가 지운 `fe-server-integration-map.md`를 가리킴 | — | 합친 뒤 `check-repo`가 잡는다. [연동 명세](../../design/api-ws-spec.md)로 바꾼다 |
| D9 | DB 판 | `architecture.md` 「저장은 DB 스키마 V2.0」 | V2.3 | V2.3으로 |

같은 것: 세션 생성 본문 `{policy, baseline_id}`, 조회 `SessionView`, 계정·동의·설정 API(연동 명세 0.6), 가입 입력 규칙(이름 1~30자, 나이 14~120, 비밀번호 12~72)은 서버 검사(`AccountContracts`)와 앱이 같다.

## BE에 확인할 것 (merge 전, 합의와 BE 코드가 다른 것만)

| # | 질문 | 우리 제안 |
|---|---|---|
| Q1 | 실시간 경로 | **10/15 확정: `/v2/realtime`(좌표 스트림).** BE 브랜치의 `/v1/realtime`과 BE ADR 0022의 「좌표 스트림 제외」는 서버를 먼저 돌려 보려고 섞어 둔 임시 상태(BE 답) |
| Q2 | R1b·T1·`limit_reached`를 언제 넣는가 (10/15: R1b·T1은 연동 명세 4.5대로 다음 주 범위, `limit_reached`는 v2와 함께) | 연동 명세 4장·5장 그대로 |
| Q3 | `POST /v2/records`를 없애는가 (10/15: v2에서 앱이 부르지 않으므로 v1과 함께 정리) | 없앤다(BE 명세에서 없앤 것과 같게) |

## 작업 단계

- [x] 1. BE에 Q1을 확인했다(10/15, `/v2/realtime`). Q2·Q3은 합의대로 BE가 진행한다([FE 제안서](../../design/fe-server-proposal.md) 1장 B-1·B-2).
- [x] 2. merge 전에 우리 쪽 정리: 계획 0028을 0030으로 옮기고 Gradle 전환 부분을 뺐다(10/15). FE ADR 0022(끊기면 세션 종료)를 0024로 옮겨 BE ADR 0022와 겹치지 않게 했다(10/15). BE는 번호를 바꾸지 않아도 된다.
- [x] 3. FE 브랜치 → develop PR #48(10/15 merge).
- [x] 4. BE 브랜치가 develop을 받아 충돌을 풀었다(`b0140ca`, 10/15). 팀장과 함께 쓸모없는 문서를 지웠다.
- [x] 5. 합친 뒤 `check-repo` 통과(10/16 FE가 끊긴 링크 5개를 고침: `docs/index.md` 4개, BE 계획 0027 1개(D8)). 10/19 V2 브랜치에서 `check-repo`·`check-frontend`(시험 347개, 타입 검사, 빌드) 통과.
- [ ] 6. BE 작업이 끝나 BE 브랜치가 develop에 들어오면 우리 브랜치도 develop을 받는다(JDK 17·Gradle, 연동 명세·계약은 그때 서버 코드와 한 번 더 대조).
- [ ] 7. 끝나면 이 계획을 지우고 [지운 문서 기록](../../removed-docs.md)에 남긴다.

## 결정과 진행 기록

- 2026-10-21: V2 브랜치를 PR #60(merge commit `11126de`)으로 develop에 넣었다. 10/15 BE 코드가 함께 들어갔다. 같은 날 BE 브랜치가 develop을 받았고(`d87d497`), FE는 새 브랜치 V3에 BE 브랜치를 받아(`ed7f953`, 충돌 없음) v2 작업을 한다. 로그인·가입 `/v2/auth` 연결은 BE가 한다(DevOps 답 10/21).

- 2026-10-14: 미리 합쳐 보기로 충돌 범위를 확인했다(위 표). 계정 서버 연결(F12)은 BE 담당으로 정정했다.
- 2026-10-15: 번호 겹침(4·5)은 물어보지 않고 FE가 정리하기로 했다. BE에 확인할 것은 합의와 BE 코드가 다른 Q1~Q3만 남겼다.
- 2026-10-19: BE 브랜치가 `/v2/realtime`·nginx `/api/v2/realtime`·`posture.alerts.v1`을 넣었다(`a0d99a3`, 10/17~18). Q1·Q2의 `limit_reached`는 끝났다. 우리 브랜치에 미리 합쳐 보면(`git merge-tree`) 글자 충돌은 `docs/index.md` 하나다. 앱 코드는 아직 v1이다(D1·D6, FE 제안서 7.1). 6단계(BE 브랜치 받기)는 아직 하지 않았다.
- 2026-10-15: BE 답 — 실시간은 `/v2/realtime`. 지금 BE 브랜치의 v1은 서버를 먼저 돌려 보려고 섞인 임시 상태다.
- 2026-10-16: jisung 브랜치(`feature/repo-jisung-local-forecast`, 10/15 BE 브랜치를 받음 `69ffc44`)와 미리 합쳐 봤다. 글자 충돌은 같은 낡은 문구를 둘이 따로 고친 3곳(`contracts/README.md`, `docs/index.md`, BE 계획 0027 링크)뿐이다. 번호는 jisung의 ADR 0020~0038·완료 계획 0023~0051이 기존 번호와 겹친다(jisung 브랜치 안에서만). 큰 변경이 아니라서 jisung 브랜치를 합칠 때 조율한다.
- 2026-10-16: 합친 결과를 확인했다. 지워진 파일은 develop 쪽 예전 백엔드(Maven·CEP 모듈)와 FE가 지운 문서 6개·ADR 번호 이동(0022 → 0024)뿐이다. 탈퇴 철회(A8)가 없어진 것을 FE 문서에 반영했다(연동 명세 0.7). FE 문서에서 Java 21·Maven 문구를 지웠다(빌드는 BE 설정을 따른다).
- 2026-10-15: 합치는 방향을 바꿨다. BE 브랜치 문서에 예전 FE 문서와 v1 임시 내용이 섞여 팀원이 헷갈리므로, FE 최신 문서를 develop에 먼저 넣는다. 번호 겹침(ADR 0022, 계획 0028)과 `requirements-front.txt` 충돌은 FE가 미리 없앴다. 남은 글자 충돌 9개는 BE 코드(Gradle·단일 API·`accounts.v2.md`·ADR 0020·0023)를 설명하는 문장이라 그 코드가 develop에 없는 지금은 미리 풀 수 없다(미리 넣으면 develop 문서가 없는 파일을 가리켜 `check-repo`가 실패한다).
- 2026-10-15: BE 브랜치 문서와 FE 설계의 차이 D1~D9를 정리했다. 모두 v1 임시 상태에서 온 것이라 질문하지 않고 합칠 때 정리한다.
- 2026-10-15: 합치는 시점 — BE가 그 브랜치에서 작업을 끝낸 뒤 합친다. 그때까지 FE는 우리 브랜치에 계속 push하고 결정·작업을 문서에 적는다. 3단계 직전에 `git fetch`와 미리 합쳐 보기를 다시 해 위 충돌 표를 새로 만든다.

## 검증 결과와 남은 한계

- 실행: `git merge-tree --write-tree HEAD origin/feat/backend-data-platform-architecture`(충돌 목록만, 작업 폴더 변경 없음), BE 브랜치 컨트롤러의 경로를 `git grep`으로 확인.
- 10/15 PR #48로 합쳤다(3·4단계). 남은 것은 6단계(BE 브랜치가 develop에 들어온 뒤 우리 브랜치가 develop 받기)와 그 뒤 검사다.
- 한계: BE 브랜치는 계속 바뀌고 있다. 3단계 직전에 `git fetch` 후 미리 합쳐 보기를 다시 한다.
