-- ============================================================================
-- 001_core.sql  |  Kern: Rollen, Leads, Ads, Zuteilung, Audit, Webhook-Eingang, RLS
-- Läuft allein (ohne 002-004) und ergibt schon ein nutzbares Lead-CRM.
-- ============================================================================

-- ---------- Aufzählungen ----------
create type user_role   as enum ('admin', 'recruiter', 'setter', 'closer');
create type lead_status as enum ('new', 'contacted', 'conversation', 'onboarding', 'paid', 'lost');
create type lead_source as enum ('meta_ad', 'facebook_group', 'indeed', 'website', 'manual', 'other');

-- ---------- Einstellungen (alle Beträge konfigurierbar) ----------
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
insert into app_settings (key, value, description) values
  ('payment_amount_eur',   '250',  'Einzahlung des Bewerbers in EUR'),
  ('recruiter_reward_eur', '100',  'Belohnung für den Recruiter pro bestätigter Einzahlung in EUR'),
  ('creator_rate',         '0.05', 'Standard-Anteil des Creators an der Einzahlung (0.05 = 5 %)');

create function setting_num(p_key text) returns numeric
language sql stable set search_path = public as $$
  select (value #>> '{}')::numeric from app_settings where key = p_key;
$$;

-- ---------- Hilfsfunktionen ----------
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Telefonnummer vereinheitlichen (Annahme: Standardland Deutschland)
create function normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\(\s*0\s*\)', '', 'g');     -- "+49 (0)151 ..." : die eingeklammerte 0 gehört nicht zur Nummer
  d := regexp_replace(d, '[^0-9+]', '', 'g');
  if d like '+%' then d := '+' || regexp_replace(substr(d, 2), '[^0-9]', '', 'g');
  elsif d like '00%' then d := '+' || substr(d, 3);
  elsif d like '0%'  then d := '+49' || substr(d, 2);
  elsif d like '49%' then d := '+' || d;
  end if;
  if length(regexp_replace(d, '[^0-9]', '', 'g')) < 7 then return null; end if;
  return d;
end $$;

-- ---------- Betreuer / Personen (Admin, Recruiter, Setter, Closer) ----------
-- Absichtlich NICHT an auth.users gekoppelt: Setter/Closer müssen ohne Login anlegbar sein.
create table profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  role         user_role not null,
  full_name    text not null,
  email        text,
  phone        text,
  iban         text,
  ref_code     text unique check (ref_code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index profiles_email_uq on profiles (lower(email)) where email is not null;

create function profiles_before_write() returns trigger language plpgsql as $$
begin
  new.ref_code := nullif(lower(btrim(new.ref_code)), '');
  if new.ref_code is null and new.role = 'recruiter' then
    new.ref_code := coalesce(nullif(left(regexp_replace(
                      translate(lower(new.full_name), 'äöüß', 'aous'), '[^a-z0-9]+', '', 'g'), 12), ''), 'rec')
                    || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  end if;
  return new;
end $$;
create trigger profiles_10_before before insert or update on profiles
  for each row execute function profiles_before_write();
create trigger profiles_20_updated before update on profiles
  for each row execute function set_updated_at();

-- Wer ist eingeloggt? (SECURITY DEFINER, damit RLS auf profiles keine Schleife erzeugt)
create function current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where auth_user_id = auth.uid() and active limit 1;
$$;
create function current_app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where auth_user_id = auth.uid() and active limit 1;
$$;
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where auth_user_id = auth.uid() and active limit 1), false);
$$;

-- ---------- Creator (Darsteller der Ads; kein Login) ----------
create table creators (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  code            text unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),  -- Kurzname für die Namensregel in Anzeigennamen: [cr:cleo]
  email           text,
  iban            text,
  commission_rate numeric(5,4) check (commission_rate >= 0 and commission_rate <= 1), -- null = Standard aus app_settings
  active          boolean not null default true,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create function creators_before_write() returns trigger language plpgsql as $$
begin new.code := nullif(lower(btrim(new.code)), ''); return new; end $$;
create trigger creators_10_before before insert or update on creators
  for each row execute function creators_before_write();
create trigger creators_20_updated before update on creators
  for each row execute function set_updated_at();

