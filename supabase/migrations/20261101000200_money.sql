-- ============================================================================
-- 002_money.sql  |  Zahlung, Provisionen (Hauptbuch), Auszahlung, Beleg-Speicher
-- Voraussetzung: 001_core.sql
-- ============================================================================

create type payment_status    as enum ('reported', 'confirmed', 'rejected', 'reversed');
create type commission_type   as enum ('recruiter', 'creator');
create type commission_status as enum ('open', 'paid_out', 'cancelled', 'settled');   -- settled = Rückforderung (negative Zeile) erledigt, siehe settle_clawback

-- ---------- Zahlungen ----------
create table payments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads (id) on delete restrict,
  amount        numeric(10,2) not null check (amount > 0),
  status        payment_status not null default 'reported',
  paid_on       date,                      -- Datum der Überweisung laut Beleg
  reference     text,                      -- Verwendungszweck / Transaktions-Referenz
  proof_path    text,                      -- Pfad im Storage-Bucket payment-proofs
  reported_by   uuid references profiles (id),
  reported_at   timestamptz not null default now(),
  confirmed_by  uuid references profiles (id),
  confirmed_at  timestamptz,
  decision_note text,                      -- Grund bei Ablehnung/Storno
  created_at    timestamptz not null default now()
);
-- Pro Lead höchstens EINE aktive Zahlung (gemeldet oder bestätigt)
create unique index payments_one_active_per_lead on payments (lead_id) where status in ('reported', 'confirmed');
create index payments_status_idx on payments (status, reported_at desc);
create index payments_lead_idx   on payments (lead_id);

