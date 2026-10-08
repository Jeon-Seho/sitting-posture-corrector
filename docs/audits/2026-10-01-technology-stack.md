# 기술 스택 검토

- 확인일: 2026-10-01
- 범위: 저장소에 실제로 쓰는 기술, 공식 유지보수·폐기 안내, 요구사항별 대안
- 결과: 조사·보고만 수행했다. 프레임워크, 라이브러리, 버전, 의존성 파일은 변경하지 않았다.

현재 핵심 스택인 React·TypeScript·Vite·MediaPipe Tasks·Spring Boot·FastAPI는
공식 문서가 안내하는 현행 개발 경로다. 오래 존재한 기술이라는 이유만으로 교체할 근거는 없다.
다만 실제로 사용하는 `react-test-renderer`는 공식 폐기 대상이며,
Spring Boot 3.5의 OSS 지원과 문서의 Python 3.9·Maven 3.6 최소 환경은 별도 점검이 필요하다.

이 문서는 인기 순위나 시장점유율을 조사한 결과가 아니다. 공식 문서의 지원 상태와
이 앱에 필요한 기능을 기준으로 판단했으며, 대안의 성능 우위는 실측하지 않았다.
아래의 도입 시점·우선순위는 저장소 요구사항을 바탕으로 한 검토 의견이다.

## 실제 채택과 계획 구분

확인한 근거는 [프론트 의존성](../../frontend/package.json), [Java 모듈](../../backend/pom.xml),
[Python 의존성](../../requirements-dev.txt), [선택 분석 환경](../../model/analysis/requirements.txt),
[아키텍처](../architecture.md), [서비스 안내](../../backend/README.md), [인계](../development-handoff.md)다.

| 영역 | 실제 구현 | 아직 구현하지 않은 계획 |
| --- | --- | --- |
| 프론트 | React 18·TypeScript, Vite, Vitest, 직접 작성한 CSS·화면 전환·hooks | URL 라우터, 서버 데이터 캐시, SSR |
| 포즈 추적 | `@mediapipe/tasks-vision`의 PoseLandmarker, Lite 모델, 브라우저 개인 기준 규칙 | 학습된 자세 시계열 모델 |
| Java 서비스 | Java 21·Spring Boot 3.5.16·Maven, API/계약/CEP 3개 모듈, Esper 9의 EPL | 영구 저장, 인증, 사용자별 접근 격리, 분산 복구 |
| 추론 HTTP | FastAPI·Pydantic 2·Uvicorn·HTTPX, 정규화 특징의 규칙 점수 | LSTM/GRU 학습·서빙, 실제 프론트 특징 어댑터 |
| 로컬 기록 | localStorage, Web Locks로 여러 탭의 쓰기 조정 | 서버 동기화, 계정별 기록 저장 |
| 연구 분석 | 선택 환경의 pandas·Matplotlib, CSV 분석 | Kafka·Redis·HDFS·Spark 파이프라인, 외부 DB |

프론트는 로컬 시간 엔진과 로컬 저장을 사용한다. API·Esper·FastAPI는 별도의 합성 HTTP 흐름이며,
실제 브라우저 카메라 입력과 연결하지 않았다. Java 저장도 프로세스 메모리다.
기술 지원 여부가 운영 준비나 모델 정확도를 뜻하지 않는다. [현재 한계](../../backend/README.md)

## 기술별 판단

