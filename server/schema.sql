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
  ('plus', 'Plus', 1600000, 16384, 4, 1),
  ('pro',  'Pro',  6000000, 16384, 6, 2),
  ('max',  'Max',  12000000, 16384, 8, 3)
on conflict (id) do nothing;

-- ราคา 30 วัน (บาท) ใช้คิดเครดิตเงินที่เหลือตอนอัปเกรด PromptPay กลางทาง (ราคาที่เก็บจริงอยู่ที่ Stripe/DT_PASS_*_THB ให้ตรงกัน)
alter table public.dt_plans add column if not exists pass_thb numeric;
update public.dt_plans set pass_thb = case id when 'free' then 0 when 'plus' then 59 when 'pro' then 179 when 'max' then 299 end
  where pass_thb is null and id in ('free', 'plus', 'pro', 'max');

-- สิทธิ์ของแอพตามแพ็กเกจ (ส่งให้แอพทาง /api/me) null = ไม่จำกัด
-- คีย์: byokChaptersPerDay, maxBooks, batchMax, assistantPerDay, autoBible, epub, bgm, bestMode
-- ตั้งค่าเริ่มต้นเฉพาะแถวที่ยังว่าง แก้ตัวเลขเองภายหลังได้ (รันไฟล์นี้ซ้ำไม่ทับค่าที่แก้ไว้)
alter table public.dt_plans add column if not exists features jsonb not null default '{}'::jsonb;
update public.dt_plans set features = '{"byokChaptersPerDay": 20, "maxBooks": 10, "batchMax": 10, "assistantPerDay": 30, "autoBible": true, "epub": true, "bgm": true, "bestMode": false}'::jsonb
  where id = 'free' and features = '{}'::jsonb;
update public.dt_plans set features = '{"byokChaptersPerDay": 40, "maxBooks": null, "batchMax": 30, "assistantPerDay": null, "autoBible": true, "epub": true, "bgm": true, "bestMode": true}'::jsonb
  where id = 'plus' and features = '{}'::jsonb;
update public.dt_plans set features = '{"byokChaptersPerDay": null, "maxBooks": null, "batchMax": 100, "assistantPerDay": null, "autoBible": true, "epub": true, "bgm": true, "bestMode": true}'::jsonb
  where id in ('pro', 'max') and features = '{}'::jsonb;
-- ซิงก์หลายเครื่อง + สำรองบนคลาวด์ (เพิ่มเฉพาะคีย์ที่ยังไม่มี ไม่ทับค่าที่แก้ไว้) cloudStorageMB = พื้นที่หลังบีบอัด
update public.dt_plans set features = jsonb_build_object('cloudSync', false, 'cloudStorageMB', 0) || features where id = 'free' and not features ? 'cloudSync';
update public.dt_plans set features = jsonb_build_object('cloudSync', true, 'cloudStorageMB', 100) || features where id = 'plus' and not features ? 'cloudSync';
update public.dt_plans set features = jsonb_build_object('cloudSync', true, 'cloudStorageMB', 300) || features where id = 'pro' and not features ? 'cloudSync';
update public.dt_plans set features = jsonb_build_object('cloudSync', true, 'cloudStorageMB', 600) || features where id = 'max' and not features ? 'cloudSync';

-- ---------- ผู้ใช้ ----------
create table if not exists public.dt_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' references public.dt_plans (id),
  bonus_tokens bigint not null default 0,  -- โควตาเพิ่มพิเศษของเดือนนี้ (เช่น ซื้อเพิ่ม)
  created_at timestamptz not null default now()
);

