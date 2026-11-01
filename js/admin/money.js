/* CRM: Zahlungen, Auszahlungsliste, Provisionen, Geld-Teil des Lead-Details, "Meine Provision".
   Nur sichtbar mit MONEY_ENABLED in js/config.js (erst nach der anwaltlichen Prüfung, Bauplan P2). */
(() => {
  const { h } = CRM;
  const PAY = { reported: 'Gemeldet', confirmed: 'Bestätigt', rejected: 'Abgelehnt', reversed: 'Storniert' };
  const COM = { open: 'Offen', paid_out: 'Ausgezahlt', cancelled: 'Storniert', settled: 'Erledigt' };
  const proofBtn = (path) => path ? h('button', { class: 'a-link', type: 'button', on: { click: async () => {
    const url = await CRM.run(null, () => CRM.signedUrl('payment-proofs', path)); if (url) window.open(url, '_blank', 'noopener');
  } } }, 'Beleg') : '–';

  const decide = (p) => {
    const box = h('div', 'a-inline');
    const act = (label, cls, fn, ok) => {
      const b = h('button', { class: cls, type: 'button' }, label);
      b.addEventListener('click', () => CRM.run(b, async () => { if (await fn() !== false) CRM.refresh(); }, ok));
      box.append(b);
    };
    if (p.status === 'reported') {
      act('Bestätigen', 'btn sm', () => CRM.rpc('confirm_payment', { p_payment_id: p.id }), 'Bestätigt: Lead ist geclosed, Provisionen sind angelegt.');
      act('Ablehnen', 'btn out sm', async () => {
        const r = window.prompt('Grund der Ablehnung:'); if (!r) return false;
        return CRM.rpc('reject_payment', { p_payment_id: p.id, p_reason: r });
      }, 'Abgelehnt.');
    }
    if (p.status === 'confirmed') {
      act('Stornieren', 'btn out sm', async () => {
        const r = window.prompt('Grund des Stornos (z. B. Rückbuchung der Bank):'); if (!r) return false;
        return CRM.rpc('reverse_payment', { p_payment_id: p.id, p_reason: r });
      }, 'Storniert. Ausgezahlte Provisionen stehen jetzt als Rückforderung offen.');
    }
    return box;
  };

  // ---------- Geld-Teil im Lead-Detail (wird von leads.js aufgerufen) ----------
  CRM.leadMoney = async (v, l, section) => {
    const admin = CRM.role === 'admin';
    const pays = await CRM.api(`payments?lead_id=eq.${l.id}&select=*,reporter:profiles!payments_reported_by_fkey(full_name),confirmer:profiles!payments_confirmed_by_fkey(full_name)&order=created_at.desc`);
    const kids = [CRM.table([
      { t: 'Status', v: (p) => PAY[p.status] }, { t: 'Betrag', v: (p) => CRM.eur(p.amount), cls: 'num' },
      { t: 'Überwiesen am', v: (p) => CRM.day(p.paid_on) }, { t: 'Referenz', v: (p) => p.reference || '–' }, { t: 'Beleg', v: (p) => proofBtn(p.proof_path) },
      { t: 'Gemeldet', v: (p) => `${CRM.fmt(p.reported_at)}${p.reporter ? ' · ' + p.reporter.full_name : ''}` },
      { t: 'Entscheidung', v: (p) => p.confirmed_at ? `${CRM.fmt(p.confirmed_at)} · ${p.confirmer?.full_name || ''}` : (p.decision_note || '–') },
      admin ? { t: '', v: decide } : null,
    ].filter(Boolean), pays, { empty: 'Noch keine Zahlung gemeldet.' })];

    if (!pays.some((p) => ['reported', 'confirmed'].includes(p.status)) && l.recruiter_id) {
      const day = CRM.input({ type: 'date', value: CRM.isoDay() });
      const ref = CRM.input({ placeholder: 'Verwendungszweck / Transaktions-Referenz' });
      const file = h('input', { type: 'file', accept: 'image/*,application/pdf' });
      const b = h('button', { class: 'btn', type: 'submit' }, 'Zahlung melden');
      const f = h('form', { class: 'a-form', novalidate: true }, h('div', 'a-grid2', CRM.field('Überwiesen am', day), CRM.field('Referenz', ref)), CRM.field('Beleg (optional)', file), b);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        CRM.run(b, async () => {
          let path = null;
          if (file.files[0]) {
            const safe = file.files[0].name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
            path = await CRM.upload('payment-proofs', `${l.id}/${Date.now()}-${safe}`, file.files[0]);
          }
          await CRM.rpc('report_payment', { p_lead_id: l.id, p_paid_on: day.value || null, p_reference: ref.value.trim() || null, p_proof_path: path });
          CRM.refresh();
        }, admin ? 'Gemeldet. Jetzt oben bestätigen.' : 'Gemeldet. Der Admin prüft den Zahlungseingang.');
      });
      kids.push(f);
    }

    if (admin) {
      const cres = await CRM.creators();
      const cs = CRM.select([['', '(kein Creator)'], ...cres.map((c) => [c.id, c.name])], l.creator_id);
      const cb = h('button', { class: 'btn out sm', type: 'button' }, 'Creator korrigieren');
      cb.addEventListener('click', () => CRM.run(cb, async () => {
        if ((cs.value || null) === (l.creator_id || null)) throw new Error('Das ist schon der eingetragene Creator.');
        const r = window.prompt('Grund der Korrektur:'); if (!r) return;
        await CRM.rpc('correct_lead_creator', { p_lead_id: l.id, p_creator_id: cs.value || null, p_reason: r }); CRM.refresh();
      }, 'Creator korrigiert, Provisionen angepasst.'));
      kids.push(h('div', 'a-inline', CRM.field('Creator dieses Leads', cs), cb));

      if (l.status === 'paid' && !l.converted_profile_id) {
        const sb = h('button', { class: 'btn out sm', type: 'button' }, 'Als Setter anlegen');
        sb.addEventListener('click', () => CRM.run(sb, async () => {
          const p = await CRM.insert('profiles', { role: 'setter', full_name: CRM.name(l), email: l.email, phone: l.phone });
          await CRM.patch('leads', l.id, { converted_profile_id: p.id }); CRM.clearCache(); CRM.go('team', p.id);
        }, 'Setter angelegt.'));
        kids.push(sb);
      } else if (l.converted_profile_id) kids.push(h('p', null, h('a', { href: '#team/' + l.converted_profile_id }, 'Ist als Setter angelegt →')));
    }
    v.append(section('Zahlung', ...kids));
  };

  // ---------- Zahlungen (Admin) ----------
  let payFilter = 'reported';
  CRM.page({
    id: 'payments', title: 'Zahlungen', roles: ['admin'], money: true,
    async render(v) {
      const rows = await CRM.api(`payments?select=*,lead:leads(id,lead_code,first_name,last_name,attribution_unconfirmed,recruiter:profiles!leads_recruiter_id_fkey(full_name))${payFilter ? '&status=eq.' + payFilter : ''}&order=reported_at.desc&limit=300`);
      v.append(h('h1', null, 'Zahlungen'),
        h('p', 'a-muted', 'Bestätigen erst nach Eingang auf dem Konto. Dann gilt der Lead als geclosed, und die Provisionen werden angelegt.'),
        CRM.tabs([['reported', 'Zu prüfen'], ['confirmed', 'Bestätigt'], ['rejected', 'Abgelehnt'], ['reversed', 'Storniert'], ['', 'Alle']], payFilter, (k) => { payFilter = k; CRM.refresh(); }),
        CRM.table([
          { t: 'Lead', v: (p) => h('a', { href: '#lead/' + p.lead.id }, `${p.lead.lead_code} · ${CRM.name(p.lead)}`) },
          { t: 'Betreuer', v: (p) => p.lead.recruiter?.full_name || h('span', 'a-error', 'keiner') },
          { t: 'Betrag', v: (p) => CRM.eur(p.amount), cls: 'num' },
          { t: 'Überwiesen am', v: (p) => CRM.day(p.paid_on) },
          { t: 'Referenz', v: (p) => p.reference || '–' },
          { t: 'Beleg', v: (p) => proofBtn(p.proof_path) },
          { t: 'Status', v: (p) => h('span', null, PAY[p.status], p.lead.attribution_unconfirmed && p.status === 'reported' ? CRM.badge('Zuordnung prüfen', 'warn') : null) },
          { t: '', v: decide },
        ], rows, { empty: payFilter === 'reported' ? 'Keine Zahlungen zu prüfen.' : 'Keine Einträge.' }));
    },
  });

  // ---------- Auszahlungsliste (Admin) ----------
  let payoutType = 'recruiter', onlyOpen = true;
  CRM.page({
    id: 'payouts', title: 'Auszahlungen', roles: ['admin'], money: true,
    async render(v) {
      let rows = await CRM.api(`v_payout_list?person_type=eq.${payoutType}&order=open_amount.desc`);
      if (onlyOpen) rows = rows.filter((r) => Number(r.open_amount) !== 0);
      const sum = rows.reduce((s, r) => s + Math.max(0, Number(r.open_amount)), 0);
      const recent = await CRM.api(`payouts?select=*,recruiter:profiles!payouts_recruiter_id_fkey(full_name),creator:creators(name)&order=created_at.desc&limit=20`);

      const lines = async (r, box) => {
        const col = payoutType === 'recruiter' ? 'recruiter_id' : 'creator_id';
        const ls = await CRM.api(`commissions?${col}=eq.${r.person_id}&type=eq.${payoutType}&status=eq.open&select=amount,created_at,lead:leads(id,lead_code,first_name,last_name)&order=created_at`);
        box.replaceChildren(CRM.table([
          { t: 'Lead', v: (c) => h('a', { href: '#lead/' + c.lead.id }, `${c.lead.lead_code} · ${CRM.name(c.lead)}`) },
          { t: 'Betrag', v: (c) => CRM.eur(c.amount), cls: 'num' }, { t: 'Gebucht', v: (c) => CRM.day(c.created_at) },
        ], ls));
      };
      const pay = (r) => {
        if (Number(r.open_amount) < 0) return h('a', { href: '#commissions' }, 'Rückforderung klären');
        if (Number(r.open_amount) === 0 && !Number(r.open_lines)) return '–';
        const b = h('button', { class: 'btn sm', type: 'button' }, 'Bezahlt ✓');
        b.addEventListener('click', () => CRM.run(b, async () => {
          const ref = window.prompt(`${CRM.eur(r.open_amount)} an ${r.person_name} als überwiesen abhaken.\nVerwendungszweck (optional):`, `Provision ${new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`);
          if (ref === null) return;
          await CRM.rpc('pay_person', { p_person_type: payoutType, p_person_id: r.person_id, p_expected_total: r.open_amount, p_reference: ref || null });
          CRM.refresh();
        }, 'Abgehakt.'));
        return b;
      };
      const table = CRM.table([
        { t: 'Name', v: (r) => r.person_name },
        { t: 'IBAN', v: (r) => r.iban || h('span', 'a-error', 'fehlt') },
        { t: 'Onboardet', v: (r) => `${r.onboarded_total} (neu ${r.onboarded_open})`, cls: 'num' },
        { t: 'Offen', v: (r) => h('strong', null, CRM.eur(r.open_amount)), cls: 'num' },
        { t: 'Ausgezahlt', v: (r) => CRM.eur(r.paid_out_total), cls: 'num' },
        { t: 'Zuletzt', v: (r) => CRM.day(r.last_paid_at) },
        { t: 'Zeilen', v: (r) => { const box = h('div'); return h('details', { on: { toggle: (e) => { if (e.target.open && !box.childNodes.length) lines(r, box); } } }, h('summary', null, `${r.open_lines} offen`), box); } },
        { t: '', v: pay },
      ], rows, { empty: 'Nichts offen.' });
      const exportBtn = h('button', { class: 'btn out sm', type: 'button', on: { click: () => CRM.csv(`auszahlung-${payoutType}-${CRM.isoDay()}.csv`,
        [['Name', 'IBAN', 'Betrag', 'Onboardet neu'], ...rows.filter((r) => Number(r.open_amount) > 0).map((r) => [r.person_name, r.iban, String(r.open_amount).replace('.', ','), r.onboarded_open])]) } }, 'CSV für Überweisung');
      const undo = (p) => {
        if (p.voided_at) return h('span', 'a-muted', `zurückgenommen: ${p.void_reason}`);
        const b = h('button', { class: 'a-link', type: 'button' }, 'Zurücknehmen');
        b.addEventListener('click', () => CRM.run(b, async () => {
          const r = window.prompt('Warum zurücknehmen (z. B. versehentlich abgehakt)?'); if (!r) return;
          await CRM.rpc('undo_payout', { p_payout_id: p.id, p_reason: r }); CRM.refresh();
        }, 'Zurückgenommen, die Zeilen sind wieder offen.'));
        return b;
      };
      const only = h('input', { type: 'checkbox', checked: onlyOpen, on: { change: (e) => { onlyOpen = e.target.checked; CRM.refresh(); } } });
      v.append(h('div', 'a-head', h('h1', null, 'Auszahlungen'), h('span', 'a-sum', `Offen gesamt: ${CRM.eur(sum)}`)),
        h('p', 'a-muted', 'Überweisen außerhalb des Systems, danach je Person abhaken. Hat sich der Betrag inzwischen geändert, bricht das Abhaken mit einer Meldung ab.'),
        CRM.tabs([['recruiter', 'Recruiter'], ['creator', 'Models (Creator)']], payoutType, (k) => { payoutType = k; CRM.refresh(); }),
        h('div', 'a-filters', h('label', 'a-check', only, ' nur mit offenem Betrag'), exportBtn), table,
        h('h2', null, 'Letzte Auszahlungen'),
        CRM.table([
          { t: 'Datum', v: (p) => CRM.day(p.paid_at) }, { t: 'Person', v: (p) => p.recruiter?.full_name || p.creator?.name || '–' },
          { t: 'Betrag', v: (p) => CRM.eur(p.total), cls: 'num' }, { t: 'Referenz', v: (p) => p.reference || '–' }, { t: '', v: undo },
        ], recent));
    },
  });

  // ---------- Provisionen (Einzelzeilen, Sonderfälle, Creator-Lücken) ----------
  let comTab = 'open';
  CRM.page({
    id: 'commissions', title: 'Provisionen', roles: ['admin'], money: true,
    async render(v) {
      v.append(h('h1', null, 'Provisionen'),
        CRM.tabs([['open', 'Offen'], ['claw', 'Rückforderungen'], ['gaps', 'Creator-Lücken'], ['all', 'Alle']], comTab, (k) => { comTab = k; CRM.refresh(); }));
      if (comTab === 'gaps') {
        const gaps = await CRM.api('v_creator_gaps?select=*&order=confirmed_at.desc');
        const b = h('button', { class: 'btn', type: 'button' }, 'Fehlende Creator-Provisionen nachtragen');
        b.addEventListener('click', () => CRM.run(b, async () => { const n = await CRM.rpc('backfill_missing_commissions'); CRM.flash(`${n} Provision(en) nachgetragen.`); CRM.refresh(); }));
        v.append(h('p', 'a-muted', '„Ad ohne Creator“: erst auf der Seite Ads den Creator eintragen, dann nachtragen.'), b,
          CRM.table([
            { t: 'Lead', v: (g) => h('a', { href: '#lead/' + g.lead_id }, g.lead_code) },
            { t: 'Problem', v: (g) => (g.problem === 'ad_ohne_creator' ? 'Ad ohne Creator' : 'Provision fehlt') },
            { t: 'Bestätigt', v: (g) => CRM.fmt(g.confirmed_at) },
          ], gaps, { empty: 'Keine Lücken.' }));
        return;
      }
      let q = 'commissions?select=*,lead:leads(id,lead_code),recruiter:profiles!commissions_recruiter_id_fkey(full_name),creator:creators(name)&order=created_at.desc&limit=500';
      if (comTab === 'open') q += '&status=eq.open';
      if (comTab === 'claw') q += '&status=eq.open&amount=lt.0';
      const rows = await CRM.api(q);
      const picked = new Set();
      const settle = (c) => {
        if (!(c.status === 'open' && Number(c.amount) < 0)) return c.settle_note ? h('span', 'a-muted', c.settle_note) : '';
        const b = h('button', { class: 'btn out sm', type: 'button' }, 'Abschließen');
        b.addEventListener('click', () => CRM.run(b, async () => {
          const n = window.prompt('Was ist passiert? (z. B. „100 EUR zurücküberwiesen am …“, „mit Mai-Auszahlung verrechnet“, „abgeschrieben“)'); if (!n) return;
          await CRM.rpc('settle_clawback', { p_commission_id: c.id, p_note: n }); CRM.refresh();
        }, 'Rückforderung abgeschlossen.'));
        return b;
      };
      const pb = h('button', { class: 'btn out sm', type: 'button' }, 'Ausgewählte auszahlen');
      pb.addEventListener('click', () => CRM.run(pb, async () => {
        if (!picked.size) throw new Error('Bitte offene Zeilen einer Person auswählen.');
        const ref = window.prompt('Verwendungszweck (optional):'); if (ref === null) return;
        await CRM.rpc('create_payout', { p_commission_ids: [...picked], p_reference: ref || null }); CRM.refresh();
      }, 'Als ausgezahlt gebucht.'));
      v.append(comTab === 'open' ? h('div', 'a-filters', h('p', 'a-muted', 'Normalfall ist der Haken auf „Auszahlungen“. Hier nur Sonderfälle (einzelne Zeilen einer Person).'), pb) : null,
        CRM.table([
          comTab === 'open' ? { t: '', v: (c) => h('input', { type: 'checkbox', 'aria-label': 'Auswählen', on: { change: (e) => { e.target.checked ? picked.add(c.id) : picked.delete(c.id); } } }) } : null,
          { t: 'Lead', v: (c) => h('a', { href: '#lead/' + c.lead.id }, c.lead.lead_code) },
          { t: 'Typ', v: (c) => (c.type === 'recruiter' ? 'Recruiter' : 'Creator') },
          { t: 'Person', v: (c) => c.recruiter?.full_name || c.creator?.name || '–' },
          { t: 'Betrag', v: (c) => CRM.eur(c.amount), cls: 'num' },
          { t: 'Status', v: (c) => COM[c.status] + (c.reverses_commission_id ? ' (Gegenbuchung)' : '') },
          { t: 'Gebucht', v: (c) => CRM.day(c.created_at) },
          { t: '', v: settle },
        ].filter(Boolean), rows, { empty: 'Keine Einträge.' }));
    },
  });

  // ---------- Meine Provision (Recruiter) ----------
  CRM.page({
    id: 'mine', title: 'Meine Provision', roles: ['recruiter'], money: true,
    async render(v) {
      const [sum] = await CRM.api('v_payout_list?person_type=eq.recruiter');
      const rows = await CRM.api('commissions?select=amount,status,created_at,lead:leads(id,lead_code,first_name,last_name)&order=created_at.desc&limit=300');
      v.append(h('h1', null, 'Meine Provision'),
        h('div', 'a-tiles',
          h('div', 'a-tile', h('span', 'a-tile-n', CRM.eur(sum?.open_amount ?? 0)), h('span', null, 'offen')),
          h('div', 'a-tile', h('span', 'a-tile-n', CRM.eur(sum?.paid_out_total ?? 0)), h('span', null, 'ausgezahlt')),
          h('div', 'a-tile', h('span', 'a-tile-n', String(sum?.onboarded_total ?? 0)), h('span', null, 'onboardet'))),
        CRM.table([
          { t: 'Lead', v: (c) => h('a', { href: '#lead/' + c.lead.id }, `${c.lead.lead_code} · ${CRM.name(c.lead)}`) },
          { t: 'Betrag', v: (c) => CRM.eur(c.amount), cls: 'num' }, { t: 'Status', v: (c) => COM[c.status] }, { t: 'Gebucht', v: (c) => CRM.day(c.created_at) },
        ], rows, { empty: 'Noch keine Provisionen.' }));
    },
  });
})();