-- ---------- Ads ----------
create table ads (
  id               uuid primary key default gen_random_uuid(),
  meta_ad_id       text unique,
  meta_adset_id    text,
  meta_campaign_id text,
  name             text,
  adset_name       text,
  campaign_name    text,
  status           text,                              -- effective_status aus Meta
  thumbnail_url    text,
  video_id         text,
  creator_id       uuid references creators (id),     -- wer ist in der Ad zu sehen (Vergütung)
  recruiter_id     uuid references profiles (id),     -- wer betreut die Ad (bekommt deren Leads)
  defaults_from    text check (defaults_from in ('name', 'adset', 'campaign')),  -- gesetzt = Creator/Recruiter wurden automatisch übernommen, Admin soll prüfen
  meta_created_at  timestamptz,                       -- created_time der Ad bei Meta (für das Alter der Ad in der Auswertung)
  note             text,
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ads_creator_idx   on ads (creator_id);
create index ads_recruiter_idx on ads (recruiter_id);

-- Neue Ads sind nicht leer: Recruiter und Creator werden automatisch vorbelegt (der Admin korrigiert nur, wenn es falsch ist).
-- Reihenfolge: 1) Namensregel im Anzeigennamen  2) gleiche Anzeigengruppe  3) gleiche Kampagne.
--   Namensregel: im Anzeigennamen stehen [ref:<ref_code des Recruiters>] und/oder [cr:<code des Creators>], z. B. "Hook B [ref:anna-1a2b] [cr:cleo]".
--   Vererbung: nur wenn ALLE Schwester-Ads mit einem Wert denselben Wert haben (sonst unklar, dann bleibt es leer).
--   Gilt beim Anlegen; bei Update nur, wenn sich Name oder Anzeigengruppe ändern. Nie werden bestehende Werte überschrieben.
create function ads_before_write() returns trigger language plpgsql as $$
declare v_id uuid; v_ref text; v_cr text;
begin
  if new.recruiter_id is not null and not exists
     (select 1 from profiles where id = new.recruiter_id and role = 'recruiter') then
    raise exception 'ads.recruiter_id muss ein Recruiter sein';
  end if;
  if tg_op = 'UPDATE' and (new.recruiter_id is distinct from old.recruiter_id or new.creator_id is distinct from old.creator_id) then
    new.defaults_from := null;      -- von Hand geändert = bestätigt
  end if;
  if (new.recruiter_id is null or new.creator_id is null)
     and (tg_op = 'INSERT' or new.name is distinct from old.name or new.meta_adset_id is distinct from old.meta_adset_id) then
    -- 1) Namensregel
    v_ref := lower((regexp_match(coalesce(new.name, ''), '\[ref:([A-Za-z0-9_-]{3,32})\]'))[1]);
    v_cr  := lower((regexp_match(coalesce(new.name, ''), '\[cr:([A-Za-z0-9_-]{2,32})\]'))[1]);
    if new.recruiter_id is null and v_ref is not null then
      select id into v_id from profiles where ref_code = v_ref and role = 'recruiter' and active;
      if v_id is not null then new.recruiter_id := v_id; new.defaults_from := coalesce(new.defaults_from, 'name'); end if;
    end if;
    if new.creator_id is null and v_cr is not null then
      select id into v_id from creators where code = v_cr and active;
      if v_id is not null then new.creator_id := v_id; new.defaults_from := coalesce(new.defaults_from, 'name'); end if;
    end if;
    -- 2) + 3) Vererbung von Schwester-Ads (erst Anzeigengruppe, dann Kampagne)
    if new.recruiter_id is null then
      v_id := null;
      select min(a.recruiter_id::text)::uuid into v_id
        from ads a join profiles p on p.id = a.recruiter_id and p.role = 'recruiter' and p.active
       where a.meta_adset_id = new.meta_adset_id and new.meta_adset_id is not null and a.id <> new.id
      having count(distinct a.recruiter_id) = 1;
      if v_id is not null then new.recruiter_id := v_id; new.defaults_from := coalesce(new.defaults_from, 'adset'); end if;
    end if;
    if new.recruiter_id is null then
      v_id := null;
      select min(a.recruiter_id::text)::uuid into v_id
        from ads a join profiles p on p.id = a.recruiter_id and p.role = 'recruiter' and p.active
       where a.meta_campaign_id = new.meta_campaign_id and new.meta_campaign_id is not null and a.id <> new.id
      having count(distinct a.recruiter_id) = 1;
      if v_id is not null then new.recruiter_id := v_id; new.defaults_from := coalesce(new.defaults_from, 'campaign'); end if;
    end if;
    if new.creator_id is null then
      v_id := null;
      select min(a.creator_id::text)::uuid into v_id
        from ads a join creators c on c.id = a.creator_id and c.active
       where a.meta_adset_id = new.meta_adset_id and new.meta_adset_id is not null and a.id <> new.id
      having count(distinct a.creator_id) = 1;
      if v_id is not null then new.creator_id := v_id; new.defaults_from := coalesce(new.defaults_from, 'adset'); end if;
    end if;
    if new.creator_id is null then
      v_id := null;
      select min(a.creator_id::text)::uuid into v_id
        from ads a join creators c on c.id = a.creator_id and c.active
       where a.meta_campaign_id = new.meta_campaign_id and new.meta_campaign_id is not null and a.id <> new.id
      having count(distinct a.creator_id) = 1;
      if v_id is not null then new.creator_id := v_id; new.defaults_from := coalesce(new.defaults_from, 'campaign'); end if;
    end if;
  end if;
  return new;
