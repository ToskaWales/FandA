/* CRM: gemeinsame Grundlage. Anmeldung, Aufrufe gegen Supabase (REST, RPC, Edge Functions, Storage), Navigation, kleine Bausteine.
   Seiten registrieren sich mit CRM.page({...}) in js/admin/*.js; die Rechte prüft die Datenbank, die Navigation blendet nur aus. */
(() => {
  const FA = window.FA || {};
  const $ = (id) => document.getElementById(id);
  const KEY = 'fa_admin_session';
  const pages = [];
  let session = null;
  const CRM = window.CRM = { FA, pages, me: null, role: null, money: !!FA.MONEY_ENABLED };

  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; } },
    set(v) { try { v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY); } catch (e) { /* ignorieren */ } },
  };

  // ---------- Supabase ----------
  const auth = async (path, body, method = 'POST', token) => {
    const r = await fetch(`${FA.SUPABASE_URL}/auth/v1/${path}`, {
      method, headers: { apikey: FA.SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || 'auth');
    return j;
  };
  const keep = (j) => { session = { access_token: j.access_token, refresh_token: j.refresh_token, email: j.user?.email || session?.email || '' }; store.set(session); };
  const headers = (extra = {}) => ({ apikey: FA.SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, ...extra });

  const request = async (url, opt = {}, retry = true) => {
    const r = await fetch(url, { ...opt, headers: headers(opt.headers) });
    if (r.status === 401 && retry && session.refresh_token) {
      try { keep(await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); }
      catch (e) { logout(); throw new Error('Sitzung abgelaufen. Bitte neu anmelden.'); }
      return request(url, opt, false);
    }
    if (!r.ok) {
      const t = await r.text();
      let m = t; try { const j = JSON.parse(t); m = j.message || j.error || t; } catch (e) { /* Text */ }
      throw new Error(m || 'HTTP ' + r.status);
    }
    return r;
  };

  // REST: CRM.api('leads?select=*', {method, body}) -> JSON. {count:true} -> Anzahl (ohne Zeilen zu laden).
  CRM.api = async (path, opt = {}) => {
    if (opt.count) {
      const r = await request(`${FA.SUPABASE_URL}/rest/v1/${path}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
      return Number((r.headers.get('content-range') || '').split('/')[1] || 0);
    }
    const r = await request(`${FA.SUPABASE_URL}/rest/v1/${path}`, {
      ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
      body: opt.body && typeof opt.body !== 'string' ? JSON.stringify(opt.body) : opt.body,
    });
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  CRM.rpc = (name, args = {}) => CRM.api(`rpc/${name}`, { method: 'POST', body: args });
  CRM.patch = (table, id, body) => CRM.api(`${table}?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body });
  CRM.insert = async (table, body) => (await CRM.api(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body }))[0];
  CRM.fn = async (name, body) => {
    const r = await request(`${FA.SUPABASE_URL}/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json().catch(() => null);
  };
  CRM.upload = async (bucket, path, file) => {
    await request(`${FA.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    return path;
  };
  CRM.signedUrl = async (bucket, path) => {
    const r = await request(`${FA.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }),
    });
    return `${FA.SUPABASE_URL}/storage/v1${(await r.json()).signedURL}`;
  };

  // ---------- Bausteine ----------
  // h('button', {class: 'btn', on: {click}}, 'Text', kind, ...) – Texte immer als textContent, nie als HTML.
  const h = CRM.h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (typeof props === 'string') e.className = props;
    else if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k in e && k !== 'list') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  CRM.fmt = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  CRM.day = (iso) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  CRM.eur = (n) => n == null ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  CRM.pct = (n) => n == null ? '–' : (Number(n) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %';
  CRM.isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  CRM.name = (l) => [l?.first_name, l?.last_name].filter(Boolean).join(' ') || '(ohne Namen)';

  // Tabelle in eigenem Scroll-Container. cols: [{t: 'Kopf', v: (row) => Text|Knoten, cls}]
  CRM.table = (cols, rows, { empty = 'Keine Einträge.', onRow } = {}) => {
    if (!rows.length) return h('p', 'a-muted', empty);
    const body = rows.map((r) => {
      const tr = h('tr', onRow ? { class: 'click', tabIndex: 0, on: { click: (e) => { if (!e.target.closest('a,button,input,select,textarea,label')) onRow(r); }, keydown: (e) => { if (e.key === 'Enter' && e.target === tr) onRow(r); } } } : null,
        cols.map((c) => h('td', c.cls || null, c.v(r))));
      return tr;
    });
    return h('div', 'a-scroll', h('table', 'a-table', h('thead', null, h('tr', null, cols.map((c) => h('th', c.cls || null, c.t)))), h('tbody', null, body)));
  };

  CRM.field = (label, input, hint) => {
    input.id = input.id || 'f' + Math.random().toString(36).slice(2, 9);
    return h('div', 'field', h('label', { class: 'cap', htmlFor: input.id }, label), input, hint ? h('small', 'a-muted', hint) : null);
  };
  CRM.input = (props = {}) => h('input', { type: 'text', ...props });
  CRM.select = (options, value, props = {}) => h('select', props,
    options.map(([v, t]) => h('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, t)));

  // Meldung oben auf der Seite (Erfolg oder Fehler aus der Datenbank, die Texte sind dort schon deutsch).
  let flashTimer;
  CRM.flash = (text, bad = false) => {
    const f = $('flash'); f.textContent = text; f.className = 'a-flash show' + (bad ? ' bad' : '');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => { f.className = 'a-flash'; }, bad ? 9000 : 3500);
  };
  // Knopf sperren, Aktion ausführen, Fehler melden. Gibt das Ergebnis zurück (oder undefined bei Fehler).
  CRM.run = async (btn, fn, ok) => {
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (ok) CRM.flash(ok); return r; }
    catch (e) { CRM.flash(e.message || String(e), true); }
    finally { if (btn) btn.disabled = false; }
  };
  CRM.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); CRM.flash('Kopiert: ' + text); }
    catch (e) { window.prompt('Zum Kopieren:', text); }
  };
  CRM.csv = (filename, rows) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove();
  };
  CRM.tabs = (items, current, onPick) => h('div', { class: 'a-tabs', role: 'tablist' },
    items.map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === current), on: { click: () => onPick(k) } }, t)));
  CRM.badge = (text, kind = '') => h('span', 'badge ' + kind, text);

  // Gecachte Auswahllisten (nur Admin darf Profile/Creator lesen).
  const cache = {};
  CRM.recruiters = async (fresh) => (!fresh && cache.rec) || (cache.rec = await CRM.api('profiles?select=id,full_name,ref_code&role=eq.recruiter&active=is.true&order=full_name'));
  CRM.creators = async (fresh) => (!fresh && cache.cre) || (cache.cre = await CRM.api('creators?select=id,name,code&active=is.true&order=name'));
  CRM.clearCache = () => { delete cache.rec; delete cache.cre; };

  // Öffentliche Links für Recruiter (Tracking) und Anzeigen-Namensregel.
  CRM.siteBase = () => (location.hostname.endsWith('fasalesconsulting.com') ? 'https://fasalesconsulting.com' : location.origin);
  CRM.trackLink = (ref, extra = {}) => {
    const q = new URLSearchParams({ ref, ...extra });
    return `${CRM.siteBase()}/karriere.html?${q}#apply`;
  };

  // ---------- Navigation ----------
  // CRM.page({id, title, roles: ['admin','recruiter'], money: bool, nav: false, render(view, arg)})
  CRM.page = (p) => pages.push(p);
  const visible = (p) => p.roles.includes(CRM.role) && (!p.money || CRM.money);
  CRM.go = (id, arg) => { location.hash = arg ? `${id}/${arg}` : id; };
  CRM.refresh = () => route();
  const route = async () => {
    const [id, arg] = decodeURIComponent(location.hash.slice(1)).split('/');
    const list = pages.filter(visible);
    const p = list.find((x) => x.id === id) || list[0];
    if (!p) return;
    document.querySelectorAll('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.id === p.id ? 'page' : 'false'));
    const view = $('view');
    view.replaceChildren(h('p', 'a-muted', 'Lade …'));
    document.title = `${typeof p.title === 'function' ? p.title() : p.title} | CRM F&A`;
    try {
      const out = h('div');
      await p.render(out, arg);
      view.replaceChildren(out);
    } catch (e) {
      view.replaceChildren(h('p', 'a-error', 'Laden fehlgeschlagen: ' + (e.message || e)),
        /does not exist|Could not find/i.test(e.message || '') ? h('p', 'a-muted', 'Die nötige Migration ist vermutlich noch nicht eingespielt (siehe README, Abschnitt CRM).') : null);
    }
  };
  window.addEventListener('hashchange', () => { if (CRM.role) route(); });

  // ---------- Anmeldung ----------
  const show = (view) => {
    ['login', 'setpw', 'app'].forEach((v) => { $(v).hidden = v !== view; });
    $('user').hidden = view !== 'app';
  };
  const logout = CRM.logout = () => { session = null; CRM.role = null; CRM.me = null; store.set(null); CRM.clearCache(); show('login'); };

  const start = async () => {
    try {
      [CRM.role, CRM.me] = await Promise.all([CRM.rpc('current_app_role'), CRM.rpc('current_profile_id')]);
    } catch (e) { CRM.role = null; }
    if (!['admin', 'recruiter'].includes(CRM.role)) {
      logout();
      const err = $('loginerr'); err.textContent = 'Angemeldet, aber dein Konto ist im CRM nicht freigeschaltet (kein aktives Admin- oder Recruiter-Profil).'; err.hidden = false;
      return;
    }
    if (!session.email) {   // nach Einladungs-Link kennen wir die E-Mail noch nicht
      try { session.email = (await auth('user', null, 'GET', session.access_token)).email || ''; store.set(session); } catch (e) { /* nur Anzeige */ }
    }
    $('who').textContent = `${session.email} ·${CRM.role === 'admin' ? 'Admin' : 'Recruiter'}`;
    $('nav').replaceChildren(...pages.filter((p) => visible(p) && p.nav !== false).map((p) =>
      h('a', { href: '#' + p.id, 'data-id': p.id }, typeof p.title === 'function' ? p.title() : p.title)));
    show('app');
    route();
  };

  $('loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginerr'); err.hidden = true;
    try {
      keep(await auth('token?grant_type=password', { email: $('l-email').value.trim(), password: $('l-pass').value }));
      $('l-pass').value = ''; start();
    } catch (x) { err.textContent = 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.'; err.hidden = false; }
  });
  $('forgot').addEventListener('click', async () => {
    const err = $('loginerr'); const email = $('l-email').value.trim();
    if (!email) { err.textContent = 'Bitte zuerst deine E-Mail eintragen.'; err.hidden = false; return; }
    try {
      await auth(`recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email });
      err.textContent = 'Falls das Konto existiert, kommt gleich eine E-Mail mit einem Link zum Setzen des Passworts.'; err.hidden = false;
    } catch (x) { err.textContent = 'Das hat nicht geklappt. Bitte später erneut versuchen.'; err.hidden = false; }
  });
  // Nach Einladung (admin-invite) oder "Passwort vergessen" kommt man mit #access_token=...&type=invite|recovery zurück.
  $('setpwform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('setpwerr'); err.hidden = true;
    const pw = $('p-new').value;
    if (pw.length < 10) { err.textContent = 'Bitte mindestens 10 Zeichen.'; err.hidden = false; return; }
    try { await auth('user', { password: pw }, 'PUT', session.access_token); $('p-new').value = ''; start(); }
    catch (x) { err.textContent = 'Passwort konnte nicht gesetzt werden: ' + x.message; err.hidden = false; }
  });
  $('logout').addEventListener('click', logout);

  document.addEventListener('DOMContentLoaded', () => {
    if (!FA.SUPABASE_URL || !FA.SUPABASE_KEY) {
      show('login'); $('loginform').hidden = true;
      $('login').append(h('p', 'a-error', 'Noch nicht eingerichtet: In js/config.js fehlen SUPABASE_URL und SUPABASE_KEY.'));
      return;
    }
    const hp = new URLSearchParams(location.hash.slice(1));
    if (hp.get('access_token')) {
      keep({ access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token'), user: {} });
      history.replaceState(null, '', location.pathname);
      if (['invite', 'recovery', 'signup'].includes(hp.get('type'))) { show('setpw'); return; }
      start(); return;
    }
    if (hp.get('error_description')) {
      history.replaceState(null, '', location.pathname);
      show('login'); const err = $('loginerr'); err.textContent = 'Link ungültig oder abgelaufen: ' + hp.get('error_description'); err.hidden = false;
      return;
    }
    session = store.get();
    session ? start() : show('login');
  });
})();
