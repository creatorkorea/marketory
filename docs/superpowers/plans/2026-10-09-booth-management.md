# Booth management implementation plan

> Use superpowers:subagent-driven-development, independent API/UI ownership and final review. Continue the user's approved v1.3 P6 scope without repeating permission for existing contracts.

**Goal:** Operators register booth resources, inspect compatible candidates, save a non-occupying draft, confirm changes/swaps atomically, and release assignments on cancellation. Sellers see only their own confirmed booth.
**Architecture:** Existing FastAPI transaction/idempotency and Next shared primitives; new private booths/booth_assignments tables. Project.version serializes board edits; draft stores application and booth input versions. No AI or messaging provider call.
**Tech Stack:** Existing Next/React, FastAPI/Pydantic, psycopg/Supabase Postgres.
**Spec:** docs/reference/03-features.md BTH-001–007; 04-data-model.md §§6/13/16; 00-common-contract.md lock/event/role rules; UX-CONTRACT.md.

## Decisions and invariants
- Work in configured checkout, new feature branch codex/booth-management from 7ae5704; preserve existing local services. No merge/deploy, real assignments or outgoing messages.
- OPERATOR/admin writes, REVIEWER reads minimal board without contacts/docs, VIEWER aggregate only (existing summary). Seller sees only active confirmed own booth via owner application DTO.
- Every write uses Idempotency-Key, expected_version = current project.version; execute resource_type project/resource_id project_id, replay requires current operate permission. Project version increments once per mutation. Request → user → project → sorted applications → sorted booths → assignments lock order.
- Booth fields per canonical schema, add version/timestamps; nullable table_capacity means unknown and cannot satisfy positive table_count. Extra input_booth_version on assignments guards changed resources.
- Booth update rejects blocking or making occupied booth incompatible. No deletes. Booth number unique within project; status AVAILABLE/BLOCKED, computed occupancy separately.
- Draft save replaces only pending draft rows (release previous with reason); active confirmed assignments remain. Items represent proposed changes, not whole-board deletion. Empty items clears draft. Duplicate booth/app targets reject. Source MANUAL, condition-based candidate suggestions explicitly not AI.
- Confirm applies all pending draft rows together: validate same project, CONFIRMED apps, input versions, available/compatible resources, uniqueness, and occupancy outside changed app set. Release all old assignments of changed apps, mark draft confirmed in one transaction. Support A↔B exchange without dropping unique constraints. Increment affected app versions once (content revision unchanged). Partial board is allowed and unassigned count visible.
- Separate explicit release action for an application's current assignment; cancels its pending draft too. Application cancellation does same release in existing transaction, increment board version when any assignment released. Preserve release actor/reason/history. No automatic assignment or promotion.
- Required electricity/fire/cold/vehicle and table capacity are hard conflicts. Project allowed category is checked; same-category presence in same zone is a soft warning, not invented numerical capacity policy. Suggestions never occupy resources or bypass confirm checks.
- All booth writes before event_end and not COMPLETED; CLOSED allowed. Review notes do not leak into board. No communication table yet; audit evidence only, no delivery claim.

## Stable API contract
Routes /api prefix, response {data: Board}. `booth_router(settings,identity)` in booths.py. `board_data(conn,project,role)` and `release_for_cancellation(conn,app,actor_id,reason)` in booth_domain.py. Cancellation helper assumes project+app already locked, releases sorted booth/assignment records and increments project.version only if records changed; caller increments application.version as before.

Board = {project:{project_id,name,status,event_end_at,version},role:'OPERATOR'|'REVIEWER',can_manage:boolean,booths:Booth[],applications:ConfirmedApp[],assignments:Assignment[],drafts:Assignment[],history:Assignment[],candidates:Candidate[],unassigned_count:number}.
Booth = {booth_id,project_id,booth_no,zone,electricity_available,fire_allowed,cold_storage_available,vehicle_access,table_capacity,note,status,version}; include all fields consistently.
ConfirmedApp = {application_id,version,shop_name,product_name,category,electricity_required,fire_required,cold_storage_required,vehicle_entry_required,table_count}; no contacts or raw snapshot.
Assignment = {assignment_id,application_id,booth_id,confirmed,version,input_application_version,input_booth_version,reason,assigned_at,confirmed_at,released_at,release_reason}; history bounded latest100, current active/drafts unbounded within board.
Candidate = {application_id,booth_id,compatible:boolean,conflicts:string[],warnings:string[]} (warnings may include occupancy requiring a paired move).

- GET /projects/{id}/booths -> Board (review_project read).
- POST /projects/{id}/booths, operation booths.create: {expected_version,reason,booth_no,zone:null|string,electricity_available,fire_allowed,cold_storage_available,vehicle_access,table_capacity:null|int>=0,note:null|string,status:AVAILABLE|BLOCKED}.
- PATCH /projects/{id}/booths/{booth_id}, operation booths.update: same full fields + expected_version. No extra expected_booth_version; board version guards it.
- POST /projects/{id}/booth-draft, operation booths.draft: {expected_version,reason,items:[{application_id,booth_id,expected_application_version}]} max1000, unique IDs; empty clears. Store current booth version.
- POST /projects/{id}/booth-confirm, operation booths.confirm: {expected_version,reason}; reject no pending draft.
- POST /projects/{id}/booth-release, operation booths.release: {expected_version,reason,application_id,expected_application_version}; release current and pending app assignments atomically, validate ownership/project.

## Tasks
- [x] T1 API: create booth_domain.py/booths.py/tests/test_booths.py with red→green tests. Role/privacy/replay, draft vs occupancy, conditions, stale versions, concurrent last booth, swap rollback, event bounds and cancellation helper. Root owns migration and integration.
- [x] T2 UI: /markets/[id]/booths/page.tsx, components/booths, lib/booths/form.ts, units/browser fixtures. Reuse MarketAccess/useMutation/Field/ConfirmDialog/Notice, native select with keyboard; no drag-only flow. Booth create/edit, compatible reasons, draft selections, explicit confirm/release, saved vs unsaved, 409 preserved input/current comparison, lost response/auth/404 handling. Write additive CSS output/booth-ui.css; root integrates. Agent may add links in market list/editor and review list only.
- [x] T3 Root: CLI-created migration, routers/results/relay, cancellation call+test, seller own-booth projection/UI, generated types, shared hook/CSS. Test DB keys/constraints/RLS; immutable released history.
- [x] T4 Independent spec/code review, full unit/API/browser/build, mobile/desktop evidence; apply additive migration after dry-run, docs/roadmap, commit/push feature branch.

## Review focus
1. Competing confirms of one booth: one success, no duplicate active assignments.
2. Swap partially fails: original assignments remain and no partial history/notice.
3. Cancel during draft/confirm: cancelled application cannot occupy booth; same lock order.
4. Downgrade/revocation during result recovery: operator result blocked; seller never sees others.
5. Changed capacity/flags/version after draft: confirm rejected without losing existing occupancy.

## Execution ledger
- Ruling: existing v1.3 spec and user's explicit continuation authorize implementation; retain configured checkout and use a new feature branch to keep current local services and secrets configured. Condition-based suggestions satisfy the operator path; AI integration remains separate.

- 2026-10-11 resumed: final UI resource-conflict adoption now preserves resource inputs and adopts remote draft if no local draft edits. Browser regression includes another operator changing the draft. Web units54, browser42, production build passed; remote migration applied/readback privacy and unique indexes verified.
- Final verification: npm run check passed all stages including 70 API tests; final production build passed; full browser42 passed. Ready for feature-branch commit/push; no deployment or customer assignments.
