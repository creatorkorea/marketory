-- API/worker-only email drafts and append-preserving delivery evidence.
CREATE TABLE public.communications (
 communication_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects,
 application_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('SELECTION','WAITING','REJECTION','CONFIRM','BOOTH','NEED_INFO','NOTICE')),
 channel text NOT NULL DEFAULT 'EMAIL' CHECK(channel='EMAIL'),
 subject varchar(200) NOT NULL CHECK(length(trim(subject))>0),
 body text NOT NULL CHECK(length(trim(body))>0),
 drafted_by_ai boolean NOT NULL DEFAULT false,
 send_status text NOT NULL DEFAULT 'DRAFT' CHECK(send_status IN ('DRAFT','READY','QUEUED','SENDING','SENT','FAILED','UNKNOWN')),
 recipient_snapshot text NOT NULL CHECK(length(trim(recipient_snapshot))>0),
 sender_snapshot text,
 content_version integer NOT NULL DEFAULT 1 CHECK(content_version>0),
 approved_version integer, approved_by uuid REFERENCES public.users, approved_at timestamptz,
 context_snapshot_json jsonb NOT NULL,
 idempotency_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 sent_at timestamptz, failure_reason text,
 supersedes_id uuid, superseded_at timestamptz,
 claimed_at timestamptz, claim_token uuid,
 queued_at timestamptz, queued_by uuid REFERENCES public.users,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,application_id,communication_id),
 FOREIGN KEY(project_id,application_id) REFERENCES public.applications(project_id,application_id),
 FOREIGN KEY(project_id,application_id,supersedes_id)
   REFERENCES public.communications(project_id,application_id,communication_id),
 CHECK(supersedes_id IS DISTINCT FROM communication_id),
 CHECK((approved_version IS NULL AND approved_at IS NULL AND approved_by IS NULL)
   OR (approved_version=content_version AND approved_at IS NOT NULL AND approved_by IS NOT NULL)),
 CHECK(send_status NOT IN ('READY','QUEUED','SENDING','SENT','UNKNOWN') OR approved_version IS NOT NULL),
 CHECK(send_status!='QUEUED' OR (queued_at IS NOT NULL AND queued_by IS NOT NULL)),
 CHECK(send_status!='SENDING' OR (claimed_at IS NOT NULL AND claim_token IS NOT NULL))
);
CREATE INDEX communications_project ON public.communications(project_id,created_at DESC,communication_id);
CREATE INDEX communications_queue ON public.communications(queued_at,communication_id) WHERE send_status='QUEUED';
CREATE INDEX communications_application ON public.communications(application_id);
CREATE TABLE public.communication_attempts (
 attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 communication_id uuid NOT NULL REFERENCES public.communications,
 attempt_no integer NOT NULL CHECK(attempt_no>0),
 status text NOT NULL CHECK(status IN ('SENDING','SENT','FAILED','UNKNOWN')),
 provider_message_id text, error_code text, error_message text,
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(communication_id,attempt_no), UNIQUE(communication_id,attempt_id)
);
CREATE TABLE public.communication_resolutions (
 resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 communication_id uuid NOT NULL, attempt_id uuid NOT NULL,
 from_status text NOT NULL CHECK(from_status='UNKNOWN'),
 to_status text NOT NULL CHECK(to_status IN ('SENT','FAILED','UNKNOWN')),
 method text NOT NULL CHECK(method IN ('MANUAL_EVIDENCE','PROVIDER_QUERY')),
 outcome text NOT NULL CHECK(outcome IN ('ACCEPTED','NOT_ACCEPTED','INCONCLUSIVE')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref))>0),
 reason text NOT NULL CHECK(length(trim(reason))>0),
 resolved_by uuid NOT NULL REFERENCES public.users,
 resolved_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(communication_id,attempt_id) REFERENCES public.communication_attempts(communication_id,attempt_id)
);
CREATE FUNCTION marketory_internal.communication_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Communication history cannot be deleted' USING ERRCODE='23514';
 END IF;
 IF (NEW.communication_id,NEW.project_id,NEW.application_id,NEW.type,NEW.channel,
     NEW.idempotency_key,NEW.supersedes_id,NEW.created_at)
  IS DISTINCT FROM (OLD.communication_id,OLD.project_id,OLD.application_id,OLD.type,OLD.channel,
     OLD.idempotency_key,OLD.supersedes_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Communication identity is immutable' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT FROM public.communication_attempts WHERE communication_id=OLD.communication_id)
  AND (NEW.subject,NEW.body,NEW.recipient_snapshot,NEW.sender_snapshot,NEW.content_version,
       NEW.approved_version,NEW.approved_by,NEW.approved_at,NEW.context_snapshot_json,NEW.drafted_by_ai)
   IS DISTINCT FROM (OLD.subject,OLD.body,OLD.recipient_snapshot,OLD.sender_snapshot,OLD.content_version,
       OLD.approved_version,OLD.approved_by,OLD.approved_at,OLD.context_snapshot_json,OLD.drafted_by_ai) THEN
  RAISE EXCEPTION 'Attempted content and approval are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communication_history_guard BEFORE UPDATE OR DELETE ON public.communications
 FOR EACH ROW EXECUTE FUNCTION marketory_internal.communication_history_guard();
CREATE FUNCTION marketory_internal.communication_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='communication_resolutions' OR TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Communication evidence is append only' USING ERRCODE='23514';
 END IF;
 IF (NEW.attempt_id,NEW.communication_id,NEW.attempt_no,NEW.started_at)
 IS DISTINCT FROM (OLD.attempt_id,OLD.communication_id,OLD.attempt_no,OLD.started_at)
 OR OLD.status IN ('SENT','FAILED') THEN
  RAISE EXCEPTION 'Completed attempt is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communication_attempt_guard BEFORE UPDATE OR DELETE ON public.communication_attempts
 FOR EACH ROW EXECUTE FUNCTION marketory_internal.communication_evidence_guard();
CREATE TRIGGER communication_resolution_guard BEFORE UPDATE OR DELETE ON public.communication_resolutions
 FOR EACH ROW EXECUTE FUNCTION marketory_internal.communication_evidence_guard();
CREATE FUNCTION marketory_internal.invalidate_communications(pid uuid, aid uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE public.communications c SET
  send_status=CASE WHEN EXISTS(SELECT FROM public.communication_attempts a WHERE a.communication_id=c.communication_id) THEN 'FAILED' ELSE 'DRAFT' END,
  approved_version=CASE WHEN EXISTS(SELECT FROM public.communication_attempts a WHERE a.communication_id=c.communication_id) THEN c.approved_version END,
  approved_by=CASE WHEN EXISTS(SELECT FROM public.communication_attempts a WHERE a.communication_id=c.communication_id) THEN c.approved_by END,
  approved_at=CASE WHEN EXISTS(SELECT FROM public.communication_attempts a WHERE a.communication_id=c.communication_id) THEN c.approved_at END,
  queued_at=NULL,queued_by=NULL,claim_token=NULL,claimed_at=NULL,
  failure_reason='CONTEXT_CHANGED',version=version+1,updated_at=now()
 WHERE c.project_id=pid AND (aid IS NULL OR c.application_id=aid) AND c.send_status IN ('READY','QUEUED');
END $$;
CREATE FUNCTION marketory_internal.communication_context_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='projects' THEN
  IF NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
   PERFORM marketory_internal.invalidate_communications(NEW.project_id,NULL);
  END IF;
 ELSIF TG_TABLE_NAME='applications' THEN
  IF (NEW.version,NEW.status,NEW.notification_email,NEW.deleted_at)
    IS DISTINCT FROM (OLD.version,OLD.status,OLD.notification_email,OLD.deleted_at) THEN
   PERFORM marketory_internal.invalidate_communications(NEW.project_id,NEW.application_id);
  END IF;
 ELSE
  IF TG_OP='INSERT' THEN
   IF NEW.confirmed AND NEW.released_at IS NULL THEN
    PERFORM marketory_internal.invalidate_communications(NEW.project_id,NEW.application_id);
   END IF;
  ELSIF (OLD.confirmed AND OLD.released_at IS NULL) OR (NEW.confirmed AND NEW.released_at IS NULL) THEN
   PERFORM marketory_internal.invalidate_communications(NEW.project_id,NEW.application_id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_application_changed AFTER UPDATE ON public.applications
 FOR EACH ROW EXECUTE FUNCTION marketory_internal.communication_context_changed();
CREATE TRIGGER communications_project_changed AFTER UPDATE ON public.projects
 FOR EACH ROW EXECUTE FUNCTION marketory_internal.communication_context_changed();
CREATE TRIGGER communications_booth_changed AFTER INSERT OR UPDATE ON public.booth_assignments
 FOR EACH ROW EXECUTE FUNCTION marketory_internal.communication_context_changed();
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.communications,public.communication_attempts,public.communication_resolutions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marketory_internal.invalidate_communications(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marketory_internal.communication_history_guard(),marketory_internal.communication_evidence_guard(),marketory_internal.communication_context_changed() FROM PUBLIC,anon,authenticated;

-- A saved 202 is not terminal until delivery evidence is definitive.
CREATE OR REPLACE FUNCTION marketory_internal.idempotency_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ref record; message_status text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='EXPIRED' THEN RAISE EXCEPTION 'Cannot insert expired result' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.request_id,NEW.actor_user_id,NEW.operation,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM (OLD.request_id,OLD.actor_user_id,OLD.operation,OLD.idempotency_key,OLD.created_at) THEN
   RAISE EXCEPTION 'Request identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','EXPIRED') THEN
   IF OLD.status='EXPIRED' OR NEW.status<>'EXPIRED' THEN
    RAISE EXCEPTION 'Completed response is immutable' USING ERRCODE='23514';
   END IF;
   IF OLD.resource_type='communication' THEN
    SELECT project_id,application_id INTO ref FROM public.communications WHERE communication_id=OLD.resource_id;
    PERFORM 1 FROM public.projects WHERE project_id=ref.project_id FOR UPDATE;
    PERFORM 1 FROM public.applications WHERE application_id=ref.application_id FOR UPDATE;
    SELECT send_status INTO message_status FROM public.communications WHERE communication_id=OLD.resource_id FOR UPDATE;
    IF message_status IS NULL OR message_status NOT IN ('SENT','FAILED') OR EXISTS(
     SELECT FROM public.communication_attempts WHERE communication_id=OLD.resource_id AND status IN ('SENDING','UNKNOWN')) THEN
     RAISE EXCEPTION 'Resource is not confirmed terminal' USING ERRCODE='23514';
    END IF;
   ELSIF OLD.resource_type IS NOT NULL AND OLD.resource_type NOT IN
    ('user','project','seller','application','review_application_operator','review_application_reviewer') THEN
    RAISE EXCEPTION 'Resource is not confirmed terminal' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.status='EXPIRED' THEN
   RAISE EXCEPTION 'Only completed results can expire' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
