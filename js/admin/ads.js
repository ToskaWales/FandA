/* CRM: Ad-Auswertung und Zuordnung (Recruiter/Creator je Ad), Creators, Wochenberichte und Videoideen. */
(() => {
  const { h } = CRM;
  const FROM = { name: 'Namensregel', adset: 'von Anzeigengruppe geerbt', campaign: 'von Kampagne geerbt' };
  let range = { from: CRM.isoDay(-28), to: CRM.isoDay(-1) }, assignTab = 'todo';

  const assignRow = (a, recs, cres, unconfirmed) => {
    const rs = CRM.select([['', '– kein Recruiter –'], ...recs.map((r) => [r.id, r.full_name])], a.recruiter_id);
    const cs = CRM.select([['', '– kein Creator –'], ...cres.map((c) => [c.id, c.name])], a.creator_id);
    // Direkte Änderung: neue Leads und noch offene/creatorlose Leads der Ad folgen automatisch (Trigger in 001).
    rs.addEventListener('change', () => CRM.run(rs, async () => { await CRM.patch('ads', a.id, { recruiter_id: rs.value || null }); CRM.refresh(); }, 'Recruiter gespeichert. Offene Leads der Ad sind ihm zugeteilt.'));
    cs.addEventListener('change', () => CRM.run(cs, async () => { await CRM.patch('ads', a.id, { creator_id: cs.value || null }); CRM.refresh(); }, 'Creator gespeichert (gilt für neue Leads und Leads ohne Creator).'));
    const box = h('div', 'a-actions');
    if (a.defaults_from || unconfirmed) {
      const b = h('button', { class: 'btn sm', type: 'button' }, 'Zuordnung ist richtig');
      b.addEventListener('click', () => CRM.run(b, async () => { const n = await CRM.rpc('confirm_ad_attribution', { p_ad_id: a.id }); CRM.flash(`Bestätigt (${n} Lead(s) freigegeben).`); CRM.refresh(); }));
      box.append(b);
    }
    if (a.recruiter_id) {
      const b = h('button', { class: 'a-link', type: 'button' }, 'Recruiter für alle Leads der Ad korrigieren');
      b.addEventListener('click', () => CRM.run(b, async () => {
        if (!rs.value) throw new Error('Erst oben den richtigen Recruiter wählen.');
        const r = window.prompt('Grund (alle nicht bezahlten Leads dieser Ad, die wegen der Ad zugeteilt wurden, gehen an den gewählten Recruiter):'); if (!r) return;
        const n = await CRM.rpc('reassign_ad_recruiter', { p_ad_id: a.id, p_recruiter_id: rs.value, p_reason: r }); CRM.flash(`${n} Lead(s) umgehängt.`); CRM.refresh();
      }));
      box.append(b);
    }
    if (CRM.money) {
      const b = h('button', { class: 'a-link', type: 'button' }, 'Creator rückwirkend korrigieren');
      b.addEventListener('click', () => CRM.run(b, async () => {
        const r = window.prompt('Grund (Creator wird für alle Leads der Ad geändert, Provisionen werden storniert bzw. gegengebucht):'); if (!r) return;
        const n = await CRM.rpc('reassign_ad_creator', { p_ad_id: a.id, p_creator_id: cs.value || null, p_reason: r, p_since: null }); CRM.flash(`${n} Lead(s) korrigiert.`); CRM.refresh();
      }));
      box.append(b);
    }
    return { rs, cs, box };
  };

  CRM.page({
    id: 'ads', title: 'Ads', roles: ['admin'],
    async render(v) {
      const [recs, cres, ads, unconf] = await Promise.all([
        CRM.recruiters(), CRM.creators(),
        CRM.api('ads?select=*&order=first_seen_at.desc&limit=500'),
        CRM.api('leads?attribution_unconfirmed=is.true&status=neq.lost&select=ad_id'),
      ]);
      const unconfAds = new Map();
      unconf.forEach((l) => unconfAds.set(l.ad_id, (unconfAds.get(l.ad_id) || 0) + 1));

      // Kennzahlen (braucht 003_ads_ai.sql)
      const perf = h('div');
      const from = CRM.input({ type: 'date', value: range.from }), to = CRM.input({ type: 'date', value: range.to });
      const loadPerf = async () => {
        range = { from: from.value, to: to.value };
        try {
          const rows = await CRM.rpc('ad_performance', { p_from: range.from, p_to: range.to });
          perf.replaceChildren(CRM.table([
            { t: 'Ad', v: (a) => a.ad_name || a.meta_ad_id }, { t: 'Creator', v: (a) => a.creator_name || '–' },
            { t: 'Kosten', v: (a) => CRM.eur(a.spend), cls: 'num' }, { t: 'Leads', v: (a) => String(a.leads), cls: 'num' },
            { t: 'CPL', v: (a) => CRM.eur(a.cpl), cls: 'num' }, { t: 'Bezahlt', v: (a) => String(a.paid_leads), cls: 'num' },
            { t: 'Kosten/bezahlt', v: (a) => CRM.eur(a.cost_per_paid), cls: 'num' }, { t: 'Abschluss', v: (a) => CRM.pct(a.close_rate), cls: 'num' },
            { t: 'Gespräch', v: (a) => CRM.pct(a.qualified_rate), cls: 'num' }, { t: 'Hook', v: (a) => CRM.pct(a.hook_rate), cls: 'num' },
            { t: 'Halten', v: (a) => CRM.pct(a.hold_rate), cls: 'num' }, { t: 'Alter (Tage)', v: (a) => String(a.age_days), cls: 'num' },
          ], rows, { empty: 'Keine Daten im Zeitraum. Läuft der tägliche Sync (sync-meta-insights)?' }),
          h('p', 'a-muted', 'Kohorten: Leads des Zeitraums und ob genau diese später bezahlt haben. Abschlüsse brauchen Zeit, die letzte Woche allein sagt wenig.'));
        } catch (e) { perf.replaceChildren(h('p', 'a-muted', 'Kennzahlen gibt es ab Migration 003_ads_ai.sql und dem täglichen Meta-Sync.')); }
      };
      from.addEventListener('change', loadPerf); to.addEventListener('change', loadPerf);

      const todo = (a) => !a.recruiter_id || !a.creator_id || a.defaults_from || unconfAds.has(a.id);
      const list = assignTab === 'todo' ? ads.filter(todo) : ads;
      v.append(h('h1', null, 'Ads'), h('div', 'a-filters', CRM.field('Von', from), CRM.field('Bis', to)), perf,
        h('h2', null, 'Zuordnung'),
        h('p', 'a-muted', 'Neue Ads bekommen Recruiter und Creator aus dem Anzeigennamen ([ref:…] [cr:…]) oder von Schwester-Ads. Geerbtes bitte prüfen: Zahlungen dieser Leads lassen sich erst nach der Bestätigung bestätigen.'),
        CRM.tabs([['todo', `Zu erledigen (${ads.filter(todo).length})`], ['all', `Alle (${ads.length})`]], assignTab, (k) => { assignTab = k; CRM.refresh(); }),
        CRM.table([
          { t: 'Ad', v: (a) => h('span', null, a.name || a.meta_ad_id, h('small', 'a-muted', ` ${[a.campaign_name, a.adset_name].filter(Boolean).join(' › ')}`)) },
          { t: 'Status', v: (a) => a.status || '–' },
          { t: 'Hinweis', v: (a) => [a.defaults_from ? CRM.badge(FROM[a.defaults_from], 'warn') : null, unconfAds.has(a.id) ? CRM.badge(`${unconfAds.get(a.id)} Lead(s) prüfen`, 'warn') : null] },
          ...(() => { const cache = new Map(); const get = (a) => cache.get(a.id) || cache.set(a.id, assignRow(a, recs, cres, unconfAds.has(a.id))).get(a.id);
            return [{ t: 'Recruiter', v: (a) => get(a).rs }, { t: 'Creator', v: (a) => get(a).cs }, { t: '', v: (a) => get(a).box }]; })(),
        ], list, { empty: assignTab === 'todo' ? 'Alle Ads sind zugeordnet und geprüft.' : 'Noch keine Ads. Sie entstehen automatisch mit dem ersten Lead oder dem täglichen Sync.' }));
      await loadPerf();
    },
  });

  // ---------- Creators ----------
  CRM.page({
    id: 'creators', title: 'Creators', roles: ['admin'],
    async render(v) {
      const rows = await CRM.api('creators?select=*&order=active.desc,name');
      const detail = h('div');
      const open = (c) => {
        const name = CRM.input({ value: c.name || '' }), code = CRM.input({ value: c.code || '', placeholder: 'z. B. cleo' });
        const rate = CRM.input({ type: 'number', step: '0.1', min: '0', max: '100', value: c.commission_rate != null ? String(Number(c.commission_rate) * 100) : '', placeholder: 'leer = Standard' });
        const email = CRM.input({ type: 'email', value: c.email || '' }), iban = CRM.input({ value: c.iban || '', autocomplete: 'off' });
        const b = h('button', { class: 'btn', type: 'submit' }, c.id ? 'Speichern' : 'Anlegen');
        const f = h('form', { class: 'a-form', novalidate: true },
          h('div', 'a-grid2', CRM.field('Name', name), CRM.field('Code', code, 'Für den Anzeigennamen: [cr:code]'), CRM.field('Satz in %', rate), CRM.field('E-Mail', email), CRM.field('IBAN', iban)), b);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          CRM.run(b, async () => {
            if (!name.value.trim()) throw new Error('Bitte einen Namen angeben.');
            const body = { name: name.value.trim(), code: code.value.trim() || null, commission_rate: rate.value === '' ? null : Number(rate.value) / 100,
              email: email.value.trim() || null, iban: iban.value.replace(/\s+/g, '').toUpperCase() || null };
            if (c.id) await CRM.patch('creators', c.id, body); else await CRM.insert('creators', body);
            CRM.clearCache(); CRM.refresh();
          }, 'Gespeichert.');
        });
        const extra = [];
        if (c.code) extra.push(h('button', { class: 'btn out sm', type: 'button', on: { click: () => CRM.copy(`[cr:${c.code}]`) } }, 'Anzeigen-Tag kopieren'));
        if (c.id) {
          const t = h('button', { class: 'btn out sm', type: 'button' }, c.active ? 'Deaktivieren' : 'Aktivieren');
          t.addEventListener('click', () => CRM.run(t, async () => { await CRM.patch('creators', c.id, { active: !c.active }); CRM.clearCache(); CRM.refresh(); }));
          const del = h('button', { class: 'a-link del', type: 'button' }, 'Personendaten löschen (DSGVO)');
          del.addEventListener('click', () => CRM.run(del, async () => {
            const r = window.prompt('Grund der Löschung:'); if (!r) return;
            await CRM.rpc('erase_creator', { p_creator_id: c.id, p_reason: r }); CRM.clearCache(); CRM.refresh();
          }, 'Anonymisiert.'));
          extra.push(t, del);
        }
        detail.replaceChildren(h('section', 'a-box', h('div', 'a-head', h('h2', null, c.id ? c.name : 'Neuer Creator'),
          h('button', { class: 'a-link', type: 'button', on: { click: () => detail.replaceChildren() } }, 'Schließen')), f, h('div', 'a-actions', extra)));
      };
      v.append(h('div', 'a-head', h('h1', null, 'Creators'), h('button', { class: 'btn out', type: 'button', on: { click: () => open({}) } }, 'Creator anlegen')),
        h('p', 'a-muted', 'Die Personen in den Anzeigen. Sie werden pro bezahltem Lead aus ihrer Ad vergütet.'), detail,
        CRM.table([
          { t: 'Name', v: (c) => h('span', null, c.name, c.active ? null : CRM.badge('inaktiv', 'off')) },
          { t: 'Code', v: (c) => c.code || '–' },
          { t: 'Satz', v: (c) => (c.commission_rate != null ? CRM.pct(c.commission_rate) : 'Standard'), cls: 'num' },
          { t: 'IBAN', v: (c) => c.iban || '–' },
        ], rows, { onRow: open }));
    },
  });

  // ---------- Wochenberichte und Videoideen ----------
  // Sehr kleiner Markdown-Leser für die KI-Berichte: Überschriften, Listen, Fett. Alles als Text eingesetzt, kein HTML aus der KI.
  const md = (src) => {
    const out = h('div', 'a-md'); let ul = null;
    const inline = (txt) => txt.split(/(\*\*[^*]+\*\*)/g).map((p) => (p.startsWith('**') && p.endsWith('**') ? h('strong', null, p.slice(2, -2)) : p));
    for (const line of String(src || '').split('\n')) {
      const t = line.trim();
      const head = t.match(/^(#{1,4})\s+(.*)$/), li = t.match(/^[-*]\s+(.*)$/) || t.match(/^\d+\.\s+(.*)$/);
      if (li) { if (!ul) out.append(ul = h('ul')); ul.append(h('li', null, inline(li[1]))); continue; }
      ul = null;
      if (head) out.append(h(head[1].length <= 2 ? 'h3' : 'h4', null, inline(head[2])));
      else if (t.startsWith('|')) out.append(h('pre', null, t));
      else if (t) out.append(h('p', null, inline(t)));
    }
    return out;
  };
  const IDEA = { new: 'Neu', accepted: 'Angenommen', produced: 'Produziert', rejected: 'Abgelehnt' };

  CRM.page({
    id: 'reports', title: 'Berichte', roles: ['admin'],
    async render(v, id) {
      const reports = await CRM.api('ad_reports?select=id,period_from,period_to,status,error,model,created_at&order=period_to.desc&limit=30');
      v.append(h('h1', null, 'Wochenberichte'),
        h('p', 'a-muted', 'Jeden Montag automatisch aus den Zahlen der Woche. Die Urteile je Ad rechnet das System nach festen Regeln, die KI erklärt sie nur.'));
      if (!reports.length) { v.append(h('p', 'a-muted', 'Noch kein Bericht.')); return; }
      const cur = reports.find((r) => r.id === id) || reports[0];
      v.append(CRM.tabs(reports.slice(0, 8).map((r) => [r.id, `${CRM.day(r.period_from)} – ${CRM.day(r.period_to)}`]), cur.id, (k) => CRM.go('reports', k)));
      const [full] = await CRM.api(`ad_reports?id=eq.${cur.id}&select=report_md,report_json`);
      if (cur.status === 'failed') v.append(h('p', 'a-error', 'Bericht fehlgeschlagen: ' + (cur.error || 'unbekannt')));
      const warn = full?.report_json?.warnungen || [];
      if (warn.length) v.append(h('div', 'a-warn', h('strong', null, 'Warnungen'), h('ul', null, warn.map((w) => h('li', null, w)))));
      if (full?.report_md) v.append(h('section', 'a-box', md(full.report_md)));

      const ideas = await CRM.api(`video_ideas?select=*&order=created_at.desc&limit=60`);
      v.append(h('h2', null, 'Videoideen'), ideas.length ? h('div', 'a-ideas', ideas.map((i) => h('article', 'a-box',
        h('div', 'a-head', h('h3', null, i.title), CRM.badge(IDEA[i.status], i.status === 'new' ? 'new' : '')),
        h('p', null, h('strong', null, 'Hook: '), i.hook), h('pre', 'a-script', i.script), i.creator_hint ? h('p', 'a-muted', i.creator_hint) : null,
        h('div', 'a-actions', Object.entries(IDEA).filter(([k]) => k !== i.status && k !== 'new').map(([k, t]) => {
          const b = h('button', { class: 'btn out sm', type: 'button' }, t);
          b.addEventListener('click', () => CRM.run(b, async () => { await CRM.patch('video_ideas', i.id, { status: k }); CRM.refresh(); }));
          return b;
        }))))) : h('p', 'a-muted', 'Noch keine Ideen.'));
    },
  });
})();
