# Communications implementation plan

> Use superpowers:subagent-driven-development with API, worker/provider and UI ownership. User approved continued P7 implementation from existing v1.3; execute without repeat permission for established contracts.

**Goal:** Per-recipient editable template drafts, approval, separate queue request, worker delivery, attempt history, safe retry and evidence-based UNKNOWN resolution.
**Architecture:** FastAPI existing execute transaction; new communications/attempts/resolutions private tables; Resend HTTP adapter, disabled-by-default worker dispatch; Next shared UI. No AI/exports this slice. No real customer mail or live worker during development.
**Spec:** docs/reference/04-data-model.md §§7/13–16; 05-development.md §§16–19; MSG001–006 and E2E19/20/29/30/35/36/37/39/43; UX-CONTRACT.md.

## Invariants
- Operator/admin only full communication APIs. Reviewer/viewer denied. Seller own SENT history only later; no need to expose drafts in owner DTO this slice.
- DRAFT→approve READY only; send/retry→QUEUED202 only; worker QUEUED→SENDING→SENT/FAILED/UNKNOWN. SENT means provider accepted, not read/delivered. No provider call from API.
- All writes expected_version+Idempotency-Key, audit and saved result atomic. Use resource_type communication for successful message writes (root handles terminal expiry); generate failures may use project target. Reads/replay current operate rights.
- Locks requestkey→activeactor→project→application→communication; worker same project/app/message order, queued_by current rights. Network outside transaction. Claim tokens checked at completion. Stale SENDING→UNKNOWN, invalidate token, never automatic retry.
- Context snapshot includes application version/status/notification_email, project policy_version, current active booth assignment ID/version. Eligibility: SELECTION APPROVED; WAITING WAITING; REJECTION REJECTED; CONFIRM CONFIRMED; BOOTH CONFIRMED+activebooth; NEED_INFO NEED_INFO; NOTICE submitted nonDRAFT/nonCANCELLED. At approve/send/retry/claim require same context + type eligibility; revise rebuilds context explicitly.
- DB triggers root invalidates READY/QUEUED on application version, booth assignment changes, project policy_version changes. Noattempt→DRAFT clearapproval/queue; hasattempt→FAILED/CONTEXT_CHANGED preserve immutablecontent/approval, clearqueue. SENDING/UNKNOWN untouched. Context validation still mandatory on worker claim.
- Revise noattempt DRAFT/READY/QUEUED: same ID content_version+1 andversion+1; refreshrecipient/context, clearapproval/queue. With attempts FAILED/SENT or QUEUEDretry: create new DRAFT new provider key supersedes_id; original superseded_at+version, QUEUED→FAILED/CONTEXT_CHANGED. SENDING/UNKNOWN revise409. Nonblankreason always, especially SENTadditionalnotice.
- Retry only FAILED with valid approval/context, notsuperseded; same recipient/content/providerkey. UNKNOWN must resolve first. Resend keys expire24h; worker rejects re-call beyond conservative23h from firstattempt as FAILED/PROVIDER_KEY_EXPIRED and requires new reviewed draft.
- Resolve UNKNOWN only currentattempt: method MANUAL_EVIDENCE (UI/operator evidence) supported; PROVIDER_QUERY must not blindly trust clientclaim, reject if no actualqueryimplementation. ACCEPTED→SENT; NOT_ACCEPTED→FAILED; INCONCLUSIVE→UNKNOWN. Recordattempt/fromto/evidence/reason/actor. Allowed aftereventend currentrights. No retry UNKNOWN.
- EMAIL only production channel, plain text body. Template generation deterministic and drafted_by_ai=false. No SMTP key retrieval/reuse. New private Resendkey requested user; check presence only, never print. Default email_delivery_enabled=false; live worker explicit env opt-in. Tests inject provider fake; no fake provider in productionconfig.

## Shared tables (root creates migration)
communications canonical fields: communication_id UUIDPK,project_id,application_id,type,channel EMAIL,subject200,body, drafted_by_ai false,send_status,recipient_snapshot,sender_snapshot nullable until first claim then immutable,content_version1,approved_version/by/at,context_snapshot_json,provider idempotency_key UUIDunique,version1,sent_at,failure_reason,supersedes_id,superseded_at,claimed_at,claim_token,queued_at,queued_by,created_at,updated_at. CompositeFK(project,application), supersedes sameproject/application enforced.
communication_attempts: attempt_idPK,communication_idFK,attempt_no,status SENDING/SENT/FAILED/UNKNOWN,provider_message_id,error_code,error_message,started_at,completed_at; unique(comm,attempt_no), unique(comm,attempt_id).
communication_resolutions: resolution_idPK,communication_id,attempt_id compositeFK,from_status,to_status,method,outcome,evidence_ref,reason,resolved_by, resolved_at.

