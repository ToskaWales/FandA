/* CRM: Betreuer (Admin, Recruiter, Setter, Closer) anlegen, bearbeiten, einladen, anonymisieren. */
(() => {
  const { h } = CRM;
  const ROLE = { admin: 'Admin', recruiter: 'Recruiter', setter: 'Setter', closer: 'Closer' };
  let roleFilter = 'recruiter';

  const form = (p, done) => {
    const role = CRM.select(Object.entries(ROLE), p.role || roleFilter);
    const name = CRM.input({ value: p.full_name || '', required: true });
    const email = CRM.input({ type: 'email', value: p.email || '' });
    const phone = CRM.input({ type: 'tel', value: p.phone || '' });
    const iban = CRM.input({ value: p.iban || '', autocomplete: 'off' });
    const ref = CRM.input({ value: p.ref_code || '', placeholder: 'leer = automatisch' });
    const note = h('textarea', { value: p.note || '', 'aria-label': 'Notiz' });
    const b = h('button', { class: 'btn', type: 'submit' }, p.id ? 'Speichern' : 'Anlegen');
    const f = h('form', { class: 'a-form', novalidate: true },
      h('div', 'a-grid2', CRM.field('Rolle', role), CRM.field('Name', name), CRM.field('E-Mail', email, 'Nötig für den Login'), CRM.field('Telefon', phone),
        CRM.field('IBAN', iban, 'Für Auszahlungen'), CRM.field('Link-Code', ref, 'Nur Recruiter: a–z, 0–9, - und _, 3–32 Zeichen')),
      CRM.field('Notiz', note), b);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      CRM.run(b, async () => {
        if (!name.value.trim()) throw new Error('Bitte einen Namen angeben.');
        const body = { role: role.value, full_name: name.value.trim(), email: email.value.trim() || null, phone: phone.value.trim() || null,
          iban: iban.value.replace(/\s+/g, '').toUpperCase() || null, ref_code: ref.value.trim() || null, note: note.value.trim() || null };
        if (p.id) await CRM.patch('profiles', p.id, body); else await CRM.insert('profiles', body);
        CRM.clearCache(); done();
      }, 'Gespeichert.');
    });
    return f;
  };

  const actions = (p) => {
    const box = h('div', 'a-actions');
    if (p.role === 'recruiter' && p.ref_code) {
      box.append(h('button', { class: 'btn out sm', type: 'button', on: { click: () => CRM.copy(CRM.trackLink(p.ref_code)) } }, 'Tracking-Link kopieren'),
        h('button', { class: 'btn out sm', type: 'button', on: { click: () => CRM.copy(`[ref:${p.ref_code}]`) } }, 'Anzeigen-Tag kopieren'));
    }
    if (!p.auth_user_id && p.email && ['admin', 'recruiter'].includes(p.role) && p.active) {
      const b = h('button', { class: 'btn out sm', type: 'button' }, 'Zum Login einladen');
      b.addEventListener('click', () => CRM.run(b, () => CRM.fn('admin-invite', { profile_id: p.id }), `Einladung an ${p.email} verschickt.`));
      box.append(b);
    }
    if (p.id !== CRM.me) {
      const t = h('button', { class: 'btn out sm', type: 'button' }, p.active ? 'Deaktivieren' : 'Aktivieren');
      t.addEventListener('click', () => CRM.run(t, async () => {
        if (p.active && !confirm(`${p.full_name} deaktivieren? Login und neue Zuteilungen sind dann gesperrt, bestehende Leads bleiben.`)) return;
        await CRM.patch('profiles', p.id, { active: !p.active }); CRM.clearCache(); CRM.refresh();
      }, 'Gespeichert.'));
      const del = h('button', { class: 'a-link del', type: 'button' }, 'Personendaten löschen (DSGVO)');
      del.addEventListener('click', () => CRM.run(del, async () => {
        const reason = window.prompt('Grund der Löschung (z. B. Löschanfrage per E-Mail vom …):');
        if (!reason) return;
        await CRM.rpc('erase_profile', { p_profile_id: p.id, p_reason: reason }); CRM.clearCache(); CRM.refresh();
      }, 'Anonymisiert. Den Login bitte zusätzlich im Supabase-Dashboard löschen.'));
      box.append(t, del);
    }
    return box;
  };

  CRM.page({
    id: 'team', title: 'Betreuer', roles: ['admin'],
    async render(v, editId) {
      const rows = await CRM.api(`profiles?select=*,leads:leads!leads_recruiter_id_fkey(count)&order=active.desc,full_name${roleFilter ? `&role=eq.${roleFilter}` : ''}`);
      const detail = h('div');
      const open = (p) => {
        detail.replaceChildren(h('section', 'a-box', h('div', 'a-head', h('h2', null, p.id ? p.full_name : 'Neue Person'),
          h('button', { class: 'a-link', type: 'button', on: { click: () => detail.replaceChildren() } }, 'Schließen')),
          form(p, () => CRM.refresh()), p.id ? actions(p) : null));
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      v.append(h('div', 'a-head', h('h1', null, 'Betreuer'), h('button', { class: 'btn out', type: 'button', on: { click: () => open({}) } }, 'Person anlegen')),
        CRM.tabs([['recruiter', 'Recruiter'], ['setter', 'Setter'], ['closer', 'Closer'], ['admin', 'Admins'], ['', 'Alle']], roleFilter, (k) => { roleFilter = k; CRM.refresh(); }),
        detail,
        CRM.table([
          { t: 'Name', v: (p) => h('span', null, p.full_name, p.active ? null : CRM.badge('inaktiv', 'off')) },
          { t: 'Rolle', v: (p) => ROLE[p.role] },
          { t: 'E-Mail', v: (p) => p.email || '–' },
          { t: 'Telefon', v: (p) => p.phone || '–' },
          { t: 'Link-Code', v: (p) => p.ref_code || '–' },
          { t: 'Login', v: (p) => (p.auth_user_id ? 'ja' : 'nein') },
          { t: 'Leads', v: (p) => String(p.leads?.[0]?.count ?? 0), cls: 'num' },
        ], rows, { onRow: open }));
      if (editId) { const p = rows.find((x) => x.id === editId); if (p) open(p); }
    },
  });
})();
