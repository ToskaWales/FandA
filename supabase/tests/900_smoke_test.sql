-- 900_smoke_test.sql  |  Abnahmetest. Läuft mit 001 allein (Kern-Tests) und mit 001-004 (zusätzlich Geld-Tests). Läuft in EINER Transaktion und räumt am Ende alles weg (rollback).
-- Vorher: im Supabase-Dashboard (Authentication > Users) drei Test-Nutzer anlegen und deren UUIDs unten eintragen.
-- Erfolg = es erscheint "Success"/keine Fehlermeldung. Bei einem Fehler nennt die Meldung den fehlgeschlagenen Test.
begin;

create function pg_temp.act_as(uid text) returns void language plpgsql as $f$
begin
  reset role;
  if uid is null then return; end if;
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;

do $t$
declare
  uid_admin text := '<UUID_ADMIN>';   -- <- ersetzen
  uid_anna  text := '<UUID_ANNA>';    -- <- ersetzen
  uid_ben   text := '<UUID_BEN>';     -- <- ersetzen
  anna uuid; ben uuid; cleo uuid; dora uuid; l_x uuid; l_y uuid; ad1 uuid; ad2 uuid; l_ref uuid; l_ad uuid; l_open uuid; pay uuid; pay2 uuid; n int;
  has_money boolean := to_regproc('public.confirm_payment') is not null;   -- false, solange nur 001 eingespielt ist