-- ---------- Auszahlungen (ein Überweisungsvorgang an eine Person) ----------
create table payouts (
  id           uuid primary key default gen_random_uuid(),
  recruiter_id uuid references profiles (id),
  creator_id   uuid references creators (id),
  total        numeric(10,2) not null,
  reference    text,
  paid_at      date not null default current_date,
  created_by   uuid references profiles (id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,                 -- gesetzt = Haken wurde zurückgenommen (undo_payout); die Zeile bleibt als Nachweis
  voided_by    uuid references profiles (id),
  void_reason  text,
  check ((recruiter_id is not null) <> (creator_id is not null)),
  check ((voided_at is null) = (void_reason is null))
);

-- ---------- Provisionen: nie löschen, nur stornieren/gegenbuchen ----------
create table commissions (
  id                    uuid primary key default gen_random_uuid(),
  payment_id            uuid not null references payments (id) on delete restrict,
  lead_id               uuid not null references leads (id) on delete restrict,
  type                  commission_type not null,
  recruiter_id          uuid references profiles (id),
  creator_id            uuid references creators (id),
  base_amount           numeric(10,2) not null,       -- Bezugsbetrag (die 250 EUR)
  rate                  numeric(7,4),                 -- bei prozentualer Provision
  amount                numeric(10,2) not null,       -- negativ = Gegenbuchung
  status                commission_status not null default 'open',
  payout_id             uuid references payouts (id),
  reverses_commission_id uuid references commissions (id),
  reversed              boolean not null default false, -- true = diese ausgezahlte Provision wurde schon gegengebucht (nie doppelt gegenbuchen)
  settled_at            timestamptz,                  -- nur bei status 'settled'
  settled_by            uuid references profiles (id),
  settle_note           text,
  created_at            timestamptz not null default now(),
  check (status <> 'settled' or (amount < 0 and settle_note is not null)),
  check ((type = 'recruiter' and recruiter_id is not null and creator_id is null)
      or (type = 'creator'   and creator_id   is not null and recruiter_id is null)),
  check (status <> 'paid_out' or payout_id is not null)
);
-- Idempotenz: pro Zahlung höchstens eine gültige Original-Provision je Typ und Person.
-- (Stornierte Originale zählen nicht mehr; und ein korrigierter Creator ist eine andere Person und darf eine eigene Zeile haben.)
create unique index commissions_one_per_type on commissions (payment_id, type, (coalesce(creator_id, recruiter_id)))
  where reverses_commission_id is null and status <> 'cancelled' and not reversed;
create index commissions_recruiter_idx on commissions (recruiter_id, status) where recruiter_id is not null;
create index commissions_creator_idx   on commissions (creator_id, status)   where creator_id is not null;
create index commissions_lead_idx      on commissions (lead_id);

create trigger payments_audit    after insert or update or delete on payments    for each row execute function audit_row_change();
create trigger commissions_audit after insert or update or delete on commissions for each row execute function audit_row_change();
create trigger payouts_audit     after insert or update or delete on payouts     for each row execute function audit_row_change();

-- ---------- Provisionen anlegen (idempotent; auch nachträglich aufrufbar) ----------
create function ensure_commissions(p_payment_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype; l leads%rowtype;
  v_creator uuid; v_rate numeric; v_n int := 0; v_rows int;
begin
  select * into p from payments where id = p_payment_id;
  if not found or p.status <> 'confirmed' then raise exception 'Zahlung nicht bestätigt'; end if;
  select * into l from leads where id = p.lead_id;
  if l.recruiter_id is null then raise exception 'Lead hat keinen Betreuer – erst zuteilen, dann bestätigen'; end if;

  insert into commissions (payment_id, lead_id, type, recruiter_id, base_amount, amount)
  values (p.id, l.id, 'recruiter', l.recruiter_id, p.amount, setting_num('recruiter_reward_eur'))
  on conflict (payment_id, type, (coalesce(creator_id, recruiter_id))) where reverses_commission_id is null and status <> 'cancelled' and not reversed do nothing;
  get diagnostics v_rows = row_count; v_n := v_n + v_rows;

  -- Creator kommt vom LEAD (eingefroren beim Anlegen), nicht von der aktuellen Ad
  if l.creator_id is not null then
    select c.id, coalesce(c.commission_rate, setting_num('creator_rate'))
      into v_creator, v_rate
      from creators c where c.id = l.creator_id;
    insert into commissions (payment_id, lead_id, type, creator_id, base_amount, rate, amount)
    values (p.id, l.id, 'creator', v_creator, p.amount, v_rate, round(p.amount * v_rate, 2))
    on conflict (payment_id, type, (coalesce(creator_id, recruiter_id))) where reverses_commission_id is null and status <> 'cancelled' and not reversed do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif l.ad_id is not null then
    insert into lead_events (lead_id, actor_id, event_type, detail)
    values (l.id, current_profile_id(), 'creator_missing', jsonb_build_object('ad_id', l.ad_id));
  end if;
  return v_n;
end $$;

-- ---------- Statuswechsel der Zahlung ----------
create function payments_before_update() returns trigger language plpgsql as $$
begin
  if new.lead_id <> old.lead_id or new.amount <> old.amount then
    raise exception 'Zahlung: lead_id/amount sind unveränderlich';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'reported'  and new.status in ('confirmed', 'rejected'))
         or (old.status = 'confirmed' and new.status = 'reversed')) then
      raise exception 'Ungültiger Statuswechsel % -> %', old.status, new.status;
    end if;
    if new.status = 'confirmed' then
      new.confirmed_at := now();
      new.confirmed_by := coalesce(current_profile_id(), new.confirmed_by);
    end if;
  end if;
  return new;
end $$;
create trigger payments_10_before_update before update on payments
  for each row execute function payments_before_update();

