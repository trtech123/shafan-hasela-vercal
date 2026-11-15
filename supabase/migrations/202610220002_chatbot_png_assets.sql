-- Add PNG only to the existing private bot asset bucket; preserve old objects.
UPDATE storage.buckets SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id = 'chatbot-assets' AND public = false;
