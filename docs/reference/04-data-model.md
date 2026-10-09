# 04_DB_데이터구조_명세서_v1.3

> 자동 생성한 검색용 참조본입니다. 이 파일을 직접 수정하지 마세요.
> 원본: [04_DB_데이터구조_명세서_v1.3.docx](../../문서_보완본_v1.3/04_DB_데이터구조_명세서_v1.3.docx)
> 원본 SHA-256: `5dbacf5ec0d3b8e656e6495f882d6b659b9a94a29cb6ed9323216fc8e09d7d3e`
> 문단과 표의 내용을 원래 순서대로 옮겼습니다. Word 페이지 배치·도형·서식의 복제본은 아닙니다.
> 변경하려면 Word 원본을 수정한 뒤 `docs/tools/sync_reference_docs.py`를 다시 실행하세요.

FleaMarket AX

## 플리마켓 셀러 모집 운영 플랫폼

MVP DB / 데이터 구조 명세서

<a id="table-01"></a>
**표 01**

| Pilot Project<br>2026 자운대 축제 플리마켓 |
| --- |

<a id="table-02"></a>
**표 02**

| 문서 목적<br>서비스 기획서·업무 프로세스·기능명세서·화면설계서에서 확정한 데이터 요구사항을 실제 개발 가능한 DB 테이블, 필드, 관계, 상태값, 제약조건으로 변환한다. 이후 바이브코딩 개발명세서와 API 설계의 기준 문서로 사용한다. |
| --- |

<a id="table-03"></a>
**표 03**

| 핵심 원칙<br>Seller는 공통 마스터, Application은 프로젝트별 신청 레코드 / Project 기준으로 데이터 격리 / AI는 추천·평가 데이터를 기록하되 최종 선정은 사람 / 주요 상태 변경은 이력으로 보존 |
| --- |

Version 1.3  |  2026.10.08

문서 적용 기준: 본 문서는 2026년 10월 8일 v1.3 기준안이다. 공통 용어·상태·MVP 경계는 00_변경요약_공통계약_v1.3.docx를 따른다. 사업자 확인이 필요한 배포·행사 설정값은 공통계약의 운영 전 확인 목록으로 관리한다.

## 1  데이터 모델 설계 원칙

<a id="table-04"></a>
**표 04**

| 설계 기준<br>MVP는 “여러 프로젝트를 동시에 운영”하는 구조를 전제로 하며, 자운대 특수사항을 별도 테이블로 하드코딩하지 않고 Project 설정값과 정책 필드로 처리한다. |
| --- |

<a id="table-05"></a>
**표 05**

| 원칙 | DB 적용 기준 |
| --- | --- |
| 프로젝트 중심 | Application, Evaluation, BoothAssignment, Communication 등 운영 데이터는 project_id로 범위를 명확히 제한한다. |
| 셀러 마스터 재사용 | Seller 기본정보는 1회 생성하고 프로젝트별 참가 시 Application을 새로 만든다. |
| 상태 기반 운영 | Application.status를 운영 흐름의 단일 기준값으로 사용하고 화면 배지·버튼 활성·라우팅과 동일하게 적용한다. |
| AI와 사람의 분리 | AI 평가결과는 Evaluation에 저장하고 APPROVED/WAITING/REJECTED 확정은 운영자 액션으로 기록한다. |
| 이력 보존 | 상태·부스·발송·중요 정책 변경은 AuditLog 또는 History 테이블에 남긴다. |
| 멀티프로젝트 격리 | 관리자 조회/API는 project_id와 project_members 범위를 기본 조건으로 사용하여 프로젝트 데이터 혼합을 막는다. |
| MVP 우선 | 결제·정산·방문객 쇼핑 데이터는 이번 DB 범위에서 제외한다. |

### 1 1 공통 데이터 규칙

<a id="table-06"></a>
**표 06**

| 항목 | 권장 규칙 | 이유 |
| --- | --- | --- |
| Primary Key | UUID 문자열 또는 DB UUID 타입 | 외부 노출·분산 환경에서 충돌 방지 |
| 시간 | created_at, updated_at = UTC 저장 / 화면에서 KST 표시 | 다중 환경·로그 일관성 |
| Soft Delete | deleted_at 또는 is_deleted | 운영 이력 보존 및 복구 |
| 상태값 | 영문 대문자 Enum | 코드·DB·화면 라우팅 일관성 |
| 전화번호 | 정규화된 숫자 문자열 + 표시용 포맷 | 중복 셀러 검색에 활용 |
| 파일 | DB에는 URL/파일키·메타데이터만 저장 | 이미지는 스토리지 분리 |
| AI 결과 | 점수·추천·근거·모델/버전 기록 | 재현성·감사 가능성 |

## 2  엔티티 구성과 관계

<a id="table-07"></a>
**표 07**

| MVP 핵심 엔티티<br>Project · Seller · Application · Evaluation · Booth · Communication을 중심으로 하고, 실제 구현을 위해 User/ProjectMember, Attachment, StatusHistory, AuditLog를 지원 테이블로 둔다. |
| --- |

<a id="table-08"></a>
**표 08**

| 구분 | 테이블 | 역할 | 핵심 관계 |
| --- | --- | --- | --- |
| Core | projects | 플리마켓/축제 프로젝트 설정 | 1 : N applications / booths / communications |
| Core | sellers | 재사용 가능한 셀러 마스터 | 1 : N applications |
| Core | applications | 셀러의 프로젝트별 신청·상태 | N : 1 project, N : 1 seller |
| Core | evaluations | AI 검토·점수·주의사항 | N : 1 application |
| Core | booths | 프로젝트 내 부스 자원 | N : 1 project |
| Core | communications | 안내문·발송 결과 | N : 1 project/application |
| Support | users / project_members | 로그인·역할·프로젝트 권한 | User &lt;-&gt; Project |
| Support | attachments | 상품사진·증빙 파일 | Seller/Application 연결 |
| Support | application_status_history | 신청 상태 변경 이력 | N : 1 application |
| Support | audit_logs | 정책·선정·부스·발송 감사로그 | actor + entity |
| Support | booth_assignments | 추천·확정·해제 이력 | N:1 booth/application, 활성 배치 각 1개 |
| Support | communication_attempts | 제공사 호출·응답 유실·실패 이력 | N:1 communication |
| Support | api_idempotency | 중복 변경 요청 식별·결과 보존 | user + operation + idempotency_key |
| Support | communication_resolutions | 발송 결과 확인 근거·담당자 이력 | N:1 communication/attempt |
| Support | upload_intents | 업로드 요청과 완료 연결·만료 관리 | 본인 seller 또는 application |

### 2 1 관계 개념도

<a id="table-09"></a>
**표 09**

