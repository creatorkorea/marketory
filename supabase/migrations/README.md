# DB migration

업무 SQL migration은 이 폴더에서 버전 관리한다. `202610090001_foundation.sql`은 users·projects·project_members·sellers·audit_logs·api_idempotency 기반과 직접 접근 차단·RLS·요청 커밋 제약을 만든다. auth.users와 anon/authenticated는 Supabase가 제공해야 한다. 운영 환경에서 대용 auth 테이블을 만들지 않는다.

P1부터 Supabase CLI migration을 순차 추가한다. 적용은 API/worker 시작 시 자동 실행하지 않고 배포 전 별도 단계에서 한 번 수행한다. 연결은 migration용 direct 또는 session 연결을 사용한다. 런타임은 psycopg 명시적 transaction을 사용하며 transaction pooler를 사용할 때도 prepared statement를 비활성화한다.

로컬 통합 테스트는 loopback DB에 `marketory_test_<uuid>` 데이터베이스를 생성하고 auth.users 최소 대용 테이블·필요 역할을 준비한 뒤 이 migration을 적용한다. 검증 후 해당 테스트 DB만 제거한다. 애플리케이션의 일반 local 설정에서는 테스트 인증 override를 사용할 수 없다. 실제 DB migration은 아직 외부 Supabase에 적용하지 않았다.

운영 연결 계정은 이 테이블을 처리할 서버 전용 DB 역할이어야 한다. anon/authenticated 연결은 의도적으로 거절된다. 실제 런타임 DB 역할·최소 권한과 Supabase 설정은 외부 연결 시 별도로 검증한다. API key와 PostgreSQL 접속 DSN은 서로 다른 설정이다.

공개 schema 테이블에는 권한·RLS 정책을 같은 migration에 포함한다. DB 연결 계정이 RLS를 우회할 수 있는 경우 API의 소유권·프로젝트 권한 검사로 대체되었다고 가정하지 말고 양쪽 경계를 검증한다. 실제 운영 migration 적용은 아직 수행하지 않았다.
