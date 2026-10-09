# 개발 시작 안내

## 현재 준비 상태

업무 명세 7종, 디자인 규칙·34개 컴포넌트 명세·에셋이 있습니다. P0 실행 기반에 users/projects/권한/요청 결과 migration과 인증·bootstrap·조회·복구 API를 추가했습니다. 실제 OTP 연결과 신청·AI·발송 업무 기능은 남아 있습니다. [실행 안내](LOCAL-DEVELOPMENT.md), [P0 검증](P0-VERIFICATION.md), [P1/P3 기록](P1-P3-IMPLEMENTATION.md)을 따릅니다.

사용자 요청으로 [로드맵 P0](ROADMAP.md#p0-개발-기반과-경계-고정)의 로컬 기반 및 [인증·복구 UI](AUTH-SETUP.md)를 구현했습니다. GitHub origin은 연결했으며 Supabase 외부 계정 연결·배포는 아직 수행하지 않았습니다.

## 서비스의 한 바퀴

프로젝트 생성 → 모집 공개 → 셀러 OTP·프로필 → 신청·사진·제출 → 검증·보완 → AI 참고 검토 → 사람의 선정/대기/탈락 → 셀러 참가확정 → 부스 배치 → 안내 승인·발송 → 운영자료 출력.

단일 운영 조직이 여러 프로젝트를 운영하는 MVP입니다. 독립 고객사별 멀티테넌트, 결제·정산·매출관리, 소비자 쇼핑·쿠폰, 네이티브 앱, AI 자동 탈락은 현재 범위 밖입니다. XLSX는 MUST, PDF는 SHOULD입니다. 필수 기능 전체는 [03 기능명세](reference/03-features.md)를 따릅니다.

## 기술 구성과 책임

기존 [05 개발명세](reference/05-development.md)의 권장 구성을 바탕으로 합니다. **2026-10-08 사용자 결정으로 웹은 Vercel, Python API·worker는 Render, DB·인증·파일은 Supabase로 확정**했습니다. 상세 결정과 미완료 연결 작업은 [배포 구성](DEPLOYMENT.md)을 따릅니다. 버전·AI 제공사는 P0 및 운영 준비에서 확정합니다.

| 영역 | 기술 및 배포 기준 | 책임 |
|---|---|---|
| 웹 | Next.js App Router, TypeScript, Tailwind, shadcn/ui | 화면·인증 동선·업무 API 전달 |
| 업무 API | FastAPI | 인증·권한·상태전이·트랜잭션·감사 |
| 비동기 AI | LangGraph + Provider Adapter | 평가·추천·초안, 최종결정 금지 |
| DB·인증·파일 | Supabase PostgreSQL/Auth/Storage 확정 | 제약·계정·private 파일, 실제 연결 미완료 |
| 웹 배포 | Vercel 확정 | 사용자 결정 2026-10-08. 실제 계정·프로젝트 미연결 |
| Python API 배포 | Render Web Service 확정 | FastAPI 요청 처리, 실제 연결 미완료 |
| Python worker 배포 | Render Background Worker 확정 | AI·발송 비동기 처리, 실제 연결 미완료 |

Next.js와 FastAPI 양쪽에 독립적인 업무 상태전이 로직을 만들지 않습니다. 실제 업무 변경은 Python 도메인 처리의 한 트랜잭션 경계에서 수행합니다. OpenAPI를 기준으로 클라이언트 타입을 생성하고 DTO를 수동 이중 관리하지 않습니다. API와 worker는 같은 Python 코드·Docker 이미지를 사용하고 실행 명령을 분리합니다. 초기 API 1개·worker 1개를 기준으로 하며, 종료·재시작·claim 복구 구현은 P0/P3/P5/P7에서 검증합니다.

## 제품 폴더 책임

`apps/web`, `apps/api`, `packages/types`, `supabase/migrations`를 생성했습니다. Python 코드는 `apps/api/src/marketory`, 현재 테스트는 `apps/api/tests`에 있습니다. 아래 agents/services와 루트 tests는 후속 업무 구현 때 구성할 예정입니다.

| 경로 | 책임 |
|---|---|
| apps/web | 공개 모집·셀러·운영 화면, 공통 UI primitive |
| apps/api | API·인증·권한·도메인 처리 |
| apps/api/agents | AI 상태·노드·프롬프트·출력 스키마 |
| apps/api/services | 파일·제공사·출력 adapter |
| packages/types | OpenAPI로 생성한 타입·공통 계약 |
| supabase/migrations | DB 테이블·제약·권한·함수 |
| tests | API·동시성·worker·브라우저 검증 |

버전·잠금파일·실제 실행 명령은 [로컬 개발 안내](LOCAL-DEVELOPMENT.md)에 기록했습니다.

## 반드시 유지할 계약

1. 공개 가입은 USER/SELLER/ACTIVE이며 STAFF·PLATFORM_ADMIN을 부여하지 않습니다. 프로젝트 역할과 셀러 소유권을 서버에서 검사합니다.
2. 같은 셀러/프로젝트는 한 신청입니다. 취소·탈락 뒤 새 신청을 자동 허용하지 않습니다.
3. DRAFT 제출 전 필수 누락은 422이며 DRAFT 유지. 접수 후 보완은 NEED_INFO와 별도 보완기한을 사용합니다.
4. 선정 APPROVED와 참가확정 CONFIRMED를 구분합니다. 정원은 두 상태의 합으로 검사합니다.
5. 현재시각·event_end_at·프로젝트 상태를 서버가 검사합니다. UI의 버튼 숨김은 서버 검사 대체가 아닙니다.
6. AI 결과는 버전 누적으로 저장하고 최종 상태를 변경하지 않습니다. 늦은 결과와 이전 revision을 구분합니다.
7. 부스는 프로젝트 일치·활성 단일 배정·회수 이력을 보장합니다. 교환은 한 트랜잭션입니다.
8. 안내 승인은 READY, 별도 발송 요청은 QUEUED. UNKNOWN은 근거 확인 전 재발송하지 않습니다.
9. 중복 요청 결과와 업무 변경은 같은 DB 트랜잭션으로 커밋합니다. IN_PROGRESS만 단독 커밋하지 않습니다. EXPIRED 키는 재실행하지 않습니다.
10. 사진은 한 파일의 의도 발급→전송→연결 완료 후 다음 파일을 처리합니다. 미완료·실패 상태에서 제출하지 않습니다.

정확한 상태전이·필드·API는 검색용 참조본에 있으며, 위 목록은 대체 명세가 아닙니다.

## 화면 개발 시 연결할 파일

- [06 화면설계](reference/06-screens.md): SCR ID·경로·사용자 동선
- [DESIGN.md](../DESIGN.md): Pretendard·딥그린·크림·차양·여백
- [UX-CONTRACT.md](../UX-CONTRACT.md): 저장·권한·결정·복구
- [COMPONENTS.md](../design-system/COMPONENTS.md): 공통 컴포넌트별 치수와 상태
- [에셋 안내](../design-system/README.md): 참고용 PNG와 실제 재사용 에셋 구분

정적 견본의 버튼은 제품 기능이 아닙니다. 업무 상태를 테스트할 때 정적 HTML 클릭 결과를 증거로 쓰지 않습니다. 정확한 폰트·색상·문구는 문서·토큰을 따르고 생성 이미지의 글자·페이지 수·예시 날짜를 구현 상수로 복사하지 않습니다.

## 작업을 나누는 단위

각 단계는 화면만 완료하지 않고 필요한 API·DB 제약·권한·예외·검증까지 한 기능 흐름으로 완료합니다. 변경마다 기능 ID, SCR ID, 관련 AC/E2E, 증빙 경로를 기록합니다. 외부 제공사가 미확정이면 명시적인 테스트 adapter로 개발하되 실제 OTP·발송·배포가 검증됐다고 표시하지 않습니다.
