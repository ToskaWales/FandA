-- ============================================================================
-- 003_ads_ai.sql  |  Ad-Kennzahlen, Auswertungsfunktionen, KI-Berichte, Videoideen
-- Voraussetzung: 001_core.sql, 002_money.sql
-- ============================================================================

-- Tageswerte pro Ad (vom täglichen Meta-Sync; letzte 7 Tage werden jeweils neu überschrieben)
create table ad_stats (
  ad_id        uuid not null references ads (id) on delete cascade,
  day          date not null,
  spend        numeric(12,2) not null default 0,   -- in Konto-Währung (Annahme: EUR)
  impressions  bigint not null default 0,
  reach        bigint not null default 0,
  link_clicks  bigint not null default 0,
  meta_leads   int    not null default 0,          -- Leads laut Meta (nur zum Abgleich)
  video_3s     bigint not null default 0,          -- 3-Sekunden-Wiedergaben
  thruplays    bigint not null default 0,          -- ThruPlay (15 s oder komplett)
  raw          jsonb,
  synced_at    timestamptz not null default now(),
  primary key (ad_id, day)
);

create table ad_reports (
  id           uuid primary key default gen_random_uuid(),
  period_from  date not null,
  period_to    date not null,
  kind         text not null default 'weekly',
  input_json   jsonb not null,        -- genau die Zahlen, die die KI bekam (Nachvollziehbarkeit)
  report_json  jsonb,                 -- strukturierte Antwort der KI
  report_md    text,                  -- lesbarer Bericht
  model        text,
  status       text not null default 'ok' check (status in ('ok', 'failed')),
  error        text,
  created_at   timestamptz not null default now(),
  unique (kind, period_from, period_to)
);

create table video_ideas (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid references ad_reports (id) on delete set null,
  based_on_ad   uuid references ads (id) on delete set null,
  title         text not null,
  hook          text not null,        -- erste 3 Sekunden
  script        text not null,
  creator_hint  text,
  status        text not null default 'new' check (status in ('new', 'accepted', 'produced', 'rejected')),
  created_at    timestamptz not null default now()
);
create index video_ideas_status_idx on video_ideas (status, created_at desc);

-- Kennzahlen je Ad für einen Zeitraum.
-- Kohorten-Logik: Kosten = Ausgaben im Zeitraum; Leads = im Zeitraum entstandene Leads;
-- "paid" = von genau diesen Leads, egal wann sie später bezahlt haben.
-- qualified_leads = Leads, die IRGENDWANN den Status conversation/onboarding/paid erreicht haben (aus lead_events, nicht nur aktueller Status),
--   damit Leads, die im Gespräch waren und dann "lost" wurden, weiter als Gespräch zählen.
-- age_days = Alter der Ad am Ende des Zeitraums (Meta-Erstellzeit, sonst erster Ausgabetag, sonst erster Eintrag im CRM).
create function ad_performance(p_from date, p_to date)
returns table (
  ad_id uuid, meta_ad_id text, ad_name text, creator_id uuid, creator_name text, recruiter_id uuid,
  spend numeric, impressions bigint, link_clicks bigint, video_3s bigint, thruplays bigint,
  meta_leads bigint, leads bigint, qualified_leads bigint, paid_leads bigint,
  revenue numeric, commissions_total numeric,
  cpl numeric, cost_per_paid numeric, close_rate numeric, qualified_rate numeric,
  ctr numeric, hook_rate numeric, hold_rate numeric, net_after_commissions numeric,
  age_days int
)
language sql stable security invoker set search_path = public as $$
  with s as (
    select ad_id, sum(spend) spend, sum(impressions) impressions, sum(link_clicks) link_clicks,
           sum(video_3s) video_3s, sum(thruplays) thruplays, sum(meta_leads) meta_leads
      from ad_stats where day between p_from and p_to group by ad_id),
  l as (
    select ad_id, count(*) leads,
           count(*) filter (where status in ('conversation', 'onboarding', 'paid')
                              or exists (select 1 from lead_events e
                                          where e.lead_id = leads.id and e.event_type = 'status_changed'
                                            and e.detail ->> 'to' in ('conversation', 'onboarding', 'paid'))) qualified,
           count(*) filter (where status = 'paid') paid
      from leads
     where ad_id is not null
       and (created_at at time zone 'Europe/Berlin')::date between p_from and p_to
     group by ad_id),
  m as (
    select ld.ad_id,
           coalesce(sum(p.amount), 0) revenue,
           coalesce(sum(c.amount), 0) commissions
      from leads ld
      left join payments p on p.lead_id = ld.id and p.status = 'confirmed'
      left join lateral (select sum(amount) amount from commissions cc
                          where cc.lead_id = ld.id and cc.status <> 'cancelled') c on true
     where ld.ad_id is not null
       and (ld.created_at at time zone 'Europe/Berlin')::date between p_from and p_to
     group by ld.ad_id)
  select a.id, a.meta_ad_id, a.name, a.creator_id, cr.name, a.recruiter_id,
         coalesce(s.spend, 0), coalesce(s.impressions, 0), coalesce(s.link_clicks, 0),
         coalesce(s.video_3s, 0), coalesce(s.thruplays, 0), coalesce(s.meta_leads, 0),
         coalesce(l.leads, 0), coalesce(l.qualified, 0), coalesce(l.paid, 0),
         coalesce(m.revenue, 0), coalesce(m.commissions, 0),
         round(s.spend / nullif(l.leads, 0), 2),
         round(s.spend / nullif(l.paid, 0), 2),
         round(l.paid::numeric / nullif(l.leads, 0), 4),
         round(l.qualified::numeric / nullif(l.leads, 0), 4),
         round(s.link_clicks::numeric / nullif(s.impressions, 0), 4),
         round(s.video_3s::numeric / nullif(s.impressions, 0), 4),
         round(s.thruplays::numeric / nullif(s.video_3s, 0), 4),
         coalesce(m.revenue, 0) - coalesce(m.commissions, 0) - coalesce(s.spend, 0),
         greatest(0, p_to - coalesce((a.meta_created_at at time zone 'Europe/Berlin')::date,
                                     (select min(x.day) from ad_stats x where x.ad_id = a.id and x.spend > 0),
                                     (a.first_seen_at at time zone 'Europe/Berlin')::date))::int
    from ads a
    left join creators cr on cr.id = a.creator_id
    left join s on s.ad_id = a.id
    left join l on l.ad_id = a.id
    left join m on m.ad_id = a.id
   where s.ad_id is not null or l.ad_id is not null
   order by coalesce(s.spend, 0) desc;