create function payments_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead leads%rowtype; v_actor uuid := current_profile_id();
begin
  if tg_op = 'INSERT' and new.status <> 'reported' then
    raise exception 'Neue Zahlung muss Status reported haben';
  end if;
  if tg_op = 'INSERT' then
    insert into lead_events (lead_id, actor_id, event_type, detail)
    values (new.lead_id, v_actor, 'payment_reported', jsonb_build_object('payment_id', new.id, 'amount', new.amount));
    return null;
  end if;
  if new.status = old.status then return null; end if;

  select * into v_lead from leads where id = new.lead_id for update;

  if new.status = 'confirmed' then
    if v_lead.recruiter_id is null then
      raise exception 'Lead hat keinen Betreuer – erst zuteilen, dann bestätigen';
    end if;
    update leads set status = 'paid', closed_by = v_lead.recruiter_id, closed_at = now() where id = v_lead.id;
    perform ensure_commissions(new.id);
    insert into lead_events (lead_id, actor_id, event_type, detail)
    values (new.lead_id, v_actor, 'payment_confirmed',
            jsonb_build_object('payment_id', new.id, 'amount', new.amount, 'closed_by', v_lead.recruiter_id));

  elsif new.status = 'rejected' then
    insert into lead_events (lead_id, actor_id, event_type, detail)
    values (new.lead_id, v_actor, 'payment_rejected', jsonb_build_object('payment_id', new.id, 'reason', new.decision_note));

  elsif new.status = 'reversed' then
    update commissions set status = 'cancelled'
     where payment_id = new.id and status = 'open' and reverses_commission_id is null;
    with done as (            -- ausgezahlte Provisionen: Gegenbuchung (negativ, offen) und Markierung "gegengebucht"
      update commissions set reversed = true
       where payment_id = new.id and status = 'paid_out' and reverses_commission_id is null and not reversed
      returning *)
    insert into commissions (payment_id, lead_id, type, recruiter_id, creator_id, base_amount, rate, amount, status, payout_id, reverses_commission_id)
    select d.payment_id, d.lead_id, d.type, d.recruiter_id, d.creator_id, d.base_amount, d.rate, -d.amount, 'open', null, d.id from done d;
    update leads set status = 'onboarding', closed_by = null, closed_at = null where id = v_lead.id;
    insert into lead_events (lead_id, actor_id, event_type, detail)
    values (new.lead_id, v_actor, 'payment_reversed', jsonb_build_object('payment_id', new.id, 'reason', new.decision_note));
  end if;
  return null;
end $$;
create trigger payments_90_after after insert or update on payments
  for each row execute function payments_after_write();

