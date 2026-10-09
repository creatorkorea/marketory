-- Review results are synchronous, but retain their role-specific resource boundary.
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
      IF OLD.resource_type IS NOT NULL AND OLD.resource_type NOT IN ('user','project','seller','application',
        'review_application_operator','review_application_reviewer') THEN
        RAISE EXCEPTION 'Resource is not confirmed terminal' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.status='EXPIRED' THEN
      RAISE EXCEPTION 'Only completed results can expire' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX audit_application_history ON public.audit_logs(project_id,entity_id,created_at) WHERE entity_type='application';