end $$;
create trigger ads_10_before before insert or update on ads
  for each row execute function ads_before_write();
create trigger ads_20_updated before update on ads
  for each row execute function set_updated_at();

-- ---------- Leads ----------
create table leads (
  id                    uuid primary key default gen_random_uuid(),
  lead_number           bigint generated always as identity,
  lead_code             text generated always as ('L-' || lpad(lead_number::text, 6, '0')) stored,
  first_name            text,
  last_name             text,
  email                 text,
  phone                 text,
  email_norm            text,
  phone_norm            text,
  extra                 jsonb not null default '{}'::jsonb,   -- weitere Formularantworten
  status                lead_status not null default 'new',
  lost_reason           text,
  next_followup_at      timestamptz,
  source                lead_source not null default 'website',
  recruiter_id          uuid references profiles (id),        -- null = Admin muss zuteilen
  assignment_reason     text check (assignment_reason in ('ref_code', 'ad', 'manual')),
  assigned_at           timestamptz,
  ad_id                 uuid references ads (id),
  creator_id            uuid references creators (id),         -- Creator, der für DIESEN Lead vergütet wird (wird beim Anlegen eingefroren)
  meta_ad_id_raw        text,                                  -- Meta-Ad-ID genau so empfangen (Absicherung, falls ad_id nicht aufgelöst werden konnte)
  meta_lead_id          text unique,                           -- Schutz vor Doppelungen
  meta_form_id          text,
  ref_code              text,                                  -- so empfangen (Tracking-Link)
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  consent_at            timestamptz,
  attribution_unconfirmed boolean not null default false,       -- true = Recruiter/Creator kamen von einer Ad, die sie nur von Schwester-Ads geerbt hat; Zahlung erst nach Prüfung
  possible_duplicate_of uuid references leads (id),
  closed_by             uuid references profiles (id),         -- Recruiter, der den Lead geclosed hat
  closed_at             timestamptz,
  converted_profile_id  uuid references profiles (id),         -- aus dem Bewerber wurde dieser Setter
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- Indizes (Begründung im Plan, Abschnitt "Indizes")
create index leads_recruiter_status_idx on leads (recruiter_id, status);
create index leads_open_idx             on leads (created_at desc) where recruiter_id is null and status <> 'lost';
create index leads_ad_idx               on leads (ad_id);
create index leads_creator_idx          on leads (creator_id) where creator_id is not null;
create index leads_created_idx          on leads (created_at desc);
create index leads_email_norm_idx       on leads (email_norm) where email_norm is not null;
create index leads_phone_norm_idx       on leads (phone_norm) where phone_norm is not null;
create index leads_ref_idx              on leads (ref_code) where ref_code is not null;
create index leads_followup_idx         on leads (next_followup_at) where next_followup_at is not null;
create index leads_unconfirmed_idx      on leads (created_at desc) where attribution_unconfirmed;

-- Zeitleiste pro Lead (wird automatisch befüllt, nur anhängen)
create table lead_events (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references leads (id) on delete restrict,
  actor_id   uuid references profiles (id),     -- null = System/Webhook
  event_type text not null,                      -- created, status_changed, assigned, note, payment_*, ...
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events (lead_id, created_at);

-- Allgemeiner Änderungsverlauf für Stammdaten und Geld
create table audit_log (
  id               bigint generated always as identity primary key,
  table_name       text not null,
  row_id           text,
  action           text not null,
  actor_profile_id uuid,
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now()
);
create index audit_log_table_idx on audit_log (table_name, row_id, created_at);

-- Nur anhängen. Einzige Ausnahme: erase_lead() / erase_profile() (Datenschutz-Löschung) setzen kurz app.allow_erase und dürfen
-- bestehende Zeilen UPDATEN (Personendaten überschreiben). Löschen (DELETE) bleibt immer verboten.
create function forbid_modification() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('app.allow_erase', true) = 'on' then return new; end if;
  raise exception '% ist nur zum Anhängen da (kein Ändern/Löschen)', tg_table_name;
end $$;
create trigger lead_events_append_only before update or delete on lead_events
  for each row execute function forbid_modification();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_modification();

create function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  insert into audit_log (table_name, row_id, action, actor_profile_id, old_data, new_data)
  values (tg_table_name, coalesce(j ->> 'id', j ->> 'key'), tg_op, current_profile_id(),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'iban' end,   -- IBAN gehört nicht in den unveränderlichen Verlauf
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'iban' end);
  return null;
end $$;
create trigger profiles_audit     after insert or update or delete on profiles     for each row execute function audit_row_change();
create trigger creators_audit     after insert or update or delete on creators     for each row execute function audit_row_change();
create trigger ads_audit          after insert or update or delete on ads          for each row execute function audit_row_change();
create trigger app_settings_audit after insert or update or delete on app_settings for each row execute function audit_row_change();

-- ---------- Zuteilung bei neuem Lead ----------
-- Reihenfolge: 1) ref_code -> Recruiter  2) Recruiter der Ad  3) sonst offen (Admin verteilt)
-- Kein Round-Robin (ausdrücklicher Wunsch).
create function leads_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rec uuid; v_dup uuid;
begin
  new.email        := nullif(btrim(new.email), '');
  new.email_norm   := lower(new.email);
  new.phone_norm   := normalize_phone(new.phone);
  new.ref_code     := nullif(lower(btrim(new.ref_code)), '');

  select id into v_dup from leads
   where (new.email_norm is not null and email_norm = new.email_norm)
      or (new.phone_norm is not null and phone_norm = new.phone_norm)
   order by created_at limit 1;
  new.possible_duplicate_of := v_dup;

  if new.recruiter_id is not null then
    new.assignment_reason := coalesce(new.assignment_reason, 'manual');
  else
    if new.ref_code is not null then
      select id into v_rec from profiles
       where ref_code = new.ref_code and role = 'recruiter' and active;
      if v_rec is not null then new.recruiter_id := v_rec; new.assignment_reason := 'ref_code'; end if;
    end if;
    if new.recruiter_id is null and new.ad_id is not null then
      select a.recruiter_id into v_rec from ads a
        join profiles p on p.id = a.recruiter_id and p.role = 'recruiter' and p.active
       where a.id = new.ad_id;
      if v_rec is not null then new.recruiter_id := v_rec; new.assignment_reason := 'ad'; end if;
    end if;
  end if;
  if new.recruiter_id is not null then new.assigned_at := coalesce(new.assigned_at, now()); end if;

  -- Creator für diesen Lead einfrieren (Stand der Ad zum Zeitpunkt des Eingangs)
  if new.creator_id is null and new.ad_id is not null then
    select creator_id into new.creator_id from ads where id = new.ad_id;
  end if;
  -- Kam Recruiter oder Creator nur durch Vererbung von Schwester-Ads (nicht durch Namensregel oder Handeingabe), muss der Admin es prüfen,
  -- bevor eine Zahlung dieses Leads bestätigt werden kann (confirm_payment prüft das). So löst eine geratene Zuordnung nie unbemerkt Geld aus.
  if new.ad_id is not null and (new.assignment_reason = 'ad' or new.creator_id is not null)
     and exists (select 1 from ads where id = new.ad_id and defaults_from in ('adset', 'campaign')) then
    new.attribution_unconfirmed := true;
  end if;
  return new;
