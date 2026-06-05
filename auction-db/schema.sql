-- Auction history table. Run this once in Supabase:
-- Dashboard -> SQL Editor -> New query -> paste -> Run.
create table if not exists public.auctions (
  id            bigint primary key,   -- auction listing id (dedup key)
  item_id       integer,
  item_uid      bigint,
  item_name     text,
  item_type     text,
  sub_type      text,
  seller_id     bigint,
  seller_name   text,
  buyer_id      bigint,
  buyer_name    text,
  price         bigint,
  bids          integer,
  sold_at       timestamptz,          -- human-readable sale time
  sold_at_epoch bigint,               -- raw unix seconds (easy range math)
  damage        numeric,
  accuracy      numeric,
  armor         numeric,
  quality       numeric,
  rarity        text,
  bonus_id      integer,              -- primary bonus, denormalised for indexing
  bonus_title   text,
  bonus_value   numeric,
  bonuses       jsonb,                -- full bonus array as returned
  ingested_at   timestamptz default now()
);

create index if not exists auctions_item_bonus_idx on public.auctions (item_id, bonus_id);
create index if not exists auctions_sold_at_idx    on public.auctions (sold_at);
create index if not exists auctions_item_name_idx  on public.auctions (item_name);

-- The hub reads this table directly over PostgREST with the browser-safe
-- publishable key (anon role). Lock anon to read-only: RLS on, one SELECT
-- policy, no insert/update/delete policies (the poller writes with the service
-- key, which bypasses RLS). Sold-auction data is public, so a blanket read is
-- fine. Idempotent — safe to re-run.
alter table public.auctions enable row level security;
drop policy if exists "public read" on public.auctions;
create policy "public read" on public.auctions for select to anon using (true);
