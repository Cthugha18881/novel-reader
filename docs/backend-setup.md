# เปิดบริการแปลของ Dusktale (ผู้ใช้ไม่ต้องใช้ API Key)

ระบบนี้มี 3 ส่วน ทุกส่วนมีแผนฟรีให้เริ่มได้:

| ส่วน | ใช้ทำอะไร | ไฟล์ในโปรเจกต์ |
|---|---|---|
| **OpenRouter** | AI ที่ใช้แปล (GPT-6 Luna) จ่ายด้วยเครดิตของเรา | — |
| **Supabase** | บัญชีผู้ใช้ (เข้าสู่ระบบด้วยอีเมล) + ฐานข้อมูลโควตา | `server/schema.sql` |
| **Vercel** | เซิร์ฟเวอร์กลาง: ตรวจผู้ใช้ ตัดโควตา แล้วส่งต่อไป OpenRouter | `server/` |

ลำดับการทำงาน: แอพ → เซิร์ฟเวอร์บน Vercel (ตรวจ token ของผู้ใช้กับ Supabase, จองโควตา) → OpenRouter → ตอบกลับ → ตัดโควตาตามยอดจริง
เนื้อหาที่แปลไม่ถูกบันทึกที่ไหน เก็บแค่จำนวน token และค่าใช้จ่ายต่อคำขอ

> ⚠️ **ค่าลับ 2 ค่า** (Supabase secret key และ OpenRouter API key) ใส่ที่ Vercel เท่านั้น ห้ามใส่ในไฟล์ของแอพ ห้ามถ่ายภาพหน้าจอที่เห็นค่า
> ถ้าหลุด ให้ยกเลิกคีย์นั้นแล้วสร้างใหม่ทันที

ใช้เวลาประมาณ 30–45 นาที

---

## 1. OpenRouter: คีย์สำหรับเซิร์ฟเวอร์

1. เข้า [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) → **Create Key**
   - ตั้งชื่อ `dusktale-server`
   - **Credit limit**: ใส่วงเงินสูงสุดของคีย์ (เช่น 10 USD) กันค่าใช้จ่ายบานถ้ามีอะไรผิดพลาด
   - ใช้คีย์ใหม่ อย่าใช้คีย์ส่วนตัวที่เคยใช้ทดสอบในแอพ
