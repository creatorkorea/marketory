# 배포 구성 결정

최초 결정일: 2026-10-08. 2026-10-12 사용자 후속 결정은 **creatorkorea 계정, Render 무료 범위**입니다. 공개 환경 로그인·신청·첨부·수동 심사·참가확정·부스 배치 흐름을 검증했습니다. 아래 날짜별 배포 기록은 당시 상태이며 최신 완료 범위는 후속 검증 절을 우선합니다. 실운영 승인·상시 메일 worker·백업 복원 실증은 남아 있습니다. [실행 안내](LOCAL-DEVELOPMENT.md)와 [운영 안내 검증](COMMUNICATIONS.md)을 참고합니다.

## 무료 배포 범위 — 2026-10-12

API는 Render Free Web Service로 준비한다. Background Worker에는 무료 인스턴스가 없으므로 기존 상시 worker 계획은 보류한다. 메일 큐 접수·승인은 가능하지만 상시 발송 완료를 보장하지 않으며 `MARKETORY_EMAIL_DELIVERY_ENABLED=false`를 유지한다. 로컬 단회 worker 검증은 호스팅된 worker 운영의 대체 증거가 아니다. 별도 무료 실행 방식이나 유료 전환은 후속 결정이다.

Free Web Service는 15분간 요청이 없으면 중지되고 다음 요청 시 기동 지연이 있다. Shell과 one-off job도 지원하지 않는다. 무료 시간·빌드·대역폭 한도가 있으며 결제 수단이 연결된 경우 초과 사용 과금 설정을 확인해야 한다. 비용 0원 제약에 맞게 유료 리소스와 초과 결제를 활성화하지 않는다. [Render 공식 무료 범위](https://render.com/docs/free), [Docker 설정](https://render.com/docs/docker).

### 실제 배포 결과 — 2026-10-12

- 웹: https://marketory-silk.vercel.app — Vercel `creatorkoreaorg-7032s-projects` Hobby 팀의 `marketory`. Root Directory `apps/web`, 상위 workspace 접근 허용, Production 브랜치 `codex/communications`. `main` 병합은 하지 않았다. 소스 `57b8dc0`, 배포 `DTvT3Refq9gQXoQ6Upv7fyBySQ7E`가 Ready다.
- API: https://marketory-api.onrender.com — Render `creatorkorea.org@gmail.com`, `영준's workspace` (`tea-db67tkvlk1mc73c8qik0`). 서비스 `srv-db680d0473hc73dg3bhg`, Free·Docker·Singapore·자동 배포 Off. 소스 `1efef04`, 환경변수 반영 배포 `dep-db681jnlk1mc73c97eag`가 Live다. Root `apps/api`, Dockerfile `./Dockerfile`, context `.`, health `/health/ready`.
- 사용자가 DB 연결 문자열과 Supabase 서버 secret·publishable key의 해당 Render 서버 저장을 승인했고 저장을 완료했다. 비밀값은 문서·Git에 기록하지 않는다. Resend 키는 저장하지 않았다.
- API 설정: `MARKETORY_ENVIRONMENT=preview`, `MARKETORY_EMAIL_DELIVERY_ENABLED=false`, bucket `seller-assets`. CORS는 `https://marketory-silk.vercel.app`만 허용한다. Vercel Production 환경에는 `API_BASE_URL`, `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 저장했다. Vercel의 Production 명칭은 서비스 출시 승인이나 데이터 환경 분리 완료를 의미하지 않는다.
- 최초 Vercel 빌드는 루트 TypeScript 의존성 누락으로 실패했다. `apps/web/vercel.json`의 설치 명령을 `cd ../.. && npm ci --include=dev --include-workspace-root`로 고정한 뒤 빌드가 성공했다.
- 검증: 웹 `/`, `/login`, `/api/health`, `/api/auth/config` 200; API `/health/live`, DB 연결 검사 `/health/ready` 200; 비로그인 `/api/backend/me`와 API `/api/me` 401. 허용 origin preflight 200, 다른 origin 400/ACAO 없음. 공개 로그인 화면에서 인증 설정 로딩 종료를 확인했다.
- 로컬 증거: `output/deployment-smoke-20261012.json`, `output/deployed-login-20261012.jpg`. 안내 UI 갱신 회귀 브라우저 10개, 타입 검사와 로컬 빌드도 통과했다. 공개 환경 OTP·신청·파일·심사 전체 E2E, cold start 복구, 환경별 데이터 격리, hosted worker는 아직 검증하지 않았다.

연결 도구의 Vercel 팀은 다른 `solverlabkr's projects`이므로 배포에는 사용하지 않았다. 올바른 계정의 Chrome 대시보드에서 설정했다.

### 공개 환경 관리자 인증·저장 검증 — 2026-10-12

공개 Vercel 주소에서 사용자가 입력한 OTP로 관리자 재로그인을 완료했다. `/account`의 플랫폼 관리자 표시, `/markets`의 기존 비공개 테스트 마켓, 신청 검토 목록과 합성 신청 상세를 실제 API로 조회했다. 기존 합성 신청에 `[TEST 2026-10-12]` 내부 메모 1건을 UI로 저장하고 새로고침 후 동일 메모가 유지되는 것을 확인했다. Vercel → Render → Supabase의 인증된 조회·변경·재조회 경로 증거다. 실제 심사 판정이나 메일 발송은 실행하지 않았다.

로그아웃 후 계정 화면의 로그인 필요 상태도 확인했다. 이후 기존 테스트 셀러 OTP 로그인, 셀러 역할 표시, 본인 신청 목록·상세 조회를 확인했다. 관리자 내부 메모는 셀러 상세에 표시되지 않았고 `/markets` 접근은 운영 권한 필요 화면으로 차단됐다. 새 신청·업로드 검증은 아직 완료하지 않았다. 기존 테스트 마켓은 DRAFT, 합성 신청은 SUBMITTED이며 실제 신청·동의로 간주하지 않는다. 해당 신청은 정책상 수정·첨부 불가이므로 별도 모집 중 테스트 마켓 사용 여부를 사용자에게 확인 중이다. 기존 상태를 DB에서 바꾸어 검증을 우회하지 않았다. 증빙은 Git 제외 `output/deployed-admin-review-20261012.jpg`, `output/deployed-seller-application-20261012.jpg`다.

공개 첨부 정책 최초 조회에서 503이 발생했으나 후속 직접 API health·정책과 웹 relay 정책 조회는 모두 200으로 복구했다. 무료 인스턴스 기동 지연 가능성은 있으나 해당 오류의 원인을 로그로 확정하지 않았다. 업로드 origin은 실제 Render HTTPS 주소로 확인했다.

### 배포 입력값과 검증 순서

1. Vercel 계정·팀과 Git 저장소 `creatorkorea/marketory` 연결 권한을 확인한다. Root Directory는 `apps/web`, 상위 workspace 파일 접근을 허용하고 잠금파일 기반 설치·Next.js 빌드를 사용한다. 배포 브랜치/커밋은 명시적으로 확인한다.
2. Render Web Service는 Docker, 저장소 기준 Docker context `apps/api`, Dockerfile `apps/api/Dockerfile`, Free로 설정한다. 기본 CMD를 사용하고 health 경로는 `/health/ready`다. 로컬 Docker 실행은 하지 않았으며 Render에서 실제 Docker 빌드·기동과 health 검증을 완료했다.
3. API에는 `MARKETORY_ENVIRONMENT`, `MARKETORY_DATABASE_URL`, `MARKETORY_CORS_ORIGINS`, `MARKETORY_SUPABASE_URL`, `MARKETORY_SUPABASE_PUBLISHABLE_KEY`, `MARKETORY_SUPABASE_SECRET_KEY`, `MARKETORY_PUBLIC_API_URL`, `MARKETORY_STORAGE_BUCKET`을 설정한다. secret 값은 대시보드의 서버 환경변수로만 입력한다. API 공개 주소와 CORS는 실제 HTTPS 주소를 사용한다.
4. Vercel에는 `API_BASE_URL`, `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 설정한다. DB·Storage 서버 secret·Resend 키는 웹에 넣지 않는다. `APP_ORIGIN`은 해당 배포의 정확한 origin이며 임의 Preview 주소도 자동 허용하지 않는다. Supabase 인증 URL 설정과 환경별 데이터 분리도 확인한다.
5. API `/health/live`, `/health/ready`와 웹 `/api/health`, 로그인, 권한 거절, 파일 업로드·조회, 안내 큐 접수를 확인한다. 무료 API 기동 지연과 요청 복구도 검증한다. 상시 worker 미배포 상태를 운영 화면과 문서에 유지한다.

## 확정 구성

| 역할 | 배포 대상 | 책임 |
|---|---|---|
| Next.js 웹 | Vercel | 공개 모집·셀러·운영자 화면 |
| FastAPI | Render Web Service | 인증 검증·권한·업무 API·트랜잭션 |
| Python worker | Render Background Worker (무료 조건으로 배포 보류) | 안내 발송·실패 복구, AI 처리 후속 |
| PostgreSQL·Auth·Storage | Supabase | 영속 데이터·OTP 인증·private 첨부파일 |

API와 worker는 같은 Python 코드와 Docker 이미지를 사용하되 실행 명령을 분리합니다. 최초 계획은 API 1개·worker 1개였으나 무료 배포 단계에서는 API 1개만 배포했습니다. Render에서 API Docker 빌드·실행을 확인했으며 worker 호스팅은 보류합니다.

## 처리와 복구 경계

웹은 업무 변경을 API에 요청합니다. API는 사용자와 권한을 검사하고 업무 변경·감사·비동기 작업 등록을 하나의 DB 트랜잭션으로 기록합니다. worker는 DB에 기록된 작업을 claim하여 처리하며, 기존 명세의 claim_token·revision·재시도·UNKNOWN 규칙을 유지합니다.

작업 상태를 프로세스 메모리에만 두지 않습니다. 재배포·종료 후에도 DB 기록으로 복구하고, 오래된 worker 결과가 최신 작업을 덮어쓰지 않도록 검증합니다. 이미지 공유는 프로세스 메모리 공유를 뜻하지 않습니다. API와 worker는 독립적으로 실행됩니다.

별도 Redis나 추가 큐 서비스는 이번 결정에 포함하지 않습니다. DB 작업 저장·claim의 구체적인 구현과 연결 방식은 P0/P3에서 결정합니다. 실제 외부 발송의 UNKNOWN을 단순 재시도로 해결하지 않습니다.

## 연결 전에 정할 항목

- 계정·프로젝트 식별자, 요금제·리소스와 월 예산.
- API·worker·DB 리전과 연결 지연 확인.
- local·preview·production 데이터 및 인증 설정 분리. preview가 운영 발송을 실행하지 않도록 수신처와 제공사 설정 구분.
- 웹/API URL, 인증 redirect, 허용 origin과 서버 전용 비밀값의 주입 위치.
- DB 연결·migration 실행 주체, API health와 worker 생존 확인, 로그·오류 알림.
- AI·메일 제공사 및 모델, timeout·재시도·동시 처리 제한.

서버 비밀키를 브라우저 공개 환경변수에 넣지 않습니다. 실제 값은 이 문서에 기록하지 않고 환경별 설정 이름과 책임만 구현 문서에 남깁니다.

## 완료 증거

연결 후 웹→API→DB 정상 흐름, 권한 차단, worker 재시작·작업 복구, 테스트 수신함 발송, 환경 격리를 확인합니다. 결과는 [QA 실행 기록](qa/README.md)에 남깁니다. 제공사 선택만으로 해당 검증을 통과 처리하지 않습니다.

## 기준 문서와 관계

Word v1.3의 Render/Railway 후보 중 Render를 선택한 후속 결정입니다. 호스트 선택은 이 문서를 우선 참조하며, 업무 상태·데이터·API 계약은 기존 v1.3을 유지합니다. 원본 Word와 자동 생성 참조본은 이력 보존을 위해 이번 결정으로 재작성하지 않았습니다.

제공사의 서비스 설명: [Render Background Workers](https://render.com/docs/background-workers). 요금제 선택 시 [Render 요금](https://render.com/pricing)을 다시 확인합니다.

## 공개 배포 신청·첨부 E2E — 2026-10-12

사용자가 승인한 `[TEST] 배포 검증 전용 20261012` 마켓(`46e5ba27-8d33-5628-ba90-6414fb2bb64e`)을 합성 DB fixture로 준비했다. 마켓 생성·모집 종료는 관리자 UI 검증과 구분하며 감사 기록을 남겼다. 기존 메일 검증 마켓/신청은 변경하지 않았다.

공개 Chrome의 실제 셀러 세션으로 모집 화면 → 초안 생성 → 가상 상품 정보 자동 저장 → PNG 업로드 → 첨부 연결 → 파일 확인 → 테스트 제출을 실행했다. 신청 `57645405-dc88-5a74-b19b-1c536cf43ec5`는 SUBMITTED, version 4, revision 3이며 첨부 `a7bf3b0a-015b-4ae3-8066-edcbd12360a8` 1건(117바이트)과 upload intent COMPLETED를 DB에서 확인했다. 접수시각은 2026-10-12 17:56 KST다.

파일은 개인정보 없는 32×32 진단 PNG다. 웹에서 발급받은 비공개 조회 링크의 이미지가 실제 32×32로 로딩됐으며, 같은 저장 객체의 public GET은 400으로 차단됐다. 임시 링크와 인증 토큰은 증거 파일에 저장하지 않는다. 제출 문구는 `TEST-NONLEGAL-20261012`로 실제 행사 신청 또는 개인정보 동의가 아님을 명시했다. 기술적인 동의/제출 경로 검증이며 실제 법적 동의를 확보한 것으로 간주하지 않는다.

Chrome 확장 파일 권한 부재는 사용자가 설정을 켜서 해결했다. 오랜 대기 후 첫 업로드 준비 요청이 지연되어 같은 요청 복구 안내를 거쳤고 최종 첨부는 중복 없이 1건이다. 해당 지연의 원인을 Render 로그로 확정한 것은 아니다.

검증 후 테스트 프로젝트를 REVIEWING으로 변경하고 모집 종료시각을 앞당겨 신규 모집을 닫았다. 테스트 기록과 파일은 증빙으로 보관하며 자동 삭제·상시 메일 발송은 활성화하지 않았다. 실사용 데이터 격리, 역할별 전체 첨부 권한 행렬, 대용량/다중 파일·모바일·장시간 만료 검증은 별도다.

로컬 증거: `output/deployed-upload-e2e-20261012.json`, `output/deployed-submitted-20261012.jpg`, `output/deployed-recruitment-closed-20261012.jpg`. 단위/전체 회귀 테스트를 이번 수동 검증에서 재실행한 것은 아니다.

## 공개 배포 심사·참가확정·배치 E2E — 2026-10-12

앞 절의 합성 테스트 신청을 대상으로 공개 웹의 관리자·셀러 세션을 서로 다른 Chrome 프로필에 유지했다. 관리자 화면에서 수동 검토 시작 → 선정(확정기한 2026-10-13 18:00 KST), 셀러 화면에서 본인 참가확정, 관리자 화면에서 TEST-A01 부스 등록 → 배치 초안 저장 → 별도 배치 확정을 실행했다. 이 단계는 DB에서 업무 상태를 직접 수정하지 않고 실제 Vercel/Render API를 사용했다.

초안 저장 후 확정 배정 0팀·변경 초안 1건, 확정 후 배정 1팀·미배정 0팀·초안 0건을 확인했다. 셀러 화면을 새로고침한 뒤 참가 확정과 TEST-A01·검증 구역·시설이 표시되며, 관리자의 `[TEST INTERNAL]` 부스 메모가 화면에 노출되지 않았다.

DB 재조회: 신청 CONFIRMED, version 8, 제출 revision 3 유지, 활성 확정 배정 1건. REVIEWS.START/DECISION, APPLICATIONS.CONFIRM, BOOTHS.CREATE/DRAFT/CONFIRM 감사는 각각 1건이다. 해당 테스트 마켓의 QUEUED/SENDING 안내는 0건이며 메일 발송은 실행하지 않았다. 마켓은 REVIEWING으로 신규 모집 종료 상태를 유지한다. 테스트 확정·배치는 검증 이력으로 보관한다.

첫 운영 권한 조회가 실패 안내를 표시했으나 API readiness 200 확인 후 화면의 다시 확인으로 복구했다. 무료 기동 지연인지 원인은 로그로 확정하지 않았다. 이번 검증은 정상 흐름과 수동 복구에 한정되며, 정원 초과 경쟁·다중 셀러 교환·취소 배치 회수·역할별 전체 권한 검증을 배포 환경에서 모두 실행한 것은 아니다.

증거: `output/deployed-operations-e2e-20261012.json`, `output/deployed-seller-booth-20261012.jpg`. 문서 무결성 검사와 diff 검사를 실행했다. 제품 코드는 변경하지 않았으며 기존 전체 회귀 테스트를 재실행했다고 표시하지 않는다.

## 초기 접속 지연·조회 복구 보완 — 2026-10-12

운영자/셀러 접근 화면에서 계정 조회가 오래 걸리면 8초 후 지연 안내를 표시한다. 일시적 네트워크 오류·timeout·502/503/504는 2초/4초 대기 후 최대 2회 추가 조회하며 실패가 지속되면 수동 다시 확인을 제공한다. 로그인/권한 거절은 재시도하지 않는다. 저장·신청·발송 등 변경 요청에는 이 조회 재시도를 적용하지 않는다. 사용자·화면 변경 시 AbortSignal로 대기와 결과 반영을 중단한다. 공통 소유자와 동작 기준은 [UI 계약](../UX-CONTRACT.md)에 기록했다.

검증: 추가 조회 복구 단위 8개를 포함한 웹 단위 71개, 운영/셀러 브라우저 17개와 Next.js 프로덕션 빌드 통과. 브라우저는 지연·503·403을 fixture로 주입해 안내, 최대 3회 조회, 수동 재조회, 변경 요청 0건을 확인한다. `output/access-slow-desktop.png`에서 기존 Notice/타이포그래피와 레이아웃을 확인했다. 실제 Render cold start 시간 단축을 의미하지 않으며 서버 기동 원인을 추정하지 않는다.

## 모바일 회귀 검증 — 2026-10-12

`npm.cmd run test:browser --workspace @marketory/web -- --config playwright.mobile-check.config.ts`로 로그인·셀러 기존 시나리오 20개를 실행해 모두 통과했다. 기본 390×844, touch/mobile 모드를 사용하며 일부 기존 반응형 테스트는 자체적으로 360px·데스크톱·텍스트 확대 조건으로 전환한다. OTP 검증·세션 복구, 신청 자동 저장·중복 제출 방지, 파일 2개 순차 연결, 충돌 복구, 참가확정·기한 만료 처리를 포함한다. API·파일 전송은 로컬 fixture이므로 실제 모바일 기기나 운영 저장소 업로드 성공 증거와 구분한다.

공개 사이트의 기존 합성 신청을 Chrome 390×844·360×800에서 확인했다. 참가 확정·TEST-A01 배치·신청 상세가 가로 넘침 없이 표시되며 관리자 내부 메모는 보이지 않았다. 파일 확인 버튼으로 기존 private 첨부 이미지(32×32)가 로딩되는 것을 확인했다. 새 신청·취소·재확정 등 운영 데이터 변경은 실행하지 않았다. 최초 계정 조회 실패는 기존 수동 다시 확인으로 복구했다.

증거: `output/mobile-browser-20261012.json`, `output/deployed-seller-mobile-20261012.png`, `output/seller-application-mobile.png`, `output/auth-mobile.png`. 재실행 설정은 `apps/web/playwright.mobile-check.config.ts`다. 실제 iOS Safari·Android 파일 선택기/키보드 검증은 별도로 남는다.

초기 접속 개선 커밋 `6969ba8`의 첫 Vercel 배포 2건은 빌드 전 Git 정보 조회에서 실패했다. Git 설정 화면에서 GitHub secondary rate limit(403)을 확인했으며 대기 후 저장소 연결이 정상으로 복구됐다. 코드 테스트 통과와 공개 배포 성공은 구분하며 후속 배포 Ready 및 공개 응답 확인이 필요하다.

## 마켓 생성·공개·종료 실증 — 2026-10-13

공개 Chrome 관리자 세션에서 `/markets/new`에 합성 정보를 입력해 `[TEST] 마켓 공개 흐름 검증 20261013`을 생성했다. 프로젝트 ID는 `c040953c-d475-54d7-af87-21acfa02dd24`다. DB 직접 변경 없이 실제 UI와 배포 API로 DRAFT(version 1) → RECRUITING(version 2) → REVIEWING으로 전환했다. 초안의 비인증 공개 API는 404, 공개 후에는 accepting_applications=true와 마켓 신청하기 링크, 종료 후에는 accepting_applications=false를 확인했다. 법적 동의가 아닌 TEST 문구를 사용했고 실제 신청·메일 발송은 수행하지 않았다. 생성자 관리자만 기존 운영자로 표시됨을 확인했으며 타 계정 권한은 변경하지 않았다.

증거는 `output/market-ui-open-20261013.png`, `output/market-ui-closed-20261013.png`다. 신규 모집은 종료했지만 공개 정보 페이지는 계속 조회할 수 있다. 모집 종료와 비공개 전환을 같은 의미로 취급하지 않는다. 기존 20261012 테스트 신청·배치 기록은 변경하지 않았다.

## MVP 실운영 준비 절차 — 2026-10-13

아래는 실행 절차와 미결정 항목이다. 문서 작성만으로 백업·복원·실운영 승인을 완료 처리하지 않는다. 계정·예산 원칙은 creatorkorea와 무료 범위를 유지한다.

### 공개 전 결정표

| 항목 | 담당 | 현재 상태 / 완료 증거 |
|---|---|---|
| 행사명·장소·모집 기간·행사 종료·정원 | 행사 책임자 | 미정. 승인한 실제 값을 초안에 저장하고 공개 화면 대조 |
| 품목·제한 품목·참가비·부스 제공 조건·선정 기준 | 행사 책임자 | 미정. 조건과 실제 제공 내용 일치 확인 |
| 운영 주체·문의처·약관·취소 기준·개인정보 수집/보관/삭제 기준 | 행사 책임자 | 미정. 실제 운영 문구 검토 후 버전 지정. TEST 문구 사용 금지 |
| 마켓 운영자·심사자·열람자 | 플랫폼 관리자 | 담당자 미정. 각 역할의 실제 로그인 및 담당 마켓 접근 확인 |
| 안내 전달 방식과 담당자 | 행사 책임자 | 상시 worker 보류. 수동 연락 또는 호스팅 방식 결정 후 수신 검증 |
| 백업 보관 위치·접근자·주기·보관기간 | 시스템 담당자 | 미정. 개인정보 포함 파일은 암호화된 승인 위치에 보관 |
| 허용 데이터 손실 시간·복구 목표 시간 | 행사/시스템 담당자 | 미정. 복원 리허설 실측 후 운영 가능 여부 판단 |

### 모집을 여는 순서

1. 실제 행사와 TEST 마켓을 구분한다. 테스트 식별자 목록을 유지하고 실운영 명단·발송 대상에서 제외한다. 프로젝트 이름 구분만으로 데이터 환경 격리가 완료되지는 않는다.
2. 관리자 화면에서 새 마켓 초안을 만들고 모든 시각을 KST로 대조한다. 정책 문구·버전·정원·비용을 행사 책임자가 확인한다.
3. 이메일 인증을 마친 담당자에게 필요한 마켓 역할만 배정한다. 다른 마켓 접근 차단과 해제 후 접근 차단을 확인하고 권한 변경 사유를 남긴다. 관리자 계정을 공유하지 않는다.
4. 외부 발송이 꺼진 상태와 테스트/운영 데이터 범위를 확인하고 백업 시점을 기록한다.
5. 모집 공개 확인창에서 대상 이름·상태·사유를 확인한다. 별도 비로그인 화면에서 조건과 신청 가능 여부를 대조한다.
6. 실제 기기의 승인된 테스트 계정으로 신청·첨부·심사·확정·배치·안내를 리허설한다. 실제 법적 동의는 임의로 대신 수락하지 않는다.
7. 종료할 때에는 마켓 설정에서 ‘심사 중’으로 전환하고 공개 페이지의 신청 불가와 API accepting_applications=false를 확인한다. 종료는 기존 신청 삭제를 뜻하지 않는다.

### 매일 운영 점검

- 모집 시작 전 웹 로그인 페이지, API `/health/ready`, 관리자 목록과 셀러 본인 신청을 확인한다. 웹 `/api/health`의 생존 응답만으로 DB 정상까지 단정하지 않는다.
- 미처리 신청·보완 기한·참가확정 기한·미배정 팀을 확인한다. 선정과 참가확정, 배치 초안과 확정 배치를 구분한다.
- 메일은 큐 등록·제공사 접수·실제 수신을 구분한다. 현재 worker가 없으므로 큐 등록을 발송 완료로 안내하지 않는다.
- 퇴사·담당 변경 시 마켓 배정을 회수하고 감사 기록을 확인한다. 요청 결과 재조회와 첨부 조회도 회수된 권한으로 차단되는지 점검한다.
- 백업 성공 시각, 담당자, 산출물 위치, 복원 가능한 마지막 시점을 기록한다. 실패 시 담당자에게 알리고 복구 가능 시점을 다시 평가한다.

### 백업·복원 계획

DB, private Storage 파일, 배포 설정 목록과 코드 revision을 한 묶음으로 관리한다. DB 백업에는 Storage 객체 본문이 포함되지 않으므로 파일은 별도로 보존해야 한다. Supabase 무료 프로젝트는 정기 export와 외부 보관을 계획하고, 현재 계정에서 실제 제공되는 백업 기능·보관기간을 확인한다. [Supabase 공식 백업 안내](https://supabase.com/docs/guides/platform/backups).

1. 백업 책임자가 접근 통제된 보관 위치·주기·보관기간과 비용을 먼저 확정한다. 비밀값·DB dump·첨부 원본을 Git이나 일반 공유 링크에 넣지 않는다.
2. 쓰기 일시 중지 시간 또는 일관된 스냅샷 기준을 정한다. DB export와 파일 목록/본문의 대상 시각을 맞추고 파일 수·크기·체크섬 및 스키마 버전을 기록한다.
3. Auth 데이터와 사용자 ID 연계, DB 역할, 버킷 정책, SMTP/redirect/CORS, 배포 환경변수 이름도 복원 범위에 포함한다. 설정 목록에는 비밀값을 넣지 않고 안전한 별도 보관 위치만 참조한다.
4. 운영과 분리된 복구 대상에 복원한다. 메일 발송과 worker는 비활성화하고 운영 도메인·운영 수신처를 연결하지 않는다. 운영 DB에 시험 복원을 덮어쓰지 않는다.
5. 마켓·신청·첨부 건수, 상태·버전, 부스 중복 여부, 감사 이력, private 파일 열람과 권한 차단을 대조한다. 인증 로그인은 별도로 검증한다.
6. DB 복원 시 이미 발송된 메일이 과거 QUEUED/SENDING 상태로 돌아올 수 있다. 제공사 이력과 작업 기록을 대조하기 전에는 worker를 시작하지 않는다. UNKNOWN을 근거 없이 재발송하지 않는다.
7. 복구 소요시간·누락 범위·재개 승인자를 기록한 뒤에만 연결을 전환한다. 실패하면 원래 환경을 유지하고 원인을 수정한다.

현재 상태: 절차 작성 완료, 실제 운영 백업 파일 생성·Storage 백업·복원 리허설은 미실행. 승인된 보관 위치와 복구 대상이 정해진 뒤 실행한다.

### 장애 대응표

| 증상 | 확인과 조치 | 재개 기준 |
|---|---|---|
| 첫 접속 지연·503 | 지연 안내/재확인 사용, Render 상태와 ready 확인. 반복 저장으로 새 요청을 만들지 않음 | 정상 조회와 기존 요청 결과 확인 |
| 저장 결과 불명 | 같은 요청 결과 조회, 서버 상태 대조. 중복 신청·판정·발송 금지 | 성공/실패/만료 상태 확정 |
| Vercel Git 403 | Git 연결 화면과 정확한 오류 확인. 요청 제한이면 대기 후 확인, 연결 해제/키 교체를 먼저 하지 않음 | 대상 커밋 배포 성공 및 공개 응답 확인 |
| 잘못된 웹 배포 | 마지막 정상 커밋과 배포 확인 후 롤백 검토. DB 변경과 호환성 별도 확인 | 로그인·조회·핵심 저장 정상 |
| API 오류 지속 | 로그의 시각·요청 식별자·오류 코드 수집, 운영 변경 일시 중지. 토큰·개인정보 마스킹 | ready와 승인된 테스트 작업 정상 |
| 메일 UNKNOWN | worker 추가 발송 보류, Resend 접수 기록과 고정 요청 키 확인 | 근거를 기록한 상태 확정 |
| 데이터 손상·파일 유실 | 쓰기/발송 중지, 최근 백업 시점과 영향 범위 파악, 별도 대상에 복원 | 복원 대조·권한·중복 발송 방지 확인 및 책임자 승인 |

장애 기록에는 KST 발생/복구시각, 담당자, 영향 범위, 코드 revision, 수행 조치, 남은 데이터 차이, 재개 승인자를 남긴다. 자동 감시·알림 서비스를 설치한 것으로 표시하지 않는다.
