# 마켓 공통 안내 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 마켓 공통 안내를 승인·게시하고, 대상 셀러가 본인 신청에서 개별 안내와 구분해 조회한다.
**Architecture:** market_announcements 전용 테이블·라우터·화면을 추가한다. 권한·트랜잭션·멱등 결과 복구와 기존 UI 요소를 재사용하며 communications/worker의 이메일 처리는 변경하지 않는다.
**Tech Stack:** 기존 FastAPI, psycopg, Supabase PostgreSQL, Next.js App Router, React, TypeScript, pytest, Vitest, Playwright. 새 제품 의존성 없음.
**Spec:** [승인된 설계](../specs/2026-10-22-market-announcements-design.md).
**Execution:** 권장 방식은 이 세션에서 직접 구현(Native)하고 마지막에 독립 검토를 받는 방식. 아래 계획은 구현 전 검토용이며 체크된 작업만 완료로 간주한다.

## Global Constraints

- 이메일 발송·예약 게시·읽음 추적·첨부파일은 이번 범위에 포함하지 않는다.
- 작성 기본값은 참가 확정자로 한다. 전체 신청자는 미선정자도 포함한다는 설명을 표시한다.
- 대상은 조회 시점의 신청 상태로 판단한다. 초안·취소·삭제 신청은 공통 안내를 볼 수 없다.
- 초안의 대상 수정은 현재 게시 대상에 영향을 주지 않는다. 제목·본문·대상을 한 게시본으로 저장하고 명시적으로 재게시할 때 함께 교체한다.
- 행사 종료 후 작성·수정·승인·게시는 차단하고 게시 내리기는 허용한다.
- 테이블은 RLS를 켜고 anon/authenticated의 직접 접근을 차단한다.
- 기존 Pretendard, 색상, 여백, 버튼, 확인 대화상자, 미저장 경고를 재사용한다.
- 로컬 구현과 운영 DB 적용/배포/실계정 검증은 별도 완료 상태로 보고한다.

## Review Focus

1. 대상 변경만 저장한 경우 기존 게시 대상 유지: Task 1의 audience_snapshot 테스트.
2. 조회 후 참가 취소/운영 권한 회수: Task 1 권한 재검사, Task 3 재조회 시 이전 본문 제거 테스트.
3. 저장 성공 후 응답 유실·탭 새로고침: Task 1 멱등 복구, Task 2 클라이언트 복구 테스트.
4. 마지막 페이지의 공지가 모두 내려짐: Task 1 페이지 응답, Task 3 빈 페이지에서 이전 이동 테스트.
5. 공통 안내 조회 실패가 개별 안내·신청 확인을 가림: Task 3 독립 상태와 모바일 긴 본문 테스트.

## 공통 인터페이스

- `Audience = Literal['ALL_APPLICANTS', 'CONFIRMED']`.
- 작성 본문: `{subject, body, audience, reason}`. 수정은 여기에 `expected_version` 추가. 승인·게시는 `{expected_version, content_version, reason}`, 내리기는 `{expected_version, reason}`.
- 제목 1–200자, 본문 1–50000자, 사유 1–2000자. 문자열 trim 후 빈 값 거부. 버전은 양의 정수. 추가 필드 거부.
- 운영자 `Announcement`: announcement_id, project_id, subject, body, audience, content_version, version, approved_version, approved_at, created_at, updated_at, publication, allowed_actions. publication은 null 또는 `{subject,body,audience,content_version,published_at,withdrawn_at}`. 작성자/승인자 ID는 UI에 필요하지 않아 반환하지 않는다.
- 셀러 `MarketNotice`: `{announcement_id,subject,body,audience,content_version,published_at}`. 값은 모두 게시본에서 가져온다.
- 목록 envelope는 기존 `{data: ...}`. 운영자 data는 `{items,total,limit,offset,project:{project_id,name}}`; 셀러는 `{items,has_more,limit,offset}`. 단건/변경 결과 data는 Announcement.
- 목록 기본/최대: 운영자 20/100, 셀러 5/20. offset은 0 이상. 셀러 새로고침은 offset=0.
- `announcements.create|revise|approve|publish|unpublish`를 작업 이름으로 사용한다. 생성 target은 project, 생성 성공 Change는 announcement 리소스. 나머지는 announcement 리소스. 작업 결과 조회 시 현재 권한 재검사.

