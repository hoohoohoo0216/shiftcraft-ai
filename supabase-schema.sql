-- 班匠 ShiftCraft AI — 雲端多店即時同步資料庫建立腳本
-- 請在 Supabase 專案左側點選「SQL Editor」→「New query」→ 全選貼上並按「Run」即可完成！

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

-- 啟用資料列安全策略並允許前端 App 讀寫同步
alter table public.shiftcraft_stores enable row level security;

drop policy if exists "shiftcraft_allow_all" on public.shiftcraft_stores;
create policy "shiftcraft_allow_all"
  on public.shiftcraft_stores
  for all
  using (true)
  with check (true);

-- 開啟雲端即時推播（讓手機 LINE 打卡與電腦後台 1 秒同步）
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
