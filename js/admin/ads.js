/* CRM: Anzeigen (Zuordnung Recruiter/Model und Zahlen), Models, Wochenberichte mit Videoideen. */
(() => {
  const { h } = CRM;
  const FROM = { name: 'aus dem Anzeigennamen', adset: 'geschätzt (wie die anderen Anzeigen der Gruppe)', campaign: 'geschätzt (wie die anderen Anzeigen der Kampagne)' };
  let days = 28, showAll = false, moreNumbers = false;

  // Auswahlfelder Recruiter/Model einer Anzeige. Änderungen gelten sofort (offene Leads der Anzeige gehen mit).
  const pickers = (a, recs, cres) => {
    const rs = CRM.select([['', '– kein Recruiter –'], ...recs.map((r) => [r.id, r.full_name])], a.recruiter_id, { 'aria-label': 'Recruiter' });
    const cs = CRM.select([['', '– kein Model –'], ...cres.map((c) => [c.id, c.name])], a.creator_id, { 'aria-label': 'Model' });
    rs.addEventListener('change', () => CRM.run(rs, async () => { await CRM.patch('ads', a.id, { recruiter_id: rs.value || null }); CRM.refresh(); }, 'Gespeichert ✓ Offene Leads dieser Anzeige gehen jetzt an den Recruiter.'));
    cs.addEventListener('change', () => CRM.run(cs, async () => { await CRM.patch('ads', a.id, { creator_id: cs.value || null }); CRM.refresh(); }, 'Gespeichert ✓ Gilt für neue Leads und Leads ohne Model.'));
    return { rs, cs };
  };
  const fixAll = (a, rs, cs) => {
    const out = [];
    if (a.recruiter_id) out.push(h('button', { type: 'button', class: 'link', on: { click: async (e) => {
      if (!rs.value) return CRM.flash('Erst oben den richtigen Recruiter wählen.', true);
      const r = await CRM.ask({ title: 'Alle Leads dieser Anzeige umhängen?', text: 'Alle noch nicht bezahlten Leads, die über diese Anzeige kamen, gehen an den gewählten Recruiter.', ok: 'Umhängen', fields: [{ name: 'reason', label: 'Grund', required: true, placeholder: 'z. B. falscher Recruiter eingetragen' }] });
      if (r) CRM.run(e.target, async () => { const n = await CRM.rpc('reassign_ad_recruiter', { p_ad_id: a.id, p_recruiter_id: rs.value, p_reason: r.reason }); CRM.flash(`${n} Lead(s) umgehängt ✓`); CRM.refresh(); });
    } } }, 'Recruiter auch für alte Leads ändern'));
    if (CRM.money) out.push(h('button', { type: 'button', class: 'link', on: { click: async (e) => {
      const r = await CRM.ask({ title: 'Model auch für alte Leads ändern?', text: 'Alle Leads dieser Anzeige bekommen das gewählte Model. Schon gebuchte Provisionen werden automatisch korrigiert.', ok: 'Ändern', fields: [{ name: 'reason', label: 'Grund', required: true, placeholder: 'z. B. falsches Model eingetragen' }] });
      if (r) CRM.run(e.target, async () => { const n = await CRM.rpc('reassign_ad_creator', { p_ad_id: a.id, p_creator_id: cs.value || null, p_reason: r.reason, p_since: null }); CRM.flash(`${n} Lead(s) korrigiert ✓`); CRM.refresh(); });
    } } }, 'Model auch für alte Leads ändern'));
    return out;
  };

  CRM.page({
    id: 'ads', title: 'Anzeigen', group: 'Werbung', icon: 'ads', roles: ['admin'],
    badge: () => CRM.count('ads?or=(recruiter_id.is.null,creator_id.is.null,defaults_from.not.is.null)'),
    async render(v) {
      const [recs, cres, ads, unconf] = await Promise.all([
        CRM.recruiters(), CRM.creators(),
        CRM.api('ads?select=*&order=first_seen_at.desc&limit=500'),
        CRM.api('leads?attribution_unconfirmed=is.true&status=neq.lost&select=ad_id'),
      ]);
      const unconfAds = new Map();
      unconf.forEach((l) => unconfAds.set(l.ad_id, (unconfAds.get(l.ad_id) || 0) + 1));
      const todo = ads.filter((a) => !a.recruiter_id || !a.creator_id || a.defaults_from || unconfAds.has(a.id));

      v.append(CRM.head('Anzeigen', 'Jede Facebook/Instagram-Anzeige braucht einen Recruiter (bekommt die Leads) und ein Model (die Person im Video, bekommt ihren Anteil).'));

      // 1) Zu erledigen
      if (todo.length) {
        v.append(CRM.section('Bitte zuordnen', CRM.chip(String(todo.length), 'warn')),
          h('div', 'cards', todo.map((a) => {
            const { rs, cs } = pickers(a, recs, cres);
            const ok = (a.defaults_from || unconfAds.has(a.id)) && a.recruiter_id ? CRM.btn('Stimmt so', () => CRM.run(null, async () => {
              const n = await CRM.rpc('confirm_ad_attribution', { p_ad_id: a.id }); CRM.flash(`Bestätigt ✓ (${n} Lead(s) freigegeben)`); CRM.refresh();
            }), 'green sm', 'check') : null;
            return h('article', 'card stack',
              h('div', null, h('h3', null, a.name || `Anzeige ${a.meta_ad_id}`), h('p', 'soft', { style: 'font-size:14px' }, [a.campaign_name, a.adset_name].filter(Boolean).join(' › ') || 'ohne Kampagnenname')),
              a.defaults_from ? CRM.note('info', h('span', null, `Recruiter/Model wurden ${FROM[a.defaults_from]} übernommen.${unconfAds.has(a.id) ? ` ${unconfAds.get(a.id)} Lead(s) warten auf deine Bestätigung.` : ''}`)) : null,
              CRM.field('Recruiter', rs), CRM.field('Model', cs), ok ? h('div', null, ok) : null);
          })));
      } else if (ads.length) v.append(CRM.note('ok', h('span', null, 'Alle Anzeigen haben Recruiter und Model ✓')));

      // 2) Zahlen
      const perf = h('div', null, h('p', 'loading', 'Lade Zahlen …'));
      v.append(CRM.section('Wie laufen die Anzeigen?'),
        h('div', 'spread', CRM.pills([[7, 'Letzte 7 Tage'], [28, 'Letzte 28 Tage'], [90, 'Letzte 90 Tage']], days, (k) => { days = k; CRM.refresh(); }),
          h('label', 'check', h('input', { type: 'checkbox', checked: moreNumbers, on: { change: (e) => { moreNumbers = e.target.checked; CRM.refresh(); } } }), 'Mehr Zahlen')),
        perf);
      try {
        const rows = await CRM.rpc('ad_performance', { p_from: CRM.isoDay(-days), p_to: CRM.isoDay(-1) });
        perf.replaceChildren(CRM.table([
          { t: 'Anzeige', cls: 'main', v: (a) => h('span', null, a.ad_name || a.meta_ad_id, h('small', null, a.creator_name ? 'Model: ' + a.creator_name : 'ohne Model')) },
          { t: 'Ausgegeben', cls: 'num', v: (a) => CRM.eur(a.spend) },
          { t: 'Leads', cls: 'num', v: (a) => String(a.leads) },
          { t: 'Kosten pro Lead', cls: 'num', tip: 'Ausgegeben geteilt durch Leads. Je niedriger, desto besser.', v: (a) => CRM.eur(a.cpl) },
          { t: 'Bezahlt', cls: 'num', tip: 'Wie viele dieser Leads später die Einzahlung gemacht haben. Das dauert oft Wochen, darum sagen die letzten 7 Tage hier wenig.', v: (a) => String(a.paid_leads) },
          { t: 'Kosten pro Abschluss', cls: 'num', tip: 'Ausgegeben geteilt durch bezahlte Leads. Die wichtigste Zahl: So viel kostet ein zahlender Bewerber.', v: (a) => CRM.eur(a.cost_per_paid) },
          moreNumbers ? { t: 'Gesprächsquote', cls: 'num', tip: 'Anteil der Leads, mit denen es mindestens ein echtes Gespräch gab. Frühes Zeichen für gute Leads.', v: (a) => CRM.pct(a.qualified_rate) } : null,
          moreNumbers ? { t: 'Hook-Rate', cls: 'num', tip: 'Wie viele die ersten 3 Sekunden des Videos geschaut haben. Zeigt, ob der Einstieg packt.', v: (a) => CRM.pct(a.hook_rate) } : null,
          moreNumbers ? { t: 'Halte-Rate', cls: 'num', tip: 'Wie viele danach weitergeschaut haben. Zeigt, ob das Video fesselt.', v: (a) => CRM.pct(a.hold_rate) } : null,
          moreNumbers ? { t: 'Klickrate', cls: 'num', tip: 'Anteil der Leute, die auf die Anzeige geklickt haben.', v: (a) => CRM.pct(a.ctr) } : null,
          { t: 'Läuft seit', cls: 'num', v: (a) => `${a.age_days} Tagen` },
        ].filter(Boolean), rows, { empty: 'Noch keine Zahlen.', emptyText: 'Die Zahlen kommen jede Nacht automatisch von Facebook, sobald die Verbindung eingerichtet ist.' }));
      } catch (e) { perf.replaceChildren(CRM.empty('Noch keine Zahlen.', 'Die Zahlen kommen jede Nacht automatisch von Facebook, sobald die Verbindung eingerichtet ist.')); }

      // 3) Alle Anzeigen
      if (ads.length) {
        const all = h('details', 'card', { open: showAll, on: { toggle: (e) => { showAll = e.target.open; } } }, h('summary', null, `Alle Anzeigen (${ads.length})`),
          CRM.table([
            { t: 'Anzeige', cls: 'main', v: (a) => h('span', null, a.name || a.meta_ad_id, h('small', null, a.status === 'ACTIVE' ? 'läuft' : (a.status || '').toLowerCase())) },
            ...(() => { const m = new Map(); const g = (a) => m.get(a.id) || m.set(a.id, pickers(a, recs, cres)).get(a.id);
              return [{ t: 'Recruiter', v: (a) => g(a).rs }, { t: 'Model', v: (a) => g(a).cs }, { t: '', cls: 'bare', v: (a) => h('div', 'stack', { style: 'gap:0' }, fixAll(a, g(a).rs, g(a).cs)) }]; })(),
          ], ads));
        v.append(h('div', { style: 'height:20px' }), all);
      } else v.append(h('div', { style: 'height:20px' }), CRM.empty('Noch keine Anzeigen.', 'Anzeigen erscheinen hier von selbst, sobald der erste Lead darüber kommt oder Facebook die Zahlen schickt.'));
    },
  });

  // ---------- Models ----------
  CRM.page({
    id: 'creators', title: 'Models', group: 'Werbung', icon: 'star', roles: ['admin'],
    async render(v) {
      const rows = await CRM.api('creators?select=*&order=active.desc,name');
      const panel = h('div');
      const open = (c) => {
        const name = CRM.input({ value: c.name || '' }), code = CRM.input({ value: c.code || '', placeholder: 'z. B. cleo' });
        const rate = CRM.input({ type: 'number', step: '0.1', min: '0', max: '100', value: c.commission_rate != null ? String(Number(c.commission_rate) * 100) : '', placeholder: 'leer = Standard' });
        const email = CRM.input({ type: 'email', value: c.email || '' }), iban = CRM.input({ value: c.iban || '', autocomplete: 'off' });
        const b = h('button', { class: 'btn', type: 'submit' }, c.id ? 'Speichern' : 'Model anlegen');
        const f = h('form', { class: 'stack', novalidate: true },
          h('div', 'grid2', CRM.field('Name', name), CRM.field('Kurzname', code, 'Für den Anzeigennamen, z. B. [cr:cleo]'), CRM.field('Anteil in %', rate, 'Leer lassen = Standard aus den Einstellungen'), CRM.field('E-Mail', email), CRM.field('IBAN', iban, 'Für die Auszahlung')),
          h('div', 'row', b, h('button', { type: 'button', class: 'btn btn--soft', on: { click: () => panel.replaceChildren() } }, 'Abbrechen')));
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          CRM.run(b, async () => {
            if (!name.value.trim()) throw new Error('Bitte einen Namen angeben.');
            const body = { name: name.value.trim(), code: code.value.trim() || null, commission_rate: rate.value === '' ? null : Number(rate.value) / 100,
              email: email.value.trim() || null, iban: iban.value.replace(/\s+/g, '').toUpperCase() || null };
            if (c.id) await CRM.patch('creators', c.id, body); else await CRM.insert('creators', body);
            CRM.clearCache(); CRM.refresh();
          }, 'Gespeichert ✓');
        });
        const extra = [];
        if (c.code) extra.push(CRM.btn(`Text für Anzeigen kopieren: [cr:${c.code}]`, () => CRM.copy(`[cr:${c.code}]`), 'ghost sm'));
        if (c.id) {
          extra.push(CRM.btn(c.active ? 'Deaktivieren' : 'Wieder aktivieren', (e) => CRM.run(e.currentTarget, async () => { await CRM.patch('creators', c.id, { active: !c.active }); CRM.clearCache(); CRM.refresh(); }), 'soft sm'),
            h('button', { type: 'button', class: 'link link--danger', on: { click: async () => {
              const r = await CRM.ask({ title: 'Personendaten löschen?', text: 'Name, E-Mail und IBAN werden entfernt (DSGVO). Buchungen bleiben anonym.', ok: 'Löschen', danger: true, fields: [{ name: 'reason', label: 'Grund', required: true }] });
              if (r) CRM.run(null, async () => { await CRM.rpc('erase_creator', { p_creator_id: c.id, p_reason: r.reason }); CRM.clearCache(); CRM.refresh(); }, 'Gelöscht.');
            } } }, 'Personendaten löschen'));
        }
        panel.replaceChildren(h('section', 'card stack', { style: 'margin-bottom:16px' }, h('h2', null, c.id ? c.name : 'Neues Model'), f, extra.length ? h('div', 'row', extra) : null));
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      v.append(CRM.head('Models', 'Die Personen in den Anzeigen-Videos. Sie bekommen pro bezahltem Lead aus ihrer Anzeige einen Anteil.',
        CRM.btn('Model anlegen', () => open({}), '', 'plus')), panel,
        CRM.table([
          { t: 'Name', cls: 'main', v: (c) => h('span', null, c.name, c.active ? null : h('small', null, 'deaktiviert')) },
          { t: 'Kurzname', v: (c) => c.code || '–' },
          { t: 'Anteil', cls: 'num', v: (c) => (c.commission_rate != null ? CRM.pct(c.commission_rate) : 'Standard') },
          { t: 'IBAN', v: (c) => c.iban ? '✓ hinterlegt' : CRM.chip('fehlt', 'warn') },
        ], rows, { onRow: open, empty: 'Noch keine Models.', emptyText: 'Lege die Personen aus deinen Anzeigen an.' }));
    },
  });

  // ---------- Wochenberichte ----------
  const md = (src) => {
    const out = h('div', 'md'); let ul = null;
    const inline = (txt) => txt.split(/(\*\*[^*]+\*\*)/g).map((p) => (p.startsWith('**') && p.endsWith('**') ? h('strong', null, p.slice(2, -2)) : p));
    for (const line of String(src || '').split('\n')) {
      const t = line.trim();
      const head = t.match(/^(#{1,4})\s+(.*)$/), li = t.match(/^[-*]\s+(.*)$/) || t.match(/^\d+\.\s+(.*)$/);
      if (li) { if (!ul) out.append(ul = h('ul')); ul.append(h('li', null, inline(li[1]))); continue; }
      ul = null;
      if (head) out.append(h('h3', null, inline(head[2])));
      else if (t.startsWith('|')) out.append(h('pre', null, t));
      else if (t) out.append(h('p', null, inline(t)));
    }
    return out;
  };
  const IDEA = { new: ['Neu', 'new'], accepted: ['Wird umgesetzt', 'contacted'], produced: ['Gedreht', 'ok'], rejected: ['Verworfen', 'off'] };

  CRM.page({
    id: 'reports', title: 'Wochenberichte', group: 'Werbung', icon: 'chart', roles: ['admin'],
    async render(v, id) {
      const reports = await CRM.api('ad_reports?select=id,period_from,period_to,status,error,created_at&order=period_to.desc&limit=12');
      v.append(CRM.head('Wochenberichte', 'Jeden Montag schreibt die KI einen kurzen Bericht: was gut läuft, was nicht, und neue Ideen für Videos.'));
      if (!reports.length) { v.append(CRM.empty('Noch kein Bericht.', 'Der erste kommt am Montag nach der Einrichtung der Facebook-Verbindung.')); return; }
      const cur = reports.find((r) => r.id === id) || reports[0];
      v.append(CRM.pills(reports.slice(0, 6).map((r) => [r.id, `${CRM.day(r.period_from).slice(0, 6)} – ${CRM.day(r.period_to).slice(0, 6)}`]), cur.id, (k) => CRM.go('reports', k)));
      const [full] = await CRM.api(`ad_reports?id=eq.${cur.id}&select=report_md,report_json`);
      if (cur.status === 'failed') v.append(CRM.note('', h('span', null, 'Dieser Bericht konnte nicht erstellt werden. Der nächste Lauf versucht es neu.')));
      const warn = full?.report_json?.warnungen || [];
      if (warn.length) v.append(CRM.note('', h('div', null, h('strong', null, 'Bitte beachten'), h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, warn.map((w) => h('li', null, w))))), h('div', { style: 'height:14px' }));
      if (full?.report_md) v.append(h('section', 'card', md(full.report_md)));

      const ideas = await CRM.api('video_ideas?select=*&order=created_at.desc&limit=60');
      v.append(CRM.section('Ideen für neue Videos'), ideas.length ? h('div', 'cards', ideas.map((i) => h('article', 'card stack',
        h('div', 'spread', h('h3', null, i.title), CRM.chip(...IDEA[i.status])),
        h('p', null, h('strong', null, 'Erster Satz: '), `„${i.hook}“`), h('pre', 'script', i.script), i.creator_hint ? h('p', 'soft', { style: 'font-size:14px' }, i.creator_hint) : null,
        h('div', 'row', Object.entries(IDEA).filter(([k]) => k !== i.status && k !== 'new').map(([k, [t]]) =>
          CRM.btn(t, (e) => CRM.run(e.currentTarget, async () => { await CRM.patch('video_ideas', i.id, { status: k }); CRM.refresh(); }), 'soft sm')))))) : CRM.empty('Noch keine Ideen.'));
    },
  });
})();