| 기술 | 판단 | 공식 근거와 이 프로젝트의 의미 |
| --- | --- | --- |
| React·TypeScript·Vite | 지속 사용 가능 | React는 Vite의 React/TypeScript 구성을 직접 안내하고, TypeScript도 공식 문서·릴리스 안내를 제공한다. 현재 SPA 빌드 도구 선택을 과거 방식으로 볼 근거가 없다. [React의 직접 구성 안내](https://react.dev/learn/build-a-react-app-from-scratch), [Vite](https://vite.dev/guide/), [TypeScript](https://www.typescriptlang.org/docs/) |
| Vitest | 지속 사용 가능 | Vite 환경에 맞는 테스트 러너이며 공식 문서에 일반 테스트와 브라우저 컴포넌트 검증 경로가 있다. 테스트 렌더러의 문제와 러너 교체는 별개다. [Vitest](https://vitest.dev/guide/) |
| react-test-renderer | 교체 검토 우선 | React 공식 문서는 유지보수 중단과 새 React 기능에서의 파손 가능성을 명시하고 React Testing Library를 권고한다. 앱·카메라·세션·잠금 hook 테스트가 실제로 이 렌더러를 사용한다. [React 폐기 안내](https://react.dev/warnings/react-test-renderer) |
| MediaPipe Tasks Vision | 현행 API 사용 | 공식 Web Pose Landmarker는 현재 저장소와 같은 패키지·API를 안내한다. 과거 Legacy Pose는 새 Pose landmark detection으로 전환됐으므로 이미 새 경로를 사용하고 있다. 라이브러리 교체보다 기기별 지연·가림·추적 품질 검증이 먼저다. [Web 안내](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [Legacy 전환 안내](https://developers.google.com/edge/mediapipe/solutions/guide) |
| Spring Boot·Java | 지속 사용 가능 | Spring Boot는 독립 실행 REST 서비스, 검증, 설정·운영 지원을 제공하는 현행 프로젝트다. Java 21은 LTS 계열이다. Java라는 이유로 Node/Go 계열에 다시 작성할 근거는 없다. 채택한 Boot 버전의 지원 종료는 아래에서 따로 다룬다. [Spring Boot](https://spring.io/projects/spring-boot), [Java 지원 로드맵](https://www.oracle.com/java/technologies/java-se-support-roadmap.html) |
| Maven | 지속 사용 가능 | Apache가 Maven 3.9 계열을 유지하고 Maven 4 개발을 안내한다. XML 사용 자체는 교체 이유가 아니다. 현재 Java 모듈에는 Gradle로 이동해야 할 기능 요구가 확인되지 않았다. [Maven 지원·릴리스](https://maven.apache.org/docs/history.html) |
| Esper | 특수 목적 기술 | 범용 웹 프레임워크가 아닌 EPL 기반 사건·시간 조건 엔진이다. 공식 API와 릴리스가 제공되며 확인한 릴리스 목록은 9.0.0을 최신으로 표시한다. 현재 요구인 시간 규칙의 단일 소유와 맞지만, 이것만으로 향후 분산 복구까지 해결되지는 않는다. [Esper](https://www.espertech.com/esper/), [공식 릴리스](https://github.com/espertechinc/esper/releases), [공개 런타임 API](https://esper.espertech.com/release-9.0.0/javadoc-runtime/index.html) |
| FastAPI·Pydantic 2 | 지속 사용 가능 | FastAPI 공식 구성은 Starlette의 웹 처리와 Pydantic의 데이터 검증이다. 현재 타입·검증 중심 추론 HTTP 경계와 맞으며 Flask/Django로 바꾸어야 할 폐기 안내는 확인하지 않았다. [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://pydantic.dev/docs/validation/latest/get-started/) |
| localStorage·Web Locks | 로컬 용도에는 유효 | Web Storage는 브라우저 저장 API지만 동기식이며, 큰 데이터에는 IndexedDB 같은 비동기 저장을 검토할 수 있다. Web Locks는 같은 origin의 탭·worker 조정을 정의하는 현행 W3C 초안이다. 이 둘은 서버 인증·다중 기기 동기화의 역할을 제공하지 않는다. [Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API), [Web Locks 초안](https://www.w3.org/TR/web-locks/) |

직접 작성한 CSS, React hooks, 작은 상태 기계도 그 자체로 과거 기술이 아니다.
이 저장소의 가독성 문제는 한 파일에 섞인 책임과 압축한 코드다.
CSS 프레임워크나 전역 상태 라이브러리를 추가하는 일과 기능별 모듈을 읽기 쉽게 나누는 일은 독립적이다.

## 현재 대안과 도입 조건

아래는 채택 결정이 아니라 후속 검토 후보다. 사용자 요청에 따라 설치하거나 전환하지 않았다.

| 요구가 생길 때 | 검토 후보 | 도입 조건과 판단 |
| --- | --- | --- |
| URL별 화면, 새로고침 복원, 깊은 링크 | React Router | React 공식 문서는 React Router와 Vite를 함께 쓰는 경로를 안내한다. 현재 탭 상태 전환이 제품 요구를 만족하는 동안 교체를 강제할 필요는 없다. [React 권장 프레임워크](https://react.dev/learn/creating-a-react-app) |
| 공개 페이지 검색 노출, 서버 렌더링, 서버 컴포넌트 | Next.js App Router 또는 React Router의 framework 구성 | React는 새 앱에 프레임워크 사용을 권고하면서 Vite 직접 구성도 안내한다. 현재 카메라·로컬 저장 중심 앱에는 이 기능의 필수 요구가 확인되지 않았다. 프레임워크 자체는 CSR도 지원하므로 단순히 SPA라는 이유로 배제하지 않고 운영·화면 요구로 비교한다. [React의 프레임워크 안내](https://react.dev/learn/creating-a-react-app) |
| 서버 기록의 캐시·갱신·비동기 오류 관리 | TanStack Query | 공식 역할은 서버 상태의 조회·캐시·동기화다. 실제 API 연결 뒤 수동 비동기 로직이 복잡해질 때 검토한다. 고빈도 카메라 프레임 버퍼나 개인 기준 알고리즘의 대체 도구로 쓰지 않는다. [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) |
| DOM에서 사용자 행동을 검증하는 컴포넌트 테스트 | React Testing Library | React의 폐기 안내가 직접 권고하는 경로다. 기존 테스트가 검증하는 저장·취소·복구 동작을 보존하며 옮겨야 한다. [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), [React의 권고](https://react.dev/warnings/react-test-renderer) |
| 브라우저별 통합 검증, 여러 탭·저장·권한 화면 | Playwright 또는 Vitest Browser Mode | Playwright는 Chromium·Firefox·WebKit을 지원하는 E2E 도구다. 브라우저 자동화로 검증할 수 있는 흐름을 정의한 뒤 선택한다. 실제 카메라 품질·추론 지연은 별도 기기 측정이 필요하다. [Playwright](https://playwright.dev/docs/intro), [Vitest Browser Mode](https://vitest.dev/guide/) |
| 카메라 추론으로 화면이 느려지는 현상이 실측될 때 | Web Worker로 MediaPipe 실행 분리 | 공식 문서는 `detectForVideo()`가 동기 실행으로 main thread를 막는다고 설명하고 worker를 제안한다. 현재 호출도 브라우저 스레드에서 실행하므로 p95 지연·UI 반응을 측정한 뒤 검토할 수 있다. API 또는 모델 교체 없이도 가능한 실행 구조 개선이다. [MediaPipe Web 실행](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) |
| 서버 기록·계정·삭제·재시작 복구 | 영구 DB와 인증·접근 통제 | 프론트 로컬 저장과 서버 메모리 저장의 제품 한계를 해결할 요구다. DB 후보와 저장 계약은 아직 미확정이며, 특정 DB를 유행만으로 선정하지 않는다. [저장·후속 결정](../../backend/README.md) |
| 다수 생산자·소비자, 사건 재생, 분산 상태 복구 | Kafka Streams 또는 Flink/FlinkCEP | Kafka Streams는 Kafka의 입출력·상태 복구를 전제로 하는 라이브러리다. FlinkCEP는 Flink에서 사건 패턴을 탐지한다. 이들은 단순히 Esper보다 새로운 이름이라 교체하는 도구가 아니다. 처리량, 지연 입력·event time, 장애복구, 운영 비용 요구를 정의하고 현재 사건 계약으로 비교해야 한다. [Kafka Streams](https://kafka.apache.org/41/streams/introduction/), [FlinkCEP](https://nightlies.apache.org/flink/flink-docs-stable/docs/libs/cep/) |

## LSTM과 과거 계획서의 데이터 기술

LSTM은 현재 앱에 연결된 구현이 아니다. 웹캠은 개인 기준 규칙,
FastAPI는 `baseline-feature-rule-v1` 점수를 사용한다. GRU·LSTM은 연구 계획에서 비교 설계를 정리할 후보다.
[연구 프로토콜](../research/protocol.md), [서버 한계](../../backend/README.md)

LSTM은 오래된 모델 계열이지만 현재 Keras와 PyTorch가 공식 레이어로 제공한다.
시계열 분류의 대안으로 TCN과 작은 Transformer를 비교할 수 있다.
TCN의 원 연구와 Keras의 Transformer 분류 예제는 대안이 존재한다는 근거이며,
이 앱의 자세 데이터·참여자 일반화·오알림률에서 더 좋다는 증거는 아니다.
[Keras LSTM](https://keras.io/api/layers/recurrent_layers/lstm/),
[PyTorch LSTM](https://docs.pytorch.org/docs/2.9/generated/torch.nn.LSTM.html),
[TCN 연구](https://arxiv.org/abs/1803.01271),
[Transformer 시계열 분류 예제](https://keras.io/examples/timeseries/timeseries_classification_transformer/)

모델 선택은 참여자 단위 분할, 동일 특징·창·라벨,
Macro-F1·시간당 오알림·감지 지연·p95 추론 지연을 기준으로 해야 한다.
현재 측정 결과 없이 Transformer를 최신 정답으로 확정하지 않는다.
[저장소 연구 기준](../research/protocol.md)

Kafka·Redis·HDFS·Spark는 현재 의존성에 없는 후속 구상이다.
Redis는 현재 공식 개발 안내를 제공하고, 과거 계획의 DB 후보 MySQL도 공식 참조 문서를 제공한다.
이들의 존재 자체를 과거 기술로 판정하거나 새로운 이름의 제품으로 대체할 근거는 확인하지 않았다.
[Redis 개발 안내](https://redis.io/docs/latest/develop/get-started/),
[MySQL 참조 문서](https://dev.mysql.com/doc/refman/8.4/en/introduction.html)

HDFS는 대규모 데이터·높은 처리량을 위한 분산 파일 저장,
Spark는 분산 처리라는 별도의 목적을 가진다. 두 프로젝트 모두 현행 공식 문서를 제공한다.
[HDFS 아키텍처](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html),
[Spark](https://spark.apache.org/)

Spark는 클라우드 객체 저장과도 통합할 수 있으므로 Spark를 검토한다고 HDFS를 필수로 추가할 이유는 없다.
현재 로컬 CSV 연구 규모에서 클러스터가 필요한지는 측정하지 않았다.
Redis·Kafka도 캐시·전달·재생·복구 목적과 계약이 정해지기 전에는 도입 결정을 하지 않는다.
[Spark 클라우드 통합](https://spark.apache.org/docs/latest/cloud-integration.html), [서버 후속 결정](../../backend/README.md)

## 기술 교체와 별개인 지원주기 점검

사용자의 초점은 기술 자체의 적합성이지만, 명시적으로 확인된 지원 종료는 함께 보고한다.
이 표도 버전 또는 실행 환경을 변경한 기록이 아니다.

| 확인 대상 | 확인 결과 | 후속 검토 |
| --- | --- | --- |
| Spring Boot 3.5.16 | 공식 2026-06-25 발표가 3.5 계열의 마지막 OSS 릴리스이며 OSS 지원을 위해 4.0/4.1로 이동하라고 명시한다. [공식 발표](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/) | 운영 전에 지원되는 계열과 전이 의존성·Esper 호환성을 별도 검증한다. Spring Boot 기술 자체의 폐기를 뜻하지 않는다. |
| Python 최소 3.9 | 저장소 문서와 의존성 주석의 최소 환경이다. Python 공식 상태표는 3.9의 지원 종료를 2025-10-31로 표시한다. [공식 지원 상태](https://devguide.python.org/versions/) | 실행 환경·CI의 지원 범위를 재정의할 후속 과제다. FastAPI 기술을 바꿀 이유와는 다르다. |
| Maven 최소 3.6.3 | 문서상의 최소 조건이다. Apache는 3.8.9 이하의 지원 종료와 유지보수되는 3.9 계열을 안내한다. Maven 4는 확인일에 아직 GA 이전이다. [공식 지원 상태](https://maven.apache.org/docs/history.html) | Maven을 유지하더라도 팀 실행 환경의 지원 기준을 점검한다. Gradle 전환은 별도의 생산성 비교가 필요하다. |
| Node 24 기준·Java 21 | Node 24는 공식 LTS 목록에 있고 Java 21도 LTS다. 최소 버전 이상이라는 문구가 모든 상위 버전의 지원을 보증하지는 않는다. [Node 상태](https://nodejs.org/en/about/previous-releases), [Java 로드맵](https://www.oracle.com/java/technologies/java-se-support-roadmap.html) | 실제 팀·CI 배포 런타임을 고정하고 배포판의 지원 정책을 함께 확인한다. |

## 보고 후 우선순위

1. 구조 정리는 현재 도구로 진행한다. 기능별 책임·공개 경계와 정상 동작을 보존한다.
2. 별도 승인된 후속 변경에서 폐기된 테스트 렌더러와 지원 종료 환경을 먼저 정리한다.
3. 서버 연결·영구 저장·인증 요구를 구체화하고, 그때 라우팅·서버 상태 도구를 비교한다.
4. 실제 기기 지연과 참여자 평가 후 추론 실행 위치·시계열 모델·분산 처리 도구를 결정한다.

이 조사에서는 새 도구를 설치하거나 스택을 교체하지 않았고,
테스트·타입·빌드·카메라 QA를 별도로 실행하지 않았다. 구조 변경의 전체 검증은 해당 작업 기록에서 확인한다.
