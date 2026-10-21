-- Published copy is independent of the mutable email draft and delivery state.
-- Existing communications RLS / revoked Data API grants remain in force.
ALTER TABLE public.communications
 ADD COLUMN published_subject varchar(200),
 ADD COLUMN published_body text,
 ADD COLUMN published_content_version integer,
 ADD COLUMN published_at timestamptz,
 ADD COLUMN published_by uuid REFERENCES public.users,
 ADD COLUMN withdrawn_at timestamptz,
 ADD CONSTRAINT communication_publication_complete CHECK (
   (published_at IS NULL AND published_subject IS NULL AND published_body IS NULL
    AND published_content_version IS NULL AND published_by IS NULL AND withdrawn_at IS NULL)
   OR (published_at IS NOT NULL AND published_subject IS NOT NULL
    AND length(trim(published_subject)) > 0 AND published_body IS NOT NULL
    AND length(trim(published_body)) > 0 AND published_content_version IS NOT NULL
    AND published_content_version > 0 AND published_content_version <= content_version
    AND published_by IS NOT NULL)
 );
CREATE INDEX communications_published ON public.communications
 (application_id, published_at DESC, communication_id)
 WHERE published_at IS NOT NULL AND withdrawn_at IS NULL;
