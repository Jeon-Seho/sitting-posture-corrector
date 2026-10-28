# FE 배포: 도메인 + Vercel + Cloudflare 터널

> 작성자: klaod-tech(FE) · 작성: 2026-10-19 · 최신화: 2026-10-28(포크 `dae2fb1` 최신화, 빌드 건너뛰기를 마지막 배포본 기준으로, 같은 커밋 다시 배포는 빌드, 운영 `VITE_API_BASE_URL` 넣음) · 2026-10-26(포크 최신화 기록. 저녁: V3를 develop에 합치는 조건 정정 — 6장) · 2026-10-25(3.2 「지금 앱」 칸을 V3 코드로, `VITE_REALTIME_URL` 삭제 반영, 검색 노출 막기 끝남) · 2026-10-22(이름 `fe-domain-idea.md` → `fe-deploy.md`, 데스크톱 앱 구조는 [FE 제안서](fe-server-proposal.md) 8.4로 옮김) · 상태: **진행 중**(도메인·Cloudflare·Vercel 연결됨, 서버 터널은 DevOps) · 대상: FE, DevOps(터널·nginx), BE(CORS·출처 허용)
> 관련: [FE 제안서](fe-server-proposal.md) 2장 「배포」·1장 DevOps 질문(HTTPS)·F14·8.2(연결 설정), [연동 명세](api-ws-spec.md) 1장, [ADR 0024](../decisions/0024-session-ends-on-lost-connection.md)

## 1. 왜 바꾸나

- **화면을 조금 고칠 때마다 서버를 다시 올리는 건 맞지 않다(10/19).** 화면은 서버와 따로 배포하고, 서버는 API만 맡는다.
- **공개 배포는 HTTPS가 필요하다.** 브라우저·Electron은 `https://`(또는 `localhost`)에서만 카메라를 켜고, 로그인 유지 쿠키(refresh, Secure)·`wss://`도 HTTPS가 전제다.
- 화면은 Vercel이 무료로 HTTPS를 준다. 남는 것은 서버(API·WebSocket)의 HTTPS 하나이고, 도메인 하나와 Cloudflare 무료 터널로 푼다.

## 2. 정한 것 (10/19)

| 항목 | 결정 |
|---|---|
| 도메인 | **`posegood.site`** — klaod-tech 개인 계정, 가비아에서 10/19 구입(첫해 3,300원, 1년. 연장 가격은 따로 확인). 화면 `app.posegood.site`, 서버 `api.posegood.site` |
| DNS | Cloudflare 무료. 등록 사이트의 네임서버를 Cloudflare로 바꾼다 |
| 화면 | `app.<도메인>` → Vercel(내 도메인 연결은 무료). Cloudflare에서 이 레코드는 프록시 끔(DNS only). Vercel 프로젝트는 **klaod-tech의 포크**(`klaod-tech/sitting-posture-corrector`)에 연결한다(10/19, 아래 진행 기록) |
| 서버 | `api.<도메인>` → Cloudflare 이름 있는 터널(named tunnel) → 팀 서버 nginx. 터널은 도메인이 있는 klaod-tech의 Cloudflare 계정에서 만들고, DevOps는 그 연결 토큰으로 서버에서 `cloudflared`를 띄운다 |
| 데스크톱 앱 | 화면을 PC 파일(`app://posegood`)이 아니라 `https://app.<도메인>`에서 연다(FE 제안서 2장 「배포」, F14). 화면 수정은 Vercel 배포만으로 데스크톱에도 반영된다 |

```
브라우저 / 데스크톱 앱
  ├─ https://app.<도메인>                 Vercel (화면 파일만, PR마다 미리보기 주소)
  ├─ https://api.<도메인>/api/v2/…        Cloudflare 터널 → nginx → BE API
  └─ wss://api.<도메인>/api/v2/realtime   같은 경로 (WebSocket)
```