end $$;
create trigger leads_10_before_insert before insert on leads
  for each row execute function leads_before_insert();

-- Wird einer Ad nachträglich ein Recruiter zugewiesen, gehen ihre offenen Leads automatisch an ihn.
create function ads_after_recruiter_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recruiter_id is not null and new.recruiter_id is distinct from old.recruiter_id
     and exists (select 1 from profiles where id = new.recruiter_id and role = 'recruiter' and active) then
    update leads set recruiter_id = new.recruiter_id, assigned_at = now(), assignment_reason = 'ad',
           attribution_unconfirmed = attribution_unconfirmed or coalesce(new.defaults_from in ('adset', 'campaign'), false)
     where ad_id = new.id and recruiter_id is null;
  end if;
  return null;
end $$;
create trigger ads_30_assign_open after update on ads   -- bewusst ohne "OF spalte": Änderungen durch BEFORE-Trigger (Vererbung) lösen "UPDATE OF" nicht aus
  for each row execute function ads_after_recruiter_change();

-- Wird einer Ad erst später ein Creator eingetragen, bekommen nur Leads OHNE Creator ihn nachträglich.
-- Leads, die schon einen Creator haben, bleiben unverändert (eine spätere Änderung an der Ad schreibt die Vergangenheit nicht um).
-- Wollte der Admin die Vergangenheit ändern (falscher Creator eingetragen), gibt es dafür reassign_ad_creator / correct_lead_creator (002).
-- Für bereits bezahlte Leads wird die Provision durch backfill_missing_commissions (002) erzeugt; die Ansicht v_creator_gaps (002) listet sie.
create function ads_after_creator_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.creator_id is not null and new.creator_id is distinct from old.creator_id then
    update leads set creator_id = new.creator_id where ad_id = new.id and creator_id is null;
  end if;
  return null;
