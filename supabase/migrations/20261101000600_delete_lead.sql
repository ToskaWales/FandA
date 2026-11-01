-- ============================================================================
-- 000600_delete_lead.sql  |  Unseriöse Leads (Fake, Spam, Test) ganz löschen
-- Nur Admins, nur Leads ohne Einzahlung (an Einzahlungen hängen Buchungen, die nie verschwinden dürfen).
-- Der Lead verschwindet mit Notizen und Verlauf; im audit_log bleibt ein Vermerk ohne Personendaten.
-- Voraussetzung: 001_core.sql
-- ============================================================================

-- Verlauf bleibt nur-anhängend. Neue Ausnahme: delete_lead() darf die Verlaufszeilen DIESES Leads löschen.
create or replace function forbid_modification() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('app.allow_erase', true) = 'on' then return new; end if;
  if tg_op = 'DELETE' and tg_table_name = 'lead_events' and current_setting('app.allow_delete_lead', true) = 'on' then return old; end if;
  raise exception '% ist nur zum Anhängen da (kein Ändern/Löschen)', tg_table_name;
end $$;

create function delete_lead(p_lead_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare l leads%rowtype; v_paid boolean := false;
begin
  if not is_admin() then raise exception 'Nur Admins dürfen Leads löschen'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Grund nötig'; end if;
  select * into l from leads where id = p_lead_id for update;
  if not found then raise exception 'Lead nicht gefunden'; end if;
  if to_regclass('public.payments') is not null then      -- Tabelle gibt es erst ab 002
    execute 'select exists (select 1 from payments where lead_id = $1)' into v_paid using p_lead_id;
  end if;
  if v_paid then
    raise exception 'Zu diesem Lead gibt es eine Einzahlung, darum kann er nicht gelöscht werden. Stattdessen „Verloren“ wählen oder die Personendaten löschen.';
  end if;

  update leads set possible_duplicate_of = null where possible_duplicate_of = p_lead_id;
  update meta_webhook_events set lead_id = null where lead_id = p_lead_id;
  perform set_config('app.allow_delete_lead', 'on', true);
  delete from lead_events where lead_id = p_lead_id;
  perform set_config('app.allow_delete_lead', 'off', true);
  delete from leads where id = p_lead_id;

  insert into audit_log (table_name, row_id, action, actor_profile_id, old_data)
  values ('leads', p_lead_id::text, 'DELETE', current_profile_id(),
          jsonb_build_object('lead_code', l.lead_code, 'source', l.source, 'created_at', l.created_at, 'reason', p_reason));
end $$;
revoke execute on function delete_lead(uuid, text) from public, anon;
grant  execute on function delete_lead(uuid, text) to authenticated;