## Task 1: 저장소·API·권한·복구

**Files:** 신규 `apps/api/src/marketory/announcement_domain.py`, `announcements.py`, `apps/api/tests/test_announcements.py`; 수정 `routes.py`, `permissions.py`; CLI가 생성하는 `supabase/migrations/*_market_announcements.sql`; 생성물 `packages/types/openapi.json`, `packages/types/src/api.d.ts`.
**Consumes:** 기존 require_project, require_application, before_end, version_matches, execute, Change, isolated_db fixture.
**Produces:** `announcement_router(settings, identity)`, `require_announcement(conn,actor,aid) -> (announcement,project)`, `announcement_data(announcement,project) -> dict`; 위 공통 응답과 API 8개(GET/POST 목록, GET 상세, POST 4종, GET 셀러 목록).

- [ ] **실패 테스트 작성:** test_announcements.py에서 기존 fixture/client_for/headers 패턴 사용. `test_lifecycle_and_audience_snapshot`: 작성 201, 미승인 게시 409, 승인만 하면 셀러 목록 `[]`, 게시 후 1건. ALL_APPLICANTS 게시 후 CONFIRMED로 수정·승인만 하면 미확정 셀러에게 기존 게시본 유지, 재게시 후 `[]`, 확정 셀러는 신규 본문, 내리기 후 `[]`, 다시 게시 후 1건. 기존 communication_attempts 수 불변.
- [ ] **실패 테스트 작성:** `test_audience_status_matrix`는 모든 신청 상태를 매개변수화. 제출 이력 있는 SUBMITTED/NEED_INFO/REVIEWING/APPROVED/WAITING/REJECTED/CONFIRMED는 전체 대상 조회 가능, CONFIRMED 대상은 CONFIRMED만 가능. DRAFT/CANCELLED는 빈 목록, 삭제 신청/마켓은 404. 뒤늦은 확정과 취소 후 재조회도 확인한다.
- [ ] **실패 테스트 작성:** `test_permissions_and_recovery`는 anonymous 401, 타인 신청 404, 타 마켓·VIEWER·REVIEWER·셀러 쓰기 거부, 비활성 사용자 거부, 운영 권한 회수 후 조회/변경/결과 복구 거부를 검증한다. 같은 키/본문 재요청 결과 동일·audit 1개, 같은 키/다른 본문 409, 성공 및 실패한 create 결과 조회, 모든 5개 작업의 결과 조회를 검증한다.
- [ ] **실패 테스트 작성:** `test_versions_end_and_paging`은 오래된 version/content_version 409, 동일 활성 버전 재게시 409, 종료 후 내리기만 가능, 목록 limit 경계(0/초과 422), has_more/안정 정렬/빈 페이지를 검증한다. `test_schema_privacy`는 RLS true, 두 클라이언트 역할 SELECT 거절, 불완전 승인/게시 필드 CHECK 실패, 셀러 응답 키가 MarketNotice와 정확히 일치함을 검증한다.
- [ ] **RED 실행:** 전용 loopback DB 환경에서 `uv run --project apps/api --locked pytest -c apps/api/pyproject.toml apps/api/tests/test_announcements.py -q`. 신규 경로 404 등 구현 부재로 실패 확인. 기존 테스트 DB 준비가 안 됐으면 `node scripts/local-db.mjs`로 준비하고, 운영 DB를 테스트 DSN으로 쓰지 않는다.
- [ ] **구현:** Supabase CLI help 확인 후 `migration new market_announcements`로 파일 생성. 설계의 필드·FK·CHECK·RLS·grant 차단·마켓 목록 인덱스와 활성 게시 부분 인덱스 추가. 기존 테이블/트리거 변경 없음. domain에는 권한·게시본·allowed_actions, router에는 입력 모델·읽기·멱등 쓰기·감사 로그 연결. 셀러는 require_application 반환값의 project와 현재 app 상태로 필터링하고 SQL은 published_audience를 사용한다.
- [ ] **복구 연결:** routes.py 라우터 등록/작업 허용 목록, permissions.py authorize_result에 5개 작업 추가. 권한 검사 후 마켓→안내 잠금, 변경과 audit 원자적 처리. 작업별 audit action은 `ANNOUNCEMENTS.CREATE|REVISE|APPROVE|PUBLISH|UNPUBLISH`, entity_type은 `announcement`.
- [ ] **GREEN 실행:** 위 새 테스트 및 `test_publications.py`, `test_communications.py` 통과. `npm.cmd run types:generate`, `npm.cmd run api:lint`, `npm.cmd run types:check` 성공. 생성 응답이 웹 공통 인터페이스와 맞는지 확인하고 API 변경만 커밋(푸시/운영 migration은 최종 검증 후).