-- ---------- การชำระเงิน (Stripe) ----------
-- plan ในตาราง profiles = แพ็กเกจที่ผู้ดูแลตั้งเอง (ค่าเริ่มต้น free)
-- sub_* = สมัครรายเดือนด้วยบัตร, pass_* = ซื้อ 30 วันด้วย PromptPay
-- แพ็กเกจที่ใช้จริง = ระดับสูงสุดในสามทางนี้ (dt_effective_plan)
alter table public.dt_profiles add column if not exists stripe_customer_id text;
alter table public.dt_profiles add column if not exists sub_id text;
alter table public.dt_profiles add column if not exists sub_status text;
alter table public.dt_profiles add column if not exists sub_plan text;
alter table public.dt_profiles add column if not exists sub_period_end timestamptz;
alter table public.dt_profiles add column if not exists sub_cancel_at_period_end boolean not null default false;
alter table public.dt_profiles add column if not exists pass_plan text;
alter table public.dt_profiles add column if not exists pass_expires_at timestamptz;
create unique index if not exists dt_profiles_customer on public.dt_profiles (stripe_customer_id) where stripe_customer_id is not null;

-- ประวัติการซื้อ 30 วัน (ref = Checkout Session id กันให้สิทธิ์ซ้ำเมื่อ Stripe ส่ง webhook ซ้ำ)
create table if not exists public.dt_billing_passes (
  ref text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null,
  days integer not null,
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
alter table public.dt_billing_passes enable row level security;
drop policy if exists "own passes" on public.dt_billing_passes;
create policy "own passes" on public.dt_billing_passes for select to authenticated using (user_id = auth.uid());

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

-- ---------- แพ็กเกจที่ใช้จริง ----------
-- สมัครรายเดือน: นับสถานะ active/trialing/past_due และให้เวลาเผื่อ 3 วันหลังสิ้นรอบ (ระหว่างรอตัดบัตรรอบใหม่)
create or replace function public.dt_effective_plan(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.plan from (
      select pr.plan from public.dt_profiles pr where pr.user_id = p_user
      union all
      select pr.sub_plan from public.dt_profiles pr
        where pr.user_id = p_user and pr.sub_plan is not null
          and pr.sub_status in ('active', 'trialing', 'past_due')
          and pr.sub_period_end + interval '3 days' > now()
      union all
      select pr.pass_plan from public.dt_profiles pr
        where pr.user_id = p_user and pr.pass_plan is not null and pr.pass_expires_at > now()
    ) c join public.dt_plans pl on pl.id = c.plan
    order by pl.sort desc limit 1
  ), 'free');
$$;

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
    from public.dt_profiles pr join public.dt_plans pl on pl.id = public.dt_effective_plan(pr.user_id)
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
    from public.dt_profiles pr join public.dt_plans pl on pl.id = public.dt_effective_plan(pr.user_id) where pr.user_id = v_user;
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
    'features', pl.features,
    'limit', pl.monthly_tokens + pr.bonus_tokens,
    'used', public.dt_used_this_month(p_user),
    'periodStart', date_trunc('month', now()),
    'periodEnd', date_trunc('month', now()) + interval '1 month',
    'billing', jsonb_build_object(
      'source', case
        when pl.id = pr.sub_plan and pr.sub_status in ('active', 'trialing', 'past_due') then 'subscription'
        when pl.id = pr.pass_plan and pr.pass_expires_at > now() then 'pass'
        when pl.id <> 'free' then 'manual'
        else 'free' end,
      'subStatus', pr.sub_status,
      'subPlan', pr.sub_plan,
      'renewsAt', pr.sub_period_end,
      'cancelAtPeriodEnd', pr.sub_cancel_at_period_end,
      'passPlan', case when pr.pass_expires_at > now() then pr.pass_plan end,
      'passExpiresAt', case when pr.pass_expires_at > now() then pr.pass_expires_at end,
      'hasCustomer', pr.stripe_customer_id is not null
    )
  ) into v
  from public.dt_profiles pr join public.dt_plans pl on pl.id = public.dt_effective_plan(pr.user_id) where pr.user_id = p_user;
  return v;
end $$;

