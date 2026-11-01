/* CRM: Übersicht, Leads, Offene Leads, Lead-Detail mit Zeitleiste, Lead von Hand, Tracking-Links. */
(() => {
  const { h } = CRM;
  const STATUS = { new: 'Neu', contacted: 'Kontaktiert', conversation: 'Im Gespräch', onboarding: 'Einarbeitung', paid: 'Bezahlt', lost: 'Verloren' };
  const SOURCE = { meta_ad: 'Meta-Ad', facebook_group: 'FB-Gruppe', indeed: 'Indeed', website: 'Website', manual: 'Von Hand', other: 'Sonstiges' };
  const REASON = { ref_code: 'Tracking-Link', ad: 'Ad', manual: 'von Hand' };
  const EVENT = {
    created: 'Angelegt', status_changed: 'Status geändert', assigned: 'Zugeteilt', note: 'Notiz', repeat_submission: 'Erneut angemeldet',
    payment_reported: 'Zahlung gemeldet', payment_confirmed: 'Zahlung bestätigt', payment_rejected: 'Zahlung abgelehnt',
    payment_reversed: 'Zahlung storniert', creator_missing: 'Creator fehlt', creator_corrected: 'Creator korrigiert', erased: 'Personendaten gelöscht',
  };
  Object.assign(CRM, { STATUS, SOURCE });
  const statusBadge = (s) => CRM.badge(STATUS[s] || s, s === 'new' ? 'new' : s === 'paid' ? 'ok' : s === 'lost' ? 'off' : '');
  const recName = (l) => l.recruiter?.full_name || (l.recruiter_id ? '…' : 'offen');

  // ---------- Übersicht ----------
  const tile = (label, count, target, warn) => h('a', { class: 'a-tile' + (warn && count > 0 ? ' warn' : ''), href: '#' + target },
    h('span', 'a-tile-n', count == null ? '–' : String(count)), h('span', null, label));
  const safeCount = (path) => CRM.api(path, { count: true }).catch(() => null);

  CRM.page({
    id: 'start', title: 'Übersicht', roles: ['admin', 'recruiter'],
    async render(v) {
      const now = new Date().toISOString();
      if (CRM.role === 'recruiter') {
        const [neu, due] = await Promise.all([safeCount('leads?status=eq.new'), safeCount(`leads?next_followup_at=lte.${now}&status=not.in.(paid,lost)`)]);
        v.append(h('h1', null, 'Übersicht'), h('div', 'a-tiles', tile('neue Leads', neu, 'leads'), tile('Wiedervorlagen fällig', due, 'leads', true)));
        return;
      }
      const c = await Promise.all([
        safeCount('leads?recruiter_id=is.null&status=neq.lost'),
        safeCount('leads?attribution_unconfirmed=is.true&status=neq.lost'),
        safeCount(`leads?next_followup_at=lte.${now}&status=not.in.(paid,lost)`),
        safeCount('partner_requests?status=eq.new'),
        safeCount('meta_webhook_events?status=in.(failed,dead)'),
        safeCount('ads?or=(recruiter_id.is.null,creator_id.is.null)'),
        safeCount('ads?defaults_from=not.is.null'),
      ]);
      v.append(h('h1', null, 'Übersicht'), h('div', 'a-tiles',
        tile('offene Leads', c[0], 'open', true), tile('Zuordnung prüfen', c[1], 'ads', true), tile('Wiedervorlagen fällig', c[2], 'leads'),
        tile('neue Partner-Anfragen', c[3], 'partners', true), tile('Webhook-Fehler', c[4], 'log', true),
        tile('Ads ohne Recruiter/Creator', c[5], 'ads', true), tile('Ads automatisch zugeordnet, bitte prüfen', c[6], 'ads', true)));
      if (CRM.money) {
        const m = await Promise.all([
          safeCount('payments?status=eq.reported'),
          CRM.api('v_payout_list?select=open_amount&open_amount=gt.0').then((r) => r.reduce((s, x) => s + Number(x.open_amount), 0)).catch(() => null),
          safeCount('commissions?status=eq.open&amount=lt.0'),
          safeCount('v_creator_gaps'),
        ]);
        v.append(h('h2', null, 'Geld'), h('div', 'a-tiles',
          tile('Zahlungen zu prüfen', m[0], 'payments', true),
          h('a', { class: 'a-tile', href: '#payouts' }, h('span', 'a-tile-n', CRM.eur(m[1])), h('span', null, 'offen auszuzahlen')),
          tile('offene Rückforderungen', m[2], 'commissions', true), tile('Creator-Lücken', m[3], 'commissions', true)));
      }
    },
  });

  // ---------- Leads (Admin: alle, Recruiter: eigene – RLS) ----------
  const LEAD_SELECT = 'id,lead_code,first_name,last_name,phone,email,source,status,recruiter_id,assignment_reason,created_at,next_followup_at,possible_duplicate_of,attribution_unconfirmed,ref_code,meta_ad_id_raw,ad:ads(name),recruiter:profiles!leads_recruiter_id_fkey(full_name)';
  const filters = { status: 'active', source: '', rec: '', q: '' };

  CRM.page({
    id: 'leads', title: () => (CRM.role === 'admin' ? 'Leads' : 'Meine Leads'), roles: ['admin', 'recruiter'],
    async render(v) {
      const admin = CRM.role === 'admin';
      const list = h('div');
      const load = async () => {
        let q = `leads?select=${LEAD_SELECT}&order=created_at.desc&limit=300`;
        if (filters.status === 'active') q += '&status=not.in.(paid,lost)';
        else if (filters.status === 'due') q += `&next_followup_at=lte.${new Date().toISOString()}&status=not.in.(paid,lost)`;
        else if (filters.status) q += `&status=eq.${filters.status}`;
        if (filters.source) q += `&source=eq.${filters.source}`;
        if (filters.rec === 'none') q += '&recruiter_id=is.null'; else if (filters.rec) q += `&recruiter_id=eq.${filters.rec}`;
        const s = filters.q.trim().replace(/[,()*]/g, ' ').trim();
        if (s) q += `&or=(first_name.ilike.*${encodeURIComponent(s)}*,last_name.ilike.*${encodeURIComponent(s)}*,email.ilike.*${encodeURIComponent(s)}*,phone.ilike.*${encodeURIComponent(s)}*,lead_code.ilike.*${encodeURIComponent(s)}*)`;
        list.replaceChildren(h('p', 'a-muted', 'Lade …'));
        const rows = await CRM.api(q);
        list.replaceChildren(h('p', 'a-muted', `${rows.length} Lead${rows.length === 1 ? '' : 's'}${rows.length === 300 ? ' (die neuesten 300, Filter nutzen)' : ''}`),
          CRM.table([
            { t: 'Lead', v: (l) => l.lead_code },
            { t: 'Name', v: (l) => h('span', null, CRM.name(l), l.possible_duplicate_of ? h('span', 'badge warn', 'Dublette?') : null) },
            { t: 'Telefon', v: (l) => l.phone ? h('a', { href: 'tel:' + l.phone.replace(/[^+\d]/g, '') }, l.phone) : '–' },
            { t: 'Quelle', v: (l) => SOURCE[l.source] || l.source },
            { t: 'Status', v: (l) => statusBadge(l.status) },
            admin ? { t: 'Betreuer', v: recName } : null,
            { t: 'Ad', v: (l) => l.ad?.name || '–' },
            { t: 'Wiedervorlage', v: (l) => l.next_followup_at ? CRM.fmt(l.next_followup_at) : '–' },
            { t: 'Eingang', v: (l) => CRM.fmt(l.created_at) },
          ].filter(Boolean), rows, { onRow: (l) => CRM.go('lead', l.id), empty: 'Keine Leads für diesen Filter.' }));
      };
      const search = CRM.input({ type: 'search', value: filters.q, placeholder: 'Name, E-Mail, Telefon, L-…' });
      search.addEventListener('change', () => { filters.q = search.value; load(); });
      const st = CRM.select([['active', 'Aktiv (ohne bezahlt/verloren)'], ['due', 'Wiedervorlage fällig'], ['', 'Alle'], ...Object.entries(STATUS)], filters.status);
      st.addEventListener('change', () => { filters.status = st.value; load(); });
      const bar = [CRM.field('Suche', search), CRM.field('Status', st)];
      if (admin) {
        const so = CRM.select([['', 'Alle'], ...Object.entries(SOURCE)], filters.source);
        so.addEventListener('change', () => { filters.source = so.value; load(); });
        const rec = CRM.select([['', 'Alle'], ['none', 'Offen (ohne Betreuer)'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], filters.rec);
        rec.addEventListener('change', () => { filters.rec = rec.value; load(); });
        bar.push(CRM.field('Quelle', so), CRM.field('Betreuer', rec));
      }
      v.append(h('div', 'a-head', h('h1', null, admin ? 'Leads' : 'Meine Leads'), h('a', { class: 'btn out', href: '#new' }, 'Lead von Hand anlegen')),
        h('div', 'a-filters', bar), list);
      await load();
    },
  });

  // ---------- Offene Leads (Admin verteilt) ----------
  CRM.page({
    id: 'open', title: 'Offene Leads', roles: ['admin'],
    async render(v) {
      const [rows, recs] = await Promise.all([
        CRM.api(`leads?select=${LEAD_SELECT}&recruiter_id=is.null&status=neq.lost&order=created_at.desc&limit=500`),
        CRM.recruiters(true),
      ]);
      const picked = new Set();
      const recOpts = [['', 'Recruiter wählen …'], ...recs.map((r) => [r.id, r.full_name])];
      const bulkSel = CRM.select(recOpts, '');
      const bulkBtn = h('button', { class: 'btn', type: 'button' }, 'Ausgewählte zuteilen');
      bulkBtn.addEventListener('click', () => CRM.run(bulkBtn, async () => {
        if (!bulkSel.value || !picked.size) throw new Error('Bitte Leads und Recruiter wählen.');
        for (const id of picked) await CRM.rpc('assign_lead', { p_lead_id: id, p_recruiter_id: bulkSel.value });
        CRM.refresh();
      }, 'Zugeteilt.'));
      const why = (l) => l.ref_code ? `unbekannter Link-Code „${l.ref_code}“` : l.ad?.name ? `Ad „${l.ad.name}“ ohne Recruiter` : l.meta_ad_id_raw ? `unbekannte Ad-ID ${l.meta_ad_id_raw}` : SOURCE[l.source] || l.source;
      v.append(h('h1', null, 'Offene Leads'),
        h('p', 'a-muted', 'Leads ohne Betreuer. Gehört eine Ad einem Recruiter, wandern ihre offenen Leads automatisch zu ihm (Seite Ads).'),
        rows.length ? h('div', 'a-filters', CRM.field('Mehrere zuteilen an', bulkSel), bulkBtn) : null,
        CRM.table([
          { t: '', v: (l) => h('input', { type: 'checkbox', 'aria-label': 'Auswählen', on: { change: (e) => { e.target.checked ? picked.add(l.id) : picked.delete(l.id); } } }) },
          { t: 'Lead', v: (l) => h('a', { href: '#lead/' + l.id }, l.lead_code) },
          { t: 'Name', v: (l) => CRM.name(l) },
          { t: 'Woher', v: why },
          { t: 'Eingang', v: (l) => CRM.fmt(l.created_at) },
          { t: 'Zuteilen', v: (l) => {
            const s = CRM.select(recOpts, '');
            const b = h('button', { class: 'btn out sm', type: 'button' }, 'OK');
            b.addEventListener('click', () => CRM.run(b, async () => {
              if (!s.value) throw new Error('Bitte Recruiter wählen.');
              await CRM.rpc('assign_lead', { p_lead_id: l.id, p_recruiter_id: s.value }); CRM.refresh();
            }, 'Zugeteilt.'));
            return h('div', 'a-inline', s, b);
          } },
        ], rows, { empty: 'Keine offenen Leads. Alles verteilt.' }));
    },
  });

  // ---------- Lead-Detail ----------
  const section = (title, ...kids) => h('section', 'a-box', h('h2', null, title), ...kids);

  CRM.page({
    id: 'lead', title: 'Lead', roles: ['admin', 'recruiter'], nav: false,
    async render(v, id) {
      const admin = CRM.role === 'admin';
      const [l] = await CRM.api(`leads?id=eq.${id}&select=*,ad:ads(name,meta_ad_id,defaults_from),recruiter:profiles!leads_recruiter_id_fkey(full_name),closer:profiles!leads_closed_by_fkey(full_name),creator:creators(name)`);
      if (!l) { v.append(h('p', 'a-error', 'Lead nicht gefunden oder kein Zugriff.')); return; }
      const events = await CRM.api(`lead_events?lead_id=eq.${id}&select=*,actor:profiles(full_name)&order=created_at.desc`);

      v.append(h('p', null, h('a', { href: '#leads' }, '← Zurück zur Liste')),
        h('div', 'a-head', h('h1', null, `${l.lead_code} · ${CRM.name(l)}`), statusBadge(l.status)));
      if (l.attribution_unconfirmed) {
        const b = admin ? h('button', { class: 'btn out sm', type: 'button' }, 'Zuordnung ist richtig') : null;
        if (b) b.addEventListener('click', () => CRM.run(b, async () => { await CRM.rpc('confirm_lead_attribution', { p_lead_id: id }); CRM.refresh(); }, 'Bestätigt.'));
        v.append(h('p', 'a-warn', 'Recruiter/Creator kamen automatisch von einer Schwester-Ad. Eine Zahlung lässt sich erst bestätigen, wenn der Admin die Zuordnung geprüft hat. ', b));
      }

      const contact = h('div', 'lead-contact',
        l.phone ? h('a', { href: 'tel:' + l.phone.replace(/[^+\d]/g, '') }, l.phone) : null,
        l.email ? h('a', { href: 'mailto:' + l.email }, l.email) : null);
      const facts = [
        ['Quelle', SOURCE[l.source] || l.source], ['Betreuer', recName(l) + (l.assignment_reason ? ` (${REASON[l.assignment_reason]})` : '')],
        ['Ad', l.ad?.name || (l.meta_ad_id_raw ? `unbekannt (Meta-ID ${l.meta_ad_id_raw})` : '–')], ['Creator', l.creator?.name || '–'],
        ['Link-Code', l.ref_code || '–'], ['Kampagne (UTM)', [l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(' / ') || '–'],
        ['Eingang', CRM.fmt(l.created_at)], ['Geclosed', l.closed_at ? `${CRM.fmt(l.closed_at)} von ${l.closer?.full_name || '…'}` : '–'],
        ...Object.entries(l.extra || {}).filter(([k]) => !['legacy_id', 'is_organic'].includes(k)).map(([k, x]) => [k, String(x)]),
      ];
      const dl = h('dl', null, facts.map(([k, x]) => h('div', null, h('dt', null, k), h('dd', null, x))));
      if (l.possible_duplicate_of) dl.append(h('div', null, h('dt', null, 'Mögliche Dublette'), h('dd', null, h('a', { href: '#lead/' + l.possible_duplicate_of }, 'früheren Lead öffnen'))));
      v.append(section('Kontakt', contact, dl));

      // Status, Verlustgrund, Wiedervorlage (das dürfen auch Recruiter; "paid" setzt nur die Zahlungsbestätigung)
      if (l.status !== 'paid') {
        const st = CRM.select(Object.entries(STATUS).filter(([k]) => k !== 'paid'), l.status);
        const lost = CRM.input({ value: l.lost_reason || '', placeholder: 'z. B. nicht erreichbar, kein Interesse' });
        const lostField = CRM.field('Verlustgrund', lost);
        const toLocal = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
        const fu = CRM.input({ type: 'datetime-local', value: toLocal(l.next_followup_at) });
        const sync = () => { lostField.hidden = st.value !== 'lost'; };
        st.addEventListener('change', sync); sync();
        const b = h('button', { class: 'btn', type: 'submit' }, 'Speichern');
        const f = h('form', { class: 'a-form', novalidate: true }, CRM.field('Status', st), lostField, CRM.field('Wiedervorlage', fu), b);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          CRM.run(b, async () => {
            if (st.value === 'lost' && !lost.value.trim()) throw new Error('Bitte einen Verlustgrund angeben.');
            await CRM.patch('leads', id, { status: st.value, lost_reason: st.value === 'lost' ? lost.value.trim() : null, next_followup_at: fu.value ? new Date(fu.value).toISOString() : null });
            CRM.refresh();
          }, 'Gespeichert.');
        });
        v.append(section('Stand', f));
      }

      if (admin && l.status !== 'paid') {
        const s = CRM.select([['', 'Recruiter wählen …'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], l.recruiter_id);
        const b = h('button', { class: 'btn out', type: 'button' }, 'Zuteilen');
        b.addEventListener('click', () => CRM.run(b, async () => {
          if (!s.value) throw new Error('Bitte Recruiter wählen.');
          await CRM.rpc('assign_lead', { p_lead_id: id, p_recruiter_id: s.value }); CRM.refresh();
        }, 'Zugeteilt.'));
        v.append(section('Betreuer', h('div', 'a-inline', s, b)));
      }

      // Geld (nur wenn freigeschaltet): Zahlung melden/bestätigen, Creator korrigieren, als Setter anlegen
      if (CRM.money && CRM.leadMoney) await CRM.leadMoney(v, l, section);

      const note = h('textarea', { placeholder: 'Notiz, z. B. Rückruf vereinbart', 'aria-label': 'Notiz' });
      const nb = h('button', { class: 'btn out', type: 'button' }, 'Notiz speichern');
      nb.addEventListener('click', () => CRM.run(nb, async () => {
        await CRM.rpc('add_lead_note', { p_lead_id: id, p_text: note.value }); CRM.refresh();
      }, 'Notiz gespeichert.'));

      const describe = (e) => {
        const d = e.detail || {};
        if (e.event_type === 'note') return d.erased ? '(gelöscht)' : d.text;
        if (e.event_type === 'status_changed') return `${STATUS[d.from] || d.from} → ${STATUS[d.to] || d.to}`;
        if (e.event_type === 'assigned') return d.reason ? `Grund: ${REASON[d.reason] || d.reason}` : '';
        if (e.event_type === 'created') return `${SOURCE[d.source] || d.source || ''}${d.assignment_reason ? ', zugeteilt per ' + REASON[d.assignment_reason] : ', offen'}`;
        if (e.event_type === 'repeat_submission') return `über ${d.ref ? 'Link-Code ' + d.ref : d.src || 'die Website'}`;
        if (d.reason) return d.reason;
        if (d.amount) return CRM.eur(d.amount);
        return '';
      };
      v.append(section('Zeitleiste', h('div', 'a-form', note, nb),
        h('ol', 'a-timeline', events.map((e) => h('li', null,
          h('span', 'a-muted', `${CRM.fmt(e.created_at)} · ${e.actor?.full_name || (e.actor_id ? '…' : 'System')}`),
          h('strong', null, EVENT[e.event_type] || e.event_type), h('span', null, describe(e)))))));

      if (admin) {
        const reason = CRM.input({ placeholder: 'Grund, z. B. Löschanfrage per E-Mail vom …' });
        const b = h('button', { class: 'a-link del', type: 'button' }, 'Personendaten löschen (DSGVO)');
        b.addEventListener('click', () => CRM.run(b, async () => {
          if (!reason.value.trim()) throw new Error('Bitte einen Grund angeben.');
          if (!confirm('Name, Kontaktdaten, Formularantworten und Notiztexte dieses Leads unwiderruflich entfernen? Buchungen bleiben anonym erhalten.')) return;
          await CRM.rpc('erase_lead', { p_lead_id: id, p_reason: reason.value.trim() }); CRM.refresh();
        }, 'Personendaten entfernt. Belege im Storage ggf. separat löschen.'));
        v.append(h('details', 'a-box', h('summary', null, 'Datenschutz-Löschung'), h('div', 'a-form', CRM.field('Grund', reason), b)));
      }
    },
  });

  // ---------- Lead von Hand ----------
  CRM.page({
    id: 'new', title: 'Lead anlegen', roles: ['admin', 'recruiter'],
    async render(v) {
      const admin = CRM.role === 'admin';
      const fn = CRM.input({ autocomplete: 'off' }), ln = CRM.input({ autocomplete: 'off' });
      const em = CRM.input({ type: 'email', autocomplete: 'off' }), ph = CRM.input({ type: 'tel', autocomplete: 'off' });
      const src = CRM.select([['manual', 'Von Hand / Telefon'], ['indeed', 'Indeed'], ['facebook_group', 'FB-Gruppe'], ['other', 'Sonstiges']], 'manual');
      const rec = admin ? CRM.select([['', 'offen lassen'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], '') : null;
      const note = h('textarea', { 'aria-label': 'Notiz' });
      const b = h('button', { class: 'btn', type: 'submit' }, 'Anlegen');
      const f = h('form', { class: 'a-form', novalidate: true },
        h('div', 'a-grid2', CRM.field('Vorname', fn), CRM.field('Nachname', ln), CRM.field('E-Mail', em), CRM.field('Telefon', ph)),
        CRM.field('Quelle', src), rec ? CRM.field('Betreuer', rec) : null, CRM.field('Notiz (optional)', note), b);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        CRM.run(b, async () => {
          const id = await CRM.rpc('create_manual_lead', {
            p_first_name: fn.value.trim() || null, p_last_name: ln.value.trim() || null, p_email: em.value.trim() || null, p_phone: ph.value.trim() || null,
            p_source: src.value, p_recruiter_id: rec?.value || null, p_note: note.value.trim() || null,
          });
          CRM.go('lead', id);
        }, 'Lead angelegt.');
      });
      v.append(h('h1', null, 'Lead von Hand anlegen'),
        h('p', 'a-muted', admin ? 'Telefon oder E-Mail ist Pflicht.' : 'Telefon oder E-Mail ist Pflicht. Der Lead gehört automatisch dir.'), f);
    },
  });

  // ---------- Meine Links (Recruiter) ----------
  CRM.page({
    id: 'links', title: 'Meine Links', roles: ['recruiter'],
    async render(v) {
      const [p] = await CRM.api(`profiles?id=eq.${CRM.me}&select=ref_code,full_name`);
      if (!p?.ref_code) { v.append(h('h1', null, 'Meine Links'), h('p', 'a-muted', 'Für dein Profil ist noch kein Link-Code hinterlegt. Bitte den Admin fragen.')); return; }
      const row = (label, text, hint) => h('div', 'a-copy', h('div', null, h('strong', null, label), h('code', null, text), hint ? h('small', 'a-muted', hint) : null),
        h('button', { class: 'btn out sm', type: 'button', on: { click: () => CRM.copy(text) } }, 'Kopieren'));
      v.append(h('h1', null, 'Meine Links'),
        h('p', 'a-muted', 'Wer sich über deinen Link bewirbt, landet automatisch bei dir.'),
        row('Allgemein', CRM.trackLink(p.ref_code)),
        row('Facebook-Gruppe', CRM.trackLink(p.ref_code, { src: 'fbgroup' }), 'Für einzelne Beiträge erzeugt die Seite „Gruppen“ einen Link mit Beitrags-Kennung.'),
        row('Indeed', CRM.trackLink(p.ref_code, { src: 'indeed' })),
        row('Namens-Tag für Meta-Anzeigen', `[ref:${p.ref_code}]`, 'In den Anzeigennamen schreiben: Leads aus dieser Anzeige gehen an dich.'));
    },
  });
})();
