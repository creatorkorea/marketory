# Operator review implementation plan

> Use superpowers:subagent-driven-development with independent backend/frontend ownership and final review. User's next-step authorization continues the approved v1.3 design; do not repeat approval for existing business contracts.

**Goal:** Assigned operators inspect submitted applications, request/extend corrections, start manual review, decide approve/wait/reject, promote waiting candidates and extend confirmation deadlines; approved sellers can confirm participation.
**Architecture:** Extend existing FastAPI transaction/idempotency/role model and Next shared UI. No AI or external messaging. Review notes and non-sendable notice-draft snapshots stay in project-scoped audit records; full communications approval/worker integration remains P7.
**Tech Stack:** Existing Next/React, FastAPI/Pydantic/psycopg and Supabase Postgres.
**Spec:** docs/reference/00-common-contract.md §§3–8, 03-features.md REV-001–010/CNF-002–004, 04-data-model.md §§13–16, 05-development.md §§16–19, UX-CONTRACT.md, DESIGN.md.

## Constraints and decisions
- Continue in configured checkout on `codex/operator-review` from verified 698282b, preserving main and prior feature branch. No user/customer data mutations for tests, no delivery/deployment.
- Lock request key → active user → project → application; version guard, audit/history and saved result atomic. Replay checks current rights. Read projections and persisted replay results must not leak operator-only data to a later downgraded reviewer.
- OPERATOR/admin decision rights; REVIEWER project-assigned read/product-photo/note only with masked contacts; VIEWER aggregate only. DRAFT applications excluded from staff review. Raw snapshot, business number/doc, notification email and generic audit before/after must not leak to reviewer.
- Review/decisions/request-info in RECRUITING/REVIEWING and before event_end. CLOSED allows confirmation/cancel/confirmation deadline extension but no new decisions. Confirm requires APPROVED, now < confirm_due_at < event_end.
- Capacity APPROVED+CONFIRMED ≤ target_team_count under project lock for approval/promotion and project capacity shrink. Project end shortening must not invalidate existing info/confirm deadlines. No automatic cancellation on deadline expiry.
- Decision/confirmation/note changes increment application.version only, not content revision. Notes live in audit_logs project-scoped records; no global seller notes. Notice drafts have no send controls/worker side effect.
- Existing shared UI components/recovery/KST/unsaved guards and typography reused. No inline contact search in URL; implement state/category filtering and pagination without free text search for this slice.

## Interfaces

All replies `{data:...}`, all mutations UUID Idempotency-Key and expected_version. JSON routes under /api. All new staff mutations return the current staff detail projection. Role downgraded to REVIEWER cannot replay an operator payload.

Backend-owned `reviews.py`, `review_domain.py`, `tests/test_reviews.py`:
- `review_router(settings,identity)`, no prefix. Root integrates router/relay/result permissions.
- `require_review(conn,actor_id,application_id,action="read") -> (app,project,role)`; role OPERATOR/REVIEWER, admin maps OPERATOR. action operate or note. Current rights only in authorize; lifecycle in mutate.
- `review_data(conn,actor_id,app,project,role)` staff safe detail:
  application fields/product/conditions/version/revision/status/deadlines/waiting_rank; project `{project_id,name,status,event_end_at,target_team_count,policy_json}`; `seller` `{shop_name,owner_name,phone,email}` (reviewer masked); safe attachments filtered by role; notes `[{note_id,body,created_at,author_id}]`; history `[{history_id,from_status,to_status,reason,created_at}]`; `allowed_actions` names start_review/request_info/extend_info/approve/wait/reject/promote/extend_confirmation/note/confirm; `role` and `capacity` `{occupied,target}`; `notice_drafts` only safe type/body/time for OPERATOR. Never whole audit dump.