## Stable API and helper contracts
API agent owns communications.py + communication_domain.py + tests/test_communications.py.
`communication_router(settings,identity)`; `require_communication(conn,actor,cid)->(message,app,project)` locks &operate; `communication_context(conn,app,project)->dict` JSON serializable; `validate_context(conn,message,app,project)` raisesDomainError; `communication_data(conn,message)->dict` below.
GET /projects/{id}/communications?limit=20&offset=0 -> {data:{items:Message[],total,limit,offset,project:{project_id,name},delivery_enabled:boolean}}. Each Message includes attempts/resolutions for detail only (list may []), allowed_actions. GET /communications/{id}-> {data:Message}. GET /projects/{id}/communication-targets -> {data:{items:[{application_id,shop_name,status,notification_email,has_booth}],project:{project_id,name}}} onlyeligible submittednoncancelled.
Message = canonical publicfields excluding claim_token/provideridempotency_key; includes communication_id,project_id,application_id,type,channel,subject,body,send_status,recipient_snapshot,version,content_version,approved_version,approved_at,sent_at,failure_reason,supersedes_id,superseded_at,created_at,updated_at,allowed_actions:string[],attempts:Attempt[],resolutions:Resolution[]. allowed_actions revise/approve/send/retry/resolve; servereligibility; UI can also guardpending.
POST /communications/generate op communications.generate: {project_id,application_id,type,subject?:string,body?:string,reason}; no expectedversion becausecreate but appcontextlocked; deterministic template when subject/body omitted. Response201Message. Body/subject provided mustnonblank; no arbitraryrecipient input.
POST /communications/{id}/approve op communications.approve: {expected_version,content_version,reason}->MessageREADY.
POST /communications/{id}/send and /retry ops communications.send/retry: {expected_version,reason}->202MessageQUEUED; allowqueue independentworkerflag, UI clearly shows delivery_enabled (defaultfalse) and workerrequired; no fake success.
POST /communications/{id}/revise op communications.revise: {expected_version,subject,body,reason}->Message (newid ifattempts).
POST /communications/{id}/resolve op communications.resolve: {expected_version,attempt_id,method:MANUAL_EVIDENCE,outcome:ACCEPTED|NOT_ACCEPTED|INCONCLUSIVE,evidence_ref,reason}->Message.

Worker agent owns communication_worker.py,email_provider.py, worker.py, config.py, tests/test_communication_worker.py +test_email_provider.py, apps/api/.env.example (no real .env). `process_one(settings,provider=None)->bool`, `recover_stale(settings)->int`. With injectedprovider allowtestssettingsenabled; default noqueueclaim until enabled. Provider interface asyncsend(message:dict)->DeliveryResult withstatus/provider_message_id/error_code; strict errorclassification network/5xx=>UNKNOWN; definitivevalidation4xx=>FAILED;2xxvalidid=>SENT. Resend uses https://api.resend.com/emails, text body, email_from and sameidempotencyheader; httpx timeout bounded. No loggingbody/recipient/key. Settings resend_api_key SecretStr, email_from='마켓토리 <marketory@send.creatorkorea.org>', email_delivery_enabled=false, email_timeout_seconds=15, email_claim_timeout_seconds=120 (must>requesttimeout). Existing workerprobe tests remainvalid; main loop dispatch viaaddedoptionalhandler and separateprobe. --once may processone onlyenabled; neverrunlive inthis task.

## Tasks
- [x] T1 API+domain tests red→green: state separation, permission/replay, immutableattempt revise, invalidation, UNKNOWNresolve, stale/context/eventbounds.
- [x] T2 Worker+Resend adapter tests: approve neverclaim, concurrencyoneclaim, queuedcurrentauth/context, networkunknown, staleclaimrecovery/latefencing, retry24hcap, injectedfailures. No externalcalls.
- [x] T3 UI /markets/[id]/communications page + inline detail (separate deep link deferred to preserve shared mutation recovery scope); components/communications,lib/communications/form.ts, tests units/browser. Templates target+type, edit+approve+explicit send confirm, history refresh, retry/resolveevidence, versionconflictinputpreserve/samenonce recovery, reviewerdenial, mobilekeyboard. Rootsharedrelay/hooks/CSS; output/communications-ui.css agentartifact. May linkreviewlist/boothboard.
- [x] T4 Root migration/router/permissions/expiry/triggerintegration/types, localfullcheck/build/browser, independentreview, remoteadditivemigrationafterdryrun, docs/commit/push. No actualmail/customermutations/deployment. Missinglivekeydoesnotblockcodedprovider/mockvalidation butreportliveverificationpending.

## Review focus
Queue edit vs worker; cancelledapp/changedbooth beforeclaim zero provider calls; stale worker cannot markrecoveredUNKNOWNsent; attemptcontentimmutable; APIandproviderkeyseparate; crossprojectsupersedes/attemptresolve; SMTPauthkeyleftuntouched.

## Ledger
- Ruling: user-approvedexistingv1.3; reuse configuredcheckout featurebranch codex/communications from29b8e4e. Templateoperatorpath first; no invented AI success. Liveemailflag remainsfalse evenif userprovideskey until explicitsendworkflow used.

## 2026-10-12 continuation
- Backend implemented; pending final targeted verification and eligibility-action review fix.
- Sender is snapshotted before first attempt to keep retry payload stable. Ambiguous HTTP409 provider responses use UNKNOWN.
- Implement tasks sequentially; schema/router/result/expiry integration moved into backend task for executable tests.
- Resend key presence/format and gitignore confirmed locally; actual provider authentication/send not verified. Delivery remains disabled.

## Verification ledger
2026-10-12: API110passed, web63passed, browser50passed, types/Ruff/build/docs pass. API/worker/UI task reviews pass, final crosslayer review no P1/P2; small UNKNOWN selection reset in final fix wave. Real communications migration applied, RLS3/clientgrants0/securityadvisors0. Delivery disabled; no real mail/deployment.

Final fix: UNKNOWN selection resets across messages, preserving same-record unsaved comparison intent. Fresh build and communications browser9passed; fullbrowser50 prior, API110/web63 unchanged. All task and final reviews clean; commit/push is the closing step.
