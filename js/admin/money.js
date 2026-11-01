/* CRM: Einzahlungen, Auszahlen, Buchungen, Geld-Teil der Lead-Seite, "Mein Geld".
   Sichtbar nur mit MONEY_ENABLED in js/config.js (Bauplan P2). */
(() => {
  const { h } = CRM;
  const PAY = { reported: ['Gemeldet, wartet auf Prüfung', 'warn'], confirmed: ['Bestätigt', 'ok'], rejected: ['Abgelehnt', 'off'], reversed: ['Storniert', 'bad'] };
  const COM = { open: 'Offen', paid_out: 'Ausgezahlt', cancelled: 'Storniert', settled: 'Erledigt' };
  const payChip = (s) => CRM.chip(PAY[s][0], PAY[s][1]);
  const proofBtn = (path) => path ? CRM.btn('Beleg ansehen', async (e) => {
    const url = await CRM.run(e.currentTarget, () => CRM.signedUrl('payment-proofs', path)); if (url) window.open(url, '_blank', 'noopener');
  }, 'soft sm') : null;

  // Bestätigen / Ablehnen / Stornieren mit eigenem Fenster
  const decide = (p, who) => {
    const out = [];
    if (p.status === 'reported') {
      const ok = CRM.btn('Geld ist da – bestätigen', async () => {
        if (!await CRM.confirm('Einzahlung bestätigen?', `${CRM.eur(p.amount)} von ${who} sind auf dem Konto eingegangen. Danach gilt der Lead als abgeschlossen, und die Provisionen werden gebucht.`, 'Ja, bestätigen')) return;
        CRM.run(ok, async () => { await CRM.rpc('confirm_payment', { p_payment_id: p.id }); CRM.refresh(); }, 'Bestätigt ✓ Provisionen sind gebucht.');
      }, 'green sm', 'check');
      const no = CRM.btn('Ablehnen', async () => {
        const r = await CRM.ask({ title: 'Einzahlung ablehnen?', text: 'Zum Beispiel, wenn kein Geld angekommen ist. Der Recruiter kann danach neu melden.', ok: 'Ablehnen', danger: true,
          fields: [{ name: 'reason', label: 'Grund', placeholder: 'z. B. Kein Zahlungseingang', required: true }] });
        if (r) CRM.run(no, async () => { await CRM.rpc('reject_payment', { p_payment_id: p.id, p_reason: r.reason }); CRM.refresh(); }, 'Abgelehnt.');
      }, 'soft sm');
      out.push(ok, no);
    }
    if (p.status === 'confirmed') {
      const rev = h('button', { type: 'button', class: 'link link--danger', on: { click: async () => {
        const r = await CRM.ask({ title: 'Einzahlung stornieren?', text: 'Nur wenn das Geld zurückging (z. B. Rückbuchung der Bank). Noch nicht ausgezahlte Provisionen fallen weg; schon ausgezahlte erscheinen als „zu viel ausgezahlt“.',
          ok: 'Stornieren', danger: true, fields: [{ name: 'reason', label: 'Grund', placeholder: 'z. B. Rückbuchung der Bank am …', required: true }] });
        if (r) CRM.run(rev, async () => { await CRM.rpc('reverse_payment', { p_payment_id: p.id, p_reason: r.reason }); CRM.refresh(); }, 'Storniert.');
      } } }, 'Stornieren');
      out.push(rev);
    }
    return out;
  };

  // ---------- Geld-Teil auf der Lead-Seite ----------
  CRM.leadMoney = async (side, l) => {
    const admin = CRM.role === 'admin';
    const [pays, setting] = await Promise.all([
      CRM.api(`payments?lead_id=eq.${l.id}&select=*,reporter:profiles!payments_reported_by_fkey(full_name)&order=created_at.desc`),
      CRM.api('app_settings?key=eq.payment_amount_eur&select=value').catch(() => []),
    ]);
    const amount = setting[0]?.value;
    const card = h('section', 'card', h('h2', null, `Einzahlung${amount ? ' (' + CRM.eur(amount) + ')' : ''}`));
    const active = pays.find((p) => ['reported', 'confirmed'].includes(p.status));
    pays.forEach((p) => card.append(h('div', 'stack', { style: 'margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)' },
      h('div', 'spread', payChip(p.status), h('strong', null, CRM.eur(p.amount))),
      CRM.facts([['Überwiesen am', CRM.day(p.paid_on)], ['Verwendungszweck', p.reference], ['Gemeldet', `${CRM.when(p.reported_at)}${p.reporter ? ' von ' + p.reporter.full_name : ''}`], ['Grund', p.decision_note]]),
      h('div', 'row', proofBtn(p.proof_path), admin ? decide(p, CRM.name(l)) : null))));

    if (!active && l.status !== 'lost') {
      if (!l.recruiter_id) { card.append(h('p', 'soft', { style: 'margin-top:8px' }, 'Erst einen Recruiter zuteilen, dann kann die Einzahlung gemeldet werden.')); side.append(card); return; }
      const day = CRM.input({ type: 'date', value: CRM.isoDay() }), ref = CRM.input({ placeholder: 'wie auf dem Kontoauszug' });
      const file = h('input', { type: 'file', accept: 'image/*,application/pdf' });
      const b = h('button', { class: 'btn', type: 'submit' }, 'Einzahlung melden');
      const f = h('form', { class: 'stack', novalidate: true, hidden: true }, CRM.field('Überwiesen am', day), CRM.field('Verwendungszweck', ref), CRM.field('Foto/PDF vom Beleg (optional)', file), h('div', null, b));
      const open = CRM.btn('Kunde hat überwiesen', () => { f.hidden = false; open.hidden = true; day.focus(); }, 'ghost');
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
        }, admin ? 'Gemeldet. Jetzt noch bestätigen.' : 'Gemeldet ✓ Der Admin prüft den Eingang.');
      });
      card.append(h('p', 'soft', { style: 'margin:8px 0 12px' }, pays.length ? 'Neue Einzahlung melden:' : 'Noch keine Einzahlung gemeldet.'), open, f);
    }
    side.append(card);
  };

  // "Weitere Aktionen" auf der Lead-Seite (Admin)
  CRM.leadMoreActions = async (box, l) => {
    const cres = await CRM.creators();
    const cs = CRM.select([['', '(kein Model)'], ...cres.map((c) => [c.id, c.name])], l.creator_id, { 'aria-label': 'Model' });
    const cb = CRM.btn('Ändern', async () => {
      if ((cs.value || null) === (l.creator_id || null)) { CRM.flash('Das ist schon das eingetragene Model.', true); return; }
      const r = await CRM.ask({ title: 'Model ändern?', text: 'Schon gebuchte Provisionen werden automatisch korrigiert.', ok: 'Ändern', fields: [{ name: 'reason', label: 'Grund', required: true, placeholder: 'z. B. falsches Model eingetragen' }] });
      if (r) CRM.run(cb, async () => { await CRM.rpc('correct_lead_creator', { p_lead_id: l.id, p_creator_id: cs.value || null, p_reason: r.reason }); CRM.refresh(); }, 'Model geändert ✓');
    }, 'ghost sm');
    box.append(h('div', null, h('label', { style: 'font-weight:600;font-size:14px' }, 'Model dieses Leads'), h('div', 'row', { style: 'margin-top:6px' }, h('div', { style: 'flex:1 1 160px' }, cs), cb)));
  };

  // ---------- Einzahlungen prüfen ----------
  let payFilter = 'reported';
  CRM.page({
    id: 'payments', title: 'Einzahlungen prüfen', label: 'Einzahlungen', group: 'Geld', icon: 'money', roles: ['admin'], money: true, tab: 4, tabLabel: 'Geld',
    badge: () => CRM.count('payments?status=eq.reported'),
    async render(v) {
      const rows = await CRM.api(`payments?select=*,reporter:profiles!payments_reported_by_fkey(full_name),lead:leads(id,lead_code,first_name,last_name,attribution_unconfirmed,recruiter:profiles!leads_recruiter_id_fkey(full_name))${payFilter ? '&status=eq.' + payFilter : ''}&order=reported_at.desc&limit=300`);
      v.append(CRM.head('Einzahlungen prüfen', 'Recruiter melden hier, dass ein Bewerber überwiesen hat. Schau aufs Konto: Ist das Geld da, bestätige. Dann ist der Lead abgeschlossen und die Provisionen sind gebucht.'),
        CRM.pills([['reported', 'Zu prüfen'], ['confirmed', 'Bestätigt'], ['rejected', 'Abgelehnt'], ['reversed', 'Storniert'], ['', 'Alle']], payFilter, (k) => { payFilter = k; CRM.refresh(); }));
      if (!rows.length) { v.append(payFilter === 'reported' ? h('div', 'card done-all', h('span', 'ok', CRM.icon('check')), h('div', null, h('h2', null, 'Nichts zu prüfen'), h('p', 'soft', 'Alle gemeldeten Einzahlungen sind erledigt.'))) : CRM.empty('Keine Einträge.')); return; }
      v.append(h('div', 'cards', rows.map((p) => h('article', 'card person',
        h('div', 'spread', h('a', { href: '#lead/' + p.lead.id, style: 'font-weight:700;font-size:17px' }, CRM.name(p.lead)), payChip(p.status)),
        h('div', 'amount', CRM.eur(p.amount)),
        CRM.facts([['Überwiesen am', CRM.day(p.paid_on)], ['Verwendungszweck', p.reference || '–'], ['Recruiter', p.lead.recruiter?.full_name || CRM.chip('keiner', 'bad')], ['Gemeldet', CRM.when(p.reported_at)], ['Grund', p.decision_note]]),
        p.lead.attribution_unconfirmed && p.status === 'reported' ? CRM.note('', h('span', null, 'Erst die Zuordnung prüfen: ', h('a', { href: '#lead/' + p.lead.id }, 'Lead öffnen'))) : null,
        h('div', 'row', proofBtn(p.proof_path), decide(p, CRM.name(p.lead)))))));
    },
  });

  // ---------- Auszahlen ----------
  let payoutType = 'recruiter';
  CRM.page({
    id: 'payouts', title: 'Auszahlen', group: 'Geld', icon: 'payout', roles: ['admin'], money: true,
    async render(v) {
      const [all, recent] = await Promise.all([
        CRM.api(`v_payout_list?person_type=eq.${payoutType}&order=open_amount.desc`),
        CRM.api('payouts?select=*,recruiter:profiles!payouts_recruiter_id_fkey(full_name),creator:creators(name)&order=created_at.desc&limit=15'),
      ]);
      const rows = all.filter((r) => Number(r.open_amount) !== 0 || Number(r.open_lines));
      const sum = rows.reduce((s, r) => s + Math.max(0, Number(r.open_amount)), 0);
      const who = payoutType === 'recruiter' ? 'Recruiter' : 'Models';

      const person = (r) => {
        const amt = Number(r.open_amount);
        const lines = h('div');
        const det = h('details', null, h('summary', { style: 'cursor:pointer;font-weight:600;font-size:14px' }, `Für welche Leads? (${r.onboarded_open})`), lines);
        det.addEventListener('toggle', async () => {
          if (!det.open || lines.childNodes.length) return;
          const col = payoutType === 'recruiter' ? 'recruiter_id' : 'creator_id';
          const ls = await CRM.api(`commissions?${col}=eq.${r.person_id}&type=eq.${payoutType}&status=eq.open&select=amount,lead:leads(id,lead_code,first_name,last_name)&order=created_at`);
          lines.replaceChildren(h('ul', { style: 'margin:8px 0 0;padding-left:18px' }, ls.map((c) => h('li', null, h('a', { href: '#lead/' + c.lead.id }, CRM.name(c.lead)), ` · ${CRM.eur(c.amount)}`))));
        });
        let action;
        if (amt < 0) action = CRM.note('', h('span', null, `Es wurde ${CRM.eur(-amt)} zu viel ausgezahlt (Einzahlung später storniert).`), h('a', { class: 'btn btn--sm', href: '#commissions/claw' }, 'Klären'));
        else if (amt > 0) {
          const b = CRM.btn(`${CRM.eur(amt)} überwiesen`, async () => {
            const res = await CRM.ask({ title: `${r.person_name} auszahlen`, text: `Bitte zuerst ${CRM.eur(amt)} an ${r.iban || '(IBAN fehlt!)'} überweisen. Dann hier abhaken.`, ok: 'Ist überwiesen ✓',
              fields: [{ name: 'ref', label: 'Verwendungszweck', value: `Provision ${new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}` }] });
            if (res) CRM.run(b, async () => { await CRM.rpc('pay_person', { p_person_type: payoutType, p_person_id: r.person_id, p_expected_total: r.open_amount, p_reference: res.ref || null }); CRM.refresh(); }, 'Abgehakt ✓');
          }, 'green', 'check');
          action = b;
        } else action = h('p', 'soft', 'Gleicht sich aus (0 €). Einfach abhaken: ', h('button', { type: 'button', class: 'link', on: { click: () => CRM.run(null, async () => { await CRM.rpc('pay_person', { p_person_type: payoutType, p_person_id: r.person_id, p_expected_total: r.open_amount }); CRM.refresh(); }, 'Erledigt ✓') } }, 'Erledigt'));
        return h('article', 'card person',
          h('div', 'spread', h('h3', null, r.person_name), CRM.chip(`${r.onboarded_open} neu`, 'new')),
          h('div', 'amount', CRM.eur(amt)),
          CRM.facts([['IBAN', r.iban || CRM.chip('fehlt – im Team eintragen', 'bad')], ['Bisher ausgezahlt', CRM.eur(r.paid_out_total)], ['Zuletzt', CRM.day(r.last_paid_at)], ['Insgesamt geworben', String(r.onboarded_total)]]),
          det, action);
      };

      const undo = (p) => p.voided_at ? CRM.chip('zurückgenommen', 'off') : h('button', { type: 'button', class: 'link', on: { click: async (e) => {
        const r = await CRM.ask({ title: 'Haken zurücknehmen?', text: 'Nur wenn du versehentlich abgehakt hast. Der Betrag erscheint dann wieder als offen.', ok: 'Zurücknehmen', fields: [{ name: 'reason', label: 'Grund', required: true, placeholder: 'z. B. versehentlich abgehakt' }] });
        if (r) CRM.run(e.target, async () => { await CRM.rpc('undo_payout', { p_payout_id: p.id, p_reason: r.reason }); CRM.refresh(); }, 'Zurückgenommen.');
      } } }, 'Rückgängig');

      v.append(CRM.head('Auszahlen', 'So viel bekommen Recruiter und Models für bestätigte Einzahlungen. Überweise den Betrag, dann klicke den grünen Knopf.',
        rows.some((r) => Number(r.open_amount) > 0) ? CRM.btn('Liste für die Bank (CSV)', () => CRM.csv(`auszahlung-${payoutType}-${CRM.isoDay()}.csv`,
          [['Name', 'IBAN', 'Betrag', 'Verwendungszweck'], ...rows.filter((r) => Number(r.open_amount) > 0).map((r) => [r.person_name, r.iban, String(r.open_amount).replace('.', ','), 'Provision'])]), 'ghost') : null),
        CRM.pills([['recruiter', 'Recruiter'], ['creator', 'Models']], payoutType, (k) => { payoutType = k; CRM.refresh(); }),
        rows.length ? h('div', null, h('p', { style: 'font-size:18px;margin-bottom:14px' }, 'Offen: ', h('strong', null, CRM.eur(sum))), h('div', 'cards', rows.map(person)))
          : h('div', 'card done-all', h('span', 'ok', CRM.icon('check')), h('div', null, h('h2', null, 'Alles ausgezahlt'), h('p', 'soft', `Gerade ist für ${who} nichts offen.`))),
        CRM.section('Zuletzt abgehakt'),
        CRM.table([
          { t: 'Person', cls: 'main', v: (p) => p.recruiter?.full_name || p.creator?.name || '–' },
          { t: 'Betrag', cls: 'num', v: (p) => CRM.eur(p.total) }, { t: 'Datum', v: (p) => CRM.day(p.paid_at) },
          { t: 'Verwendungszweck', cls: 'hide-m', v: (p) => p.reference || '–' }, { t: '', cls: 'bare', v: undo },
        ], recent, { empty: 'Noch nichts ausgezahlt.' }));
    },
  });

  // ---------- Buchungen (Sonderfälle) ----------
  let comTab = 'open';
  CRM.page({
    id: 'commissions', title: 'Buchungen', group: 'Geld', icon: 'list', roles: ['admin'], money: true,
    async render(v, arg) {
      if (['open', 'claw', 'gaps', 'all'].includes(arg)) comTab = arg;
      v.append(CRM.head('Buchungen', 'Jede einzelne Provision. Meist brauchst du diese Seite nicht: Ausgezahlt wird auf „Auszahlen“. Hier klärst du Sonderfälle.'),
        CRM.pills([['open', 'Offen'], ['claw', 'Zu viel ausgezahlt'], ['gaps', 'Model fehlt'], ['all', 'Alle']], comTab, (k) => CRM.go('commissions', k)));
      if (comTab === 'gaps') {
        const gaps = await CRM.api('v_creator_gaps?select=*&order=confirmed_at.desc');
        const b = CRM.btn('Fehlende Model-Provisionen nachtragen', () => CRM.run(b, async () => { const n = await CRM.rpc('backfill_missing_commissions'); CRM.flash(`${n} nachgetragen ✓`); CRM.refresh(); }));
        v.append(CRM.note('info', h('span', null, 'Bezahlte Leads aus einer Anzeige, für die (noch) keine Model-Provision gebucht ist. Steht „Anzeige ohne Model“: erst auf der Seite Anzeigen das Model eintragen, dann nachtragen.')), h('div', { style: 'height:14px' }),
          gaps.length ? h('div', { style: 'margin-bottom:14px' }, b) : null,
          CRM.table([
            { t: 'Lead', cls: 'main', v: (g) => h('a', { href: '#lead/' + g.lead_id }, g.lead_code) },
            { t: 'Problem', v: (g) => (g.problem === 'ad_ohne_creator' ? CRM.chip('Anzeige ohne Model', 'warn') : CRM.chip('Provision fehlt', 'warn')) },
            { t: 'Bestätigt', v: (g) => CRM.when(g.confirmed_at) },
          ], gaps, { empty: 'Alles in Ordnung.', emptyText: 'Kein bezahlter Lead ohne Model-Provision.' }));
        return;
      }
      let q = 'commissions?select=*,lead:leads(id,lead_code,first_name,last_name),recruiter:profiles!commissions_recruiter_id_fkey(full_name),creator:creators(name)&order=created_at.desc&limit=500';
      if (comTab === 'open') q += '&status=eq.open';
      if (comTab === 'claw') q += '&status=eq.open&amount=lt.0';
      const rows = await CRM.api(q);
      const settle = (c) => {
        if (!(c.status === 'open' && Number(c.amount) < 0)) return c.settle_note ? h('span', 'soft', c.settle_note) : '';
        return CRM.btn('Erledigt', async (e) => {
          const btn = e.currentTarget;
          const r = await CRM.ask({ title: 'Wie wurde das geklärt?', text: `${CRM.eur(-c.amount)} wurden zu viel ausgezahlt.`, ok: 'Als erledigt markieren',
            fields: [{ name: 'how', label: 'Was ist passiert?', required: true, options: [['', 'Bitte wählen …'], ['Wurde zurücküberwiesen', 'Wurde zurücküberwiesen'], ['Mit nächster Auszahlung verrechnet', 'Mit nächster Auszahlung verrechnet'], ['Abgeschrieben (verzichtet)', 'Abgeschrieben (verzichtet)']] },
              { name: 'more', label: 'Notiz', placeholder: 'z. B. am 05.11. zurück' }] });
          if (r) CRM.run(btn, async () => { await CRM.rpc('settle_clawback', { p_commission_id: c.id, p_note: r.more ? `${r.how}: ${r.more}` : r.how }); CRM.refresh(); }, 'Erledigt ✓');
        }, 'ghost sm');
      };
      v.append(comTab === 'claw' ? h('div', null, CRM.note('info', h('span', null, 'Hier landet Geld, das ausgezahlt war, bevor die Einzahlung storniert wurde. Kommt die Person bald wieder dran, verrechnet „Auszahlen“ das automatisch. Sonst hier als erledigt markieren.')), h('div', { style: 'height:14px' })) : null,
        CRM.table([
          { t: 'Für Lead', cls: 'main', v: (c) => h('span', null, h('a', { href: '#lead/' + c.lead.id }, CRM.name(c.lead)), h('small', null, c.lead.lead_code)) },
          { t: 'Wer', v: (c) => `${c.recruiter?.full_name || c.creator?.name || '–'} (${c.type === 'recruiter' ? 'Recruiter' : 'Model'})` },
          { t: 'Betrag', cls: 'num', v: (c) => CRM.eur(c.amount) },
          { t: 'Status', v: (c) => CRM.chip(COM[c.status] + (c.reverses_commission_id ? ', Gegenbuchung' : ''), c.status === 'open' ? (Number(c.amount) < 0 ? 'bad' : 'new') : c.status === 'paid_out' ? 'ok' : 'off') },
          { t: 'Gebucht', cls: 'hide-m', v: (c) => CRM.day(c.created_at) },
          { t: '', cls: 'bare', v: settle },
        ], rows, { empty: comTab === 'claw' ? 'Nichts zu klären.' : 'Keine Einträge.' }));
    },
  });

  // ---------- Mein Geld (Recruiter) ----------
  CRM.page({
    id: 'mine', title: 'Mein Geld', icon: 'money', roles: ['recruiter'], money: true, tab: 4, tabLabel: 'Geld',
    async render(v) {
      const [[sum], rows] = await Promise.all([
        CRM.api('v_payout_list?person_type=eq.recruiter'),
        CRM.api('commissions?select=amount,status,created_at,lead:leads(id,lead_code,first_name,last_name)&order=created_at.desc&limit=300'),
      ]);
      v.append(CRM.head('Mein Geld', 'Für jeden Bewerber, dessen Einzahlung bestätigt ist, bekommst du eine Provision.'),
        h('div', 'stats',
          h('div', 'card stat', h('b', null, CRM.eur(sum?.open_amount ?? 0)), h('span', null, 'kommt mit der nächsten Auszahlung')),
          h('div', 'card stat', h('b', null, CRM.eur(sum?.paid_out_total ?? 0)), h('span', null, 'schon ausgezahlt')),
          h('div', 'card stat', h('b', null, String(sum?.onboarded_total ?? 0)), h('span', null, 'Bewerber geworben'))),
        CRM.section('Einzelne Provisionen'),
        CRM.table([
          { t: 'Für', cls: 'main', v: (c) => h('a', { href: '#lead/' + c.lead.id }, CRM.name(c.lead)) },
          { t: 'Betrag', cls: 'num', v: (c) => CRM.eur(c.amount) },
          { t: 'Status', v: (c) => CRM.chip(COM[c.status], c.status === 'paid_out' ? 'ok' : c.status === 'open' ? 'new' : 'off') },
          { t: 'Seit', v: (c) => CRM.day(c.created_at) },
        ], rows, { empty: 'Noch keine Provisionen.', emptyText: 'Sobald eine Einzahlung deiner Bewerber bestätigt ist, erscheint sie hier.' }));
    },
  });
})();