## 3. 분리하면 바꿀 것 (BE 브랜치 `a0d99a3` 코드로 확인, 10/19)

화면(`app.`)과 API(`api.`)는 **출처는 다르고 사이트는 같다**(같은 도메인 아래 하위 주소).
**API·WS의 판정 흐름과 계약(REST, WebSocket v2)은 다시 할 것이 없다.** 서버 코드에서 새로 할 것은 CORS 하나이고, 나머지는 설정값이다.

### 3.1 서버 쪽

| # | 항목 | 지금 BE | 분리 뒤 | 종류 | 누가 |
|---|---|---|---|---|---|
| S-1 | **CORS** | 설정이 없다(10/25 develop `3285cce`에도 없음. `SecurityConfiguration`에 `.cors()` 없음). 다른 출처의 요청은 브라우저가 먼저 보내는 확인 요청(OPTIONS)부터 로그인 필요로 막힌다 | 허용 출처 `https://app.<도메인>`, 쿠키 포함 허용(refresh 쿠키), 메서드 GET·POST·PUT·DELETE, 헤더 `Content-Type`·`Authorization`·`X-PoseGood-User-Id`(토큰 로그인 뒤 `X-CSRF-TOKEN` 없음, BE ADR 0031). 10/27 BE 토큰 브랜치에도 REST `.cors()`는 아직 없다(FE 제안서 BE-12 ②). 확인 요청은 로그인 없이 통과. 허용 출처는 WS처럼 환경 변수로 | **코드** | BE |
| S-2 | 로그인 쿠키 Secure | `server.servlet.session.cookie.secure=${POSEGOOD_COOKIE_SECURE:false}`(토큰 로그인 뒤에는 refresh 쿠키 `posegood_refresh`에 같은 변수, 그리고 `POSEGOOD_JWT_SECRET` 32바이트 이상 필수) | `POSEGOOD_COOKIE_SECURE=true` | 설정 | BE·DevOps |
| S-3 | WS 허용 출처 | `POSEGOOD_REALTIME_ALLOWED_ORIGINS` 비어 있음 = 같은 출처만 | `https://app.<도메인>`(`/v1`·`/v2` 둘 다 이 값을 씀) | 설정 | DevOps |
| S-4 | nginx 화면 파일 | `default.conf`가 API와 함께 화면(`/`, `/mediapipe/`)도 낸다 | 화면은 Vercel이 내므로 `api.`에서는 필요 없다. 지워도 되고 둬도 해는 없다 | 설정 | DevOps |
| S-5 | nginx `X-Forwarded-Proto` | `$scheme`을 넘긴다 | 터널(cloudflared) → nginx 구간은 HTTP라 `http`로 넘어간다. 10/22 기준 서버는 이 값을 쓰는 곳이 없어 당장 문제는 없지만, 나중을 위해 `https`로 고정하는 것을 권한다 | 설정 | DevOps |
| S-6 | 터널 | 없음 | 이름 있는 터널 `api.<도메인>` → nginx(80). 경로 `/api` 접두사는 지금처럼 nginx가 뗀다 | 설정 | DevOps |

**바꾸지 않아도 되는 것:**
- **CSRF:** 토큰을 세션에 두고 `GET /v2/auth/csrf` 응답 본문으로 준다(`HttpSessionCsrfTokenRepository`). 쿠키에서 읽는 방식이 아니라서, 출처가 달라도 응답을 읽어 헤더로 보내면 된다. **토큰 로그인(BE ADR 0031, 10/27 BE 브랜치) 뒤에는 CSRF가 없다.**
- **SameSite=Lax:** `app.`과 `api.`는 같은 사이트라 HTTP 요청과 WS 연결 모두에 쿠키가 실린다. 쿠키 `Domain` 지정도 필요 없다(`api.` 쿠키면 됨). 토큰 로그인 뒤에는 refresh 쿠키만 이 규칙을 따르고, 요청 인증은 `Authorization: Bearer`, WS는 `hello.access_token`이다.
- **WS 계약, 판정:** 그대로다(토큰 로그인 뒤 `hello`에 `access_token` 필수). 로그인 30분 고정은 토큰 로그인으로 없어진다(access 30분을 refresh 14일로 계속 갱신).

