/* CRM: Team (Admin, Recruiter, Setter, Closer) anlegen, bearbeiten, einladen, deaktivieren, anonymisieren. */
(() => {
  const { h } = CRM;
  const ROLE = { recruiter: 'Recruiter', setter: 'Setter', closer: 'Closer', admin: 'Admin' };
  let roleFilter = 'recruiter';

  const editor = (p, panel) => {
    const role = CRM.select(Object.entries(ROLE), p.role || roleFilter || 'recruiter');
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
    if (p.id !== CRM.me) {
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
        panel.replaceChildren(h('section', 'card stack', { style: 'margin-bottom:16px' },
          h('div', 'spread', h('h2', null, p.id ? p.full_name : 'Neue Person'), p.id ? CRM.chip(p.auth_user_id ? 'kann sich anmelden' : 'noch kein Zugang', p.auth_user_id ? 'ok' : 'off') : null),
          editor(p, panel), p.id ? h('div', 'row', { style: 'padding-top:14px;border-top:1px solid var(--line-2)' }, actions(p)) : null));
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      v.append(CRM.head('Team', 'Alle Personen im System. Recruiter bekommen einen persönlichen Link und einen Zugang zum CRM. Setter und Closer werden hier nur geführt.',
        CRM.btn('Person anlegen', () => open({}), '', 'plus')),
        CRM.pills([['recruiter', 'Recruiter'], ['setter', 'Setter'], ['closer', 'Closer'], ['admin', 'Admins'], ['', 'Alle']], roleFilter, (k) => { roleFilter = k; CRM.refresh(); }),
        panel,
        CRM.table([
          { t: 'Name', cls: 'main', v: (p) => h('span', null, p.full_name, h('small', null, [ROLE[p.role], p.active ? null : 'deaktiviert'].filter(Boolean).join(' · '))) },
          { t: 'E-Mail', v: (p) => p.email || '–' },
          { t: 'Telefon', cls: 'hide-m', v: (p) => p.phone || '–' },
          { t: 'Zugang', v: (p) => (p.auth_user_id ? CRM.chip('ja', 'ok') : CRM.chip('nein', 'off')) },
          roleFilter === 'recruiter' || !roleFilter ? { t: 'Leads', cls: 'num', v: (p) => String(p.leads?.[0]?.count ?? 0) } : null,
        ].filter(Boolean), rows, { onRow: open, empty: 'Noch niemand in dieser Gruppe.' }));
      if (editId) { const p = rows.find((x) => x.id === editId) || (await CRM.api(`profiles?id=eq.${editId}&select=*`))[0]; if (p) open(p); }
    },
  });
})();