| ERD 개념<br>USER ─&lt; PROJECT_MEMBER &gt;─ PROJECT ─&lt; APPLICATION &gt;─ SELLER<br>PROJECT ─&lt; BOOTH   /   APPLICATION ─&lt; EVALUATION   /   APPLICATION ─&lt; STATUS_HISTORY<br>PROJECT/APPLICATION ─&lt; COMMUNICATION   /   SELLER/APPLICATION ─&lt; ATTACHMENT |
| --- |

• Seller : Application = 1:N — 한 셀러가 여러 프로젝트에 신청 가능

• Project : Application = 1:N — 하나의 행사에 여러 셀러 신청

• Application : Evaluation = 1:N — AI 재실행/평가 버전을 보존

• Project : Booth = 1:N — 프로젝트별 부스 자원을 별도 관리

• Application : Booth = 0..1 — 확정 전에는 부스가 없으며, 배치 시 연결

## 3  사용자 프로젝트 테이블

### 3 1 users

<a id="table-10"></a>
**표 10**

| 필드 | Type | Null | 설명/제약 |
| --- | --- | --- | --- |
| user_id | UUID | N | PK 및 FK auth.users.id |
| email | varchar(255) | N | 로그인 ID, unique |
| name | varchar(80) | Y | 최초 OTP 인증 시 null 허용, 셀러 프로필 완료 전 입력 필수 |
| phone | varchar(30) | Y | 연락처 |
| global_role | varchar(30) | N | PLATFORM_ADMIN / USER, 신규 기본 USER, 관리자만 권한 변경 |
| status | varchar(20) | N | ACTIVE / INACTIVE |
| created_at | timestamptz | N | 생성시각 |
| updated_at | timestamptz | N | 수정시각 |
| account_role | varchar(20) | N | STAFF / SELLER, 신규 기본 SELLER를 서버 부여, STAFF 변경은 관리자만 |
| profile_completed_at | timestamptz | Y | 이름·셀러 필수 프로필 저장 완료시각 |

### 3 2 projects

<a id="table-11"></a>
**표 11**

| 필드 | Type | Null | 설명/제약 |
| --- | --- | --- | --- |
| project_id | UUID | N | PK |
| name | varchar(150) | N | 예: 2026 자운대 축제 플리마켓 |
| event_date | date | N | 행사일 |
| venue | varchar(255) | N | 행사 장소 |
| recruit_start_at | timestamptz | N | 모집 시작 |
| recruit_end_at | timestamptz | N | 모집 마감 |
| target_team_count | int | N | 모집 목표 팀 수, &gt;0 |
| status | varchar(30) | N | DRAFT / RECRUITING / REVIEWING / CLOSED / COMPLETED |
| policy_json | json | N | 허용·제한 품목, 사업자요건, 사진필수 등 |
| booth_policy_json | json | Y | 부스 규격, 전기, 테이블, 화기·차량 조건 |
| evaluation_policy_json | json | N | AI/운영자 심사기준과 가중치 |
| created_by | UUID | N | FK users.user_id |
| created_at | timestamptz | N | 생성시각 |
| updated_at | timestamptz | N | 수정시각 |
| policy_version | int | N | 기본 1, 모집·심사 정책 변경 시 증가 |
| version | int | N | 기본 1, 동시 변경 검사용 |
| deleted_at | timestamptz | Y | 보관 처리 시각; 활성 업무에서는 제외 |
| event_end_at | timestamptz | N | KST 행사일의 실제 종료시각, 모집공개 전 필수, 모든 업무 마감 기준 |

### 3 3 project_members

<a id="table-12"></a>
**표 12**

| 필드 | Type | 설명 |
| --- | --- | --- |
| project_member_id | UUID | PK |
| project_id | UUID | FK projects |
| user_id | UUID | FK users |
| role | varchar(30) | OPERATOR / REVIEWER / VIEWER |
| active | boolean | 권한 활성 여부 |
| created_at | timestamptz | 등록시각 |

## 4  Seller Application 핵심 테이블

### 4 1 sellers — 공통 셀러 마스터

<a id="table-13"></a>
**표 13**

| 필드 | Type | Null | 설명/제약 |
| --- | --- | --- | --- |
| seller_id | UUID | N | PK |
| shop_name | varchar(150) | N | 상호/브랜드명 |
| owner_name | varchar(80) | N | 대표자명 |
| phone | varchar(30) | N | 정규화 저장, 중복 후보 검색 |
| business_no | varchar(30) | Y | 사업자번호, 입력 시 정규화 |
| sns_url | varchar(500) | Y | 대표 SNS |
| base_category | varchar(50) | Y | 기본 카테고리 |
| base_product_desc | text | Y | 기본 판매품목 |
| no_show_count | int | N | 기본 0; 후속 운영이력용 예약값, MVP 심사점수에 자동 반영하지 않음 |
| operation_note | text | Y | 전역 민감 메모 사용 안 함; 프로젝트 메모는 audit_logs에 기록 |
| created_at | timestamptz | N | 생성시각 |
| updated_at | timestamptz | N | 수정시각 |
| user_id | UUID | N | FK users.user_id, UNIQUE; 셀러 소유권 기준 |

### 4 2 applications — 프로젝트별 신청

<a id="table-14"></a>
**표 14**

| 필드 | Type | Null | 설명/제약 |
| --- | --- | --- | --- |
| application_id | UUID | N | PK |
| project_id | UUID | N | FK projects |
| seller_id | UUID | N | FK sellers |
| status | varchar(30) | N | DRAFT~CANCELLED Enum |
| product_name | varchar(150) | Y | DRAFT에서 null 허용, 제출 이후 필수 |
| product_desc | text | Y | 상세설명 |
| price_range | varchar(80) | Y | 가격대 |
| category | varchar(50) | Y | AI/운영자 분류 카테고리 |
| electricity_required | boolean | N | 전기 필요 |
| table_count | int | N | 필요 테이블 수 |
| fire_required | boolean | N | 화기 사용 |
| vehicle_entry_required | boolean | N | 차량 진입 필요 |
| request_note | text | Y | 요청사항 |
| submitted_at | timestamptz | Y | SUBMITTED 시각 |
| confirmed_at | timestamptz | Y | 참가확정 시각 |
| cancel_reason | text | Y | 취소 사유 |
| created_at | timestamptz | N | 생성시각 |
| updated_at | timestamptz | N | 수정시각 |
| revision_no | int | N | 기본 1, 신청 내용·연락처·증빙 수정 시 증가 |
| version | int | N | 기본 1, 상태/내용/기한 변경 시 증가 |
| seller_snapshot_json | jsonb | Y | 제출 시 상호·대표자·연락처 복사, 접수 후 원본 프로필 변경과 분리 |
| policy_version | int | Y | 제출 시 적용한 프로젝트 정책 버전 |
| consent_json | jsonb | Y | 제출 시 필수: 문구 version, accepted_at, user_id, 목적 식별자 |
| info_requests_json | jsonb | Y | [{field, reason, requested_by, requested_at}], NEED_INFO에서 필수 |
| info_due_at | timestamptz | Y | 보완 요청 기한, NEED_INFO에서 필수 |
| confirm_due_at | timestamptz | Y | 승인·승격 시 필수, 행사 종료 전 기한 |
| waiting_rank | int | Y | WAITING에서 &gt;0, 동순위는 submitted_at/application_id로 정렬 |
| cold_storage_required | boolean | N | 기본 false, 냉장 요구 |
| last_submitted_at | timestamptz | Y | 최근 보완 제출시각, submitted_at은 최초 제출시각 보존 |
| deleted_at | timestamptz | Y | 보관 처리 시각, 중복 신청 UNIQUE 해제 안 함 |
| notification_email | varchar(255) | Y | DRAFT null 허용, 제출 이후 검증된 계정 이메일 snapshot 필수 |
| notification_email_verified_at | timestamptz | Y | snapshot 주소의 인증 제공자 검증 완료시각, 제출 이후 필수 |