**주의:** Vercel 기본 주소(`*.vercel.app`)에서 열면 `api.<도메인>`과 **다른 사이트**라 Lax 쿠키가 실리지 않아 로그인이 안 된다(토큰 로그인 뒤에도 refresh 쿠키가 안 실려 로그인 유지가 안 된다. 설치용 데스크톱 앱의 `app://posegood`도 같다 — F14로 `https://app.<도메인>`을 열어야 한다). 실제 서버는 `app.<도메인>`에서만 쓰고, 미리보기는 가짜 서버로 띄운다(4장 3단계). 미리보기 주소는 서버 허용 목록에 넣지 않는다.

### 3.2 앱 쪽

| # | 항목 | 지금 앱 | 분리 뒤 |
|---|---|---|---|
| A-1 | API 주소 | **10/19 끝남:** `VITE_API_BASE_URL`(`features/platform/serverConfig.ts`, 요청은 `features/platform/api.ts`). 비우면 같은 출처 `/api/…`, 개발은 Vite 중계 | 운영은 `VITE_API_BASE_URL=https://api.<도메인>` |
| A-2 | 쿠키 보내기 | **10/19 끝남:** `credentials: 'include'`(`api.ts`·`accountClient.ts`) | 그대로(출처가 달라서 `same-origin`으로는 안 실린다). 토큰 로그인 뒤에는 refresh 쿠키 때문에 유지 |
| A-3 | WS 주소 | **10/21 바꿈:** `VITE_REALTIME_URL`을 지우고 API 주소(없으면 페이지 주소)에서 만든다(`https:`면 `wss:`) | `VITE_API_BASE_URL`만 넣으면 `wss://api.<도메인>/api/v2/realtime`가 된다 |
| A-4 | 계정 | 10/22부터 항상 서버 계정(`accountClient.ts`, 스위치 없음 — Vercel에 계정용 환경 변수를 넣지 않는다) | 다른 출처라 CORS·`POSEGOOD_COOKIE_SECURE=true`가 있어야 로그인 쿠키가 실린다 |

- **WebSocket 유지:** 앱은 측정 중 계속 구간을 보내므로(10/27부터 프레임마다, 초당 약 10개) 터널·서버의 유휴 끊김(서버 120초)에 걸리지 않는다. Cloudflare 터널에서 WS가 끊기는 사례가 있다는 글이 있어 실제로 확인한다(DevOps·FE).

## 4. 진행 단계

