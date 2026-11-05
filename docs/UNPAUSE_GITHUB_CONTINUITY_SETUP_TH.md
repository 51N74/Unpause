# คู่มือติดตั้ง GitHub Continuity

รองรับ Go API หลัก (`apps/api-go`) และ React frontend เท่านั้น Node API ทางเลือกยังไม่มี endpoints ชุดนี้ ใช้ public repository หนึ่งแห่งต่อโปรเจกต์และติดตาม default branch ที่เลือกไว้ตอนเชื่อมต่อ

## เริ่มใช้งาน

1. ติดตั้ง dependencies ตาม README เดิม แล้วรัน `npm run build` และ migration ด้วย `npm run db:migrate:deploy` บนฐานข้อมูลที่สำรองแล้ว หาก deployment ใช้ `AUTO_MIGRATE=true` จะทำ migration หมายเลข 2 ตอนเริ่ม API โดยอัตโนมัติ
2. เปิด Resume ของโปรเจกต์ Active กรอก `https://github.com/owner/repo` และเลือก **Connect GitHub repository** ระบบอ่าน stable repository ID และ default branch จาก GitHub public API โดยไม่ใช้ GitHub token ของ Explorer
3. คัดลอก secret ที่แสดงครั้งเดียวไว้ใน GitHub repository → Settings → Secrets and variables → Actions → Secrets ชื่อ `UNPAUSE_SECRET` อย่าใส่ในโค้ด, git, screenshot หรือ return note
4. ในแท็บ Variables เพิ่ม `UNPAUSE_DELIVERY_URL` ตามช่อง Delivery endpoint ของ Unpause ต้องเป็น HTTPS URL ของ API ที่ GitHub runner เข้าถึงได้ ไม่ใช่ localhost และควรเป็นโดเมนที่คุณควบคุม
5. ดาวน์โหลด workflow จากหน้า Resume แล้วเพิ่มเป็น `.github/workflows/unpause.yml` ใน repository ที่เชื่อมต่อ ไฟล์กำหนด branch ให้แล้วและใช้เพียง `contents: read` โดยไม่ checkout หรือรันโค้ดจาก repository
6. Push การเปลี่ยนแปลงไปยัง branch ที่ตั้งไว้ เมื่อ workflow ส่งสำเร็จ หน้า Resume จะแสดง **Receiving updates** พร้อมเวลารับข้อมูล `Awaiting first update` หมายถึงเชื่อม repo แล้วแต่ยังไม่ยืนยันการส่งอัตโนมัติ แม้ API recovery จะดึง commits มาได้แล้วก็ตาม
7. เปิดหน้า Resume ค้างไว้เพื่อเห็นรายการใหม่หลัง polling ประมาณ 20 วินาที การโหลดหน้าไม่เปลี่ยนจุดอ่านแล้ว ต้องกด **Mark updates as reviewed** เอง

Template ต้นฉบับ: [unpause-github.yml](templates/unpause-github.yml) ถ้านำไฟล์นี้ไปใช้ตรง ๆ ให้แทน `__BRANCH_JSON__` ด้วยชื่อ branch ที่เป็น JSON string เช่น `"main"` การดาวน์โหลดจาก UI จะทำให้เรียบร้อย

## กลไกและข้อจำกัด