<a id="table-15"></a>
**표 15**

| 중복 제약 권장<br>UNIQUE(project_id, seller_id)를 DB에서 강제한다. 취소·탈락·보관 처리 후에도 같은 행사에 새 신청을 만들지 않는다. 기존 신청 재개는 MVP에서 지원하지 않는다. |
| --- |

## 5  AI 검토 심사 데이터

### 5 1 evaluations

<a id="table-16"></a>
**표 16**

| 필드 | Type | Null | 설명/제약 |
| --- | --- | --- | --- |
| evaluation_id | UUID | N | PK |
| application_id | UUID | N | FK applications |
| version_no | int | N | 재평가 버전 1,2,3… |
| category_suggestion | varchar(50) | Y | AI 추천 분류 |
| fit_score | int | Y | 0~100 적합도 |
| differentiation_score | int | Y | 0~100 차별성 |
| operation_risk_score | int | Y | 0~100 운영리스크, 높을수록 주의 |
| duplicate_level | varchar(20) | Y | LOW/MEDIUM/HIGH |
| similar_application_ids | json | Y | 유사 신청 목록 |
| recommendation | varchar(30) | Y | RECOMMEND / REVIEW / CAUTION, 성공 시 필수 |
| reason_summary | jsonb | Y | 성공 시 3~6개 짧은 근거 문자열 배열 |
| warning_json | json | Y | 전기·화기·일정충돌 등 주의사항 |
| model_name | varchar(80) | Y | 실행 시작 후 필수, provider/model 식별자 |
| prompt_version | varchar(30) | Y | 실행 시작 후 필수, 실제 프롬프트 버전 |
| created_at | timestamptz | N | 평가 생성시각 |
| status | varchar(20) | N | QUEUED / RUNNING / SUCCEEDED / FAILED |
| summary | text | Y | 성공 시 필수 신청 요약 |
| input_revision_no | int | N | 평가 입력 신청 revision_no |
| input_policy_version | int | N | 평가 입력 프로젝트 policy_version |
| input_snapshot_json | jsonb | N | 개인정보 최소화한 실제 평가 입력·대상 집합 |
| error_code | varchar(80) | Y | 실패 원인 코드, 성공 시 null |
| error_message | text | Y | 비밀값 제거한 실패 요약 |
| requested_by | UUID | N | 평가를 요청한 users.user_id |
| idempotency_key | UUID | N | 중복 실행 방지, UNIQUE(application_id,idempotency_key) |
| started_at | timestamptz | Y | 실행 시작/완료 시각 |
| completed_at | timestamptz | Y | 실행 시작/완료 시각 |
| claim_token | UUID | Y | RUNNING 실행 소유권 토큰, 회수 시 폐기하여 늦은 결과 덮어쓰기 차단 |

### 5 2 운영자 심사결정은 Application에 반영

• AI 결과는 Evaluation에 저장하지만 최종 APPROVED / WAITING / REJECTED 상태는 Application.status를 운영자가 변경한다.

• 운영자의 결정 사유·메모는 StatusHistory/AuditLog에 저장한다.

• AI 재실행 시 기존 Evaluation을 덮어쓰지 않고 version_no를 증가시켜 비교 가능하게 한다.

### 5 3 AI Agent 입력 출력 데이터 맵

<a id="table-17"></a>
**표 17**

| Agent | 주요 입력 | 주요 출력 | DB 저장 |
| --- | --- | --- | --- |
| Classification Agent | Project 정책 + Application 상품정보 | category_suggestion | evaluations |
| Fit Evaluation Agent | 심사기준 + Seller/Application | fit_score, reason_summary | evaluations |
| Duplicate Agent | 동일 Project 신청 목록 | duplicate_level, similar_application_ids | evaluations |
| Risk Agent | 전기·화기·차량·일정 정보 | warning_json, operation_risk_score | evaluations |
| Booth Recommendation Agent | CONFIRMED 신청 + Booth 조건 | 추천 booth_id / 이유 | booth_assignments 또는 로그 |
| Message Draft Agent | Application 상태 + Project 안내값 | 안내문 초안 | communications |

## 6  부스 배치 데이터

### 6 1 booths

<a id="table-18"></a>
**표 18**

| 필드 | Type | Null | 설명 |
| --- | --- | --- | --- |
| booth_id | UUID | N | PK |
| project_id | UUID | N | FK projects |
| booth_no | varchar(30) | N | A01, A02 등 프로젝트 내 unique |
| zone | varchar(50) | Y | 구역 |
| electricity_available | boolean | N | 전기 가능 |
| fire_allowed | boolean | N | 화기 허용 |
| vehicle_access | boolean | N | 차량 접근 가능 |
| table_capacity | int | Y | 테이블 수용량 |
| note | text | Y | 현장 메모 |
| status | varchar(20) | N | AVAILABLE / BLOCKED 저장; ASSIGNED는 활성 확정 배치에서 계산 |
| cold_storage_available | boolean | N | 기본 false, 냉장 지원 여부 |

### 6 2 booth_assignments

<a id="table-19"></a>
**표 19**

