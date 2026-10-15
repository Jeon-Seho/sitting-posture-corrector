# BE·DB·DevOps 통합 브랜치와 FE 브랜치 합치기

- 상태: planned (실시간 v2 확정 10/15. BE가 그 브랜치에서 작업을 끝낸 뒤 합친다)
- 담당: FE(klaod-tech)가 계획·문서 충돌 정리, 실시간·REST 맞추기는 BE와 함께
- 시작일: 2026-10-14
- 대상: `feature/frontend-features-and-integration`(우리) ← `feat/backend-data-platform-architecture`(BE·DB·DevOps)
- 관련: [연동 명세](../../design/api-ws-spec.md), [FE 제안서](../../design/fe-server-proposal.md), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md),
  [ADR 0022 연결이 끊기면 세션 종료](../../decisions/0022-session-ends-on-lost-connection.md), [계획 0023](0023-frontend-server-only.md), [계획 0030](0030-make-check-failures.md)

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
| `docs/design/fe-server-integration-map.md` | 우리가 지움 / BE가 고침 | 지운 채로 둔다. BE가 고친 문구(JDK 17·Gradle, ADR 0023 링크)는 [FE 명령과 검사](../../design/fe-commands-and-checks.md)에 옮긴다 |
| `docs/plans/active/0022-kafka-realtime-pipeline.md` | 우리가 지움 / BE가 고침 | 지운 채로 둔다. BE가 더한 기록(ADR 0020, `/v1/realtime` 유지)과 Gradle 문구는 [지운 문서 기록](../../removed-docs.md)에 남긴다. BE가 이 계획을 계속 쓴다면 되살린다 |

### 내용 충돌 (글자 충돌로 안 잡힘)

| # | 항목 | 우리 | BE 브랜치 |
|---|---|---|---|
| 1 | 실시간 WS | `/v2/realtime` 좌표 스트림(ADR 0021, [계약 v2](../../../contracts/realtime/realtime-ws.v2.schema.json)) | `/v1/realtime`만 있음. BE ADR 0022는 「특징 v2·실시간 v1 유지, 좌표 스트림 제외」 |
| 2 | REST 빠진 것 | R1b `GET /v2/records/{id}`, T1 `GET /v2/stats/daily`, `closed(limit_reached)` (`RECORD_ARCHIVED`는 10/15 BE의 409 `CONFLICT`에 맞춤) | 없음 |
| 3 | REST 남은 것 | `POST /v2/records`는 없애기로 함 | 아직 있음 |
| 4 | ADR 번호 | `0022-session-ends-on-lost-connection`(develop에 먼저 들어감) | `0022-db-v23-feature-v2-integration`. 합치면 0022가 둘 → **합칠 때 FE가 BE ADR을 0024로 옮기고 링크를 고친다**(10/15) |
| 5 | 계획 번호·내용 | ~~`0028-backend-build-gradle`~~ → **10/15 해결:** 전환 부분을 빼고 [0030](0030-make-check-failures.md)(`make check` 실패 원인·G1~G5)으로 옮겼다 | `0028-backend-java17-boot4-gradle`(이미 전환, ADR 0023) |

같은 것: 가입 입력 규칙(이름 1~30자, 나이 14~120, 비밀번호 12~72)은 서버 검사(`AccountContracts`)와 앱이 같다.

## BE에 확인할 것 (merge 전, 합의와 BE 코드가 다른 것만)

| # | 질문 | 우리 제안 |
|---|---|---|
| Q1 | 실시간 경로 | **10/15 확정: `/v2/realtime`(좌표 스트림).** BE 브랜치의 `/v1/realtime`과 BE ADR 0022의 「좌표 스트림 제외」는 서버를 먼저 돌려 보려고 섞어 둔 임시 상태(BE 답) |
| Q2 | R1b·T1·`limit_reached`를 언제 넣는가 (10/15: R1b·T1은 연동 명세 4.5대로 다음 주 범위, `limit_reached`는 v2와 함께) | 연동 명세 4장·5장 그대로 |
| Q3 | `POST /v2/records`를 없애는가 (10/15: v2에서 앱이 부르지 않으므로 v1과 함께 정리) | 없앤다(BE 명세에서 없앤 것과 같게) |

## 작업 단계

- [x] 1. BE에 Q1을 확인했다(10/15, `/v2/realtime`). Q2·Q3은 합의대로 BE가 진행한다([FE 제안서](../../design/fe-server-proposal.md) 1장 B-1·B-2).
- [x] 2. merge 전에 우리 쪽 정리: 계획 0028을 0030으로 옮기고 Gradle 전환 부분을 뺐다(10/15). BE ADR 0022 → 0024는 3단계 merge 커밋에서 하고 BE에 알린다.
- [ ] 3. 연습 merge: 로컬 임시 브랜치(올리지 않음)에서 `git merge origin/feat/backend-data-platform-architecture`, 위 표 원칙대로 9개를 푼다.
- [ ] 4. 연습 merge에서 검사: `check-repo` → `test` → `check-frontend` → `check-backend`(JDK 17·Gradle Wrapper). `check-browser`·`check-compose`는 지금 못 돌리는 이유를 [FE 명령과 검사](../../design/fe-commands-and-checks.md)에 맞춰 기록한다.
- [ ] 5. 합친 뒤 v2 결정을 연동 명세·계약 README·ADR에 한 가지로 맞춘다. BE ADR(0024로 옮긴 것)의 「실시간 v1 유지」에는 「10/15 임시 상태, v2로 간다」를 덧붙이도록 BE에 알린다.
- [ ] 6. 결과를 보고 우리 브랜치에 실제 merge할지, BE 브랜치가 develop에 들어간 뒤 develop을 받을지 정한다.
- [ ] 7. 실제 merge 후 같은 검사를 다시 돌리고 아래에 기록한다. 이 계획은 끝나면 지우고 [지운 문서 기록](../../removed-docs.md)에 남긴다.

## 결정과 진행 기록

- 2026-10-14: 미리 합쳐 보기로 충돌 범위를 확인했다(위 표). 계정 서버 연결(F12)은 BE 담당으로 정정했다.
- 2026-10-15: 번호 겹침(4·5)은 물어보지 않고 FE가 정리하기로 했다. BE에 확인할 것은 합의와 BE 코드가 다른 Q1~Q3만 남겼다.
- 2026-10-15: BE 답 — 실시간은 `/v2/realtime`. 지금 BE 브랜치의 v1은 서버를 먼저 돌려 보려고 섞인 임시 상태다.
- 2026-10-15: 합치는 시점 — BE가 그 브랜치에서 작업을 끝낸 뒤 합친다. 그때까지 FE는 우리 브랜치에 계속 push하고 결정·작업을 문서에 적는다. 3단계 직전에 `git fetch`와 미리 합쳐 보기를 다시 해 위 충돌 표를 새로 만든다.

## 검증 결과와 남은 한계

- 실행: `git merge-tree --write-tree HEAD origin/feat/backend-data-platform-architecture`(충돌 목록만, 작업 폴더 변경 없음), BE 브랜치 컨트롤러의 경로를 `git grep`으로 확인.
- 아직 안 함: 실제 merge, 합친 뒤 검사 전부.
- 한계: BE 브랜치는 계속 바뀌고 있다. 3단계 직전에 `git fetch` 후 미리 합쳐 보기를 다시 한다.