2. คัดลอกคีย์ (`sk-or-v1-...`) เก็บไว้ ใช้ในข้อ 3
3. หาชื่อโมเดล Luna: เข้า [openrouter.ai/models](https://openrouter.ai/models) ค้นคำว่า `luna` แล้วคัดลอกชื่อเต็ม (รูปแบบ `ผู้ให้บริการ/ชื่อโมเดล`) เก็บไว้ใช้เป็น `DT_MODEL`
4. เติมเครดิตที่ [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) (ประมาณ $0.005 ต่อตอนในโหมดสมดุล $5 แปลได้ ~1,000 ตอน)

## 2. Supabase: บัญชีผู้ใช้และฐานข้อมูล

1. เข้า [supabase.com](https://supabase.com) → **New project**
   - Region: **Southeast Asia (Singapore)** (ใกล้ผู้ใช้ไทยที่สุด)
   - ตั้งรหัสผ่านฐานข้อมูลแล้วเก็บไว้ (ไม่ต้องใส่ในแอพ)
2. **SQL Editor** → **New query** → เปิดไฟล์ [`server/schema.sql`](../server/schema.sql) คัดลอกทั้งไฟล์มาวาง → **Run**
   - ต้องขึ้น `Success. No rows returned` (รันซ้ำได้ ไม่ลบข้อมูล)
   - ตรวจที่ **Table Editor**: มีตาราง `dt_plans` (3 แถว: free / plus / pro), `dt_profiles`, `dt_usage`
3. **Authentication → Sign In / Providers → Email**: เปิด Email ไว้ (ค่าเริ่มต้นเปิดอยู่แล้ว) ปิด "Confirm email" ได้ เพราะการเข้าสู่ระบบด้วยลิงก์/รหัสยืนยันอีเมลให้อยู่แล้ว
4. **Authentication → URL Configuration**
   - **Site URL**: `https://cthugha18881.github.io/novel-reader/`
   - **Redirect URLs** → Add: `https://cthugha18881.github.io/novel-reader/**` และ (ไว้ทดสอบบนเครื่อง) `http://localhost:8765/**`
5. **เทมเพลตอีเมล: ข้ามไปก่อนได้** Supabase ให้แก้เทมเพลตได้หลังตั้ง SMTP ของตัวเองแล้วเท่านั้น (ดู "ก่อนเปิดให้คนอื่นใช้" ด้านล่าง)
   ระหว่างนี้อีเมลเป็นแบบเดิมของ Supabase (มีแค่ลิงก์ "Sign in" ไม่มีรหัส) และ**ส่งได้เฉพาะอีเมลของสมาชิกในองค์กร Supabase** จึงทดสอบได้ด้วยอีเมลของคุณเอง
   แอพซ่อนช่องใส่รหัสไว้ (`emailHasCode: false` ใน `js/hosted-config.js`) จนกว่าจะแก้เทมเพลตแล้ว
   เมื่อตั้ง SMTP แล้ว ไปที่ **Authentication → Emails → Templates → Magic link or OTP** ใส่รหัส 6 หลักในอีเมล (ผู้ใช้ที่ติดตั้งแอพบน iPhone ลิงก์จะเปิดใน Safari แยกจากแอพ ต้องใช้รหัสแทน) แล้วเปลี่ยน `emailHasCode` เป็น `true`
   ```html
   <h2>เข้าสู่ระบบ Dusktale</h2>
   <p>รหัสของคุณ: <b style="font-size:22px; letter-spacing:4px;">{{ .Token }}</b></p>
   <p>หรือกดลิงก์นี้ (เปิดในเบราว์เซอร์ที่ใช้แอพ): <a href="{{ .ConfirmationURL }}">เข้าสู่ระบบ</a></p>
   <p>ถ้าไม่ได้ขอเข้าสู่ระบบ ไม่ต้องทำอะไร</p>
   ```
   ทำแบบเดียวกันที่เทมเพลต **Confirm signup** (ผู้ใช้ใหม่ครั้งแรกได้อีเมลนี้)
6. **Project Settings → API Keys** คัดลอก 2 ค่า:
   - **Publishable key** (`sb_publishable_...` หรือ `anon` แบบเก่า) → ค่าสาธารณะ ใส่ในแอพได้
   - **Secret key** (`sb_secret_...` หรือ `service_role` แบบเก่า) → **ค่าลับ** ใส่ที่ Vercel เท่านั้น
7. **Project Settings → Data API** คัดลอก **Project URL** (`https://xxxx.supabase.co`)

### ก่อนเปิดให้คนอื่นใช้: ตั้ง SMTP ของตัวเอง

ตัวส่งอีเมลของ Supabase ส่งได้เฉพาะสมาชิกในองค์กรและไม่กี่ฉบับต่อชั่วโมง ก่อนชวนผู้ทดสอบคนอื่นต้องตั้งตัวส่งอีเมลของเราเอง

1. ซื้อโดเมน (เช่น `dusktale.app`) ที่ Cloudflare / Namecheap ฯลฯ
2. สมัคร [Resend](https://resend.com) (แผนฟรี 3,000 ฉบับ/เดือน, 100 ฉบับ/วัน) → **Domains → Add domain** → ใส่ DNS record ที่ Resend ให้มา (ที่หน้าจัดการโดเมน) รอสถานะ Verified
3. Resend → **API Keys** → สร้างคีย์ (ค่าลับ)
4. Supabase → **Authentication → Emails → SMTP Settings** → เปิด Custom SMTP:
   Host `smtp.resend.com` · Port `465` · Username `resend` · Password = คีย์ Resend · Sender email เช่น `no-reply@dusktale.app` · Sender name `Dusktale`
5. **Authentication → Rate Limits**: ปรับจำนวนอีเมลต่อชั่วโมงตามต้องการ
6. แก้เทมเพลต **Magic link or OTP** และ **Confirm signup** ด้วยข้อความด้านบน แล้วตั้ง `emailHasCode: true` ใน `js/hosted-config.js`

## 3. Vercel: เซิร์ฟเวอร์

1. เข้า [vercel.com](https://vercel.com) → สมัครด้วยบัญชี GitHub
2. **Add New → Project** → เลือก repo `Cthugha18881/novel-reader` → **Import**
3. ตั้งค่าโปรเจกต์:
   - **Project Name**: เช่น `dusktale-api` (จะได้ URL `https://dusktale-api.vercel.app`)
   - **Root Directory**: กด Edit → เลือก **`server`** (สำคัญ)
   - **Framework Preset**: Other
   - Build/Output: ปล่อยว่าง
4. **Environment Variables** ใส่ทั้งหมดนี้:

   | ชื่อ | ค่า |
   |---|---|
   | `SUPABASE_URL` | Project URL จากข้อ 2.7 |
   | `SUPABASE_ANON_KEY` | Publishable key จากข้อ 2.6 |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key จากข้อ 2.6 (ค่าลับ) |
   | `OPENROUTER_API_KEY` | คีย์จากข้อ 1.2 (ค่าลับ) |
   | `DT_MODEL` | ชื่อโมเดล Luna จากข้อ 1.3 |
   | `DT_REASONING` | `none` (ปิดการคิดก่อนตอบ เร็วและถูกที่สุด) |
   | `DT_ALLOWED_ORIGINS` | `https://cthugha18881.github.io` |

5. **Deploy** รอ 1–2 นาที
6. **Settings → Git → Production Branch**: เปลี่ยนเป็น `codex/complete-app` (branch ที่ใช้อยู่) แล้วกด Redeploy
7. ทดสอบ: เปิด `https://dusktale-api.vercel.app/api/health` ต้องเห็น `"ok": true` และ `"missing": []`
   ถ้า `missing` มีชื่อไหน แปลว่ายังไม่ได้ใส่ค่านั้นในข้อ 4 (ใส่แล้วต้อง Redeploy)

## 4. เปิดบริการในแอพ

แก้ไฟล์ [`js/hosted-config.js`](../js/hosted-config.js) ใส่ 3 ค่าสาธารณะ (หรือส่ง 3 ค่านี้ให้ Claude ใส่และ push ให้):

```js
apiBase: 'https://dusktale-api.vercel.app/api',
supabaseUrl: 'https://xxxx.supabase.co',
supabaseAnonKey: 'sb_publishable_...',
```

commit แล้ว push รอ GitHub Actions ผ่าน (ประมาณ 3 นาที) แล้วเปิดแอพ

## 5. ทดสอบทั้งระบบ

1. เปิดแอพในหน้าต่างไม่ระบุตัวตน (incognito) → หน้าต้อนรับต้องมีปุ่ม **"เข้าสู่ระบบ — แปลได้เลยฟรี"**
2. ใส่อีเมล → ได้อีเมลภายใน 1 นาที → ใส่รหัส 6 หลัก (หรือกดลิงก์)
3. ตั้งค่า → 🤖 AI ต้องเห็น "เข้าสู่ระบบเป็น ..." และแถบโควตา "ใช้ไป 0 จาก 400K token"
4. วางลิงก์นิยาย 1 ตอนแล้วแปล → กลับไปดูแถบโควตา ต้องเพิ่มขึ้น
5. Supabase → Table Editor → `dt_usage` ต้องมีแถวสถานะ `done` พร้อมจำนวน token

## งานดูแลระบบ (SQL Editor)

```sql
-- ใครใช้ไปเท่าไรเดือนนี้ (ไม่มีเนื้อหาที่แปล มีแค่จำนวน)
select u.email, p.plan, public.dt_used_this_month(p.user_id) as used_tokens,
       sum(d.cost_usd) filter (where d.created_at >= date_trunc('month', now())) as cost_usd
from public.dt_profiles p join auth.users u on u.id = p.user_id
left join public.dt_usage d on d.user_id = p.user_id
group by u.email, p.plan, p.user_id order by used_tokens desc;

-- เปลี่ยนแพ็กเกจของผู้ใช้ (ก่อนมีระบบชำระเงินในขั้นที่ 9)
update public.dt_profiles set plan = 'plus'
where user_id = (select id from auth.users where email = 'reader@example.com');

-- ให้โควตาพิเศษเดือนนี้ 200K token
update public.dt_profiles set bonus_tokens = 200000
where user_id = (select id from auth.users where email = 'reader@example.com');

-- ปรับโควตาแพ็กเกจฟรี (มีผลทันทีกับทุกคน)
update public.dt_plans set monthly_tokens = 300000 where id = 'free';
```

ถ้าเปลี่ยนโควตาแพ็กเกจฟรี ให้แก้ `freeMonthlyTokens` ใน `js/hosted-config.js` ด้วย (ใช้แสดงจำนวนตอนในแอพ)

## ปิดบริการชั่วคราว

ลบค่า `apiBase` ใน `js/hosted-config.js` ให้ว่างแล้ว push แอพจะกลับไปเป็นแบบใช้ API Key ของผู้ใช้เองทั้งหมด (ข้อมูลในเครื่องผู้ใช้ไม่หาย)

## ความปลอดภัยที่มีอยู่แล้วในเซิร์ฟเวอร์

- รับคำขอเฉพาะจาก `DT_ALLOWED_ORIGINS` และ localhost
- ทุกคำขอต้องมี token ของผู้ใช้ที่ Supabase ยืนยันแล้ว
- ใช้โมเดลที่ตั้งใน `DT_MODEL` เท่านั้น ผู้ใช้เปลี่ยนโมเดลเองไม่ได้ จำกัด token ขาออก 16,384 ต่อคำขอ
- จองโควตาก่อนเรียก AI แบบ atomic (เปิดหลายแท็บก็ใช้เกินโควตาไม่ได้) จำกัดคำขอพร้อมกันตามแพ็กเกจ
- ฐานข้อมูลเปิด RLS: ผู้ใช้อ่านได้เฉพาะของตัวเอง เขียนได้เฉพาะเซิร์ฟเวอร์ ฟังก์ชันจัดการโควตาเรียกได้เฉพาะ service role
- เครดิต OpenRouter หมด ผู้ใช้จะเห็น "ขัดข้องชั่วคราว" ไม่ใช่ "โควตาหมด" และโควตาไม่ถูกตัด
- ทดสอบอัตโนมัติใน CI: `server/test/core.test.js` (จำลอง Supabase และ OpenRouter)