end $$;
create trigger ads_31_creator_leads after update on ads
  for each row execute function ads_after_creator_change();

-- ---------- Schutz vor unerlaubten Änderungen (gilt nur für direkte Zugriffe der App-Nutzer) ----------
create function leads_guard_update() returns trigger language plpgsql as $$
begin
  if current_user <> 'authenticated' then return new; end if;   -- service_role, SQL-Editor, SECURITY-DEFINER-Funktionen
  if new.status is distinct from old.status and (new.status = 'paid' or old.status = 'paid') then
    raise exception 'Status "paid" nur über confirm_payment / reverse_payment';
  end if;
  if new.creator_id is distinct from old.creator_id and to_regproc('public.correct_lead_creator') is not null then
    raise exception 'Creator nur über correct_lead_creator / reassign_ad_creator ändern (korrigiert auch die Provisionen)';
  end if;
  if is_admin() then return new; end if;
  -- lead_code ist eine berechnete Spalte und in BEFORE-Triggern in NEW noch leer: deshalb mit ausnehmen
  if (to_jsonb(new) - array['status', 'lost_reason', 'next_followup_at', 'updated_at', 'lead_code'])
     is distinct from
     (to_jsonb(old) - array['status', 'lost_reason', 'next_followup_at', 'updated_at', 'lead_code']) then
    raise exception 'Recruiter dürfen nur Status, Verlustgrund und Wiedervorlage ändern';
  end if;
  return new;
end $$;
create trigger leads_20_guard   before update on leads for each row execute function leads_guard_update();
create trigger leads_30_updated before update on leads for each row execute function set_updated_at();