## Task 2: 운영자 관리 화면과 웹 전달·복구

**Files:** 신규 `apps/web/app/markets/[id]/announcements/page.tsx`, `components/announcements/board.tsx`, `lib/announcements/form.ts`, `tests/announcements.test.ts`, `tests/browser/announcements.spec.ts`; 수정 `lib/api/relay.ts`, `lib/markets/use-mutation.ts`, `tests/relay.test.ts`, `components/communications/board.tsx`.
**Consumes:** Task 1 API와 Announcement. 기존 MarketAccess/MarketSession, useMarketMutation, ConfirmDialog, UnsavedGuard, RequestStatus, Field, TextareaField.
**Produces:** `AnnouncementsBoard({id,query})`; 공통 안내 관리 경로와 개별 안내 왕복 링크. `audienceLabels`, `announcementPayload(...)`, `listQuery(...)`는 form.ts에 둔다.

- [ ] **실패 테스트 작성:** 단위 테스트로 trim·길이·잘못된 대상·버전 검증. relay는 새 GET/POST 및 5개 요청 결과 경로 허용, 잘못된 method/UUID/operation 거절, pagination 쿼리만 전달, 인증·no-store 유지.
- [ ] **실패 브라우저 테스트 작성:** 기본 CONFIRMED, 전체 신청자 선택 시 미선정 포함 설명, 작성/수정→승인→게시→내리기 흐름과 확인창 대상·버전 표시. 미저장 변경 상태에서는 승인/게시 금지, 다른 초안 선택 시 경고. 409에서 입력 보존 후 최신 상태 확인. 목록 실패·빈 목록·403·401·지연 상태 확인.
- [ ] **복구 실패 테스트 작성:** 각 5개 operation의 pending 저장 상태로 진입→요청 상태 조회→성공 데이터 표시→pending 제거. 이미 성공한 요청 POST 재발행 0건. 응답 유실 시 같은 키 유지. 권한 회수 시 결과 내용을 표시하지 않음.
- [ ] **RED 실행:** `npm.cmd run web:test -- --run` 대신 루트의 기존 `npm.cmd run web:test` 사용. 브라우저는 로컬 서버 준비 후 `npm.cmd run web:test:browser -- --grep '공통 안내'`로 신규 시나리오의 구현 부재 실패 확인.
- [ ] **구현:** apps/web/AGENTS.md 및 설치된 Next.js 문서, UI 스킬/디자인 규칙 확인. page params/searchParams는 기존 Promise 패턴, robots noindex 유지. board는 목록/편집/게시본을 구분하고 AbortController로 오래된 응답 배제. 기본 대상·확인창·중복 작업 잠금·미저장 경고·409 재검토·저장 결과 복구를 연결. relay와 hydration 작업 정규식을 함께 확장한다.
- [ ] **GREEN 실행:** `npm.cmd run web:test`, 신규 운영자 브라우저 테스트, 기존 communications.spec.ts 통과. `npm.cmd run typecheck` 성공. 모바일/데스크톱 캡처를 시각 확인하고 운영자 변경만 커밋.

