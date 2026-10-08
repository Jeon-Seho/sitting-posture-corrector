# 브랜치와 커밋 규칙

새 작업 브랜치와 새 커밋부터 적용한다. 기존 브랜치 이름과 커밋 이력은 소급해서 바꾸지 않는다.
Git hook은 의도적으로 사용하지 않는다. 이 규칙을 위해 hook이나 자동 검사 도구를 추가하지 않는다.

## 브랜치 이름

`<type>/<scope>-<description>` 형식을 사용한다.

- 영문 소문자·숫자·하이픈만 사용한다. `/`는 유형과 작업 이름 사이에 한 번 쓴다.
- `scope`는 작업 영역이다: `frontend`, `backend`, `cep`, `model`, `db`, `devops`, `docs`, `repo`.
  여러 영역을 함께 바꾸면 `repo`를 사용한다. 영역은 폴더 이름이 바뀌어도 유지한다.
- `description`은 짧은 영문 작업 설명이다. 개인 이름·버전 번호만으로 이름을 만들지 않는다.
- `main`, `develop`, 배포용 `release`는 작업 브랜치 명명 형식의 대상이 아니다.
  기존 `main/develop` 직접 push 금지 규칙은 유지한다.

| type | 용도 | 예시 |
| --- | --- | --- |
| `feature` | 기능 추가 | `feature/backend-session-recovery` |
| `fix` | 오류 수정 | `fix/devops-timezone` |
| `refactor` | 동작을 유지하는 구조 변경 | `refactor/backend-session-store` |
| `docs` | 문서 변경 | `docs/repo-git-rules` |
| `test` | 테스트 변경 | `test/db-schema-upgrade` |
| `chore` | 의존성·빌드·CI·운영 설정 등 유지보수 | `chore/devops-compose-layout` |
| `codex` | Codex가 생성하는 작업 브랜치 | `codex/db-alert-permission` |

## 커밋 메시지

제목은 `<type>(<scope>): <summary>` 형식을 사용한다. `scope`는 위 작업 영역을 사용한다.
여러 영역에 걸친 하나의 변경은 `repo`로 표시한다. 브랜치 유형과 커밋 유형은 각각 변경 내용에 맞춰 고른다.

| type | 의미 |
| --- | --- |
| `feat` | 기능 추가 |
| `fix` | 오류 수정 |
| `refactor` | 동작을 유지하는 구조 변경 |
| `docs` | 문서 변경 |
| `test` | 테스트 추가·수정 |
| `build` | 빌드·의존성 변경 |
| `ci` | CI 설정 변경 |
| `perf` | 성능 개선 |
| `chore` | 위 유형에 해당하지 않는 유지보수 |
| `revert` | 기존 커밋 되돌리기 |

- 요약은 한국어 또는 영어로 구체적으로 쓴다. `수정`, `update`, `작업 완료`만으로 끝내지 않는다.
- 한 커밋은 하나의 목적을 담는다. 제목은 72자 이내로 쓰고 끝에 마침표를 붙이지 않는다.
- 설명이 필요하면 제목 뒤 빈 줄을 두고 변경 이유·영향을 본문에 적는다.
- 호환성을 깨는 변경은 `<type>(<scope>)!: <summary>`로 표시하고 본문에
  `BREAKING CHANGE:`로 적용·전환 방법을 기록한다.
- 자동 생성된 merge 커밋과 Git의 표준 revert 메시지는 형식 예외로 둔다. 기존 이력을 고쳐 맞추지 않는다.

```text
feat(backend): 세션 복구 API 추가
refactor(devops): Compose 서비스 설정 분리
test(db): 스키마 업그레이드 값 보존 검증
docs(repo): 브랜치와 커밋 규칙 정의
```

이 문서는 명명 규칙이다. 실행한 검증·문서 갱신 기준은 [품질 기준](docs/quality.md)을 따른다.
