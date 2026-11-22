begin;

create table if not exists public.sidequests_offer_call_saves (
    browser_id text primary key check (browser_id ~ '^[0-9a-f]{64}$'),
    uuid uuid not null unique default gen_random_uuid(),
    save jsonb not null
);

alter table public.sidequests_offer_call_saves
    add column if not exists updated_at timestamptz not null default now();

create or replace function public.sidequests_offer_call_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = pg_catalog.now();
    return new;
end;
$$;

drop trigger if exists sidequests_offer_call_set_updated_at on public.sidequests_offer_call_saves;
create trigger sidequests_offer_call_set_updated_at
    before update on public.sidequests_offer_call_saves
    for each row execute function public.sidequests_offer_call_set_updated_at();

alter table public.sidequests_offer_call_saves enable row level security;
revoke all on public.sidequests_offer_call_saves from public, anon, authenticated, service_role;
grant select, insert, update on public.sidequests_offer_call_saves to service_role;

commit;
