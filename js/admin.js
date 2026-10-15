/* Admin-Seite: Anfragen ansehen und als kontaktiert markieren. Läuft komplett gegen Supabase (REST + Auth). */
(() => {
  const FA = window.FA || {};
  const $ = (id) => document.getElementById(id);
  const KEY = 'fa_admin_session';
  let session = null, leads = [], filter = 'neu';

  const configured = FA.SUPABASE_URL && FA.SUPABASE_KEY;
  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; } },
    set(v) { try { v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY); } catch (e) { /* ignorieren */ } },
  };

  const show = (view) => { $('login').hidden = view !== 'login'; $('app').hidden = view !== 'app'; $('user').hidden = view !== 'app'; };

  const auth = async (path, body) => {
    const r = await fetch(`${FA.SUPABASE_URL}/auth/v1/${path}`, { method: 'POST', headers: { apikey: FA.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('auth');
    return r.json();
  };
  const keep = (j) => { session = { access_token: j.access_token, refresh_token: j.refresh_token, email: j.user?.email || session?.email || '' }; store.set(session); };

  const api = async (path, opt = {}, retry = true) => {
    const r = await fetch(`${FA.SUPABASE_URL}/rest/v1/${path}`, {
      ...opt, headers: { apikey: FA.SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(opt.headers || {}) },
    });
    if (r.status === 401 && retry && session.refresh_token) {
      try { keep(await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); return api(path, opt, false); }
      catch (e) { logout(); throw e; }
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.status === 204 ? null : r.json().catch(() => null);
  };

  const logout = () => { session = null; store.set(null); leads = []; show('login'); };

  const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  const card = (l) => {
    const done = l.status === 'kontaktiert';
    const li = el('li', 'lead' + (done ? ' done' : ''));
    const top = el('div', 'lead-top');
    const left = el('div');
    left.append(el('h2', 'lead-name', l.name), el('p', 'lead-meta', `${l.kind === 'setter' ? 'Bewerbung Setter' : 'Anfrage Vermittler'} · ${fmt(l.created_at)}`));
    top.append(left, el('span', 'badge' + (done ? '' : ' new'), done ? 'Kontaktiert' : 'Neu'));
    li.append(top);

    const c = el('div', 'lead-contact');
    const m = el('a', '', l.email); m.href = 'mailto:' + l.email;
    const t = el('a', '', l.phone); t.href = 'tel:' + l.phone.replace(/[^+\d]/g, '');
    c.append(m, t); li.append(c);

    const skip = new Set(['Name', 'Vorname', 'Nachname', 'E-Mail', 'Telefon']);
    const dl = el('dl');
    Object.entries(l.data || {}).forEach(([k, v]) => {
      if (skip.has(k)) return;
      const row = el('div'); row.append(el('dt', '', k), el('dd', '', String(v))); dl.append(row);
    });
    if (dl.children.length) li.append(dl);

    const note = el('textarea'); note.placeholder = 'Notiz (z. B. Rückruf vereinbart)'; note.value = l.note || ''; note.setAttribute('aria-label', 'Notiz');
    const saved = el('span', 'lead-saved');
    note.addEventListener('change', async () => {
      try { await api(`leads?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ note: note.value.trim() || null }) }); l.note = note.value.trim(); saved.textContent = 'Notiz gespeichert'; }
      catch (e) { saved.textContent = 'Speichern fehlgeschlagen'; }
    });
    li.append(note);

    const act = el('div', 'lead-actions');
    const b = el('button', done ? 'btn out' : 'btn', done ? 'Wieder auf „Neu“ setzen' : 'Als kontaktiert markieren'); b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      const patch = done ? { status: 'neu', contacted_at: null, contacted_by: null } : { status: 'kontaktiert', contacted_at: new Date().toISOString(), contacted_by: session.email };
      try { await api(`leads?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }); Object.assign(l, patch); render(); }
      catch (e) { b.disabled = false; saved.textContent = 'Das hat nicht geklappt. Bitte erneut versuchen.'; }
    });
    const del = el('button', 'a-link del', 'Löschen'); del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm(`Eintrag von „${l.name}“ endgültig löschen?`)) return;
      try { await api(`leads?id=eq.${l.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); leads = leads.filter((x) => x.id !== l.id); render(); }
      catch (e) { saved.textContent = 'Löschen fehlgeschlagen'; }
    });
    act.append(b, saved, del);
    if (done && l.contacted_at) act.insertBefore(el('span', 'lead-saved', `am ${fmt(l.contacted_at)}${l.contacted_by ? ' von ' + l.contacted_by : ''}`), saved);
    li.append(act);
    return li;
  };

  const render = () => {
    const n = { neu: 0, kontaktiert: 0 };
    leads.forEach((l) => { n[l.status]++; });
    $('c-neu').textContent = n.neu; $('c-kontaktiert').textContent = n.kontaktiert; $('c-alle').textContent = leads.length;
    const rows = leads.filter((l) => filter === 'alle' || l.status === filter);
    const list = $('list'); list.replaceChildren(...rows.map(card));
    $('state').textContent = rows.length ? '' : (filter === 'neu' ? 'Keine neuen Anfragen.' : 'Keine Einträge.');
  };

  const load = async () => {
    $('state').textContent = 'Lade …';
    try { leads = await api('leads?select=*&order=created_at.desc&limit=500'); render(); }
    catch (e) { $('state').textContent = 'Laden fehlgeschlagen. Ist dein Konto als Admin freigeschaltet?'; }
  };

  document.querySelectorAll('.a-tabs button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    document.querySelectorAll('.a-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    render();
  }));
  $('reload').addEventListener('click', load);
  $('logout').addEventListener('click', logout);

  $('loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginerr'); err.hidden = true;
    try {
      keep(await auth('token?grant_type=password', { email: $('l-email').value.trim(), password: $('l-pass').value }));
      $('l-pass').value = ''; start();
    } catch (x) { err.textContent = 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.'; err.hidden = false; }
  });

  const start = () => { $('who').textContent = session.email; show('app'); load(); };

  if (!configured) { show('login'); $('loginform').hidden = true; $('login').append(el('p', 'a-error', 'Noch nicht eingerichtet: In js/config.js fehlen SUPABASE_URL und SUPABASE_KEY.')); }
  else { session = store.get(); session ? start() : show('login'); }
})();
