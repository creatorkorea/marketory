# Seller applications and private attachments implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with scoped tasks and independent review. Existing v1.3 requirements and the user's “다음 진행” authorize this implementation; do not repeat approval for the already selected flow.

**Goal:** A seller can save a profile, discover a published market by link, save one draft per market, attach verified private files sequentially, submit with policy consent, and read/cancel their own application.
**Architecture:** Existing Next.js → allowlisted FastAPI relay, Supabase Auth/Postgres, existing idempotency transaction. Private Storage writes go through authenticated FastAPI binary upload (direct browser → API, avoiding Vercel request-size limits), followed by explicit attachment completion. No public bucket or client service key.
**Tech Stack:** Existing Next.js/React, FastAPI/Pydantic/psycopg, Supabase Storage REST, Pillow image validation.
**Spec:** docs/reference/00-common-contract.md, 03-features.md (SEL-001~003, APP-001~006, ATT), 04-data-model.md, 05-development.md §§17–20, 06-screens.md SCR-03/08, UX-CONTRACT.md.

## Global constraints
- User-role authorization comes from DB; ownership from authenticated user ID, never phone or request body.
- One application per project/seller, including cancelled/deleted records. No external customer emails, AI decisions, deployment or fabricated real market.
- Every mutation uses immutable Idempotency-Key, version guard, transaction/audit; application content/attachments increment revision and version. Status only increments version.
- KST event limits, recruitment start/end, consent policy version, profile/email snapshot and NEED_INFO field/deadline rules enforced server-side.
- Product images jpg/png/webp up to 10, business evidence PDF/image up to 1; 10 MiB each. Actual bytes checked, immutable object keys, private bucket.
- No cleanup deletion until retention policy is approved. Failed/unlinked objects remain marked for later cleanup.
- Preserve existing tests and routes; generated reference docs are not edited. Secrets never enter logs, Git, frontend or URLs.

## Stable interfaces

All JSON success replies `{data: ...}`. Mutations accept Idempotency-Key UUID. Errors use existing DomainError.

Profile `GET /api/me/seller` → data null or `{seller_id,user_id,name,shop_name,owner_name,phone,business_no,sns_url,base_category,base_product_desc,version}`. POST/PATCH same path, operation `sellers.save`: those editable fields plus expected_version (0 creates, >0 updates). Server-owned roles/email never accepted.

Applications: POST `/api/applications` body `{project_id}`, operation `applications.create`; GET `/api/me/applications?limit=20&offset=0&project_id?` → list; GET `/api/applications/{id}` → safe seller fields, `project` public projection, `attachments` metadata without keys, `allowed_actions`, version/revision; PATCH same ID operation `applications.update`, `{expected_version,product_name,product_desc,price_range,category,electricity_required,table_count,fire_required,cold_storage_required,vehicle_entry_required,request_note}`. POST `/{id}/submit` operation `applications.submit`: `{expected_version,expected_policy_version,consent_version,consent_accepted:true}`; `resubmit` same fields/operation `applications.resubmit`; `cancel` body `{expected_version,reason}` operation `applications.cancel`. POST validate may be read-only. All mutation data returns full application detail shape (including current attachments/project), so UI advances versions from committed replies. Initial submission requires profile, product_name/desc/price/category, allowed category, requested photos/evidence, no pending upload, current policy consent; return 422 with actionable details. NEED_INFO only requested fields, deadline and RECRUITING/REVIEWING. Ownership read remains allowed after event closure; mutations do not.

Backend shared helper in `application_domain.py`: `require_application(conn, actor_id, application_id, action="read") -> (application, project, seller)` with owner-only authorization (storage read of staff handled separately by root if needed). Lock order active user → project → application; stable read to discover project first, then lock/re-read. `editable_application(app, project, fields: set[str])` checks DRAFT recruitment or permitted NEED_INFO/deadline and raises DomainError. `application_data(conn, app, project, seller)` returns allowlisted detail. `application_audit(conn, actor_id, app, action, before, after, reason)` records audit. Routers `seller_router(settings, identity)` and `application_router(settings, identity)`, no /api prefix (root includes them).

