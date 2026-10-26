# 아키텍처와 경계

상태: 논리적 경계를 정의했고, [현재 계획서](references/current-proposal-review.md)의 배치 방향을 추가로 참고한다.
구체적인 전송 방식과 실행 환경은 프로토타입 후 ADR로 결정한다.

2026-10-13 현재 계정 앱은 [ADR 0022](decisions/0022-db-v23-feature-v2-integration.md)에 따라 특징 v2를 유지하며
DB V2.3·HTTP 계정 v2에 연결한다. 기준 등록 때만 평균 좌표 18개를 저장하고 측정 중에는 특징 변화량을 전송한다.
아래 ADR 0021의 좌표 스트림·Kafka 내용은 후속 전환 방향이다.

현재 체험용 구현의 초기 선택은 [ADR 0002](decisions/0002-webcam-prototype.md)에 따라 `frontend/`와 `model/prototype/`를
같은 브라우저에서 실행한다. 영상·원본 좌표는 서버에 보내지 않는다.
[API 판정 엔진·FastAPI 경계](decisions/0020-single-api-decision-engine.md)에 계정 앱의 서버 판정 모드를 연결했다.
[ADR 0013](decisions/0013-frontend-server-feature-connection.md)에 따라 세 특징의 현재−시작 기준 변화량과 품질만 전송한다.

> **결정 변경(2026-10-11)**: [ADR 0021](decisions/0021-app-sends-information-server-judges.md)에 따라 앱은 관절 좌표(`posture.frames.v1`)만 보내고
> 판정 가능 검사·특징값·점수·시간 판정은 모두 서버가 한다. 로컬 모드와 브라우저 특징 변화량 전송은 [계획 0023](plans/active/0023-frontend-server-only.md)에서 없앤다.
> 이 문서의 "원본 좌표를 보내지 않는다", "로컬 모드", "`serverFeatures.ts`가 변화량을 만든다"는 그 전까지의 현재 동작이다.
> 판정은 DevOps Kafka 경로(추론 → v1 판정기)가 한다. 앱은 BE가 만드는 입출구 서버(`auth`·`api`·`ws`, 아키텍처 v5) 하나와 통신한다([FE 제안서](design/fe-server-proposal.md) 2장).

```text
카메라 → 랜드마크 → 측정 품질 → 정규화 → 개인 기준 변화량 → 시계열 추론
                         ↓                                  ↓
                    측정 불가                         버전 있는 출력 계약
                                                            ↓
                                                상태 표시 / 지속시간 알림
                                                            ↓
                                                  세션 통계 API → 저장
```

| 디렉터리 | 소유 책임 | 경계 |
| --- | --- | --- |
| `model/` | 포즈 어댑터, 품질, 특징, 보정, 추론, 연구 평가 | 화면·DB에 직접 의존하지 않음 |
| `frontend/` | 카메라 UI, 등록 흐름, 상태 표시, 알림 전달, 대시보드 | AI 내부 특징을 재해석해 자체 분류하지 않음 |
| `backend/` | 계정·설정·세션·기록 API, 시간 사건 판정·유효 시간 집계, 추론 연결 | 분류·개인 보정 로직을 중복 구현하지 않음. 시간 임계값 비교는 `engine/DecisionRules`에만 있음 |
| `database/` | 스키마, 마이그레이션, 보존/삭제 규칙 | 앱이나 모델 코드를 호출하지 않음 |
| `contracts/` | 경계를 넘는 데이터 구조와 합성 예제 | 어떤 프레임워크에도 의존하지 않음 |

