# kafka 모드에서 끝낸 측정이 「측정 중」으로 남는 문제 고치기 (D-98)

- 상태: in_progress (코드·단위 시험 완료, 서버 kafka 모드 통신 시험 전)
- 담당: BE
- 시작일: 2026-11-19
- 관련 요구사항/ADR: D-98(D-94 통신 시험에서 발견), [계획 0096 한 기기 측정](../completed/0096-single-device-measurement.md), [계획 0031](0031-realtime-kafka-transition.md), ADR 0024

## 문제와 완료 기준

kafka 모드에서 측정을 끝내도, 같은 계정이 새 측정을 시작하면(S1 세션 만들기) 409 `MEASUREMENT_IN_PROGRESS`가 난다.

- 측정 중 판단: `LiveSession.measuring()` = `!engine.ended() && (connected || S1 뒤 30초 안)`.
- 실시간 연결이 열리면 `SessionService.openRealtime`이 `connected(true)`로 표시한다. `false`로 되돌리는 곳은 없다.
- local 모드에서는 이 서버 엔진이 판정하므로 종료 때 `engine.ended()`가 `true`가 되어 표시가 풀린다.
- kafka 모드에서는 `KafkaPipeline.finish`가 Kafka에 `session_ended`만 보낸다. 엔진은 끝나지 않는다.
- `RealtimeHandler.afterConnectionClosed`는 이미 끝난 채널이면 바로 돌아간다.
- 그래서 끝낸 세션이 「측정 중」으로 남는다. 메모리 정리 기준도 「끝나지 않은 세션」이라 **방치 6시간까지** 이어진다.

같은 원인으로 메모리 정리(`ensureRoom`·`evict`)도 kafka 모드에서 끝낸 세션을 끝난 세션으로 보지 않는다.
그래서 30분이 아니라 6시간 동안 남고, 자리가 모자랄 때도 빠지지 않는다. 한도 512개가 차면 모든 새 측정이 429다.

완료 기준:
- kafka 모드에서 측정을 끝낸 뒤 같은 계정의 새 S1이 성공한다(유예 30초 안이어도).
- 끝난 세션에 다시 연결하면 409 `SESSION_ENDED`이고, 측정 중 표시가 남지 않는다.
- 종료 발행이 실패(503)하면 측정 중으로 둔다.
- 끝낸 세션은 메모리 정리에서 끝난 세션(30분) 기준을 따른다.
- local 모드 동작은 그대로다.
- 서버 kafka 모드 통신 시험 S9·S10(같은 계정으로 다시 측정)이 통과한다.

### 언제 생겼나

`/v2` 삭제와는 관계없다. 두 PR이 합쳐지면서 생겼다. 운영(local 모드)에는 영향이 없다.