-- ---------- ซิงก์หลายเครื่อง / สำรองบนคลาวด์ ----------
-- 1 แถว = 1 รายการในเครื่อง (key เช่น c:<id ตอน>, b:<id เรื่อง>, g:<คำศัพท์>, d:<id เรื่อง>)
-- data = เนื้อหาที่แอพบีบอัดมาแล้ว (เซิร์ฟเวอร์ไม่อ่านเนื้อหา) seq = ลำดับการเปลี่ยนแปลง ใช้ดึงเฉพาะที่ใหม่กว่าที่เครื่องมีแล้ว
create sequence if not exists public.dt_sync_seq;
create table if not exists public.dt_sync (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  seq bigint not null default nextval('public.dt_sync_seq'),
  deleted boolean not null default false,
  data text,
  size integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists dt_sync_user_seq on public.dt_sync (user_id, seq);
alter table public.dt_sync enable row level security;
drop policy if exists "own sync" on public.dt_sync;
create policy "own sync" on public.dt_sync for select to authenticated using (user_id = auth.uid());

-- ส่งรายการขึ้นคลาวด์: ตรวจแพ็กเกจ (features.cloudSync) และพื้นที่ (features.cloudStorageMB) ก่อนเขียน
create or replace function public.dt_sync_push(p_user uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_features jsonb; v_limit bigint; v_used bigint; v_old bigint; v_new bigint; v_seq bigint;
begin
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if jsonb_array_length(p_records) > 500 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  if exists (select 1 from jsonb_to_recordset(p_records) as x(key text, deleted boolean, data text)
             where x.key is null or length(x.key) > 300 or length(coalesce(x.data, '')) > 3000000) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.dt_profiles (user_id) values (p_user) on conflict do nothing;
  perform 1 from public.dt_profiles where user_id = p_user for update;  -- ส่งพร้อมกันหลายแท็บ: เขียนทีละคำขอ
  select features into v_features from public.dt_plans where id = public.dt_effective_plan(p_user);
  if not coalesce((v_features->>'cloudSync')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'plan');
  end if;
  v_limit := coalesce((v_features->>'cloudStorageMB')::bigint, 0) * 1048576;
  select coalesce(sum(size), 0) into v_used from public.dt_sync where user_id = p_user and not deleted;
  select coalesce(sum(s.size), 0) into v_old from public.dt_sync s
    join jsonb_to_recordset(p_records) as x(key text, deleted boolean, data text) on s.key = x.key
    where s.user_id = p_user and not s.deleted;
  select coalesce(sum(case when coalesce(x.deleted, false) then 0 else length(coalesce(x.data, '')) end), 0) into v_new
    from jsonb_to_recordset(p_records) as x(key text, deleted boolean, data text);
  if v_new > v_old and v_used - v_old + v_new > v_limit then
    return jsonb_build_object('ok', false, 'reason', 'storage', 'used', v_used, 'limit', v_limit);
  end if;
  insert into public.dt_sync (user_id, key, deleted, data, size, updated_at)
    select p_user, x.key, coalesce(x.deleted, false),
           case when coalesce(x.deleted, false) then null else x.data end,
           case when coalesce(x.deleted, false) then 0 else length(coalesce(x.data, '')) end, now()
    from jsonb_to_recordset(p_records) as x(key text, deleted boolean, data text)
  on conflict (user_id, key) do update set
    seq = nextval('public.dt_sync_seq'), deleted = excluded.deleted, data = excluded.data, size = excluded.size, updated_at = now();
  select max(seq) into v_seq from public.dt_sync where user_id = p_user;
  return jsonb_build_object('ok', true, 'seq', v_seq, 'used', v_used - v_old + v_new, 'limit', v_limit);
end $$;

-- ดึงรายการที่เปลี่ยนหลัง seq ที่เครื่องมีแล้ว (ดึงได้แม้แพ็กเกจหมดอายุ: ข้อมูลเป็นของผู้ใช้เสมอ)
create or replace function public.dt_sync_pull(p_user uuid, p_since bigint, p_limit integer)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select key, seq, deleted, data, updated_at from public.dt_sync
    where user_id = p_user and seq > coalesce(p_since, 0)
    order by seq limit least(greatest(coalesce(p_limit, 100), 1), 200)
  )
  select jsonb_build_object(
    'records', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'seq', r.seq, 'deleted', r.deleted, 'data', r.data, 'at', r.updated_at) order by r.seq) from r), '[]'::jsonb),
    'next', coalesce((select max(r.seq) from r), coalesce(p_since, 0)),
    'more', (select count(*) from r) >= least(greatest(coalesce(p_limit, 100), 1), 200)
  );
