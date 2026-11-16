-- 빈틈없슈 발표용 공용 신청 데이터베이스
-- Supabase SQL Editor에서 한 번만 실행하세요.

create table if not exists public.sgs_applications (
  id text primary key,
  building text not null,
  activity_date date not null,
  assignment_id text not null default 'all',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building, activity_date, assignment_id)
);

alter table public.sgs_applications enable row level security;

drop policy if exists "sgs demo read" on public.sgs_applications;
create policy "sgs demo read"
on public.sgs_applications for select
to anon
using (true);

drop policy if exists "sgs demo insert" on public.sgs_applications;
create policy "sgs demo insert"
on public.sgs_applications for insert
to anon
with check (true);

drop policy if exists "sgs demo update" on public.sgs_applications;
create policy "sgs demo update"
on public.sgs_applications for update
to anon
using (true)
with check (true);

drop policy if exists "sgs demo delete" on public.sgs_applications;
create policy "sgs demo delete"
on public.sgs_applications for delete
to anon
using (true);

grant select, insert, update, delete on public.sgs_applications to anon;

-- 층별 활동 인증 사진을 저장하는 공개 발표용 버킷
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sgs-photos',
  'sgs-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sgs demo photo read" on storage.objects;
create policy "sgs demo photo read"
on storage.objects for select
to anon
using (bucket_id = 'sgs-photos');

drop policy if exists "sgs demo photo insert" on storage.objects;
create policy "sgs demo photo insert"
on storage.objects for insert
to anon
with check (bucket_id = 'sgs-photos');

drop policy if exists "sgs demo photo update" on storage.objects;
create policy "sgs demo photo update"
on storage.objects for update
to anon
using (bucket_id = 'sgs-photos')
with check (bucket_id = 'sgs-photos');

drop policy if exists "sgs demo photo delete" on storage.objects;
create policy "sgs demo photo delete"
on storage.objects for delete
to anon
using (bucket_id = 'sgs-photos');

-- unique(building, activity_date, assignment_id)가 여러 기기의 동시 중복 신청을 막습니다.
-- 공개 발표용 정책이므로 실제 운영 전에는 학교 로그인 사용자와 관리자 역할에 맞게 제한해야 합니다.
