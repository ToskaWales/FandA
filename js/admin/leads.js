/* CRM: Heute, Leads, Offene Leads, Lead-Seite mit Schritten und Verlauf, Lead von Hand, Meine Links. */
(() => {
  const { h } = CRM;
  const STATUS = { new: 'Neu', contacted: 'Kontaktiert', conversation: 'Im Gespräch', onboarding: 'Einarbeitung', paid: 'Bezahlt', lost: 'Verloren' };
  const STEPS = ['new', 'contacted', 'conversation', 'onboarding', 'paid'];
  const SOURCE = { meta_ad: 'Facebook/Instagram-Anzeige', facebook_group: 'Facebook-Gruppe', indeed: 'Indeed', website: 'Website', manual: 'Von Hand', other: 'Sonstiges' };
  const REASON = { ref_code: 'über den persönlichen Link', ad: 'über die Anzeige', manual: 'von Hand zugeteilt' };
  const EVENT = {
    created: 'Lead eingegangen', status_changed: 'Status geändert', assigned: 'Recruiter zugeteilt', note: 'Notiz', repeat_submission: 'Hat sich nochmal angemeldet',
    payment_reported: 'Einzahlung gemeldet', payment_confirmed: 'Einzahlung bestätigt', payment_rejected: 'Einzahlung abgelehnt',
    payment_reversed: 'Einzahlung storniert', creator_missing: 'Model fehlt', creator_corrected: 'Model korrigiert', erased: 'Personendaten gelöscht',
  };
  const LOST = ['Nicht erreichbar', 'Kein Interesse', 'Will die Einzahlung nicht', 'Passt nicht (Erfahrung/Zeit)', 'Doppelt angemeldet', 'Sonstiges'];
  Object.assign(CRM, { STATUS, SOURCE });
  CRM.statusChip = (s) => CRM.chip(STATUS[s] || s, s);
  const callBtn = (phone) => phone ? h('a', { class: 'btn btn--ghost btn--sm', href: CRM.tel(phone), 'aria-label': 'Anrufen ' + phone }, CRM.icon('phone'), 'Anrufen') : '';
  const nowIso = () => new Date().toISOString();
  const LEAD_SELECT = 'id,lead_code,first_name,last_name,phone,email,source,status,recruiter_id,created_at,next_followup_at,possible_duplicate_of,ref_code,meta_ad_id_raw,ad:ads(name),recruiter:profiles!leads_recruiter_id_fkey(full_name)';

  const leadCols = (admin, { due } = {}) => [
    { t: 'Name', cls: 'main', v: (l) => h('span', null, CRM.name(l), h('small', null, `${l.lead_code} · ${SOURCE[l.source] || l.source}`)) },
    { t: 'Status', v: (l) => CRM.statusChip(l.status) },
    admin ? { t: 'Recruiter', v: (l) => l.recruiter?.full_name || (l.recruiter_id ? '…' : CRM.chip('noch offen', 'warn')) } : null,
    { t: due ? 'Rückruf' : 'Rückruf geplant', v: (l) => (l.next_followup_at ? h('span', { class: new Date(l.next_followup_at) < new Date() ? 'chip chip--bad chip--plain' : '' }, CRM.when(l.next_followup_at)) : '–') },
    { t: 'Eingang', cls: 'hide-m', v: (l) => CRM.when(l.created_at) },
    { t: '', cls: 'bare', v: (l) => callBtn(l.phone) },
  ].filter(Boolean);

  // ---------- Heute ----------
  const todo = (n, text, action, target, urgent) => (n ? h('div', 'card todo__item' + (urgent ? ' is-urgent' : ''),
    h('div', 'todo__text', h('span', 'num', String(n)), h('span', null, text)),
    h('a', { class: 'btn btn--sm', href: '#' + target }, action)) : null);

  CRM.page({
    id: 'start', title: 'Heute', icon: 'home', roles: ['admin', 'recruiter'], tab: 1,
    async render(v) {
      const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
      const due = `next_followup_at=lte.${nowIso()}&status=not.in.(paid,lost)`;
      if (CRM.role === 'recruiter') {
        const [dueRows, newRows, active] = await Promise.all([
          CRM.api(`leads?select=${LEAD_SELECT}&${due}&order=next_followup_at`),
          CRM.api(`leads?select=${LEAD_SELECT}&status=eq.new&order=created_at.desc`),
          CRM.count('leads?status=not.in.(paid,lost)'),
        ]);
        v.append(CRM.head('Heute', `${today}. Das steht für dich an.`));
        if (!dueRows.length && !newRows.length) v.append(h('div', 'card done-all', h('span', 'ok', CRM.icon('check')), h('div', null, h('h2', null, 'Alles erledigt'), h('p', 'soft', `Keine fälligen Rückrufe und keine neuen Leads. Du hast ${active ?? 0} Leads in Arbeit.`))));
        if (dueRows.length) v.append(CRM.section('Rückrufe fällig', CRM.chip(String(dueRows.length), 'bad')), CRM.table(leadCols(false, { due: true }), dueRows, { onRow: (l) => CRM.go('lead', l.id) }));
        if (newRows.length) v.append(CRM.section('Neue Leads: bitte anrufen', CRM.chip(String(newRows.length), 'new')), CRM.table(leadCols(false), newRows, { onRow: (l) => CRM.go('lead', l.id) }));
        return;
      }
      const week = new Date(Date.now() - 7 * 86400000).toISOString();
      const [open, unconf, dueN, partners, hookErr, adsMissing, payments, claws, gaps, payout, newWeek, paidWeek] = await Promise.all([
        CRM.count('leads?recruiter_id=is.null&status=neq.lost'),
        CRM.count('leads?attribution_unconfirmed=is.true&status=neq.lost'),
        CRM.count(`leads?${due}`),
        CRM.count('partner_requests?status=eq.new'),
        CRM.count('meta_webhook_events?status=in.(failed,dead)'),
        CRM.count('ads?or=(recruiter_id.is.null,creator_id.is.null)'),
        CRM.money ? CRM.count('payments?status=eq.reported') : 0,
        CRM.money ? CRM.count('commissions?status=eq.open&amount=lt.0') : 0,
        CRM.money ? CRM.count('v_creator_gaps') : 0,
        CRM.money ? CRM.api('v_payout_list?select=open_amount&open_amount=gt.0').catch(() => []) : [],
        CRM.count(`leads?created_at=gte.${week}`),
        CRM.money ? CRM.count(`leads?closed_at=gte.${week}`) : null,
      ]);
      const payoutSum = payout.reduce((s, x) => s + Number(x.open_amount), 0);
      const items = [
        todo(open, open === 1 ? 'neuer Lead wartet auf einen Recruiter.' : 'neue Leads warten auf einen Recruiter.', 'Jetzt verteilen', 'open', true),
        todo(payments, payments === 1 ? 'Einzahlung wartet auf deine Bestätigung.' : 'Einzahlungen warten auf deine Bestätigung.', 'Prüfen', 'payments', true),
        payout.length ? h('div', 'card todo__item', h('div', 'todo__text', h('span', 'num', CRM.eur(payoutSum)), h('span', null, `an ${payout.length} ${payout.length === 1 ? 'Person' : 'Personen'} auszuzahlen.`)), h('a', { class: 'btn btn--sm', href: '#payouts' }, 'Auszahlen')) : null,
        todo(partners, partners === 1 ? 'neue Anfrage von einem Vermittler.' : 'neue Anfragen von Vermittlern.', 'Ansehen', 'partners'),
        todo(dueN, dueN === 1 ? 'Rückruf ist fällig (bei den Recruitern).' : 'Rückrufe sind fällig (bei den Recruitern).', 'Anzeigen', 'leads/due'),
        todo(unconf, 'Leads kamen über eine Anzeige, deren Recruiter/Model nur geschätzt ist. Bitte kurz bestätigen.', 'Bestätigen', 'ads'),
        todo(adsMissing, adsMissing === 1 ? 'Anzeige hat noch keinen Recruiter oder kein Model.' : 'Anzeigen haben noch keinen Recruiter oder kein Model.', 'Zuordnen', 'ads'),
        todo(hookErr, 'Leads von Facebook konnten nicht abgeholt werden.', 'Details', 'log', true),
        todo(claws, 'Mal wurde zu viel ausgezahlt (Einzahlung später storniert). Bitte klären.', 'Klären', 'commissions/claw'),
        todo(gaps, 'bezahlte Leads ohne Model-Provision.', 'Nachtragen', 'commissions/gaps'),
      ].filter(Boolean);
      v.append(CRM.head('Heute', `${today}. Hier steht nur, was gerade zu tun ist.`),
        items.length ? h('div', 'todo', items) : h('div', 'card done-all', h('span', 'ok', CRM.icon('check')), h('div', null, h('h2', null, 'Alles erledigt'), h('p', 'soft', 'Gerade ist nichts zu tun.'))),
        CRM.section('Letzte 7 Tage'),
        h('div', 'stats',
          h('div', 'card stat', h('b', null, String(newWeek ?? '–')), h('span', null, 'neue Leads')),
          paidWeek != null ? h('div', 'card stat', h('b', null, String(paidWeek)), h('span', null, 'Abschlüsse (bezahlt)')) : null,
          h('div', 'card stat', h('b', null, String(open ?? '–')), h('span', null, 'Leads ohne Recruiter'))));
    },
  });

  // ---------- Leads ----------
  const filters = { status: 'active', source: '', rec: '', q: '' };
  CRM.page({
    id: 'leads', title: 'Leads', label: () => (CRM.role === 'admin' ? 'Alle Leads' : 'Meine Leads'), tabLabel: 'Leads', group: 'Leads', icon: 'leads', roles: ['admin', 'recruiter'], tab: 2,
    badge: () => (CRM.role === 'recruiter' ? CRM.count(`leads?next_followup_at=lte.${nowIso()}&status=not.in.(paid,lost)`) : Promise.resolve(0)),   // Recruiter: fällige Rückrufe
    async render(v, arg) {
      if (arg === 'due') filters.status = 'due';
      const admin = CRM.role === 'admin';
      const all = await CRM.api('leads?select=status,next_followup_at&limit=10000');
      const n = (fn) => all.filter(fn).length;
      const now = new Date();
      const pills = [['active', 'In Arbeit', n((l) => !['paid', 'lost'].includes(l.status))],
        ['due', 'Rückruf fällig', n((l) => l.next_followup_at && new Date(l.next_followup_at) <= now && !['paid', 'lost'].includes(l.status))],
        ...Object.entries(STATUS).map(([k, t]) => [k, t, n((l) => l.status === k)]), ['', 'Alle', all.length]];

      const list = h('div');
      const load = async () => {
        let q = `leads?select=${LEAD_SELECT}&limit=300`;
        if (filters.status === 'active') q += '&status=not.in.(paid,lost)&order=created_at.desc';
        else if (filters.status === 'due') q += `&next_followup_at=lte.${nowIso()}&status=not.in.(paid,lost)&order=next_followup_at`;
        else q += (filters.status ? `&status=eq.${filters.status}` : '') + '&order=created_at.desc';
        if (filters.source) q += `&source=eq.${filters.source}`;
        if (filters.rec === 'none') q += '&recruiter_id=is.null'; else if (filters.rec) q += `&recruiter_id=eq.${filters.rec}`;
        const s = filters.q.trim().replace(/[,()*]/g, ' ').trim();
        if (s) { const e = encodeURIComponent(s); q += `&or=(first_name.ilike.*${e}*,last_name.ilike.*${e}*,email.ilike.*${e}*,phone.ilike.*${e}*,lead_code.ilike.*${e}*)`; }
        list.replaceChildren(h('p', 'loading', 'Lade …'));
        const rows = await CRM.api(q);
        list.replaceChildren(CRM.table(leadCols(admin, { due: filters.status === 'due' }), rows, {
          onRow: (l) => CRM.go('lead', l.id),
          empty: s ? 'Nichts gefunden.' : 'Hier ist gerade nichts.', emptyText: s ? 'Prüfe die Schreibweise oder wähle oben „Alle“.' : null,
        }), rows.length === 300 ? h('p', 'soft', 'Es werden die neuesten 300 gezeigt. Suche oder Filter nutzen.') : null);
      };
      const search = CRM.input({ type: 'search', value: filters.q, placeholder: 'Suchen: Name, Telefon, E-Mail …', 'aria-label': 'Suchen' });
      let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { filters.q = search.value; load(); }, 300); });
      const bar = [h('div', 'search', search)];
      if (admin) {
        const rec = CRM.select([['', 'Alle Recruiter'], ['none', 'Ohne Recruiter'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], filters.rec, { 'aria-label': 'Recruiter' });
        rec.addEventListener('change', () => { filters.rec = rec.value; load(); });
        const so = CRM.select([['', 'Alle Quellen'], ...Object.entries(SOURCE)], filters.source, { 'aria-label': 'Quelle' });
        so.addEventListener('change', () => { filters.source = so.value; load(); });
        bar.push(h('div', null, rec), h('div', null, so));
      }
      v.append(CRM.head(admin ? 'Alle Leads' : 'Meine Leads', admin ? 'Alle Bewerber. Klick auf einen Lead öffnet die Details.' : 'Deine Bewerber. Klick auf einen Lead, um den Stand zu ändern oder eine Notiz zu schreiben.',
        h('a', { class: 'btn', href: '#new' }, CRM.icon('plus'), 'Lead anlegen')),
        h('div', 'filters', bar), CRM.pills(pills, filters.status, (k) => { filters.status = k; CRM.refresh(); }), list);
      await load();
    },
  });

  // ---------- Offene Leads (Admin verteilt) ----------
  CRM.page({
    id: 'open', title: 'Offene Leads', label: 'Leads verteilen', group: 'Leads', icon: 'inbox', roles: ['admin'], tab: 3, tabLabel: 'Verteilen',
    badge: () => CRM.count('leads?recruiter_id=is.null&status=neq.lost'),
    async render(v) {
      const [rows, recs] = await Promise.all([
        CRM.api(`leads?select=${LEAD_SELECT}&recruiter_id=is.null&status=neq.lost&order=created_at.desc&limit=500`),
        CRM.recruiters(true),
      ]);
      const recOpts = [['', 'Recruiter wählen …'], ...recs.map((r) => [r.id, r.full_name])];
      const picked = new Set();
      const why = (l) => l.ref_code ? `Link-Code „${l.ref_code}“ ist unbekannt` : l.ad?.name ? `Anzeige „${l.ad.name}“ hat keinen Recruiter` : l.meta_ad_id_raw ? 'Anzeige ist unbekannt' : `kam über ${SOURCE[l.source] || l.source}`;
      const bulk = CRM.select(recOpts, '', { 'aria-label': 'Recruiter für alle ausgewählten' });
      const bulkBtn = CRM.btn('Ausgewählte zuteilen', () => CRM.run(bulkBtn, async () => {
        if (!picked.size) throw new Error('Bitte zuerst Leads ankreuzen.');
        if (!bulk.value) throw new Error('Bitte einen Recruiter wählen.');
        for (const id of picked) await CRM.rpc('assign_lead', { p_lead_id: id, p_recruiter_id: bulk.value });
        CRM.refresh();
      }, 'Zugeteilt ✓'));
      v.append(CRM.head('Leads verteilen', 'Diese Leads haben noch keinen Recruiter. Wähle für jeden einen aus. Tipp: Bekommt eine Anzeige einen Recruiter (Seite Anzeigen), gehen ihre Leads automatisch an ihn.'));
      if (!rows.length) { v.append(h('div', 'card done-all', h('span', 'ok', CRM.icon('check')), h('div', null, h('h2', null, 'Alles verteilt'), h('p', 'soft', 'Jeder Lead hat einen Recruiter.')))); return; }
      if (rows.length > 1) v.append(h('div', 'card row', { style: 'margin-bottom:14px' }, h('span', { style: 'font-weight:600' }, 'Mehrere auf einmal:'), h('div', { style: 'flex:1 1 200px;max-width:280px' }, bulk), bulkBtn));
      v.append(CRM.table([
        rows.length > 1 ? { t: 'Auswählen', cls: 'bare', v: (l) => h('label', 'check', h('input', { type: 'checkbox', on: { change: (e) => { e.target.checked ? picked.add(l.id) : picked.delete(l.id); } } }), h('span', 'hide-desk', '')) } : null,
        { t: 'Name', cls: 'main', v: (l) => h('span', null, h('a', { href: '#lead/' + l.id }, CRM.name(l)), h('small', null, why(l))) },
        { t: 'Eingang', v: (l) => CRM.when(l.created_at) },
        { t: 'Zuteilen an', cls: 'bare', v: (l) => {
          const s = CRM.select(recOpts, '', { 'aria-label': 'Recruiter für ' + CRM.name(l) });
          const b = CRM.btn('OK', () => CRM.run(b, async () => {
            if (!s.value) throw new Error('Bitte einen Recruiter wählen.');
            await CRM.rpc('assign_lead', { p_lead_id: l.id, p_recruiter_id: s.value }); CRM.refresh();
          }, 'Zugeteilt ✓'), 'sm');
          return h('div', 'row', s, b);
        } },
      ].filter(Boolean), rows));
    },
  });

  // ---------- Lead-Seite ----------
  const toLocal = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const at = (days, hour = 10) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const facts = (pairs) => h('dl', 'facts', pairs.filter(([, x]) => x != null && x !== '').map(([k, x]) => h('div', null, h('dt', null, k), h('dd', null, x))));
  CRM.facts = facts;

  CRM.page({
    id: 'lead', title: 'Lead', roles: ['admin', 'recruiter'], nav: false, parent: 'leads',
    async render(v, id) {
      const admin = CRM.role === 'admin';
      const [l] = await CRM.api(`leads?id=eq.${id}&select=*,ad:ads(name),recruiter:profiles!leads_recruiter_id_fkey(full_name),closer:profiles!leads_closed_by_fkey(full_name),creator:creators(name)`);
      if (!l) { v.append(CRM.empty('Lead nicht gefunden.', 'Vielleicht gehört er einem anderen Recruiter.', h('a', { class: 'btn btn--ghost', href: '#leads' }, 'Zur Liste'))); return; }
      const events = await CRM.api(`lead_events?lead_id=eq.${id}&select=*,actor:profiles(full_name)&order=created_at.desc`);
      const save = (body, ok) => CRM.run(null, async () => { await CRM.patch('leads', id, body); CRM.refresh(); }, ok);

      // Kopf
      v.append(h('a', { class: 'back', href: '#leads' }, CRM.icon('arrow'), 'Alle Leads'),
        h('div', 'lead-head',
          h('div', null, h('div', 'code', `${l.lead_code} · eingegangen ${CRM.when(l.created_at)}`), h('h1', null, CRM.name(l), CRM.statusChip(l.status))),
          h('div', 'row', l.phone ? h('a', { class: 'btn', href: CRM.tel(l.phone) }, CRM.icon('phone'), 'Anrufen') : null,
            l.email ? h('a', { class: 'btn btn--ghost', href: 'mailto:' + l.email }, CRM.icon('mail'), 'E-Mail') : null)));
      if (l.attribution_unconfirmed && admin) {
        v.append(CRM.note('', h('span', null, h('strong', null, 'Kurz prüfen: '), `Recruiter und Model wurden von einer ähnlichen Anzeige übernommen (${l.recruiter?.full_name || '–'} / ${l.creator?.name || '–'}). Erst nach deiner Bestätigung lässt sich die Einzahlung bestätigen.`),
          CRM.btn('Stimmt so', () => CRM.run(null, async () => { await CRM.rpc('confirm_lead_attribution', { p_lead_id: id }); CRM.refresh(); }, 'Bestätigt ✓'), 'sm')), h('div', { style: 'height:14px' }));
      }

      const main = h('div'), side = h('div');
      v.append(h('div', 'lead-grid', main, side));

      // Schritte
      const paid = l.status === 'paid', lost = l.status === 'lost';
      const idx = STEPS.indexOf(l.status);
      const steps = h('div', 'steps', STEPS.map((s, i) => {
        const b = h('button', { type: 'button', class: 'step' + (i < idx ? ' is-done' : '') + (i === idx ? ' is-now' : '') + (s === 'paid' ? ' is-paid' : ''), disabled: paid || s === 'paid' || i === idx },
          h('i', null, i < idx ? '✓' : String(i + 1)), STATUS[s]);
        b.addEventListener('click', () => save({ status: s, lost_reason: null }, `Status: ${STATUS[s]} ✓`));
        return b;
      }));
      const lostBtn = !paid && !lost ? h('button', { type: 'button', class: 'link link--danger', on: { click: async () => {
        const r = await CRM.ask({ title: 'Lead als verloren markieren?', text: 'Er verschwindet dann aus „In Arbeit“. Du kannst ihn später wieder aufnehmen.', ok: 'Als verloren markieren', danger: true,
          fields: [{ name: 'why', label: 'Warum?', options: LOST.map((x) => [x, x]), value: LOST[0], required: true }, { name: 'more', label: 'Genauer' }] });
        if (r) save({ status: 'lost', lost_reason: r.more ? `${r.why}: ${r.more}` : r.why, next_followup_at: null }, 'Als verloren markiert.');
      } } }, 'Als verloren markieren') : null;
      main.append(h('section', 'card',
        h('div', 'spread', h('h2', null, 'Wie weit ist der Lead?'), lostBtn),
        lost ? CRM.note('', h('span', null, h('strong', null, 'Verloren: '), l.lost_reason || 'ohne Grund'), h('span', 'soft', 'Zum Wiederaufnehmen unten einen Schritt anklicken.')) : null,
        steps,
        paid ? h('p', 'soft', { style: 'margin-top:10px' }, `Bezahlt am ${CRM.day(l.closed_at)}${l.closer ? ' · geclosed von ' + l.closer.full_name : ''}.`)
          : h('p', 'soft', { style: 'margin-top:10px;font-size:14px' }, '„Bezahlt“ setzt sich von selbst, sobald der Admin die Einzahlung bestätigt.')));

      // Rückruf
      if (!paid && !lost) {
        const custom = CRM.input({ type: 'datetime-local', value: toLocal(l.next_followup_at), 'aria-label': 'Eigener Termin' });
        custom.addEventListener('change', () => custom.value && save({ next_followup_at: new Date(custom.value).toISOString() }, 'Rückruf gespeichert ✓'));
        const q = (label, iso) => CRM.btn(label, () => save({ next_followup_at: iso }, `Rückruf: ${CRM.when(iso)} ✓`), 'soft sm');
        main.append(h('section', 'card',
          h('div', 'spread', h('h2', null, 'Wann wieder melden?'), l.next_followup_at ? h('span', { class: 'chip ' + (new Date(l.next_followup_at) < new Date() ? 'chip--bad' : 'chip--new') }, CRM.when(l.next_followup_at)) : h('span', 'soft', 'noch kein Termin')),
          h('div', 'quick', { style: 'margin-top:14px' }, q('Heute 17 Uhr', at(0, 17)), q('Morgen', at(1)), q('In 3 Tagen', at(3)), q('Nächste Woche', at(7)),
            l.next_followup_at ? h('button', { type: 'button', class: 'link', on: { click: () => save({ next_followup_at: null }, 'Rückruf entfernt.') } }, 'Entfernen') : null),
          h('div', { style: 'margin-top:12px;max-width:280px' }, CRM.field('Oder eigener Termin', custom))));
      }

      // Notizen und Verlauf
      const note = h('textarea', { placeholder: 'z. B. „Hat Interesse, ruft Freitag zurück“', 'aria-label': 'Neue Notiz' });
      const nb = CRM.btn('Notiz speichern', () => CRM.run(nb, async () => {
        if (!note.value.trim()) throw new Error('Die Notiz ist noch leer.');
        await CRM.rpc('add_lead_note', { p_lead_id: id, p_text: note.value }); CRM.refresh();
      }, 'Notiz gespeichert ✓'));
      const describe = (e) => {
        const d = e.detail || {};
        if (e.event_type === 'note') return d.erased ? '(gelöscht)' : d.text;
        if (e.event_type === 'status_changed') return `${STATUS[d.from] || d.from} → ${STATUS[d.to] || d.to}`;
        if (e.event_type === 'assigned') return d.reason ? REASON[d.reason] || '' : '';
        if (e.event_type === 'created') return `${SOURCE[d.source] || d.source || ''}${d.assignment_reason ? ', ' + REASON[d.assignment_reason] : ', noch ohne Recruiter'}`;
        if (e.event_type === 'repeat_submission') return d.ref ? `über den Link „${d.ref}“` : '';
        if (d.reason) return d.reason;
        if (d.amount) return CRM.eur(d.amount);
        return '';
      };
      main.append(h('section', 'card', h('h2', null, 'Notizen und Verlauf'),
        h('div', 'stack', { style: 'margin-top:12px' }, note, h('div', null, nb)),
        h('ol', 'timeline', events.map((e) => h('li', null,
          h('div', 'meta', `${CRM.when(e.created_at)} · ${e.actor?.full_name || (e.actor_id ? '…' : 'automatisch')}`),
          h('strong', null, EVENT[e.event_type] || e.event_type),
          describe(e) ? h('div', 'text' + (e.event_type === 'note' ? ' is-note' : ''), describe(e)) : null)))));

      // Seite rechts: Kontakt
      const answers = Object.entries(l.extra || {}).filter(([k]) => !['legacy_id', 'is_organic', 'contacted_by', 'company'].includes(k))
        .map(([k, x]) => [k === 'message' ? 'Nachricht' : k, String(x)]);
      const contact = h('section', 'card', h('h2', null, 'Kontakt'), facts([
        ['Telefon', l.phone ? h('a', { href: CRM.tel(l.phone) }, l.phone) : null], ['E-Mail', l.email ? h('a', { href: 'mailto:' + l.email }, l.email) : null],
        ['Recruiter', l.recruiter?.full_name || (l.recruiter_id ? '…' : CRM.chip('noch offen', 'warn'))], ...answers,
        ['Achtung', l.possible_duplicate_of ? h('a', { href: '#lead/' + l.possible_duplicate_of }, 'Hat sich schon einmal angemeldet →') : null],
      ]));
      if (admin && !paid) {
        const s = CRM.select([['', 'Recruiter wählen …'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], l.recruiter_id, { 'aria-label': 'Recruiter' });
        const b = CRM.btn(l.recruiter_id ? 'Ändern' : 'Zuteilen', () => CRM.run(b, async () => {
          if (!s.value) throw new Error('Bitte einen Recruiter wählen.');
          await CRM.rpc('assign_lead', { p_lead_id: id, p_recruiter_id: s.value }); CRM.refresh();
        }, 'Zugeteilt ✓'), 'ghost sm');
        contact.append(h('div', 'row', { style: 'margin-top:12px' }, h('div', { style: 'flex:1 1 160px' }, s), b));
      }
      side.append(contact);

      if (CRM.money && CRM.leadMoney) await CRM.leadMoney(side, l);

      side.append(h('details', 'card', h('summary', null, 'Woher kommt der Lead?'), facts([
        ['Quelle', SOURCE[l.source] || l.source], ['Zugeteilt', REASON[l.assignment_reason] || 'noch nicht'],
        ['Anzeige', l.ad?.name || (l.meta_ad_id_raw ? `unbekannt (Nr. ${l.meta_ad_id_raw})` : null)], ['Model', l.creator?.name],
        ['Persönlicher Link', l.ref_code], ['Kampagne', [l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(' / ')],
        ['Eingang', CRM.fmt(l.created_at)],
      ])));

      if (admin) {
        const more = h('details', 'card', h('summary', null, 'Weitere Aktionen'), h('div', 'stack'));
        const box = more.lastChild;
        if (CRM.leadMoreActions) await CRM.leadMoreActions(box, l);
        box.append(h('div', null, h('button', { type: 'button', class: 'link link--danger', on: { click: async () => {
          const r = await CRM.ask({ title: 'Personendaten löschen?', text: 'Name, Telefon, E-Mail, Antworten und Notiztexte werden endgültig entfernt (z. B. bei einer Löschanfrage nach DSGVO). Buchungen bleiben anonym erhalten. Belege bitte zusätzlich in Supabase löschen.',
            ok: 'Endgültig löschen', danger: true, fields: [{ name: 'reason', label: 'Grund', placeholder: 'z. B. Löschanfrage per E-Mail vom …', required: true }] });
          if (r) CRM.run(null, async () => { await CRM.rpc('erase_lead', { p_lead_id: id, p_reason: r.reason }); CRM.refresh(); }, 'Personendaten gelöscht.');
        } } }, 'Personendaten löschen (DSGVO)')));
        side.append(more);
      }
    },
  });

  // ---------- Lead von Hand ----------
  CRM.page({
    id: 'new', title: 'Lead anlegen', group: 'Leads', icon: 'plus', roles: ['admin', 'recruiter'],
    async render(v) {
      const admin = CRM.role === 'admin';
      const fn = CRM.input({ autocomplete: 'off' }), ln = CRM.input({ autocomplete: 'off' });
      const em = CRM.input({ type: 'email', autocomplete: 'off' }), ph = CRM.input({ type: 'tel', autocomplete: 'off' });
      const src = CRM.select([['manual', 'Telefon / persönlich'], ['indeed', 'Indeed'], ['facebook_group', 'Facebook-Gruppe'], ['other', 'Sonstiges']], 'manual');
      const rec = admin ? CRM.select([['', 'Noch offen lassen'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], '') : null;
      const note = h('textarea', { placeholder: 'z. B. „Kam über Empfehlung von …“' });
      const b = h('button', { class: 'btn', type: 'submit' }, 'Lead anlegen');
      const f = h('form', { class: 'card stack', novalidate: true, style: 'max-width:720px' },
        h('div', 'grid2', CRM.field('Vorname', fn), CRM.field('Nachname', ln), CRM.field('Telefon', ph), CRM.field('E-Mail', em)),
        h('div', 'grid2', CRM.field('Woher kommt der Kontakt?', src), rec ? CRM.field('Recruiter', rec) : null),
        CRM.field('Notiz (optional)', note), h('div', null, b));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        CRM.run(b, async () => {
          if (!ph.value.trim() && !em.value.trim()) throw new Error('Bitte Telefon oder E-Mail angeben.');
          const id = await CRM.rpc('create_manual_lead', {
            p_first_name: fn.value.trim() || null, p_last_name: ln.value.trim() || null, p_email: em.value.trim() || null, p_phone: ph.value.trim() || null,
            p_source: src.value, p_recruiter_id: rec?.value || null, p_note: note.value.trim() || null,
          });
          CRM.go('lead', id);
        }, 'Lead angelegt ✓');
      });
      v.append(CRM.head('Lead anlegen', admin ? 'Für Kontakte, die nicht über die Website kamen (Telefon, Indeed, Empfehlung). Telefon oder E-Mail reicht.'
        : 'Für Kontakte, die nicht über die Website kamen. Der Lead gehört automatisch dir. Telefon oder E-Mail reicht.'), f);
    },
  });

  // ---------- Meine Links (Recruiter) ----------
  CRM.page({
    id: 'links', title: 'Meine Links', icon: 'link', roles: ['recruiter'], tab: 3, tabLabel: 'Links',
    async render(v) {
      const [p] = await CRM.api(`profiles?id=eq.${CRM.me}&select=ref_code,full_name`);
      v.append(CRM.head('Meine Links', 'Teile diese Links. Wer sich darüber bewirbt, landet automatisch bei dir.'));
      if (!p?.ref_code) { v.append(CRM.empty('Noch kein Link vorhanden.', 'Bitte den Admin, dir einen Link-Code zu geben.')); return; }
      const row = (title, text, hint) => h('div', 'card copybox', h('div', null, h('h3', null, title), hint ? h('p', 'soft', { style: 'font-size:14px' }, hint) : null, h('code', null, text)),
        CRM.btn('Kopieren', () => CRM.copy(text), 'ghost sm'));
      v.append(h('div', 'stack',
        row('Für alles', CRM.trackLink(p.ref_code), 'Z. B. für WhatsApp, Instagram-Bio oder E-Mail.'),
        row('Für Facebook-Gruppen', CRM.trackLink(p.ref_code, { src: 'fbgroup' }), 'Noch besser: Auf der Seite „FB-Gruppen“ bekommst du für jeden Beitrag einen eigenen Link.'),
        row('Für Indeed', CRM.trackLink(p.ref_code, { src: 'indeed' })),
        row('Für Facebook-Anzeigen', `[ref:${p.ref_code}]`, 'Diesen Text in den Namen der Anzeige schreiben. Dann gehen die Leads der Anzeige an dich.')));
    },
  });
})();
