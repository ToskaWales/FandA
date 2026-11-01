/* CRM: Partner-Anfragen (bAV-Vermittler), Einstellungen (Beträge), Verlauf und Fehler beim Facebook-Abruf. */
(() => {
  const { h } = CRM;

  // ---------- Partner-Anfragen ----------
  let pFilter = 'new';
  CRM.page({
    id: 'partners', title: 'Partner-Anfragen', group: 'Verwaltung', icon: 'handshake', roles: ['admin'],
    badge: () => CRM.count('partner_requests?status=eq.new'),
    async render(v) {
      const rows = await CRM.api(`partner_requests?select=*,by:profiles(full_name)${pFilter ? '&status=eq.' + pFilter : ''}&order=created_at.desc&limit=300`);
      const card = (r) => {
        const done = r.status === 'contacted';
        const note = h('textarea', { value: r.note || '', placeholder: 'Notiz, z. B. „Rückruf Dienstag vereinbart“', 'aria-label': 'Notiz' });
        note.addEventListener('change', () => CRM.run(null, () => CRM.patch('partner_requests', r.id, { note: note.value.trim() || null }), 'Notiz gespeichert ✓'));
        const toggle = CRM.btn(done ? 'Wieder auf „Neu“' : 'Habe mich gemeldet ✓', (e) => CRM.run(e.currentTarget, async () => {
          await CRM.patch('partner_requests', r.id, done ? { status: 'new', contacted_at: null, contacted_by: null } : { status: 'contacted', contacted_at: new Date().toISOString(), contacted_by: CRM.me });
          CRM.refresh();
        }), done ? 'soft sm' : 'green sm');
        const del = h('button', { type: 'button', class: 'link link--danger', on: { click: async () => {
          if (!await CRM.confirm('Anfrage löschen?', `Die Anfrage von ${r.name} wird endgültig gelöscht.`, 'Löschen', true)) return;
          CRM.run(null, async () => { await CRM.api(`partner_requests?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); CRM.refresh(); }, 'Gelöscht.');
        } } }, 'Löschen');
        const extra = Object.entries(r.data || {}).filter(([k]) => !['legacy_id', 'contacted_by'].includes(k));
        return h('article', 'card stack',
          h('div', 'spread', h('div', null, h('h3', null, r.name), h('p', 'soft', { style: 'font-size:14px' }, [r.company, CRM.when(r.created_at)].filter(Boolean).join(' · '))), CRM.chip(done ? 'Erledigt' : 'Neu', done ? 'ok' : 'new')),
          h('div', 'row', r.phone ? h('a', { class: 'btn btn--sm', href: CRM.tel(r.phone) }, CRM.icon('phone'), r.phone) : null, r.email ? h('a', { class: 'btn btn--ghost btn--sm', href: 'mailto:' + r.email }, CRM.icon('mail'), 'E-Mail') : null),
          r.message ? h('p', 'quote', r.message) : null,
          extra.length ? CRM.facts(extra.map(([k, x]) => [k, String(x)])) : null,
          note,
          h('div', 'spread', h('div', 'row', toggle, done && r.contacted_at ? h('span', 'soft', { style: 'font-size:14px' }, `${CRM.when(r.contacted_at)}${r.by ? ' von ' + r.by.full_name : ''}`) : null), del));
      };
      v.append(CRM.head('Partner-Anfragen', 'Anfragen von bAV-Vermittlern über die Startseite der Website. Melde dich und hake sie dann ab.'),
        CRM.pills([['new', 'Neu'], ['contacted', 'Erledigt'], ['', 'Alle']], pFilter, (k) => { pFilter = k; CRM.refresh(); }),
        rows.length ? h('div', 'cards', rows.map(card)) : (pFilter === 'new' ? h('div', 'card done-all', h('span', 'ok', CRM.icon('check')), h('div', null, h('h2', null, 'Keine neuen Anfragen'), h('p', 'soft', 'Alles beantwortet.'))) : CRM.empty('Keine Einträge.')));
    },
  });

  // ---------- Einstellungen ----------
  const LABEL = {
    payment_amount_eur: ['Einzahlung des Bewerbers', 'EUR', 'So viel überweist ein neuer Bewerber.'],
    recruiter_reward_eur: ['Provision für den Recruiter', 'EUR', 'Pro bestätigter Einzahlung.'],
    creator_rate: ['Anteil des Models', '%', 'Von der Einzahlung, für das Model in der Anzeige. Einzelne Models können abweichen (Seite Models).'],
  };
  CRM.page({
    id: 'settings', title: 'Einstellungen', group: 'Verwaltung', icon: 'gear', roles: ['admin'],
    async render(v) {
      const rows = await CRM.api('app_settings?select=*&order=key');
      v.append(CRM.head('Einstellungen', 'Die Beträge für Einzahlung und Provisionen. Änderungen gelten ab der nächsten bestätigten Einzahlung, bereits gebuchte Beträge bleiben.'),
        h('div', 'cards', rows.map((s) => {
          const [title, unit, hint] = LABEL[s.key] || [s.description || s.key, '', ''];
          const isRate = unit === '%';
          const inp = CRM.input({ type: 'number', step: isRate ? '0.1' : '0.01', min: '0', inputmode: 'decimal', value: String(isRate ? Math.round(Number(s.value) * 1000) / 10 : s.value) });
          const b = CRM.btn('Speichern', (e) => CRM.run(e.currentTarget, async () => {
            if (inp.value === '' || Number(inp.value) < 0) throw new Error('Bitte eine Zahl ab 0 eingeben.');
            await CRM.api(`app_settings?key=eq.${s.key}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { value: isRate ? Number(inp.value) / 100 : Number(inp.value) } });
          }, 'Gespeichert ✓'), 'ghost sm');
          return h('section', 'card stack', h('h3', null, title), CRM.field(`Betrag in ${unit}`, inp, hint), h('div', null, b));
        })));
    },
  });

  // ---------- Verlauf ----------
  const TABLE = { profiles: 'Team', ads: 'Anzeigen', creators: 'Models', app_settings: 'Einstellungen', payments: 'Einzahlungen', commissions: 'Provisionen', payouts: 'Auszahlungen', partner_requests: 'Partner-Anfragen' };
  let logTable = '';
  CRM.page({
    id: 'log', title: 'Verlauf', group: 'Verwaltung', icon: 'clock', roles: ['admin'],
    async render(v) {
      // audit_log.actor_profile_id hat bewusst keinen Fremdschlüssel (Verlauf bleibt auch nach Löschungen stehen): Namen separat holen.
      const [hooks, log, people] = await Promise.all([
        CRM.api('meta_webhook_events?select=id,leadgen_id,status,attempts,last_error,received_at,next_retry_at&status=in.(failed,dead)&order=received_at.desc&limit=50'),
        CRM.api(`audit_log?select=*${logTable ? '&table_name=eq.' + logTable : ''}&order=created_at.desc&limit=200`),
        CRM.api('profiles?select=id,full_name'),
      ]);
      const who = new Map(people.map((p) => [p.id, p.full_name]));
      const diff = (r) => {
        if (r.action !== 'UPDATE') return r.action === 'INSERT' ? 'neu angelegt' : 'gelöscht';
        const o = r.old_data || {}, n = r.new_data || {};
        return Object.keys(n).filter((k) => k !== 'updated_at' && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
          .map((k) => `${k}: ${JSON.stringify(o[k] ?? null)} → ${JSON.stringify(n[k] ?? null)}`).join('; ') || '(keine sichtbare Änderung)';
      };
      v.append(CRM.head('Verlauf', 'Wer hat wann was geändert. Zum Nachschauen, falls etwas komisch aussieht.'));
      if (hooks.length) {
        v.append(CRM.note('', h('span', null, h('strong', null, `${hooks.length} Leads von Facebook konnten nicht abgeholt werden. `),
          'Das System versucht es automatisch neu. Steht „aufgegeben“, ist meist der Facebook-Zugang abgelaufen: Bitte den Techniker informieren. Die Leads sind im Facebook-Werbeanzeigenmanager unter „Leads“ trotzdem sichtbar.')), h('div', { style: 'height:14px' }),
        CRM.table([
          { t: 'Eingang', cls: 'main', v: (e) => CRM.when(e.received_at) }, { t: 'Stand', v: (e) => (e.status === 'dead' ? CRM.chip('aufgegeben', 'bad') : CRM.chip(`neuer Versuch ${CRM.when(e.next_retry_at)}`, 'warn')) },
          { t: 'Versuche', cls: 'num', v: (e) => String(e.attempts) }, { t: 'Fehler (technisch)', cls: 'hide-m', v: (e) => e.last_error || '–' },
        ], hooks));
      }
      v.append(CRM.section('Änderungen'),
        CRM.pills([['', 'Alles'], ['profiles', 'Team'], ['ads', 'Anzeigen'], ['creators', 'Models'], ['app_settings', 'Einstellungen'], ...(CRM.money ? [['payments', 'Einzahlungen'], ['payouts', 'Auszahlungen']] : [])],
          logTable, (k) => { logTable = k; CRM.refresh(); }),
        CRM.table([
          { t: 'Wann', cls: 'main', v: (r) => h('span', null, CRM.when(r.created_at), h('small', null, TABLE[r.table_name] || r.table_name)) },
          { t: 'Wer', v: (r) => (r.actor_profile_id ? who.get(r.actor_profile_id) || '…' : 'automatisch') },
          { t: 'Was', v: (r) => h('span', { style: 'white-space:normal;word-break:break-word;font-size:14px' }, diff(r)) },
        ], log, { empty: 'Noch keine Änderungen.' }));
    },
  });
})();