$$;

create or replace function public.dt_sync_status(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'used', coalesce(sum(size) filter (where not deleted), 0),
    'count', count(*) filter (where not deleted),
    'seq', coalesce(max(seq), 0),
    'lastAt', max(updated_at),
    'limit', coalesce((select (pl.features->>'cloudStorageMB')::bigint from public.dt_plans pl where pl.id = public.dt_effective_plan(p_user)), 0) * 1048576,
    'enabled', coalesce((select (pl.features->>'cloudSync')::boolean from public.dt_plans pl where pl.id = public.dt_effective_plan(p_user)), false)
  ) from public.dt_sync where user_id = p_user;
$$;

revoke all on function public.dt_sync_push(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dt_sync_pull(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.dt_sync_status(uuid) from public, anon, authenticated;
grant execute on function public.dt_sync_push(uuid, jsonb) to service_role;
grant execute on function public.dt_sync_pull(uuid, bigint, integer) to service_role;
grant execute on function public.dt_sync_status(uuid) to service_role;

-- ---------- ระบบชำระเงิน (เรียกจากเซิร์ฟเวอร์เท่านั้น) ----------
create or replace function public.dt_billing_profile(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  insert into public.dt_profiles (user_id) values (p_user) on conflict do nothing;
  select jsonb_build_object('customerId', stripe_customer_id, 'subStatus', sub_status, 'subPlan', sub_plan, 'subPeriodEnd', sub_period_end)
    into v from public.dt_profiles where user_id = p_user;
  return v;
end $$;

create or replace function public.dt_billing_set_customer(p_user uuid, p_customer text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.dt_profiles (user_id) values (p_user) on conflict do nothing;
  update public.dt_profiles set stripe_customer_id = p_customer
    where user_id = p_user and (stripe_customer_id is null or stripe_customer_id = p_customer);
  return jsonb_build_object('ok', true);
end $$;

-- บันทึกสถานะการสมัครรายเดือน (หาเจ้าของจาก metadata.user_id หรือ customer id)
create or replace function public.dt_billing_apply_subscription(
  p_user uuid, p_customer text, p_sub text, p_status text, p_plan text, p_period_end timestamptz, p_cancel boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_old_sub text; v_old_status text;
begin
  v_user := p_user;
  if v_user is null and p_customer is not null then
    select user_id into v_user from public.dt_profiles where stripe_customer_id = p_customer;
  end if;
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'unknown user'); end if;
  insert into public.dt_profiles (user_id) values (v_user) on conflict do nothing;
  select sub_id, sub_status into v_old_sub, v_old_status from public.dt_profiles where user_id = v_user for update;
  -- การสมัครเก่าที่ถูกยกเลิก ไม่ทับการสมัครใหม่ที่ยังใช้งานอยู่
  if v_old_sub is not null and v_old_sub <> p_sub and v_old_status in ('active', 'trialing', 'past_due')
     and p_status not in ('active', 'trialing', 'past_due') then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  update public.dt_profiles set
    stripe_customer_id = coalesce(stripe_customer_id, p_customer),
    sub_id = p_sub,
    sub_status = p_status,
    sub_plan = case when p_plan in (select id from public.dt_plans) then p_plan else sub_plan end,
    sub_period_end = p_period_end,
    sub_cancel_at_period_end = coalesce(p_cancel, false)
  where user_id = v_user;
  return jsonb_build_object('ok', true);
end $$;

-- ให้สิทธิ์ซื้อ 30 วัน
-- ระดับเดิม: ต่อจากวันหมดอายุเดิม (ซื้อล่วงหน้าได้ไม่เสียวัน)
-- อัปเกรดระหว่างทาง: เครดิตเงินที่เหลือ (ราคา 30 วันของระดับเดิม x วันที่เหลือ / 30) แปลงเป็นวันของระดับใหม่ แล้วบวก 30 วัน
--   เช่น Pro เหลือ 20 วัน = เครดิต 119 บาท = Max ~12 วัน -> ได้ Max ~42 วัน (ไม่มีราคาใน dt_plans.pass_thb ใช้สัดส่วนโควตาแทน)
-- ระดับต่ำกว่า (เซิร์ฟเวอร์ไม่ให้ซื้อ แต่กันไว้): คงระดับสูงไว้ แล้วต่อวันตามมูลค่าเงินที่จ่าย ไม่ได้วันระดับสูงเต็ม 30 วัน
create or replace function public.dt_billing_grant_pass(p_user uuid, p_plan text, p_days integer, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_cur_plan text; v_cur_exp timestamptz; v_new_plan text;
  v_cur_sort integer; v_new_sort integer; v_cur_value numeric; v_new_value numeric; v_exp timestamptz;
begin
  if p_plan not in (select id from public.dt_plans) or p_days is null or p_days <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.dt_billing_passes (ref, user_id, plan, days) values (p_ref, p_user, p_plan, p_days) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  insert into public.dt_profiles (user_id) values (p_user) on conflict do nothing;
  select pass_plan, pass_expires_at into v_cur_plan, v_cur_exp from public.dt_profiles where user_id = p_user for update;
  v_new_plan := p_plan;
  v_exp := now() + make_interval(days => p_days);
  if v_cur_plan is not null and v_cur_exp > now() then
    if v_cur_plan = p_plan then
      v_exp := v_cur_exp + make_interval(days => p_days);
    else
      -- มูลค่าต่อ 30 วัน: ราคา (บาท) ถ้ามี ไม่มีใช้โควตาแทน
      select sort, coalesce(nullif(pass_thb, 0), monthly_tokens) into v_cur_sort, v_cur_value from public.dt_plans where id = v_cur_plan;
      select sort, coalesce(nullif(pass_thb, 0), monthly_tokens) into v_new_sort, v_new_value from public.dt_plans where id = p_plan;
      -- ราคามีแค่บางแถว: เทียบด้วยโควตาทั้งคู่ (หน่วยเดียวกัน)
      if (select count(*) from public.dt_plans where id in (v_cur_plan, p_plan) and coalesce(pass_thb, 0) > 0) = 1 then
        select monthly_tokens into v_cur_value from public.dt_plans where id = v_cur_plan;
        select monthly_tokens into v_new_value from public.dt_plans where id = p_plan;
      end if;
      if coalesce(v_new_sort, 0) > coalesce(v_cur_sort, 0) then
        v_exp := now() + (v_cur_exp - now()) * (v_cur_value / nullif(v_new_value, 0))::float8 + make_interval(days => p_days);
      else
        v_new_plan := v_cur_plan;
        v_exp := v_cur_exp + make_interval(days => p_days) * (v_new_value / nullif(v_cur_value, 0))::float8;
      end if;
    end if;
  end if;
  update public.dt_profiles set pass_plan = v_new_plan, pass_expires_at = coalesce(v_exp, now() + make_interval(days => p_days))
  where user_id = p_user;
  return jsonb_build_object('ok', true, 'plan', v_new_plan, 'expiresAt', v_exp);
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

revoke all on function public.dt_effective_plan(uuid) from public, anon, authenticated;
revoke all on function public.dt_billing_profile(uuid) from public, anon, authenticated;
revoke all on function public.dt_billing_set_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.dt_billing_apply_subscription(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.dt_billing_grant_pass(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.dt_effective_plan(uuid) to service_role;
grant execute on function public.dt_billing_profile(uuid) to service_role;
grant execute on function public.dt_billing_set_customer(uuid, text) to service_role;
grant execute on function public.dt_billing_apply_subscription(uuid, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.dt_billing_grant_pass(uuid, text, integer, text) to service_role;
