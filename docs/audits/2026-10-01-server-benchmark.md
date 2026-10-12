# 합성 서버 요청 성능 측정

이 도구는 현재 규칙 추론과 개발 서버의 HTTP 응답 완료 지연을 측정한다.
카메라·MediaPipe·프론트 렌더링·네트워크 배포 지연·학습 모델 정확도/FPS는 측정 범위에 포함되지 않는다.
성능 합격 수치는 확정하지 않았으며, CI는 응답 계약·실패 수·프로세스 정리를 확인한다.

## 실행

JDK 21·Maven과 Python 가상 환경을 준비하고 `make check-backend`로 서버 JAR를 만든다.

```sh
make benchmark-server
.venv/bin/python tools/server_benchmark.py --target both --warmup 10 --repetitions 100 --concurrency 2 --timeout 5 --output .cache/benchmarks/server-concurrency-2.json
```

Windows에서는 `python tools/dev.py benchmark-server`를 사용한다. 사용자 지정 CLI의 Python 경로는 `.venv/Scripts/python.exe`다.
도구는 자신이 시작한 임시 loopback 서버를 종료하고 포트 해제를 확인한다.
`infer`는 FastAPI `/v2/infer`, `features`는 API `/features` → FastAPI → CEP 전체 요청을 측정하며 `both`는 두 경로를 각각 측정한다.
준비 요청과 세션 생성/종료는 측정 지연에 포함하지 않는다. 병렬 worker마다 별도 세션을 사용하며 같은 세션의 순서를 유지한다.

`--warmup`과 `--repetitions`는 경로별 전체 요청 수이며 worker별 수가 아니다.
worker 수·요청 수·timeout·전체 시간 제한을 검증하여 개발 서버의 64세션·10,000관측 제한을 넘지 않는다.
기본값은 도구 시연을 위한 설정이며 목표 장치의 연구 성능 기준이 아니다.

## 결과 해석과 재현

성공한 응답의 median/p95와 처리량을 보고한다. p95는 nearest-rank 방식이다.
HTTP 오류·시간 초과·연결 실패·계약 위반·미실행 요청은 별도 집계하고 성공 지연 표본에 넣지 않는다.
실패가 있으면 보고서를 남긴 뒤 실패 종료하며 임의의 지연 기준으로 통과시켜 주지 않는다.
측정 HTTP client는 환경/OS proxy·redirect·자동 재시도를 사용하지 않는다.

JSON에는 실행 설정·시각·합성 입력 hash·코드 HEAD와 변경 소스 hash·실행 JAR hash·Python/Node/JDK·OS/아키텍처·CPU 수를 남긴다.
사용자명·호스트명·실제 자료·비밀값을 수집하지 않는다. 관련 소스만 읽고 문서·개인 자료·무시된 산출물은 hash 범위에서 제외한다.
JAR hash와 소스 hash를 함께 비교하여 다른 빌드나 수정 중인 폴더의 수치를 같은 결과로 취급하지 않는다.

보고서는 기본 `.cache/benchmarks/`에 보관한다. 결과 수치는 실행 환경·동시 요청 수·합성 입력·워밍업에 따라 달라진다.
실제 장치의 카메라→화면 처리량과 장시간 동작은 별도 검증한다.

## 이번 실행 결과

2026-10-01, Darwin 27.0.0 arm64·논리 CPU 8개, CPython 3.9.6·Node 24.18.0·Corretto JDK 21.0.12.1에서 실행했다.
두 경로 모두 warmup 10개·측정 100개, socket timeout 5초·대상 scheduling 제한 300초다.
세션 정책은 3초/2초/60초·변화 점수 기준 0.7, 고정 합성 lateral 변화 입력과 `reference-feature-rule-v1`을 사용했다.

| 동시 worker | 경로 | 성공/실패/미실행 | median ms | p95 ms | 성공 요청/초 |
| --- | --- | --- | --- | --- | --- |
| 1 | 추론 단독 | 100/0/0 | 1.877 | 3.110 | 424.631 |
| 1 | API→추론→CEP | 100/0/0 | 9.755 | 13.360 | 86.344 |
| 2 | 추론 단독 | 100/0/0 | 6.944 | 13.590 | 228.187 |
| 2 | API→추론→CEP | 100/0/0 | 23.227 | 33.538 | 72.950 |

결과는 `.cache/benchmarks/server-concurrency-1.json`과 `server-concurrency-2.json`이다.
실행 전후 소스 fingerprint가 같았고 준비·종료·응답 계약 검증과 3서비스 포트 정리를 통과했다.
HEAD는 `311b89ad9e34143f50c6aecb909a9269b4b4ba7b`이며 수정 중인 소스는 JSON의 별도 SHA-256으로 식별한다.
API·CEP JAR 및 fixture hash도 보고서에 포함한다. 수치는 이 합성 HTTP 실행의 관찰값이며 배포 성능 보장이 아니다.
동시 1개/2개는 같은 코드·JAR·fixture로 차례로 실행했다. worker별 세션 길이와 사건 수, 로컬 client의
thread/검증 비용이 달라질 수 있으므로 서버 연산 성능이나 최대 용량·선형 확장률로 해석하지 않는다.