| 필드 | Type | Null | 설명 |
| --- | --- | --- | --- |
| assignment_id | UUID | N | PK |
| project_id | UUID | N | FK projects |
| booth_id | UUID | N | FK booths |
| application_id | UUID | N | FK applications |
| source | varchar(20) | N | AI_RECOMMENDED / MANUAL |
| reason | text | Y | 추천/조정 이유 |
| assigned_by | UUID | Y | 최종 확정 시 운영자 user_id 필수, AI 추천 시 null 가능 |
| confirmed | boolean | N | 최종 배치 확정 여부 |
| assigned_at | timestamptz | N | 배치시각 |
| released_at | timestamptz | Y | 해제시각; null이며 confirmed=true일 때 활성 점유 |
| released_by | UUID | Y | 해제 actor users.user_id |
| release_reason | text | Y | 이동·취소·재추천 폐기 사유 |
| confirmed_at | timestamptz | Y | 운영자 확정 시각 |
| input_application_version | int | N | 추천/수동 배치 시 신청 version |
| version | int | N | 기본 1, 확정/해제 동시성 검사 |
| operation_id | UUID | N | 같은 일괄 교환·배치 변경을 묶는 작업 ID |

<a id="table-20"></a>
**표 20**

| 배치 제약<br>동일 시점에 하나의 Booth에는 한 Application만 활성 배치되도록 제약하고, CONFIRMED 상태가 아닌 신청은 최종 확정 배치에서 제외한다. |
| --- |

## 7  안내 파일 이력 테이블

### 7 1 communications

<a id="table-21"></a>
**표 21**

| 필드 | Type | 설명 |
| --- | --- | --- |
| communication_id | UUID | PK |
| project_id | UUID | FK projects |
| application_id | UUID | NOT NULL, 수신자별 1레코드; 일괄 안내는 개별 레코드 생성 |
| type | varchar(30) | SELECTION / WAITING / REJECTION / CONFIRM / BOOTH / NOTICE / NEED_INFO |
| channel | varchar(20) | SMS / KAKAO / EMAIL / MANUAL |
| subject | varchar(200) | 제목 |
| body | text | AI 초안/운영자 확정 내용 |
| drafted_by_ai | boolean | AI 생성 여부 |
| approved_by | UUID | 발송 승인 운영자 |
| send_status | varchar(20) | DRAFT / READY / QUEUED / SENDING / SENT / FAILED / UNKNOWN |
| sent_at | timestamptz | 발송시각 |
| failure_reason | text | 실패 사유 |
| recipient_snapshot | varchar(255) | 실제 발송 이메일/전화번호, 승인 시 확정 |
| content_version | int | 기본 1, 내용/수신처 수정 시 증가 |
| approved_version | int | nullable, 승인한 content_version |
| approved_at | timestamptz | nullable, 승인 시각 |
| context_snapshot_json | jsonb | 신청 상태·부스·프로젝트 policy_version 등 생성 기준 |
| idempotency_key | UUID | NOT NULL UNIQUE, 동일 발송 작업 재시도 식별자 |
| version | int | 기본 1, 승인/발송 경쟁 검사 |
| created_at | timestamptz | NOT NULL, 생성/변경시각 |
| updated_at | timestamptz | NOT NULL, 생성/변경시각 |
| supersedes_id | UUID | nullable FK communications.communication_id, 수정 발송의 원본 ID; 같은 프로젝트·신청만 연결 |
| superseded_at | timestamptz | nullable, 새 메시지로 대체된 시각; non-null이면 기존 작업 발송/재시도 불가 |
| claimed_at | timestamptz | nullable, worker가 SENDING을 획득한 시각 |
| claim_token | UUID | nullable, 실행 소유권 토큰; 상태·토큰 일치 시에만 worker 결과 갱신 |
| queued_at | timestamptz | nullable, send/retry로 QUEUED 진입 시 필수, 현재 대기 요청시각 |
| queued_by | UUID | nullable FK users, send/retry 실행자, QUEUED 시 필수 |

### 7 2 attachments

<a id="table-22"></a>
**표 22**

| 필드 | Type | 설명 |
| --- | --- | --- |
| attachment_id | UUID | PK |
| file_type | varchar(30) | PRODUCT_IMAGE / BUSINESS_DOC / ETC |
| storage_key | varchar(1000) | NOT NULL, private bucket 객체키; signed URL 저장 금지 |
| original_name | varchar(255) | 원본명 |
| mime_type | varchar(100) | 파일 타입 |
| created_at | timestamptz | 업로드 시각 |
| seller_id | UUID | nullable FK sellers, application_id와 둘 중 하나만 존재 |
| application_id | UUID | nullable FK applications, seller_id와 둘 중 하나만 존재 |
| size_bytes | bigint | NOT NULL &gt;0; 업로드 크기 검증 |
| uploaded_by | UUID | NOT NULL FK users |
| deleted_at | timestamptz | nullable, 보관/삭제 추적 |

### 7 3 application_status_history

<a id="table-23"></a>
**표 23**

| 필드 | Type | 설명 |
| --- | --- | --- |
| history_id | UUID | PK |
| application_id | UUID | FK applications |
| from_status | varchar(30) | 이전 상태 |
| to_status | varchar(30) | 변경 상태 |
| reason | text | 변경사유/메모 |
| actor_type | varchar(20) | SELLER / USER / SYSTEM / AI |
| actor_id | UUID | nullable |
| created_at | timestamptz | 변경시각 |

## 8  상태값 라우팅 데이터 명세

<a id="table-24"></a>
**표 24**

| 상태 | DB 값 | 진입 조건 | 다음 가능 상태 |
| --- | --- | --- | --- |
| 작성중 | DRAFT | 임시저장 | SUBMITTED / CANCELLED |
| 제출완료 | SUBMITTED | 필수값 검증 통과 | REVIEWING / NEED_INFO / CANCELLED |
| 보완필요 | NEED_INFO | 누락·보완 요청 | SUBMITTED / CANCELLED / NEED_INFO (기한 연장) |
| 검토중 | REVIEWING | AI/운영자 검토 시작 | NEED_INFO / APPROVED / WAITING / REJECTED / CANCELLED |
| 선정 | APPROVED | 운영자 최종 승인 | CONFIRMED / CANCELLED |
| 대기 | WAITING | 운영자 대기 결정 | APPROVED / REJECTED / CANCELLED |
| 미선정 | REJECTED | 운영자 최종 탈락 | 종료 |
| 참가확정 | CONFIRMED | 셀러 참가의사 확인 | CANCELLED |
| 취소 | CANCELLED | 셀러/운영자 취소 | 종료 |

### 8 1 상태 변경 규칙

• AI Agent는 Application.status를 APPROVED/WAITING/REJECTED로 직접 변경하지 않는다.

• 상태 변경 시 applications.status 갱신 + application_status_history INSERT를 하나의 트랜잭션으로 처리한다.

• APPROVED 또는 CONFIRMED 취소 시 기존 부스배치 해제 및 WAITING 승격 검토 이벤트를 발생시킨다.

• 모집 마감 이후 신규 제출은 차단한다. NEED_INFO 보완은 info_due_at까지 허용한다. 운영자 예외 접수는 모집 기간을 사유와 함께 수정·재공개한 뒤 셀러가 제출하도록 한다.

### 8 2 동일일자 중복 신청

