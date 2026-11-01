/* CRM: gemeinsame Grundlage. Anmeldung, Aufrufe gegen Supabase (REST, RPC, Edge Functions, Storage), Navigation, Bausteine.
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
  CRM.count = (path) => CRM.api(path, { count: true }).catch(() => null);
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
  // Auch h('p', 'klasse', {style: …}, …): Klasse als Text plus Eigenschaften.
  const isProps = (x) => x && typeof x === 'object' && !x.nodeType && !Array.isArray(x);
  const h = CRM.h = (tag, props, ...kids) => {
    if (typeof props === 'string' && isProps(kids[0])) props = { class: props, ...kids.shift() };
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

  // Linien-Icons (24er Raster), nur dekorativ.
  const ICONS = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    leads: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6',
    inbox: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1.5 2.5h5L16 13h5',
    plus: 'M12 5v14M5 12h14',
    money: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
    check: 'M20 6L9 17l-5-5',
    payout: 'M4 7h16M4 12h16M4 17h10M17 15l2 2 3-3',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    ads: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
    team: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    handshake: 'M3 12l4-4 5 3 5-3 4 4-9 7zM7 8l5-3 5 3',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
    mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
    menu: 'M4 6h16M4 12h16M4 18h16',
    arrow: 'M15 18l-6-6 6-6',
  };
  CRM.icon = (name) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ICONS.list); s.append(p);
    return s;
  };

  // Zahlen und Zeiten
  CRM.eur = (n) => n == null ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  CRM.pct = (n) => n == null ? '–' : (Number(n) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %';
  CRM.isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  CRM.day = (iso) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  CRM.fmt = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  // "vor 5 Min.", "heute 14:30", "gestern 09:10", "morgen 10:00", "Mo., 03.11.", sonst Datum
  CRM.when = (iso) => {
    if (!iso) return '–';
    const d = new Date(iso), now = new Date(), diff = (now - d) / 60000;
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (diff >= 0 && diff < 1) return 'gerade eben';
    if (diff >= 0 && diff < 60) return `vor ${Math.round(diff)} Min.`;
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day0(d) - day0(now)) / 86400000);
    if (days === 0) return `heute ${time}`;
    if (days === -1) return `gestern ${time}`;
    if (days === 1) return `morgen ${time}`;
    if (Math.abs(days) < 7) return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${time}`;
    return CRM.day(iso);
  };
  CRM.name = (l) => [l?.first_name, l?.last_name].filter(Boolean).join(' ') || '(ohne Namen)';
  CRM.tel = (p) => 'tel:' + String(p || '').replace(/[^+\d]/g, '');

  // Seitenkopf mit Erklärsatz: CRM.head('Titel', 'Was mache ich hier?', ...Knöpfe)
  CRM.head = (title, help, ...actions) => h('div', 'page-head',
    h('div', null, h('h1', null, title), help ? h('p', null, help) : null),
    actions.length ? h('div', 'row', actions) : null);
  CRM.section = (title, ...extra) => h('h2', 'section-t', title, ...extra);
  CRM.empty = (title, text, action) => h('div', 'card empty', h('strong', null, title), text ? h('span', null, text) : null, action ? h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, action) : null);
  CRM.chip = (text, kind = '') => h('span', 'chip' + (kind ? ' chip--' + kind : ''), text);
  CRM.note = (kind, ...kids) => h('div', 'note' + (kind ? ' note--' + kind : ''), ...kids);
  // Kleines ⓘ: erklärt einen Begriff (Klick zeigt die Erklärung unten als Meldung).
  CRM.tip = (text) => h('button', { type: 'button', class: 'tip', title: text, 'aria-label': 'Erklärung: ' + text, on: { click: (e) => { e.stopPropagation(); CRM.flash(text, false, 9000); } } }, 'i');
  CRM.btn = (label, onClick, kind = '', icon) => h('button', { type: 'button', class: 'btn' + (kind ? ' ' + kind.split(' ').map((k) => 'btn--' + k).join(' ') : ''), on: onClick ? { click: onClick } : null }, icon ? CRM.icon(icon) : null, label);

  // Tabelle; am Handy wird jede Zeile eine Karte (Spaltennamen als Beschriftung).
  // cols: [{t: 'Kopf', v: (row) => Text|Knoten, cls: 'main'|'num'|'hide-m'|'bare', tip}]
  CRM.table = (cols, rows, { empty = 'Keine Einträge.', emptyText, onRow } = {}) => {
    if (!rows.length) return CRM.empty(empty, emptyText);
    const body = rows.map((r) => {
      const tr = h('tr', onRow ? { class: 'click', tabIndex: 0, on: {
        click: (e) => { if (!e.target.closest('a,button,input,select,textarea,label,summary')) onRow(r); },
        keydown: (e) => { if (e.key === 'Enter' && e.target === tr) onRow(r); },
      } } : null, cols.map((c) => h('td', { class: c.cls || null, 'data-label': c.t }, c.v(r))));
      return tr;
    });
    return h('div', 'tbl', h('table', null, h('thead', null, h('tr', null, cols.map((c) => h('th', c.cls || null, c.t, c.tip ? CRM.tip(c.tip) : null)))), h('tbody', null, body)));
  };

  CRM.field = (label, input, hint) => {
    input.id = input.id || 'f' + Math.random().toString(36).slice(2, 9);
    return h('div', 'field', h('label', { htmlFor: input.id }, label), input, hint ? h('span', 'hint', hint) : null);
  };
  CRM.input = (props = {}) => h('input', { type: 'text', ...props });
  CRM.select = (options, value, props = {}) => h('select', props,
    options.map(([v, t]) => h('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, t)));
  // Filter-Knöpfe: CRM.pills([[key, 'Text', zahl]], aktuell, onPick)
  CRM.pills = (items, current, onPick) => h('div', { class: 'pills', role: 'group' },
    items.map(([k, t, n]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(k === current), on: { click: () => onPick(k) } }, t, n != null ? h('b', null, String(n)) : null)));
  CRM.tabs = CRM.pills;

  // Meldung unten (Erfolg oder Fehler aus der Datenbank, die Texte sind dort schon deutsch).
  let flashTimer;
  CRM.flash = (text, bad = false, ms) => {
    const f = $('flash'); f.textContent = text; f.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => { f.className = 'toast'; }, ms || (bad ? 9000 : 3500));
  };
  // Knopf sperren, Aktion ausführen, Fehler melden. Gibt das Ergebnis zurück (oder undefined bei Fehler).
  CRM.run = async (btn, fn, ok) => {
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (ok && r !== false) CRM.flash(ok); return r; }
    catch (e) { CRM.flash(e.message || String(e), true); }
    finally { if (btn) btn.disabled = false; }
  };

  // Eigenes Bestätigungsfenster statt confirm()/prompt().
  // CRM.ask({title, text, ok: 'Ja, löschen', danger: true, fields: [{name, label, type, value, required, placeholder, options}]})
  //   -> Promise mit {name: wert} oder null (abgebrochen)
  CRM.ask = ({ title, text, ok = 'OK', cancel = 'Abbrechen', danger = false, fields = [] }) => new Promise((resolve) => {
    const inputs = {};
    const err = h('p', 'msg bad', ''); err.hidden = true;
    const body = fields.map((f) => {
      const el = f.type === 'textarea' ? h('textarea', { value: f.value || '', placeholder: f.placeholder || '' })
        : f.options ? CRM.select(f.options, f.value)
        : CRM.input({ type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '' });
      inputs[f.name] = el;
      return CRM.field(f.label + (f.required ? '' : ' (optional)'), el, f.hint);
    });
    const okBtn = h('button', { type: 'submit', class: 'btn' + (danger ? ' btn--danger' : '') }, ok);
    const cancelBtn = h('button', { type: 'button', class: 'btn btn--soft' }, cancel);
    const form = h('form', { method: 'dialog', novalidate: true }, h('h2', null, title), text ? h('p', 'soft', text) : null, ...body, err, h('div', 'actions', cancelBtn, okBtn));
    const dlg = h('dialog', 'dlg', form);
    let done = false;
    const finish = (v) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); };
    cancelBtn.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const v = inputs[f.name].value.trim();
        if (f.required && !v) { err.textContent = `Bitte „${f.label}“ ausfüllen.`; err.hidden = false; inputs[f.name].focus(); return; }
        out[f.name] = v;
      }
      finish(out);
    });
    document.body.append(dlg);
    dlg.showModal();
    (fields.length ? inputs[fields[0].name] : okBtn).focus();
  });
  CRM.confirm = async (title, text, ok, danger) => (await CRM.ask({ title, text, ok, danger })) !== null;

  CRM.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); CRM.flash('Kopiert ✓'); }
    catch (e) { await CRM.ask({ title: 'Zum Kopieren', text: 'Markieren und kopieren:', fields: [{ name: 'x', label: 'Text', value: text }], ok: 'Fertig', cancel: 'Schließen' }); }
  };
  CRM.csv = (filename, rows) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove();
  };

  // Gecachte Auswahllisten (nur Admin darf Profile/Models lesen).
  const cache = {};
  CRM.recruiters = async (fresh) => (!fresh && cache.rec) || (cache.rec = await CRM.api('profiles?select=id,full_name,ref_code&role=eq.recruiter&active=is.true&order=full_name'));
  CRM.creators = async (fresh) => (!fresh && cache.cre) || (cache.cre = await CRM.api('creators?select=id,name,code&active=is.true&order=name'));
  CRM.clearCache = () => { delete cache.rec; delete cache.cre; };

  // Öffentliche Links für Recruiter (Tracking) und Anzeigen-Namensregel.
  CRM.siteBase = () => (location.hostname.endsWith('fasalesconsulting.com') ? 'https://fasalesconsulting.com' : location.origin);
  CRM.trackLink = (ref, extra = {}) => `${CRM.siteBase()}/karriere.html?${new URLSearchParams({ ref, ...extra })}#apply`;

  // ---------- Navigation ----------
  // CRM.page({id, title, label, group, icon, roles, money, nav: false, tab: Reihenfolge in der Handy-Leiste, badge: async () => Zahl, render(view, arg)})
  CRM.page = (p) => pages.push(p);
  const GROUPS = ['', 'Leads', 'Geld', 'Werbung', 'Verwaltung'];
  const visible = (p) => p.roles.includes(CRM.role) && (!p.money || CRM.money);
  const label = (p) => (typeof p.label === 'function' ? p.label() : p.label) || (typeof p.title === 'function' ? p.title() : p.title);
  CRM.go = (id, arg) => { location.hash = arg ? `${id}/${arg}` : id; };
  CRM.refresh = () => route();

  const app = () => $('app');
  const closeMenu = () => { app().classList.remove('menu-open'); $('scrim').hidden = true; };
  const openMenu = () => { app().classList.add('menu-open'); $('scrim').hidden = false; $('menu-close').focus(); };

  const buildNav = () => {
    const list = pages.filter((p) => visible(p) && p.nav !== false);
    const groups = GROUPS.map((g) => [g, list.filter((p) => (p.group || '') === g)]).filter(([, ps]) => ps.length);
    $('nav').replaceChildren(...groups.map(([g, ps]) => h('div', 'nav-group', g ? h('div', 'nav-group__t', g) : null,
      ps.map((p) => h('a', { class: 'nav-link', href: '#' + p.id, 'data-id': p.id, on: { click: closeMenu } }, CRM.icon(p.icon), h('span', null, label(p)), h('span', { class: 'count', hidden: true }))))));
    const tabs = list.filter((p) => p.tab).sort((a, b) => a.tab - b.tab).slice(0, 4);
    const bar = $('tabbar'); bar.style.setProperty('--n', tabs.length + 1);
    bar.replaceChildren(...tabs.map((p) => h('a', { href: '#' + p.id, 'data-id': p.id }, CRM.icon(p.icon), h('span', null, p.tabLabel || label(p)), h('span', { class: 'dot', hidden: true }))),
      h('button', { type: 'button', on: { click: openMenu } }, CRM.icon('menu'), h('span', null, 'Mehr')));
  };
  // Zähler an den Menüpunkten (z. B. offene Leads). Fehler sind egal: dann eben ohne Zahl.
  const updateBadges = async () => {
    for (const p of pages.filter((x) => visible(x) && x.badge)) {
      const n = await p.badge().catch(() => 0);
      document.querySelectorAll(`[data-id="${p.id}"] .count, [data-id="${p.id}"] .dot`).forEach((b) => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
    }
  };
  CRM.updateBadges = updateBadges;

  let routing = 0;
  const route = async () => {
    const [id, arg] = decodeURIComponent(location.hash.slice(1)).split('/');
    const list = pages.filter(visible);
    const p = list.find((x) => x.id === id) || list[0];
    if (!p) return;
    document.querySelectorAll('dialog.dlg').forEach((d) => d.dispatchEvent(new Event('cancel')));   // offenes Fenster gilt als abgebrochen
    const navId = p.parent || p.id;
    document.querySelectorAll('#nav a, #tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.id === navId ? 'page' : 'false'));
    const view = $('view'), my = ++routing;
    view.replaceChildren(h('p', 'loading', 'Lade …'));
    document.title = `${label(p)} | CRM F&A`;
    try {
      const out = h('div');
      await p.render(out, arg);
      if (my !== routing) return;   // inzwischen weiternavigiert
      view.replaceChildren(out);
    } catch (e) {
      if (my !== routing) return;
      view.replaceChildren(CRM.empty('Das hat nicht geklappt.', 'Laden fehlgeschlagen: ' + (e.message || e) +
        (/does not exist|Could not find/i.test(e.message || '') ? ' (Die nötige Datenbank-Erweiterung ist vermutlich noch nicht eingespielt.)' : ''),
        CRM.btn('Nochmal versuchen', () => route(), 'ghost')));
    }
    window.scrollTo(0, 0);
    updateBadges();
  };
  window.addEventListener('hashchange', () => { if (CRM.role) route(); });

  // ---------- Anmeldung ----------
  const show = (view) => { ['login', 'setpw', 'app'].forEach((v) => { $(v).hidden = v !== view; }); };
  const logout = CRM.logout = () => { session = null; CRM.role = null; CRM.me = null; store.set(null); CRM.clearCache(); closeMenu(); show('login'); };

  const start = async () => {
    try {
      [CRM.role, CRM.me] = await Promise.all([CRM.rpc('current_app_role'), CRM.rpc('current_profile_id')]);
    } catch (e) { CRM.role = null; }
    if (!['admin', 'recruiter'].includes(CRM.role)) {
      logout();
      const err = $('loginerr'); err.textContent = 'Du bist angemeldet, aber dein Konto ist im CRM noch nicht freigeschaltet. Bitte melde dich beim Admin.'; err.hidden = false;
      return;
    }
    CRM.owner = CRM.role === 'admin' && await CRM.rpc('is_owner').catch(() => false) === true;   // nur der Inhaber verwaltet Admins
    if (!session.email) {   // nach Einladungs-Link kennen wir die E-Mail noch nicht
      try { session.email = (await auth('user', null, 'GET', session.access_token)).email || ''; store.set(session); } catch (e) { /* nur Anzeige */ }
    }
    $('who').textContent = `${session.email} · ${CRM.owner ? 'Inhaber' : CRM.role === 'admin' ? 'Admin' : 'Recruiter'}`;
    buildNav();
    show('app');
    route();
  };

  $('loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginerr'); err.hidden = true;
    try {
      keep(await auth('token?grant_type=password', { email: $('l-email').value.trim(), password: $('l-pass').value }));
      $('l-pass').value = ''; start();
    } catch (x) { err.textContent = 'Anmeldung hat nicht geklappt. Bitte E-Mail und Passwort prüfen.'; err.hidden = false; }
  });
  $('forgot').addEventListener('click', async () => {
    const err = $('loginerr'); const email = $('l-email').value.trim();
    err.className = 'msg bad';
    if (!email) { err.textContent = 'Bitte zuerst oben deine E-Mail eintragen.'; err.hidden = false; return; }
    try {
      await auth(`recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email });
      err.className = 'msg'; err.textContent = 'Falls es das Konto gibt, kommt gleich eine E-Mail mit einem Link zum neuen Passwort.'; err.hidden = false;
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
  $('menu-close').addEventListener('click', closeMenu);
  $('scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app().classList.contains('menu-open')) closeMenu(); });

  document.addEventListener('DOMContentLoaded', () => {
    if (!FA.SUPABASE_URL || !FA.SUPABASE_KEY) {
      show('login'); $('loginform').hidden = true;
      $('login').querySelector('.card').append(h('p', 'msg bad', 'Noch nicht eingerichtet: In js/config.js fehlen SUPABASE_URL und SUPABASE_KEY.'));
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
      show('login'); const err = $('loginerr'); err.textContent = 'Der Link ist ungültig oder abgelaufen. Bitte „Passwort vergessen?“ nutzen.'; err.hidden = false;
      return;
    }
    session = store.get();
    session ? start() : show('login');
  });
})();
