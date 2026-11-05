# ตรวจใช้งานเองและปล่อย production

อัปเดต 5 พฤศจิกายน 2026 · [ผล production และรายการเปลี่ยนแปลง](UNPAUSE_PRODUCTION_ROLLOUT_TH.md)

## ตรวจด้วยบัญชีของตัวเอง

1. เปิด [production](https://unpause-pey1.onrender.com), สมัครบัญชีหรือ login และสร้างโปรเจกต์ทดสอบ ใส่ Scope, Decision พร้อมเหตุผล, Issue พร้อม next action และ return note
2. เปิด Resume แล้วเชื่อม public repository ขนาดเล็กที่คุณ push ได้ ตรวจ branch ที่แสดง เพราะ integration ติดตาม branch ที่ตั้งไว้เพียง branch เดียว
3. ทำตาม [คู่มือติดตั้ง](UNPAUSE_GITHUB_CONTINUITY_SETUP_TH.md): เก็บ secret ที่แสดงครั้งเดียวใน GitHub Actions secret, ตั้ง delivery URL เป็น variable และเพิ่ม workflow ที่ดาวน์โหลดจาก UI
4. Push commit ไป branch ที่เชื่อม เปิด Actions แล้วตรวจ sender run และข้อความ `Unpause accepted the update at ...`
5. เปิด Resume ค้างไว้ ตรวจว่า commit ใหม่ปรากฏผ่าน polling โดยไม่ reload และลิงก์เปิด commit บน GitHub ถูกแห่ง
6. Reload ก่อนกดยืนยัน: unread ต้องยังอยู่ จากนั้นกด **Mark updates as reviewed** จึงหาย ตรวจว่า Scope/Decision/Issue/next action ไม่ถูกเปลี่ยนอัตโนมัติ
7. แก้ return note แล้ว reload ตรวจว่าบันทึกไว้ได้ ทดลอง logout แล้วเข้า URL ของโปรเจกต์อีกครั้ง ต้องกลับหน้า login
8. ถ้าทดสอบ rerun Actions เดิม ต้องไม่เกิด commit/unread ซ้ำ ใช้เวลารับข้อมูลและสถานะ synchronization ประกอบเสมอ

Repository `panstr-webboard-forum` มี workflow ทดสอบ production ชื่อเฉพาะอยู่แล้วตามรายงาน อย่าแทนที่ secret/variable ของการเชื่อมต่อนั้นโดยไม่ตั้งใจ สำหรับโปรเจกต์ใหม่ควรใช้ repository ทดสอบอีกแห่ง หรือวางแผนเปลี่ยน connection เดิมให้ชัดก่อน

## อ่านสถานะให้ถูกต้อง

- `Awaiting first update`: เชื่อม repo แล้ว แต่ยังไม่มี authenticated delivery แม้ public API จะกู้ commits มาได้
- `Receiving updates`: เคยรับ delivery ที่ถูกต้องแล้ว ดูเวลารับครั้งล่าสุดประกอบ
- `Needs attention`: มีปัญหาการ sync เช่น public GitHub API quota; saved context ยังอ่านได้ และ Actions อาจส่งสำเร็จแยกกัน
- `Paused (archived)`: archive แล้ว ingestion/การแก้ข้อมูล integration จะถูกปฏิเสธ
- คำเตือน incomplete history หมายถึงไม่รับประกันว่าประวัติที่แสดงครบทั้งหมด การกู้ย้อนหลังมีขอบเขต 100 commits และไม่ใช่ complete code diff

## ตรวจ health และข้อมูลเดิม

```bash
curl --fail --silent --show-error \
  https://unpause-pey1.onrender.com/api/v1/health
```

คาดหวัง HTTP 200 พร้อม `status=ok` และ `database=ok` การผ่าน health เพียงอย่างเดียวยังไม่ยืนยัน CRUD หรือ Actions ต้องตรวจตามขั้นตอนด้านบนด้วย

ตรวจ cookie ผ่าน browser DevTools: `Secure`, `HttpOnly`, `SameSite=Lax` อย่าคัดลอกค่าคุกกี้/secret ลง issue, git, screenshot หรือรายงาน ถ้า secret integration หายให้ rotate แล้วอัปเดต GitHub secret ที่เกี่ยวข้อง

## Release ครั้งถัดไป

1. ตรวจ branch ล่าสุดและเปิด PR เข้า `main` จาก branch งาน ไม่ใช้ผล CI ของ commit เก่าที่มี source ต่างกัน
2. รอ CI ครบ: tests, audits, build, race/vet, browser และ Docker ถ้ามี migration ให้ซ้อมกับสำเนา Neon ที่แยกและเตรียมจุดกู้คืน
3. ตรวจ Render production ว่า repo/branch/database/CORS/health path ถูกต้อง และไม่คัดลอก credentials ของ staging มาใช้
4. Merge หลัง checks ผ่าน Render production ใช้ `autoDeployTrigger: checksPass` จึงรอ checks ของ commit บน `main` ก่อน deploy [Render deploys](https://render.com/docs/deploys)
5. ถ้า auto deploy เริ่มแล้ว ไม่ต้อง trigger deploy ซ้ำ จับ deploy ID/commit ที่ต้องการและรอ Live แล้วตรวจ health, login, ข้อมูลเดิม และ integration ด้วยข้อมูลทดสอบ
6. บันทึกสิ่งที่สังเกตจริงและข้อจำกัด อย่านับ cooldown no-op เป็นการ sync ที่สำเร็จใหม่ หรือถือว่า API recovery ยืนยัน workflow delivery แล้ว

## ถ้าพบปัญหาหลังปล่อย

หยุดเพิ่มการเปลี่ยนแปลงเมื่อ health/database ไม่พร้อม, login หรือข้อมูลเดิมใช้ไม่ได้ หรือพบปัญหาสิทธิ์/credential ที่ยังแก้ไม่ครบ ใช้ Render rollback ไป deploy ที่ผ่านและยังมี artifact หรือ rebuild commit เดิมถ้า artifact ไม่อยู่แล้ว [Render rollbacks](https://render.com/docs/rollbacks)

Rollback โค้ดไม่ย้อน Neon schema/data Migration 2 เพิ่มตาราง integration แยก โค้ดเดิมสามารถคงตารางเหล่านี้ไว้ได้ หลีกเลี่ยง migration `down` ที่ลบตาราง การเลือกใช้จุดกู้คืนข้อมูลต้องตรวจสิ่งที่เขียนหลังจุดนั้นก่อน และไม่ใช่การ merge Neon branches อัตโนมัติ

หากต้องวัด cold start จริง ให้ปิด Resume/ตัวเรียก API ที่คอย polling รอจน Render พักและ Neon idle แล้วให้ Actions เป็นคำขอแรก ก่อนเปิด browser ตรวจผล เก็บ `receivedAt`, HTTP 200 ของ sender และเวลาที่ UI เห็นแยกกัน