<a id="table-25"></a>
**표 25**

| 처리 원칙<br>Seller가 같은 날짜의 다른 Project에 신청한 경우 자동 탈락시키지 않는다. Project.event_date + seller_id 기준으로 충돌 후보를 찾아 Evaluation.warning_json 또는 운영자 경고로 표시한다. 비배정 프로젝트는 상세 정보 없이 일정 충돌 여부만 반환한다. |
| --- |

## 9  감사로그 보안 인덱스

### 9 1 audit_logs

<a id="table-26"></a>
**표 26**

| 필드 | Type | 설명 |
| --- | --- | --- |
| audit_id | UUID | PK |
| project_id | UUID | nullable |
| actor_user_id | UUID | nullable |
| action | varchar(80) | PROJECT_UPDATE / SELECT / BOOTH_CHANGE / SEND_MESSAGE 등 |
| entity_type | varchar(40) | PROJECT / APPLICATION / BOOTH / COMMUNICATION |
| entity_id | UUID | 대상 ID |
| before_json | json | 변경 전 핵심값 |
| after_json | json | 변경 후 핵심값 |
| created_at | timestamptz | 행위시각 |

### 9 2 권장 인덱스

<a id="table-27"></a>
**표 27**

| 테이블 | 인덱스 | 용도 |
| --- | --- | --- |
| projects | (status, event_date) | 프로젝트 대시보드 |
| sellers | phone / business_no | 중복 셀러 후보 검색 |
| applications | (project_id, status) | 심사 목록·상태 집계 |
| applications | (seller_id, project_id) | 셀러별 프로젝트 신청 및 중복방지 |
| evaluations | (application_id, version_no desc) | 최신 AI 평가 |
| booths | (project_id, status) | 부스배치 |
| communications | (project_id, send_status) | 발송 실패/미발송 관리 |
| application_status_history | (application_id, created_at) | 상태이력 |

### 9 3 개인정보 접근제어

• 셀러 연락처·사업자정보는 운영에 필요한 범위에서만 노출하며 프로젝트 권한 없는 사용자에게 API 수준에서 차단한다.

• 심사/검수자는 배정된 project_id 범위만 조회한다.

• AI 프롬프트에는 불필요한 개인정보를 넣지 않고 상품·운영 조건 중심으로 전달한다.

• 발송 로그에는 메시지 전문과 결과를 남기되 인증토큰·API Secret은 저장하지 않는다.

## 10  화면 기능과 DB 매핑

<a id="table-28"></a>
**표 28**

| 화면 | 주요 조회/저장 테이블 | 핵심 쿼리/처리 |
| --- | --- | --- |
| SCR-01 프로젝트 대시보드 | projects, applications, communications | project별 신청/승인/확정 수 집계, 발송실패 count |
| SCR-02 프로젝트 설정 | projects, audit_logs | policy_json / booth_policy_json / evaluation_policy_json 저장 |
| SCR-03 셀러 모바일 신청 | sellers, applications, attachments | Seller 찾기/생성 → Application DRAFT/SUBMITTED |
| SCR-04 신청·심사 목록 | applications, sellers, evaluations | project_id + status + category 필터, 최신 Evaluation join |
| SCR-05 신청 상세·AI 검토 | applications, sellers, evaluations, application_status_history | 원문+AI결과+이력 표시, 운영자 상태변경 |
| SCR-06 부스 배치 | booths, booth_assignments, applications | CONFIRMED 필터, 조건충돌 검사, 배치 확정 |
| SCR-07 안내·운영자료 | communications, applications, booth_assignments | 상태별 대상 추출, 메시지 생성/발송, 명단 출력 |
| SCR-08 내 신청·참가확정 | applications, sellers, communications, booth_assignments | 소유권 기반 조회, 보완·확정·취소 액션 |

### 10 1 대시보드 집계 예시

<a id="table-29"></a>
**표 29**

| 지표 | 집계 기준 |
| --- | --- |
| 신청 | applications where project_id=? and status not in DRAFT/CANCELLED |
| 심사대기 | status in SUBMITTED, REVIEWING, NEED_INFO |
| 선정 | status = APPROVED |
| 참가확정 | status = CONFIRMED |
| 대기 | status = WAITING |
| 발송실패 | communications.send_status = FAILED |

## 11  자운대 Pilot 샘플 데이터 흐름

<a id="table-30"></a>
**표 30**

| Pilot 목적<br>실제 자운대 축제를 첫 Project로 등록하여 데이터가 “Project → Seller → Application → Evaluation → 운영자 상태변경 → Booth → Communication” 순서로 연결되는지 검증한다. |
| --- |

<a id="table-31"></a>
**표 31**

| 단계 | 생성/변경 데이터 | 예시 |
| --- | --- | --- |
| 1. 프로젝트 생성 | projects | 2026 자운대 축제 플리마켓 / 행사일 / 장소 / 모집정책 |
| 2. 셀러 신청 | sellers + applications | 행복공방 + 자운대 Application(SUBMITTED) |
| 3. 사전검증 | applications/application_status_history | 누락 없으면 REVIEWING, 누락 시 NEED_INFO |
| 4. AI 검토 | evaluations | 적합도 88 / 중복 LOW / 전기 필요 경고 |
| 5. 운영자 선정 | applications/application_status_history | APPROVED / WAITING / REJECTED |
| 6. 참가확정 | applications | APPROVED → CONFIRMED |
| 7. 부스배치 | booths + booth_assignments | A12 배치, source=AI_RECOMMENDED 후 운영자 확정 |
| 8. 안내 | communications | 부스/입장시간/준비사항 안내 SENT |

### 11 1 Pilot에서 반드시 확인할 데이터 품질

• 같은 셀러가 재신청할 때 Seller 중복 생성이 되지 않는가

• 프로젝트를 바꾸면 신청·심사·부스 데이터가 섞이지 않는가

• AI 재평가가 이전 결과를 덮어쓰지 않고 버전으로 남는가

• 선정/대기/탈락 변경자가 이력에 남는가

• 취소 시 부스가 회수되고 대기 승격 대상이 확인되는가

• 발송 실패가 관리자 화면에서 재처리 가능한 상태로 남는가

## 12  개발문서 인계 기준

<a id="table-32"></a>
**표 32**

| 다음 단계<br>이 DB 명세를 기준으로 바이브코딩 개발명세서에서 기술스택, 실제 DB(Supabase/PostgreSQL 등), 인증, API/Server Action, AI 호출 구조, 파일스토리지, 화면별 CRUD, 배포·테스트 방식을 확정한다. |
| --- |

<a id="table-33"></a>
**표 33**

