# 프론트 카메라 복구와 개발자 진단 보완

- 상태: completed
- 담당: Codex
- 시작일: 2026-10-30
- 관련 요구사항/ADR: 사용자 요청의 여섯 가지 후속 조치, ADR 0021

## 문제와 완료 기준

개발자 접근 제한을 직접 주소에도 적용하고 테스트 미리보기가 실제 경고에 영향을 주지 않게 한다.
CPU 추론의 메인 스레드 점유를 줄이고 실제 실패 복구 함수를 합성 테스트 UI에서 확인한다.
예상된 오류 로그를 HTTP 응답과 대조해 브라우저 검증의 오탐을 줄인다.

## 범위와 제외

프론트 카메라·개발자 도구·브라우저 검증. 서버 판정·계정 권한·계약은 변경하지 않는다.
실제 카메라 영상이나 좌표를 테스트에 사용하지 않는다.

## 작업 단계

- [x] 관련 문서와 현재 구현 확인
- [x] 접근 제한·미리보기 격리·복귀·실패 재현 구현
- [x] CPU Worker 및 미지원 환경 복구 구현
- [x] 문서 동기화
- [x] 범위별 검증 실행과 결과·환경 제한 기록

## 결정과 진행 기록

고정된 MediaPipe 패키지의 vision_bundle.js(IIFE)와 로컬 WASM을 classic Worker에서 로드한다.
ImageBitmap은 한 장씩 전송하고 처리·취소 뒤 닫는다. GPU 경로는 유지하며 CPU Worker 초기화 실패 시 기존 CPU로 복구한다.
성능 수치는 합성 검은 캔버스 첫 추론의 관찰이며 실제 사용자 FPS나 가속 ON/OFF 비교 결과가 아니다.

## 검증 결과와 남은 한계

- `python tools/dev.py check-frontend`: Vitest 330개 + Node 5개 통과, TypeScript·Vite 빌드 통과.
- `python tools/dev.py check-repo`: 구조·로컬 링크·산출물 검사 통과.
- `npm --prefix frontend run test:cpu-worker`: 실제 Chrome + MediaPipe CPU/WASM에 합성 검은 640×480 캔버스 입력. 첫 프레임 약 278ms 동안 메인 스레드 5ms 타이머 55회 실행, 감지된 사람 0, 예상하지 못한 콘솔 오류 없음.
- Chrome 개발자 페이지 UI 검증: GPU→CPU 성공/양쪽 실패/시간 초과/취소의 결과와 진단 로그 횟수 확인, 연결 끊김 테스트에서 개발자 페이지 복귀 확인, 실제 카메라 요청 0.
- `python tools/dev.py check-browser`: 생산 번들의 합성 카메라 제외 검사는 통과. Docker Desktop Linux engine 미실행으로 MySQL 준비 단계 실패, 전체 앱·서버 통합 검증은 미완료.
- 실제 카메라, 하드웨어 가속 ON/OFF 성능 비교, 장시간 측정, 다른 브라우저는 미검증. 번들 500kB 경고는 남아 있다.
