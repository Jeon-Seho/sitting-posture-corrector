# 개발자 실험실 경계

- `/dev` 전용 UI·세션·표시 데이터는 이 디렉터리에서 관리한다.
- 일반 서비스에서 이 디렉터리를 import하지 않는다. 앱의 지연 로딩 진입만 예외다.
- 공통 카메라 관측은 재사용하되 서비스의 등록·저장·알림 함수를 호출하지 않는다.
- 구도·기준 대비 기하 계산은 `model/prototype/developerGuidance.ts`, 연구 판정은 `forecast.ts`가 소유한다.
- 얼굴/어깨 live·reference 좌표는 표시용 메모리에만 둔다. 진단 export에 추가하지 않는다.
- 관측 리플레이는 사용자 요청에 따른 별도 예외다. Pose 0..12번 image/world만 유한 메모리에 두고 명시적인 키포인트 JSON 다운로드/불러오기를 허용한다. 영상·자동 저장·업로드·진단 CSV·자동 학습에는 추가하지 않는다([ADR 0041](../../../../docs/decisions/0041-observation-keypoint-replay.md)).
- 정상 자료는 수동 30초 확인 수집(`normal-posture-collection-v1`)과 `/dev` 실제 측정의 선택 기준 이하 자동 선별(`normal-posture-auto-collection-v2`, 기본 6%·0.5/3/6% 선택, 과거 v1은 0.5%)을 구분한다. 자동 라벨은 미검토 규칙 약라벨이며 별도 수동 다운로드에서만 원본을 내보낸다. 자동 fitting·기준 갱신·영구 저장·업로드는 하지 않는다.
- 현재 자동 선별은 종합 0.5배 이내·실측 룰 범위 안·연속 1초를 함께 요구한다. 이전 선별 행을 새 정책 통과로 바꾸지 않는다. `reviewGate` 자료는 학습 준비에서 차단한다([ADR 0035](../../../../docs/decisions/0035-posture-and-clean-normal-selection.md)).
- 예측 표시에는 실제 predict 출력 13점과 해당 입력 시각만 사용한다. 기준 대비 룰 값을 미래 좌표로 표시하지 않으며 표시 좌표는 진단 export에서 제외한다.
- CSS는 `.dev-lab` 범위, 키프레임은 `dev-`/`dc-` 접두사를 사용한다. 기본 다크 및 저감 모션을 유지한다.
- 서비스 승격은 [모듈 안내](README.md)의 독립 추출·검증 절차로 한다.
- `face/`의 Face 윤곽·bitmap·비교 집계는 /dev 메모리 전용이다. Face 상대z를 기존 Pose world39D에 섞지 않고 정상 수집·진단 export에 추가하지 않는다. [얼굴 추적 결정](../../../../docs/decisions/0037-developer-face-landmarker.md)을 따른다.

- `/dev`의 커스텀 세로 스크롤은 `ObservationScrollPanel`을 재사용한다. 네이티브 스크롤바 대신 더 볼 내용이 있는 위/아래 중앙에 배경 없는 부유 막대를 표시한다. 도움말·설정 팝업도 같은 규칙을 따른다. 키보드/트랙패드 조작·초점·누락 없는 내용 접근과 reduced-motion을 유지한다.