$$;

-- Richtwerte (Mediane) über die belastbaren Ads des Zeitraums. Belastbar = mindestens 15 Leads ODER 150 EUR Ausgaben.
-- Kosten pro bezahltem Lead zählt nur bei Ads mit mindestens 3 bezahlten Leads. Leere Werte (null) bleiben außen vor.
-- Die Wochenauswertung bekommt diese Zahlen fertig und rechnet sie nicht selbst.
create function ad_benchmarks(p_from date, p_to date)
returns table (ads_belastbar int, median_cpl numeric, median_cost_per_paid numeric, median_qualified_rate numeric)
language sql stable security invoker set search_path = public as $$
  with a as (select * from ad_performance(p_from, p_to) where leads >= 15 or spend >= 150)
  select count(*)::int,
         round((percentile_cont(0.5) within group (order by cpl))::numeric, 2),
         round((percentile_cont(0.5) within group (order by cost_per_paid) filter (where paid_leads >= 3))::numeric, 2),
         round((percentile_cont(0.5) within group (order by qualified_rate))::numeric, 4)
    from a;
$$;

-- Je Creator zusammengefasst
create function creator_performance(p_from date, p_to date)
returns table (creator_id uuid, creator_name text, ads_count bigint, spend numeric, leads bigint,
               paid_leads bigint, cpl numeric, cost_per_paid numeric, close_rate numeric, net_after_commissions numeric)
language sql stable security invoker set search_path = public as $$
  select creator_id, coalesce(creator_name, '(nicht zugeordnet)'), count(*), sum(spend), sum(leads), sum(paid_leads),
         round(sum(spend) / nullif(sum(leads), 0), 2),
         round(sum(spend) / nullif(sum(paid_leads), 0), 2),
         round(sum(paid_leads)::numeric / nullif(sum(leads), 0), 4),
         sum(net_after_commissions)
    from ad_performance(p_from, p_to)
   group by creator_id, creator_name
   order by sum(spend) desc;
$$;

-- Hinweis: Meta-Leads vs. eigene Leads (Datenqualität: sollten ungefähr gleich sein)
create view v_lead_reconciliation with (security_invoker = true) as
select s.day, sum(s.meta_leads) as meta_leads,
       -- nur echte Instant-Form-Leads (haben eine meta_lead_id). Website-Leads mit ad_id haben source = 'meta_ad', zählen hier aber NICHT mit.
       (select count(*) from leads l where l.meta_lead_id is not null
           and (l.created_at at time zone 'Europe/Berlin')::date = s.day) as crm_leads
  from ad_stats s group by s.day;

alter table ad_stats    enable row level security;
alter table ad_reports  enable row level security;
alter table video_ideas enable row level security;
create policy admin_all_ad_stats    on ad_stats    for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_ad_reports  on ad_reports  for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_video_ideas on video_ideas for all to authenticated using ((select is_admin())) with check ((select is_admin()));
revoke insert, update, delete, truncate on ad_stats, ad_reports from authenticated;  -- schreibt nur der Server (service_role)
revoke all on all tables in schema public from anon;
revoke execute on function ad_performance(date, date), creator_performance(date, date), ad_benchmarks(date, date) from public, anon;
grant  execute on function ad_performance(date, date), creator_performance(date, date), ad_benchmarks(date, date) to authenticated, service_role;
