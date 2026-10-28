# 자세 등록: 앱은 프레임을 보내고 서버가 평균

- 상태: in_progress (BE 코드·문서 변경과 `make check-backend` 통과. 앱·FE 문서·다른 도구는 담당에게 알림)
- 담당: Kimyoujin(BE)
- 시작일: 2026-10-28
- 관련 요구사항/ADR: [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md) 5절(FE 문서, 「앱이 평균」 — FE가 이 계획에 맞춰 갱신), [ADR 0028](../../decisions/0028-server-time-for-baseline-registration.md), [BE API 명세](../../design/api-spec.md) B1, [계약 accounts.v2](../../../contracts/accounts.v2.md)

## 문제와 완료 기준

10/20 회의 뒤 B1은 앱이 낸 평균(`landmarks`)과 앱이 알려 준 `calibration_ms`·`sample_count`를 받았다.
서버는 앱이 판정 가능 프레임만 썼는지, 3초·장수를 채웠는지 확인할 수 없었다.

완료 기준:

- B1 `POST /v2/baselines`가 `{registration_id, frames}`를 받아 서버가 판정 가능 프레임의 관절 9개 평균을 저장한다.
- 3초 미만·판정 가능 15장 미만·평균 화면 밖은 422 `BASELINE_REJECTED` + `reason`이고 저장하지 않는다.
- `make check-backend`(MySQL 통합 포함) 통과.
- (FE 몫) 앱은 평균을 내지 않고 프레임을 보내며, `reason`별 안내를 보인다.

## 범위와 제외

- 범위(BE·DB): `backend/api` B1·오류 응답, `tools/service_smoke.py`(check-backend), 계약 `accounts.v2.md`, [BE API 명세](../../design/api-spec.md), [백엔드 상태](../../backend-status.md), `backend/README.md`, ADR 0028.
- DB: 바꾸지 않는다(V2.6 그대로, 프레임 원본 저장 안 함).
- 제외: WebSocket 등록을 되살리지 않는다. 판정 가능 조건(BE 명세 11.3) 자체는 바꾸지 않는다. 앱·FE 문서·다른 팀 도구는 아래 「다른 담당에게 알릴 것」으로 넘긴다.

### 다른 담당에게 알릴 것

이 변경이 들어가면 예전 B1 본문(`calibration_ms`·`sample_count`·`landmarks`)은 400이 된다.

| 담당 | 고칠 곳 | 내용 |
| --- | --- | --- |
| FE | `frontend/src/features/baseline/landmarkCapture.ts`·`client.ts`, `hooks/useCamera.ts`, `features/platform/api.ts` | 평균 대신 프레임 `{t_ms, p}`(촬영 시작부터 ms, 늘어나야 함, 최대 500장)을 모아 `{registration_id, frames}`로 보냄. 최소 장수 20 → 15. 422 `BASELINE_REJECTED`의 `reason`(`incomplete`·`too_few_frames`·`out_of_frame`) 안내. 1초 넘는 빈틈은 앱이 계속 거절 |
| FE | `features/baseline/fakeBaselineServer.ts`, `scripts/fake-server.mjs`, 시험 3개 | 가짜 B1이 `frames`를 받아 평균 |
| FE | ADR 0021 5절, `api-ws-spec.md` 1.1·B1 표·5.4, `fe-server-proposal.md`, `frontend/README.md`·`AGENTS.md`, `contracts/realtime/README.md`, 계획 0023·0029 | 「앱이 평균」 → 「앱은 프레임, 서버가 평균」 |
| PM·문서 | `docs/index.md`, `architecture.md`, `code-structure.md` | 같은 문장 갱신, 이 계획 링크 |
| DevOps | `tools/deploy/smoke.py`(compose smoke) | B1 본문을 `frames`로 |
| 데이터 플랫폼 | `tools/platform/io_api_smoke.py`, `ws_realtime_smoke.py` | B1 본문을 `frames`로 |