- [ ] **0. 도메인·DNS (klaod-tech):**
  1. [x] 도메인 구입: 10/19 `posegood.site`(가비아, 첫해 3,300원. 해외 업체는 카카오페이를 받지 않아 국내 업체). 웹 호스팅·메일·SSL 같은 부가 상품은 사지 않음.
  2. [x] Cloudflare 연결: 10/19 Free 요금제로 도메인 추가, 가비아 네임서버 3개를 지우고 `cris.ns.cloudflare.com`·`margaret.ns.cloudflare.com`으로 바꿈. 10/20 **Active**. SSL/TLS 모드는 기본 Full 그대로, **Always Use HTTPS 켬**(서버 nginx에는 http→https 넘기기가 없어 반복 문제 없음. nginx에 넣지 않는다).
  3. [x] 터널(10/20, **명령어 방식**): Zero Trust 대시보드가 무료 요금제에도 결제 수단을 요구해서 쓰지 않았다. 이 PC에 `cloudflared`(winget, 2026.10.1)를 설치 → `cloudflared tunnel login`(브라우저에서 `posegood.site` 허락, 계정 권한 파일 `cert.pem`은 **klaod-tech PC에만**, 넘기지 않음) → `cloudflared tunnel create posegood-api`(ID `baedb98a-e770-4675-86c6-31cd523e656a`) → `cloudflared tunnel route dns posegood-api api.posegood.site`(Cloudflare가 `api` 레코드를 프록시로 추가). DevOps에는 `config.yml`과 터널 인증 파일(`<ID>.json`, 비밀값)만 준다 — 서버에서 `cloudflared tunnel --config config.yml run`. config의 대상은 nginx(`compose.yaml` `frontend`, 기본 `127.0.0.1:8080` 또는 같은 네트워크면 `frontend:80`)이고 처리 서비스 API(8080, 인증 없음)는 가리키면 안 된다 — DevOps 확인. 10/20 확인: `api.posegood.site` DNS는 Cloudflare 주소, 접속은 530(서버 연결 전이라 정상).
  4. [x] 보안(10/20): 요청 제한 규칙 `auth-rate-limit` — `starts_with(http.request.uri.path, "/api/v2/auth/")`, 같은 IP가 10초에 20번 넘으면 10초 Block(로그인·가입 대입 공격 방지, 같은 실습실 IP 여러 명도 걸리지 않을 만큼 넉넉하게). Bot Fight Mode 켬. 둘 다 프록시된 `api.`에 적용된다(`app.`은 Vercel이 보호).
- [ ] **1. Vercel 프로젝트 (FE):**
  1. [x] **포크로 연결(10/19):** 저장소 주인이 팀장 개인 계정이라, 팀장이 GitHub에 Vercel 앱을 설치해도 klaod-tech의 Vercel에는 저장소가 보이지 않았다(개인 계정에 설치한 앱은 그 주인의 Vercel에서만 쓰임). 팀장 계정에 프로젝트를 두는 안은 설정을 바꿀 때마다 팀장 계정이 필요해 고르지 않았다. `klaod-tech/sitting-posture-corrector`(브랜치 전체 복사, 기본 develop)를 만들고, 로컬 원격 `fork`로 등록했다.
  2. [x] **Import·첫 배포(10/19):** 주소 **https://sitting-posture-corrector.vercel.app/** (팀에 공유함). Root Directory `frontend`, Preset Vite, 빌드·출력·설치 명령은 기본값(`npm run build`·`dist`·`npm install`), 환경 변수 없음. `*.vercel.app` 주소에서 화면이 뜬다. 이 배포본은 서버 없이 도는 V2 앱(로컬 회원가입·로그인, 앱 판정, 기록은 브라우저 저장소)이라 처음 여는 브라우저에서는 회원가입부터 한다.
  3. [x] **운영 브랜치 develop(10/19, 자주 바꾸지 않음):** 처음엔 main으로 잡혀 있어 develop으로 바꿨다(Settings → Environments → Production → Branch Tracking). 팀 전체가 합친 결과가 나가고, V2 작업은 develop에 PR로 합친 뒤에 나간다.
  4. [ ] 확인할 것: Settings → Build and Deployment에서 「Include files outside the root directory」 켜짐(`../model`), Node.js 24.x.
  5. [x] `app.posegood.site` 연결(10/20): Vercel → Settings → Environments → Production → Domains에 추가 → Vercel이 준 레코드를 Cloudflare DNS에 넣음(CNAME `app` → `6af83c80925fbc79.vercel-dns-017.com`, **DNS only**). Cloudflare가 「프록시를 켜라」고 권하지만 `app.`은 회색으로 둔다(HTTPS·CDN·DDoS는 Vercel이 맡음, 겹치면 인증서·캐시가 꼬임). 확인: `https://app.posegood.site` 200(Vercel), `http://`는 308로 https, 모델·wasm 파일 200.
  6. [x] **검색 노출 막기(10/20, 실제 연동 전까지, develop `72ab5ec`):** `frontend/public/robots.txt`(`Disallow: /`)와 `vercel.json` 응답 헤더 `X-Robots-Tag: noindex, nofollow`. 접속을 막는 게 아니라 검색 결과에 안 나오게 하는 것. `app.`은 DNS only라 Cloudflare의 AI·검색 봇 설정은 적용되지 않아서 앱 쪽에 둔다. 배포본에는 develop에 머지하고 포크를 최신화한 뒤 반영된다. **정식 공개 때 두 줄을 지운다.**
  7. [x] 운영 환경 변수(10/28 넣음, 서버 터널 전): `VITE_API_BASE_URL=https://api.posegood.site` 하나(WS 주소도 여기서 만든다, 10/21). Vercel Settings → Environment Variables, Type **Config**(빌드된 JS에 드러나는 값이라 Secret이 아님), Production만. `VITE_` 값은 빌드 때 들어가므로 바꾼 뒤 다시 배포한다.
  - 준비된 것: `frontend/vercel.json`(빌드·출력, 빌드 건너뛰기: 마지막 배포본(`VERCEL_GIT_PREVIOUS_SHA`)과 비교해 `frontend`·`model`이 그대로면 건너뜀. 값이 없거나 같은 커밋을 다시 배포(Redeploy, 환경 변수를 바꾼 뒤)하면 빌드(10/28 바꿈, 진행 기록), `X-Robots-Tag`). develop에 들어갔고(`72ab5ec`) 포크에는 포크를 최신화할 때 반영된다. 앱이 `frontend` 밖에서 빌드에 쓰는 것은 `model/`뿐이다(`contracts/`는 시험에서만). 화면 이동은 주소의 `#`만 쓰므로 경로 재작성(rewrites)은 필요 없다.
  - 갱신: 포크는 원래 저장소를 자동으로 따라가지 않는다(GitHub 「Sync fork」는 기본 브랜치만). 원래 저장소 develop을 포크로: `git fetch origin && git push fork origin/develop:develop`. 원래 저장소 PR에는 미리보기가 생기지 않는다.
