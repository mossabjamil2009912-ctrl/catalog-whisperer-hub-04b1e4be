DROP POLICY IF EXISTS "public read" ON public.catalog_chunks;
DROP POLICY IF EXISTS "public read" ON public.categories;
DROP POLICY IF EXISTS "public read" ON public.catalogs;
DROP POLICY IF EXISTS "public read catalog files" ON storage.objects;
REVOKE ALL ON public.catalog_chunks, public.categories, public.catalogs FROM anon, authenticated;
GRANT ALL ON public.catalog_chunks, public.categories, public.catalogs TO service_role;