| 확정 항목 | 개발명세서에서 결정할 내용 |
| --- | --- |
| DB 엔진 | Supabase PostgreSQL, 설치 버전·migration 실행 검증 |
| 인증 | 이메일 OTP, users.user_id와 sellers.user_id FK |
| JSON 필드 | 정책을 JSON으로 유지할지 일부 컬럼화할지 |
| 파일 스토리지 | 상품사진·증빙 업로드 저장소와 접근정책 |
| AI 실행 | 비동기 Evaluation 작업, 모델·제한시간은 운영설정으로 확정 |
| 발송 | EMAIL 비동기 발송, 제공사·발신 도메인 운영 전 확인 |
| API | 프로젝트/신청/심사/부스/안내 엔드포인트 |
| 테스트 | 자운대 Pilot seed 데이터와 E2E 시나리오 |

### 12 1 MVP DB 완료조건

• 새 Project를 생성하고 정책을 저장할 수 있다.

• 기존 Seller를 재사용하여 여러 Project에 Application을 생성할 수 있다.

• Application 상태와 모든 변경이 일관되게 추적된다.

• AI Evaluation과 운영자 최종결정이 분리되어 저장된다.

• CONFIRMED Seller만 부스배치 대상이 된다.

• 상태별 안내 생성·발송 결과를 저장할 수 있다.

• Project 단위 데이터 격리와 감사로그를 확인할 수 있다.

## 13 무결성 제약과 트랜잭션 계약

<a id="table-34"></a>
**표 34**

| 대상 | 필수 제약 |
| --- | --- |
| 권한 | project_members UNIQUE(project_id,user_id), role=OPERATOR/REVIEWER/VIEWER; users.account_role=STAFF만 멤버로 등록 |
| 프로젝트 | recruit_start_at &lt; recruit_end_at, target_team_count &gt; 0, event_date는 단일 KST 날짜 |
| 정책 JSON | policy_json: allowed_categories[], restricted_items[], business_required, photo_required, participation_fee_krw, consent_version; evaluation_policy_json: criteria[{code,weight}], 합계 weight=100 |
| 운영 JSON | booth_policy_json: 규격·전기·화기·냉장·차량 조건, setup_at, entry_at, contact_phone, preparation_text; JSON schema_version=1 및 서버 타입검증 |
| 공통 FK | applications/booths에 UNIQUE(project_id, 각 PK), booth_assignments의 (project_id,application_id)/(project_id,booth_id) 복합 FK로 교차 연결 차단 |
| 메시지 FK | communications(project_id,application_id) → applications(project_id,application_id) 복합 FK |
| 활성 배치 | UNIQUE(booth_id) WHERE confirmed=true AND released_at IS NULL; UNIQUE(application_id)도 같은 조건. 추천은 점유하지 않음 |
| 배치 확정 | CONFIRMED 상태·같은 프로젝트·부스 AVAILABLE·조건 충족 검증. 신청 취소와 같은 잠금 규칙 적용 |
| 평가 | UNIQUE(application_id,version_no), fit_score 0~100, 성공 상태 필수 출력값 검증. 재실행 version은 DB 잠금 아래 할당 |
| 파일 | CHECK ((seller_id IS NULL) &lt;&gt; (application_id IS NULL)), 대상 FK 확인, 소유권과 프로젝트 권한으로 조회 |
| 정원 | 승인/승격/취소 트랜잭션에서 project 행을 잠그고 APPROVED+CONFIRMED &lt;= target_team_count 검증 |
| 임시저장 | DRAFT에는 상품명·사진·동의 미입력 허용. 제출 시 조건부 필수값·boolean 기본 false·table_count&gt;=0 검사 |

변경 API는 인증된 actor의 api_idempotency 키 상태를 확인한다. EXPIRED는 본문 없이 410을 반환한다. 그 외에는 현재 대상 권한을 검사하고 고유키를 확보하며 업무 변경 전에 키 상태를 다시 확인한다. 업무 잠금 순서는 project → application ID 정렬 → booth ID 정렬 → assignment → communication으로 고정한다. 상태 변경은 현재 version을 비교하고 application_status_history·audit_logs·부스 해제·미발송 승인 무효화를 한 트랜잭션으로 커밋한다. 실패 시 전체 롤백하고 409를 반환한다. 외부 AI·메시지 네트워크 호출은 트랜잭션 밖에서 수행한다.

## 14 발송 시도 및 요청 멱등성

<a id="table-35"></a>
**표 35**

| 테이블 | 필드와 제약 |
| --- | --- |
| communication_attempts | attempt_id UUID PK; communication_id UUID FK; attempt_no int; status SENDING/SENT/FAILED/UNKNOWN; provider_message_id nullable text; error_code nullable text; error_message nullable text; started_at timestamptz; completed_at nullable timestamptz; UNIQUE(communication_id,attempt_no) |
| api_idempotency | request_id UUID PK; actor_user_id UUID FK NOT NULL; operation varchar(80) NOT NULL; idempotency_key UUID NOT NULL; request_hash text nullable, EXPIRED 외에는 NOT NULL을 CHECK로 강제; status IN_PROGRESS/SUCCEEDED/FAILED/EXPIRED NOT NULL; response_json jsonb; http_status int; resource_type varchar(40); resource_id UUID; created_at/updated_at timestamptz NOT NULL; UNIQUE(actor_user_id,operation,idempotency_key). IN_PROGRESS는 같은 트랜잭션의 미커밋 단계에서만 사용, 최초 업무 커밋 결과는 SUCCEEDED/FAILED와 response_json/http_status 필수. 보관기간 종료 후 EXPIRED 전환은 별도 만료 계약을 따른다. resource는 비동기 작업 생성/기존 객체 변경 시 필수, 검증실패에는 nullable; expired_at timestamptz nullable, EXPIRED에서만 필수. EXPIRED의 응답·해시·resource·http_status는 NULL이며 최소 고유키 기록은 유지한다. |

communications는 수신자별 메시지 작업, communication_attempts는 각 제공사 호출 이력이다. UNKNOWN은 제공사 접수 여부를 확인하지 못한 상태이며 조회로 결과를 확정하기 전에는 새 호출을 하지 않는다. SENT는 제공사 접수 성공 또는 근거를 기록한 수동 전달 완료이며 실제 열람을 의미하지 않는다.

같은 API 멱등성 키와 같은 정규화된 경로·대상·요청 본문은 EXPIRED 여부를 먼저 확인한다. EXPIRED는 동일 actor에게 410만 반환한다. 만료 전에는 현재 대상 권한 검사 후 저장 결과를 반환하며 다른 요청은 409다. 동일 수신처·내용의 확정 실패 재시도만 같은 communication_id와 제공사 idempotency_key를 사용한다. 실행 이력 이후 수신처·내용 변경은 새 communication_id·새 idempotency_key·supersedes_id로 기록하며 원본은 superseded_at을 설정한다. UNKNOWN/SENDING의 대체 발송은 결과 확정 전 금지한다. 제공사가 멱등성을 지원하지 않으면 UNKNOWN 근거 확인을 필수로 한다.

