-- Private resources and append-preserving assignment history; API is the access boundary.
CREATE TABLE public.booths (
  booth_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects,
  booth_no varchar(30) NOT NULL CHECK(length(trim(booth_no)) > 0),
  zone varchar(50), electricity_available boolean NOT NULL DEFAULT false,
  fire_allowed boolean NOT NULL DEFAULT false, cold_storage_available boolean NOT NULL DEFAULT false,
  vehicle_access boolean NOT NULL DEFAULT false,
  table_capacity integer CHECK(table_capacity >= 0),
  note text, status varchar(20) NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','BLOCKED')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,booth_no), UNIQUE(project_id,booth_id)
);
CREATE INDEX booths_project_status ON public.booths(project_id,status);

CREATE TABLE public.booth_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects,
  booth_id uuid NOT NULL, application_id uuid NOT NULL,
  source varchar(20) NOT NULL CHECK(source IN ('AI_RECOMMENDED','MANUAL')),
  reason text, assigned_by uuid REFERENCES public.users,
  confirmed boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
  released_at timestamptz, released_by uuid REFERENCES public.users, release_reason text,
  input_application_version integer NOT NULL CHECK(input_application_version > 0),
  input_booth_version integer NOT NULL CHECK(input_booth_version > 0),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  operation_id uuid NOT NULL,
  FOREIGN KEY(project_id,application_id) REFERENCES public.applications(project_id,application_id),
  FOREIGN KEY(project_id,booth_id) REFERENCES public.booths(project_id,booth_id),
  CHECK(NOT confirmed OR (confirmed_at IS NOT NULL AND assigned_by IS NOT NULL)),
  CHECK(released_at IS NULL OR (released_by IS NOT NULL AND release_reason IS NOT NULL
    AND length(trim(release_reason)) > 0))
);
CREATE UNIQUE INDEX booth_active_once ON public.booth_assignments(booth_id)
  WHERE confirmed AND released_at IS NULL;
CREATE UNIQUE INDEX application_active_booth_once ON public.booth_assignments(application_id)
  WHERE confirmed AND released_at IS NULL;
CREATE INDEX booth_assignment_board ON public.booth_assignments(project_id,assigned_at);
CREATE INDEX booth_assignment_application ON public.booth_assignments(application_id)
  WHERE released_at IS NULL;

CREATE FUNCTION marketory_internal.booth_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Assignment history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'Released assignment is immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.assignment_id,NEW.project_id,NEW.application_id,NEW.booth_id,NEW.source,
      NEW.assigned_at,NEW.input_application_version,NEW.input_booth_version,NEW.operation_id)
    IS DISTINCT FROM
     (OLD.assignment_id,OLD.project_id,OLD.application_id,OLD.booth_id,OLD.source,
      OLD.assigned_at,OLD.input_application_version,OLD.input_booth_version,OLD.operation_id) THEN
    RAISE EXCEPTION 'Assignment identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.confirmed AND (NOT NEW.confirmed OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'Confirmed assignment must be released, not rewritten' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booth_history_guard BEFORE UPDATE OR DELETE ON public.booth_assignments
FOR EACH ROW EXECUTE FUNCTION marketory_internal.booth_history_guard();

ALTER TABLE public.booths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booth_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booths,public.booth_assignments FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marketory_internal.booth_history_guard() FROM PUBLIC,anon,authenticated;
