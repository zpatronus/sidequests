begin;

create table if not exists public.sidequests_offer_call_saves (
    browser_id text primary key check (browser_id ~ '^[0-9a-f]{64}$'),
    uuid uuid not null unique default gen_random_uuid(),
    save jsonb not null
);

alter table public.sidequests_offer_call_saves enable row level security;
revoke all on public.sidequests_offer_call_saves from public, anon, authenticated, service_role;
grant select, insert, update on public.sidequests_offer_call_saves to service_role;

commit;
