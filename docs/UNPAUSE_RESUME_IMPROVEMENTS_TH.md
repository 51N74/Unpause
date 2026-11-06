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

- [PR #4](https://github.com/51N74/Unpause/pull/4) merge เป็น `d9036f3391ec5b05ef845c6751360f3fbee7c340`
- [CI ของ head ล่าสุด](https://github.com/51N74/Unpause/actions/runs/42217876621) และ [CI ของ main](https://github.com/51N74/Unpause/actions/runs/42218456894) ผ่านทุกขั้นตอน รวม legacy Node API, sender, race/vet, vulnerability checks, browser และ Docker
- Render `dep-dbmsjf0u01pc739g4fo0` Live เวลา **19:37:32 วันที่ 6 พฤศจิกายน 2026 (Asia/Bangkok)** หลัง checks ผ่าน Migration 00003 ใช้ 1.33 วินาทีและ schema เป็น 3 จำนวนเดิมก่อนสร้างข้อมูลทดสอบยังคง 6 projects / 203 cached commits
- Production API/security **27 checks ผ่าน** ด้วยบัญชีใหม่แยก 2 บัญชี ตรวจ demo/idempotence, privacy, valid links, cross-user/cross-project rejection, unknown fields, Origin protection, archive/restore และไม่เปลี่ยน context/unread ขณะเชื่อม
- Browser production ทวนกับประวัติจริงที่กู้แล้ว 100 commits: ตรวจ private demo, preview 5 commits, ขยาย/ยุบโดยไม่อ่านอัตโนมัติ, pause note ภาษาไทยรวมคำยาวไม่มีช่องว่าง 500 ตัว, reload, links และตัวแก้ links บน desktop/mobile ไม่มี horizontal overflow, page error หรือ HTTP 500 ในรอบที่ตรวจ
- Health สุดท้ายตอบ HTTP 200, `status=ok`, `database=ok` และไม่พบ error-level app logs ในช่วงตรวจที่บันทึกไว้

รอบเข้า Resume ครั้งแรกพบ connection เป็น Needs attention และยังไม่มี lastSyncedAt ไม่ได้เก็บ response ของต้นเหตุครั้งนั้น จึงไม่ระบุสาเหตุแน่นอน ทวน force sync แล้ว HTTP 200 และ lastSyncedAt ขยับจริง สถานะกลับ Receiving updates ได้ 100 unique cached commits โดยไม่มี SHA ซ้ำ pause note และ links คงเดิม [ผลทวน sync](reports/resume-improvements/production-sync-observation.json)

[Production release/migration](reports/resume-improvements/production-release.json) · [API checks](reports/resume-improvements/production-api-result.json) · [Browser](reports/resume-improvements/production-browser-result.json) · [Health](reports/resume-improvements/production-health.json) · [Error log check](reports/resume-improvements/production-error-log-check.json) · [Desktop](reports/resume-improvements/production-desktop.png) · [Mobile](reports/resume-improvements/production-mobile.png)

## ขอบเขตและข้อจำกัด

npm audit 0 vulnerabilities; govulncheck 0 vulnerabilities affecting code/imported packages และยังมี module-only advisory เดิม 1 รายการใน module ที่ระบบไม่เรียกใช้ [ผล Go scan](reports/resume-improvements/go-vulnerability-check.txt) ผลนี้ไม่ใช่ load test หรือ penetration test ทุกช่องทาง

รอบ production ใช้ metadata ของ 8 commits จริงจาก public GitHub API แล้วส่ง POST ด้วย integration credential ของโปรเจกต์ทดสอบ เป็น manual authenticated smoke test ไม่ใช่การรัน sender Actions ของ forum รอบใหม่ GitHub Actions ที่ตรวจรอบนี้คือ CI ของ Unpause ไม่มีการแก้ repo, workflow, secret หรือ variable ใน panstr-webboard-forum การเชื่อมต่อที่ตั้งครบแล้วใช้ protocol/secret เดิมต่อได้

การแสดง 5 commits เป็นการย่อหน้าจอ ข้อมูลยังมาจาก cache สูงสุด 20 กลุ่มเดิม Public GitHub quota/upstream availability ยังจำกัด catch-up ได้ และประวัติที่เก็บไม่รับประกันว่าครบทั้ง repository เดโมไม่มี integration secret หรือ commit ปลอมติดตั้งอัตโนมัติ ต้องเชื่อม public repo ของตนเองตามขั้นตอนปกติ


Rollback โค้ดไม่ย้อน schema/data ตาราง links เป็น additive จึงคงไว้เมื่อย้อนโค้ด ไม่รัน migration down เพื่อลบข้อมูลที่อาจเริ่มใช้งาน
