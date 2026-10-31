# `make check` 실패 원인과 고칠 것

- 상태: superseded (2026-10-29 도구 간소화로 종합 브라우저·Compose 복구 과제 폐기. 아래 원인과 실행 결과는 당시 기록)
- 담당: FE(klaod-tech)가 원인 분석·브라우저 시나리오, Compose는 DB·DevOps
- 시작일: 2026-10-14 (예전 번호 0028. BE 브랜치의 계획 0028과 겹쳐 10/15에 0030으로 옮기고 Gradle 전환 부분을 뺐다)
- 관련: [FE 명령과 검사(지움)](../../removed-docs.md), [계획 0029](0029-merge-backend-data-platform.md), [ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md)

## 배경

FE는 빌드 도구 때문에 `make check`가 계속 실패한다고 의심했다. 아래 원인 분석으로 빌드 도구와 무관함을 확인했다.

빌드 도구: BE가 10/14에 BE 브랜치(`feat/backend-data-platform-architecture`)에서 백엔드를 Java 17·Spring Boot 4.0.8·Gradle로 바꿨다(그 브랜치의 옛 ADR 0023·계획 0028, `a716135`).
`tools/`도 같은 커밋에서 Gradle Wrapper로 바뀌었다. Docker 이미지·CI는 그 계획에 팀원 작업으로 남아 있다. FE는 따로 전환하지 않았고, 10/15 BE 브랜치가 develop을 받아 합쳐지면서 이 저장소도 Gradle이 됐다([계획 0029](0029-merge-backend-data-platform.md)).

## 원인 분석 (2026-10-14, Windows 노트북, `lee_app3` `fd1c4a7`)

`make check` = ① `check-repo` → ② `test` → ③ `check-frontend` → ④ `check-backend` → ⑤ `check-browser` → ⑥ `check-compose`.

| 단계 | 결과 | 원인 | 빌드 도구 탓인가 |
|---|---|---|---|
| ④ `check-backend` | **통과.** Java 시험 59개, 실패 0, 14개 건너뜀(MySQL 없음). 서비스 왕복 PASS | — | 아니다 |
| ⑤ `check-browser` | **실패.** 첫 단계 `camera-preview.mjs`의 `picker.options.length`에서 `TypeError` | 10/14 `9f3bc92`(lellon0403)가 자세 데이터 수집 화면의 기본 `<select id="capture-task">`를 앱 모양 `SelectMenu`로 바꿨다. 시나리오는 아직 `<select>`의 `options`를 읽는다. 그 전(10/13)에는 "first episode confirms at exactly 3 seconds" 항목이 실패했다(원인 미확인) | 아니다 |
| ⑥ `check-compose` | **실패.** 이 PC는 Docker 데몬이 꺼져 있어 돌리지 못했다. 데몬이 있어도 실패한다 | `infra/mysql/initdb/10-posegood-schema.sh`가 지워진 `schema_V1_1.sql`을 찾는다(`database/schema`에는 V2_2·V2_3만). 계정 브라우저 시나리오는 지운 계정 모드(`VITE_SERVER_ACCOUNTS`)를 쓴다 | 아니다 |
| CI (`.github/workflows/harness.yml`) | ⑤·⑥ 때문에 실패 | `make check` 전체를 돌린다 | 아니다 |

**당시 결론: `make check` 실패는 빌드 도구 때문이 아니었다.** 실패는 화면이 바뀌었는데 브라우저 시나리오를 고치지 않은 것(⑤)과 DB V2.3·계정 모드 제거를 Compose가 따라가지 못한 것(⑥)에서 왔다. 이 분석은 아래 도구 삭제 전 구성에 대한 기록이다.