- [x] **2. 주소 설정 (FE):** 10/19 `VITE_API_BASE_URL`(비우면 지금처럼 같은 출처 `/api`, `features/platform/serverConfig.ts`), HTTP 요청은 `credentials: 'include'`(A-2). WS는 그때 `VITE_REALTIME_URL`이었고 10/21에 지웠다(A-3). 개발은 지금처럼 Vite `/api` 중계. `check-frontend` 통과(시험 347개, 타입 검사, 빌드).
- [ ] **3. 가짜 서버 모드 (FE):** 계약 v2 예시(`contracts/realtime/examples-v2/`)대로 응답하는 가짜 S1·WS. 개발 PC와 Vercel 미리보기의 기본값으로 둬서 문구·버튼을 고칠 때 서버가 필요 없게 한다.
- [ ] **4. 서버 쪽 (DevOps·BE):** 3.1의 S-1(CORS, BE 코드)과 S-2~S-6(설정). BE에 보낼 요청은 S-1 하나다.
- [ ] **5. 데스크톱 (FE, F14):** 패키징된 앱이 `https://app.<도메인>`을 연다. 허용 주소 검사(`sameAddress`)·알림 팝업 주소·`app://` 파일 제공을 정리하고, 열 수 없으면 「서버에 연결할 수 없어요」.
- [ ] **6. 연동 확인:** 정해 둔 때(계약이 바뀔 때, 또는 주기적으로)만 실제 서버로 측정·등록·끊김을 확인한다.

| 환경 | 화면 | 서버 |
|---|---|---|
| 개발 PC | Vite | 가짜 서버(기본) 또는 로컬 BE |
| PR 미리보기 | PR마다 생기는 `*.vercel.app` | 가짜 서버(계속. 다른 사이트라 로그인 쿠키가 안 실린다, 3.1 주의) |
| 고정 미리보기 (서버 연동 뒤 추가) | `preview.<도메인>`(develop 브랜치) | 실제 서버. 같은 도메인 아래라 로그인이 된다. 허용 출처(S-1·S-3)에 `preview.`도 넣는다 |
| 운영 | `app.<도메인>`(**지금은 develop**, 10/19) | `api.<도메인>` |

