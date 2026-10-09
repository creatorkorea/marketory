-- Supabase auth.users and anon/authenticated roles must already exist.
CREATE SCHEMA IF NOT EXISTS marketory_internal;
REVOKE ALL ON SCHEMA marketory_internal FROM PUBLIC;

CREATE TABLE public.users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  email varchar(255) NOT NULL UNIQUE,
  name varchar(80), phone varchar(30),
  global_role varchar(30) NOT NULL DEFAULT 'USER' CHECK (global_role IN ('USER','PLATFORM_ADMIN')),
  account_role varchar(20) NOT NULL DEFAULT 'SELLER' CHECK (account_role IN ('SELLER','STAFF')),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  profile_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.projects (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL, event_date date NOT NULL, venue varchar(255) NOT NULL,
  recruit_start_at timestamptz NOT NULL, recruit_end_at timestamptz NOT NULL,
  event_end_at timestamptz NOT NULL,
  target_team_count integer NOT NULL CHECK (target_team_count > 0),
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','RECRUITING','REVIEWING','CLOSED','COMPLETED')),
  policy_json jsonb NOT NULL, booth_policy_json jsonb, evaluation_policy_json jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users,
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recruit_start_at < recruit_end_at AND recruit_end_at <= event_end_at)
);
CREATE TABLE public.project_members (
  project_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects,
  user_id uuid NOT NULL REFERENCES public.users,
  role varchar(30) NOT NULL CHECK (role IN ('OPERATOR','REVIEWER','VIEWER')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,user_id)
);
CREATE FUNCTION marketory_internal.check_staff_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.users WHERE user_id=NEW.user_id AND account_role='STAFF') THEN
    RAISE EXCEPTION 'Project members must be STAFF' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_member_staff BEFORE INSERT OR UPDATE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION marketory_internal.check_staff_member();

CREATE TABLE public.sellers (
  seller_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users,
  shop_name varchar(150) NOT NULL, owner_name varchar(80) NOT NULL, phone varchar(30) NOT NULL,
  business_no varchar(30), sns_url varchar(500), base_category varchar(50), base_product_desc text,
  no_show_count integer NOT NULL DEFAULT 0 CHECK(no_show_count >= 0), operation_note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_logs (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects, actor_user_id uuid REFERENCES public.users,
  action varchar(80) NOT NULL, entity_type varchar(40) NOT NULL, entity_id uuid,
  before_json jsonb, after_json jsonb, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.api_idempotency (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users,
  operation varchar(80) NOT NULL, idempotency_key uuid NOT NULL, request_hash text,
  status varchar(20) NOT NULL CHECK(status IN ('IN_PROGRESS','SUCCEEDED','FAILED','EXPIRED')),
  response_json jsonb, http_status integer, resource_type varchar(40), resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  expired_at timestamptz,
  UNIQUE(actor_user_id,operation,idempotency_key),
  CHECK ((resource_type IS NULL) = (resource_id IS NULL)),
  CHECK (
    (status='EXPIRED' AND expired_at IS NOT NULL AND request_hash IS NULL
      AND response_json IS NULL AND http_status IS NULL AND resource_type IS NULL AND resource_id IS NULL)
    OR (status='IN_PROGRESS' AND request_hash IS NOT NULL AND expired_at IS NULL)
    OR (status IN ('SUCCEEDED','FAILED') AND request_hash IS NOT NULL AND response_json IS NOT NULL
      AND expired_at IS NULL AND http_status IS NOT NULL
      AND ((status='SUCCEEDED' AND http_status BETWEEN 200 AND 299)
        OR (status='FAILED' AND http_status BETWEEN 400 AND 499)))
  )
);
CREATE FUNCTION marketory_internal.idempotency_transition() RETURNS trigger
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
      -- Async resource support must be explicitly added with terminal/UNKNOWN checks.
      IF OLD.resource_type IS NOT NULL AND OLD.resource_type NOT IN ('user','project') THEN
        RAISE EXCEPTION 'Resource is not confirmed terminal' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.status='EXPIRED' THEN
      RAISE EXCEPTION 'Only completed results can expire' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER idempotency_transition BEFORE INSERT OR UPDATE ON public.api_idempotency
FOR EACH ROW EXECUTE FUNCTION marketory_internal.idempotency_transition();
CREATE FUNCTION marketory_internal.idempotency_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT FROM public.api_idempotency WHERE request_id=NEW.request_id AND status='IN_PROGRESS') THEN
    RAISE EXCEPTION 'IN_PROGRESS cannot commit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER idempotency_final AFTER INSERT OR UPDATE ON public.api_idempotency
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketory_internal.idempotency_final();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users,public.projects,public.project_members,public.sellers,
  public.audit_logs,public.api_idempotency FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA marketory_internal FROM PUBLIC,anon,authenticated;
CREATE INDEX project_members_user_active ON public.project_members(user_id,project_id) WHERE active;