-- ---------- Funktionen für die App (RPC) ----------
create function report_payment(p_lead_id uuid, p_paid_on date, p_reference text, p_proof_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (is_admin() or exists (select 1 from leads where id = p_lead_id and recruiter_id = current_profile_id())) then
    raise exception 'Keine Berechtigung';
  end if;
  insert into payments (lead_id, amount, paid_on, reference, proof_path, reported_by)
  values (p_lead_id, setting_num('payment_amount_eur'), p_paid_on, p_reference, p_proof_path, current_profile_id())
  returning id into v_id;
  return v_id;
end $$;

create function confirm_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if exists (select 1 from payments p join leads l on l.id = p.lead_id where p.id = p_payment_id and l.attribution_unconfirmed) then
    raise exception 'Zuordnung (Recruiter/Creator der Ad) wurde automatisch übernommen: erst prüfen, dann confirm_lead_attribution oder confirm_ad_attribution';
  end if;
  update payments set status = 'confirmed' where id = p_payment_id and status = 'reported';
  if not found then raise exception 'Zahlung nicht gefunden oder nicht im Status gemeldet'; end if;
end $$;

create function reject_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  update payments set status = 'rejected', decision_note = p_reason where id = p_payment_id and status = 'reported';
  if not found then raise exception 'Zahlung nicht gefunden oder nicht im Status gemeldet'; end if;
end $$;

create function reverse_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  update payments set status = 'reversed', decision_note = p_reason where id = p_payment_id and status = 'confirmed';
  if not found then raise exception 'Zahlung nicht gefunden oder nicht bestätigt'; end if;
end $$;

-- Nachträglich: Creator wurde erst nach der Bestätigung eingetragen (am Lead; bei Ads automatisch, sonst im Admin setzen)
create function backfill_commissions(p_payment_id uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  return ensure_commissions(p_payment_id);
end $$;

-- Alle bestätigten Zahlungen nachziehen, bei denen der Lead einen Creator hat, aber noch keine Creator-Provision existiert.
create function backfill_missing_commissions() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  for r in select pay.id from payments pay join leads l on l.id = pay.lead_id
            where pay.status = 'confirmed' and l.creator_id is not null and l.recruiter_id is not null
              and not exists (select 1 from commissions c where c.payment_id = pay.id and c.type = 'creator'
                               and c.reverses_commission_id is null and c.status <> 'cancelled' and not c.reversed)
  loop
    v_n := v_n + ensure_commissions(r.id);
  end loop;
  return v_n;
end $$;

-- Offene Lücken beim Creator: bezahlte Leads einer Ad, für die es keine gültige Creator-Provision gibt.
--   ad_ohne_creator = Lead hat (noch) keinen Creator   |   provision_fehlt = Creator da, Provision nicht angelegt (backfill_missing_commissions)
create view v_creator_gaps with (security_invoker = true) as
select l.id as lead_id, l.lead_code, l.ad_id, l.creator_id, p.id as payment_id, p.confirmed_at,
       case when l.creator_id is null then 'ad_ohne_creator' else 'provision_fehlt' end as problem
  from leads l
  join payments p on p.lead_id = l.id and p.status = 'confirmed'
 where l.ad_id is not null
   and not exists (select 1 from commissions c where c.payment_id = p.id and c.type = 'creator'
                    and c.reverses_commission_id is null and c.status <> 'cancelled' and not c.reversed);

-- Creator eines einzelnen Leads korrigieren (auch nach Bestätigung/Auszahlung). Der Verlauf bleibt vollständig:
--   offene Creator-Provision -> storniert und für den richtigen Creator neu angelegt
--   schon ausgezahlte        -> Gegenbuchung (negativ, offen) und neue Provision für den richtigen Creator
-- p_creator_id = null nimmt dem Lead den Creator (und storniert/gegenbucht die Provision).
create function correct_lead_creator(p_lead_id uuid, p_creator_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare l leads%rowtype; c commissions%rowtype; pay record;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  select * into l from leads where id = p_lead_id for update;
  if not found then raise exception 'Lead nicht gefunden'; end if;
  if p_creator_id is not null and not exists (select 1 from creators where id = p_creator_id) then
    raise exception 'Creator nicht gefunden';
  end if;
  if l.creator_id is not distinct from p_creator_id then return; end if;

  update leads set creator_id = p_creator_id where id = l.id;
  insert into lead_events (lead_id, actor_id, event_type, detail)
  values (l.id, current_profile_id(), 'creator_corrected',
          jsonb_build_object('from', l.creator_id, 'to', p_creator_id, 'reason', p_reason));

  for c in select * from commissions
            where lead_id = l.id and type = 'creator' and reverses_commission_id is null and status in ('open', 'paid_out')
              and not reversed
  loop
    if c.status = 'open' then
      update commissions set status = 'cancelled' where id = c.id;
    else
      update commissions set reversed = true where id = c.id;
      insert into commissions (payment_id, lead_id, type, creator_id, base_amount, rate, amount, status, reverses_commission_id)
      values (c.payment_id, c.lead_id, 'creator', c.creator_id, c.base_amount, c.rate, -c.amount, 'open', c.id);
    end if;
  end loop;

  if p_creator_id is not null then
    for pay in select id from payments where lead_id = l.id and status = 'confirmed' loop
      perform ensure_commissions(pay.id);
    end loop;
  end if;
end $$;

-- Creator einer ganzen Ad korrigieren (Massenkorrektur). p_since = nur Leads ab diesem Zeitpunkt (null = alle Leads der Ad).
-- Gibt die Zahl der geänderten Leads zurück.
create function reassign_ad_creator(p_ad_id uuid, p_creator_id uuid, p_reason text, p_since timestamptz default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if not exists (select 1 from ads where id = p_ad_id) then raise exception 'Ad nicht gefunden'; end if;
  for r in select id from leads
            where ad_id = p_ad_id and creator_id is distinct from p_creator_id
              and (p_since is null or created_at >= p_since)
  loop
    perform correct_lead_creator(r.id, p_creator_id, p_reason);
    v_n := v_n + 1;
  end loop;
  update ads set creator_id = p_creator_id where id = p_ad_id;   -- danach bekommen auch neue Leads den richtigen Creator
  return v_n;
end $$;

-- Rückforderung abschließen: Eine negative, offene Zeile (Gegenbuchung nach Storno einer schon ausgezahlten Provision),
-- für die es keine neue positive Zeile zum Verrechnen gibt. Der Admin hält fest, was passiert ist
-- (z. B. "Person hat 100 EUR zurücküberwiesen am ...", "mit Mai-Auszahlung verrechnet", "abgeschrieben, Auftraggeber verzichtet").
create function settle_clawback(p_commission_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Notiz nötig'; end if;
  update commissions set status = 'settled', settled_at = now(), settled_by = current_profile_id(), settle_note = p_note
   where id = p_commission_id and status = 'open' and amount < 0;
  if not found then raise exception 'Nur offene Rückforderungen (negative Zeilen) können abgeschlossen werden'; end if;
end $$;

-- Eine Auszahlung = eine Person, mehrere offene Provisionen
create function create_payout(p_commission_ids uuid[], p_reference text, p_paid_at date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_n int; v_rec uuid; v_cre uuid; v_total numeric; v_distinct int; v_id uuid;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  perform 1 from commissions where id = any (p_commission_ids) for update;
  select count(*), count(distinct coalesce(recruiter_id, creator_id)), sum(amount),
         min(recruiter_id::text)::uuid, min(creator_id::text)::uuid
    into v_n, v_distinct, v_total, v_rec, v_cre
    from commissions where id = any (p_commission_ids) and status = 'open';
  if v_n is null or v_n = 0 or v_n <> cardinality(p_commission_ids) then
    raise exception 'Nur offene Provisionen erlaubt';
  end if;
  if v_distinct <> 1 then raise exception 'Eine Auszahlung gilt für genau eine Person'; end if;
  -- 0 ist erlaubt: eine Storno-Gegenbuchung (-100) und die neue Provision (+100) gleichen sich aus und werden zusammen abgehakt.
  if v_total < 0 then raise exception 'Summe darf nicht negativ sein. Eine Rückforderung ohne Gegenposten schließt du mit settle_clawback ab (zurückgezahlt, verrechnet oder abgeschrieben, mit Notiz)'; end if;
  insert into payouts (recruiter_id, creator_id, total, reference, paid_at, created_by)
  values (v_rec, v_cre, v_total, p_reference, p_paid_at, current_profile_id()) returning id into v_id;
  update commissions set status = 'paid_out', payout_id = v_id where id = any (p_commission_ids);
  return v_id;
end $$;

-- ---------- Auszahlungsliste: Wer bekommt wie viel? ----------
-- Eine Zeile je Person (Recruiter oder Creator/Model). Das ist die Liste, an der der Admin nach der Zahlungsbestätigung abhakt.
-- "Onboardet" = Lead, dessen bestätigte Zahlung für diese Person noch zählt (Netto der Provisionen dieses Leads über 0).
-- Ein stornierter Lead zählt nicht mehr. onboarded_open = davon noch nicht ausgezahlt.
create view v_payout_list with (security_invoker = true) as
with lines as (
  select 'recruiter'::text as person_type, recruiter_id as person_id, lead_id, amount, status
    from commissions where type = 'recruiter' and status <> 'cancelled'
  union all
  select 'creator'::text, creator_id, lead_id, amount, status
    from commissions where type = 'creator' and status <> 'cancelled'
), per_lead as (
  select person_type, person_id, lead_id,
         sum(amount)                                                    as net,
         coalesce(sum(amount) filter (where status = 'open'), 0)        as open_amt,
         count(*) filter (where status = 'open')                        as open_cnt,
         coalesce(sum(amount) filter (where status = 'paid_out'), 0)    as paid_amt
    from lines group by person_type, person_id, lead_id
), per_person as (
  select person_type, person_id,
         count(*) filter (where net > 0)       as onboarded_total,
         count(*) filter (where open_amt > 0)  as onboarded_open,
         sum(open_amt)                         as open_amount,
         sum(open_cnt)                         as open_lines,
         sum(paid_amt)                         as paid_out_total
    from per_lead group by person_type, person_id
)
select pp.person_type, pp.person_id,
       coalesce(pr.full_name, cr.name) as person_name,
       coalesce(pr.iban, cr.iban)      as iban,
       pp.onboarded_total, pp.onboarded_open,
       pp.open_amount, pp.open_lines, pp.paid_out_total,
       (select max(po.paid_at) from payouts po
         where po.voided_at is null and coalesce(po.recruiter_id, po.creator_id) = pp.person_id) as last_paid_at
  from per_person pp
  left join profiles pr on pp.person_type = 'recruiter' and pr.id = pp.person_id
  left join creators cr on pp.person_type = 'creator'   and cr.id = pp.person_id;

-- Abhaken: alle offenen Provisionen EINER Person auf einmal als ausgezahlt buchen (ein Klick in der Auszahlungsliste).
-- p_expected_total ist der Betrag, den der Admin in der Liste gesehen hat. Hat er sich inzwischen geändert
-- (neue Bestätigung, Storno), bricht die Funktion ab, statt einen anderen Betrag zu buchen.
create function pay_person(p_person_type text, p_person_id uuid, p_expected_total numeric,
                           p_reference text default null, p_paid_at date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_total numeric;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if p_person_type not in ('recruiter', 'creator') then raise exception 'Typ muss recruiter oder creator sein'; end if;
  select array_agg(id), sum(amount) into v_ids, v_total from commissions
   where status = 'open' and type = p_person_type::commission_type
     and (case p_person_type when 'recruiter' then recruiter_id else creator_id end) = p_person_id;
  if v_ids is null then raise exception 'Für diese Person ist nichts offen'; end if;
  if v_total is distinct from p_expected_total then
    raise exception 'Der offene Betrag hat sich geändert (jetzt % EUR, erwartet % EUR). Liste neu laden und prüfen', v_total, p_expected_total;
  end if;
  return create_payout(v_ids, p_reference, p_paid_at);
end $$;

-- Falsch abgehakt? Auszahlung zurücknehmen: die Zeilen werden wieder offen, die Auszahlung bleibt mit Grund als Nachweis stehen.
create function undo_payout(p_payout_id uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception 'Nur Admin'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  perform 1 from payouts where id = p_payout_id for update;
  if exists (select 1 from commissions where payout_id = p_payout_id and reversed) then
    raise exception 'Zu dieser Auszahlung gehört eine schon gegengebuchte Provision. Nicht zurücknehmen: die offene Gegenbuchung verrechnen oder mit settle_clawback abschließen';
  end if;
  update payouts set voided_at = now(), voided_by = current_profile_id(), void_reason = p_reason
   where id = p_payout_id and voided_at is null;
  if not found then raise exception 'Auszahlung nicht gefunden oder schon zurückgenommen'; end if;
  update commissions set status = 'open', payout_id = null where payout_id = p_payout_id and status = 'paid_out';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- Row Level Security ----------
alter table payments    enable row level security;
alter table payouts     enable row level security;
alter table commissions enable row level security;

create policy admin_read_payments    on payments    for select to authenticated using ((select is_admin()));
create policy admin_read_payouts     on payouts     for select to authenticated using ((select is_admin()));
create policy admin_read_commissions on commissions for select to authenticated using ((select is_admin()));

create policy recruiter_payments_select on payments for select to authenticated
  using (exists (select 1 from leads l where l.id = payments.lead_id and l.recruiter_id = (select current_profile_id())));
create policy recruiter_commissions_select on commissions for select to authenticated
  using (recruiter_id = (select current_profile_id()));
create policy recruiter_payouts_select on payouts for select to authenticated
  using (recruiter_id = (select current_profile_id()) and voided_at is null);

-- Geld nur über die Funktionen oben, nie direkt
revoke insert, update, delete, truncate on payments, payouts, commissions from authenticated, anon;

revoke execute on function ensure_commissions(uuid), report_payment(uuid, date, text, text), confirm_payment(uuid),
  reject_payment(uuid, text), reverse_payment(uuid, text), backfill_commissions(uuid), backfill_missing_commissions(),
  correct_lead_creator(uuid, uuid, text), reassign_ad_creator(uuid, uuid, text, timestamptz), settle_clawback(uuid, text),
  create_payout(uuid[], text, date), pay_person(text, uuid, numeric, text, date), undo_payout(uuid, text) from public, anon, authenticated;
grant execute on function report_payment(uuid, date, text, text), confirm_payment(uuid),
  reject_payment(uuid, text), reverse_payment(uuid, text), backfill_commissions(uuid), backfill_missing_commissions(),
  correct_lead_creator(uuid, uuid, text), reassign_ad_creator(uuid, uuid, text, timestamptz), settle_clawback(uuid, text),
  create_payout(uuid[], text, date), pay_person(text, uuid, numeric, text, date), undo_payout(uuid, text) to authenticated;

revoke all on all tables in schema public from anon;

-- ---------- Beleg-Speicher (privat). Pfadregel: <lead_id>/<dateiname> ----------
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

create policy proofs_admin on storage.objects for all to authenticated
  using (bucket_id = 'payment-proofs' and (select is_admin()))
  with check (bucket_id = 'payment-proofs' and (select is_admin()));
create policy proofs_recruiter_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and exists (
    select 1 from leads l where l.id::text = (storage.foldername(name))[1] and l.recruiter_id = (select current_profile_id())));
create policy proofs_recruiter_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and exists (
    select 1 from leads l where l.id::text = (storage.foldername(name))[1] and l.recruiter_id = (select current_profile_id())));
