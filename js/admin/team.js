/* CRM: Team (Recruiter, Admins) anlegen, bearbeiten, einladen, deaktivieren, anonymisieren.
   Setter und Closer arbeiten in einem eigenen CRM; die Rollen gibt es in der Datenbank noch, hier werden sie nicht angeboten. */
(() => {
  const { h } = CRM;
  const ROLE = { recruiter: 'Recruiter', admin: 'Admin' };
  let roleFilter = 'recruiter';

  // Admins anlegen und ändern darf nur der Inhaber (die Datenbank erzwingt das, siehe 000500_owner.sql).
  const canEdit = (p) => CRM.owner || (p.role !== 'admin' && !p.is_owner) || p.id === CRM.me;

  const editor = (p, panel) => {
    const roles = Object.entries(ROLE).filter(([k]) => k !== 'admin' || CRM.owner || p.role === 'admin');
    const role = CRM.select(roles, p.role || roleFilter || 'recruiter');
    role.disabled = p.role === 'admin' && !CRM.owner;
    const name = CRM.input({ value: p.full_name || '', autocomplete: 'off' });
    const email = CRM.input({ type: 'email', value: p.email || '', autocomplete: 'off' });
    const phone = CRM.input({ type: 'tel', value: p.phone || '', autocomplete: 'off' });
    const iban = CRM.input({ value: p.iban || '', autocomplete: 'off' });
    const ref = CRM.input({ value: p.ref_code || '', placeholder: 'wird automatisch erzeugt' });
    const note = h('textarea', { value: p.note || '' });
    const refField = CRM.field('Link-Code', ref, 'Steckt im persönlichen Link. Nur Kleinbuchstaben, Zahlen und Bindestrich.');
    const sync = () => { refField.hidden = role.value !== 'recruiter'; };
    role.addEventListener('change', sync); sync();
    const b = h('button', { class: 'btn', type: 'submit' }, p.id ? 'Speichern' : 'Person anlegen');
    const f = h('form', { class: 'stack', novalidate: true },
      h('div', 'grid2', CRM.field('Name', name), CRM.field('Rolle', role), CRM.field('E-Mail', email, 'Nötig, damit die Person sich anmelden kann'), CRM.field('Telefon', phone), CRM.field('IBAN', iban, 'Für Auszahlungen'), refField),
      CRM.field('Notiz', note),
      h('div', 'row', b, h('button', { type: 'button', class: 'btn btn--soft', on: { click: () => panel.replaceChildren() } }, 'Abbrechen')));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      CRM.run(b, async () => {
        if (!name.value.trim()) throw new Error('Bitte einen Namen angeben.');
        const body = { role: role.value, full_name: name.value.trim(), email: email.value.trim() || null, phone: phone.value.trim() || null,
          iban: iban.value.replace(/\s+/g, '').toUpperCase() || null, ref_code: role.value === 'recruiter' ? ref.value.trim() || null : null, note: note.value.trim() || null };
        if (p.id) await CRM.patch('profiles', p.id, body); else await CRM.insert('profiles', body);
        CRM.clearCache(); CRM.refresh();
      }, 'Gespeichert ✓');
    });
    return f;
  };

  const actions = (p) => {
    const out = [];
    if (p.role === 'recruiter' && p.ref_code) {
      out.push(CRM.btn('Persönlichen Link kopieren', () => CRM.copy(CRM.trackLink(p.ref_code)), 'ghost sm', 'link'),
        CRM.btn(`Text für Anzeigen: [ref:${p.ref_code}]`, () => CRM.copy(`[ref:${p.ref_code}]`), 'soft sm'));
    }
    if (!p.auth_user_id && p.email && ['admin', 'recruiter'].includes(p.role) && p.active) {
      out.push(CRM.btn('Zugang per E-Mail schicken', (e) => CRM.run(e.currentTarget, () => CRM.fn('admin-invite', { profile_id: p.id }), `Einladung an ${p.email} ist unterwegs ✓`), 'sm', 'mail'));
    }
    if (p.id !== CRM.me && canEdit(p)) {
      out.push(CRM.btn(p.active ? 'Deaktivieren' : 'Wieder aktivieren', async (e) => {
        const btn = e.currentTarget;
        if (p.active && !await CRM.confirm(`${p.full_name} deaktivieren?`, 'Die Person kann sich nicht mehr anmelden und bekommt keine neuen Leads. Ihre bisherigen Leads bleiben bei ihr.', 'Deaktivieren', true)) return;
        CRM.run(btn, async () => { await CRM.patch('profiles', p.id, { active: !p.active }); CRM.clearCache(); CRM.refresh(); }, 'Gespeichert ✓');
      }, 'soft sm'), h('button', { type: 'button', class: 'link link--danger', on: { click: async () => {
        const r = await CRM.ask({ title: 'Personendaten löschen?', text: `Name, Kontaktdaten und IBAN von ${p.full_name} werden endgültig entfernt (DSGVO). Buchungen bleiben anonym. Den Login danach in Supabase löschen.`,
          ok: 'Endgültig löschen', danger: true, fields: [{ name: 'reason', label: 'Grund', required: true, placeholder: 'z. B. Löschanfrage per E-Mail vom …' }] });
        if (r) CRM.run(null, async () => { await CRM.rpc('erase_profile', { p_profile_id: p.id, p_reason: r.reason }); CRM.clearCache(); CRM.refresh(); }, 'Gelöscht.');
      } } }, 'Personendaten löschen'));
    }
    return out;
  };

  CRM.page({
    id: 'team', title: 'Team', group: 'Verwaltung', icon: 'team', roles: ['admin'],
    async render(v, editId) {
      const rows = await CRM.api(`profiles?select=*,leads:leads!leads_recruiter_id_fkey(count)&order=active.desc,full_name${roleFilter ? `&role=eq.${roleFilter}` : ''}`);
      const panel = h('div');
      const open = (p) => {
        const locked = !canEdit(p);
        const acts = p.id ? actions(p) : [];
        panel.replaceChildren(h('section', 'card stack', { style: 'margin-bottom:16px' },
          h('div', 'spread', h('h2', null, p.id ? p.full_name : 'Neue Person'), p.id ? CRM.chip(p.auth_user_id ? 'kann sich anmelden' : 'noch kein Zugang', p.auth_user_id ? 'ok' : 'off') : null),
          locked ? h('div', 'stack', CRM.note('info', h('span', null, 'Admins verwaltet nur der Inhaber. Bei Änderungen bitte an ihn wenden.')),
            CRM.facts([['Rolle', p.is_owner ? 'Inhaber' : ROLE[p.role]], ['E-Mail', p.email || '–'], ['Telefon', p.phone || '–']]),
            h('div', null, h('button', { type: 'button', class: 'btn btn--soft', on: { click: () => panel.replaceChildren() } }, 'Schließen')))
            : editor(p, panel),
          acts.length ? h('div', 'row', { style: 'padding-top:14px;border-top:1px solid var(--line-2)' }, acts) : null));
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      v.append(CRM.head('Team', 'Alle, die mit dem CRM arbeiten. Recruiter bekommen einen persönlichen Link und einen Zugang. Admins verwalten alles.',
        CRM.btn('Person anlegen', () => open({}), '', 'plus')),
        CRM.pills([['recruiter', 'Recruiter'], ['admin', 'Admins']], roleFilter, (k) => { roleFilter = k; CRM.refresh(); }),
        panel,
        CRM.table([
          { t: 'Name', cls: 'main', v: (p) => h('span', null, p.full_name, h('small', null, [p.is_owner ? 'Inhaber' : ROLE[p.role], p.active ? null : 'deaktiviert'].filter(Boolean).join(' · '))) },
          { t: 'E-Mail', v: (p) => p.email || '–' },
          { t: 'Telefon', cls: 'hide-m', v: (p) => p.phone || '–' },
          { t: 'Zugang', v: (p) => (p.auth_user_id ? CRM.chip('ja', 'ok') : CRM.chip('nein', 'off')) },
          roleFilter === 'recruiter' || !roleFilter ? { t: 'Leads', cls: 'num', v: (p) => String(p.leads?.[0]?.count ?? 0) } : null,
        ].filter(Boolean), rows, { onRow: open, empty: 'Noch niemand in dieser Gruppe.' }));
      if (editId) { const p = rows.find((x) => x.id === editId) || (await CRM.api(`profiles?id=eq.${editId}&select=*`))[0]; if (p) open(p); }
    },
  });
})();