## 15 개인정보 보관과 신청 스냅샷

최초 제출 시 seller_snapshot_json·consent_json·policy_version을 저장한다. 동의 없는 제출은 차단한다. 수정 전후와 actor는 audit_logs에 남기되 인증 자격증명·OTP·access token은 저장하지 않는다. worker 내부 claim_token은 작업 제어 필드이며 외부로 노출하지 않는다. 운영 메모는 project_id가 있는 감사 기록에만 저장하여 타 프로젝트에 자동 공유하지 않는다.

운영 DB 날짜·시각은 date를 제외하고 timestamptz로 저장한다. event_date는 Asia/Seoul의 단일 행사일이다. 보관기한은 운영자가 개인정보 처리 목적에 맞게 운영 전 확정한다. soft delete는 영구 보관 정책을 뜻하지 않으며 만료 시 파일·메시지·snapshot·로그의 개인정보 제거 절차를 함께 실행한다.

FK 삭제는 운영이력의 연쇄 삭제를 막는 RESTRICT를 기본으로 한다. 계정 비활성화 시 users.status와 활성 세션·API 접근을 함께 통제한다. 계정 영구 삭제는 먼저 보존기간·개인정보 제거·FK 정리 절차를 수행하는 별도 관리 작업으로 둔다. role/status Enum에는 서버와 DB의 같은 허용값 집합을 적용한다.

project_members의 모든 필드는 NOT NULL, active 기본 true다. communications의 project_id/application_id/type/channel/body/send_status/content_version/idempotency_key/version/created_at/updated_at은 NOT NULL이다. 승인 전 approved_by/approved_at/approved_version/recipient_snapshot은 null일 수 있으나 READY 이후에는 필수다. 그 외 subject/sent_at/failure_reason은 nullable이다. attachments는 두 소유 FK와 deleted_at 외 필드가 NOT NULL이다.

## 16 추가 무결성 계약

<a id="table-36"></a>
**표 36**

| 영역 | 필수 규칙 |
| --- | --- |
| 가입 | users.user_id UNIQUE/PK로 가입 재시도 중복 차단. 새 계정의 USER/SELLER/ACTIVE는 서버 기본값. users.name은 프로필 완료 시 필수. 셀러 생성과 프로필 완료 기록을 한 트랜잭션으로 저장 |
| 이메일 | sellers.email은 사용하지 않음. 제출 당시 검증 이메일을 notification_email에 저장. 동기화는 서버가 인증 제공자의 현재 검증 주소를 조회하며 client email 문자열은 받지 않음 |
| 행사 종료 | event_end_at의 Asia/Seoul 날짜=event_date. recruit_end_at &lt; event_end_at. info_due_at/confirm_due_at &lt; event_end_at. event_end_at 단축은 기존 기한·업무와 충돌 시 409 |
| 정원 수정 | target_team_count 축소에도 project 잠금 아래 APPROVED+CONFIRMED 수 검증, 현재 점유보다 작게 변경 불가 |
| 이메일 동기화 | applications 잠금 → notification_email·revision_no·version 갱신 → READY/QUEUED 승인·대기열 무효화·DRAFT 수신처 갱신 또는 실행 이력 메시지 대체 필요 표시 → 감사로그. SENDING/UNKNOWN 수신처는 불변 |
| 보완 연장 | NEED_INFO 유지, info_due_at 증가, version 증가, NEED_INFO→NEED_INFO 이력 및 감사로그 기록, 안내 초안 생성 |
| 부스 교환 | project→application ID 정렬→booth ID 정렬→assignment 순 잠금. 변경 집합 밖의 점유와 충돌 검사. 기존 집합 전체 해제 후 신규 집합 전체 삽입, 동일 트랜잭션. UNIQUE는 유지 |
| 첨부 | storage_key UNIQUE, 객체키 재사용/덮어쓰기 금지. complete는 등록된 업로드 의도와 실제 객체 일치 검사. 새 첨부 추가/해제는 applications revision_no/version 증가와 같은 트랜잭션 |

<a id="table-37"></a>
**표 37**

| 테이블 | 필드 및 제약 |
| --- | --- |
| communication_resolutions | resolution_id UUID PK; communication_id UUID FK NOT NULL; attempt_id UUID FK NOT NULL; from_status/to_status NOT NULL; method PROVIDER_QUERY/MANUAL_EVIDENCE; outcome ACCEPTED/NOT_ACCEPTED/INCONCLUSIVE; evidence_ref text NOT NULL; reason text NOT NULL; resolved_by UUID FK users NOT NULL; resolved_at timestamptz NOT NULL; UNIQUE(communication_id, resolution_id). attempt는 같은 communication 소속이어야 함 |
| upload_intents | upload_intent_id UUID PK; storage_key text UNIQUE NOT NULL; application_id UUID FK nullable; seller_id UUID FK nullable; 두 소유 FK 중 하나 필수; field_code text; requested_by UUID FK users; expected_application_version int nullable; expected_revision_no int nullable; mime_type text; max_size_bytes bigint; status ISSUED/COMPLETED/EXPIRED/REJECTED; expires_at timestamptz; attachment_id UUID FK nullable UNIQUE; created_at timestamptz. 소유 FK·첨부 ID 외 값은 문맥상 필수이며 application 소유일 때 expected version/revision 필수 |

UNKNOWN 확인은 communication/attempt/version을 잠그고 resolution을 추가한다. ACCEPTED는 SENT, NOT_ACCEPTED는 FAILED, INCONCLUSIVE는 UNKNOWN 유지다. 같은 확인 요청은 API 멱등성 키로 중복 처리하지 않는다. 근거에는 제공사 참조번호 또는 수동 확인 기록을 남기며 비밀키·원문 인증자료는 저장하지 않는다. 발송 취소/수정 액션과 경쟁 시 version 충돌을 반환한다.

한 번이라도 communication_attempts가 생성된 메시지는 body·recipient_snapshot·content_version을 수정하지 않는다. FAILED/SENT의 수정 발송은 원본과 같은 신청에 새 DRAFT를 만들고 재승인을 받는다. SENT 대체는 추가 안내라는 사유가 필수다. 원본 상태·시도·승인은 보존한다. 새 초안 생성을 재시도해도 API 멱등성 키로 한 개만 생성한다.

첨부 논리 해제는 attachments.deleted_at을 기록해 활성 목록에서 제외하되 즉시 물리 삭제하지 않는다. 이전 제출 revision의 첨부 ID·객체키는 audit_logs의 전후 값으로 보존한다. 재사용 중인 storage_key가 없는지 확인하고 보관기간 만료 후에만 물리 삭제한다.

