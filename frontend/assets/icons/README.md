# PoseGood 이미지 모델 아이콘

내장 image_gen 도구로 단일 세트를 만들고, 밝은 초록 채움이 이질적이라는 피드백에 따라 같은 시트를 기본 단색 선형으로 편집했다. 현재 PNG43종은 편집된 시트에서 추출한다. SVG를 그리거나 각각 다른 입체 그림을 생성한 결과가 아니다. 앞서 만든 벡터와 개별 클레이 아이콘은 사용하지 않는다.

- 현재 원본: `posegood-clean-sheet.png` (실제 투명 배경). 이전 시트는 편집 참조로 보관
- 정확한 제작 프롬프트/모드: `generation-prompt.txt`, `clean-edit-prompt.txt`
- 아이콘 이름·순서·분리 좌표: `icon-manifest.json`
- 적용 PNG: `frontend/public/icons/` (128×128, 알파 보존)
- 연결부: `frontend/src/components/icons.tsx`

`node frontend/scripts/extract-icons.mjs`를 저장소 루트에서 실행하면 저장된 시트에서 브라우저 canvas로 각 셀을 분리·축소해 PNG를 재생성한다. 로컬 Chrome이 필요하다. 새 그림을 그리거나 스타일을 수정하는 과정이 아니며 별도 이미지 모델 호출은 없다.

동일한 단색 선과 둥근 형태를 공유한다. 밝은 면에서는 회색, 짙은 면에서는 옅은 회색으로 표시하며 밝은 초록 채움을 사용하지 않는다. 메뉴는28px, 설정 항목은24px로 표시한다. 버튼의 접근성 이름은 유지하고 장식 이미지는 alt가 빈 문자열이다. 작은 native 창에서도 주 창의 절대 자산 주소로 이미지를 읽는다.
