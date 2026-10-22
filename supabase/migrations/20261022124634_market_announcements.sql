CREATE TABLE public.market_announcements (
 announcement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects,
 subject varchar(200) NOT NULL CHECK(length(trim(subject))>0),
 body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 50000),
 audience text NOT NULL CHECK(audience IN ('ALL_APPLICANTS','CONFIRMED')),
 content_version integer NOT NULL DEFAULT 1 CHECK(content_version>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 approved_version integer, approved_by uuid REFERENCES public.users, approved_at timestamptz,
 published_subject varchar(200), published_body text, published_audience text,
 published_content_version integer, published_at timestamptz,
 published_by uuid REFERENCES public.users, withdrawn_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((approved_version IS NULL AND approved_by IS NULL AND approved_at IS NULL)
   OR (approved_version IS NOT NULL AND approved_version=content_version AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK ((published_subject IS NULL AND published_body IS NULL AND published_audience IS NULL
   AND published_content_version IS NULL AND published_at IS NULL AND published_by IS NULL AND withdrawn_at IS NULL)
   OR (published_subject IS NOT NULL AND length(trim(published_subject))>0
   AND published_body IS NOT NULL AND length(trim(published_body)) BETWEEN 1 AND 50000
   AND published_audience IS NOT NULL AND published_audience IN ('ALL_APPLICANTS','CONFIRMED')
   AND published_content_version IS NOT NULL AND published_content_version>0 AND published_content_version<=content_version
   AND published_at IS NOT NULL AND published_by IS NOT NULL))
);
CREATE INDEX market_announcements_project ON public.market_announcements(project_id,created_at DESC,announcement_id);
CREATE INDEX market_announcements_published ON public.market_announcements(project_id,published_at DESC,announcement_id)
 WHERE published_at IS NOT NULL AND withdrawn_at IS NULL;
ALTER TABLE public.market_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_announcements FROM anon,authenticated;