## Task 3: 셀러 공통 안내 조회와 모바일

**Files:** 신규 `apps/web/components/seller/market-notices.tsx`; 수정 `components/seller/application.tsx`, `components/seller/notices.tsx`, `tests/browser/seller.spec.ts`, 필요 시 `app/globals.css`의 안내 전용 스타일.
**Consumes:** GET applications/{id}/market-notices, MarketNotice와 기존 SellerSession. 기존 개별 안내 API 유지.
**Produces:** `SellerMarketNotices({session,applicationId})`; 공통/개별 안내의 독립 상태와 구분되는 aria 제목/버튼 이름.

- [ ] **실패 테스트 작성:** ‘공통 안내와 개별 안내 독립 조회’에서 공통 503·개별 200이면 개별 본문과 신청 정보 유지, 공통 재시도로 정상 복구. 첫 페이지 빈 상태, 마지막 페이지가 빈 경우 이전 이동, 새로고침 시 offset=0 검증.
- [ ] **실패 테스트 작성:** 취소/비활성/권한 오류로 재조회하면 이전 공통 본문 제거. 초기 로딩·지연·실패·401/403/404 구분과 언마운트 시 늦은 응답 무시. 공통·개별 섹션 중복 id/새로고침 이름 없음.
- [ ] **실패 테스트 작성:** 320×740, 390×844에서 긴 제목·공백 없는 문자열·여러 문단·`<script>` 문자열을 일반 텍스트로 표시, script 미실행, `scrollWidth <= innerWidth`. 각 새로고침 대기 중 disabled. 신청 상세와 공개 신청 재진입 양쪽에서 조회.
- [ ] **RED 실행:** 위 seller 테스트를 실행해 신규 섹션/조회 부재로 실패 확인.
- [ ] **구현:** 별도 요청·offset·page·error·AbortController를 가진 market-notices 컴포넌트를 공통 ApplicationEditor에 연결한다. 이름은 ‘마켓 공통 안내’/‘내 신청 개별 안내’, 버튼은 각 섹션을 명시한다. 조회 중 이전 본문 제거, 5건씩 페이지, 최신순, KST 시각. 공개 마켓 정보 화면에는 추가하지 않는다.
- [ ] **GREEN 실행:** seller.spec.ts 전체 및 운영자 공통/기존 개별 안내 브라우저 테스트 통과. 두 모바일 크기와 데스크톱 캡처를 확인하고 임시 뷰포트 복원. 셀러 변경만 커밋.

## Task 4: 전체 검증·독립 검토·완료 기록

**Files:** `DESIGN.md`, `UX-CONTRACT.md`, `docs/DEPLOYMENT.md`; 검증 산출물은 Git 제외 output/.
**Consumes:** Tasks 1–3의 최종 구현과 실제 실행 결과.
**Produces:** 검증 결과, 독립 코드 검토 조치, DB→API→웹 릴리스 준비 상태.

