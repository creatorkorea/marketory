# 로컬 개발 시작

P0 실행 기반에 P1/P3 인증·권한·요청 복구 API를 추가했다. 실제 인증 연결·신청·AI·메일 업무 처리는 아직 완료하지 않았다. [P1/P3 기록](P1-P3-IMPLEMENTATION.md)의 구현 범위를 따른다.

## 버전과 설치

Node 24.13.1, npm 11.8.0, Python 3.12.10, uv 0.10.4 기준이다. Node/Python은 루트 버전 파일, JS는 package-lock.json, Python은 apps/api/uv.lock으로 고정한다. TypeScript 5.9.3은 OpenAPI 생성 도구의 peer dependency에 맞춘 선택이다.

PowerShell에서 저장소 루트 기준:

```powershell
npm.cmd ci
uv sync --project apps/api --locked
npm.cmd run assets:sync
# 최초 1회만 복사. 이미 작성한 설정은 덮어쓰지 않는다.
if (!(Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
if (!(Test-Path apps/web/.env.local)) { Copy-Item apps/web/.env.example apps/web/.env.local }
```

## DB 시작

Docker 사용 가능 시:

```powershell
docker compose up -d db
```

현재 PC에는 Docker가 없어 아래 별도 개발용 PostgreSQL 17.10으로 검증했다. 루트 제품 의존성에 포함하지 않으며 .local 아래에만 설치·데이터를 저장한다. 다른 프로젝트의 DB를 건드리지 않는다. Docker 방식과 동시에 실행하면 포트가 충돌하므로 하나만 사용한다.

```powershell
npm.cmd install --prefix .local/pg --save-exact embedded-postgres@17.10.0-beta.17
node scripts/local-db.mjs
```

DB는 127.0.0.1:55432만 수신한다. 별도 창에서 유지하고 Ctrl+C로 종료한다. 로컬 예시 계정은 외부 서비스에 재사용하지 않는다. 이 DB는 SQL 연결·트랜잭션 검증용이며 Supabase Auth·Storage 에뮬레이터가 아니다. 실제 Supabase 연결은 별도로 수행한다.

## 프로세스 실행

각각 별도 터미널에서 실행한다.

```powershell
npm.cmd run api:dev
npm.cmd run worker:dev
npm.cmd run dev
```

- 웹: http://127.0.0.1:3000 — 준비 안내와 /ui 견본.
- API: http://127.0.0.1:8000/docs — health·bootstrap·본인/프로젝트·요청 결과 조회 계약.
- /health/live: 프로세스 응답이면 200. DB 연결을 의미하지 않는다.
- /health/ready: 실제 SELECT 1 성공 시 200, 미설정·장애 시 503.
- worker: 주기적 DB 생존 프로브와 종료 처리. 로그의 handlers=not_configured는 업무 큐 미구현을 뜻한다.
- 웹 /api/health는 서버 전용 API_BASE_URL의 생존 응답만 중계한다. 설정이 없거나 응답 실패 시 503이며 호스트·비밀값을 반환하지 않는다.

종료는 각 터미널에서 Ctrl+C. Docker DB는 `docker compose stop db`로 중지한다. 파일 보존용 volume을 삭제하는 명령은 기본 절차에 포함하지 않는다.

## 검증

```powershell
$env:MARKETORY_TEST_DATABASE_URL='postgresql://marketory:marketory_local@127.0.0.1:55432/marketory'
npm.cmd run check
npm.cmd run build
uv run --project apps/api python -m marketory.worker --once
uv run --project apps/api python docs/tools/verify_docs.py
uv run --project apps/api python design-system/tools/build_tokens.py --check
uv run --project apps/api python design-system/tools/verify_assets.py
```

테스트 DB 변수가 없으면 DB 통합 테스트들이 SKIP된다. 전체 DB 검증을 주장하려면 전용 로컬/CI DB 변수를 설정하고 실행한다. P0는 TEMP 테이블, P1/P3는 별도 `marketory_test_<uuid>` DB를 생성·검증·제거한다. DB 생성 권한이 필요하고 loopback 호스트만 허용한다. 일반 marketory DB의 업무 테이블에는 migration을 자동 적용하지 않는다. worker --once는 DB 확인 성공에0, 실패에1로 종료한다. Python async 진입점은 Windows에서 SelectorEventLoop를 사용한다.

실제 인증 연결에는 `.env.example`의 MARKETORY_SUPABASE_URL·MARKETORY_SUPABASE_PUBLISHABLE_KEY를 설정해야 한다. 미설정 상태의 보호 API는503이며 테스트용 로그인 경로를 제공하지 않는다. `/login`·`/account`와 요청 복구 UI는 구현되어 있고 실제 OTP 수신 검증은 후속이다. 웹 설정·테스트·Git 상태는 [인증 연결 안내](AUTH-SETUP.md)를 따른다.

## 계약과 디자인 변경

API 모델을 바꾸면 `npm.cmd run types:generate`를 실행한다. FastAPI → packages/types/openapi.json → src/api.d.ts가 단일 생성 경로다. `types:check`는 재생성 결과를 비교한다. 변경이 있으면 생성 파일이 갱신되고 검사 실패로 알리므로 변경 검토 후 함께 반영한다.

시각 토큰은 DESIGN.md → design-system/tokens.css → 앱 globals.css import 경로로 사용한다. 브랜드·글꼴은 assets:sync로 public에 복사하고 assets:check로 동일성을 검사한다. 앱 안의 복사본을 직접 편집하지 않는다. Button/Input은 shadcn 방식의 로컬 소유 컴포넌트이며 기존 디자인 토큰으로 스타일링했다. 전체 34개 컴포넌트 구현 완료를 의미하지 않는다.

## 배포 준비

- Vercel: 저장소 연결 후 Root Directory apps/web, 상위 workspace 파일 접근 허용. npm lockfile 설치 및 Next.js 빌드. API_BASE_URL은 배포된 Render API HTTPS 주소로 설정.
- Render: Docker context apps/api, Dockerfile apps/api/Dockerfile. API는 기본 CMD, worker는 `python -m marketory.worker`. 같은 소스·이미지 구성으로 두 서비스에 적용.
- API health 경로는 /health/ready. worker는 로그·프로세스 감시를 별도로 구성한다.
- Render에는 MARKETORY_ENVIRONMENT, MARKETORY_DATABASE_URL, MARKETORY_CORS_ORIGINS, MARKETORY_WORKER_POLL_SECONDS를 환경별로 설정한다. preview/production은 DB와 명시적인 HTTPS origin이 없으면 시작을 거절한다.
- DB는 psycopg transaction 경계. migration은 [migration 안내](../supabase/migrations/README.md)를 따른다.
- .github/workflows/ci.yml은 타입·테스트·문서·빌드 및 Docker build 검사를 정의했다. GitHub에서 실행한 결과는 아직 없다.

요금제·리전·외부 프로젝트·AI/메일 제공사는 [운영 준비](READINESS.md)에서 추적한다. 이 문서는 실제 배포 완료 증거가 아니다.
