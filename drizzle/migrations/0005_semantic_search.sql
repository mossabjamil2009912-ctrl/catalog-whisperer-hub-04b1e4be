CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
ALTER TABLE public.catalog_chunks ADD COLUMN IF NOT EXISTS embedding extensions.vector(3072);
CREATE TABLE public.catalog_profiles (
  catalog_id uuid PRIMARY KEY REFERENCES public.catalogs(id) ON DELETE CASCADE,
  summary_ar text NOT NULL DEFAULT '',
  summary_en text NOT NULL DEFAULT '',
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding extensions.vector(3072),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.catalog_profiles TO service_role;
ALTER TABLE public.catalog_profiles ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding extensions.vector(3072), lim integer DEFAULT 12)
RETURNS TABLE(catalog_id uuid, title text, page integer, content text, score real)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT ch.catalog_id, c.title, ch.page, ch.content, (1 - (ch.embedding <=> query_embedding))::real
  FROM public.catalog_chunks ch JOIN public.catalogs c ON c.id = ch.catalog_id
  WHERE ch.embedding IS NOT NULL
  ORDER BY ch.embedding <=> query_embedding LIMIT lim;
$$;
CREATE OR REPLACE FUNCTION public.match_profiles(query_embedding extensions.vector(3072), lim integer DEFAULT 8)
RETURNS TABLE(catalog_id uuid, title text, summary_en text, summary_ar text, specs jsonb, score real)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT p.catalog_id, c.title, p.summary_en, p.summary_ar, p.specs, (1 - (p.embedding <=> query_embedding))::real
  FROM public.catalog_profiles p JOIN public.catalogs c ON c.id = p.catalog_id
  WHERE p.embedding IS NOT NULL
  ORDER BY p.embedding <=> query_embedding LIMIT lim;
$$;
REVOKE EXECUTE ON FUNCTION public.match_chunks(extensions.vector, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_profiles(extensions.vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks(extensions.vector, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_profiles(extensions.vector, integer) TO service_role;