- GET `/projects/{id}/applications?status=&category=&limit=20&offset=0` data `{items:[safe compact rows],total,limit,offset,project:{project_id,name},role}`. Row id/status/version/product/category/shop_name/submitted_at/confirm_due_at/info_due_at only; no contact.
- GET `/projects/{id}/application-summary` data `{counts:{STATUS:n},occupied,target}` for VIEWER+review roles.
- GET `/review/applications/{id}` staff detail (seller endpoint remains owner-only to avoid accidental leak).
- POST `/applications/{id}/start-review` op reviews.start body `{expected_version,reason}` SUBMITTED→REVIEWING, manual review explicitly no AI.
- POST `/applications/{id}/request-info` op reviews.request_info body `{expected_version,fields:[field code],reason,info_due_at}`. fields allow content fields plus product_images/business_document, unique nonempty. SUBMITTED/REVIEWING→NEED_INFO, store per-field `{field,reason}`, deadline future<event_end.
- POST `/applications/{id}/extend-info` op reviews.extend_info body `{expected_version,reason,info_due_at}` NEED_INFO→NEED_INFO, deadline >previous and now <new<event_end.
- POST `/applications/{id}/decision` op reviews.decision body `{expected_version,decision:"APPROVED"|"WAITING"|"REJECTED",reason,confirm_due_at?:ISO,waiting_rank?:positive int}`; REVIEWING→choice, WAITING→APPROVED/REJECTED only. Reject irrelevant fields. Approve requires future deadline<event_end and capacity; WAITING positive rank, internal only. Preserve content revision.
- POST `/applications/{id}/extend-confirmation` op reviews.extend_confirmation body `{expected_version,reason,confirm_due_at}` APPROVED only, increasing future deadline<event_end.
- POST `/applications/{id}/notes` op reviews.note body `{expected_version,body}` reviewer/operator, max4000, nonblank, before end, non-DRAFT.
- Helpers `record_notice_draft(conn,actor,app,kind,body)` write REVIEW.NOTICE_DRAFT audit after_json `{kind,body}` no delivery. Explain UI "안내 초안 기록 · 발송 전".

Root-owned confirmation integrates shared existing owner helper or require_review operate: POST `/applications/{id}/confirm`, operation applications.confirm, body `{expected_version,reason?:str}`. Owner uses own identity; staff requires operate + nonblank reason evidence. Read owner application.allowed_actions adds confirm; operator detail adds confirm. Return projection appropriate to actor; saved resource_type `application` for owners and `review_application_operator` for operators distinguishes permission for result lookup; operator-only replay never handed to reviewer. Root configures expire allowlist/migration if necessary.

## Tasks
- [x] T1 Backend operator review: red→green tests for role/masking, state restrictions, capacity concurrent approve, deadline bounds/extension, version/replay/revocation, note privacy and no delivery. Implement owned modules only; notify root interface changes.
- [x] T2 Operator UI: `/markets/[id]/applications`, `/markets/[id]/applications/[applicationId]`, components/reviews, lib/reviews, tests. Shared MarketAccess+recovery/Field/ConfirmDialog; compact status/category list, actual detail, no fake AI card. Record CSS in output/review-ui.css for root integration. Preserve filters/offset back link. Tests for 409 input retention, reviewer controls absent, confirmation with review, narrow/keyboard and lost response.
- [x] T3 Root integration: guarded project edits, confirmation backend+seller UI, router/relay/recovery names, generated types, any additive migration/security checks. Focused tests before changes.
- [x] T4 Full check/build/browser, independent code review, apply only additive verified migration, documentation and commit/push feature branch. No merge/deployment. Review findings resolved before completion.

## Review focus
1. Two applications contend for final slot; exactly one approves.
2. Role changes between mutation and replay; cached operator contact data inaccessible.
3. Viewer/reviewer direct endpoints and file roles cannot bypass UI.
4. Expired confirmation/needs-info remains unchanged until explicit extension; old form version cannot win.
5. Summary counts/private notes and seller snapshot remain isolated across projects and audiences.

## Execution ledger
- Ruling: implement manual review before AI/communications. Keep notice draft audit evidence explicitly non-sendable; avoid implying external notice delivery. Existing approved v1.3 architecture retained.
- Verification: web units 48, API tests 63, full browser fixtures 32 passed; final focused review fixtures 9 passed after CSS alignment corrections. Build, generated types, lint and premium audit passed. Independent review findings (409 field retention, revoked 404) fixed and regression-covered. Remote migration 20261009081137 applied and read back; RLS/private grants preserved. No delivery, customer decisions or deployment performed.
