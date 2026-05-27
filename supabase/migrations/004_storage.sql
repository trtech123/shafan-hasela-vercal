-- ============================================================
-- Migration 004: Storage Buckets & Policies
--
-- Run AFTER enabling Storage in Supabase dashboard.
-- Or apply via: supabase storage create <bucket>
-- ============================================================

-- ============================================================
-- BUCKET: activity-images  (public)
-- Replaces: base44.integrations.Core.UploadFile()
-- Used by: ActivityFormDialog.jsx — activity image uploads
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'activity-images',
  'activity-images',
  true,         -- publicly readable (images shown in quotes/app)
  5242880,      -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- BUCKET: documents  (private)
-- Used for: quote PDFs, order documents, billing exports
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,        -- private — requires signed URL
  10485760,     -- 10 MB per file
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STORAGE RLS: activity-images
-- ============================================================

-- Anyone can view activity images (shown in public-facing quotes)
CREATE POLICY "activity-images: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'activity-images');

-- Only admin/ops can upload activity images
CREATE POLICY "activity-images: admin/ops upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'activity-images'
    AND public.is_admin_or_ops()
  );

-- Only admin/ops can replace activity images
CREATE POLICY "activity-images: admin/ops update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'activity-images'
    AND public.is_admin_or_ops()
  );

-- Only admin/ops can delete activity images
CREATE POLICY "activity-images: admin/ops delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'activity-images'
    AND public.is_admin_or_ops()
  );

-- ============================================================
-- STORAGE RLS: documents
-- ============================================================

-- All authenticated staff can download documents
CREATE POLICY "documents: staff read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

-- Admin/ops can upload documents
CREATE POLICY "documents: admin/ops upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND public.is_admin_or_ops()
  );

-- Admin/ops can replace documents
CREATE POLICY "documents: admin/ops update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND public.is_admin_or_ops()
  );

-- Only admin can delete documents
CREATE POLICY "documents: admin delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND public.is_admin()
  );

-- ============================================================
-- FRONTEND MIGRATION NOTES (not SQL — for reference)
--
-- OLD (Base44):
--   const { file_url } = await base44.integrations.Core.UploadFile({ file });
--
-- NEW (Supabase):
--   const path = `activities/${Date.now()}-${file.name}`;
--   const { data, error } = await supabase.storage
--     .from('activity-images')
--     .upload(path, file, { upsert: false });
--   const { data: { publicUrl } } = supabase.storage
--     .from('activity-images')
--     .getPublicUrl(data.path);
--   // use publicUrl as file_url
-- ============================================================
