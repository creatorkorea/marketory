# 배포 구성 결정

최초 결정일: 2026-10-08. 2026-10-12 사용자 후속 결정은 **creatorkorea 계정, Render 무료 범위**입니다. Supabase·인증·Storage·Resend의 로컬 연결 검증은 진행됐으며 Vercel 웹과 Render 무료 API 배포 및 기본 연결 검증을 완료했습니다. 실제 로그인 이후 업무 전체 E2E는 남아 있습니다. [실행 안내](LOCAL-DEVELOPMENT.md)와 [운영 안내 검증](COMMUNICATIONS.md)을 참고합니다.

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
