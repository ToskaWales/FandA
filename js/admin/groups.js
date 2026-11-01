/* CRM: Facebook-Gruppen. Beiträge erfassen (mit eigenem Link) und KI-Antwortentwürfe zum Kopieren.
   Es wird NICHTS automatisch auf Facebook gepostet (Meta-Bedingungen, Bauplan P1). */
(() => {
  const { h } = CRM;

  const draftView = (d, post) => {
    const none = (d.ai_draft || '').trim() === 'KEINE_ANTWORT';
    const link = post?.recruiter?.ref_code ? CRM.trackLink(post.recruiter.ref_code, { src: 'fbgroup', post: post.id }) : null;
    const text = h('textarea', { value: none ? '' : (d.final_text || d.ai_draft || '').replace('[LINK]', link || '[LINK]'), 'aria-label': 'Antwort-Vorschlag' });
    const set = (status, ok) => (e) => CRM.run(e.currentTarget, async () => { await CRM.patch('reply_drafts', d.id, { status, final_text: status === 'used' ? text.value : null }); CRM.refresh(); }, ok);
    return h('div', 'stack', { style: 'margin-top:12px' },
      none ? CRM.note('info', h('span', null, 'Besser nicht antworten (Beleidigung, Spam oder kein Bezug).')) : null,
      CRM.field('Vorschlag (du kannst ihn ändern)', text),
      h('div', 'row', CRM.btn('Kopieren', () => CRM.copy(text.value), '', 'check'),
        d.status === 'draft' ? CRM.btn('Habe ich gepostet', set('used', 'Gemerkt ✓'), 'ghost sm') : null,
        d.status === 'draft' ? h('button', { type: 'button', class: 'link', on: { click: set('discarded') } }, 'Verwerfen') : null),
      h('p', 'soft', { style: 'font-size:14px' }, 'Wichtig: Nur ein Vorschlag. Lies ihn, pass ihn an und poste ihn selbst in der Gruppe.'));
  };

  const draftBox = (post) => {
    const comment = h('textarea', { placeholder: 'Hier den Kommentar oder die Nachricht der Person einfügen' });
    const out = h('div');
    const b = CRM.btn('Antwort vorschlagen lassen', () => CRM.run(b, async () => {
      if (!comment.value.trim()) throw new Error('Bitte zuerst den Kommentar einfügen.');
      const r = await CRM.fn('draft-reply', { comment_text: comment.value, group_post_id: post?.id || null });
      out.replaceChildren(draftView({ id: r.id, ai_draft: r.draft, status: 'draft' }, post));
    }));
    return h('div', 'stack', CRM.field('Was hat die Person geschrieben?', comment), h('div', null, b), out);
  };

  CRM.page({
    id: 'groups', title: 'FB-Gruppen', group: 'Werbung', icon: 'chat', roles: ['admin', 'recruiter'],
    async render(v) {
      const admin = CRM.role === 'admin';
      const posts = await CRM.api('group_posts?select=*,recruiter:profiles(full_name,ref_code),drafts:reply_drafts(id,status)&order=posted_at.desc&limit=100');
      const gname = CRM.input({ placeholder: 'z. B. Nebenjob Niedersachsen' }), gurl = CRM.input({ type: 'url', placeholder: 'https://facebook.com/groups/…' });
      const gtext = h('textarea', { placeholder: 'Den Text deines Beitrags hier einfügen (hilft der KI bei Antworten)' });
      const rec = admin ? CRM.select([['', 'Recruiter wählen …'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], '') : null;
      const b = h('button', { class: 'btn', type: 'submit' }, 'Beitrag speichern und Link holen');
      const f = h('form', { class: 'stack', novalidate: true },
        h('div', 'grid2', CRM.field('Name der Gruppe', gname), CRM.field('Link zur Gruppe (optional)', gurl)), rec ? CRM.field('Für welchen Recruiter?', rec) : null,
        CRM.field('Text deines Beitrags (optional)', gtext), h('div', null, b));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        CRM.run(b, async () => {
          if (!gname.value.trim()) throw new Error('Bitte den Namen der Gruppe angeben.');
          const rid = admin ? rec.value : CRM.me;
          if (!rid) throw new Error('Bitte einen Recruiter wählen.');
          await CRM.insert('group_posts', { recruiter_id: rid, group_name: gname.value.trim(), group_url: gurl.value.trim() || null, post_text: gtext.value.trim() || null });
          CRM.refresh();
        }, 'Gespeichert ✓ Kopiere jetzt den Link unten in deinen Beitrag.');
      });

      v.append(CRM.head('Facebook-Gruppen', 'So geht’s: 1. Beitrag in der Gruppe selbst posten. 2. Hier speichern und den Link in den Beitrag setzen. 3. Kommentare hier einfügen und dir eine Antwort vorschlagen lassen.'),
        h('details', 'card', { open: !posts.length }, h('summary', null, 'Neuen Beitrag speichern'), f),
        CRM.section('Deine Beiträge'),
        posts.length ? h('div', 'stack', posts.map((p) => {
          const link = p.recruiter?.ref_code ? CRM.trackLink(p.recruiter.ref_code, { src: 'fbgroup', post: p.id }) : null;
          return h('details', 'card',
            h('summary', null, h('span', null, p.group_name, h('small', 'soft', { style: 'display:block;font-weight:500' }, `${CRM.when(p.posted_at)}${admin ? ' · ' + (p.recruiter?.full_name || '') : ''}`))),
            h('div', 'stack',
              link ? h('div', 'copybox', h('div', null, h('strong', null, 'Link für diesen Beitrag'), h('code', null, link)), CRM.btn('Kopieren', () => CRM.copy(link), 'ghost sm')) : null,
              p.post_text ? h('p', 'quote', p.post_text) : null,
              h('h3', null, 'Auf einen Kommentar antworten'), draftBox(p)));
        })) : CRM.empty('Noch keine Beiträge gespeichert.', 'Speichere oben deinen ersten Gruppen-Beitrag.'),
        CRM.section('Antwort ohne Beitrag'), h('section', 'card', draftBox(null)));

      const drafts = await CRM.api('reply_drafts?select=*,post:group_posts(id,group_name,recruiter:profiles(ref_code))&status=eq.draft&order=created_at.desc&limit=20');
      if (drafts.length) {
        v.append(CRM.section('Noch nicht erledigte Vorschläge'), ...drafts.map((d) => h('section', 'card',
          h('p', 'soft', { style: 'font-size:14px' }, `${CRM.when(d.created_at)}${d.post ? ' · ' + d.post.group_name : ''}`), h('p', 'quote', { style: 'margin-top:8px' }, d.comment_text), draftView(d, d.post))));
      }
    },
  });
})();
