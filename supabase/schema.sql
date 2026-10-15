-- F&A Sales Consulting: Anfragen & Bewerbungen (Supabase / Postgres)
-- Einmal im Supabase-Dashboard unter "SQL Editor" ausführen.
-- Besucher dürfen NUR neue Einträge anlegen. Lesen, ändern, löschen darf nur, wer als Admin eingeloggt ist.

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('setter', 'partner')),
  name          text not null check (char_length(name)  between 1 and 200),
  email         text not null check (char_length(email) between 3 and 254),
  phone         text not null check (char_length(phone) between 5 and 40),
  company       text check (char_length(company) <= 200),
  message       text check (char_length(message) <= 4000),
  data          jsonb not null default '{}'::jsonb,
  status        text not null default 'neu' check (status in ('neu', 'kontaktiert')),
  contacted_at  timestamptz,
  contacted_by  text,
  note          text check (char_length(note) <= 2000)
);

create index if not exists leads_created_idx on public.leads (created_at desc);

-- Admin-E-Mail-Adressen: hier eintragen, wer die Admin-Seite nutzen darf (in Kleinbuchstaben).
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'franz.dippel@fasalesconsulting.com'
    -- , 'weitere.person@fasalesconsulting.com'
  )
$$;

alter table public.leads enable row level security;

revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon, authenticated;
grant select, update, delete on public.leads to authenticated;

drop policy if exists "Besucher legen Anfragen an" on public.leads;
create policy "Besucher legen Anfragen an" on public.leads
  for insert to anon, authenticated
  with check (status = 'neu' and contacted_at is null and contacted_by is null and note is null);

drop policy if exists "Admin liest" on public.leads;
create policy "Admin liest" on public.leads
  for select to authenticated using (public.is_admin());

drop policy if exists "Admin ändert" on public.leads;
create policy "Admin ändert" on public.leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin löscht" on public.leads;
create policy "Admin löscht" on public.leads
  for delete to authenticated using (public.is_admin());
