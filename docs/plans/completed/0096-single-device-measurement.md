# 여러 기기 로그인·한 기기 측정

- 상태: completed
- 담당: FE/BE
- 시작일: 2026-11-16
- 관련 요구사항/ADR: 사용자 요청, ADR 0024·0031

## 문제와 완료 기준

같은 계정으로 A PC와 B PC 모두 로그인할 수 있다. A에서 측정 중이면 B의 측정 시작(S1)은
`409 MEASUREMENT_IN_PROGRESS`로 거절되고, 앱은 「다른 기기에서 측정 중」을 안내한다. A가 끝내거나 연결이 끊기면 B가 바로 시작할 수 있다.

## 범위와 제외

API 메모리 세션(`LiveSessions`)·S1·실시간 hello, FE 측정 시작 오류 문구, 계약·API 명세. 로그인·refresh 정책은 바꾸지 않는다.
여러 API 인스턴스 사이의 공유 잠금, 다른 기기의 측정을 원격으로 끝내는 기능은 제외한다.

## 작업 단계

- [x] 세션 생성·실시간 연결·연결 끊김 처리 확인
- [x] 측정 중 판단(연결됨, 또는 S1 뒤 연결 전 유예)과 S1·hello 거절 구현, 단위 시험
- [x] FE 안내 문구·시험, 계약·API 명세 갱신
- [x] BE 기본 게이트, FE 시험·타입·lint

## 결정과 진행 기록

- 측정 중 = 끝나지 않은 세션이면서 실시간 연결이 붙어 있거나, S1 뒤 `posegood.realtime.measurement-claim-grace`(기본 30초)가 지나지 않음.
  S1만 하고 연결하지 않은 세션이 다른 기기를 오래 막지 않게 유예를 둔다.
- 검사는 사용자 잠금 안에서 S1과 hello 둘 다 한다. hello 거절은 기존 closed 사유를 늘리지 않으려고 `session_lost`로 둔다(드문 경합).
- 연결 끊김은 기존대로 세션을 끝내므로(ADR 0024) 별도 해제가 필요 없다. 자정 넘김의 새 세션은 같은 연결이라 연결됨으로 둔다.
- Codex가 남긴 계획 0089 미커밋 변경은 `feature/repo-email-recovery-social-link`에 먼저 커밋하고 이 브랜치를 그 위에 만들었다.

## 검증 결과와 남은 한계

- `python tools/dev.py check-backend`: API 133개(신규 2개) 통과·MySQL 전용 15개 건너뜀, processing 통과, Checkstyle·JAR 빌드 통과.
  Checkstyle 경고는 Windows 작업 트리의 CRLF 줄끝뿐이다.
- 프론트: `vitest run --maxWorkers=2` 130개 파일·1,032개 통과, `tsc -b`·`npm run lint` 오류 0.
- 실제 두 PC·브라우저 수동 확인, MySQL 통합, 전체 `make check`는 실행하지 않았다.
- 판단은 단일 API 인스턴스 메모리 기준이다. 인스턴스를 늘리면 공유 저장소 잠금이 필요하다. API 재시작 시 진행 중 측정 표시는 사라진다(세션도 SESSION_LOST).
- (2026-11-19 추가, D-98) 위 「연결 끊김이 세션을 끝내므로 별도 해제가 필요 없다」는 local 모드에서만 맞았다. kafka 모드(#134)는
  서버 엔진이 끝나지 않아 끝낸 측정이 「측정 중」으로 남았다. `session_ended`를 보낸 뒤 따로 끝났다고 표시하도록 고쳤다
  ([계획 0098](../active/0098-kafka-measurement-release.md)).