지금은 운영 브랜치가 develop이라 고정 미리보기는 따로 없다. 나중에 main → `app.`, develop → `preview.`로 나눌 때 위 줄을 쓴다.

고정 미리보기를 붙일 서버는 연동 뒤에 정한다. 안: 운영과 같은 `api.<도메인>` + 시험용 계정(기록이 실제 DB에 섞이므로 계정을 나눔), 또는 시험용 서버를 따로(DevOps 일이 늘어남). 지금 규모에서는 앞의 것을 권한다.

## 5. 확인할 것

- **Vercel 요금제:** 무료(Hobby)는 비상업용만 허용한다. 포크(klaod-tech 개인 저장소)로 연결하므로 다른 팀원 커밋 제약은 없다. 팀원이 PR 미리보기를 보려면 그 브랜치를 포크에 올려야 한다.
- **도메인 갱신:** 첫해 값만 보고 산다. 프로젝트가 1년을 넘기면 갱신 가격(수십 달러일 수 있음)을 다시 본다.
- **Cloudflare 무료 한도:** 터널 개수·연결 수 한도를 Cloudflare 공식 문서로 확인한다(블로그마다 설명이 다름).
- **누가 관리하나:** 도메인·Cloudflare는 klaod-tech 개인 계정이다. 터널은 연결 토큰만 DevOps에 주므로 계정을 나눌 필요가 없다. 토큰은 비밀값이라 저장소에 올리지 않는다(서버의 `.env` 등, D-62와 같은 취급). 그 밖에 DNS를 바꿔야 할 때는 klaod-tech가 한다.

## 6. 진행 기록

