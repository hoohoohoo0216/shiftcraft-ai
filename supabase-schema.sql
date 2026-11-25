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

-- 3. LINE 員工跨裝置綁定索引（換手機／清快取點圖文選單免重掃 QR Code）
create table if not exists public.shiftcraft_line_bindings (
  line_user_id text primary key,
  brand_id text not null,
  store_id text not null,
  employee_id text not null,
  employee_name text default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_shiftcraft_line_bindings_brand_store
  on public.shiftcraft_line_bindings (brand_id, store_id);

grant all on table public.shiftcraft_line_bindings to anon, authenticated;
alter table public.shiftcraft_line_bindings enable row level security;

drop policy if exists "shiftcraft_line_bindings_allow_all" on public.shiftcraft_line_bindings;
create policy "shiftcraft_line_bindings_allow_all"
  on public.shiftcraft_line_bindings
  for all
  using (true)
  with check (true);

create or replace function public.liff_lookup_binding(p_line_user_id text)
returns table (
  line_user_id text,
  brand_id text,
  store_id text,
  employee_id text,
  employee_name text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select b.line_user_id, b.brand_id, b.store_id, b.employee_id, b.employee_name, b.updated_at
  from public.shiftcraft_line_bindings b
  where b.line_user_id = p_line_user_id
  limit 1;
$$;

create or replace function public.liff_save_binding(
  p_line_user_id text,
  p_brand_id text,
  p_store_id text,
  p_employee_id text,
  p_employee_name text default ''
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.shiftcraft_line_bindings (line_user_id, brand_id, store_id, employee_id, employee_name, updated_at)
  values (p_line_user_id, p_brand_id, p_store_id, p_employee_id, coalesce(p_employee_name, ''), now())
  on conflict (line_user_id) do update
    set brand_id = excluded.brand_id,
        store_id = excluded.store_id,
        employee_id = excluded.employee_id,
        employee_name = excluded.employee_name,
        updated_at = now();
$$;

create or replace function public.liff_delete_binding(p_line_user_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.shiftcraft_line_bindings
  where line_user_id = p_line_user_id;
$$;

grant execute on function public.liff_lookup_binding(text) to anon, authenticated;
grant execute on function public.liff_save_binding(text, text, text, text, text) to anon, authenticated;
grant execute on function public.liff_delete_binding(text) to anon, authenticated;
