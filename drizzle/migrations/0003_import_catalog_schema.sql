create extension if not exists pg_trgm with schema extensions;
create table if not exists public.categories (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table if not exists public.catalogs (id uuid primary key default gen_random_uuid(), title text not null, description text not null default '', keywords text not null default '', category_id uuid references public.categories(id) on delete set null, file_path text not null, cover_path text, page_count int not null default 0, created_at timestamptz not null default now());
alter table public.catalogs add column if not exists language text not null default 'ar';
create table if not exists public.catalog_chunks (id uuid primary key default gen_random_uuid(), catalog_id uuid not null references public.catalogs(id) on delete cascade, page int not null, content text not null);
create index if not exists catalog_chunks_catalog_id_idx on public.catalog_chunks(catalog_id);
create index if not exists catalog_chunks_trgm on public.catalog_chunks using gin (lower(content) extensions.gin_trgm_ops);
grant select on public.categories, public.catalogs, public.catalog_chunks to anon, authenticated;
grant all on public.categories, public.catalogs, public.catalog_chunks to service_role;
alter table public.categories enable row level security;
alter table public.catalogs enable row level security;
alter table public.catalog_chunks enable row level security;
drop policy if exists "public read" on public.categories;
drop policy if exists "public read" on public.catalogs;
drop policy if exists "public read" on public.catalog_chunks;
create policy "public read" on public.categories for select using (true);
create policy "public read" on public.catalogs for select using (true);
create policy "public read" on public.catalog_chunks for select using (true);
create or replace function public.search_catalogs(q text) returns table(id uuid, score real) language sql stable set search_path = public, extensions as $$
  with c as (select ca.id, greatest(word_similarity(lower(q), lower(ca.title || ' ' || ca.keywords || ' ' || ca.description)), coalesce((select max(word_similarity(lower(q), lower(ch.content))) from catalog_chunks ch where ch.catalog_id = ca.id), 0) * 0.8) as score from catalogs ca)
  select id, score from c where score > 0.3 order by score desc limit 30;
$$;
create or replace function public.search_chunks(q text, lim int default 12) returns table(catalog_id uuid, title text, page int, content text, score real) language sql stable set search_path = public, extensions as $$
  select ch.catalog_id, ca.title, ch.page, ch.content, (word_similarity(lower(q), lower(ch.content)) + word_similarity(lower(q), lower(ca.title || ' ' || ca.keywords)))::real as score
  from catalog_chunks ch join catalogs ca on ca.id = ch.catalog_id order by score desc limit lim;
$$;
grant execute on function public.search_catalogs(text), public.search_chunks(text,int) to anon, authenticated, service_role;
drop policy if exists "public read catalog files" on storage.objects;
create policy "public read catalog files" on storage.objects for select to anon, authenticated using (bucket_id = 'catalogs');