begin
  -- Aufbau (als Besitzer, ohne RLS)
  insert into profiles (auth_user_id, role, full_name) values (uid_admin::uuid, 'admin', 'Test Admin');
  insert into profiles (auth_user_id, role, full_name) values (uid_anna::uuid, 'recruiter', 'Test Anna') returning id into anna;
  insert into profiles (auth_user_id, role, full_name) values (uid_ben::uuid,  'recruiter', 'Test Ben')  returning id into ben;
  insert into creators (name) values ('Test Cleo') returning id into cleo;
  insert into ads (meta_ad_id, name, creator_id, recruiter_id) values ('T-AD1', 'Ad mit Ben', cleo, ben) returning id into ad1;
  insert into ads (meta_ad_id, name) values ('T-AD2', 'Ad ohne Betreuer') returning id into ad2;

  -- 1) Zuteilung: ref_code vor Ad, Ad vor offen
  insert into leads (first_name, source, ref_code, ad_id) values ('A', 'website', (select upper(ref_code) from profiles where id = anna), null) returning id into l_ref;
  insert into leads (first_name, source, ad_id) values ('B', 'meta_ad', ad1) returning id into l_ad;
  insert into leads (first_name, source, ad_id) values ('C', 'meta_ad', ad2) returning id into l_open;
  assert (select recruiter_id from leads where id = l_ref) = anna, 'T1 ref_code -> Anna';
  assert (select recruiter_id from leads where id = l_ad)  = ben,  'T2 Ad -> Ben';
  assert (select recruiter_id from leads where id = l_open) is null, 'T3 offen';
  update ads set recruiter_id = anna where id = ad2;
  assert (select recruiter_id from leads where id = l_open) = anna, 'T4 nachträglich zugewiesene Ad nimmt offene Leads mit';

  -- 2) Recruiter Anna: sieht nur eigene, darf keine fremden Felder ändern, darf nicht auf paid setzen
  perform pg_temp.act_as(uid_anna);
  select count(*) into n from leads;
  assert n = 2, 'T5 Anna sieht genau ihre 2 Leads, nicht ' || n;
  update leads set status = 'contacted' where id = l_ref;
  begin update leads set status = 'paid' where id = l_ref; assert false, 'T6 paid darf nicht gehen';
  exception when raise_exception then null; end;
  begin update leads set recruiter_id = ben where id = l_ref; assert false, 'T7 Umhängen darf nicht gehen';
  exception when raise_exception then null; end;
  if has_money then
  begin perform confirm_payment(gen_random_uuid()); assert false, 'T8 Recruiter darf nicht bestätigen';
  exception when raise_exception then null; end;
  pay := report_payment(l_ref, current_date, 'TEST-1');
  end if;

  perform pg_temp.act_as(uid_admin);
  if has_money then
  -- 3) Admin bestätigt: Lead paid, Provision Recruiter 100, ref-Lead hat keine Ad -> kein Creator
  perform confirm_payment(pay);
  assert (select status from leads where id = l_ref) = 'paid', 'T9 Lead paid';
  assert (select closed_by from leads where id = l_ref) = anna, 'T10 closed_by = Anna';
  assert (select amount from commissions where lead_id = l_ref and type = 'recruiter') = 100.00, 'T11 100 EUR';
  assert not exists (select 1 from commissions where lead_id = l_ref and type = 'creator'), 'T12 kein Creator ohne Ad';

  begin perform confirm_payment(pay); assert false, 'T12b zweites Bestätigen muss scheitern';
  exception when raise_exception then if sqlerrm like 'T12b%' then raise; end if; end;

  -- 4) Ad-Lead von Ben: Creator 5 % = 12,50
  perform pg_temp.act_as(uid_ben);
  pay := report_payment(l_ad, current_date, 'TEST-2');
  perform pg_temp.act_as(uid_admin);
  perform confirm_payment(pay);
  assert (select amount from commissions where lead_id = l_ad and type = 'creator') = 12.50, 'T13 Creator 12,50';

  -- 5) Auszahlung + Storno mit Gegenbuchung
  perform create_payout(array(select id from commissions where lead_id = l_ad and type = 'recruiter'), 'SEPA-TEST');
  assert (select status from commissions where lead_id = l_ad and type = 'recruiter') = 'paid_out', 'T14 ausgezahlt';
  perform reverse_payment(pay, 'Test-Storno');
  assert (select sum(amount) from commissions where lead_id = l_ad and type = 'recruiter') = 0, 'T15 Gegenbuchung gleicht aus';
  assert (select status from leads where id = l_ad) = 'onboarding', 'T16 Lead wieder offen';

  -- 5a) Storno nach Auszahlung, danach neue Zahlung: Gegenbuchung (-100) und neue Provision (+100) lassen sich zu 0 verrechnen und abhaken
  perform pg_temp.act_as(uid_ben);
  pay2 := report_payment(l_ad, current_date, 'TEST-2B');
  perform pg_temp.act_as(uid_admin);
  perform confirm_payment(pay2);
  perform create_payout(array(select id from commissions where lead_id = l_ad and type = 'recruiter' and status = 'open'), 'SEPA-NETTO');
  assert not exists (select 1 from commissions where lead_id = l_ad and type = 'recruiter' and status = 'open'), 'T23 Netto-Auszahlung 0 EUR schliesst offene Zeilen';
  end if;

  perform pg_temp.act_as(uid_admin);

  -- 5b) Creator wird am Lead eingefroren: spätere Änderung der Ad schreibt alte Leads nicht um
  insert into creators (name) values ('Test Dora') returning id into dora;
  insert into leads (first_name, source, ad_id) values ('X', 'meta_ad', ad1) returning id into l_x;
  update ads set creator_id = dora where id = ad1;
  insert into leads (first_name, source, ad_id) values ('Y', 'meta_ad', ad1) returning id into l_y;
  assert (select creator_id from leads where id = l_x) = cleo, 'T19 alter Lead behält Creator Cleo';
  assert (select creator_id from leads where id = l_y) = dora, 'T20 neuer Lead bekommt Creator Dora';

  -- 6) Verlauf ist nur anhängbar
  begin delete from lead_events; assert false, 'T17 Verlauf darf nicht löschbar sein';
  exception when raise_exception or insufficient_privilege then null; end;

  -- 6b) Dublettenprüfung des Formulars (E-Mail ODER Telefon), nur für den Server gedacht
  perform pg_temp.act_as(null);   -- zurück zum Besitzer (der Server nutzt service_role)
  insert into leads (first_name, phone, source) values ('P', '0151 2345678', 'website');
  assert recent_duplicate_lead(null, '+49 151 2345678'), 'T21 Dublette per Telefon erkannt';
  assert not recent_duplicate_lead(null, '0170 9999999'), 'T22 fremde Nummer ist keine Dublette';
  assert normalize_phone('+49 (0)151 2345678') = normalize_phone('0151 2345678'), 'T24 +49 (0)151 = 0151';
  assert recent_duplicate_lead(null, '+49 (0)151 2345678'), 'T25 Dublette trotz (0)';

  -- 6c) Zweite Anmeldung über einen Recruiter-Link: wird vermerkt, offener Lead wandert zum Link-Besitzer
  insert into leads (first_name, phone, source) values ('Q', '0160 1112223', 'website') returning id into l_open;
  assert (select recruiter_id from leads where id = l_open) is null, 'T26 Q ist offen';
  perform note_repeat_submission(null, '+49 160 1112223', (select ref_code from profiles where id = ben), 'fbgroup', null);
  assert (select recruiter_id from leads where id = l_open) = ben, 'T27 zweiter Link teilt offenen Lead zu';
  assert exists (select 1 from lead_events where lead_id = l_open and event_type = 'repeat_submission'), 'T28 Vermerk im Verlauf';

  -- 6d) Neue Ads werden vorbelegt (Namensregel, Vererbung) und der Admin kann korrigieren
  perform pg_temp.act_as(uid_admin);
  declare a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; a9 uuid; k1 uuid; k2 uuid; sv uuid;
  begin
    update creators set code = 'T-Cleo' where id = cleo;
    assert (select code from creators where id = cleo) = 't-cleo', 'T29 Creator-Code wird kleingeschrieben';
    insert into ads (meta_ad_id, name) values ('T-AD3', format('Hook B [ref:%s] [cr:t-cleo]', (select upper(ref_code) from profiles where id = ben))) returning id into a3;
    assert (select recruiter_id from ads where id = a3) = ben and (select creator_id from ads where id = a3) = cleo
       and (select defaults_from from ads where id = a3) = 'name', 'T30 Namensregel [ref:..] [cr:..]';
    insert into ads (meta_ad_id, name, meta_adset_id, recruiter_id, creator_id) values ('T-AD4', 'Original', 'S1', anna, cleo) returning id into a4;
    insert into ads (meta_ad_id, name, meta_adset_id) values ('T-AD5', 'Kopie', 'S1') returning id into a5;
    assert (select recruiter_id from ads where id = a5) = anna and (select creator_id from ads where id = a5) = cleo
       and (select defaults_from from ads where id = a5) = 'adset', 'T31 Kopie erbt Recruiter/Creator aus derselben Anzeigengruppe';
    insert into leads (first_name, source, ad_id) values ('K', 'meta_ad', a5) returning id into k1;
    assert (select recruiter_id from leads where id = k1) = anna and (select creator_id from leads where id = k1) = cleo
       and (select assignment_reason from leads where id = k1) = 'ad', 'T32 Lead der kopierten Ad geht sofort an Anna, Creator Cleo';
    insert into ads (meta_ad_id, name, meta_adset_id, recruiter_id) values ('T-AD6', 'S2a', 'S2', anna), ('T-AD7', 'S2b', 'S2', ben);
    insert into ads (meta_ad_id, name, meta_adset_id) values ('T-AD8', 'S2neu', 'S2') returning id into a6;
    assert (select recruiter_id from ads where id = a6) is null, 'T33 widersprüchliche Schwester-Ads: nichts raten';
    insert into ads (meta_ad_id, name, meta_campaign_id, recruiter_id) values ('T-AD9', 'C1a', 'C1', ben);
    insert into ads (meta_ad_id, name, meta_adset_id, meta_campaign_id) values ('T-AD10', 'C1neu', 'S9', 'C1') returning id into a7;
    assert (select recruiter_id from ads where id = a7) = ben and (select defaults_from from ads where id = a7) = 'campaign', 'T34 Vererbung über die Kampagne';
    update ads set recruiter_id = ben where id = a5;
    assert (select defaults_from from ads where id = a5) is null, 'T35 Änderung von Hand = bestätigt';
    assert (select attribution_unconfirmed from leads where id = k1) is not null, 'T32b Spalte attribution_unconfirmed vorhanden';
    -- 6d2) geerbte Zuordnung: markiert, korrigierbar, bestätigbar
    declare a10 uuid; k3 uuid;
    begin
      insert into ads (meta_ad_id, name, meta_adset_id, meta_campaign_id) values ('T-AD12', 'C1neu2', 'S10', 'C1') returning id into a10;
      insert into leads (first_name, source, ad_id) values ('K3', 'meta_ad', a10) returning id into k3;
      assert (select recruiter_id from leads where id = k3) = ben and (select attribution_unconfirmed from leads where id = k3), 'T32c geerbte Zuordnung ist am Lead markiert';
      n := reassign_ad_recruiter(a10, anna, 'Test: falsch geerbt');
      assert n = 1 and (select recruiter_id from leads where id = k3) = anna, 'T32d Massenkorrektur des Recruiters';
      n := confirm_ad_attribution(a10);
      assert n = 1 and not (select attribution_unconfirmed from leads where id = k3), 'T32e Bestätigung löscht die Markierung';
    end;
    insert into ads (meta_ad_id, name) values ('T-AD11', 'noch ohne Zuordnung') returning id into a8;
    insert into leads (first_name, source, ad_id) values ('K2', 'meta_ad', a8) returning id into k2;
    assert (select recruiter_id from leads where id = k2) is null, 'T36 Lead dieser Ad ist offen';
    update ads set name = format('noch ohne Zuordnung [ref:%s]', (select ref_code from profiles where id = anna)) where id = a8;
    assert (select recruiter_id from ads where id = a8) = anna and (select recruiter_id from leads where id = k2) = anna,
      'T37 spätere Umbenennung mit [ref:..] ordnet Ad und offene Leads zu';

    -- 6e) Datenschutz: Löschung = Anonymisierung; IBAN steht nicht im Verlauf
    update profiles set iban = 'DE89370400440532013000' where id = anna;
    assert not exists (select 1 from audit_log where table_name = 'profiles' and (new_data ? 'iban' or old_data ? 'iban')), 'T38 keine IBAN im Verlauf';
    insert into leads (first_name, last_name, email, phone, source) values ('Max', 'Muster', 'max@example.org', '0170 1234567', 'website') returning id into k1;
    perform add_lead_note(k1, 'Max Muster rief zurück, Tel. 0170 1234567');
    perform erase_lead(k1, 'Löschanfrage');
    assert (select first_name from leads where id = k1) = '[gelöscht]' and (select email from leads where id = k1) is null
       and (select phone_norm from leads where id = k1) is null, 'T39 Lead anonymisiert';
    assert not exists (select 1 from lead_events where lead_id = k1 and detail ? 'text'), 'T40 Notiztext entfernt';
    assert exists (select 1 from lead_events where lead_id = k1 and event_type = 'erased'), 'T41 Löschung im Verlauf vermerkt';
    if has_money then
      declare lp uuid; pp uuid;
      begin
        lp := create_manual_lead('Paula', 'Zahl', null, '0172 9990001');
        pp := report_payment(lp, current_date, 'Paula Zahl Überweisung');
        perform erase_lead(lp, 'Löschanfrage');
        assert not exists (select 1 from audit_log where table_name = 'payments' and row_id = pp::text
                             and (coalesce(new_data, '{}'::jsonb) ? 'reference' or coalesce(old_data, '{}'::jsonb) ? 'reference')), 'T41b Verwendungszweck auch aus dem Verlauf der Zahlung entfernt';
      end;
    end if;
    insert into profiles (role, full_name, email, phone) values ('setter', 'Test Sven', 'sven@example.org', '0151 000') returning id into sv;
    perform erase_profile(sv, 'Löschanfrage');
    assert (select full_name from profiles where id = sv) = '[gelöscht]' and (select email from profiles where id = sv) is null, 'T42 Betreuer anonymisiert';
    assert not exists (select 1 from audit_log where table_name = 'profiles' and row_id = sv::text
                         and (coalesce(new_data ->> 'email', old_data ->> 'email') is not null or coalesce(new_data ->> 'full_name', old_data ->> 'full_name') like 'Test Sven%')),
      'T43 Personendaten auch aus dem Verlauf entfernt';
    insert into creators (name, email, iban) values ('Test Fritz', 'fritz@example.org', 'DE00') returning id into k2;
    perform erase_creator(k2, 'Löschanfrage');
    assert (select name from creators where id = k2) = '[gelöscht]' and (select iban from creators where id = k2) is null
       and not exists (select 1 from audit_log where table_name = 'creators' and row_id = k2::text and coalesce(new_data ->> 'name', old_data ->> 'name') like 'Test Fritz%'), 'T43b Creator anonymisiert, auch im Verlauf';
    perform pg_temp.act_as(null);   -- Besitzer: ohne die Löschfunktion bleibt der Verlauf unveränderlich
    begin update lead_events set detail = '{}'::jsonb where event_type = 'created'; assert false, 'T44 Verlauf darf ohne Löschfunktion nicht änderbar sein';
    exception when raise_exception then null; end;
    perform pg_temp.act_as(uid_admin);

    if has_money then
      -- 5c) Rückforderung ohne Gegenposten lässt sich abschließen
      declare lz uuid; pz uuid; ua uuid; ul uuid; up uuid; cid uuid; eva uuid; b1 uuid; le1 uuid; le2 uuid; le3 uuid; p1 uuid; p2 uuid; p3 uuid; b2 uuid; n2 int;
      begin
        perform pg_temp.act_as(uid_ben);
        lz := create_manual_lead('Z', 'Z', null, '0171 5550001');
        pz := report_payment(lz, current_date, 'TEST-Z');
        perform pg_temp.act_as(uid_admin);
        perform confirm_payment(pz);
        perform create_payout(array(select id from commissions where lead_id = lz and type = 'recruiter'), 'SEPA-Z');
        perform reverse_payment(pz, 'Bank-Rückbuchung');
        select id into cid from commissions where lead_id = lz and amount < 0 and status = 'open';
        assert cid is not null, 'T45 Gegenbuchung -100 ist offen';
        begin perform create_payout(array[cid], 'x'); assert false, 'T46 negative Auszahlung darf nicht gehen';
        exception when raise_exception then null; end;
        perform settle_clawback(cid, 'Person hat 100 EUR zurücküberwiesen');
        assert (select status from commissions where id = cid) = 'settled', 'T47 Rückforderung abgeschlossen';
        assert not exists (select 1 from commissions where lead_id = lz and status = 'open'), 'T48 nichts bleibt offen';
        begin perform settle_clawback(cid, 'nochmal'); assert false, 'T49 zweites Abschließen muss scheitern';
        exception when raise_exception then null; end;

        -- 5c2) Zahlung eines Leads mit ungeprüfter, geerbter Zuordnung wird nicht bestätigt
        insert into ads (meta_ad_id, name, meta_campaign_id, recruiter_id) values ('T-AD30', 'U1', 'CU', ben);
        insert into ads (meta_ad_id, name, meta_adset_id, meta_campaign_id) values ('T-AD31', 'U2', 'SU', 'CU') returning id into ua;
        insert into leads (first_name, source, ad_id) values ('U', 'meta_ad', ua) returning id into ul;
        up := report_payment(ul, current_date, 'U');
        begin perform confirm_payment(up); assert false, 'T49b Bestätigung bei ungeprüfter Zuordnung muss scheitern';
        exception when raise_exception then null; end;
        perform confirm_lead_attribution(ul);
        perform confirm_payment(up);
        assert (select status from leads where id = ul) = 'paid', 'T49c nach Prüfung geht die Bestätigung';

        -- 5d) Falschen Creator korrigieren: einzeln, nach Auszahlung, und für eine ganze Ad
        insert into creators (name, code) values ('Test Eva', 't-eva') returning id into eva;
        insert into ads (meta_ad_id, name, creator_id, recruiter_id) values ('T-AD20', 'Fehler-Ad', cleo, ben) returning id into b1;
        insert into leads (first_name, source, ad_id) values ('E1', 'meta_ad', b1) returning id into le1;
        insert into leads (first_name, source, ad_id) values ('E2', 'meta_ad', b1) returning id into le2;
        p1 := report_payment(le1, current_date, 'E1'); perform confirm_payment(p1);
        assert (select creator_id from commissions where lead_id = le1 and type = 'creator' and status = 'open') = cleo, 'T50 Creator-Provision für Cleo';
        begin update leads set creator_id = dora where id = le1; assert false, 'T50a direkte Änderung des Lead-Creators muss scheitern';
        exception when raise_exception then null; end;
        perform correct_lead_creator(le1, dora, 'falscher Creator');
        assert (select creator_id from commissions where lead_id = le1 and type = 'creator' and status = 'open') = dora
           and (select count(*) from commissions where lead_id = le1 and type = 'creator' and status = 'cancelled') = 1
           and (select creator_id from leads where id = le1) = dora, 'T51 offene Provision storniert und für Dora neu angelegt';
        assert exists (select 1 from lead_events where lead_id = le1 and event_type = 'creator_corrected'), 'T52 Korrektur im Verlauf';
        perform create_payout(array(select id from commissions where lead_id = le1 and type = 'creator' and status = 'open'), 'SEPA-D');
        perform correct_lead_creator(le1, eva, 'doch Eva');
        assert exists (select 1 from commissions where lead_id = le1 and creator_id = dora and amount = -12.50 and status = 'open')
           and exists (select 1 from commissions where lead_id = le1 and creator_id = eva and amount = 12.50 and status = 'open'), 'T53 nach Auszahlung: Gegenbuchung für Dora, neue Provision für Eva';
        p2 := report_payment(le2, current_date, 'E2'); perform confirm_payment(p2);
        n2 := reassign_ad_creator(b1, dora, 'Ad gehört Dora');
        assert n2 = 2 and (select creator_id from ads where id = b1) = dora
           and (select count(*) from leads where ad_id = b1 and creator_id = dora) = 2, 'T54 Massenkorrektur der Ad';
        assert (select sum(amount) from commissions where lead_id = le1 and type = 'creator' and creator_id = dora and status <> 'cancelled') = 12.50, 'T55 Dora netto 12,50 (Hin und Zurück bucht sauber)';
        assert coalesce((select sum(amount) from commissions where lead_id = le1 and type = 'creator' and creator_id = eva and status <> 'cancelled'), 0) = 0, 'T56 Eva netto 0 nach Rückkorrektur';
        perform reverse_payment(p1, 'Test-Storno nach Korrekturen');
        assert (select sum(amount) from commissions where lead_id = le1 and type = 'creator' and status <> 'cancelled') = 0, 'T57 Storno nach Korrekturen bucht nicht doppelt';

        -- Lücke: bezahlt, aber die Ad hatte noch keinen Creator
        insert into ads (meta_ad_id, name, recruiter_id) values ('T-AD21', 'ohne Creator', ben) returning id into b2;
        insert into leads (first_name, source, ad_id) values ('E3', 'meta_ad', b2) returning id into le3;
        p3 := report_payment(le3, current_date, 'E3'); perform confirm_payment(p3);
        assert (select problem from v_creator_gaps where lead_id = le3) = 'ad_ohne_creator', 'T58 Lücke sichtbar: Ad ohne Creator';
        update ads set creator_id = cleo where id = b2;
        assert (select problem from v_creator_gaps where lead_id = le3) = 'provision_fehlt', 'T59 Creator nachgetragen, Provision fehlt noch';
        assert backfill_missing_commissions() >= 1, 'T60 Sammel-Nachtrag legt die fehlende Provision an';
        assert not exists (select 1 from v_creator_gaps where lead_id = le3)
           and (select amount from commissions where lead_id = le3 and type = 'creator') = 12.50, 'T61 Lücke geschlossen, 12,50 EUR';

        -- 5e) Auszahlungsliste: je Person Zahl der Onboardings und Betrag, abhaken, zurücknehmen
        declare rita uuid; kim uuid; kad uuid; k1 uuid; k2 uuid; k3 uuid; kp1 uuid; kp2 uuid; kp3 uuid; po1 uuid; po2 uuid; v record;
        begin
          insert into profiles (role, full_name) values ('recruiter', 'Test Rita') returning id into rita;
          insert into creators (name) values ('Test Kim') returning id into kim;
          insert into ads (meta_ad_id, name, creator_id, recruiter_id) values ('T-AD40', 'Listen-Ad', kim, rita) returning id into kad;
          insert into leads (first_name, source, ad_id) values ('K1', 'meta_ad', kad) returning id into k1;
          insert into leads (first_name, source, ad_id) values ('K2', 'meta_ad', kad) returning id into k2;
          insert into leads (first_name, source, ad_id) values ('K3', 'meta_ad', kad) returning id into k3;
          kp1 := report_payment(k1, current_date, 'K1'); perform confirm_payment(kp1);
          kp2 := report_payment(k2, current_date, 'K2'); perform confirm_payment(kp2);

          select * into v from v_payout_list where person_type = 'recruiter' and person_id = rita;
          assert v.person_name = 'Test Rita' and v.onboarded_total = 2 and v.onboarded_open = 2 and v.open_amount = 200 and v.paid_out_total = 0,
            'T62 Liste: Recruiter Rita, 2 onboardet, 200 EUR offen';
          select * into v from v_payout_list where person_type = 'creator' and person_id = kim;
          assert v.person_name = 'Test Kim' and v.onboarded_total = 2 and v.open_amount = 25,
            'T63 Liste: Model Kim, 2 über ihre Ad onboardet, 25 EUR offen';

          begin perform pay_person('recruiter', rita, 199, 'falscher Betrag'); assert false, 'T64 Abhaken mit anderem Betrag als angezeigt muss scheitern';
          exception when raise_exception then null; end;
          po1 := pay_person('recruiter', rita, 200, 'SEPA-RITA');
          assert not exists (select 1 from commissions where recruiter_id = rita and status = 'open')
             and (select total from payouts where id = po1) = 200, 'T65 Haken bucht alle offenen Zeilen, Auszahlung 200 EUR';
          select * into v from v_payout_list where person_type = 'recruiter' and person_id = rita;
          assert v.open_amount = 0 and v.onboarded_open = 0 and v.onboarded_total = 2 and v.paid_out_total = 200 and v.last_paid_at = current_date,
            'T66 Liste nach dem Haken: nichts offen, 2 onboardet, 200 EUR ausgezahlt';
          assert (select open_amount from v_payout_list where person_type = 'creator' and person_id = kim) = 25, 'T67 Kim bleibt offen';
          begin perform pay_person('recruiter', rita, 200, 'nochmal'); assert false, 'T68 zweites Abhaken muss scheitern (nichts offen)';
          exception when raise_exception then null; end;

          kp3 := report_payment(k3, current_date, 'K3'); perform confirm_payment(kp3);
          select * into v from v_payout_list where person_type = 'recruiter' and person_id = rita;
          assert v.onboarded_total = 3 and v.onboarded_open = 1 and v.open_amount = 100, 'T69 neuer Abschluss: 3 onboardet, davon 1 neu mit 100 EUR offen';

          perform pg_temp.act_as(uid_ben);
          begin perform undo_payout(po1, 'darf Ben nicht'); assert false, 'T70 Zurücknehmen nur für Admin';
          exception when raise_exception then null; end;
          assert not exists (select 1 from v_payout_list where person_id = rita), 'T71 Recruiter Ben sieht Ritas Zeile nicht';
          perform pg_temp.act_as(uid_admin);

          n2 := undo_payout(po1, 'versehentlich abgehakt');   -- erst aufrufen, dann prüfen (dieselbe Abfrage sähe die Änderung noch nicht)
          assert n2 = 2
             and (select count(*) from commissions where recruiter_id = rita and status = 'open') = 3
             and (select voided_at from payouts where id = po1) is not null, 'T72 Zurücknehmen: 2 Zeilen wieder offen, Auszahlung bleibt mit Grund stehen';
          select * into v from v_payout_list where person_type = 'recruiter' and person_id = rita;
          assert v.open_amount = 300 and v.paid_out_total = 0 and v.last_paid_at is null, 'T73 Liste nach dem Zurücknehmen: 300 EUR offen, nichts ausgezahlt';
          begin perform undo_payout(po1, 'nochmal'); assert false, 'T74 zweites Zurücknehmen muss scheitern';
          exception when raise_exception then null; end;

          po2 := pay_person('recruiter', rita, 300, 'SEPA-RITA-2');
          perform reverse_payment(kp1, 'Bank-Rückbuchung K1');
          begin perform undo_payout(po2, 'geht nicht nach Storno'); assert false, 'T75 Zurücknehmen nach gegengebuchter Provision muss scheitern';
          exception when raise_exception then null; end;
          select * into v from v_payout_list where person_type = 'recruiter' and person_id = rita;
          assert v.onboarded_total = 2 and v.open_amount = -100, 'T76 Storniert: K1 zählt nicht mehr (2 onboardet), -100 EUR Rückforderung offen';
        end;
      end;
    end if;
  end;

  -- 6f) Inhaber: nur er verwaltet Admins (ab 000500_owner.sql)
  if to_regproc('public.is_owner') is not null then
    perform pg_temp.act_as(null); perform set_config('request.jwt.claim.sub', '', true);
    update profiles set is_owner = false where is_owner;                      -- falls schon ein echter Inhaber existiert (wird zurückgerollt)
    update profiles set is_owner = true where auth_user_id = uid_admin::uuid;
    update profiles set role = 'admin' where id = anna;                       -- Anna wird zweite Admin, nicht Inhaberin
    perform pg_temp.act_as(uid_anna);
    assert not is_owner(), 'T80 Anna ist nicht Inhaberin';
    begin update profiles set active = false where auth_user_id = uid_admin::uuid; assert false, 'T81 Admin darf den Inhaber nicht deaktivieren';
    exception when raise_exception then null; end;
    begin insert into profiles (role, full_name) values ('admin', 'Test Neu-Admin'); assert false, 'T82 Admin darf keine Admins anlegen';
    exception when raise_exception then null; end;
    update profiles set phone = '0151 777' where id = anna;
    assert (select phone from profiles where id = anna) = '0151 777', 'T83 Admin darf eigenes Telefon ändern';
    begin update profiles set active = false where id = anna; assert false, 'T84 Admin darf sich nicht selbst deaktivieren';
    exception when raise_exception then null; end;
    insert into profiles (role, full_name) values ('recruiter', 'Test Neu-Recruiter');
    begin update profiles set role = 'admin' where full_name = 'Test Neu-Recruiter'; assert false, 'T85 Admin darf niemanden zum Admin machen';
    exception when raise_exception then null; end;
    begin perform erase_profile((select id from profiles where auth_user_id = uid_admin::uuid), 'x'); assert false, 'T86 Admin darf den Inhaber nicht löschen';
    exception when raise_exception then null; end;
    perform pg_temp.act_as(uid_admin);
    assert is_owner(), 'T87 Test-Admin ist Inhaber';
    insert into profiles (role, full_name) values ('admin', 'Test Admin Zwei');
    update profiles set active = false where id = anna;
    assert not (select active from profiles where id = anna), 'T88 Inhaber darf Admins anlegen und deaktivieren';
  end if;

  -- 7) Anonyme Besucher sehen nichts
  perform pg_temp.act_as(null);
  set local role anon;
  begin perform count(*) from leads; assert false, 'T18 anon darf leads nicht lesen';
  exception when insufficient_privilege then null; end;
  reset role;
  if has_money then raise notice 'Alle Tests bestanden';
  else raise notice 'Kern-Tests bestanden (Geld-Tests uebersprungen: 002_money.sql fehlt noch)'; end if;
end $t$;

rollback;