- Authentication ที่เลือกคือ **Bearer token สุ่ม 256 บิตผ่าน HTTPS** แยกต่อ connection เก็บในฐานข้อมูลเฉพาะ SHA-256 digest และเทียบแบบ constant time ไม่ใช่ GitHub native webhook/HMAC protocol
- URL endpoint ระบุ connection; เซิร์ฟเวอร์หา project จาก connection ที่ตรวจ credential แล้ว ไม่มี `projectId` ใน payload ตรวจ repository ID และ branch ซ้ำด้วย
- เก็บ SHA, message สูงสุด 2,000 อักขระ, author name สูงสุด 200 อักขระ, เวลา commit และเวลา event ไม่เก็บ raw event, patch, email หรือ secret ใช้ SHA สร้าง source link ภายใต้ `https://github.com` และแสดงข้อความผ่าน React
- หนึ่ง delivery มี 1–100 commits และ body ไม่เกิน 256 KiB sender ตัดรายการที่เกินและตั้งธง incomplete จึงอาจต้องกู้ข้อมูลผ่าน API เพิ่ม
- Sender ดึง recent commits จาก SHA ที่ push แล้วส่งเป็นกลุ่ม GitHub workflow run ID เป็น delivery identity เดิมทั้งการ retry และ rerun; unique constraints กัน delivery และ SHA ซ้ำระหว่าง Actions กับ recovery
- HTTP timeout ต่อครั้งของ delivery 90 วินาที สูงสุด 5 ครั้ง เว้น 15, 30, 60, 120 วินาที retry เฉพาะ network/timeout, 429 และ 5xx ไม่ retry input/credential errors; ขั้นอ่าน metadata จาก GitHub มี retry แบบจำกัดเช่นกัน workflow มีเวลารวมสูงสุด 25 นาที และปฏิเสธ redirects เพื่อไม่ส่ง secret ไป URL อื่น
- เมื่อเข้า Resume จะขอ catch-up ถ้า stale เกิน 5 นาที; **Sync / retry** ขอแบบ manual ได้แต่เซิร์ฟเวอร์จำกัดอย่างน้อย 30 วินาทีต่อ connection และใช้ lease กัน sync ซ้อน ช่วงเรียก GitHub สอง endpoint มี timeout รวม 10 วินาที
- ถ้า core metadata endpoint ติด rate limit จะลอง repository search ซึ่งมี quota แยก และรับเฉพาะชื่อ repo ที่ตรงกัน/ยืนยันว่า public เท่านั้น; การกู้ commits ยังต้องรอ core quota พร้อมใช้งาน
- Recovery ดึงสูงสุด 100 commits ของ branch ที่ตั้งไว้ ตรวจ stable repository ID ทุกครั้ง ไม่ยืนยัน workflow delivery และไม่รับประกันประวัติครบ หากชนขอบเขต 100 commits, มี forced push ที่ sender แจ้ง หรือหา head ก่อนหน้าไม่เจอ จะแสดง incomplete history แบบคงอยู่จน unlink/reconnect
- แสดง 20 กลุ่มล่าสุด unread นับกลุ่มที่ยังไม่ยืนยันทั้งหมด การกดยืนยันครอบคลุมถึง sequence ที่ได้จาก snapshot รวมกลุ่มเก่าด้วย; delivery ที่มาหลัง snapshot ยัง unread แม้เวลา commit จะเก่ากว่า
- Head ที่ใช้เปรียบเทียบ recovery อัปเดตจาก GitHub API เท่านั้น delivery ล่าช้าจึงไม่เขียนทับ head; sequence ใช้ transaction และ row lock กำหนดลำดับรับข้อมูลแยกจากเวลา commit
- Archive หยุดรับ delivery, catch-up และการเขียน return context; restore กลับมาใช้งานได้ Unlink ลบ credential, cache และ marker ด้วย cascade แต่ไม่ลบ return note, Issues, Decisions หรือ Scope หลัง unlink sender เดิมจะได้ 401
- Rotate secret ใช้แทนกรณี secret หายหรือสงสัยรั่ว secret เดิมใช้ไม่ได้ทันที ต้องแก้ GitHub repository secret ใหม่ และรอ delivery เพื่อยืนยันการเชื่อมต่ออีกครั้ง
- API catch-up ไม่ได้ตรวจจับทุก push ที่หายไป ไม่ใช่ full historical audit และ polling ไม่ได้ใช้ปลุก Render ให้ทำงานตลอด
- ถ้า rename repo, เปลี่ยน default branch, repo กลายเป็น private หรือไม่มี commits อาจต้องแก้ workflow หรือ unlink/reconnect บันทึกบริบทของเจ้าของยังอ่านได้เมื่อ GitHub ล่ม
- สามารถวาง commit URL ในข้อความ Decision/Issue เดิมเพื่ออ้างอิงเอง ฟีเจอร์นี้ไม่จับคู่ความหมาย ไม่ปิด Issue และไม่แก้ next action/Scope/Decision ให้อัตโนมัติ

## API ที่เพิ่ม