## 작업 단계

- [x] 관련 문서와 현재 구현 확인(지운 WS 등록 `465f464`의 `SessionService.Capture`·`calibrate` 참고)
- [x] BE: `BaselineFrames`(평균·거절 사유), `BaselineController` 본문, `ApiError.reason`·`ErrorHandler`, `FrameFeatures.usable`
- [x] BE 시험: `BaselineFramesTest`, `MySqlIntegrationTest` B1(422·예전 본문 400)
- [x] `tools/service_smoke.py` B1 본문
- [x] BE 문서·계약 동기화(accounts.v2, api-spec, backend-status, backend README, ADR 0028)
- [x] MySQL이 있는 환경에서 `make check-backend`(2026-10-28 통과)
- [ ] 다른 담당에게 알림(위 표) — 10/20 회의 결정(평균은 FE)을 바꾸므로 FE 확인 필요
- [ ] FE가 맞춘 뒤 전체 `make check`

## 결정과 진행 기록

2026-10-28 사용자 결정:

| # | 항목 | 결정 |
| --- | --- | --- |
| 1 | 요청 형식 | `frames` 배열(`posture.frames.v1` 프레임 `{t_ms, p, valid?}`) |
| 2 | 촬영 시간·장수 | 서버가 `t_ms`와 판정 가능 장수로 센다(`calibration_ms`·`sample_count` 삭제) |
| 3 | 최소 장수 | 판정 가능 15장(이전 B1 20장, 옛 WS 15장) |
| 4 | 1초 넘는 빈틈 | 앱만 거절, 서버는 보지 않음 |
| 5 | 실패 응답 | 422 `BASELINE_REJECTED` + `reason`(`incomplete`·`too_few_frames`·`out_of_frame`, 옛 WS 사유 그대로) |
| 6 | 최대 장수 | 500 |
| 7 | 원본 저장 | 하지 않음, DB 그대로 |
| 8 | 재전송 구분 | `registration_id` 그대로(같은 프레임 → 같은 평균 → 같은 행) |

- `t_ms`가 늘어나지 않으면 400(형식 위반). 같은 밀리초의 두 번째 관측은 앱이 버린다.
- 앱의 판정 가능 검사(양 어깨 보임·관절 9개)는 서버(visibility 0.65 등)보다 느슨하다. 차이는 서버가 `too_few_frames`로 알린다.
- 422 `reason`은 오류 본문 `{error, code, message}`에 `reason`을 더한다. 다른 오류 본문은 그대로다.

## 검증 결과와 남은 한계

실행한 것(2026-10-28, Windows):

- `POSEGOOD_TEST_MYSQL_PASSWORD=… python tools/dev.py check-backend`(로컬 MySQL 서비스) — **통과.** Gradle 빌드, 시험 83개 전부 통과
  (단위 73개, `BaselineFramesTest` 3개 포함, `MySqlIntegrationTest` 10개 — B1 422 `incomplete`·`too_few_frames`, 409, 예전 본문 400 포함).
  이어서 `tools/service_smoke.py` HTTP smoke 8개 항목 PASS(새 `frames` 본문으로 기준 등록 → 실제 추론 세션), 임시 DB 삭제 확인.
- 처음 돌렸을 때 `MySqlIntegrationTest.measurementWritesTheV2TablesAndRecordsAreRebuilt` 1개가 실패했다. 이 변경을 빼고 돌려도 같은 실패가 났다.
  원인은 `465f464`(새 계정 알림 기본값 켜짐, DB V2.6)에서 이 시험의 `alert_enabled` 기대값만 false로 남은 것이라, true로 고쳤다.
- `python tools/dev.py check-repo` — 통과.

남은 한계: 앱이 아직 예전 본문을 보내므로 FE가 맞추기 전까지 실제 앱의 자세 등록은 400이다. 실제 카메라로 등록한 결과는 FE 변경 뒤 확인한다.
