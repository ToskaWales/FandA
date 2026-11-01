-- ============================================================================
-- 000150_migrate_legacy.sql  |  Daten aus dem alten Schema übernehmen + Tabelle für Partner-Anfragen
-- Voraussetzung: 000050_rename_legacy.sql, 001_core.sql
-- ============================================================================

-- Partner-Anfragen (bAV-Vermittler von index.html) sind keine Bewerber: eigene Tabelle, damit sie weder
-- in der Recruiter-Pipeline noch in der Ad-Auswertung auftauchen. Angelegt nur über die Edge Function submit-lead.
create table partner_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 200),
  email        text check (char_length(email) <= 254),
  phone        text check (char_length(phone) <= 40),
  company      text check (char_length(company) <= 200),
  message      text check (char_length(message) <= 4000),
  data         jsonb not null default '{}'::jsonb,
  status       text not null default 'new' check (status in ('new', 'contacted')),
  contacted_at timestamptz,
  contacted_by uuid references profiles (id),
  note         text check (char_length(note) <= 2000)
);
create index partner_requests_created_idx on partner_requests (created_at desc);
create trigger partner_requests_audit after insert or update or delete on partner_requests
  for each row execute function audit_row_change();

alter table partner_requests enable row level security;
create policy admin_all_partner_requests on partner_requests for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
revoke all on partner_requests from anon;

do $$
declare r record; v_id uuid; v_first text; v_last text;
begin
  if to_regclass('public.legacy_leads') is null then return; end if;

  for r in select * from legacy_leads where kind = 'setter' order by created_at loop
    v_first := split_part(btrim(r.name), ' ', 1);
    v_last  := nullif(btrim(substr(btrim(r.name), length(v_first) + 1)), '');
    insert into leads (first_name, last_name, email, phone, source, status, extra, created_at)
    values (v_first, v_last, r.email, r.phone, 'website',
            case r.status when 'kontaktiert' then 'contacted' else 'new' end::lead_status,
            r.data || jsonb_strip_nulls(jsonb_build_object('message', r.message, 'company', r.company,
                                                           'legacy_id', r.id, 'contacted_by', r.contacted_by)),
            r.created_at)
    returning id into v_id;
    if r.note is not null then
      insert into lead_events (lead_id, event_type, detail, created_at)
      values (v_id, 'note', jsonb_build_object('text', r.note, 'legacy', true), coalesce(r.contacted_at, r.created_at));
    end if;
  end loop;

  insert into partner_requests (name, email, phone, company, message, data, status, contacted_at, note, created_at)
  select name, email, phone, company, message,
         data || jsonb_strip_nulls(jsonb_build_object('legacy_id', id, 'contacted_by', contacted_by)),
         case status when 'kontaktiert' then 'contacted' else 'new' end, contacted_at, note, created_at
    from legacy_leads where kind = 'partner';
end $$;

-- Alte Admins (nur E-Mail) werden Admin-Profile; ihr Login wird über die E-Mail in auth.users gefunden.
do $$
begin
  if to_regclass('public.legacy_admins') is null then return; end if;
  insert into profiles (auth_user_id, role, full_name, email)
  select u.id, 'admin', split_part(a.email, '@', 1), a.email
    from legacy_admins a
    left join auth.users u on lower(u.email) = a.email
   where not exists (select 1 from profiles p where lower(p.email) = a.email)
  on conflict (auth_user_id) do nothing;
end $$;
