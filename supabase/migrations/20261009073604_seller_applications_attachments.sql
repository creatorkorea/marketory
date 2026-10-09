-- Private application data is accessed through the authenticated API only.
ALTER TABLE public.sellers ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);

CREATE TABLE public.applications (
  application_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects,
  seller_id uuid NOT NULL REFERENCES public.sellers,
  status varchar(30) NOT NULL DEFAULT 'DRAFT' CHECK(status IN
    ('DRAFT','SUBMITTED','NEED_INFO','REVIEWING','APPROVED','WAITING','REJECTED','CONFIRMED','CANCELLED')),
  product_name varchar(150), product_desc text, price_range varchar(80), category varchar(50),
  electricity_required boolean NOT NULL DEFAULT false,
  table_count integer NOT NULL DEFAULT 0 CHECK(table_count BETWEEN 0 AND 100),
  fire_required boolean NOT NULL DEFAULT false,
  cold_storage_required boolean NOT NULL DEFAULT false,
  vehicle_entry_required boolean NOT NULL DEFAULT false,
  request_note text,
  submitted_at timestamptz, last_submitted_at timestamptz, confirmed_at timestamptz,
  cancel_reason text,
  revision_no integer NOT NULL DEFAULT 1 CHECK(revision_no > 0),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  seller_snapshot_json jsonb, policy_version integer,
  consent_json jsonb, info_requests_json jsonb, info_due_at timestamptz,
  confirm_due_at timestamptz, waiting_rank integer CHECK(waiting_rank > 0),
  notification_email varchar(255), notification_email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(project_id,seller_id), UNIQUE(project_id,application_id),
  CHECK(status <> 'NEED_INFO' OR (info_due_at IS NOT NULL AND info_requests_json IS NOT NULL)),
  CHECK(status <> 'CANCELLED' OR (cancel_reason IS NOT NULL AND length(trim(cancel_reason)) > 0)),
  CHECK(status IN ('DRAFT','CANCELLED') OR
    (submitted_at IS NOT NULL AND seller_snapshot_json IS NOT NULL AND policy_version IS NOT NULL
     AND consent_json IS NOT NULL AND notification_email IS NOT NULL
     AND notification_email_verified_at IS NOT NULL
     AND product_name IS NOT NULL AND product_desc IS NOT NULL
     AND price_range IS NOT NULL AND category IS NOT NULL
     AND length(trim(product_name)) > 0 AND length(trim(product_desc)) > 0
     AND length(trim(price_range)) > 0 AND length(trim(category)) > 0))
);
CREATE INDEX applications_project_status ON public.applications(project_id,status);
CREATE INDEX applications_seller_created ON public.applications(seller_id,created_at DESC,application_id);

CREATE TABLE public.application_status_history (
  history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications,
  from_status varchar(30), to_status varchar(30) NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.users,
  reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_history_order ON public.application_status_history(application_id,created_at);

CREATE TABLE public.attachments (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_type varchar(30) NOT NULL CHECK(file_type IN ('PRODUCT_IMAGE','BUSINESS_DOC','ETC')),
  storage_key varchar(1000) NOT NULL UNIQUE,
  original_name varchar(255) NOT NULL, mime_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 10485760),
  seller_id uuid REFERENCES public.sellers,
  application_id uuid REFERENCES public.applications,
  uploaded_by uuid NOT NULL REFERENCES public.users,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CHECK((seller_id IS NULL) <> (application_id IS NULL))
);
CREATE INDEX application_active_attachments ON public.attachments(application_id,file_type)
  WHERE deleted_at IS NULL;

CREATE TABLE public.upload_intents (
  upload_intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  application_id uuid REFERENCES public.applications,
  seller_id uuid REFERENCES public.sellers,
  field_code text NOT NULL CHECK(field_code IN ('product_images','business_document')),
  requested_by uuid NOT NULL REFERENCES public.users,
  expected_application_version integer,
  expected_revision_no integer,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 10485760),
  max_size_bytes bigint NOT NULL CHECK(max_size_bytes > 0 AND max_size_bytes <= 10485760),
  status varchar(20) NOT NULL DEFAULT 'ISSUED'
    CHECK(status IN ('ISSUED','COMPLETED','EXPIRED','REJECTED')),
  expires_at timestamptz NOT NULL,
  attachment_id uuid UNIQUE REFERENCES public.attachments,
  content_sha256 text,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((seller_id IS NULL) <> (application_id IS NULL)),
  CHECK(application_id IS NULL OR
    (expected_application_version IS NOT NULL AND expected_application_version > 0
     AND expected_revision_no IS NOT NULL AND expected_revision_no > 0)),
  CHECK((content_sha256 IS NULL) = (uploaded_at IS NULL)),
  CHECK(status <> 'COMPLETED' OR attachment_id IS NOT NULL)
);
CREATE INDEX application_pending_uploads ON public.upload_intents(application_id,status);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applications,public.application_status_history,public.attachments,
  public.upload_intents FROM PUBLIC,anon,authenticated;

-- Synchronous seller/application results can expire after the approved retention period.
-- This does not activate an expiry job and does not relax the guard for async resources.
CREATE OR REPLACE FUNCTION marketory_internal.idempotency_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
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
      IF OLD.resource_type IS NOT NULL AND OLD.resource_type NOT IN ('user','project','seller','application') THEN
        RAISE EXCEPTION 'Resource is not confirmed terminal' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.status='EXPIRED' THEN
      RAISE EXCEPTION 'Only completed results can expire' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
