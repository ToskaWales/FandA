/* CRM: Facebook-Gruppen. Beiträge erfassen (mit Tracking-Link) und KI-Antwortentwürfe zum Kopieren.
   Es wird NICHTS automatisch auf Facebook gepostet (Meta-Bedingungen, Bauplan P1). */
(() => {
  const { h } = CRM;

  const draftBox = (post) => {
    const comment = h('textarea', { placeholder: 'Kommentar oder Nachricht der Person hier einfügen', 'aria-label': 'Kommentar' });
    const out = h('div');
    const b = h('button', { class: 'btn out sm', type: 'button' }, 'Entwurf erstellen');
    b.addEventListener('click', () => CRM.run(b, async () => {
      if (!comment.value.trim()) throw new Error('Bitte zuerst den Kommentar einfügen.');
      const r = await CRM.fn('draft-reply', { comment_text: comment.value, group_post_id: post?.id || null });
      out.replaceChildren(draftView({ id: r.id, ai_draft: r.draft, status: 'draft' }, post));
    }));
    return h('div', 'a-form', comment, b, out);
  };

  const draftView = (d, post) => {
    const none = (d.ai_draft || '').trim() === 'KEINE_ANTWORT';
    const link = post?.recruiter?.ref_code ? CRM.trackLink(post.recruiter.ref_code, { src: 'fbgroup', post: post.id }) : null;
    const text = h('textarea', { value: none ? '' : (d.final_text || d.ai_draft || '').replace('[LINK]', link || '[LINK]'), 'aria-label': 'Entwurf' });
    const set = (status) => async () => { await CRM.patch('reply_drafts', d.id, { status, final_text: status === 'used' ? text.value : null }); CRM.refresh(); };
    return h('div', 'a-draft',
      none ? h('p', 'a-warn', 'Keine Antwort empfohlen (Beleidigung, Spam oder kein Bezug).') : null,
      text,
      h('div', 'a-actions',
        h('button', { class: 'btn sm', type: 'button', on: { click: () => CRM.copy(text.value) } }, 'Kopieren'),
        d.status === 'draft' ? h('button', { class: 'btn out sm', type: 'button', on: { click: (e) => CRM.run(e.target, set('used'), 'Als verwendet markiert.') } }, 'Verwendet') : null,
        d.status === 'draft' ? h('button', { class: 'a-link', type: 'button', on: { click: (e) => CRM.run(e.target, set('discarded')) } }, 'Verwerfen') : null),
      h('small', 'a-muted', 'Nur Entwurf: selbst prüfen, anpassen und von Hand in der Gruppe posten.'));
  };

  CRM.page({
    id: 'groups', title: 'Gruppen', roles: ['admin', 'recruiter'],
    async render(v) {
      const admin = CRM.role === 'admin';
      const posts = await CRM.api('group_posts?select=*,recruiter:profiles(full_name,ref_code),drafts:reply_drafts(id,status)&order=posted_at.desc&limit=100');
      const gname = CRM.input({ placeholder: 'Name der Gruppe' }), gurl = CRM.input({ type: 'url', placeholder: 'https://facebook.com/groups/…' });
      const gtext = h('textarea', { 'aria-label': 'Text des Beitrags' });
      const rec = admin ? CRM.select([['', 'Recruiter wählen …'], ...(await CRM.recruiters()).map((r) => [r.id, r.full_name])], '') : null;
      const b = h('button', { class: 'btn', type: 'submit' }, 'Beitrag erfassen');
      const f = h('form', { class: 'a-form', novalidate: true },
        h('div', 'a-grid2', CRM.field('Gruppe', gname), CRM.field('Link zur Gruppe (optional)', gurl)), rec ? CRM.field('Für Recruiter', rec) : null,
        CRM.field('Text deines Beitrags', gtext), b);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        CRM.run(b, async () => {
          if (!gname.value.trim()) throw new Error('Bitte den Gruppennamen angeben.');
          const rid = admin ? rec.value : CRM.me;
          if (!rid) throw new Error('Bitte einen Recruiter wählen.');
          await CRM.insert('group_posts', { recruiter_id: rid, group_name: gname.value.trim(), group_url: gurl.value.trim() || null, post_text: gtext.value.trim() || null });
          CRM.refresh();
        }, 'Erfasst. Jetzt den Link unten in den Beitrag setzen.');
      });

      v.append(h('h1', null, 'Facebook-Gruppen'),
        h('p', 'a-muted', 'Du postest selbst. Hier erfasst du den Beitrag, bekommst den passenden Link und lässt dir Antworten vorschlagen.'),
        h('details', 'a-box', h('summary', null, 'Neuen Beitrag erfassen'), f),
        h('h2', null, 'Ohne Beitrag: Antwort entwerfen'), h('section', 'a-box', draftBox(null)),
        h('h2', null, 'Beiträge'),
        posts.length ? h('div', null, posts.map((p) => {
          const link = p.recruiter?.ref_code ? CRM.trackLink(p.recruiter.ref_code, { src: 'fbgroup', post: p.id }) : null;
          return h('details', 'a-box',
            h('summary', null, `${p.group_name} · ${CRM.day(p.posted_at)}${admin ? ' · ' + (p.recruiter?.full_name || '') : ''} · ${p.drafts?.length || 0} Entwürfe`),
            p.post_text ? h('p', 'a-quote', p.post_text) : null,
            link ? h('div', 'a-copy', h('div', null, h('strong', null, 'Link für diesen Beitrag'), h('code', null, link)),
              h('button', { class: 'btn out sm', type: 'button', on: { click: () => CRM.copy(link) } }, 'Kopieren')) : null,
            draftBox(p));
        })) : h('p', 'a-muted', 'Noch keine Beiträge erfasst.'));

      const drafts = await CRM.api('reply_drafts?select=*,post:group_posts(id,group_name,recruiter:profiles(ref_code))&status=eq.draft&order=created_at.desc&limit=20');
      if (drafts.length) {
        v.append(h('h2', null, 'Offene Entwürfe'), ...drafts.map((d) => h('section', 'a-box',
          h('p', 'a-muted', `${CRM.fmt(d.created_at)}${d.post ? ' · ' + d.post.group_name : ''}`), h('p', 'a-quote', d.comment_text), draftView(d, d.post))));
      }
    },
  });
})();
