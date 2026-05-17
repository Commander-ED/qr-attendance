-- ============================================
--  QR Attendance System — Supabase Schema
--  Run this in Supabase SQL Editor
-- ============================================

-- Sections / Classes
create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

-- Students
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  student_id text,
  section_id uuid references sections(id) on delete cascade,
  created_at timestamptz default now()
);

-- Attendance records
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  section_id uuid references sections(id) on delete cascade,
  date date not null,
  time_in text,
  status text default 'present',
  created_at timestamptz default now(),
  unique(student_id, date)
);

-- Enable Row Level Security (open for now — add auth later)
alter table sections enable row level security;
alter table students enable row level security;
alter table attendance enable row level security;

-- Allow all operations (change this if you add login/auth)
create policy "allow all sections" on sections for all using (true) with check (true);
create policy "allow all students" on students for all using (true) with check (true);
create policy "allow all attendance" on attendance for all using (true) with check (true);
