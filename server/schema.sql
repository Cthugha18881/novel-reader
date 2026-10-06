-- ==================== Dusktale: ฐานข้อมูลบัญชีและโควตา (Supabase / PostgreSQL) ====================
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run (รันซ้ำได้ ไม่ลบข้อมูลเดิม)
-- ผู้ใช้อ่านได้เฉพาะข้อมูลของตัวเอง เขียนได้เฉพาะเซิร์ฟเวอร์ (service role) ผ่านฟังก์ชันด้านล่าง

-- ---------- แพ็กเกจ ----------
create table if not exists public.dt_plans (
  id text primary key,
  name text not null,
  monthly_tokens bigint not null,          -- token รวม (ขาเข้า + ขาออก) ต่อเดือน
  max_output_tokens integer not null default 16384,
  max_concurrent integer not null default 4, -- คำขอที่ทำพร้อมกันได้
  sort integer not null default 0
);

-- ราคาและสิทธิ์ของแพ็กเกจเสียเงินจะตั้งในขั้นระบบชำระเงิน (ตอนนี้กำหนดเองได้ที่ตารางนี้)
insert into public.dt_plans (id, name, monthly_tokens, max_output_tokens, max_concurrent, sort) values
  ('free', 'ฟรี', 400000, 16384, 3, 0),
  ('plus', 'Plus', 4000000, 16384, 4, 1),
  ('pro',  'Pro',  12000000, 16384, 6, 2)
on conflict (id) do nothing;

-- ---------- ผู้ใช้ ----------
create table if not exists public.dt_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' references public.dt_plans (id),
  bonus_tokens bigint not null default 0,  -- โควตาเพิ่มพิเศษของเดือนนี้ (เช่น ซื้อเพิ่ม)
  created_at timestamptz not null default now()
);

-- ---------- การใช้งาน (1 แถวต่อ 1 คำขอ ไม่เก็บเนื้อหา) ----------
create table if not exists public.dt_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  reserved_tokens integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6)
);
create index if not exists dt_usage_user_time on public.dt_usage (user_id, created_at desc);

-- ---------- สิทธิ์: เปิด RLS ทุกตาราง ผู้ใช้อ่านได้เฉพาะของตัวเอง ไม่มีสิทธิ์เขียน ----------
alter table public.dt_plans enable row level security;
alter table public.dt_profiles enable row level security;
alter table public.dt_usage enable row level security;

drop policy if exists "plans readable" on public.dt_plans;
create policy "plans readable" on public.dt_plans for select to authenticated using (true);
drop policy if exists "own profile" on public.dt_profiles;
create policy "own profile" on public.dt_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "own usage" on public.dt_usage;
create policy "own usage" on public.dt_usage for select to authenticated using (user_id = auth.uid());

-- ---------- ผู้ใช้ใหม่ได้แพ็กเกจฟรีอัตโนมัติ ----------
create or replace function public.dt_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.dt_profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists dt_on_auth_user_created on auth.users;
create trigger dt_on_auth_user_created after insert on auth.users
  for each row execute function public.dt_handle_new_user();

-- ---------- token ที่ใช้ไปของเดือนนี้ ----------
-- แถวที่จองไว้นานเกิน 15 นาที (เซิร์ฟเวอร์ล้มกลางทาง) ไม่นับ
create or replace function public.dt_used_this_month(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(case
    when status = 'done' then input_tokens + output_tokens
    when status = 'reserved' and created_at > now() - interval '15 minutes' then reserved_tokens
    else 0 end), 0)
  from public.dt_usage
  where user_id = p_user and created_at >= date_trunc('month', now());
$$;

-- ---------- จองโควตาก่อนเรียก AI (atomic ต่อผู้ใช้) ----------
create or replace function public.dt_reserve(p_user uuid, p_tokens integer, p_model text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_monthly bigint;
  v_max_out integer;
  v_max_conc integer;
  v_bonus bigint;
  v_limit bigint;
  v_used bigint;
  v_pending integer;
  v_id bigint;
begin
  insert into public.dt_profiles (user_id) values (p_user) on conflict do nothing;
  -- ล็อกแถวของผู้ใช้: คำขอพร้อมกันหลายแท็บจองทีละคำขอ
  select pl.monthly_tokens, pl.max_output_tokens, pl.max_concurrent, pr.bonus_tokens
    into v_monthly, v_max_out, v_max_conc, v_bonus
    from public.dt_profiles pr join public.dt_plans pl on pl.id = pr.plan
    where pr.user_id = p_user for update of pr;
  v_limit := v_monthly + coalesce(v_bonus, 0);
  v_used := public.dt_used_this_month(p_user);
  select count(*) into v_pending from public.dt_usage
    where user_id = p_user and status = 'reserved' and created_at > now() - interval '3 minutes';
  if v_pending >= v_max_conc then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  if v_used + p_tokens > v_limit then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', v_used, 'limit', v_limit);
  end if;
  insert into public.dt_usage (user_id, model, reserved_tokens, status)
    values (p_user, p_model, greatest(p_tokens, 0), 'reserved') returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'used', v_used, 'limit', v_limit, 'max_output', v_max_out);
end $$;

-- ---------- ปรับเป็นยอดจริงหลังได้ผล ----------
create or replace function public.dt_settle(p_id bigint, p_status text, p_input integer, p_output integer, p_cost numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_limit bigint;
begin
  update public.dt_usage
    set status = case when p_status in ('done', 'failed') then p_status else 'failed' end,
        input_tokens = greatest(coalesce(p_input, 0), 0),
        output_tokens = greatest(coalesce(p_output, 0), 0),
        cost_usd = p_cost
    where id = p_id and status = 'reserved'
    returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false); end if;
  select pl.monthly_tokens + pr.bonus_tokens into v_limit
    from public.dt_profiles pr join public.dt_plans pl on pl.id = pr.plan where pr.user_id = v_user;
  return jsonb_build_object('ok', true, 'used', public.dt_used_this_month(v_user), 'limit', v_limit);
end $$;

-- ---------- สรุปสำหรับหน้าตั้งค่าของแอพ ----------
create or replace function public.dt_usage_summary(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  insert into public.dt_profiles (user_id) values (p_user) on conflict do nothing;
  select jsonb_build_object(
    'plan', pl.id,
    'planName', pl.name,
    'limit', pl.monthly_tokens + pr.bonus_tokens,
    'used', public.dt_used_this_month(p_user),
    'periodStart', date_trunc('month', now()),
    'periodEnd', date_trunc('month', now()) + interval '1 month'
  ) into v
  from public.dt_profiles pr join public.dt_plans pl on pl.id = pr.plan where pr.user_id = p_user;
  return v;
end $$;

-- ฟังก์ชันจัดการโควตาเรียกได้เฉพาะเซิร์ฟเวอร์ (service role) ผู้ใช้เรียกตรงไม่ได้
revoke all on function public.dt_reserve(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.dt_settle(bigint, text, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.dt_usage_summary(uuid) from public, anon, authenticated;
revoke all on function public.dt_used_this_month(uuid) from public, anon, authenticated;
grant execute on function public.dt_reserve(uuid, integer, text) to service_role;
grant execute on function public.dt_settle(bigint, text, integer, integer, numeric) to service_role;
grant execute on function public.dt_usage_summary(uuid) to service_role;
grant execute on function public.dt_used_this_month(uuid) to service_role;