앞으로 실패할 수 있는 곳: BE 브랜치는 API가 MySQL 없이 시작하지 않는다(그 브랜치의 ADR 0020). 그 코드가 들어오면 ④·⑤도 임시 MySQL이 필요하다. (그 코드는 10/21 V3에, 10/22 PR #63으로 develop에 들어왔다)

## 문제와 완료 기준

당시 목표는 `check-browser`·`check-compose`를 복구하는 것이었으나, 두 명령과 구형 시나리오는 2026-10-29 제거했다.
복구 과제를 취소한 것이며 검사를 통과한 것으로 기록하지 않는다. 현재 기본 검사와 별도 MySQL·브라우저 점검은 [품질 기준](../../quality.md)을 따른다.

## 당시 복구 검토

| # | 실패 | 고칠 곳 | 담당 |
|---|---|---|---|
| G1 | ⑤ `capture-task`가 `SelectMenu`로 바뀜 | `tools/browser/camera-preview.mjs`(그리고 `scenarios.mjs`의 같은 선택)를 새 목록 상자 조작으로 | 수집 화면 담당(lellon0403)·FE |
| G2 | ⑤ 첫 사건 3초 확정 항목 | 원인 조사(develop 흐름) | FE |
| G3 | ⑤ 재연결 항목 | ADR 0024(끊기면 세션 종료)에 맞춰 시나리오 수정 | FE |
| G6 | 10/21 앱이 서버 전용이 됨(V3): 시나리오의 로컬 측정·「서버 판정 사용」 체크·이어하기가 없어짐. 10/22부터 합성 프레임 `frame(ms, kind)`는 `poor`면 판정 불가, 나머지는 판정 가능만 뜻한다(`normal`·`deviation` 구분 없음, 앱이 특징값을 만들지 않음) | `tools/browser/scenarios.mjs`·`accounts.mjs`를 가짜 서버(S1·`/v2/realtime`·B1·B2) 또는 8088 시험 환경으로 다시 쓴다. G2·G3은 이 작업에 흡수된다 | FE |
| G4 | ⑥ `schema_V1_1.sql` 없음 | 초기화 스크립트를 `schema_V2_3.sql`로(DB 브랜치 병합과 함께) | DB·DevOps |
| G5 | ⑥ 계정 브라우저 시나리오 | 지운 계정 모드 대신 새 가입 화면(`features/auth/`)으로, 또는 서버 계정 연결 뒤 다시 | FE·DevOps |

## 과제 처리

- G1: `tools/browser/camera-preview.mjs`는 최신 develop 수정본을 개별 수동 점검용으로 보존한다. 현재 수동 실행 진입점 연결과 새로고침 뒤 재로그인 보완이 남아 있다.
- G2·G3·G6: 구형 브라우저 시나리오 삭제로 복구 과제 폐기.
- G4·G5: 종합 Compose 검사 복구 과제 폐기. 현재 Compose 실행 설정과 DB 준비는 [인프라 안내](../../../infra/README.md)를 따른다.
- 삭제한 검사의 CI 재연결은 수행하지 않는다. 현재 CI와 명시적 연결 점검의 범위는 품질 기준에서 관리한다.

## 결정과 진행 기록

- 2026-10-14: 원인 분석. `check-backend`는 통과했다. `make check` 실패는 ⑤·⑥이고 빌드 도구와 무관하다.
- 2026-10-15: Gradle 전환은 BE가 BE 브랜치에서 끝냈다. 이 계획에서 전환 부분을 빼고 0028 → 0030으로 옮겼다(BE 계획 0028과 번호 겹침).
- 2026-10-29 도구 간소화, 2026-10-30 develop 병합 후 삭제 유지: 구형 브라우저·Compose 검사 복구 계획을 대체됨으로 정리했다. 기존 실패·미실행 기록은 보존한다.
- 2026-10-30 추가 develop 병합: `camera-preview.mjs`는 보존으로 변경했다. 구형 `check-browser`·`check-compose` 명령은 복원하지 않고 기본 검사 범위도 유지한다.

## 검증 결과와 남은 한계

- 실행(10/14): `python tools/dev.py check-backend` → 통과(`BUILD SUCCESS`, Java 59개 중 14개 건너뜀, 서비스 왕복 PASS).
- 실행(10/14): `python tools/dev.py check-browser` → 실패(`camera-preview.mjs` `TypeError`, 위 G1).
- 못 돌림: `check-compose`(Docker 데몬 꺼짐). 실패 이유는 코드로 확인했다(G4·G5).
