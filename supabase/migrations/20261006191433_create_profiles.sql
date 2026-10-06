-- One profile per signed-in user. Each user can only see and edit their own row.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text check (char_length(first_name) <= 40),
  last_name text check (char_length(last_name) <= 40),
  avatar_emoji text not null default '🦉' check (char_length(avatar_emoji) between 1 and 16),
  major text check (char_length(major) <= 80),
  bio text check (char_length(bio) <= 280),
  home_name text check (char_length(home_name) <= 100),
  home_admin text check (char_length(home_admin) <= 100),
  home_country text check (char_length(home_country) <= 100),
  home_latitude double precision check (home_latitude between -90 and 90),
  home_longitude double precision check (home_longitude between -180 and 180),
  temperature_unit text not null default 'f' check (temperature_unit in ('f', 'c')),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_coords_together check ((home_latitude is null) = (home_longitude is null))
);

comment on table public.profiles is 'Owl Weather user profiles (one row per auth user).';

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No anonymous access at all; signed-in users get only what the policies allow.
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when someone signs up,
-- using the first name they entered on the sign-up form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name)
  values (new.id, nullif(left(trim(new.raw_user_meta_data ->> 'first_name'), 40), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for accounts that already exist.
insert into public.profiles (id, first_name)
select u.id, nullif(left(trim(u.raw_user_meta_data ->> 'first_name'), 40), '')
from auth.users u
on conflict (id) do nothing;
