# 05_바이브코딩_개발명세서_v1.3

> 자동 생성한 검색용 참조본입니다. 이 파일을 직접 수정하지 마세요.
> 원본: [05_바이브코딩_개발명세서_v1.3.docx](../../문서_보완본_v1.3/05_바이브코딩_개발명세서_v1.3.docx)
> 원본 SHA-256: `376e5b05de7bf8b7a7c9ba2b7e4353200aa29566d0e37d073cc12fb03c8247bd`
> 문단과 표의 내용을 원래 순서대로 옮겼습니다. Word 페이지 배치·도형·서식의 복제본은 아닙니다.
> 변경하려면 Word 원본을 수정한 뒤 `docs/tools/sync_reference_docs.py`를 다시 실행하세요.

FleaMarket AX

## 플리마켓 셀러 모집 운영 플랫폼

MVP 바이브코딩 개발명세서

Pilot Project : 2026 자운대 축제 플리마켓

<a id="table-01"></a>
**표 01**

| 문서 목적<br>서비스 기획서 → 업무 프로세스 상세설계서 → 기능명세서 → 화면설계서 → DB/데이터 구조 명세서에서 확정한 내용을 실제 코드로 구현할 수 있도록 기술스택, 저장소 구조, API, 권한, AI Agent, 파일 저장, 배포, 테스트와 바이브코딩 운영규칙을 하나의 개발 기준으로 고정한다. |
| --- |

Version 1.3  |  2026.10.08

문서 적용 기준: 본 문서는 2026년 10월 8일 v1.3 기준안이다. 공통 용어·상태·MVP 경계는 00_변경요약_공통계약_v1.3.docx를 따른다. 사업자 확인이 필요한 배포·행사 설정값은 공통계약의 운영 전 확인 목록으로 관리한다.

0. 개발 목표와 범위

이번 MVP의 개발목표는 “프로젝트 생성 → 셀러 신청 → 사전검증 → AI 검토 → 운영자 최종선정 → 참가확정 → 부스배치 → 안내·운영자료”가 실제 한 행사에서 끝까지 작동하도록 만드는 것이다. 자운대는 첫 번째 Project일 뿐이며, 코드 수정 없이 다른 플리마켓 프로젝트를 추가할 수 있어야 한다.

<a id="table-02"></a>
**표 02**

| MVP 핵심 원칙<br>Seller는 공통 마스터, Application은 Project별 신청 레코드 / 모든 운영 데이터는 project_id로 격리 / AI는 추천·평가만 수행하고 최종 승인·대기·탈락은 사람 / 상태 변경·AI 실행·부스·발송 이력은 보존한다. |
| --- |

<a id="table-03"></a>
**표 03**

| 구분 | 이번 MVP 포함 | 이번 MVP 제외 |
| --- | --- | --- |
| 핵심 운영 | 프로젝트·셀러·신청·심사·부스·안내·출력 | 결제·정산·매출관리 |
| AI | 분류·적합도·중복경고·부스추천·안내문 초안 | AI 자동 탈락·완전자율 운영 |
| 채널 | 반응형 웹, 셀러 모바일 신청 | 앱스토어 네이티브 앱 |
| 확장 | 여러 프로젝트 동시 운영 | 셀러 커뮤니티·방문객 쇼핑/쿠폰 |

1. 권장 시스템 아키텍처

비개발자가 바이브코딩으로 유지보수하기 쉬우면서, Python/LangGraph 구조를 실제 서비스에 연결하도록 프론트엔드·업무 API·AI 실행영역을 분리한다.

<a id="table-04"></a>
**표 04**

| 레이어 | 권장 기술 | 역할 | MVP 선택 이유 |
| --- | --- | --- | --- |
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | 공통 인증·공개 모집·SCR-01~08, 서버 라우팅은 업무 API 전달 | 반응형 관리자/셀러 화면 구현 |
| Backend/API | FastAPI (Python) | 업무 API, 권한검사, 상태전이, AI 서비스 호출 | Python으로 LangGraph/LLM 코드를 그대로 연결 가능 |
| AI Agent | LangGraph + LLM Provider Adapter | 분류·평가·중복검토·배치추천·메시지생성 | State/Node/Edge/Human approval 패턴을 서비스 로직에 재사용 |
| DB/Auth/Storage | Supabase (PostgreSQL + Auth + Storage) | 관계형 데이터, 로그인, 이미지/증빙파일 | MVP에서 별도 인프라 구축을 줄이고 PostgreSQL을 그대로 사용 |
| Deploy | Vercel + Render/Railway 계열 Python Host | Web과 FastAPI를 분리 배포 | 각 서비스의 배포·로그 확인이 단순함 |

<a id="table-05"></a>
**표 05**

| 단순화 원칙<br>MVP에서는 마이크로서비스를 여러 개로 쪼개지 않는다. Web 1개 + Python API/Agent 1개 + Supabase 1개로 시작하고, 실제 부하와 고객 수가 늘어난 뒤 분리한다. |
| --- |

1.1 요청 흐름

사용자 브라우저 → Next.js 화면 → FastAPI 업무 API → Supabase DB/Storage. AI가 필요한 기능만 FastAPI 내부의 LangGraph Agent를 호출하고, 결과를 evaluations/communications 등 지정 테이블에 저장한다.

- 최종 선정/탈락/대기, 부스 확정, 발송 승인 API는 AI Agent가 직접 호출하지 못하도록 권한을 분리한다.

- AI 결과는 version_no를 가진 Evaluation으로 누적 저장하고 재실행 시 기존 결과를 덮어쓰지 않는다.

2. 저장소와 개발환경

<a id="table-06"></a>
**표 06**

