-- ============================================================================
-- 000500_owner.sql  |  Inhaber: Admin mit Zusatzrecht "Admins verwalten"
-- Der Inhaber (Software-Eigentümer) darf alles. Andere Admins verwalten das Tagesgeschäft (Leads, Recruiter, Setter,
-- Closer, Models, Geld, Anzeigen), dürfen aber keine Admins anlegen, ändern, deaktivieren oder löschen –
-- damit niemand den Inhaber aussperren kann. Ihr eigenes Profil (Name, Telefon, IBAN, Notiz) dürfen sie ändern.
-- Voraussetzung: 001_core.sql
-- ============================================================================

alter table profiles add column is_owner boolean not null default false;
create unique index profiles_one_owner on profiles (is_owner) where is_owner;   -- höchstens ein Inhaber

create function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner and role = 'admin' from profiles where auth_user_id = auth.uid() and active limit 1), false);
$$;
revoke execute on function is_owner() from public, anon;
grant  execute on function is_owner() to authenticated;

-- Gilt für jeden Weg, auch für Funktionen wie erase_profile: maßgeblich ist, wer eingeloggt ist (auth.uid()).
-- Ohne Login (SQL-Editor, service_role, z. B. admin-invite) gibt es keine Einschränkung.
create function profiles_guard_admins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_owner() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.role = 'admin' or old.is_owner then raise exception 'Admins verwaltet nur der Inhaber'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.role = 'admin' or new.is_owner then raise exception 'Admins legt nur der Inhaber an'; end if;
    return new;
  end if;
  if new.is_owner is distinct from old.is_owner then raise exception 'Den Inhaber legt nur der Inhaber fest'; end if;
  if old.role = 'admin' or new.role = 'admin' then
    if old.id = current_profile_id() and new.role = old.role and new.active = old.active
       and new.auth_user_id is not distinct from old.auth_user_id and new.email is not distinct from old.email then
      return new;   -- eigenes Profil: Name, Telefon, IBAN, Notiz
    end if;
    raise exception 'Admins verwaltet nur der Inhaber';
  end if;
  return new;
end $$;
create trigger profiles_05_guard_admins before insert or update or delete on profiles
  for each row execute function profiles_guard_admins();

-- Inhaber: Toska Wales (Software-Eigentümer)
update profiles set is_owner = true where lower(email) = 'toskazapfwales@gmail.com' and role = 'admin';
