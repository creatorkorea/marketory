# DB migration

업무 SQL migration은 이 폴더에서 버전 관리한다. `202610090001_foundation.sql`은 users·projects·project_members·sellers·audit_logs·api_idempotency 기반과 직접 접근 차단·RLS·요청 커밋 제약을 만든다. auth.users와 anon/authenticated는 Supabase가 제공해야 한다. 운영 환경에서 대용 auth 테이블을 만들지 않는다.

P1부터 Supabase CLI migration을 순차 추가한다. 적용은 API/worker 시작 시 자동 실행하지 않고 배포 전 별도 단계에서 한 번 수행한다. 연결은 migration용 direct 또는 session 연결을 사용한다. 런타임은 psycopg 명시적 transaction을 사용하며 transaction pooler를 사용할 때도 prepared statement를 비활성화한다.

로컬 통합 테스트는 loopback DB에 `marketory_test_<uuid>` 데이터베이스를 생성하고 auth.users 최소 대용 테이블·필요 역할을 준비한 뒤 이 migration을 적용한다. 검증 후 해당 테스트 DB만 제거한다. 애플리케이션의 일반 local 설정에서는 테스트 인증 override를 사용할 수 없다.

운영 연결 계정은 이 테이블을 처리할 서버 전용 DB 역할이어야 한다. anon/authenticated 연결은 의도적으로 거절된다. 실제 런타임 DB 역할·최소 권한과 Supabase 설정은 외부 연결 시 별도로 검증한다. API key와 PostgreSQL 접속 DSN은 서로 다른 설정이다.

공개 schema 테이블에는 권한·RLS 정책을 같은 migration에 포함한다. DB 연결 계정이 RLS를 우회할 수 있는 경우 API의 소유권·프로젝트 권한 검사로 대체되었다고 가정하지 말고 양쪽 경계를 검증한다.

2026-10-09: 실제 Supabase 프로젝트 `xtuznofafxlwlggnolns`에 CLI 2.120.0으로 foundation을 적용했다. 적용 전 업무 테이블이 없는 상태와 dry-run 대상 한 건을 확인했다. 원격 `supabase_migrations.schema_migrations`에 version `202610090001`, name `foundation`을 확인했고, 업무 테이블 6개의 RLS 및 anon/authenticated 접근 차단, 제약 trigger 3개를 조회했다. 로컬 API가 이 DB에 연결해 readiness 200을 반환했다. 실제 OTP·업무 E2E·외부 API 배포 검증은 별도다. 상세 상태는 [인증 연결 기록](../../docs/AUTH-SETUP.md)을 참고한다.
