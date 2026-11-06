# ปรับ Resume และการกลับมาทำงาน — 6 พฤศจิกายน 2026

Branch `codex/resume-workflow-improvements` จาก main `7cedc1e` ผู้ใช้อนุญาตให้ทดสอบ ตรวจความปลอดภัย แล้ว merge/deploy production

## การใช้งานใหม่

- หน้า Resume แสดง 5 commits ล่าสุดตามเวลา commit พร้อม Show 5 more commits และ Show latest 5 ข้อความยาวย่อหนึ่งบรรทัด รายละเอียดกดขยายได้ ประวัติที่แสดงยังอยู่ในขอบเขต cache 20 กลุ่ม ไม่ใช่ประวัติ Git ทั้งหมด
- ปุ่ม Mark all updates as reviewed มี confirmation อธิบายว่ารวมรายการที่ซ่อนอยู่ เก็บ snapshot ตอนเปิดกล่องเพื่อไม่ล้าง unread ของข้อมูลที่เข้ามาระหว่างยืนยัน การกดดูเพิ่มเติม/รายละเอียดและ reload ไม่ล้าง unread
- Pause work บันทึกจุดที่หยุด, blockers และงานถัดไปลง return note เดิม มีข้อความแจ้งก่อนแทนที่ คง focus issue และไม่เปลี่ยน Issue, Decision, Scope หรือ unread บันทึกไม่สำเร็จจะเก็บ draft ในกล่องให้ลองใหม่
- Open my demo บนหน้า Projects สร้างข้อมูลส่วนตัวในบัญชีปัจจุบันแบบ transaction กดซ้ำคืนโปรเจกต์เดิมโดยไม่ล้างสิ่งที่แก้ ไม่มีบัญชีกลาง รหัสผ่านสาธารณะ หรือ GitHub secret ในเดโม หาก archive เดโมต้อง restore จากรายการ Archived
- Commit details → Link issue / decision เชื่อม cached commit กับ Issue/Decision ในโปรเจกต์เดียวกัน เลือก None ทั้งคู่เพื่อลบ link มีช่องค้นหาชื่อ Issue และ Decision การเชื่อมไม่ปิด Issue หรือเปลี่ยนเหตุผลของ Decision
- Download workflow, Rotate secret และ Unlink ย้ายเข้า Manage connection / workflow setup

## API และความปลอดภัย

เพิ่ม authenticated `POST /api/v1/projects/demo` และ `PUT /api/v1/projects/:projectId/github/commits/:sha/link` ใช้ session/Origin protection เดิม Demo ID คำนวณจาก authenticated owner และค่าคงที่ กดซ้ำไม่สร้างข้อมูลเพิ่ม ส่วน commit ต้องมีอยู่ใน connection ปัจจุบัน ตรวจ ownership, project, archived status, payload fields และ SHA ฝั่ง server ใช้ parameterized SQL และ transaction

Migration `00003_commit_links.sql` เพิ่มตาราง `git_activity_link` และ foreign keys/indexes เท่านั้น การลบ Issue/Decision ตั้ง reference เป็น NULL ส่วน unlink connection ลบ cached links ตาม FK ไม่แก้ข้อมูลบริบทเดิม

## การตรวจสอบก่อน release

Frontend regression ครอบคลุม five-commit preview, ดูเพิ่มเติมไม่ acknowledge, snapshot confirmation, pause note/focus preservation และ draft เมื่อ save ล้มเหลว Go integration ครอบคลุม private/idempotent demo, cross-user/cross-project links (รวมเจ้าของเดียวกัน), malformed/unknown payload, missing commit, CSRF, archive, target deletion และ unlink cascade

Browser ใช้ compiled Go + React production bundle + PostgreSQL แยกในเครื่อง และ GitHub stub ตรวจ demo จาก UI, pause/reload, links/reload, preview/expand, polling, unread, workflow download และ desktop/mobile; ไม่อ้างว่าผล localhost เป็น latency ของ Render

จุดกู้คืน Neon `before-resume-improvements-20261106` (`br-raspy-band-a1qj0d36`) และสำเนาซ้อม `rehearsal-resume-improvements-20261106` (`br-small-night-a1n7v742`) ซ้อม Up SQL เดียวกับ migration เป็น transaction ผ่าน Neon MCP บนสำเนา ข้อมูลก่อน/หลังคง 6 projects / 203 cached commits, ตาราง links เริ่มว่างและมี FK 3 รายการ ไม่ได้แก้ schema production ระหว่างซ้อม

## Release และผล production

รอ CI ของ PR และ main ผ่านก่อน Render auto-deploy ตาม checksPass แล้วตรวจ deployment/health/migration และ UI/API จริงอีกครั้ง จะบันทึกผลหลัง deploy เมื่อเสร็จ

Rollback โค้ดไม่ย้อน schema/data ตาราง links เป็น additive จึงคงไว้เมื่อย้อนโค้ด ไม่รัน migration down เพื่อลบข้อมูลที่อาจเริ่มใช้งาน