- 2026-10-28 오후: Vercel에 `VITE_API_BASE_URL`을 넣고 Redeploy했는데 「Ignored Build Step command returned exit code 0」으로 취소됐다 — 같은 커밋을 다시 배포하면 마지막 배포본(`VERCEL_GIT_PREVIOUS_SHA`)이 지금 커밋과 같아 차이가 없다고 판단한다. 같은 커밋(`VERCEL_GIT_COMMIT_SHA`)이면 빌드하게 고쳤다. 운영 화면은 터널(`api.posegood.site`)이 붙기 전까지 로그인·측정이 안 된다.
- 2026-10-28: 포크 develop을 `11126de` → `dae2fb1`(PR #64~#70: V3, BE 토큰 로그인, CORS)로 최신화했다(빨리 감기, `fork` 원격 등록). 터널 전이라 운영 화면은 서버 연결 전까지 로그인·측정이 안 된다(사용자 결정). 그런데 Vercel이 「Ignored Build Step」으로 빌드를 취소했다 — 건너뛰기가 `HEAD^`(바로 앞 커밋 `6e768a4`, PR #69)와만 비교해서, 화면을 건드리지 않은 마지막 커밋(PR #70)만 보고 「바뀐 것 없음」으로 판단했다. 포크는 여러 커밋을 몰아서 올리므로 마지막 배포본(`VERCEL_GIT_PREVIOUS_SHA`)과 비교하게 바꿨다. 이 변경은 `frontend/vercel.json` 자체를 바꾸므로 다음 포크 최신화에서 빌드된다.
- 2026-10-26 저녁: 10/22 기록의 「터널이 붙은 뒤에 develop에 합친다」를 정정 — Vercel 운영은 **포크** develop을 배포하므로 원래 저장소 develop에 합치는 것만으로는 운영 화면이 바뀌지 않는다. 서버(터널·CORS)가 준비된 뒤에 미루는 것은 **포크 최신화**다. 대신 V3는 BE 작업 브랜치 `fix/repo-backend-sync`(B1 `registration_id`, DB V2.5)와 함께 develop에 합친다 — V3만 먼저 들어가면 지금 서버에서 자세 등록이 400이 된다([FE 제안서](fe-server-proposal.md) 7.2 13번).
- 2026-10-26: 포크 develop 확인 — `11126de`(PR #60, V2 화면)로 10/21 최신화한 그대로다. 그 뒤 원래 저장소 develop에 들어온 PR #63(`3285cce`)은 서버·문서 정리이고 화면 코드는 그대로라(`frontend/README.md`만) 포크를 다시 맞추지 않았다. 이 PC에는 `fork` 원격이 없어 최신화할 때 1단계의 `git remote add fork …`부터 한다.
- 2026-10-21: 포크 develop을 원래 저장소 develop `11126de`(PR #60, V2: 카메라 여러 대·PiP·Vercel 배포 준비)로 최신화했다(`git push <포크> origin/develop:refs/heads/develop`, 빨리 감기만). Vercel 운영 `app.posegood.site`에 V2가 나갔다.
- 2026-10-25: 3.2 「지금 앱」 칸을 V3 코드로 고침(A-1·A-2 끝남, A-3 `VITE_REALTIME_URL` 삭제). 운영 환경 변수는 `VITE_API_BASE_URL` 하나. CORS(S-1)는 develop `3285cce`에도 아직 없다.
- 2026-10-22: 문서 이름을 `fe-deploy.md`로 바꾸고 데스크톱 앱 구조(옛 6장)를 FE 제안서 8.4로 옮겼다. V3(서버 전용)는 서버 없이는 측정할 수 없어, `api.posegood.site` 터널이 붙은 뒤에 develop에 합치고 포크를 최신화한다(ADR 0021).

- 2026-10-20: Cloudflare Active, `https://app.posegood.site`가 Vercel 배포본으로 열린다. DDoS는 `api.`(터널, 프록시)는 Cloudflare가, `app.`은 Vercel이 막는다.
- 2026-10-20: develop 기준 배포본(https://sitting-posture-corrector.vercel.app/)을 팀에 알렸다: 서버 연결 전이라 처음 여는 브라우저는 회원가입부터, develop에 머지돼도 FE가 포크를 최신화해야 반영, PR별 미리보기 없음. 도메인은 Cloudflare 확인 뒤 `app.posegood.site`로 옮긴다. 팀 서버 PC는 공인 IP가 없어도 이름 있는 터널로 `api.posegood.site`에 연결한다(포트를 열지 않고 서버 IP도 드러나지 않음, 터널에는 nginx `/api`만 등록).
- 2026-10-19: Vercel은 klaod-tech 포크로 연결하기로 했다(사용자). 팀장이 Vercel GitHub 앱을 설치했지만 klaod-tech의 Vercel에는 저장소가 보이지 않았다. 갱신은 필요할 때 포크에 푸시한다.
- 2026-10-19: 도메인 확장자는 `.site`로 정했다(사용자). 터널은 klaod-tech 계정에서 만들고 연결 토큰을 DevOps에 준다. PR 미리보기는 가짜 서버, 서버 연동 뒤 develop에 `preview.<도메인>`을 더한다(4장 환경 표).
- 2026-10-19: BE 브랜치 `a0d99a3` 코드로 분리할 때 바꿀 것을 확인했다(3장). 서버 코드는 CORS(S-1)만 새로 필요하고 나머지는 설정이다. CSRF·쿠키·WS 계약은 그대로 쓴다.
- 2026-10-19: 서버와 FE를 함께 바꾸던 방식을 멈추고(앱 v2 전환 코드는 되돌림, FE 제안서 7.1은 할 일로 남김) 화면을 서버와 따로 배포하기로 했다. 도메인은 klaod-tech 계정, DNS는 Cloudflare 무료, 화면은 Vercel, 서버는 DevOps의 이름 있는 터널.