ทุก path อยู่ใต้ `/api/v1` owner endpoints ใช้ session cookie และกฎ Origin เดิม; ทุกการเขียนตรวจ Active และล็อก Project ก่อน connection

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/projects/:projectId/github` | state, grouped activity, unread และ return context |
| POST | `/projects/:projectId/github` | body `{ "url": "https://github.com/owner/repo" }`; secret แสดงครั้งเดียวและ response เป็น no-store |
| DELETE | `/projects/:projectId/github` | unlink และ revoke |
| POST | `/projects/:projectId/github/rotate` | rotate secret แบบ no-store |
| POST | `/projects/:projectId/github/sync` | body `{ "force": false }` หรือ true |
| POST | `/projects/:projectId/github/review` | body `{ "connectionId": "…", "sequence": 3 }`; ไม่อนุญาต sequence ในอนาคต |
| PUT | `/projects/:projectId/return-context` | `{ "returnNote": "…", "focusIssueId": null }`; note สูงสุด 5,000 อักขระ issue ต้องอยู่ในโปรเจกต์นี้ |
| POST | `/integrations/github/:connectionId/deliveries` | `Authorization: Bearer <secret>` ไม่ต้องมี browser session |

ตัวอย่าง delivery ไม่ใช่ secret จริง:

```json
{
  "deliveryId": "actions:12345",
  "repositoryId": 4242,
  "branch": "main",
  "eventAt": "2026-11-04T12:00:00Z",
  "incomplete": false,
  "commits": [{
    "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "message": "Test expired session",
    "author": "Developer",
    "eventAt": "2026-11-04T12:00:00Z"
  }]
}
```

Unknown fields, JSON ที่มีหลายค่า, SHA ผิดรูปแบบ, timestamp ที่หายหรือเกินเวลาปัจจุบัน 5 นาที และ body เกินขนาดจะถูกปฏิเสธ HTTP 200 ส่งกลับหลัง commit transaction แล้วเท่านั้น

## เตรียมเดโมสำหรับคอร์ส

ใช้ repository public ขนาดเล็กของคุณเองที่สามารถ push ได้ เตรียมบัญชี Unpause ไว้ก่อน แล้วรัน script นี้กับ local หรือ deployment ของคุณ (จะสร้างโปรเจกต์เดโมใหม่ในบัญชีนั้น):

```bash
export UNPAUSE_BASE_URL='http://localhost:4000/api/v1'
read -r -p 'Email: ' UNPAUSE_EMAIL
read -r -s -p 'Password: ' UNPAUSE_PASSWORD
export UNPAUSE_EMAIL UNPAUSE_PASSWORD
node scripts/create-continuity-demo.mjs
unset UNPAUSE_EMAIL UNPAUSE_PASSWORD
```

Script สร้าง Scope, Issue พร้อม next action, pinned Decision พร้อมเหตุผล และ return note/focus issue ให้ครบ ไม่บันทึก password ลงไฟล์ หากระบุ deployment URL ต้องเป็น HTTPS หลังจากนั้นเปิด path ที่ script แสดง เชื่อม repo และทำ setup workflow ตามขั้นตอนข้างต้น

เดโมตามลำดับ: แสดง goal/เหตุผล/next action → push การแก้ไขเล็กน้อยใน repo → ดู workflow สำเร็จ → รอรายการขึ้นอัตโนมัติ → reload เพื่อยืนยัน unread → กดยืนยันอ่านแล้ว → แก้ return note โดย Issue/Decision/Scope ไม่เปลี่ยน

## วัด warm และ idle deployment จริง

มีผล [staging จริง](UNPAUSE_STAGING_LIVE_VERIFICATION_TH.md) และ [production rollout](UNPAUSE_PRODUCTION_ROLLOUT_TH.md) พร้อมแยก source commit, Actions run, browser และข้อจำกัดแล้ว ดู [วิธีตรวจเองและ release](UNPAUSE_SELF_CHECK_AND_RELEASE_TH.md) สำหรับขั้นตอนทวนสอบ

ถ้าวัดใหม่ ให้แยกเวลา push, `receivedAt`, sender ได้ HTTP 200 และเวลาที่ UI เห็นออกจากกัน `receivedAt` ใช้ PostgreSQL transaction timestamp จึงไม่ใช่เวลา commit transaction ที่แม่นยำ; HTTP 200 ของ sender ยืนยันว่าฝั่ง API commit แล้ว ชื่อเวลา commit จาก GitHub มีความละเอียดเป็นวินาที

หลังปล่อย idle ต้องมีหลักฐานว่า hosting พักจริงก่อน push ไม่เปิด Resume/polling เพื่อปลุกระบบก่อนคำขอจาก Actions การตรวจผ่าน control plane ทำได้ แต่ SQL/health request อาจปลุกฐานข้อมูลหรือ service ถ้า delivery หายให้ทดสอบ public API recovery และตรวจว่า source/receipt/unread แสดงตามจริง โดยไม่สร้าง SHA ซ้ำ ถ้าติด quota ให้บันทึก error ตามจริงแทนการนับว่า recovery ผ่าน

ให้เพื่อนในคอร์สทดลองกลับมาเปิดโปรเจกต์และระบุ 3 ข้อ: เปลี่ยนอะไร, ทำไมเลือกแนวทางนี้, และควรเริ่มทำอะไรต่อ บันทึกข้อสังเกตจริงแทนการสมมติผลประเมิน

อ้างอิง platform ที่ตรวจประกอบ implementation: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [GitHub REST commits](https://docs.github.com/en/rest/commits/commits) ส่วน timeout/retry และ Bearer protocol ข้างต้นเป็นการออกแบบของ Unpause เอง