| 시점 | 들어온 것 | kafka 측정 경로 | 측정 중 판단 |
|---|---|---|---|
| 11/10 `685a85cb` (#134 브랜치) | `KafkaPipeline` | 있음 | 없음 |
| #127 `d410b771` | 측정은 계정당 한 기기 | 없음 | 있음 |
| 11/18 `3e706cd7` (#134 브랜치에 develop 병합) | 두 기능이 처음 한 코드에 모임 | 있음 | 있음 → 버그 시작 |
| 11/18 `ed726158` (#134 병합) | develop에 들어감 | 있음 | 있음 |

## 범위와 제외

- 범위: `backend/api`의 `session/LiveSession`·`LiveSessions`·`SessionService`, `realtime/KafkaPipeline`·`RealtimeHandler`와 그 단위 시험.
- 제외: DB·계약·FE·처리 서비스. 여러 API 인스턴스 사이의 공유 잠금(계획 0096의 남은 한계 그대로).

## 작업 단계

- [x] 원인 확인과 생긴 시점 추적
- [x] 구현과 실패 경로(발행 실패 503, 남의 세션, 끝난 세션 재연결) 단위 시험
- [x] 문서 동기화(`docs/backend-status.md`, 완료 계획 0096의 남은 한계)
- [x] BE 단위 시험·Checkstyle
- [ ] 서버 kafka 모드에서 통신 시험 S9·S10

## 결정과 진행 기록

처음 D-98에 적힌 안은 연결이 닫힐 때와 `KafkaPipeline.finish` 때 `connected(false)`로 되돌리는 것이었다. 그것만으로는 부족한 점이 있다.
1. **짧게 측정하면 여전히 막힌다.** S1 뒤 30초 유예가 남아 있으면 `connected`가 `false`여도 「측정 중」이다.
2. **다시 연결하면 또 막힌다.** 끝난 세션에 다시 연결하면 `openRealtime`이 먼저 `connected(true)`로 표시하고, 그다음에 `KafkaPipeline.open`이 거절한다.
3. **메모리 정리 문제는 풀리지 않는다.**

그래서 「이 서버 밖에서 끝남」 표시를 따로 두었다.

| 파일 | 바꾼 것 |
|---|---|
| `session/LiveSession.java` | `released` 표시, `release()`(표시하고 `connected=false`), `over()` = `released || engine.ended()`. `measuring()`이 `over()`를 본다 |
| `session/LiveSessions.java` | `ensureRoom`·`evict`가 `over()`를 본다 |
| `session/SessionService.java` | `release(owner, id)`·`disconnected(owner, id)` 추가(남의 세션·없는 세션은 무시). `openRealtime`이 `over()`면 409 `SESSION_ENDED` |
| `realtime/KafkaPipeline.java` | `finish`에서 `session_ended` 발행이 성공한 뒤 `sessions.release`. 실패(503)면 부르지 않는다 |
| `realtime/RealtimeHandler.java` | `afterConnectionClosed`가 끝난 채널이어도 `sessions.disconnected`(안전장치) |

- 처리 서비스의 종료 결과로 풀지 않는다. 처리 서비스가 멈춰 있으면 영영 풀리지 않는다. 사용자가 측정을 끝낸 시점은 `session_ended`를 보낸 때이고, local 모드에서 엔진이 끝나는 시점과도 같다.
- 기준 브랜치: 버그는 develop에 있지만, 서버 kafka 모드 시험을 `/v2` 삭제 판으로 하므로 `refactor/repo-remove-api-version-paths`(`08d4204e`, PR #135 포함)에서 시작했다.
  PR도 그 브랜치로 낸다(PR #135와 같은 방식). 처음 develop `ed726158` 기준으로 만든 변경을 옮기면서 `RealtimeHandlerV2` → `RealtimeHandler` 이름 바뀜을 따랐다.
  develop의 `SessionServiceTest`에서 #134 병합(`3e706cd7`) 때 빠진 닫는 괄호는 이 브랜치가 이미 고쳤다(`a4204374`).

## 검증 결과와 남은 한계

- `backend/gradlew -p backend :api:test :api:checkstyleMain :api:checkstyleTest`(2026-11-19, `refactor/repo-remove-api-version-paths` `08d4204e` + 이 변경):
  API 시험 160개 중 실패 0, 건너뜀 18(MySQL 전용). Checkstyle 통과(경고는 Windows 작업 트리의 CRLF 줄끝과, 이 변경 전부터 있던 `SessionService` 자정 넘김 줄 길이 1건).
  - 추가: `SessionServiceTest` 3개(종료 넘긴 세션은 막지 않고 다시 연결 불가, 연결 떨어지면 유예 뒤 막지 않음, 메모리 정리·자리 비우기), `KafkaPipelineTest` 1개(발행 성공 뒤에만 한 번 표시).
  - 보강: `RealtimeHandlerTest`의 kafka 시험 2개에 `disconnected` 확인.
- 실행하지 않음: MySQL 통합 시험, processing 모듈 시험, 서버 kafka 모드 통신 시험 S9·S10.
- PR #135의 통신 시험 도구에 있는 「측정 시작 409면 D-98 안내」 문구는 이 수정이 들어간 뒤 지워도 된다.