| 항목 | 개발 기준 |
| --- | --- |
| Repository | 단일 Git 저장소(monorepo) 권장 |
| 브랜치 | main = 배포 기준 / dev = 통합 테스트 / feature/* = 기능단위 작업 |
| 환경 | local / preview / production 3단계 |
| 비밀값 | Git에 커밋 금지. .env.local 또는 배포환경 Secret 사용 |
| 코드 규칙 | TypeScript strict, Python type hint, 기능 ID와 코드 모듈 이름 매핑 |
| 문서 기준 | 기능명세 ID·화면 ID·DB 테이블명을 코드 주석/PR 제목에서 유지 |

2.1 권장 디렉터리 구조

<a id="table-07"></a>
**표 07**

| 경로 | 내용 |
| --- | --- |
| /apps/web | Next.js 프론트엔드 및 관리자/셀러 화면 |
| /apps/api | FastAPI, 업무 API, 권한/상태전이 |
| /apps/api/agents | LangGraph State·Node·Router·Prompt·Schema |
| /apps/api/services | Supabase, 파일, 알림, export 서비스 |
| /packages/types | 공통 Enum/DTO/API 타입 정의 |
| /supabase/migrations | 테이블·인덱스·RLS·함수 SQL |
| /docs | 기획/기능/화면/DB/개발명세 및 변경기록 |
| /tests | API·Agent·E2E 테스트 |

2.2 환경변수

<a id="table-08"></a>
**표 08**

| 변수 | 용도 | 노출 금지 |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 웹의 Supabase 프로젝트 URL | 아니오(공개키와 함께 사용) |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 웹 공개 클라이언트 키 | 아니오. 공개키는 권한을 부여하지 않으며 RLS/GRANT 별도 적용 |
| SUPABASE_SECRET_KEY | 서버 전용 키; legacy service_role 사용 시 같은 통제 | 예. 브라우저·AI 입력·로그 노출 금지 |
| DATABASE_URL | 서버 DB 연결 | 예 |
| OPENAI_API_KEY / GOOGLE_API_KEY | AI Provider | 예 |
| APP_BASE_URL | 현재 배포 URL | 아니오 |
| AI_MODEL_NAME | 사용 모델명 교체용 | 아니오 |

3. 인증·권한·프로젝트 격리

기존 기능명세의 사용자 역할을 그대로 코드 권한으로 옮긴다. 핵심은 로그인 여부보다 “현재 사용자에게 해당 project_id의 어떤 작업 권한이 있는가”를 모든 API에서 확인하는 것이다.

<a id="table-09"></a>
**표 09**

| Role | 허용 범위 | 금지/제한 |
| --- | --- | --- |
| PLATFORM_ADMIN | 단일 조직 전체 프로젝트·사용자·감사로그 | 중요 작업 사유/감사로그 필수 |
| OPERATOR | 배정 프로젝트 생성/수정, 심사, 부스, 발송 | 타 프로젝트 접근 금지 |
| REVIEWER | 배정 신청·평가 조회, 검수메모, 연락처 마스킹 | 최종 선정·AI 실행·발송·배치·운영자료 출력 금지 |
| SELLER | 본인 Seller/Application 조회·작성·보완·취소 | 다른 셀러/심사정보 접근 금지 |
| AI_AGENT | 평가/추천 결과 생성 | Application 최종 상태 직접 변경 금지 |
| VIEWER | 배정 프로젝트 대시보드·상태 집계 | 신청 원문·개인정보·파일·내부 메모·출력 금지 |

3.1 RLS/권한 구현 기준

- users.user_id를 Supabase auth.users.id의 PK/FK로 사용한다. 별도 password_hash는 저장하지 않는다.

- project_members(project_id, user_id, role)을 운영자/검수자의 프로젝트 권한 기준으로 사용한다.

- 셀러용 조회는 sellers.user_id = 인증된 auth.users.id 및 applications.seller_id 연결 범위로 제한한다.

- 서버 secret key 또는 legacy service_role key는 FastAPI에서만 사용한다. 권한을 우회할 수 있으므로 사용자 인증·소유권·프로젝트 권한 검사를 모든 업무 요청에 별도로 적용한다.

- 중요 상태전이는 API 내부에서 권한확인 → DB 트랜잭션 → application_status_history/audit_logs 기록 순으로 처리한다.

4. DB 구현 기준과 마이그레이션 순서

DB/데이터 구조 명세서의 핵심 엔티티를 그대로 사용한다. 첫 개발 시 테이블을 한꺼번에 모두 만들지 않고 운영 핵심부터 순차적으로 적용한다.

<a id="table-10"></a>
**표 10**

| 순서 | 테이블/객체 | 개발 완료조건 |
| --- | --- | --- |
| 1 | users, projects, project_members | 관리자 로그인 후 본인 프로젝트만 조회 |
| 2 | sellers, applications, application_status_history, audit_logs | 소유권·임시저장·제출·이력·트랜잭션 함께 검증 |
| 3 | attachments | 상품사진/증빙 업로드와 연결 |
| 4 | evaluations | AI 결과 버전 누적 저장 |
| 5 | application_status_history, audit_logs 보강 | 상태·정책·수정 감사·권한 회귀 검증 |
| 6 | booths, booth_assignments | CONFIRMED만 부스 배치 |
| 7 | communications | 메시지 초안·승인·발송결과 저장 |
| 8 | communication_attempts, api_idempotency | 중복 요청·발송 응답 유실·복구 검증; 관련 변경 API 도입 시 함께 생성 |
| 9 | upload_intents, communication_resolutions | 각 첨부/발송 기능 도입 단계에 함께 생성; 완료 연결·결과 확인 회귀 검증 |

4.1 필수 DB 제약

<a id="table-11"></a>
**표 11**

| 규칙 | 구현 |
| --- | --- |
| 중복 신청 | UNIQUE(project_id,seller_id), 취소/탈락 이후 재신청 없음 |
| Evaluation 버전 | UNIQUE(application_id, version_no) |
| 부스 중복 | 한 프로젝트 내 booth_no UNIQUE, 활성 assignment 중복 차단 |
| 상태 Enum | DRAFT, SUBMITTED, NEED_INFO, REVIEWING, APPROVED, WAITING, REJECTED, CONFIRMED, CANCELLED |
| 시간 | UTC 저장, 화면은 KST 표시 |
| 삭제 | 주요 운영 레코드는 hard delete 대신 soft delete/상태종료 |

5. 업무 API 명세

URL은 예시이며 기능명세 ID를 API/서비스 함수와 연결한다. 응답 형식은 JSON으로 통일하고 모든 에러는 code, message, details, request_id 구조를 사용한다.

<a id="table-12"></a>
**표 12**

| Method / Endpoint | 기능 | 주요 권한/처리 |
| --- | --- | --- |
| GET /api/projects | 프로젝트 목록·집계 | 로그인 + project_members 범위 |
| POST /api/projects | PRJ-001 프로젝트 생성 | ADMIN/OPERATOR, 감사로그 |
| PATCH /api/projects/{id} | PRJ-002 설정 수정 | 모집 중 핵심정책 변경이력 기록 |
| POST /api/applications | APP-001 임시신청 생성 | SELLER, 본인 Seller 연결, 기본 DRAFT; 제출은 /submit 분리 |
| PATCH /api/applications/{id} | 임시저장/보완 | 소유자 또는 운영자 |
| POST /api/applications/{id}/validate | 사전검증 | 필수항목·중복일정·정책위반 경고 |
| POST /api/applications/{id}/ai-review | AI 실행·재시도 | OPERATOR, 202 + evaluation_id, 버전 누적 |
| POST /api/applications/{id}/decision | 승인/대기/탈락 | OPERATOR only, 상태이력 동시 기록 |
| POST /api/applications/{id}/confirm | 참가확정 | SELLER/OPERATOR, APPROVED·기한·version 검증; 취소는 /cancel 분리 |
| POST /api/projects/{id}/booths/recommend | 부스 추천 | OPERATOR, AI 결과는 임시 추천 |
| POST /api/projects/{id}/booths/confirm | 배치확정 | OPERATOR, audit log |
| POST /api/communications/generate | 안내문 초안 | AI 생성, 발송 아님 |
| POST /api/communications/{id}/send | 명시 발송 요청 | OPERATOR, READY 검증 후 QUEUED·요청자·시각 저장 및 202; worker가 별도 실행 |
| GET /api/projects/{id}/export | 현장운영자료 출력 | OPERATOR, 개인정보 최소화 |

6. Application 상태머신과 라우팅

Application.status를 화면 배지, 버튼 활성조건, API 검증, AI 실행 가능조건의 단일 기준값으로 사용한다.

<a id="table-13"></a>
**표 13**

| 현재 상태 | 이벤트 | 다음 상태 | 실행 주체 |
| --- | --- | --- | --- |
| DRAFT | submit | SUBMITTED | SELLER |
| SUBMITTED | validate_ok | REVIEWING | SYSTEM |
| SUBMITTED | validate_missing | NEED_INFO | SYSTEM |
| SUBMITTED / REVIEWING | request_info | NEED_INFO | OPERATOR |
| NEED_INFO | resubmit | SUBMITTED | SELLER |
| REVIEWING | approve / wait / reject | APPROVED / WAITING / REJECTED | OPERATOR |
| WAITING | promote / reject | APPROVED / REJECTED | OPERATOR |
| APPROVED | confirm | CONFIRMED | SELLER / OPERATOR |
| DRAFT / SUBMITTED / NEED_INFO / REVIEWING / APPROVED / WAITING / CONFIRMED | cancel | CANCELLED | SELLER / OPERATOR |
| NEED_INFO | extend_info | NEED_INFO | OPERATOR |

<a id="table-14"></a>
**표 14**

| 개발 가드레일<br>프론트엔드 버튼을 숨기는 것만으로 권한을 보장하지 않는다. FastAPI가 “현재 상태 + 사용자 권한 + Project 범위”를 다시 검증한 뒤 상태를 바꿔야 한다. |
| --- |

7. AI Agent 개발명세

AI Agent는 기존 서비스 기획의 “심사 보조” 원칙을 따른다. 운영자에게 근거와 경고를 제공하지만 최종 상태를 직접 확정하지 않는다. 자운대 프로젝트의 규칙은 Prompt에 하드코딩하지 않고 Project 설정값을 입력으로 전달한다.

7.1 Agent State

<a id="table-15"></a>
**표 15**

| State 필드 | Type | 용도 |
| --- | --- | --- |
| project_id | str | 현재 프로젝트 정책 조회 기준 |
| application_id | str | 검토 대상 신청 |
| project_policy | dict | 허용/제한품목, 심사기준, 운영조건 |
| seller_profile | dict | 공통 Seller 정보 및 과거 이력 요약 |
| application_data | dict | 이번 신청의 상품/가격/전기/화기/사진 등 |
| category_suggestion | str | AI 분류 제안, applications.category 최종값과 분리 |
| fit_score | int 0~100 | 프로젝트 적합도 참고점수 |
| duplicate_warnings | list | 동일일자/유사품목/중복 후보 |
| warning_json | list | code/message 구조의 위험·누락 경고 |
| recommendation | str | 추천/검토필요 등의 보조결론 |
| reason_summary | list | 3~6개 근거 문자열 배열 |
| version_no | int | AI 재실행 결과 버전 |

7.2 Node/Workflow

<a id="table-16"></a>
**표 16**

| Node | 역할 | 출력 |
| --- | --- | --- |
| load_context | Project/Seller/Application 데이터 로드 | 정규화된 State |
| validate_input | 필수정보·형식 확인 | missing_fields, warning_json |
| classify_category | 상품/서비스 카테고리 분류 | category_suggestion |
| check_duplicates | 같은 날짜 타 Project·유사품목 후보 검색 | duplicate_warnings |
| evaluate_fit | 심사기준 기반 적합도 평가 | fit_score, recommendation, 근거 |
| human_review_gate | AI 결과 저장 후 운영자 심사 대기 | END(사람의 결정 대기) |
| recommend_booth | CONFIRMED 대상으로 조건 기반 부스추천 | 추천 booth_id/근거 |
| draft_message | 상태·부스·준비사항을 반영한 안내문 초안 | Communication draft |

7.3 AI 출력 스키마

구조화 출력(Pydantic)을 강제한다. 자연어 한 덩어리를 그대로 DB에 저장하지 말고 아래 필드를 분리한다.

<a id="table-17"></a>
**표 17**

| 필드 | 제약 |
| --- | --- |
| category_suggestion | 프로젝트 카테고리 Enum 또는 OTHER |
| summary | 신청 원문 요약 문자열, 성공 시 필수 |
| fit_score | 0~100 정수 |
| recommendation | RECOMMEND / REVIEW / CAUTION |
| reason_summary | 3~6개 근거 문자열 배열 |
| warning_json | [{code,message}] |
| similar_application_ids | 동일 프로젝트의 유효한 신청 ID 배열, 셀러 공개 응답에서 제외 |

7.4 Router 규칙

- 입력 누락 → AI 평가 중단 후 warning 기록. NEED_INFO 전환은 서버 사전검증 또는 운영자 request_info 액션으로만 수행한다.

- AI 평가 완료 → Evaluation 저장 → 운영자 심사화면으로 종료한다. 자동 APPROVED/REJECTED 금지.

- AI 호출 실패 → Application 상태는 유지하고 evaluations.status=FAILED 및 재실행 버튼 제공.

- 부스추천은 CONFIRMED만 대상으로 하며 전기/화기/차량 등 충돌이 있으면 “추천 불가/수동검토”를 반환한다.

8. 파일·사진·Storage 명세

<a id="table-18"></a>
**표 18**

| 항목 | 기준 |
| --- | --- |
| 버킷 | seller-assets 또는 프로젝트별 논리경로 사용 |
| 경로 예시 | project/{project_id}/application/{application_id}/{uuid}.jpg |
| DB 저장 | attachments에 storage_key, mime_type, size_bytes, seller_id 또는 application_id, uploaded_by 기록 |
| 업로드 | 브라우저 → signed upload 또는 서버 검증 후 Storage |
| 허용파일 | MVP는 jpg/png/webp/pdf 등 필요 최소형식만 |
| 보안 | public bucket 지양. signed URL로 제한시간 조회 |
| 삭제 | Application 취소와 파일 삭제를 즉시 연동하지 말고 보존정책에 따라 처리 |

9. 8개 핵심 화면 구현 매핑

<a id="table-19"></a>
**표 19**

| 화면 | 주 API/DB | MVP 구현 포인트 |
| --- | --- | --- |
| SCR-01 프로젝트 대시보드 | projects + applications 집계 | 검색/상태/기간 필터, 신청·승인·확정 수 |
| SCR-02 프로젝트 설정 | projects | 정책을 JSON/정규 필드로 저장, 코드 수정 없이 변경 |
| SCR-03 셀러 모바일 신청 | sellers + applications + attachments | 단계형 폼, 임시저장, 사진업로드, 제출검증 |
| SCR-04 신청/심사 목록 | applications + latest evaluation | 필터/정렬/상태배지/AI점수 요약 |
| SCR-05 상세·AI 검토 | application + seller + evaluations + history | 원문과 AI근거 병렬, 최종결정은 사람 |
| SCR-06 부스 배치 | booths + assignments | CONFIRMED만 표시, 추천 후 수동 조정/확정 |
| SCR-07 안내·운영자료 | communications + export | AI 초안→운영자 승인→발송, XLSX(필수)/PDF(선택) 출력 |
| SCR-08 내 신청·참가확정 | 본인 applications + 공개 안내 + 확정 assignment | 보완·참가확정·취소·결과 조회, 내부 심사정보 제외 |

10. 로깅·감사·예외처리·보안

<a id="table-20"></a>
**표 20**

| 영역 | 구현 기준 |
| --- | --- |
| API 로그 | request_id, user_id, project_id, endpoint, status, latency 저장/검색 가능 |
| Audit | 정책수정·상태결정·부스확정·발송에 before/after, actor, timestamp 기록 |
| AI 로그 | model, prompt_version, evaluation version, token/cost metadata(가능한 범위) |
| 개인정보 | 관리자 화면은 필요한 연락처만 표시, export 범위를 역할별 제한 |
| 발송 실패 | communications.send_status=FAILED + failure_reason + communication_attempts 기록 후 재시도 |
| 동시수정 | updated_at/version 기반 충돌감지 또는 DB 트랜잭션 |
| Rate limit | AI review/발송 API에 사용자·프로젝트 단위 제한 |
| 백업 | Supabase DB 백업 정책 확인 + 핵심 export 주기적 보관 |

11. 테스트와 완료조건

기능이 “보인다”가 아니라 실제 자운대 Pilot 시나리오가 끝까지 통과해야 MVP 완료로 본다.

<a id="table-21"></a>
**표 21**

| Test ID | End-to-End 시나리오 | Pass 기준 |
| --- | --- | --- |
| E2E-01 | 운영자 새 프로젝트 생성→모집 공개 | 새 project_id 생성, 공개 링크 정상 |
| E2E-02 | 신규 셀러 신청→사진→제출 | Seller/Application/Attachment 저장, SUBMITTED |
| E2E-03 | 기존 셀러가 다른 프로젝트 신청 | Seller 재사용, 새 Application만 생성 |
| E2E-04 | 필수정보 누락과 접수 후 보완 | 제출 전 422/DRAFT 유지, 접수 후 NEED_INFO→보완 제출 동작 |
| E2E-05 | AI 검토 실행 | Evaluation 생성, 원문/점수/근거 표시, 최종상태 미변경 |
| E2E-06 | 운영자 승인/대기/탈락 | status + history + audit 동시 반영 |
| E2E-07 | 승인 셀러 참가확정 | CONFIRMED 전환 |
| E2E-08 | 부스 추천→수동변경→확정 | 중복 없이 assignment 저장 |
| E2E-09 | 안내 생성→승인→발송 | Communication 상태·발송이력 기록 |
| E2E-10 | 참가취소 | CANCELLED, 부스회수, 대기자 승격 검토 이벤트 |
| E2E-11 | 타 프로젝트 운영 | 자운대 데이터와 완전 분리 |
| E2E-12 | 현장운영자료 출력 | 선정/부스/연락처가 지정 형식으로 출력 |
| E2E-13 | 다른 셀러 신청 및 파일 ID로 접근 | 404, 개인정보·signed URL·심사정보 미반환 |
| E2E-14 | 미배정 프로젝트 접근 및 권한 회수 | API·파일·출력 차단, 기존 로그인 세션도 재검사 |
| E2E-15 | 동일 셀러가 같은 행사에 동시 제출 | 신청 1개 유지, 중복 요청은 기존 결과 또는 409 |
| E2E-16 | 같은 부스 동시 확정 및 다른 프로젝트 ID 혼합 | 1건만 성공, 나머지 409/404, 교차 프로젝트 연결 0건 |
| E2E-17 | 참가확정과 취소 동시 실행 | version 일치 1건만 성공, 상태·배치·이력 원자적 일치 |
| E2E-18 | AI 실패 및 보완 도중 늦게 도착한 결과 | FAILED/이전 revision 기록, 신청 최종상태 미변경, 낡은 평가 표시 |
| E2E-19 | 발송 응답 유실 후 재시도 | UNKNOWN 표시, 제공사 조회 또는 수동 확인 전 재발송 차단 |
| E2E-20 | 승인 후 메시지 수정 또는 셀러 취소 | 승인 무효화, READY/QUEUED 대상 발송 차단, 이력 유지 |
| E2E-21 | 모집 마감 후 신규 제출과 요청된 보완 제출 | 신규 차단, NEED_INFO는 info_due_at까지 허용 |
| E2E-22 | 계정·역할·상태 필드 변조 | 대량 필드 주입 차단, 직접 DB 쓰기 및 권한 상승 실패 |
| E2E-23 | 확정기한 만료 및 모집정원 초과 | 자동 취소 없음, 경고·기한연장 가능, 초과 승인은 409 |
| E2E-24 | 필수 동의 미체크 및 행사 종료 후 수정 | 제출 차단, 완료 행사 신규 업무 차단, 허용된 출력·열람·기존 작업 결과 확인 유지 |
| E2E-25 | 공개 셀러 최초 OTP 인증과 재로그인 | users는 1개, global_role=USER/account_role=SELLER, name 미입력은 프로필 단계로 이동, STAFF 자가 지정 차단 |
| E2E-26 | 안내 수신처 생성 및 계정 이메일 변경 | 최초 검증 이메일 snapshot 저장, 계정 변경만으로 기존 신청 불변, 명시 동기화 시 관련 승인 무효화 |
| E2E-27 | 보완기한 만료 후 운영자 연장 | 만료 중 resubmit 409, 기한 연장 후 SUBMITTED 가능, 변경 전후·사유·안내 초안 기록 |
| E2E-28 | 행사 당일 부스 변경과 종료 경계 | event_end_at 이전 변경 가능, 경계 이후 신규 업무 차단, COMPLETED 후 기존 UNKNOWN 확인은 허용 |
| E2E-29 | UNKNOWN 결과 확인 및 중복 확인 | 근거 있는 조회/수동 확인만 SENT/FAILED 전환, 미확인은 UNKNOWN 유지, 같은 요청 중복 처리 없음 |
| E2E-30 | 실패 발송 수정과 동일 내용 재시도 | 동일 내용 재시도는 같은 작업·키, 내용/수신처 수정은 새 작업·키·재승인, 이전 이력 보존 |
| E2E-31 | 두 셀러 부스 교환과 중간 실패 | 두 배치 모두 원자적 교환, 실패 시 기존 둘 다 유지, 한 작업의 알림 초안은 커밋 후 생성 |
| E2E-32 | 첨부 변경 및 만료 전 업로드 URL 재사용 | DRAFT/허용 보완 항목만 변경, 요청 시와 complete 시 재검증, revision 증가, 제출 후 기존 객체 덮어쓰기 차단 |
| E2E-33 | VIEWER와 REVIEWER 화면/API/출력 접근 | VIEWER 집계만, REVIEWER 검수·마스킹 조회만, 직접 API·다운로드 우회 차단 |
| E2E-34 | CLOSED 행사 재검토 전환 | 사유·version·event_end_at 검사 후 REVIEWING, 종료 후 또는 무권한 재개 차단 |
| E2E-35 | 시간 초과 회수 후 늦은 worker 응답 | claim_token과 상태가 일치하는 작업만 결과 반영, 늦은 응답은 최종 상태 덮어쓰기 금지 |
| E2E-36 | 안내 승인과 발송 요청 분리 | approve 후 READY 유지·외부 호출 0회, send 후 QUEUED, worker만 SENDING으로 전환 |
| E2E-37 | QUEUED 상태에서 대상 변경 또는 행사 종료 | worker와 같은 잠금 규칙으로 발송 철회·변경 반영, 최신성 검사 실패 시 외부 호출 0회; QUEUED에 남겨 두지 않음 |
| E2E-38 | 요청 처리 중 커밋 전 프로세스 중단 | 업무 변경과 idempotency 레코드 모두 롤백, 같은 키·본문 재시도 시 1회 반영 |
| E2E-39 | 커밋 직후 응답 유실 또는 worker 재시작 | 같은 키 재시도는 기존 결과·작업 ID 반환, 중복 신청/발송 작업/첨부 생성 없음; QUEUED 작업 복구 |
| E2E-40 | 같은 요청 동시 실행과 키 재사용 오류 | 동일 키·본문은 직렬 처리·동일 결과, 다른 본문은 409; 권한 회수 후 저장 결과 재조회도 차단 |
| E2E-41 | 사진 10장 순차 완료와 제출 | 파일별 최신 version/revision으로 의도 발급·업로드·완료, 10개 첨부 보존, 미완료가 있으면 제출 비활성화 |
| E2E-42 | 사진 완료 응답 유실과 다른 탭의 수정 | 응답 유실은 같은 complete 키·본문 재시도로 복구; 타 탭 실제 수정은 409 후 재조회, 업로드 의도 version을 임의 덮어쓰지 않음 |
| E2E-43 | QUEUED 수정과 worker 동시 실행 | 시도 없는 QUEUED는 대기 취소·승인 초기화·내용 수정·DRAFT 전환이 함께 커밋. worker가 먼저 SENDING이면 수정 409. 양쪽 동시 성공·외부 중복 호출 없음 |
| E2E-44 | 결과 본문 만료 후 요청 재사용 | 만료 처리와 재시도 경합에서도 기존 업무 1회 유지. EXPIRED에는 응답·해시·resource 없음. 동일/다른 본문 재요청과 조회 모두 410, 행 없는 조회만 202. 미종료 작업 만료 차단, 다른 actor 기록 비노출 |

12. 바이브코딩 개발 순서

한 번에 전체 플랫폼을 생성하지 않는다. “작은 기능 → 실행 확인 → Git commit → 다음 기능”으로 진행한다. 각 단계는 화면, API, DB를 함께 끝내는 수직 슬라이스 방식이 좋다.

<a id="table-22"></a>
**표 22**

| Sprint | 개발 범위 | 완료 산출물 |
| --- | --- | --- |
| S0 | 프로젝트 초기화·Supabase 연결·Auth·공통 타입 | 로그인, /health, 환경변수/README |
| S1 | Project 대시보드·설정 | SCR-01/02 + projects API/DB |
| S2 | Seller/Application 신청 | SCR-03/08 + 소유권 + 사진·동의·snapshot·최초 상태이력 |
| S3 | 신청 목록·상태/사전검증 | SCR-04 + 공통 상태머신 + NEED_INFO·보완기한 |
| S4 | AI Review | LangGraph + Evaluation + SCR-05 |
| S5 | 운영자 결정·참가확정 | decision API + history/audit |
| S6 | 부스배치 | SCR-06 + booths/assignments |
| S7 | 안내·출력 | SCR-07 + communications/export |
| S8 | 자운대 실데이터 Pilot QA | E2E-01~44, 오류수정, 배포 |

12.1 바이브코딩 작업 프롬프트의 기본 틀

<a id="table-23"></a>
**표 23**

| 한 기능씩 요청<br>“기능명세 APP-002 신청 제출 기능을 구현한다. 기존 DB/상태 Enum을 바꾸지 말고, 먼저 수정할 파일 목록과 처리흐름을 제안한 뒤 코드를 작성하라. project_id 격리, 권한, 상태이력, 에러처리를 포함하고 테스트 코드를 추가하라. 완료 후 실행 방법과 확인할 화면을 알려라.” |
| --- |

- AI에게 전체 시스템을 한 번에 만들라고 하지 않는다.

- “기존 명세의 무엇을 유지해야 하는지”를 매번 프롬프트에 명시한다.

- 새 테이블/필드를 임의로 추가하지 말고 필요 시 먼저 제안하도록 한다.

- 작동 확인 전 다음 기능으로 넘어가지 않는다.

- 오류가 발생하면 임시 우회보다 원인·영향범위·재현절차를 먼저 출력하게 한다.

13. 자운대 Pilot 초기 설정값

아래는 Pilot 생성 시 채워야 할 설정항목이다. 실제 행사 확정값이 아직 문서에 없는 항목은 개발 시 기본값을 넣지 말고 관리자 입력값으로 둔다.

<a id="table-24"></a>
**표 24**

| 설정 영역 | 자운대 Project에서 입력할 값 |
| --- | --- |
| 기본 | 프로젝트명, 행사일, 장소, 모집기간, 모집팀수 |
| 모집정책 | 허용/제한 품목, 참가비, 사업자 여부, 사진 필수 여부 |
| 운영조건 | 부스 규격, 전기, 테이블, 화기, 차량 진입 |
| 심사기준 | 축제 적합성, 상품 차별성, 카테고리 중복, 운영 안정성 |
| 상태/안내 | 선정·대기·탈락·보완·참가확정 안내 템플릿 |
| 부스 | 부스 코드, 존/구역, 전기/화기 가능 여부 |

<a id="table-25"></a>
**표 25**

| 중요<br>자운대만을 위한 if/else를 코드에 넣지 않는다. 행사별 차이는 Project 정책과 Booth 설정으로 표현한다. 그래야 같은 시기에 여러 플리마켓을 동시에 운영하고 다음 행사에 그대로 재사용할 수 있다. |
| --- |

14. 개발 착수 체크리스트

- Git 저장소 생성 및 README에 프로젝트 목적·MVP 범위 명시

- Supabase 개발 프로젝트 생성, Auth/DB/Storage 연결 확인

- 환경변수 샘플(.env.example) 작성 — 실제 Key는 포함하지 않음

- DB migration 1(users/projects/project_members)부터 적용

- Web/API 각각 health check와 로컬 실행 성공

- 공통 ApplicationStatus Enum을 web/api/DB에서 동일하게 사용

- 첫 수직 슬라이스 SCR-01 프로젝트 대시보드 구현

- 각 기능 완료 시 테스트 → 화면 확인 → Git commit → 다음 기능 진행

- AI 기능은 일반 업무 흐름이 먼저 안정된 후 S4에서 연결

- 자운대 Pilot 실제 운영 전에 테스트 프로젝트로 E2E-01~44 리허설

15. 개발 완료 정의(Definition of Done)

<a id="table-26"></a>
**표 26**

| 구분 | 완료 기준 |
| --- | --- |
| 기능 | 기능명세 MUST 항목과 E2E-01~44 통과 |
| 데이터 | 프로젝트 격리, 상태이력, AI 버전, 부스/발송 이력 확인 |
| 권한 | 역할별 허용/차단 시나리오 통과 |
| AI | 구조화 출력, 실패처리, 사람 최종결정 가드레일 확인 |
| 모바일 | 셀러 신청이 스마트폰에서 사진업로드 포함 완료 |
| 운영 | 자운대 프로젝트 생성→모집→심사→배치→안내 전체 리허설 |
| 배포 | Production URL, 로그/환경변수/백업/롤백 절차 확인 |
| 문서 | README, DB migration, API 문서, Prompt 버전, 변경기록 최신화 |

이 문서는 “코드를 어떻게 짤지”보다 “무엇을 바꾸면 안 되고, 어떤 순서로 무엇을 검증하며 개발할지”를 고정하는 기준문서다. 바이브코딩 중 새로운 아이디어가 생겨도 먼저 기획/기능/DB 명세의 변경 여부를 확인한 뒤 반영한다.

## 16 인증과 서버 권한 계약

이메일 OTP 인증을 기본으로 한다. 공개 모집공고는 비로그인 접근 가능하고 작성 시작 전에 로그인한다. users.user_id=auth.users.id, sellers.user_id=users.user_id로 소유권을 연결한다. project_members는 STAFF 계정에만 부여하며 OPERATOR/REVIEWER/VIEWER를 저장한다. 생성자는 프로젝트 생성과 같은 트랜잭션에서 OPERATOR 멤버로 등록된다.

FastAPI는 인증 토큰 검증 후 활성 사용자·project_members·행위 권한을 조회한다. JWT의 사용자 수정 가능한 metadata를 권한 근거로 사용하지 않는다. 업무 테이블은 exposed schema에서 RLS를 켜고 anon/authenticated의 직접 쓰기를 차단한다. 브라우저는 Auth와 서버가 발급한 제한된 파일 업로드 외의 업무 CRUD를 FastAPI로만 요청한다. 서버 권한으로 쓰는 경우 RLS가 사용자 권한 검사 대신이 되지 않는다.

셀러 응답은 상태·공개 안내·본인 제출정보·본인 확정 부스만 포함한다. evaluations·내부 메모·다른 셀러 ID는 제외한다. 관리자 응답도 배정 프로젝트만 허용하며 비배정 프로젝트와 겹치는 일정은 여부만 표시한다. 첨부파일은 조회 시마다 권한 확인 후 짧은 만료의 signed URL을 생성한다. REVIEWER는 심사 대상 상품사진만 접근하고 사업자 증빙·VIEWER 파일 접근은 차단한다.

## 17 API 요청과 응답 계약

공통 변경 요청은 기존 객체에 대해 expected_version, 모든 변경에 Idempotency-Key 헤더를 사용한다. 인증 후 같은 키의 EXPIRED 여부를 먼저 확인해 동일 actor에게 410만 반환한다. 그 외에는 현재 대상 권한 검사 후 저장 결과를 확인하고 최초 실행일 때만 expected_version을 검사한다. user_id·역할·project_id 연결·status는 허용된 전용 액션을 통해 서버가 결정하며 일반 PATCH 본문에 포함되면 422를 반환한다. 성공 응답은 data와 request_id, 오류는 code/message/details/request_id를 사용한다. 권한 없는 객체는 404, 역할 부족은 403, 버전·상태 충돌은 409, 입력 오류는 422다.

<a id="table-27"></a>
**표 27**

| API | 입력 | 성공 결과 |
| --- | --- | --- |
| GET /api/public/projects/{id} | 공개 project_id | 공개 모집정보·기간·정책·접수가능 여부 |
| GET /api/me/applications | 인증 사용자 | 본인 신청 목록·상태·가능 액션 |
| GET /api/applications/{id} | 신청 ID | 역할별 필드만 반환, version·허용 액션 포함 |
| POST /api/applications/{id}/submit | expected_version, 동의 version | 필수검증 후 SUBMITTED, snapshot·이력 저장 |
| POST /api/applications/{id}/request-info | expected_version, fields[], reason, info_due_at | NEED_INFO 및 보완 안내 초안 |
| POST /api/applications/{id}/resubmit | expected_version | NEED_INFO→SUBMITTED, last_submitted_at |
| POST /api/applications/{id}/decision | expected_version, decision, reason, confirm_due_at 또는 waiting_rank | APPROVED/WAITING/REJECTED, 정원 검사 |
| POST /api/applications/{id}/cancel | expected_version, reason | CANCELLED·부스 해제·미발송 안내 무효화 |
| POST /api/applications/{id}/extend-confirmation | expected_version, confirm_due_at, reason | 기한 갱신·감사·변경 안내 초안 |
| POST /api/communications/{id}/approve | expected_version, content_version | READY만 저장, worker/제공사 호출 없음 |
| POST /api/communications/{id}/retry | expected_version, 동일 내용·수신처 | FAILED→QUEUED와 queued_by/queued_at 저장 후 202; UNKNOWN/대체/승인 무효는 거절 |
| POST /api/attachments/upload-url | owner 종류·ID, field_code, mime_type, size_bytes, expected_version | 상태·기한·소유권 검사 후 upload_intent_id·새 private 객체키·만료 URL |
| POST /api/attachments/complete | upload_intent_id, expected_version, 동일 재시도용 Idempotency-Key | attachment_id, application_version, revision_no; 같은 키 재시도는 저장 결과 반환 |
| POST /api/auth/bootstrap | 검증된 인증 세션, 사용자 입력 역할 금지 | users를 USER/SELLER/ACTIVE로 멱등 생성, profile_required 반환 |
| POST /api/me/seller | name, shop_name, owner_name, phone | 본인 셀러 생성 및 users.profile_completed_at 저장 |
| POST /api/applications/{id}/sync-email | expected_version, 동기화 확인 | 현재 검증된 계정 이메일로 snapshot 갱신, 미발송 승인 무효화 |
| POST /api/applications/{id}/extend-info | expected_version, info_due_at, reason | NEED_INFO 유지, 기한 연장·이력·보완안내 초안 |
| POST /api/communications/{id}/resolve | expected_version, attempt_id, method, outcome, evidence_ref, reason | UNKNOWN 결과 확인, resolution_id와 SENT/FAILED/UNKNOWN 반환 |
| POST /api/communications/{id}/revise | expected_version, body, reason; 수신처는 신청 snapshot에서 서버 취득 | 실행 이력 없는 초안은 갱신·승인 초기화, 이력 있으면 새 DRAFT·새 키·supersedes_id |
| POST /api/projects/{id}/booths/reassign | expected_project_version, changes[{application_id,from_assignment_id,to_booth_id,expected_application_version,expected_assignment_version}], reason | 전체 목표 검증 후 일괄 교환, operation_id·새 assignment 목록 반환 |
| POST /api/projects/{id}/reopen-review | expected_version, reason | CLOSED→REVIEWING, 종료시각 검사·감사로그 |
| POST /api/attachments/{id}/detach | expected_version, reason | 허용된 첨부만 논리 해제, 이전 객체 이력 보존, revision/version 증가 |
| POST /api/communications/{id}/send | expected_version, Idempotency-Key | READY→QUEUED, queued_by/queued_at, 동일 communication_id 포함 202 저장 |
| GET /api/me/requests/{operation}/{idempotency_key} | 본인 인증·현재 대상 권한 | 저장 결과는 200과 outcome/http_status/response/resource_id; EXPIRED는 410 REQUEST_RESULT_EXPIRED; 행 자체가 없으면 202 UNRESOLVED, 신규 업무 수행 없음 |

프로젝트/부스 CRUD, 프로필 수정, 검수 메모, 공개·마감·종료 액션도 기능 ID와 OpenAPI operation_id로 연결한다. OpenAPI에서 TypeScript 클라이언트 타입을 생성하고 Python DTO와 수동으로 이중 관리하지 않는다. 운영자 대행 confirm은 확인 근거 reason을 필수로 한다.

## 18 AI와 메시지 실행 및 장애 복구

AI 실행은 DB에 QUEUED Evaluation을 먼저 저장하고 202를 반환한다. Python 서비스의 worker가 작업을 claim하여 RUNNING으로 전환하고 제한시간 내 실행한다. 프로세스 재시작 후 오래된 RUNNING은 실패 처리하여 운영자 재시도를 허용한다. 호출 제한시간·작업 회수시간은 환경설정으로 명시하고 회수 테스트를 통과해야 한다. AI의 DB 자격증명과 임의 업무 변경 도구는 제공하지 않는다.

AI 입력은 신청 revision, 프로젝트 policy_version, 비교 대상 ID 및 요약의 snapshot으로 고정한다. 출력은 Pydantic 검증 후 같은 Evaluation에 저장하고 run 완료시각을 기록한다. 재실행은 새 version_no를 만든다. 늦게 완료된 이전 revision 결과는 보존하되 최신 평가로 표시하지 않는다. 실패해도 사람의 수동 심사를 막지 않는다.

메시지 worker는 명시적으로 발송 요청된 QUEUED 작업만 원자적으로 SENDING으로 claim하고 approved_version, 수신처, 신청 상태, 부스정보를 다시 검증한다. 실패가 확정되면 FAILED, 응답이 유실되면 UNKNOWN으로 기록한다. 발송 중 취소는 제공사 접수 완료를 되돌릴 수 없으므로 당시 시각·결과를 보존하고 운영자에게 후속 안내 필요를 표시한다. 행사 종료 이후 새 발송은 하지 않고 제공사 결과 확인과 운영자 별도 연락 기록만 남긴다. 영구 오류는 자동 재시도하지 않는다.

운영 발송은 우선 EMAIL 채널 1개로 구현한다. 제공사 선정·도메인 인증·실발송 권한은 운영 전 확인 항목이다. 개발·preview는 실제 고객에게 발송하지 않는 테스트 어댑터를 사용하고 UI에 모의발송을 표시한다. 모의발송 성공은 실운영 발송 완료조건을 대신하지 않는다. SMS/KAKAO 추가는 후속 범위다.

## 19 공개 전 검증과 참고 문서

E2E-01~44를 실행하고 MUST 기능 ID와 테스트 결과를 대응시킨다. 백업은 실제 복원 리허설, 파일은 만료 URL·타인 접근 차단, 발송은 지정 테스트 수신함 수신까지 확인한다. 부하 기준은 300개 신청 데이터로 목록·필터 응답을 측정하고 Pilot 운영자가 허용 응답시간을 정한다. 아직 실행하지 않은 검증을 통과로 기록하지 않는다.

공식 참고자료 확인일 2026년 10월 8일: 사용자 연결 https://supabase.com/docs/guides/auth/managing-user-data ; RLS https://supabase.com/docs/guides/database/postgres/row-level-security ; API 키 https://supabase.com/docs/guides/getting-started/api-keys . 실제 구현 시 설치 버전과 SDK 동작을 다시 확인한다.

파일 크기·개수 기본안은 상품사진 10장 이하, 파일당 10 MiB 이하이며 jpg/png/webp를 허용한다. 사업자 증빙은 PDF 1개 또는 이미지로 받고 같은 크기 제한을 적용한다. 실제 MIME과 파일 크기를 서버가 검사하고 경로·확장자만 신뢰하지 않는다. 업로드가 완료되지 않은 객체는 유예기간 후 정리한다. 운영 설정으로 변경 시 UI와 서버 제한을 함께 갱신한다.

worker 초기 설정안: AI 호출 60초 제한, 120초 이상 RUNNING 작업은 실패로 회수한다. 발송 호출은 30초 제한, 90초 이상 SENDING은 UNKNOWN으로 전환하고 제공사 결과 확인을 요구한다. 이 값은 환경변수로 관리하고 실제 제공사 지연에 맞춰 부하검증 후 조정한다. worker claim과 상태 갱신은 원자적으로 처리한다.

## 20 업무 예외 구현 규칙

bootstrap은 서명·만료·사용자 상태가 확인된 세션에서만 실행한다. 기존 users가 있으면 역할을 재설정하지 않는다. 인증 이메일은 요청 본문 대신 인증 제공자의 검증 완료 정보에서 취득한다. 신규 사용자 이름은 프로필 단계에서 입력한다. STAFF 초대와 PLATFORM_ADMIN 부여는 별도 관리 작업이며 공개 가입 API로 받지 않는다.

로그인에 사용하는 인증 제공자의 검증 완료 이메일을 안내 주소의 유일한 원본으로 사용한다. 최초 제출 때 applications.notification_email과 notification_email_verified_at으로 복사한다. 계정 이메일 변경은 기존 신청 수신처를 자동 변경하지 않는다. 셀러가 내 신청에서 현재 검증된 계정 이메일로 동기화를 요청한 경우에만 변경하며 임의 주소 입력은 받지 않는다.

업무 변경은 현재시각 < projects.event_end_at이고 프로젝트가 COMPLETED가 아닐 때만 허용한다. 행사 당일에도 이 조건 안에서 참가확정·취소·부스 변경·긴급 안내를 처리한다. 마감 후에는 신규 업무를 만들지 않되 기존 AI/발송 작업 결과 기록, UNKNOWN 결과 확인, 감사로그 추가, 개인정보 보관·삭제 관리 작업은 권한을 검사해 허용한다.

REVIEWER는 배정 프로젝트의 신청·평가·검수 메모를 조회하고 메모를 추가할 수 있으나 연락처는 마스킹하며 운영자료 출력은 금지한다. VIEWER는 대시보드와 모집·진행 상태 집계만 조회하고 신청 원문·개인정보·파일·내부 메모·출력은 접근할 수 없다.

행사일·종료시각을 변경할 때 기존 모집·보완·확정 기한과 진행 중 작업을 검사한다. 선발 완료인 CLOSED에서 신규 선발이 필요하면 reopen-review를 사용한다. 공개 신청 접수와 선정 재검토는 별개이므로 이 액션만으로 RECRUITING이 되지 않는다.

extend-info는 NEED_INFO이고 프로젝트 RECRUITING/REVIEWING에서만 허용한다. 새 기한은 기존 기한과 현재시각보다 늦고 event_end_at보다 이르다. 기한 만료가 신청을 자동 탈락시키지 않는다. 연장 권한은 OPERATOR이며 요청 필드를 바꾸는 기능과 분리한다.

resolve는 OPERATOR만 호출한다. PROVIDER_QUERY 결과는 서버가 제공사를 조회해 산출하며 클라이언트가 보낸 outcome으로 덮어쓰지 않는다. MANUAL_EVIDENCE는 담당자·근거·사유를 필수로 기록한다. 접수 여부를 확인할 수 없으면 INCONCLUSIVE로 보존하며 재발송을 허용하지 않는다. 늦은 제공사 응답은 같은 attempt의 검증 가능한 근거로 처리하고 원문·시각·actor를 기록한다.

revise는 SENDING/UNKNOWN에서 409다. DRAFT/READY/QUEUED이며 시도가 없으면 같은 레코드의 content_version을 증가시키고 승인정보·queued_at/queued_by를 지워 DRAFT로 되돌린다. QUEUED 변경은 worker와 같은 행 잠금을 사용한다. FAILED/SENT 등 실행 이력이 있으면 원본 내용은 불변이며 새 communication을 생성한다. 이전 메시지에는 superseded_at을 표시하여 재시도를 막는다. 새 수신처는 applications.notification_email에서만 취득한다. 새 메시지는 별도 운영자 승인 없이 발송하지 않는다.

부스 일괄 변경은 중복 application/to_booth_id, 다른 프로젝트, CONFIRMED 아님, 해제된 from_assignment, version 불일치, 조건 충돌을 먼저 거절한다. 변경 집합 밖의 점유 부스는 사용할 수 없다. 기존 배치 전체 해제 후 새 배치 전체 삽입을 한 DB 트랜잭션으로 처리한다. project/application version을 증가시키고 발송 승인 무효화·감사·변경안내 초안도 같은 트랜잭션에 기록한다. 외부 발송은 커밋 후 운영자 승인 단계에서 별도로 수행한다.

업로드 URL을 발급받았다는 사실만으로 첨부 연결을 허용하지 않는다. complete 시 현재 신청 상태·기한·version·소유권·요청된 보완 field_code·실제 객체 MIME/크기를 재검사한다. 업로드 의도의 owner/field는 클라이언트가 변경할 수 없다. 이미 연결된 객체는 덮어쓰기 없이 새 키로 교체한다. 실패한 complete의 객체는 연결하지 않고 만료된 upload_intent 정리 작업에서 제거한다. 보관을 위해 남긴 이전 첨부는 현재 화면의 활성 첨부에서 제외한다.

worker는 Evaluation 또는 Communication의 QUEUED 작업만 claim할 때 claim_token을 발급한다. Communication READY는 승인만 완료된 상태로 worker 대상에서 제외한다. 완료 UPDATE는 상태와 claim_token을 함께 비교한다. 회수 시 토큰을 폐기하여 오래된 worker가 FAILED/UNKNOWN을 성공으로 임의 덮어쓰지 못하게 한다. 발송의 늦은 응답은 resolve 절차의 증거로 반영하고 동일 시도의 중복 결과를 멱등 처리한다.

셀러 마스터 자산 업로드는 본인 프로필 권한으로 처리한다. 신청에 첨부할 때는 새 application 소유 객체·레코드로 복사하여 해당 신청의 ATT-001 검증을 적용한다. profile 수정으로 이미 제출된 신청의 사진을 바꾸지 않는다. 비활성 사용자와 삭제된 소유 객체의 업로드는 모든 경우 차단한다.

## 21 실행 계약

요청 중복 방지 레코드와 업무 변경·이력·비동기 작업 생성은 같은 DB 트랜잭션으로 커밋한다. IN_PROGRESS는 미커밋 처리 중에만 존재하며 별도로 저장하지 않는다. 커밋 전 중단은 전체 롤백, 커밋 후 응답 유실은 같은 키와 본문으로 저장된 결과를 재조회한다. 외부 AI·메시지 호출은 커밋된 작업을 worker가 처리한다.

요청 결과 보관기간이 끝나면 api_idempotency 행을 삭제하지 않고 같은 행을 EXPIRED로 전환한다. response_json·request_hash·resource_type·resource_id·http_status를 NULL로 지우고 expired_at을 기록한다. request_id·actor_user_id·operation·idempotency_key·status·created_at·updated_at·expired_at만 남겨 기존 UNIQUE 제약으로 키 재사용을 막는다. 만료는 SUCCEEDED/FAILED이고 연결된 비동기 작업이 종료되며 미확인 결과가 없는 요청에만 허용한다. 요청 처리와 만료 처리는 같은 고유키 및 행 잠금으로 직렬화한다. 응답 본문 보관기간은 운영 전 설정값으로 확정하고 만료 처리 작업에 적용한다. 최소 사용 완료 기록은 해당 actor 계정이 요청할 수 있는 동안 삭제하지 않는다. 계정 삭제 시에는 먼저 인증 세션과 실행 권한을 차단하고 같은 actor_user_id를 재발급하지 않는 조건에서 연관 기록을 정리한다. 보관기간과 삭제 범위의 운영 승인 전에는 자동 정리 작업을 활성화하지 않는다.

업무 DB 접근은 하나의 실제 DB 트랜잭션에서 수행한다. 여러 독립 REST 호출을 차례로 실행한 것을 원자적 처리로 간주하지 않는다. 먼저 api_idempotency 고유키를 확보하고 업무 잠금을 순서대로 잡는다. 이미 완료한 동일 요청이면 현 사용자 권한을 재검사해 저장 결과를 반환하고 변경을 반복하지 않는다. 고유키 잠금 대기는 초기 5초 상한을 두고 초과 시 409 REQUEST_IN_PROGRESS, Retry-After: 2를 반환한다.

IN_PROGRESS는 미커밋 처리 상태다. 업무 변경과 SUCCEEDED/FAILED 결과가 함께 커밋되므로 프로세스가 커밋 전에 죽으면 모두 롤백되고, 커밋 후 응답만 유실되면 같은 키로 원래 응답을 되찾는다. 비동기 요청은 외부 실행 완료가 아니라 작업 접수 결과를 저장하며 그 resource_id를 재생한다. worker 실행 상태는 해당 작업 조회에서 확인한다. 결과 보관기간 종료 후에는 DB 명세에 따라 완료 행을 EXPIRED로 전환한다. EXPIRED를 신규 요청 또는 재실행 가능한 FAILED로 처리하지 않는다.

EXPIRED 키의 변경 요청과 결과 조회는 410 REQUEST_RESULT_EXPIRED를 반환하고 업무를 실행하지 않는다. 본문이 달라도 410이며 새 키를 자동 발급하지 않는다. 결과 본문이 있는 요청은 현재 대상 권한을 검사한 뒤 재생한다. EXPIRED는 인증된 동일 actor의 키에 한해 결과 없는 만료 코드만 반환하며 다른 사용자의 기록은 노출하지 않는다. 행이 아예 없는 경우에만 조회 결과가 202 UNRESOLVED이며 원래 키·본문으로 재시도할 수 있다. UNRESOLVED의 자동 재시도는 원래 키·본문으로 2/4/8초 대기 후 수행하고 이후 결과 확인 화면으로 전환한다. 재인증한 actor가 다르면 이전 결과를 반환하지 않는다.

send/retry만 Communication을 QUEUED로 만든다. approve는 READY에서 끝난다. worker는 READY를 조회 대상에 넣지 않으며 QUEUED claim 시 queued_by의 현재 OPERATOR 권한, 프로젝트 마감, 승인 버전, 대상 snapshot, superseded_at을 다시 검증한다. QUEUED에서 대상 변경 또는 권한 상실이 발생하면 외부 호출 전에 대기를 종료하고 이유를 기록한다. worker claim과 사용자 철회/수정은 같은 잠금 순서를 사용해 동시에 성공하지 못하게 한다.

한 신청에서는 upload-url 발급 → 파일 전송 → complete 성공을 파일 한 개씩 순차 실행한다. complete가 반환한 application_version과 revision_no를 다음 파일 요청에 사용한다. 임시저장·첨부 해제도 같은 클라이언트 변경 대기열에 넣어 동시에 보내지 않는다. 미완료 또는 실패 파일을 해결하기 전에는 제출을 비활성화한다.

프론트엔드는 한 신청별 변경 대기열을 두어 autosave·upload-url·complete·detach·submit이 순서대로 실행되도록 한다. 파일 1개의 연결 성공을 확인한 뒤 다음 intent를 발급한다. upload-url 단계는 문서 내용을 바꾸지 않으며 당시 version/revision을 의도에 저장한다. complete 응답의 application_version/revision_no를 화면 상태에 반영한다. 저장되지 않은 폼 변경은 사진 처리 전에 저장하거나 사진 완료 뒤로 순서를 고정한다.

다른 탭/운영자가 실제 데이터를 변경해서 409가 발생하면 현재 파일과 후속 대기열을 중단하고 최신 신청을 재조회한다. 기존 intent의 expected version을 덮어쓰지 않는다. 허용된 상태·필드를 확인한 후 사용자가 재시도하면 새 intent와 새 객체키를 발급한다. complete 응답만 유실된 경우에는 예외적으로 같은 키·본문을 재시도해 기존 첨부 연결 결과를 복구한다. 재조회한 현재 version이 복구 응답보다 최신이면 이전 버전으로 화면 상태를 되돌리지 않는다.

QUEUED이지만 이전 발송 시도가 있는 작업의 revise는 원본을 FAILED/CONTEXT_CHANGED로 철회하고 대기정보를 제거한 뒤 새 DRAFT를 만드는 과정을 같은 트랜잭션으로 수행한다. 원본의 수신처·내용·시도 이력은 수정하지 않는다. worker가 먼저 SENDING을 획득했다면 revise는 409로 중단한다.