`model/`은 코드의 책임 경계이며 반드시 서버에서 실행한다는 뜻은 아니다.
현재 계획은 React/TypeScript 클라이언트에서 MediaPipe 키포인트를 추출하고 필요한 특징을 추론 서비스에 전송하며,
Spring Boot는 사용자·세션·기록 서비스를 담당하는 방향이다. Python/LSTM 추론 서비스와 사용자 관리 서비스는 분리한다.
앱(FE V3, 2026-10-21)은 관절 9개 좌표를 0.5초 구간으로 `/v2/realtime`에 보내고, 특징값·점수·판정은 서버가 한다([ADR 0021](decisions/0021-app-sends-information-server-judges.md), [ADR 0025](decisions/0025-app-always-measures-on-server.md)).
기준 자세는 앱이 관절 9개 3초 평균을 내서 B1로 저장한다([ADR 0026](decisions/0026-baseline-average-by-app-b1.md)). 예전(v1) 개발 흐름의 브라우저 특징 변화량(`model/prototype/serverFeatures.ts`)과 앱의 머리·고개 돌림 판정은 2026-10-22 지웠다.
학습 모델·배포 런타임과 품질/정확도 검증은 후속 결정이다.
원본 영상은 가능한 한 기기 안에서 처리한다. 추론 위치를 정할 때 기기 성능·지연·데이터 이동을 함께 검토한다.
새 서버 흐름의 지속시간·회복·재알림 판정은 API의 판정 엔진 한 곳에서 수행한다. Spring Boot API는
검증·전달·저장·조회, FastAPI는 현재 추론 점수를 담당한다. [관측/사건/조회 계약](../contracts/README.md)을 사용한다.
앱은 항상 서버로 측정하고(`frontend/src/features/session/live/`) 서버가 보낸 사건·요약만 표시한다. 로컬 시간 엔진은 없다(2026-10-21).
`/api` 개발 프록시는 loopback으로만 연결한다. Compose는 Nginx가 내부 API로 proxy하고(실시간 채널은 WebSocket) DB·추론은 host port를 열지 않는다.
현재 FastAPI는 규칙 기반 특징 점수이고 학습 모델이 아니다. [실행·검증·한계](../backend/README.md)를 따른다.

시간 정책의 현재 합의는 [ADR 0012](decisions/0012-session-timing-policy.md)를 따른다.
기본 최초 알림 3초·복귀 3초·같은 사건 재알림 60초, 중단 후 새 사건과 제외 시간,
세션 시작 시 설정 고정/다음 새 세션 적용을 서버 구현에 유지한다(앱은 설정값을 S1 `policy`로 보낸다).
개발용 특징·관측 구간 계약은 ADR 0013이며 실제 품질 임계값·카메라 시점·장치 성능은 검증 전이다.

## 의존성과 변경 원칙

- 소비자는 공개 계약을 통해 연결하고 다른 컴포넌트의 내부 파일을 직접 가져오지 않는다.
- 계약 변경 → 예제/검증 갱신 → 생산자·소비자 수정 순으로 진행한다.
- 연구·학습 경로와 실시간 추론 경로를 분리한다. 노트북을 서비스 실행 진입점으로 사용하지 않는다.
- 실제 코드가 생기면 언어에 맞는 import/lint 경계 검증을 추가한다. 현재 하네스는 의존성 경계를 정적으로 검사하지 않는다.
- 팀 공통 문서에는 결정과 근거를 기록하고, 일시적인 도구 출력이나 긴 작업 대화는 넣지 않는다.

## 기존 프론트 통합 예외

[ADR 0003](decisions/0003-retro-integration.md)의 예외(`frontend/src/lib/engine.ts`가 로컬 모드 시간 정책을 실행)는 2026-10-21 [ADR 0025](decisions/0025-app-always-measures-on-server.md)로 끝났다. `lib/engine.ts`에는 기록·설정 타입만 남았다. 학습 데이터 수집 화면이 쓰는 특징 계산(`model/prototype/pose.ts`)은 남아 있다.

## 파일럿 파일 수집

`useCamera.subscribe`는 새 추론 프레임의 평활화 전 특징과 33개 영상/world 좌표를 전달한다.
`useCollection`은 명시적 시작 후 준비 시간을 제외한 관측만 최대 10Hz로 버퍼링한다.
안내 과제·실제 자세·재석 상태·측정 품질을 분리하고 촬영 후 자기 보고 검토를 거쳐 v2 CSV로 내보낸다.
전용 수집 화면(사용자 표시명 `자세 등록`, 코드상 `CollectionPage`)은 교정 알림을 실행하지 않는다. 영상·음성 저장/업로드는 없다.

연구 자료 준비는 `model/analysis/dataset/`에서 v2 CSV의 hash·소유권·기준 등록을 검증한다.
명시적 참여자 분할을 먼저 만들고 실제 시각의 연속 구간별로 시간 창을 생성한다.
기준 등록 자료는 개인 보정용으로 별도 출력하며 평가 창이나 전역 학습 자료에 합치지 않는다.
저품질·미검토·전이·누락 경계 양쪽을 연결하거나 보간하지 않는다. 실제 자료와 manifest는 Git 제외/외부 위치에 둔다.
도구는 변환기를 맞추거나 모델을 학습하지 않는다.

사용자가 선택한 [본인 자세 실험](research/personal-pilot-training.md)은 `model/analysis/personal/`의 별도 오프라인 학습 경로다.
한 사람의 촬영 회차를 나눈 뒤 delta 특징의 시간 요약·학습 전용 증강·softmax 분류를 실행한다.
다른 참여자의 성능을 평가하는 준비 도구/프로토콜과 구분하며 개인 실험의 가중치를 서비스에 자동 연결하지 않는다.
스케일러·증강 통계는 원본 학습 자료만, 모델 선택은 검증 촬영만 사용하고 확인용 촬영은 선택 뒤 평가한다.
원본·실제 분할 manifest·가중치는 Git 제외 경로에 둔다.

