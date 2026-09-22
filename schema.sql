create table if not exists public.records (
  id text primary key,
  date date not null,
  category text not null,
  english text not null,
  how text not null,
  memo text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  english text not null,
  ko text not null,
  category text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_analysis (
  week_start date primary key,
  week_label text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.records enable row level security;
alter table public.notes enable row level security;
alter table public.weekly_analysis enable row level security;

create policy "public read records" on public.records for select to anon using (true);
create policy "public insert records" on public.records for insert to anon with check (true);
create policy "public delete records" on public.records for delete to anon using (true);

create policy "public read notes" on public.notes for select to anon using (true);
create policy "public insert notes" on public.notes for insert to anon with check (true);
create policy "public delete notes" on public.notes for delete to anon using (true);

create policy "public read weekly analysis" on public.weekly_analysis for select to anon using (true);
create policy "public insert weekly analysis" on public.weekly_analysis for insert to anon with check (true);
