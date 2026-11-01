-- ============================================================================
-- 000050_rename_legacy.sql  |  Alte Tabellen aus supabase/legacy/schema.sql beiseiteschieben, bevor 001 läuft.
-- 001 legt wieder "leads" und "is_admin()" an; beides gibt es im alten Schema schon (anderer Aufbau).
-- Auf einem leeren Projekt (Staging) tut diese Datei nichts.
-- Die Daten übernimmt 000150_migrate_legacy.sql. legacy_* nach 30 Tagen von Hand löschen.
-- ============================================================================

do $$
begin
  if to_regclass('public.leads') is not null and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'leads' and column_name = 'kind') then
    drop policy if exists "Besucher legen Anfragen an" on public.leads;
    drop policy if exists "Admin liest"   on public.leads;
    drop policy if exists "Admin ändert"  on public.leads;
    drop policy if exists "Admin löscht"  on public.leads;
    alter table public.leads rename to legacy_leads;
    alter index if exists public.leads_created_idx rename to legacy_leads_created_idx;   -- 001 legt einen Index mit diesem Namen an
    alter index if exists public.leads_pkey rename to legacy_leads_pkey;
    revoke all on public.legacy_leads from anon, authenticated;
  end if;

  if to_regclass('public.admins') is not null then
    drop policy if exists "Admin sieht Team" on public.admins;
    drop policy if exists "Admin fügt hinzu" on public.admins;
    drop policy if exists "Admin entfernt"  on public.admins;
    alter table public.admins rename to legacy_admins;
    alter index if exists public.admins_pkey rename to legacy_admins_pkey;
    revoke all on public.legacy_admins from anon, authenticated;
  end if;
end $$;

drop function if exists public.is_admin();
