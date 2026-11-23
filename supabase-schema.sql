-- 班匠 ShiftCraft AI — 雲端多店即時同步 + 試用與正式訂閱帳號資料庫腳本
-- 請在 Supabase 專案左側點選「SQL Editor」→「New query」→ 全選貼上並按「Run」即可完成！

-- 1. 多門市資料同步表
create table if not exists public.shiftcraft_stores (
  brand_id text not null,
  store_id text not null,
  store_name text not null,
  city text default '',
  payload jsonb not null default '{}'::jsonb,
  updated_by text default '',
  updated_at timestamptz not null default now(),
  primary key (brand_id, store_id)
);

grant usage on schema public to anon, authenticated;
grant all on table public.shiftcraft_stores to anon, authenticated;
alter table public.shiftcraft_stores enable row level security;

drop policy if exists "shiftcraft_allow_all" on public.shiftcraft_stores;
create policy "shiftcraft_allow_all"
  on public.shiftcraft_stores
  for all
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shiftcraft_stores'
  ) then
    alter publication supabase_realtime add table public.shiftcraft_stores;
  end if;
end $$;

-- 2. 餐廳品牌帳號、14 天免費試用與付費方案管理表
create table if not exists public.shiftcraft_accounts (
  email text primary key,
  password_hash text not null,
  brand_id text not null unique,
  company_name text not null,
  plan_code text not null default 'PRO',          -- STARTER (基本) | PRO (進階) | ENTERPRISE (頂級)
  sub_status text not null default 'TRIAL',       -- TRIAL (試用中) | ACTIVE (正式付費) | SUSPENDED (停權)
  billing_cycle text not null default 'MONTHLY',  -- MONTHLY (月繳) | YEARLY (年繳)
  max_stores integer not null default 1,          -- 訂閱門市數上限
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  paid_until timestamptz,                         -- 正式付費到期日（例如 2026-12-31T23:59:59+08:00）
  note text default '',                           -- 管理者備註（例：藍新已入帳 NT$1,290）
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

grant all on table public.shiftcraft_accounts to anon, authenticated;
alter table public.shiftcraft_accounts enable row level security;

drop policy if exists "shiftcraft_accounts_allow_all" on public.shiftcraft_accounts;
create policy "shiftcraft_accounts_allow_all"
  on public.shiftcraft_accounts
  for all
  using (true)
  with check (true);
