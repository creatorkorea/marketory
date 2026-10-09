# P1/P3 인증·권한·요청 복구 구현 기록

기준일: 2026-10-09. 백엔드 기반을 구현했다. 실제 Supabase 연결·OTP 수신·인증 UI·후속 업무 기능의 통합 완료를 뜻하지 않는다.

## 구현 범위

| 경로 | 역할 |
|---|---|
| POST /api/auth/bootstrap | 인증 계정 초기화, USER/SELLER/ACTIVE 기본값, 기존 역할 유지, 확인된 이메일 동기화 |
| GET /api/me | 본인 정보·프로필 필요 여부 |
| GET /api/projects | 활성 STAFF의 배정 프로젝트 또는 관리자 범위, limit/offset |
| GET /api/projects/{project_id} | 권한이 있는 프로젝트의 최소 요약, 개인정보 없음 |
| GET /api/me/requests/{operation}/{idempotency_key} | 저장 결과/202 UNRESOLVED/410 EXPIRED |

bootstrap 본문은 빈 JSON 객체 `{}`이고 UUID Idempotency-Key가 필수다. 역할·상태·user_id 입력을 받지 않는다. 최초 잘못된 입력은 users 생성까지 rollback한다. 초기화 전이라 users가 없는 인증 계정도 bootstrap 결과 조회에서 202를 받아 같은 키로 복구할 수 있다.

Supabase Auth의 `/auth/v1/user` 서버 검증을 사용한다. 토큰을 단순 decode해서 인증하지 않는다. 확인된 이메일·UUID만 취득하며 사용자 metadata의 역할을 무시한다. 삭제·정지·익명·이메일 미확인 계정은 거절한다. provider 장애와 잘못된 인증은 각각503/401이다. 원본 provider 오류나 토큰을 응답에 넣지 않는다. [공식 인증 조회 설명](https://supabase.com/docs/reference/python/auth-getuser)

프로젝트 권한은 현재 DB의 ACTIVE·STAFF·project_members를 검사한다. OPERATOR는 운영, REVIEWER는 검토, VIEWER는 요약만 허용한다. 미배정/타인 셀러는404, 행위 권한 부족은403. 파일·신청·출력 endpoint는 아직 없으며 해당 기능 추가 시 같은 검사와 별도 필드 마스킹을 연결해야 한다.

## DB와 원자성

[migration](../supabase/migrations/202610090001_foundation.sql)은 users(auth.users FK), projects, project_members, sellers, audit_logs, api_idempotency와 제약을 만든다. exposed public 테이블은 RLS 활성화 및 anon/authenticated 직접 권한 차단. 실제 서버 DB 역할 설정은 Supabase 연결 시 확인한다.

요청 core는 actor+operation+UUID 키의 advisory transaction lock과 UNIQUE를 사용한다. method·정규 경로·대상·본문의 hash를 비교하며, 현재 권한을 확인한 뒤 저장 결과를 재생한다. 최초 실행만 mutation callback이 version/상태를 검사한다. bootstrap 외 기존 객체 변경 API는 후속 단계에서 이 core에 연결한다.

업무 callback·감사·결과는 같은 transaction 안에서 수행한다. 업무 거절은 savepoint를 되돌리고 FAILED 응답을 저장할 수 있다. 기술 실패는 전체 rollback한다. IN_PROGRESS의 단독 commit은 deferred trigger가 차단하며 완료 응답·HTTP 상태는 DB 필수 조건이다. 키 잠금 대기는5초, 초과409 REQUEST_IN_PROGRESS + Retry-After:2이다.

EXPIRED는 본문·hash·resource·HTTP 상태를 제거하고 최소 고유키를 보존한다. 키를 새 요청으로 다시 실행하지 않는다. 내부 expire 함수는 cutoff를 주입받지만 공개 endpoint·자동 스케줄은 만들지 않았다. 비동기 자원의 종료/UNKNOWN 판정은 아직 구현하지 않았으므로 user/project 외 자원의 만료를 보수적으로 차단한다. AI·메일 handler 추가 시 종료 판정과 테스트를 함께 확장해야 한다.

## 검증과 수정

실제 로컬 PostgreSQL에 테스트별 데이터베이스를 생성하여 migration을 적용한다. 테스트용 auth.users는 Supabase Auth 대체 검증이 아니며 운영 migration에 포함하지 않는다. 인증 성공/실패는 httpx provider 응답 fixture 또는 test 전용 인증 주입으로 검증한다. local/preview/production에서는 인증 주입을 거절한다.

- P0 회귀, provider metadata/상태/장애, 역할별 권한, 타 프로젝트·타 셀러 접근 차단.
- 동시 같은 키 요청의 업무1회, hash 변경409, 커밋 전 예외 rollback, 커밋된 결과 재생.
- FAILED 업무 rollback과 재생, 권한 회수 후 재생 차단, 행 없는202·만료410·타 actor 격리.
- 잠금 대기5초 제한, 조회/만료 경합, 만료 민감값 제거, 미확인 비동기 자원 만료 차단.
- 독립 검토의 세 결함을 실패 테스트로 재현 후 수정: 초기 bootstrap 결과 복구403, 인증 이메일 미동기화, 완료 응답 HTTP 상태 NULL 허용.

2026-10-09 최종 실행: 테스트 **31개 통과(37.89초)**, Ruff·OpenAPI/TypeScript 동기화·웹 타입 검사 통과. 웹 production 빌드도 통과했다. 로컬 JUnit 결과는 `output/p1-p3-pytest.xml`에 저장했다. 웹 `/api/health`의 API 연결은 `ok`, 실제 인증 설정이 없는 API `/api/me`는 `503 AUTH_UNAVAILABLE`로 확인했다.

재현: [로컬 실행 안내](LOCAL-DEVELOPMENT.md)의 테스트 DB 환경변수 설정 후 `npm.cmd run check`. AC/E2E 원장에는 전체 업무 흐름을 실행하지 않은 항목을 PASS로 추가하지 않았다.

## 남은 연결

1. 실제 Supabase 프로젝트와 publishable key, 서버 DB 연결 계정·권한을 확인하고 migration 적용.
2. 이메일 OTP·세션 갱신·로그아웃·로그인 UI는 [인증 연결 안내](AUTH-SETUP.md) 단계에서 구현. 실제 인증 수신 확인은 남음.
3. 프로젝트 생성/수정(P2), 셀러 프로필·신청(P4)에 권한과 멱등 core 연결.
4. 클라이언트 UNRESOLVED 2/4/8초 재시도·결과 확인 화면은 bootstrap에 연결. 후속 업무 endpoint·worker 실제 작업 연결은 남음.

자동 외부 발송·유료 서비스 활성화·배포는 수행하지 않았다.
