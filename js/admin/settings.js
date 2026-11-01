/* CRM: Partner-Anfragen (bAV-Vermittler), Einstellungen (Beträge), Verlauf und Webhook-Fehler. */
(() => {
  const { h } = CRM;

  // ---------- Partner-Anfragen (früher die ganze Admin-Seite) ----------
  let pFilter = 'new';
  CRM.page({
    id: 'partners', title: 'Partner-Anfragen', roles: ['admin'],
    async render(v) {
      const rows = await CRM.api(`partner_requests?select=*,by:profiles(full_name)${pFilter ? '&status=eq.' + pFilter : ''}&order=created_at.desc&limit=300`);
      const card = (r) => {
        const done = r.status === 'contacted';
        const note = h('textarea', { value: r.note || '', placeholder: 'Notiz (z. B. Rückruf vereinbart)', 'aria-label': 'Notiz' });
        note.addEventListener('change', () => CRM.run(null, () => CRM.patch('partner_requests', r.id, { note: note.value.trim() || null }), 'Notiz gespeichert.'));
        const b = h('button', { class: done ? 'btn out' : 'btn', type: 'button' }, done ? 'Wieder auf „Neu“ setzen' : 'Als kontaktiert markieren');
        b.addEventListener('click', () => CRM.run(b, async () => {
          await CRM.patch('partner_requests', r.id, done ? { status: 'new', contacted_at: null, contacted_by: null }
            : { status: 'contacted', contacted_at: new Date().toISOString(), contacted_by: CRM.me });
          CRM.refresh();
        }));
        const del = h('button', { class: 'a-link del', type: 'button' }, 'Löschen');
        del.addEventListener('click', () => CRM.run(del, async () => {
          if (!confirm(`Anfrage von „${r.name}“ endgültig löschen?`)) return;
          await CRM.api(`partner_requests?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); CRM.refresh();
        }));
        const dl = h('dl', null, [['Firma', r.company], ['Nachricht', r.message], ...Object.entries(r.data || {}).filter(([k]) => !['legacy_id', 'contacted_by'].includes(k))]
          .filter(([, x]) => x).map(([k, x]) => h('div', null, h('dt', null, k), h('dd', null, String(x)))));
        return h('li', 'lead' + (done ? ' done' : ''),
          h('div', 'lead-top', h('div', null, h('h2', 'lead-name', r.name), h('p', 'lead-meta', `Anfrage Vermittler · ${CRM.fmt(r.created_at)}`)), CRM.badge(done ? 'Kontaktiert' : 'Neu', done ? '' : 'new')),
          h('div', 'lead-contact', r.email ? h('a', { href: 'mailto:' + r.email }, r.email) : null, r.phone ? h('a', { href: 'tel:' + r.phone.replace(/[^+\d]/g, '') }, r.phone) : null),
          dl.children.length ? dl : null, note,
          h('div', 'lead-actions', b, done && r.contacted_at ? h('span', 'lead-saved', `am ${CRM.fmt(r.contacted_at)}${r.by ? ' von ' + r.by.full_name : ''}`) : null, del));
      };
      v.append(h('h1', null, 'Partner-Anfragen'), h('p', 'a-muted', 'Anfragen von bAV-Vermittlern über die Startseite.'),
        CRM.tabs([['new', 'Neu'], ['contacted', 'Kontaktiert'], ['', 'Alle']], pFilter, (k) => { pFilter = k; CRM.refresh(); }),
        rows.length ? h('ul', 'a-list', rows.map(card)) : h('p', 'a-muted', 'Keine Einträge.'));
    },
  });

  // ---------- Einstellungen ----------
  CRM.page({
    id: 'settings', title: 'Einstellungen', roles: ['admin'],
    async render(v) {
      const rows = await CRM.api('app_settings?select=*&order=key');
      v.append(h('h1', null, 'Einstellungen'), h('p', 'a-muted', 'Änderungen gelten für neue Bestätigungen. Bereits gebuchte Provisionen behalten ihren Betrag.'),
        ...rows.map((s) => {
          const isRate = s.key.endsWith('_rate');
          const inp = CRM.input({ type: 'number', step: isRate ? '0.1' : '0.01', min: '0', value: String(isRate ? Number(s.value) * 100 : s.value) });
          const b = h('button', { class: 'btn out sm', type: 'button' }, 'Speichern');
          b.addEventListener('click', () => CRM.run(b, async () => {
            if (inp.value === '' || Number(inp.value) < 0) throw new Error('Bitte eine Zahl ab 0 angeben.');
            await CRM.api(`app_settings?key=eq.${s.key}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { value: isRate ? Number(inp.value) / 100 : Number(inp.value) } });
          }, 'Gespeichert.'));
          return h('div', 'a-inline', CRM.field(`${s.description || s.key}${isRate ? ' (in %)' : ' (EUR)'}`, inp), b);
        }));
    },
  });

  // ---------- Verlauf ----------
  let logTable = '';
  CRM.page({
    id: 'log', title: 'Verlauf', roles: ['admin'],
    async render(v) {
      const hooks = await CRM.api('meta_webhook_events?select=id,leadgen_id,status,attempts,last_error,received_at,next_retry_at&status=in.(failed,dead)&order=received_at.desc&limit=50');
      // audit_log.actor_profile_id hat bewusst keinen Fremdschlüssel (Verlauf bleibt auch nach Löschungen stehen): Namen separat holen.
      const [log, people] = await Promise.all([
        CRM.api(`audit_log?select=*${logTable ? '&table_name=eq.' + logTable : ''}&order=created_at.desc&limit=200`),
        CRM.api('profiles?select=id,full_name'),
      ]);
      const who = new Map(people.map((p) => [p.id, p.full_name]));
      const diff = (r) => {
        if (r.action !== 'UPDATE') return r.action === 'INSERT' ? 'angelegt' : 'gelöscht';
        const o = r.old_data || {}, n = r.new_data || {};
        return Object.keys(n).filter((k) => k !== 'updated_at' && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
          .map((k) => `${k}: ${JSON.stringify(o[k] ?? null)} → ${JSON.stringify(n[k] ?? null)}`).join('; ') || '(keine sichtbare Änderung)';
      };
      v.append(h('h1', null, 'Verlauf'),
        h('h2', null, 'Meta-Webhook: Fehler'),
        h('p', 'a-muted', '„failed“ wird alle 10 Minuten neu versucht, „dead“ nach 8 Versuchen aufgegeben (dann Token/Rechte prüfen; Leads notfalls im Meta-Leads-Center exportieren).'),
        CRM.table([
          { t: 'Eingang', v: (e) => CRM.fmt(e.received_at) }, { t: 'Leadgen-ID', v: (e) => e.leadgen_id }, { t: 'Status', v: (e) => CRM.badge(e.status, e.status === 'dead' ? 'off' : 'warn') },
          { t: 'Versuche', v: (e) => String(e.attempts), cls: 'num' }, { t: 'Fehler', v: (e) => e.last_error || '–' }, { t: 'Nächster Versuch', v: (e) => (e.status === 'dead' ? '–' : CRM.fmt(e.next_retry_at)) },
        ], hooks, { empty: 'Keine Fehler.' }),
        h('h2', null, 'Änderungen'),
        CRM.tabs([['', 'Alle'], ['profiles', 'Betreuer'], ['ads', 'Ads'], ['creators', 'Creators'], ['app_settings', 'Einstellungen'], ...(CRM.money ? [['payments', 'Zahlungen'], ['commissions', 'Provisionen'], ['payouts', 'Auszahlungen']] : [])],
          logTable, (k) => { logTable = k; CRM.refresh(); }),
        CRM.table([
          { t: 'Zeit', v: (r) => CRM.fmt(r.created_at) }, { t: 'Wer', v: (r) => (r.actor_profile_id ? who.get(r.actor_profile_id) || '…' : 'System') },
          { t: 'Tabelle', v: (r) => r.table_name }, { t: 'Änderung', v: diff, cls: 'wrap' },
        ], log));
    },
  });
})();