## MySQL 영구 모드

[계정 API](../contracts/accounts.v1.md)와 [MySQL 결정](decisions/0014-mysql-persistence-and-accounts.md)을 따른다.
인증은 DB 서버 세션·CSRF를 사용하고 소유자는 서버 인증 주체에서 얻는다.([ADR 0020](decisions/0020-single-api-decision-engine.md)).
진행 중 판정 상태는 API 메모리에 있고, 확정된 사건은 처리 직후, 종료 요약·제외 구간은 종료 때 짧은 트랜잭션으로 저장한다.
일별 통계(`daily_stat`)는 API가 읽기만 하고 Spark J2가 매일 00:00에 전날(KST)을 집계하도록 설계했다.
탈퇴는 API가 접수만 하고(철회 없음), 30일 유예 뒤 최종 삭제는 Spark J3가 매일 04:00에 하도록 설계했다.
배치의 구현 상태는 [DB 안내](../database/README.md)의 11장을 참고한다.
API를 재시작하면 진행 중 세션은 복구하지 않고 `SESSION_LOST`로 알린다. 그래서 API는 한 인스턴스로 실행한다.

앱의 가입·로그인은 2026-10-22부터 항상 BE `/v2/auth`다(스위치 없음, [프론트 안내](../frontend/README.md)). 아래는 계정 API의 서버 쪽 경계다.
서버 연동 뒤 과거 기록·일별 통계는 서버 조회를 사용하며 전체를 localStorage에 복제하지 않는다. 오늘 표시용 세션 요약·사건·종료 결과는 계정별로 로컬에 수집·보관한다. 오늘 목록·요약·달력·그래프는 이 자료로 집계하고, 어제까지는 서버 통계(T1)를 표시한다(2026-10-22 결정, [연동 명세 4.5](design/api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)). 원 요청 재시도용 임시 자료는 사용자 UUID별 sessionStorage에 두어
동일 탭에서 같은 계정으로만 복구한다. 로그아웃/인증 변경은 카메라와 처리/UI를 중단하고 다른 계정으로 요청을 전송하지 않는다.
탭을 닫은 뒤 기기 간 활성 측정 찾기와 실제 카메라 기준 복원은 후속 제품 설계 대상이다.
앱이 붙을 서버는 BE 입출구 서버(REST `/v2`, WebSocket `/v2/realtime`, DB V2.3)이고 앱 쪽 규칙은 [연동 명세](design/api-ws-spec.md)다.

마이그레이션은 [database](../database/README.md), 실행/내부 토큰/배포는 [infra](../infra/README.md),
연구 export와 분석 시스템은 [아키텍처 v5.2 스택별 역할](design/architecture_v5.2_stack_roles.md)(DevOps)이 소유한다.
실시간 채널(`/v2/realtime`, [WebSocket v2](../contracts/realtime/realtime-ws.v2.schema.json))은 서비스 전달용이며 Kafka 분석용 export가 아니다.
앱이 v2로 넘어갈 때까지 `/v1/realtime`도 함께 열어 두고, 넘어간 뒤 지운다([계획 0031](plans/active/0031-realtime-kafka-transition.md)). FE V3는 2026-10-21 v2로 넘어갔다(develop에 합쳐진 뒤 BE가 v1을 정리).

## 프론트 진입과 로컬 저장

프론트 앱 조립은 `frontend/src/app/ServiceApp.tsx` 하나다. 별도 연구 앱(`?research=1`)은 [ADR 0008](decisions/0008-single-app-entry.md)에 따라 통합했다.
로컬 `/#collection`은 같은 앱의 프로필 없는 CSV 수집 진입점이며 계정 API 인증을 우회하지 않는다.
[ADR 0016](decisions/0016-collection-entry-and-camera-preview-window.md)에 따라 카메라는 일반 화면 이동에도 유지한다. 명시적 종료·로그아웃·인증 변경은 해제한다.
작은 카메라 창은 2026-10-26부터 웹에는 없고 데스크톱 앱에서만 기존 스트림을 보여 준다([ADR 0028](decisions/0028-no-web-camera-window-desktop-only.md)). 웹은 다른 탭에 가도 측정이 이어진다.
미리보기 유지와 수집은 구분하며 탭/수집 화면 이동의 촬영 중단 규칙을 유지한다.
프로필·세션 저장/복구·측정 화면·기록 조회·저장 검증은 `frontend/src/features/`로 나눴다.
API는 account/session/engine/workspace/realtime 경계로 구현한다.
Python 추론은 app/schemas/service/routes, 개발 도구는 CLI/작업/런타임/시험 프로세스 책임으로 구분한다.
구조와 수정 경로는 [코드 지도](code-structure.md)를 따른다. 이 분리는 기존 UI·계약·시간 정책을 바꾸지 않는다.
계정 서버 연결(BE) 전까지 프로필·설정·예시 표시 여부는 `serviceStore.ts`를 통해 브라우저 localStorage(`posegood.v2.*`)에 둔다.
측정과 기준 자세는 서버에 있고(2026-10-21), 기록 화면이 R1을 읽기 전까지 측정 결과를 R1과 같은 형식으로 이 기기에도 남긴다. 중간 저장(이어하기)은 없다.
이는 서버 저장 API를 대체하는 임시 경계이며, 백엔드 연결 시 같은 지점에서 교체한다.
[수집 v2 규격](research/guided-collection-v2.md)을 따른다. 스켈레톤 평활화는 UI 전용이다.

