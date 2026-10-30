# 최신 develop에 프론트 보호 기능 통합

- 상태: completed
- 담당: FE
- 시작일: 2026-10-29
- 기반: origin/develop a793405

## 범위

기존 작업 6a2f765는 codex/frontend-api-v2-integration에 보존한다.
최신 JWT 인증·카메라·서버 측정 구현을 정본으로 유지하고 가계정, 계정별 미확인 기록 보관,
서버 정본 우선 조회, 로그아웃 보호와 협업 문서를 통합한다.
서버는 종료 때 직접 기록을 저장하므로 옛 POST records 재전송 흐름 대신 R1 저장 확인 후 로컬 임시 자료를 정리한다.

## 완료 기준

- [x] admin/1234 이메일 검사 우회, 서버 권한 없는 화면 진입
- [x] JWT 상태 경계와 계정별 미확인 자료 보호
- [x] 최신 서버 REST/WS 및 프론트 회귀 검증
- [x] 문서·검증 한계·PR 작성

## 검증 결과와 한계

- FE: 295개 단위 검사, TypeScript, Vite 생산 빌드 통과. 500 kB 번들 경고는 남는다.
- 실제 SSH 서버: REST 26/26, WebSocket 13/13 통과.
- 별도 Chrome: admin 진입 후 API 호출 없음, JWT 일반 로그인·새로고침 복원·R1·서버 프로필 저장·합성 계정 탈퇴 통과.
- check-repo 및 git diff --check 통과.
- check-browser는 Docker 엔진 부재로 임시 MySQL 시작 실패. 전체 check, 실제 카메라, Electron 재패키징·배포 미수행.
- 일반 프로필 변경은 저장 직전 비교를 제공한다. 원자적 버전 충돌 처리는 BE 계약이 필요하다.
- 과거 T1 통계·전체 workspace 설정 동기화 등 남은 협업 범위는 [인계서](../../design/frontend-jwt-handoff-2026-10-29.md)에 구분했다.
- Docker 기반 회귀가 남아 있으므로 PR은 draft로 제출한다. 운영 반영·develop 직접 push는 하지 않는다.
