# 프론트 ↔ 플랫폼 v4 연결 지점

- 분야: 프론트
- 작업: GP-0101
기준 자료: 팀 공유 "자세 분석 플랫폼 아키텍처 v4"(2026-10-02, 초안). 그 문서의 fps·윈도우·T1/T2/T3 값은 회의 확정 전 초안이다.
이 문서는 **아직 연결하지 않은** 백엔드 작업을 위해, 새 화면의 어느 부분이 어떤 API를 기다리는지 정리한다.
현재 앱은 새 네트워크 호출을 하지 않는다(기존 개발 서버 판정·계정 모드는 그대로 유지, [ADR 0017](../decisions/0017-desktop-app-shell-and-redesign.md)).

## 연결 지점 파일

| 파일 | 내용 | 상태 |
|---|---|---|
| `frontend/src/features/platform/ports.ts` | `AuthPort`, `BaselinePort`, `RealtimePort`, `ReportPort` 타입 초안 | 타입만. 구현·import 없음 |
| `frontend/src/features/session/liveView.ts` | 화면 상태 모델 `LiveView`(NORMAL/SUSPECT/BAD/RECOVERING + 측정 불가·쉬는 중·분석 일시 중단) | 사용 중. 로컬 엔진 어댑터 `fromLocalLive` |
| `frontend/src/features/desktop/useLaunchAutomation.ts` | 시작 프로그램 실행 후 자동 카메라. 저장 기준을 불러올 자리 표시 | 사용 중 |
| `frontend/src/features/history/LocalHistory.tsx` | 기록 탭. 지금은 저장된 세션 요약으로 계산 | 사용 중 |

계약(JSON 필드·버전)은 팀이 확정한 뒤 `contracts/`에 둔다. `ports.ts`의 이름은 자리 표시이며 계약이 아니다.

## 화면별로 기다리는 데이터

| 화면 요소 | 지금 출처 | v4 예정 경로 | 연결할 곳 |
|---|---|---|---|
| 로그인 | 로컬 프로필(localStorage) / 기존 계정 모드 | REST `:8080` gateway, JWT | `AuthPort` → `app/LocalServiceApp.tsx`의 `login` 자리 |
| 기준 자세 등록(5초) | 브라우저 메모리(카메라 연결 동안만) | `POST /api/baselines` → MySQL `baselines`, `posture.baselines` 토픽 | `BaselinePort.save`: `SetupPage`의 등록 완료 시점 |
| 자동 실행 후 바로 측정 | 미지원(기준 재확인 필요) | 저장된 기준 조회 | `BaselinePort.latest`: `useLaunchAutomation` |
| 실시간 상태 알약·교정 카드 | 로컬 엔진(`useSession`) | WebSocket: 0.5초 묶음 전송 → `posture.inference` → realtime 상태머신 → 푸시 | 구현됨(GP-0115): `RealtimeClient`의 `onObservation`(실시간 상태)·`onProgress`(숫자)·`onDecision`(사건) → 서버 세션 컨트롤러 → `LiveView`. 계약은 `contracts/realtime/` |
| 알림 토스트·소리 | 로컬 엔진 `alertTick` | 서버 상태머신의 알림 푸시(T3 재알림) | 구현됨: 확정·재알림 `decision`을 기존 알림 경로(`onNotifications`)로 한 번만 전달 |
| "분석이 잠시 멈췄어요" | 해당 없음 | GPU PC 5초 무응답 | 구현됨: `onStalled` → 화면 메시지 "분석이 잠시 멈췄어요", 다음 관측·진행에서 해제 |
| 결과 화면 | 로컬 엔진 합계 | `posture.episodes` → report-service 저장 | 종료 시 서버 요약 조회 |
| 기록: 기간 합계·날짜별 막대·흐트러진 방향 | 저장된 세션 요약 계산 | `mart_daily_posture`(Spark J3 일 배치) 통계 API | `ReportPort.daily` → `LocalHistory`의 `dayBars`/`kindShares` 대체 |
| 기록: 개별 측정 목록 | 저장된 세션 요약 | report-service 에피소드(즉시 반영) | 목록 API(미정) |
| 모델 버전 표시 | 규칙 이름 문자열 | 추론 결과 `modelVersion` | 구현됨: 관측 v2의 `model_version` |

## 상태머신 대응

| v4 상태 | `LiveStatus` | 화면 |
|---|---|---|
| NORMAL | `normal` | 바른 자세예요 |
| SUSPECT (T1 대기) | `suspect` | 지속 시간 진행 막대 |
| BAD | `bad` | 교정 카드, 재알림 카운트 |
| RECOVERING (T2 대기) | `recovering` | 복귀 진행 막대 |
| (결과 없음 5초) | `analysisPaused` | 회갈색, 기록 제외 |
| 품질 부족 | `unmeasurable` | 회갈색, 기록 제외 |

서버가 진행률(SUSPECT/RECOVERING의 남은 시간)을 주지 않으면 진행 막대는 숨긴다. 현재 서버 판정 화면도 같은 원칙을 따른다.

## 합의가 필요한 질문

1. **무엇을 보내나**: v4는 키포인트를 WebSocket으로 보낸다. 현재 [ADR 0013](../decisions/0013-frontend-server-feature-connection.md)은
   어깨 기준 변화량 3개와 품질만 보내고 원본 좌표는 보내지 않는다. 개인정보·연구 경계와 함께 결정해야 한다.
2. **기준 저장**: 기준을 서버에 두면 자동 실행 후 즉시 측정이 가능하다. 카메라를 옮겼을 때 재등록 안내 규칙이 필요하다.
3. **시간 정책 값**: v4 초안의 T1 10초·T2 5초와 확정 정책(ADR 0012: 3초·3초·60초, 복귀는 10/06 개정)이 다르다. 화면 문구는 설정값을 그대로 쓴다.
4. **데스크톱 인증 보관**: Electron에서 JWT를 어디에 둘지(메모리/OS 보안 저장소). 페이지에는 preload로 필요한 함수만 노출한다.
5. **오프라인**: 서버가 멈췄을 때 로컬 엔진으로 계속 측정할지, 측정을 멈출지.
