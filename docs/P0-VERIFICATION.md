# P0 검증 기록

2026-10-08, Windows 로컬 작업 폴더 기준. Git 저장소가 아직 없어 커밋 SHA는 없다. 이번 기록은 P0 기반 검증이며 기존 AC/E2E 44개씩의 제품 업무 테스트 결과가 아니다.

## 확인 결과

| 항목 | 결과·범위 |
|---|---|
| Python 테스트 | 실제 로컬 PostgreSQL 포함 8개 통과 |
| SQL 경계 | TEMP 테이블 commit·예외 rollback·SELECT 1 확인 |
| API | live·ready 구분, 미설정/오류 503, 응답 비밀값 비노출, CORS 허용/거절 |
| worker | 실패 후 다음 프로브 재개·종료 event 검사, 실제 DB --once 성공, 연속 실행 후 Ctrl+C의 worker_stopped 확인 |
| OpenAPI | FastAPI snapshot과 TypeScript 재생성 동일성 확인 |
| 웹 | 타입 검사와 Next.js 프로덕션 빌드 통과 |
| UI | 360/390px·1440px 가로 넘침 없음, 폰트 로딩, 필수 오류 후 초점 이동·입력 보존, Tab 본문 바로가기 초점, 로컬 API 연결 확인 |
| UI 오류 복구 | API 503 응답 주입 후 오류 안내·재시도 버튼 복구, Enter 제출·초기화 확인 |

브라우저 검증은 Playwright CLI 0.1.22로 로컬 Chromium에서 수행했다. 별도 UI 견본에서 API 503을 주입했으며 실제 외부 서비스 장애 검증을 의미하지 않는다.

## 수정한 문제

- TypeScript 최신 버전과 openapi-typescript peer 범위 충돌: TypeScript 5.9.3으로 고정.
- Windows 기본 ProactorEventLoop와 psycopg async 비호환: worker·SQL 테스트에 명시적 SelectorEventLoop runner 사용. Uvicorn API에서도 실제 ready 응답 확인.
- Starlette TestClient의 httpx 경고: 해당 버전 권장 httpx2 테스트 의존성 추가.
- 독립 검토에서 잘못된 운영 설정의 ValidationError에 DB 입력값이 포함되는 문제 재현: hide_input_in_errors 적용 및 비밀값 비노출 회귀 테스트 통과.

## 검증하지 않은 범위

Docker 실행 파일이 이 PC에 없어 이미지 build·컨테이너 실행은 미검증이다. CI에 build 명령은 있으나 원격 실행 결과는 없다. 로컬 PostgreSQL은 Supabase의 Auth/Storage/RLS 검증을 대신하지 않는다. 실제 Supabase 연결, OTP·AI·메일·운영 배포, 업무 queue/claim, P1 이후 기능은 미구현 또는 미검증이다.

재현 명령은 [로컬 개발 안내](LOCAL-DEVELOPMENT.md)에 있다. 개발 스크린샷은 output/playwright 아래 로컬 산출물이며 원본 시안과 구분한다.