- [ ] **문서 갱신:** 대상 상태 표, 기존 게시 대상 유지, 공통/개별 독립 조회, 결과 복구, 운영 배포 순서를 기존 문서에 반영. 실제 결과를 로컬/공개 검증으로 분리해 기록.
- [ ] **전체 검증:** loopback 테스트 DB를 지정한 동일 PowerShell 세션에서 `npm.cmd run check`, `npm.cmd run build`, `npm.cmd run web:test:browser -- --grep '공통 안내|운영 안내|셀러 안내'` 실행. grep에서 누락되는 기존 seller/communications 파일은 직접 지정해 회귀 실행. 테스트 skip을 통과로 계산하지 않는다.
- [ ] **독립 검토:** requesting-code-review 스킬로 설계 및 전체 변경을 검토한다. 대상 누출, 승인 우회, 복구 허용 목록, 잠금 순서, 기존 발송 회귀를 중점 확인. 발견된 중요 문제 수정 후 해당 회귀와 필요한 전체 검증 재실행.
- [ ] **완료 기록·커밋:** diff check, 의도한 파일만 stage, 비밀값·output 제외 확인. 로컬 구현 완료와 아직 하지 않은 운영 적용을 구분해 보고한다.

## 후속 공개 릴리스 실행 순서

구현 승인과 운영 적용 범위가 확인된 뒤 아래 순서로 별도 진행한다. 현재 문서 작성은 DB 변경이나 배포 성공을 뜻하지 않는다.

1. 정확한 Supabase 프로젝트에서 dry-run으로 신규 migration 한 건 확인→적용→이력/RLS/grant/제약 검증.
2. API 변경 푸시 및 Render Live 확인→readiness 200·비로그인 새 조회 401 확인.
3. 웹 변경 푸시 후 올바른 creatorkorea Vercel 팀의 Ready·공개 도메인 확인. Vercel 자동 배포를 고려해 API/웹 커밋을 순서대로 푸시한다.
4. 기존 테스트 마켓에서 공통 안내 생성·승인·게시·수정·내림·재게시와 셀러 조회 검증. 참가 확정자와 미확정자의 대상 차이는 각각 실제 계정 인증이 가능할 때 확인하고, 미확인 범위는 명시한다.
5. 테스트 안내 최종 상태·이메일 발송 0건·배포 revision·증거 캡처를 기록. 구버전 롤백 시 새 테이블은 유지해도 기존 코드와 호환된다.


## 실행 기록 — 2026-10-22

Tasks 1–3 구현 완료. API `9514edd`, 운영자 `dec96d9`, 셀러 `26c3a82` 로컬 커밋. 공개 DB·API·웹은 아직 적용하지 않았다.

구현 조정: 셀러 안내는 중복 컴포넌트를 새로 복제하지 않고 기존 SellerNotices의 common 변형을 두 독립 인스턴스로 사용한다. 각각 독립 effect/AbortController/offset/error를 소유하며 common 인스턴스 key에 신청 상태를 포함한다. 운영자 페이지는 URL 검색 조건 대신 화면 내 목록 offset을 소유한다. API 테스트 실행은 기존 venv Python을 직접 사용했고 같은 loopback 격리 DB fixture를 사용했다.

검증 증거: 신규 API 5개 통과, 웹 단위 75개 통과, 기존 개별 안내 포함 브라우저 34개 통과. 독립 검토 수정 후 운영자·셀러 21개 재통과, 추가 충돌 검증 포함 최종 운영자 7개 통과. typecheck, OpenAPI types:check, assets:check, Ruff, 최종 build 통과. 320px·390px 셀러와 320px 운영자 캡처 확인. Premium strict audit 지적 0건. 산출물은 output/announcements-* (Git 제외).

독립 검토: 별도 reviewer가 전체 코드·설계를 확인했다. 발견한 두 P2(신청 상태 변경 후 공통 안내 갱신 누락, 최신본 응답과 다른 편집본 혼합 가능성)를 수정했고 최종 재확인에서 미해결 P1/P2 없음. 전자는 참가확정 직후 신규 안내 노출 테스트로, 후자는 요청 취소/aborted 검사와 최신본 비교·입력 보존 테스트로 검증했다. 공개 계정 검증은 별도 릴리스 단계다.

최종 전체 API 회귀: 128 passed, 425.46초, skip 0. 로컬 격리 DB에서 실행. Task 4 완료. 위 체크리스트는 원래 계획을 보존하며 실제 실행 근거는 본 실행 기록을 기준으로 한다.
