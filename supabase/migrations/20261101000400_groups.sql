-- ============================================================================
-- 004_groups.sql  |  Facebook-Gruppen: manuelle Posts + KI-Antwortentwürfe (nichts wird automatisch gepostet)
-- Voraussetzung: 001_core.sql
-- ============================================================================

create table group_posts (
  id           uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references profiles (id),
  group_name   text not null,
  group_url    text,
  post_text    text,
  posted_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index group_posts_recruiter_idx on group_posts (recruiter_id, posted_at desc);

-- Welcher Post hat den Lead gebracht (über ?post=<id> im Tracking-Link)
alter table leads add column group_post_id uuid references group_posts (id);
create index leads_group_post_idx on leads (group_post_id) where group_post_id is not null;

create table reply_drafts (
  id             uuid primary key default gen_random_uuid(),
  group_post_id  uuid references group_posts (id) on delete set null,
  recruiter_id   uuid not null references profiles (id),
  comment_text   text not null,        -- eingefügter Kommentar (Kontaktdaten werden vor dem KI-Aufruf entfernt)
  ai_draft       text,
  final_text     text,                 -- was der Mensch tatsächlich gepostet hat (optional)
  status         text not null default 'draft' check (status in ('draft', 'used', 'discarded')),
  model          text,
  created_at     timestamptz not null default now()
);
create index reply_drafts_recruiter_idx on reply_drafts (recruiter_id, created_at desc);

alter table group_posts  enable row level security;
alter table reply_drafts enable row level security;
create policy admin_all_group_posts  on group_posts  for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy admin_all_reply_drafts on reply_drafts for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy recruiter_group_posts on group_posts for all to authenticated
  using (recruiter_id = (select current_profile_id())) with check (recruiter_id = (select current_profile_id()));
create policy recruiter_reply_drafts on reply_drafts for all to authenticated
  using (recruiter_id = (select current_profile_id())) with check (recruiter_id = (select current_profile_id()));
revoke all on all tables in schema public from anon;