Uploads: GET `/api/attachments/policy` public limits; POST `/api/attachments/upload-url`, operation `attachments.issue`: `{application_id,field_code:"product_images"|"business_document",original_name,mime_type,size_bytes,expected_version,expected_revision_no}` → `{upload_intent_id,upload_url,expires_at,application_version,revision_no}`. Authenticated PUT upload_url with raw bytes and Content-Type, immutable per intent and no application revision change. POST `/api/attachments/complete`, operation `attachments.complete`: `{upload_intent_id,expected_version,expected_revision_no}` → `{attachment_id,application_version,revision_no}`; POST `/api/attachments/{id}/detach`, operation `attachments.detach`: `{expected_version,reason}` → same versions. GET `/api/attachments/{id}/download` → `{url,expires_in}` after current rights check. Attachments list `{attachment_id,file_type,original_name,mime_type,size_bytes}`. Version-conflicted upload intent cannot be re-based silently; discard pending selection, reload and explicitly upload anew. On submission with pending issued intents reject; `POST /api/attachments/uploads/{intent_id}/abandon` with `{expected_version}` operation `attachments.abandon` marks rejected, without deleting objects, so user can resolve an unsuccessful selection.

## Tasks and ownership
- [x] T1 Database + profile/application API: migration owned by coordinator; `sellers.py`, `applications.py`, `application_domain.py`, tests owned by backend implementer. Red → green for profile ownership, same-market race, draft/submit snapshots, consent stale, deadlines, status rules, redaction, version/revision, revoked replay.
- [x] T2 Private attachment API/storage: coordinator owns config/auth additions, migration, `attachments.py`, `storage.py`, relay and router integration. Red → green for MIME spoof, oversize, owner/state/version drift between issue/complete, no overwrite, expired intent, same complete replay, sequential 10 files, detach/abandon and inaccessible private URLs.
- [x] T3 Seller/public UI: frontend implementer owns `/seller/profile`, `/p/[id]`, `/p/[id]/apply`, `/me/applications`, `/me/applications/[id]`, shared seller components and recovery extension; profile → products/photos → operating conditions → consent review wizard, honest errors/empty/loading/retry, restore draft, responsive/keyboard/no duplicate submit.
- [x] T4 Integration/review: coordinator generates types; full API+DB/web+browser/build/audit; independent code review; local actual provider check without real applications; document exact proof and remaining deployment/retention boundaries.

## Review focus
1. Same key after response loss and refresh cannot create another profile/application/file.
2. Another tab changes application or policy during upload; old intent must fail rather than attach to wrong revision.
3. Metadata falsely claims image or PDF; actual bytes and size checked, public storage never enabled.
4. Cancel/submit/end-time after issuance blocks completion; existing snapshots remain immutable.
5. Session/account change clears prior sensitive state; URL never contains contact data/tokens/body; browser history keeps unsaved guard.

## Execution ledger
- Planning: continued from approved v1.3 contracts; no new business policy or visual direction. Storage binary transfer chosen from allowed server-validation option.
- Ruling: work in existing configured checkout on feature branch `codex/seller-applications` to retain local Auth/API/DB setup and keep main intact; distinct file ownership prevents concurrent edits. No production data creation for visual testing.

- Verification: full check passed (40 web unit + 50 API/DB tests, types/assets/Ruff); production build passed. Browser suite 22/22 passed with test-only provider/API fixtures, including 2-file strict sequencing and upload-conflict form synchronization. Subsequent file-role and expired/cancelled-upload regression checks are recorded in docs/SELLER-APPLICATIONS.md.
- Independent review: resolved internal waiting-rank exposure, PATCH field-presence hashing and stale uncontrolled form rebase; also fixed PDF structural validation, private-bucket enforcement, upload network/DB-lock separation and request lookup lock ordering.
- External proof: applied only the new migration to existing Supabase; verified RLS/direct-role denies, private bucket configuration, synthetic 76-byte object upload/read/signed GET 200 and public GET 400. No real application/attachment business rows created. API restarted; readiness and public policy through Next relay both return 200.
- Boundaries: no Vercel/Render deployment, actual-seller submission E2E or 10-file browser run claimed; no retention cleanup enabled. Operator review/confirmation and email explicit synchronization remain subsequent work.