`serviceStore`는 읽기/쓰기 전에 요약·사건·전체 Machine의 수치와 구조를 검사한다.
읽기 실패 시 원본을 유지하고 UI는 변경을 차단한다. Web Locks의 `posegood.v2.writer`를 가진 탭만
프로필·설정·측정 요약을 변경하며 다른 탭은 조회한다. 잠금 미지원 환경은 변경을 허용하지 않는다.
중간 저장의 선택 필드 `savedAt`은 복구 가능한 마지막 벽시계 시각이고, 종료 기록의 선택 필드 `rules`는
실제 적용 규칙이다. 기존 완전한 기록과 중간 저장은 호환된다. 서버 중간 기록에는 고정 기준·장치/영상 크기,
서버 확인 snapshot과 미확인 요청 하나를 저장하며 재전송 후 정리한다. 영상·원본 좌표는 저장하지 않는다.
완료 기록의 선택 필드 `server`에는 모델/기준 ID·종료 확인 여부와 원래 사건/통계 snapshot을 보관한다.
표시용 투영과 원래 snapshot이 일치하는지도 검사한다. 서버 유실 시 종료 성공으로 만들지 않고 명시적 요약 보관을 제공한다.
기준은 연결 내 임시 수집이 완료된 때 교체하고 취소 시 기존 기준을 유지한다. 영구 기준 버전은 미구현이다.

기록 상세는 로컬 요약과 원래 서버 사건/통계를 읽어 표시한다. 서버 종료 미확인 자료의 열린 사건을 실제 복귀/종료로 바꾸지 않는다.
예전 처음/최근 비교의 조건 표시는 구간별 기록의 출처·설정·모델·기준과 누락 정보를 사용했다. 해당 비교 칸은 2026-10-14에 제거됐다([프론트 안내](../frontend/README.md)). 2026-10-22 결정에 따라 모델명·모델 버전·특징 버전은 내부 관리용으로 유지하고 실제 서비스 화면에는 표시하지 않는다([내부 관리 기준](../contracts/README.md#모델명특징-버전의-내부-관리)). 내부 정보 보관과 화면 비표시는 기존 합산/제외 정책을 바꾸지 않는다.

탈퇴·서버 미확인 요약 보관은 공통 native dialog를 사용한다. 취소에 초기 초점을 두고 배경 조작을 막으며,
키보드 이동을 창 안에 유지한다. DOM 변경 후 실행 버튼 또는 새 화면의 주영역으로 초점을 돌린다.

## 합성 브라우저 검증 경계

`make check-browser`는 독립 임시 Chrome/Chromium과 실제 개발 서버들을 실행한다.
`browser-smoke` 개발 serve 모드에서만 앱의 카메라 hook을 `features/testing/`의 합성 입력으로 연결한다.
앱의 저장·복구·화면·서버 컨트롤러는 실제 구현을 사용한다. 일반 개발·preview·프로덕션 빌드에서는
합성 카메라를 선택하지 않으며 테스트 입력은 실제 영상·랜드마크나 카메라 권한을 사용하지 않는다.

`tools/benchmark/`는 추론 단독과 API→추론의 합성 요청을 별도로 측정한다. API 대상은 작업자마다 합성 계정으로 가입·기준 등록을 마친 뒤(측정 제외) 세션을 연다.
HTTP 응답 완료 지연과 전체 단계 처리량을 구분하고 실패 요청은 성공 지연 표본에서 제외한다.
환경·코드/입력/JAR hash를 결과에 남기며 실제 카메라 FPS나 배포 성능으로 해석하지 않는다.
