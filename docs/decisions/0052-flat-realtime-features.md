# ADR 0052: 실시간 입력은 프레임 한 장을 평탄화해 보내고, 측정 불가는 양 어깨로 정한다

- 상태: accepted(FE). 서버가 신형을 받는 작업(팀장 PR #143, 브랜치 `feature/repo-realtime-message-simplification`)이 운영에 올라가야 배포한다. 서버 쪽 결정은 ADR 0053(#143) 「실시간 단일 프레임 입력과 서버 목업 필터 제거」이고, 11/23 FE가 그 계약과 이 ADR이 같음을 확인했다
- 날짜: 2026-11-19
- 작성: klaod-tech(FE)
- 근거: 팀장(전세호) 「실시간 WebSocket 계약 변경 검토 요청」(2026-11-18), FE 회신(2026-11-19), 팀장 확인(11/19: 고개 돌림은 서버가 거르지 않고 ML이 판별)
- 관련: [ADR 0021](0021-app-sends-information-server-judges.md) 6절(판정 불가 프레임), [연동 명세](../design/fe/api-ws-spec.md) 5.1·5.2, [FE 제안서](../design/fe/fe-server-proposal.md) 요구 4(`ack`)·5(`features` 묶음 단계)

## 배경

- 앱은 10/27부터 한 메시지에 프레임 한 장만 보냈지만, 메시지는 여전히 `items[]`(구간 1개)·`frames[]`(프레임 1장) 묶음 모양이었고 서버는 프레임 특징을 평균했다.
- 구간마다 `schema_version`·`feature_version`이 붙고, 서버는 앱이 읽지 않는 `ack`를 구간마다 보냈다.
- 서버는 좌표로 고개 돌림(코-귀 중점 변화 0.15 초과)을 찾아 판정에서 뺐고(`head_turn`), visibility 0.65 하한으로 얼굴·어깨 점을 걸렀다.

## 결정

1. **`features`는 구간 필드와 프레임 한 장을 최상위에 둔다.** `sequence`·`start_ms`·`end_ms`·`phase`·`t_ms`·`p`. `items[]`·`frames[]`·`schema_version`·`feature_version`·`valid`는 보내지 않는다.
2. **phase는 넷이다.**

   | phase | 언제 | `t_ms` | `p` |
   |---|---|---|---|
   | `running` | 양 어깨가 보이는 프레임 | 있음 | 관절 9개 |
   | `unmeasurable` | 어깨가 안 보임·사람 없음·관절이 빠진 프레임 / 새 프레임 없이 0.5초 | 프레임이 있으면 있음 | `null` |
   | `rest` | 사용자 「잠시 쉬기」 | 없음 | 없음 |
   | `away` | 카메라 영상이 1초 넘게 멈춤 | 없음 | 없음 |

3. **측정 불가 기준은 양 어깨다**(visibility 0.65 이상, 화면 가장자리 2% 밖 — 지금 앱 기준 그대로). 얼굴 점이 가려지거나 고개를 돌린 프레임도 어깨가 보이면 `running`으로 보낸다. 고개 돌림은 서버가 거르지 않고 채점하며, 판별은 ML이 맡는다.
4. **한 구간에 한 장.** 같은 시각에 두 장이 오면 나중 것을 보낸다. 이미 닫힌 구간보다 앞선 시각의 프레임(추적이 늦은 동안 구간이 시계로 닫힘)은 버린다.
5. **`hello`에도 계약 버전을 두지 않는다.** 호환 기간에 서버는 구형·신형을 `items`가 있는지로 구분한다. 팀장 안의 `hello` `"3.0"`에 대한 FE 의견이며, 확정은 서버 작업에서 한다.
6. **앱은 `ack`를 읽지 않는다.** 구형 서버가 보내도 모르는 메시지로 버린다.

## 이유

- 앱은 이미 프레임마다 보냈으므로, 묶음 모양은 형식만 복잡하게 하고 서버 평균은 하는 일이 없었다.
- 버전 값은 받는 쪽이 「이 값이 아니면 거절」로만 썼고, 값에 따라 다르게 처리하는 코드는 없었다(FE 제안서 요구 13).
- 측정 불가를 앱이 phase로 알리면 서버는 좌표 품질을 다시 따지지 않아도 된다. 고개 돌림을 앱이나 서버 규칙으로 빼면 ML이 그 자료를 볼 수 없다.
- 같은 구간에 두 장이 들어가거나 구간 밖 `t_ms`가 섞이면 「구간마다 한 장」이라는 계약이 깨진다.

## 결과

- 코드: `frontend/src/features/session/realtime/frames.ts`(`FrameBatcher`), `frontend/src/features/session/live/LiveSession.ts`(`hello`, `send`), 개발용 가짜 서버 `frontend/scripts/fake-server.mjs`(구형·신형 모두 받음, `ack` 없음).
- 시험: `frames.test.ts`(평탄화 필드, 빈 구간, 같은 시각, 늦은 프레임, `rest`·`away`), `LiveSession.test.ts`, `useSyntheticCamera.test.tsx`.
- **운영 서버는 아직 구형만 받는다.** 이 앱을 서버보다 먼저 배포하면 측정이 시작되지 않는다(서버가 `hello`·`features`를 거절). 서버가 구형·신형을 함께 받게 된 뒤에 배포한다. 되돌리기는 Vercel 이전 배포로 한다.
- 고개 돌린 프레임이 채점되므로, 서버의 지금 규칙 점수로는 고개를 돌린 동안 흐트러짐으로 나올 수 있다. ML 판별이 붙기 전까지의 한계다.
- 계약 파일(`contracts/realtime/*`, 새 `frames/posture-frame.schema.json`)과 BE 명세는 팀장 PR #143(ADR 0053)에서 바꿨다. FE 명세는 이 판에 맞췄다.
- 응답(`observation`·B1·B2·S4·R1·W1)의 `schema_version`과 서버 안쪽 버전은 FE 제안서 요구 13에서 따로 정한다.
