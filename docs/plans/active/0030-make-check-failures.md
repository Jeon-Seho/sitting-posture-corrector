# `make check` 실패 원인과 고칠 것

- 상태: planned (G1~G3는 FE, G4·G5는 DB·DevOps와 함께)
- 담당: FE(klaod-tech)가 원인 분석·브라우저 시나리오, Compose는 DB·DevOps
- 시작일: 2026-10-14 (예전 번호 0028. BE 브랜치의 계획 0028과 겹쳐 10/15에 0030으로 옮기고 Gradle 전환 부분을 뺐다)
- 관련: [FE 명령과 검사](../../design/fe-commands-and-checks.md), [계획 0029](0029-merge-backend-data-platform.md), [ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md)

## 배경

PM·DB(BE)가 10/14에 팀은 Gradle을 쓴다고 했다. FE는 Maven 때문에 `make check`가 계속 실패한다고 의심했다. 아래 원인 분석으로 Maven과 무관함을 확인했다.

빌드 도구: BE가 10/14에 BE 브랜치(`feat/backend-data-platform-architecture`)에서 백엔드를 Java 17·Spring Boot 4.0.8·Gradle로 바꿨다(그 브랜치의 ADR 0023·계획 0028, `a716135`).
`tools/`도 같은 커밋에서 Gradle Wrapper로 바뀌었다. Docker 이미지·CI는 그 계획에 팀원 작업으로 남아 있다. FE는 따로 전환하지 않고, BE 브랜치를 합칠 때 받는다([계획 0029](0029-merge-backend-data-platform.md)).

## 원인 분석 (2026-10-14, Windows 노트북, `lee_app3` `fd1c4a7`)

`make check` = ① `check-repo` → ② `test` → ③ `check-frontend` → ④ `check-backend` → ⑤ `check-browser` → ⑥ `check-compose`.

| 단계 | 결과 | 원인 | Maven 탓인가 |
|---|---|---|---|
| ④ `check-backend` (Maven `verify`) | **통과.** Java 시험 59개, 실패 0, 14개 건너뜀(MySQL 없음). 서비스 왕복 PASS | — | 아니다 |
| ⑤ `check-browser` | **실패.** 첫 단계 `camera-preview.mjs`의 `picker.options.length`에서 `TypeError` | 10/14 `9f3bc92`(lellon0403)가 자세 데이터 수집 화면의 기본 `<select id="capture-task">`를 앱 모양 `SelectMenu`로 바꿨다. 시나리오는 아직 `<select>`의 `options`를 읽는다. 그 전(10/13)에는 "first episode confirms at exactly 3 seconds" 항목이 실패했다(원인 미확인) | 아니다 |
| ⑥ `check-compose` | **실패.** 이 PC는 Docker 데몬이 꺼져 있어 돌리지 못했다. 데몬이 있어도 실패한다 | `infra/mysql/initdb/10-posegood-schema.sh`가 지워진 `schema_V1_1.sql`을 찾는다(`database/schema`에는 V2_2·V2_3만). 계정 브라우저 시나리오는 지운 계정 모드(`VITE_SERVER_ACCOUNTS`)를 쓴다 | 아니다 |
| CI (`.github/workflows/harness.yml`) | ⑤·⑥ 때문에 실패 | `make check` 전체를 돌린다 | 아니다 |

**결론: 지금 `make check` 실패는 Maven 때문이 아니다.** 실패는 화면이 바뀌었는데 브라우저 시나리오를 고치지 않은 것(⑤)과 DB V2.3·계정 모드 제거를 Compose가 따라가지 못한 것(⑥)에서 온다. Gradle로 바꿔도 이 실패는 그대로다.

앞으로 실패할 수 있는 곳: BE 브랜치는 API가 MySQL 없이 시작하지 않는다(그 브랜치의 ADR 0020). 그 코드가 들어오면 ④·⑤도 임시 MySQL이 필요하다.

## 문제와 완료 기준

- `python tools/dev.py check-browser`와 `check-compose`가 통과하고, CI(`make check`)가 다시 초록이 된다.

## 고칠 것

| # | 실패 | 고칠 곳 | 담당 |
|---|---|---|---|
| G1 | ⑤ `capture-task`가 `SelectMenu`로 바뀜 | `tools/browser/camera-preview.mjs`(그리고 `scenarios.mjs`의 같은 선택)를 새 목록 상자 조작으로 | 수집 화면 담당(lellon0403)·FE |
| G2 | ⑤ 첫 사건 3초 확정 항목 | 원인 조사(develop 흐름) | FE |
| G3 | ⑤ 재연결 항목 | ADR 0024(끊기면 세션 종료)에 맞춰 시나리오 수정 | FE |
| G4 | ⑥ `schema_V1_1.sql` 없음 | 초기화 스크립트를 `schema_V2_3.sql`로(DB 브랜치 병합과 함께) | DB·DevOps |
| G5 | ⑥ 계정 브라우저 시나리오 | 지운 계정 모드 대신 새 가입 화면(`features/auth/`)으로, 또는 서버 계정 연결 뒤 다시 | FE·DevOps |

## 작업 단계

- [ ] G1~G3: 브라우저 시나리오 수정 후 `check-browser` 통과
- [ ] G4·G5: BE 브랜치 합친 뒤(계획 0029) DB·DevOps와 Compose 수정, `check-compose` 통과
- [ ] CI 확인과 결과 기록

## 결정과 진행 기록

- 2026-10-14: 원인 분석. Maven `check-backend`는 통과했다. `make check` 실패는 ⑤·⑥이고 Maven과 무관하다.
- 2026-10-15: Gradle 전환은 BE가 BE 브랜치에서 끝냈다. 이 계획에서 전환 부분을 빼고 0028 → 0030으로 옮겼다(BE 계획 0028과 번호 겹침).

## 검증 결과와 남은 한계

- 실행(10/14): `python tools/dev.py check-backend` → 통과(`BUILD SUCCESS`, Java 59개 중 14개 건너뜀, 서비스 왕복 PASS).
- 실행(10/14): `python tools/dev.py check-browser` → 실패(`camera-preview.mjs` `TypeError`, 위 G1).
- 못 돌림: `check-compose`(Docker 데몬 꺼짐). 실패 이유는 코드로 확인했다(G4·G5).