-- Automatische Zeitleiste
create function leads_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_profile_id();
begin
  if tg_op = 'INSERT' then
    insert into lead_events (lead_id, actor_id, event_type, detail)
    values (new.id, v_actor, 'created', jsonb_build_object(
      'source', new.source, 'recruiter_id', new.recruiter_id,
      'assignment_reason', new.assignment_reason, 'ad_id', new.ad_id,
      'possible_duplicate_of', new.possible_duplicate_of));
  else
    if new.status is distinct from old.status then
      insert into lead_events (lead_id, actor_id, event_type, detail)
      values (new.id, v_actor, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.recruiter_id is distinct from old.recruiter_id then
      insert into lead_events (lead_id, actor_id, event_type, detail)
      values (new.id, v_actor, 'assigned', jsonb_build_object(
        'from', old.recruiter_id, 'to', new.recruiter_id, 'reason', new.assignment_reason));
    end if;
  end if;
  return null;
end $$;
create trigger leads_90_audit after insert or update on leads
  for each row execute function leads_audit();

-- ---------- Meta-Webhook-Eingang (Posteingang, damit nie ein Lead verloren geht) ----------
create table meta_webhook_events (
  id            bigint generated always as identity primary key,
  leadgen_id    text not null unique,
  page_id       text,
  form_id       text,
  ad_id         text,
  payload       jsonb not null,
  status        text not null default 'received' check (status in ('received', 'processed', 'failed', 'dead')),
  attempts      int not null default 0,
  last_error    text,
  next_retry_at timestamptz not null default now(),
  lead_id       uuid references leads (id),
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);
create index meta_webhook_retry_idx on meta_webhook_events (next_retry_at) where status in ('received', 'failed');

-- ---------- Funktionen für die App (RPC) ----------
create function assign_lead(p_lead_id uuid, p_recruiter_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_status lead_status;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if not exists (select 1 from profiles where id = p_recruiter_id and role = 'recruiter' and active) then
    raise exception 'Ziel ist kein aktiver Recruiter';
  end if;
  select status into v_status from leads where id = p_lead_id for update;
  if not found then raise exception 'Lead nicht gefunden'; end if;
  if v_status = 'paid' then raise exception 'Bezahlter Lead kann nicht umgehängt werden (erst Zahlung stornieren)'; end if;
  update leads set recruiter_id = p_recruiter_id, assigned_at = now(), assignment_reason = 'manual'
   where id = p_lead_id;
end $$;

-- Prüfen und bestätigen: ein Lead / alle Leads einer Ad.
create function confirm_lead_attribution(p_lead_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  update leads set attribution_unconfirmed = false where id = p_lead_id;
  if not found then raise exception 'Lead nicht gefunden'; end if;
end $$;

create function confirm_ad_attribution(p_ad_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  update ads set defaults_from = null where id = p_ad_id;
  if not found then raise exception 'Ad nicht gefunden'; end if;
  update leads set attribution_unconfirmed = false where ad_id = p_ad_id and attribution_unconfirmed;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Falscher Recruiter an einer Ad: Ad und alle noch NICHT bezahlten Leads, die wegen dieser Ad zugeteilt wurden (Grund 'ad'), auf den richtigen Recruiter.
-- Leads mit Tracking-Link (ref_code) und manuell zugeteilte bleiben unberührt. Bezahlte Leads werden nie angefasst (dort: Zahlung stornieren, siehe 6.2).
-- Die Markierung attribution_unconfirmed bleibt, bis der Admin mit confirm_ad_attribution bestätigt (vorher ggf. reassign_ad_creator).
create function reassign_ad_recruiter(p_ad_id uuid, p_recruiter_id uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  if not exists (select 1 from profiles where id = p_recruiter_id and role = 'recruiter' and active) then
    raise exception 'Ziel ist kein aktiver Recruiter';
  end if;
  update ads set recruiter_id = p_recruiter_id where id = p_ad_id;
  if not found then raise exception 'Ad nicht gefunden'; end if;
  update leads set recruiter_id = p_recruiter_id, assigned_at = now()
   where ad_id = p_ad_id and assignment_reason = 'ad' and status <> 'paid' and recruiter_id is distinct from p_recruiter_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function add_lead_note(p_lead_id uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(p_text, '')) = '' then raise exception 'Notiz ist leer'; end if;
  if not (is_admin() or exists (select 1 from leads where id = p_lead_id and recruiter_id = current_profile_id())) then
    raise exception 'Keine Berechtigung';
  end if;
  insert into lead_events (lead_id, actor_id, event_type, detail)
  values (p_lead_id, current_profile_id(), 'note', jsonb_build_object('text', p_text));
end $$;

-- Dublettenprüfung für das Website-Formular (nur Server/service_role): gleiche E-Mail ODER Telefonnummer in den letzten p_hours Stunden?
create function recent_duplicate_lead(p_email text, p_phone text, p_hours int default 24) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leads
     where created_at > now() - make_interval(hours => p_hours)
       and ((nullif(lower(btrim(p_email)), '') is not null and email_norm = lower(btrim(p_email)))
         or (normalize_phone(p_phone) is not null and phone_norm = normalize_phone(p_phone))));
$$;
revoke execute on function recent_duplicate_lead(text, text, int) from public, anon, authenticated;
grant  execute on function recent_duplicate_lead(text, text, int) to service_role;

-- Zweite Anmeldung derselben Person innerhalb p_hours: nichts geht verloren.
-- Sie wird im Verlauf des bestehenden Leads vermerkt (Ereignis 'repeat_submission', mit ref/src/ad_id).
-- Ist der bestehende Lead noch OFFEN und der neue Link gehört einem aktiven Recruiter, bekommt dieser den Lead.
-- Ein schon zugeteilter Lead wird nie automatisch umgehängt (der Admin sieht den Hinweis im Verlauf).
create function note_repeat_submission(p_email text, p_phone text, p_ref text, p_src text, p_ad_id text, p_hours int default 24)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lead leads%rowtype; v_rec uuid; v_ref text := nullif(lower(btrim(p_ref)), '');
begin
  select * into v_lead from leads
   where created_at > now() - make_interval(hours => p_hours)
     and ((nullif(lower(btrim(p_email)), '') is not null and email_norm = lower(btrim(p_email)))
       or (normalize_phone(p_phone) is not null and phone_norm = normalize_phone(p_phone)))
   order by created_at limit 1 for update;
  if not found then return null; end if;
  insert into lead_events (lead_id, actor_id, event_type, detail)
  values (v_lead.id, null, 'repeat_submission',
          jsonb_build_object('ref', v_ref, 'src', p_src, 'ad_id', p_ad_id, 'existing_recruiter_id', v_lead.recruiter_id));
  if v_lead.recruiter_id is null and v_ref is not null then
    select id into v_rec from profiles where ref_code = v_ref and role = 'recruiter' and active;
    if v_rec is not null then
      update leads set recruiter_id = v_rec, assigned_at = now(), assignment_reason = 'ref_code' where id = v_lead.id;
    end if;
  end if;
  return v_lead.id;
end $$;
revoke execute on function note_repeat_submission(text, text, text, text, text, int) from public, anon, authenticated;
grant  execute on function note_repeat_submission(text, text, text, text, text, int) to service_role;

-- Notbremse gegen Flutung des öffentlichen Formulars (nur Server): Anzahl Leads der letzten p_minutes Minuten.
create function recent_lead_count(p_minutes int default 10) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from leads where created_at > now() - make_interval(mins => p_minutes);
$$;
revoke execute on function recent_lead_count(int) from public, anon, authenticated;
grant  execute on function recent_lead_count(int) to service_role;

-- Datenschutz-Löschung (Art. 17 DSGVO): Der Lead wird ANONYMISIERT statt gelöscht, weil Verlauf und Geldbuchungen bestehen bleiben müssen.
-- Entfernt Name, Kontaktdaten, Formularantworten, Notiztexte und Zahlungsreferenz. Belegdateien im Storage separat löschen.
-- Ob und wie lange Buchungsdaten aufbewahrt werden müssen, klärt die Steuerberatung (Abschnitt 11.2).
create function erase_lead(p_lead_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  if not exists (select 1 from leads where id = p_lead_id) then raise exception 'Lead nicht gefunden'; end if;
  perform set_config('app.allow_erase', 'on', true);          -- gilt nur bis zum Ende dieser Transaktion
  update leads set first_name = '[gelöscht]', last_name = null, email = null, phone = null,
         email_norm = null, phone_norm = null, extra = '{}'::jsonb, possible_duplicate_of = null
   where id = p_lead_id;
  update lead_events set detail = jsonb_build_object('erased', true) where lead_id = p_lead_id and event_type = 'note';
  if to_regclass('public.payments') is not null then
    execute 'update payments set reference = null, proof_path = null where lead_id = $1' using p_lead_id;
    -- Der Update oben hat über den Audit-Trigger selbst eine neue Verlaufszeile mit dem alten Verwendungszweck geschrieben,
    -- und frühere Zeilen enthalten ihn auch: in ALLEN Verlaufszeilen dieser Zahlungen Referenz und Beleg überschreiben.
    execute $q$update audit_log set old_data = nullif(old_data - 'reference' - 'proof_path', '{}'::jsonb),
                               new_data = nullif(new_data - 'reference' - 'proof_path', '{}'::jsonb)
                where table_name = 'payments' and row_id in (select id::text from payments where lead_id = $1)$q$ using p_lead_id;
  end if;
  insert into lead_events (lead_id, actor_id, event_type, detail)
  values (p_lead_id, current_profile_id(), 'erased', jsonb_build_object('reason', p_reason));
  perform set_config('app.allow_erase', 'off', true);
end $$;

-- Dasselbe für einen Betreuer (Recruiter/Setter/Closer): Kontaktdaten und IBAN weg, Konto gesperrt, Datensatz bleibt für die Buchungen.
create function erase_profile(p_profile_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_open boolean := false;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  if p_profile_id = current_profile_id() then raise exception 'Nicht das eigene Profil'; end if;
  if to_regclass('public.commissions') is not null then       -- Tabelle gibt es erst ab 002
    execute 'select exists (select 1 from commissions where recruiter_id = $1 and status = ''open'')' into v_open using p_profile_id;
    if v_open then raise exception 'Es gibt noch offene Provisionen: erst auszahlen oder abschließen'; end if;
  end if;
  perform set_config('app.allow_erase', 'on', true);
  update profiles set full_name = '[gelöscht]', email = null, phone = null, iban = null, note = null,
         active = false, auth_user_id = null
   where id = p_profile_id;
  update audit_log set old_data = old_data - 'full_name' - 'email' - 'phone' - 'note',
                       new_data = new_data - 'full_name' - 'email' - 'phone' - 'note'
   where table_name = 'profiles' and row_id = p_profile_id::text;
  perform set_config('app.allow_erase', 'off', true);
  -- Den Login in Supabase Auth danach über das Dashboard / die Admin-API löschen (auth.users).
end $$;

-- Dasselbe für einen Creator.
create function erase_creator(p_creator_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_open boolean := false;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  if to_regclass('public.commissions') is not null then
    execute 'select exists (select 1 from commissions where creator_id = $1 and status = ''open'')' into v_open using p_creator_id;
    if v_open then raise exception 'Es gibt noch offene Provisionen: erst auszahlen oder abschließen'; end if;
  end if;
  perform set_config('app.allow_erase', 'on', true);
  update creators set name = '[gelöscht]', email = null, iban = null, note = null, code = null, active = false
   where id = p_creator_id;
  update audit_log set old_data = old_data - 'name' - 'email' - 'note',
                       new_data = new_data - 'name' - 'email' - 'note'
   where table_name = 'creators' and row_id = p_creator_id::text;
  perform set_config('app.allow_erase', 'off', true);
end $$;

-- Lead von Hand anlegen (Telefon-Akquise, Indeed, Gruppen). Recruiter -> automatisch eigener Lead.
create function create_manual_lead(
  p_first_name text, p_last_name text, p_email text, p_phone text,
  p_source lead_source default 'manual', p_recruiter_id uuid default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_role user_role := current_app_role(); v_rec uuid; v_id uuid;
begin
  if v_role not in ('admin', 'recruiter') then raise exception 'Keine Berechtigung'; end if;
  v_rec := case when v_role = 'recruiter' then current_profile_id() else p_recruiter_id end;
  if coalesce(btrim(p_phone), '') = '' and coalesce(btrim(p_email), '') = '' then
    raise exception 'Telefon oder E-Mail nötig';
  end if;
  insert into leads (first_name, last_name, email, phone, source, recruiter_id)
  values (p_first_name, p_last_name, p_email, p_phone, p_source, v_rec) returning id into v_id;
  if p_note is not null then perform add_lead_note(v_id, p_note); end if;
  return v_id;
end $$;

-- ---------- Row Level Security ----------
alter table app_settings        enable row level security;
alter table profiles            enable row level security;
alter table creators            enable row level security;
alter table ads                 enable row level security;
alter table leads               enable row level security;
alter table lead_events         enable row level security;
alter table audit_log           enable row level security;
alter table meta_webhook_events enable row level security;

-- Admin: alles lesen/schreiben (Verlaufstabellen: nur lesen)
create policy admin_all_settings  on app_settings for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_profiles  on profiles     for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_creators  on creators     for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_ads       on ads          for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_leads     on leads        for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_read_events   on lead_events  for select to authenticated using ((select is_admin()));
create policy admin_read_audit    on audit_log    for select to authenticated using ((select is_admin()));
create policy admin_read_webhooks on meta_webhook_events for select to authenticated using ((select is_admin()));

-- Alle Eingeloggten: Beträge lesen; eigenes Profil lesen
create policy read_settings on app_settings for select to authenticated using (true);
create policy own_profile   on profiles     for select to authenticated using (auth_user_id = (select auth.uid()));

-- Recruiter: eigene Leads lesen/ändern (Spalten begrenzt durch leads_guard_update), Zeitleiste lesen, eigene Ads lesen
create policy recruiter_leads_select on leads for select to authenticated
  using (recruiter_id = (select current_profile_id()));
create policy recruiter_leads_update on leads for update to authenticated
  using (recruiter_id = (select current_profile_id())) with check (recruiter_id = (select current_profile_id()));
create policy recruiter_events_select on lead_events for select to authenticated
  using (exists (select 1 from leads l where l.id = lead_events.lead_id and l.recruiter_id = (select current_profile_id())));
create policy recruiter_ads_select on ads for select to authenticated
  using (recruiter_id = (select current_profile_id()));

-- Verlaufstabellen und Webhook-Eingang: App-Nutzer dürfen nicht direkt schreiben
revoke insert, update, delete, truncate on lead_events, audit_log, meta_webhook_events from authenticated, anon;

-- Anonyme Besucher brauchen nichts in der Datenbank: Website-Formular läuft über die Edge Function submit-lead
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- RPCs nur für eingeloggte Nutzer (Supabase vergibt Execute standardmäßig auch an anon)
revoke execute on function assign_lead(uuid, uuid), add_lead_note(uuid, text),
  confirm_lead_attribution(uuid), confirm_ad_attribution(uuid), reassign_ad_recruiter(uuid, uuid, text),
  create_manual_lead(text, text, text, text, lead_source, uuid, text),
  erase_lead(uuid, text), erase_profile(uuid, text), erase_creator(uuid, text) from public, anon;
grant  execute on function assign_lead(uuid, uuid), add_lead_note(uuid, text),
  confirm_lead_attribution(uuid), confirm_ad_attribution(uuid), reassign_ad_recruiter(uuid, uuid, text),
  create_manual_lead(text, text, text, text, lead_source, uuid, text),
  erase_lead(uuid, text), erase_profile(uuid, text), erase_creator(uuid, text) to authenticated;
revoke execute on function current_profile_id(), current_app_role(), is_admin() from public, anon;
grant  execute on function current_profile_id(), current_app_role(), is_admin() to authenticated;