users.email은 인증 제공자의 검증 완료 주소를 서버가 동기화하는 계정 정보다. 일반 프로필 PATCH로 변경하지 않는다. 기존 applications.notification_email은 별도 snapshot이므로 계정 정보 동기화에 따라 자동 변경하지 않는다.

upload_intents에서 requested_by/field_code/mime_type/max_size_bytes/status/expires_at/created_at은 NOT NULL이다. seller_id 소유 업로드는 본인 셀러 마스터의 현재 자산 수정으로 처리하고 신청 상태 검증은 적용하지 않는다. 이 자산을 신청에 사용하려면 DRAFT 또는 허용된 NEED_INFO에서 새 application 소유 객체·첨부로 복사하고 revision을 증가시킨다. 제출된 신청이 수정 가능한 셀러 마스터 객체를 직접 참조하지 않게 한다.

## 17 요청 원자성과 순차 업로드

요청 중복 방지 레코드와 업무 변경·이력·비동기 작업 생성은 같은 DB 트랜잭션으로 커밋한다. IN_PROGRESS는 미커밋 처리 중에만 존재하며 별도로 저장하지 않는다. 커밋 전 중단은 전체 롤백, 커밋 후 응답 유실은 같은 키와 본문으로 저장된 결과를 재조회한다. 외부 AI·메시지 호출은 커밋된 작업을 worker가 처리한다.

<a id="table-38"></a>
**표 38**

| 영역 | 필수 제약 |
| --- | --- |
| 요청 고유키 | (actor_user_id, operation, idempotency_key) UNIQUE. request_hash는 HTTP method·정규화 경로·대상 ID·본문을 포함한다. 인증 토큰·시각별 request_id는 제외한다. |
| 커밋 원자성 | api_idempotency INSERT → DB 업무 변경·감사·작업 생성 → 최종 결과 UPDATE를 단일 트랜잭션으로 처리한다. 트랜잭션 도중 네트워크 AI/발송 호출 금지. |
| IN_PROGRESS 금지 | IN_PROGRESS만 별도 커밋하지 않는다. 지연 제약 트리거 등 DB 커밋 검증으로 SUCCEEDED/FAILED의 응답 저장 또는 EXPIRED의 최소 기록 조건을 강제한다. EXPIRED는 기존 완료 행의 만료 처리만 허용한다. |
| 동시 재시도 | 고유키 확보 경합 시 먼저 처리 중인 트랜잭션의 종료를 기다린다. 잠금 대기 상한을 넘기면 409 REQUEST_IN_PROGRESS와 Retry-After 반환, 새 작업 생성 없음. |
| 기술 실패 | DB 연결 오류·프로세스 중단은 업무와 요청 레코드 전체 롤백. 새 트랜잭션에서 같은 키 재시도 가능. 실패를 저장했다고 가정하지 않음. |
| 업무 거절 | 입력/상태 검증 실패는 업무를 바꾸지 않고 FAILED·4xx 결과를 저장할 수 있다. 같은 요청은 같은 거절 결과를 반환한다. 사용자가 입력·version을 변경해 새로 실행하면 새 키다. |
| 응답 재생 | 인증 후 키 상태를 확인한다. EXPIRED는 동일 actor에게 결과 본문 없이 410 REQUEST_RESULT_EXPIRED. SUCCEEDED/FAILED는 현재 대상 권한 검사 후 기존 http_status·response_json·resource_id를 재생한다. 최초 실행만 expected_version을 검사한다. |
| 비동기 작업 | 202 응답과 evaluation 또는 QUEUED communication ID를 같은 커밋에 저장한다. worker는 커밋된 QUEUED만 실행, 프로세스 재시작 후도 조회 가능해야 한다. |
| 보관 | 요청 결과 보관기간이 끝나면 api_idempotency 행을 삭제하지 않고 같은 행을 EXPIRED로 전환한다. response_json·request_hash·resource_type·resource_id·http_status를 NULL로 지우고 expired_at을 기록한다. request_id·actor_user_id·operation·idempotency_key·status·created_at·updated_at·expired_at만 남겨 기존 UNIQUE 제약으로 키 재사용을 막는다. 만료는 SUCCEEDED/FAILED이고 연결된 비동기 작업이 종료되며 미확인 결과가 없는 요청에만 허용한다. 요청 처리와 만료 처리는 같은 고유키 및 행 잠금으로 직렬화한다. 응답 본문 보관기간은 운영 전 설정값으로 확정하고 만료 처리 작업에 적용한다. 최소 사용 완료 기록은 해당 actor 계정이 요청할 수 있는 동안 삭제하지 않는다. 계정 삭제 시에는 먼저 인증 세션과 실행 권한을 차단하고 같은 actor_user_id를 재발급하지 않는 조건에서 연관 기록을 정리한다. 보관기간과 삭제 범위의 운영 승인 전에는 자동 정리 작업을 활성화하지 않는다. |
| 업로드 순서 | 한 신청의 파일마다 현재 version/revision으로 upload_intent를 발급하고 complete 이후 반환 버전을 다음 intent에 사용한다. 미리 여러 intent를 병렬 발급하지 않는다. |
| 완료 원자성 | complete는 intent를 잠그고 상태·기한·객체·version을 재검사하여 attachment INSERT + intent COMPLETED + application revision/version 증가 + 응답 저장을 같은 트랜잭션으로 처리한다. |
| 업로드 완료 재시도 | 같은 complete 키·본문이면 저장된 attachment_id와 당시 완료 버전을 재생한다. 새 키로 이미 COMPLETED인 intent를 보내도 새 첨부를 만들지 않고 ALREADY_COMPLETED와 재조회 안내를 반환한다. |

저장된 IN_PROGRESS가 발견되면 명세 위반으로 기록한다. 시간 경과만으로 삭제·재실행하지 않고 연결된 업무·감사·작업 존재를 확인해 원래 결과를 복구한다. 결과를 증명하지 못하면 NEEDS_OPERATOR_REVIEW로 응답하며 추가 실행을 막는다. 이는 기존 상태 Enum을 늘리는 업무 상태가 아니라 복구 오류 코드다.

queued_at/queued_by는 현재 대기 요청 정보이며 과거 요청은 audit_logs에 보존한다. READY→QUEUED와 FAILED→QUEUED에서 새 요청정보를 기록한다. content 변경·취소 시 QUEUED를 잠그고 현재 대기정보를 제거한다. worker claim은 QUEUED·version·요청자 현재 권한·미대체·최신 내용/대상·행사 종료시각을 모두 검증한다. 시도 이력이 없는 철회는 DRAFT, 실행 이력이 있는 철회는 FAILED/CONTEXT_CHANGED, 행사 종료·권한 상실은 FAILED/EVENT_ENDED 또는 REQUESTER_UNAUTHORIZED로 기록한다.

