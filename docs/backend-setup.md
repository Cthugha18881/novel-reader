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

### 2.1 เข้าสู่ระบบด้วย Google (ไม่ต้องมีโดเมน/SMTP เหมาะกับทดสอบแบบปิด)

1. [Google Cloud Console](https://console.cloud.google.com/) → สร้างโปรเจกต์ใหม่ (เช่น `Dusktale`)
2. **Google Auth Platform / OAuth consent screen** → Get started
   - App name `Dusktale` · User support email = อีเมลของคุณ · Audience **External** · Contact email = อีเมลของคุณ
   - **Audience → Test users → Add users** ใส่ Gmail ของผู้ทดสอบ (สูงสุด 100 คน) คนที่ไม่อยู่ในรายชื่อเข้าไม่ได้ (ปล่อยสถานะเป็น **Testing** ไม่ต้องกด Publish)
3. **Clients → Create client** → Application type **Web application**
   - Authorized JavaScript origins: `https://cthugha18881.github.io`
   - Authorized redirect URIs: `https://czgskzumevpzpuznouub.supabase.co/auth/v1/callback`
   - สร้างแล้วคัดลอก **Client ID** และ **Client secret** (secret เป็นความลับ ใส่ที่ Supabase เท่านั้น)
4. Supabase → **Authentication → Sign In / Providers → Google** → เปิด → วาง Client ID และ Client secret → Save
5. Supabase → **Authentication → URL Configuration** → Redirect URLs ต้องมี `https://cthugha18881.github.io/novel-reader/` (มีอยู่แล้วจากขั้นที่ 2)
6. แก้ `js/hosted-config.js` เป็น `googleLogin: true` แล้ว push

บัญชีที่เข้าด้วย Google กับอีเมลเดียวกันใช้บัญชีเดียวกัน (Supabase รวมให้อัตโนมัติเมื่ออีเมลยืนยันแล้ว)

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

## 6. รับชำระเงินด้วย Stripe (เริ่มจากโหมดทดสอบ)

ราคา: Plus 59 / Pro 179 / Max 299 บาท ต่อ 30 วัน (แอพอ่านราคาจาก Stripe ผ่าน `/api/billing/prices` แก้ราคาที่ Stripe ที่เดียว) · บัตร = สมัครรายเดือนต่ออายุอัตโนมัติ · PromptPay = ซื้อ 30 วันทีละครั้ง (PromptPay ตัดเงินอัตโนมัติไม่ได้)
ข้อมูลบัตรกรอกที่หน้าของ Stripe เท่านั้น ไม่ผ่านแอพหรือเซิร์ฟเวอร์ของเรา

1. สมัคร [Stripe](https://dashboard.stripe.com/register) เลือกประเทศ **Thailand** (PromptPay ใช้ได้เฉพาะบัญชีไทย) แล้วอยู่ใน **Test mode / Sandbox** (สวิตช์มุมขวาบน) ระหว่างทดสอบ ยังไม่ต้องกรอกข้อมูลธุรกิจหรือบัญชีธนาคาร
2. **Product catalog → Add product** สร้าง 3 รายการ:
   - `Dusktale Plus` → Recurring · Monthly · **59 THB**
   - `Dusktale Pro` → Recurring · Monthly · **179 THB**
   - `Dusktale Max` → Recurring · Monthly · **299 THB**
   เปิดแต่ละรายการ คัดลอก **Price ID** (`price_...`) ไว้
3. **Settings → Payment methods** เปิด **PromptPay** (และ Cards ซึ่งเปิดอยู่แล้ว)
4. **Settings → Billing → Customer portal** กด **Activate test link** / Save: อนุญาตยกเลิกการสมัคร อัปเดตบัตร ดูใบเสร็จ (ถ้าอยากให้เปลี่ยนแพ็กเกจเองได้ ให้เพิ่มทั้ง 3 ราคาในหัวข้อ Subscriptions)
5. **Developers → Webhooks → Add endpoint**
   - URL: `https://novel-reader-server.vercel.app/api/billing/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - กดเข้าไปที่ endpoint ที่สร้าง → **Signing secret** (`whsec_...`) คัดลอกไว้
6. **Developers → API keys** → **Secret key** (`sk_test_...`) **ความลับ ห้ามส่งให้ใคร ห้ามใส่ในแอพ**
7. Vercel → โปรเจกต์ → Settings → Environment Variables (ติ๊ก **Sensitive** สำหรับค่าลับ):

   | Key | ค่า |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_...` (ลับ) |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_...` (ลับ) |
   | `STRIPE_PRICE_PLUS` | `price_...` ของ Plus |
   | `STRIPE_PRICE_PRO` | `price_...` ของ Pro |
   | `STRIPE_PRICE_MAX` | `price_...` ของ Max |
   | `DT_PASS_PLUS_THB` / `DT_PASS_PRO_THB` / `DT_PASS_MAX_THB` | ไม่ต้องใส่ถ้าใช้ 59 / 179 / 299 (ราคา PromptPay 30 วัน) |

   แล้ว **Deployments → Redeploy** · เปิด `/api/health` ต้องเห็น `"billing":{"ok":true,...,"testMode":true}`
8. Supabase → SQL Editor → รัน `server/schema.sql` ทั้งไฟล์อีกครั้ง (เพิ่มคอลัมน์การชำระเงินและฟังก์ชัน `dt_billing_*`)
9. ไม่ต้องแก้แอพ: แอพถาม `/api/billing/prices` เอง เมื่อตั้งครบ ปุ่มสมัครจะขึ้นเอง (แอพจำผลไว้ 6 ชั่วโมง เปิดหน้าแพ็กเกจจะเช็กใหม่)

**ทดสอบ (ไม่มีเงินจริง):** แอพ → ตั้งค่า → 🤖 AI → "แพ็กเกจ / สมัคร"
- บัตร: `4242 4242 4242 4242` วันหมดอายุอนาคตใดก็ได้ CVC 3 หลักใดก็ได้ → กลับมาที่แอพ แพ็กเกจต้องเปลี่ยนภายในไม่กี่วินาที
- PromptPay: หน้าทดสอบของ Stripe มีปุ่มจำลองการจ่ายสำเร็จ
- ยกเลิก: "จัดการการสมัคร / ใบเสร็จ" → Cancel → แพ็กเกจยังใช้ได้จนครบรอบ
- Stripe → Developers → Webhooks → endpoint ต้องเห็นคำขอสถานะ 200

**ก่อนรับเงินจริง:** ยืนยันตัวตน/ธุรกิจและบัญชีธนาคารใน Stripe, สร้าง Product/Price/Webhook ชุดใหม่ใน Live mode แล้วเปลี่ยนค่าใน Vercel เป็นของ Live, ย้ายเซิร์ฟเวอร์จาก Vercel Hobby (ห้ามใช้เชิงพาณิชย์) ไป Vercel Pro หรือ Cloudflare Workers และใส่ชื่อ/ที่ติดต่อผู้ให้บริการจริงในหน้ากฎหมาย

## 7. ซิงก์หลายเครื่อง + สำรองบนคลาวด์ (v3.15.0)

ไม่ต้องตั้งค่าเพิ่มที่ Vercel แค่รัน `server/schema.sql` ทั้งไฟล์อีกครั้ง (เพิ่มตาราง `dt_sync`, ฟังก์ชัน `dt_sync_push/pull/status` และสิทธิ์ `cloudSync` / `cloudStorageMB` ของแต่ละแพ็กเกจ)

- เปิดในแอพ: ตั้งค่า → 💾 ข้อมูล → "ซิงก์อัตโนมัติในเครื่องนี้" (Plus ขึ้นไป) ทำทีละเครื่อง
- ซิงก์: ชั้นหนังสือ (รวมตำแหน่งอ่าน) ตอน คลังศัพท์ ข้อมูลเสริมของเรื่อง (คู่มือเรื่อง บุ๊กมาร์ก ปก แชตผู้ช่วย) · ไม่ซิงก์: API Key ค่าตั้งของเครื่อง ประวัติเวอร์ชัน สถิติ
- ข้อมูลบีบอัด (gzip) ในเบราว์เซอร์ก่อนส่ง เซิร์ฟเวอร์ไม่อ่านเนื้อหา พื้นที่นับหลังบีบอัด: Plus 100MB / Pro 300MB / Max 600MB
- ส่งขึ้นต้องมีแพ็กเกจที่มี `cloudSync` (ฐานข้อมูลตรวจเอง) ดึงลงได้เสมอแม้แพ็กเกจหมดอายุ
- ชนกัน: ฉบับที่แก้ล่าสุดชนะ ตอนที่แพ้เก็บไว้ในประวัติเวอร์ชัน ("ฉบับในเครื่องนี้ ก่อนรับฉบับใหม่กว่าจากอีกเครื่อง")
- **พื้นที่ฐานข้อมูล:** Supabase Free มี 500MB รวมทุกคน พอสำหรับทดสอบ ก่อนเปิดให้คนทั่วไปใช้ซิงก์ต้องอัปเกรดเป็น Supabase Pro (8GB)

```sql
-- ใครใช้พื้นที่ซิงก์เท่าไร
select u.email, count(*) filter (where not s.deleted) as items, pg_size_pretty(sum(s.size)::bigint) as used
from public.dt_sync s join auth.users u on u.id = s.user_id group by u.email order by sum(s.size) desc;

-- ลบข้อมูลซิงก์ของผู้ใช้ (เมื่อขอลบ)
delete from public.dt_sync where user_id = (select id from auth.users where email = 'reader@example.com');
```

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

### สิทธิ์ของแอพตามแพ็กเกจ (v3.14.0)

แอพจำกัดการใช้งานเป็น 5 ระดับ (ค่าตั้งต้นอยู่ใน `js/plans.js` → `PLAN_DEFAULTS` และ `PLAN_HOSTED_TOKENS`):

| | ผู้เยี่ยมชม | สมาชิกฟรี | Plus | Pro | Max |
|---|---|---|---|---|---|
| ราคา / 30 วัน | – | 0 | 59 บาท | 179 บาท | 299 บาท |
| AI ของ Dusktale (`monthly_tokens`) | – | 400K (≈20 ตอน) | 1.6M (≈80) | 6M (≈300) | 12M (≈600) |
| แปลด้วย API Key ของผู้ใช้ | 10 ตอน/วัน | 20 | 40 | ไม่จำกัด | ไม่จำกัด |
| ชั้นหนังสือ | 3 เรื่อง | 10 เรื่อง | ไม่จำกัด | ไม่จำกัด | ไม่จำกัด |
| แปลล่วงหน้าแบบชุด | 5 ตอน/ครั้ง | 10 | 30 | 100 | 100 |
| ผู้ช่วย AI | 10 คำถาม/วัน | 30 | ไม่จำกัด | ไม่จำกัด | ไม่จำกัด |
| คู่มือเรื่อง/บันทึกเหตุการณ์อัตโนมัติ, EPUB, เพลงประกอบ | – | ✓ | ✓ | ✓ | ✓ |
| โหมด "ดีที่สุด" | – | – | ✓ | ✓ | ✓ |

`max_concurrent` (3/4/6/8) เป็นเพดานกันใช้งานผิดปกติ ไม่ใช่ฟีเจอร์ที่ขาย

ฐานข้อมูลที่สร้างก่อน v3.14.0 (รันไฟล์ schema ซ้ำไม่ทับค่าเดิม) ให้รันคำสั่งนี้ครั้งเดียว:

```sql
insert into public.dt_plans (id, name, monthly_tokens, max_output_tokens, max_concurrent, sort)
  values ('max', 'Max', 12000000, 16384, 8, 3) on conflict (id) do nothing;
update public.dt_plans set monthly_tokens = 1600000, features = features || '{"byokChaptersPerDay": 40, "batchMax": 30}'::jsonb where id = 'plus';
update public.dt_plans set monthly_tokens = 6000000 where id = 'pro';
update public.dt_plans set features = features || '{"byokChaptersPerDay": 20}'::jsonb where id = 'free';
update public.dt_plans set features = '{"byokChaptersPerDay": null, "maxBooks": null, "batchMax": 100, "assistantPerDay": null, "autoBible": true, "epub": true, "bgm": true, "bestMode": true}'::jsonb where id = 'max';
```

- ผู้เยี่ยมชม (ไม่เข้าสู่ระบบ) ใช้ค่าในแอพ สมาชิกใช้คอลัมน์ `dt_plans.features` ที่ส่งมาทาง `/api/me` (แอพจำไว้ใช้ออฟไลน์ได้ 7 วัน อัปเดตทุก 6 ชั่วโมง)
- ข้อมูลที่มีอยู่แล้วไม่ถูกล็อกทุกระดับ: อ่าน แก้คำแปล คลังศัพท์ สำรอง/กู้คืน ส่งออก TXT
- ตัวนับรายวันเก็บใน IndexedDB ของผู้ใช้ (ที่เก็บ `meta` คีย์ `plan_day_YYYY-MM-DD`) แปลด้วยบริการ Dusktale ไม่นับ เพราะหักจากโควตา token แทน
- แอพที่ไม่ได้ตั้ง `js/hosted-config.js` ไม่จำกัดอะไรเลย (ไม่มีทางเข้าสู่ระบบ)

อัปเดตฐานข้อมูลเดิม: รัน `server/schema.sql` ทั้งไฟล์อีกครั้ง (เพิ่มคอลัมน์ `features` และใส่ค่าตั้งต้นให้แถวที่ยังว่าง ไม่ทับค่าที่แก้ไว้)

```sql
-- ปรับสิทธิ์ของแพ็กเกจ (มีผลกับสมาชิกภายใน 6 ชั่วโมง หรือทันทีเมื่อกด "รีเฟรชโควตา")
update public.dt_plans set features = features || '{"maxBooks": 15, "assistantPerDay": 40}'::jsonb where id = 'free';

-- ตั้งแพ็กเกจให้บัญชีของผู้ดูแล/ผู้ทดสอบ
update public.dt_profiles set plan = 'pro'
where user_id = (select id from auth.users where email = 'reader@example.com');
```

ถ้าแก้ค่าของผู้เยี่ยมชมหรือค่าที่แสดงในตารางแพ็กเกจ ให้แก้ `PLAN_DEFAULTS` ใน `js/plans.js` ด้วย

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
