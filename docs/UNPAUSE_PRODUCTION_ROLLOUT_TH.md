# ผลปล่อย GitHub Continuity บน production

วันที่ 5 พฤศจิกายน 2026 · เวลา Asia/Bangkok เว้นแต่ระบุ UTC

**สถานะ: merge/deploy และการทดสอบจริงทั้ง warm, cold, recovery, browser และ security ผ่านตามขอบเขตที่ระบุ ทวน sync หลัง quota ได้แล้ว ข้อจำกัดและ log observations ระบุไว้ด้านล่าง**

## ขอบเขตและระบบที่ใช้

ผู้ใช้อนุญาตให้ merge/deploy production และสร้างข้อมูลทดสอบได้ ข้อมูลเดิมไม่ใช่ข้อจำกัด แต่ยังตรวจความคงอยู่ของข้อมูลจริงก่อนและหลัง migration ผู้ใช้อนุญาตให้เพิ่ม workflow, Actions secret/variable และ push commit ทดสอบใน `51N74/panstr-webboard-forum` โดยให้รายงานสิ่งที่เพิ่มและรอการตัดสินใจเรื่องลบภายหลัง

- Production: [unpause-pey1.onrender.com](https://unpause-pey1.onrender.com) · Render `unpause`, `srv-dbhlcjgn74is73ebtrkg`, workspace `Jiranat's workspace`, Oregon, Free, Docker
- Neon production project `Unpause` (`snowy-king-92060655`), branch `production` (`br-fragrant-glade-a10dnan7`), database `neondb`, Singapore
- จับคู่ hostname ใน Render กับ Neon endpoint `ep-long-butterfly-a1kxj7k1` แล้ว เป็น pooled connection พร้อม TLS ไม่ใช่ staging
- Staging เดิมยังแยก project/service ดู [รายงาน staging](UNPAUSE_STAGING_LIVE_VERIFICATION_TH.md)
- Repository สำหรับ sender จริง: [panstr-webboard-forum](https://github.com/51N74/panstr-webboard-forum), public, ID `814157627`, default branch `main`

## การเตรียม release และผล CI

- เวอร์ชัน production เดิม `31f2e8109ed90e2bbd6a1ae15324ac095c9343b7`
- เพิ่ม CI สำหรับ PR เข้า `main` และ push บน `main`; ใช้ explicit Bash เพื่อให้ browser test ที่ pipe ผ่าน `tee` ส่งสถานะล้มเหลวกลับเข้า CI ได้จริง
- [PR #1](https://github.com/51N74/Unpause/pull/1) merge เป็น `6f99fdd4882a765ff6b2881c8b72d4801841f79c`
- [CI ของ PR เวอร์ชันสุดท้าย — success](https://github.com/51N74/Unpause/actions/runs/41989190192)
- [CI ของ merge commit บน main — success](https://github.com/51N74/Unpause/actions/runs/41989702582)
- ทั้งสองรวม locked install, npm audit, Go/React/legacy Node tests, sender tests, build, race/vet, govulncheck, browser และ Docker build
- Render production เปลี่ยนจาก On Commit เป็น `checksPass` ใน Blueprint; ช่วงเตรียมงานปิด auto deploy ชั่วคราว ก่อน Blueprint sync เปิดกติกาใหม่ ยืนยันว่า deployment หลัง merge เริ่มหลัง CI ผ่าน
- Deploy `dep-dbm3b2jbc2fs73an1oq0` ขึ้น Live เวลา 14:53:03; migration 2 สำเร็จเวลา 14:52:52

## จุดกู้คืนและการซ้อม migration

สร้างสอง branches ใน Neon production project:

| Branch | ID | หน้าที่ |
|---|---|---|
| `before-continuity-production-20261105` | `br-autumn-band-a1oxnzno` | สำเนาข้อมูลก่อนปล่อยฟีเจอร์ คง schema 1 |
| `rehearsal-continuity-production-20261105` | `br-orange-hat-a19kqy9m` | ซ้อม migration แยกจาก production |

ใช้ migration binary ที่คอมไพล์จาก source จริง: direct connection อัปเกรด schema 1 → 2 สำเร็จ แล้วรันซ้ำผ่าน pooled connection พบว่าไม่มี migration ค้าง จำนวน User/Project/Scope/Issue/Decision ของสำเนายังเท่าเดิม: 2/2/3/1/1

สร้างบัญชีและข้อมูลทดสอบผ่านแอป production เวอร์ชันเดิมก่อนปล่อย จากนั้นตรวจหลัง migration: จำนวน User/Project/Scope/Issue/Decision ยังเป็น 3/3/4/2/2 ก่อนเริ่มเพิ่มข้อมูลสำหรับทดสอบ lifecycle เพิ่มเติม ข้อมูลทดสอบแยกจากโปรเจกต์เดิม

## ตรวจค่าตั้งและเหตุการณ์ credential

ตรวจ `NODE_ENV=production`, `AUTO_MIGRATE=true`, CORS ตรงโดเมน production, Secure/SameSite=Lax cookie, API path `/api/v1`, GitHub API ทางการ และ HTTP health path `/api/v1/health` ตรวจ login response จริงเพื่อยืนยัน HttpOnly ด้วย

ระหว่างอ่าน Dashboard เกิด clipboard ส่งค่าก่อนหน้ามา ทำให้ connection string ปรากฏในผลเครื่องมือ ผู้ใช้อนุญาตให้หมุนรหัสผ่านแล้ว: หมุน `neondb_owner` ใน production และสำเนาทั้งสอง branches ครบ อัปเดตเฉพาะ `DATABASE_URL` ของ Render ด้วย merge operation โดยคง env keys อื่นไว้ ตรวจว่า URL เปลี่ยนแต่ endpoint/database/TLS ยังถูกต้อง และล้าง clipboard ไม่มี credential ในรายงานหรือ repository

การอัปเดต env ผ่าน Render MCP trigger redeploy เวอร์ชันเดิมเอง (`dep-dbm356gae00c7387r3q0`) ซึ่งขึ้น Live ก่อนเริ่ม release ฟีเจอร์

## ผลตรวจ production ก่อนทดสอบ sender

ผ่าน API checks 39 รายการบน deployment จริง: ข้อมูลที่สร้างก่อน deploy ยังอ่านได้, login, cookie flags, wrong password, logout และใช้ cookie ที่ revoke แล้วไม่ได้, security headers, Origin/cross-site protection, scope immutable, Issue/Decision CRUD, scope-version binding, archive/restore, ownership isolation ของ project/context/activity/issue/decision, foreign focus issue rejection และ Unicode return note

ใช้บัญชีและข้อมูลทดสอบที่สร้างใหม่ การตรวจนี้ไม่ใช่ penetration test ครอบคลุมทุกช่องทาง ส่วน session expiry มี automated tests; live session checks ชุดนี้ยืนยัน logout/revocation ไม่อ้างว่าได้รอครบอายุ session จริง

## ปัญหาที่พบและวิธีแก้

เมื่อเชื่อม repository ที่มีประวัติจำนวนมาก การ catch-up ตอบ HTTP 500 ในประมาณ 5.591 วินาที โดย `lastSyncedAt` ยังว่างและยังไม่มี activity จึงยังไม่ติดตั้ง sender จนกว่าจะตรวจสาเหตุและแก้

โค้ดเดิมบันทึก commits ทีละ query; recovery มีเวลาปิด transaction 3 วินาที ทำให้จำนวน network round trips เพิ่มตาม commits เมื่อ Render/Neon อยู่คนละ region เพิ่ม regression ที่กู้ 100 commits โดยจำลอง database query latency 40 ms แล้วทำซ้ำได้: โค้ดเดิมล้มเหลว `context deadline exceeded`; หลังแก้ผ่านทั้งกู้ครบและกู้ซ้ำโดยไม่มี SHA ซ้ำ

แก้เฉพาะ storage ให้ insert ชุด commits ผ่าน parameterized `unnest` หนึ่งคำสั่ง คง transaction, unique constraints, sequence, ข้อจำกัด payload และ timeout เดิม ไม่เพิ่ม credential หรือขยายขอบเขตข้อมูล

- Fix commit `c2702298b77a8f158491968c48fc426775b0bc3b`
- [PR #2](https://github.com/51N74/Unpause/pull/2)
- [CI ของ fix PR — success](https://github.com/51N74/Unpause/actions/runs/41992252666)
- Merge เป็น `8977a289aed200492080822c139f2a822682783a`; [CI บน main — success](https://github.com/51N74/Unpause/actions/runs/41992709898)
- Render deploy `dep-dbm3m67b9u1s738cv1pg` Live เวลา 15:16:39; schema ยังเป็น 2 ไม่มี migration ใหม่
- ยืนยัน production หลังแก้ได้ 100 unique commits, source `recovery`, ไม่มี authenticated workflow receipt ถูกสร้างเทียม, `Project.updatedAt` คงเดิม กู้ซ้ำหลัง cooldown สำเร็จ HTTP 200 ใช้เวลา 4.526 วินาทีและจำนวน commits คงเดิม การวัดรอบนี้ยืนยันว่า `lastSyncedAt` ขยับจริง ไม่ได้นับ cooldown no-op ว่า sync ผ่าน
- หลักฐาน [ก่อนแก้](reports/production/catchup-before-fix.json), [regression เดิมล้มเหลว](reports/production/latency-regression-before.txt), [regression หลังแก้](reports/production/latency-regression-after.txt), [production หลังแก้](reports/production/catchup-after-fix.json)

## Actions, browser, recovery และ idle บน production

### Warm sender และ browser

[Actions run 41993588576](https://github.com/51N74/panstr-webboard-forum/actions/runs/41993588576) สำเร็จทั้ง attempt 1 และ rerun attempt 2

| จุดวัด | เวลา/ผล |
|---|---|
| Workflow commit `d5c46f8…` | 15:19:32 |
| `receivedAt` ของ activity | 15:19:43.533812 |
| Sender ได้ HTTP 200 | 15:19:45.019011 |
| Browser เห็น commit โดยไม่ reload | 15:20:06.288 |
| Commit → recorded receipt | 11.534 วินาที |
| Commit → sender ยืนยัน HTTP 200 | 13.019 วินาที |
| Recorded receipt → visible | 22.754 วินาที |

`receivedAt` ใช้ PostgreSQL transaction timestamp จึงไม่ใช่เวลา commit transaction ที่แม่นยำ HTTP 200 ยืนยันว่า API commit แล้ว เวลาของ GitHub commit มีความละเอียดเป็นวินาที ผลเป็น observation ของรอบนี้ ไม่รับประกัน latency ทุกครั้ง

Browser จริงตรวจ unread คงอยู่หลัง reload, explicit review จึงเป็น 0, แก้ return note แล้วเห็นค่าที่บันทึก, logout และกลับเข้า protected URL แล้วไป login, desktop/mobile ไม่มี page error หรือ document horizontal overflow ข้อมูลไทยและ Scope/Decision/next action เดิมยังแสดง ([ผล warm](reports/production/warm-result.json))

Real Actions rerun ใช้ delivery identity เดิมแล้ว sequence คงที่ 3, จำนวน unique commits คงที่ 101, 2 กลุ่มและ unread 0 ไม่สร้างการแจ้ง unread ซ้ำ ([ผล rerun](reports/production/actions-rerun-result.json))

### Integration security บน production

ผ่าน 32 checks เพิ่มจาก API 39 checks: secret ผิด 401, repository/branch ไม่ตรง 403, credential ข้าม connection 401, unknown/invalid payload 400, payload ที่ field/count ถูกต้องแต่ขนาด 314,666 bytes ถูกปฏิเสธ 400 โดยไม่มี write, duplicate ไม่เพิ่ม sequence/commits, archived ingestion/return context 409, rotate ทำให้ secret เดิมใช้ไม่ได้, secret ใหม่ใช้ได้, review sequence ในอนาคต 400, unlink revoke secret และเก็บ return note ไว้ API ปกติไม่ส่ง secret/hash ออกมา

[ผล API/security](reports/production/api-security-result.json) · [ผล integration security](reports/production/integration-security-result.json)

ตัวตรวจ archive รอบแรกส่ง payload ไม่ครบ จึงได้ validation 400 ก่อนตรวจ archive ปรับตัวทดสอบให้ส่งข้อมูลครบแล้วคงเกณฑ์คาดหวัง 409 เดิม ไม่ได้ผ่อนกฎของแอปเพื่อให้ผ่าน

### Missed delivery recovery

สร้าง empty commit `e3ad68642f093f05bee043815f23cffc20797a07` พร้อม `[skip actions]` โดยไม่เปลี่ยนไฟล์ ตรวจ GitHub API ว่าไม่มี Actions run สำหรับ SHA นี้ แล้ว manual sync พบ commit เป็น source `recovery` จริง HTTP 200 ใน 3.947 วินาที จำนวน unique commits เพิ่มเป็น 102 ไม่มี SHA ซ้ำ และไม่เปลี่ยนเวลายืนยัน workflow receipt เกิด unread 1 ตามข้อมูลใหม่ ก่อน explicit review เพื่อเตรียม idle

[ผล recovery](reports/production/recovery-result.json)

### Idle / cold start

เริ่มหยุด application requests เวลา 15:24:05.343310 กำหนด earliest push 15:41:05.343310 และต้องเห็น Render shutdown หลังจุดเริ่ม กับ Neon idle จริงก่อน ไม่ใช้ timer อย่างเดียว ไม่เรียก health/SQL/browser เพื่อปลุกระบบก่อน delivery

ยืนยันจาก control plane ว่า Render instance เดิม shutdown เวลา 15:39:03.213810958 และ Neon production idle โดยมี `suspended_at=15:44:01` สังเกตสถานะทั้งสองแล้วจึงส่ง empty commit `7a5619bd180333b343958f1b6e2ae111ea9aa72f` เวลา 15:45:05 รวมเวลาหยุด application requests ประมาณ 21 นาที ไม่มีการเรียก SQL/health/browser เพื่อช่วยปลุกก่อน delivery

[Cold Actions run 41996886317](https://github.com/51N74/panstr-webboard-forum/actions/runs/41996886317) สำเร็จ attempt 1 โดยไม่มี temporary failure ใน sender log: Neon กลับมา active เวลา 15:45:18 และ Render instance ใหม่ `srv-dbhlcjgn74is73ebtrkg-dfvgm` เริ่มฟังเวลา 15:45:19.719810506 ใช้ schema 2 เดิม

| จุดวัด | เวลา/ผล |
|---|---|
| Cold commit | 15:45:05 |
| Recorded receipt | 15:45:25.097492 |
| Sender ได้ HTTP 200 | 15:45:26.675748 |
| Commit → recorded receipt | 20.097 วินาที |
| Commit → sender ยืนยัน HTTP 200 | 21.676 วินาที |

API ยืนยัน source `actions`, delivery ID ตรง run, 103 unique commits และ cold SHA เพียงครั้งเดียว, unread 1, return note และ `Project.updatedAt` คงเดิม Browser หลังเปิดกลับเข้ามาเห็น cold commit, reload แล้วยัง unread 1, return note อยู่ครบ ไม่มี page error หรือ mobile horizontal overflow รอบ cold เปิด browser หลัง delivery เสร็จ จึงไม่ได้วัด cold push → UI visible latency

หลังเปิด browser พบ public GitHub API rate limit โดยแสดง reset เวลา 15:54:03 และสถานะภายหลังเป็น `Needs attention` ข้อมูลจาก Actions ยังอยู่ครบ ข้อจำกัดนี้กระทบ catch-up แยกจาก authenticated Actions delivery ไม่ถือว่าการกู้รอบที่ติด quota ผ่าน และไม่เพิ่ม GitHub PAT ลง production เพื่อเลี่ยงข้อจำกัดโดยพลการ

ทวน force sync หลังเวลา reset แล้ว HTTP 200 ใน 4.057 วินาที โดย `lastSyncedAt` ขยับจริง สถานะ `Receiving updates`, 103 unique commits คงเดิม, receipt ของ Actions ไม่เปลี่ยน และ unread/return note คงเดิม ([ผลหลัง quota](reports/production/after-quota-sync-result.json))

ตรวจ runtime log เพิ่มพบ internal error สองรายการระหว่างตัวทดสอบเปลี่ยนหน้า/reload ทันที เมื่อทำซ้ำพบรูปแบบเดียวกันแต่ browser ไม่ได้รับ HTTP 500 จากนั้นปรับตัวทดสอบให้รอ project-list และ sync เสร็จก่อน navigation: ทุก API ที่คาดหวังผ่าน, ไม่มี HTTP 500 และไม่มี server error log ใหม่ในช่วงนั้น การยกเลิกคำขอระหว่าง navigation เป็นข้อสันนิษฐานที่สอดคล้องกับผลทดลอง แต่ formatter ปัจจุบันไม่บันทึกชนิด error จึงยืนยันสาเหตุเดิมแน่นอนไม่ได้ ไม่ลบหลักฐานหรือแก้ error handler เพื่อซ่อน log ([ข้อสังเกต log](reports/production/navigation-log-observation.json), [network รอบรอคำขอครบ](reports/production/browser-network-settled-result.json))

หลักฐาน: [idle จริง](reports/production/idle-observations.json), [cold API](reports/production/cold-result.json), [Actions/startup](reports/production/cold-actions-evidence.json), [browser](reports/production/cold-browser-result.json), [quota observation](reports/production/after-cold-quota-observation.json), [desktop](reports/production/after-idle-desktop.png), [mobile](reports/production/after-idle-mobile.png)

### สิ่งที่เพิ่มใน forum repo

| รายการ | สิ่งที่ทำ |
|---|---|
| Workflow | `.github/workflows/unpause-production-verification.yml` |
| Actions secret | `UNPAUSE_PRODUCTION_VERIFY_SECRET` เก็บ credential แยกของ connection ทดสอบ ไม่ใช่ GitHub PAT หรือ database password |
| Actions variable | `UNPAUSE_PRODUCTION_VERIFY_DELIVERY_URL` ชี้ production delivery endpoint |
| Commit ติดตั้ง workflow | [`d5c46f8…`](https://github.com/51N74/panstr-webboard-forum/commit/d5c46f8c14abe1a1a35ef76bf30046baa054fe64) |
| Commit ทดสอบ recovery | [`e3ad686…`](https://github.com/51N74/panstr-webboard-forum/commit/e3ad68642f093f05bee043815f23cffc20797a07) ไม่เปลี่ยนไฟล์ |
| Commit ทดสอบ cold | [`7a5619b…`](https://github.com/51N74/panstr-webboard-forum/commit/7a5619bd180333b343958f1b6e2ae111ea9aa72f) ไม่เปลี่ยนไฟล์ |

ตรวจ compare จาก head เดิมแล้ว ไฟล์ที่เปลี่ยนมีเพียง workflow ใหม่ ไม่แก้ source/config ของ forum ([manifest](reports/production/forum-changes.json)) เก็บ additions ทั้งหมดไว้รอผู้ใช้ตัดสินใจลบ ไม่ลบหรือ rotate integration ที่ติดตั้งใน forum หลังจบการตรวจโดยพลการ

## เกณฑ์หยุดและย้อนกลับ

หยุด release หรือหยุดการทดสอบต่อเมื่อ health/database ไม่ผ่าน, login/การอ่านข้อมูลเดิมล้มเหลว, พบ ownership/secret leak ที่ยังไม่แก้ หรือ sender/catch-up ไม่ทำงานตามขอบเขตที่ทดสอบ แก้สาเหตุแล้วทดสอบซ้ำก่อนสรุปผล

ย้อนโค้ดด้วย Render deploy ที่ผ่านล่าสุดได้ตาม build artifacts ที่ยังเก็บอยู่; rollback ไม่ย้อน schema/data ใน Neon Migration 2 เพิ่มตาราง integration แยกและโค้ดเดิมไม่ใช้ตารางเหล่านี้ จึงคงตารางไว้เมื่อย้อนโค้ดได้ ไม่ใช้ migration `down` ลบข้อมูล integration การย้อนข้อมูลต้องเลือกจากจุดกู้คืนและพิจารณาข้อมูลที่เขียนหลังจุดนั้นก่อน

## หลักฐานและข้อจำกัด

- [Release/CI/configuration evidence](reports/production/release-and-ci.json)
- [Health สุดท้าย HTTP 200, database ok](reports/production/final-health.json)
- [Migration rehearsal](reports/production/migration-rehearsal-result.json)
- [Desktop](reports/production/desktop.png) · [Mobile](reports/production/mobile.png)
- [วิธีตรวจเองและ release ครั้งถัดไป](UNPAUSE_SELF_CHECK_AND_RELEASE_TH.md)
- ประวัติเกิน 100 commits จึงแสดง incomplete history ตามจริง หน้า mobile ยาวแต่ไม่มี document horizontal overflow; ยังไม่ได้ทำ peer usability study หรือ load test
- ระบบปัจจุบันใช้ Render Free ซึ่งพักเมื่อไม่มี traffic จึงมี cold-start delay; ผลการทดสอบนี้ไม่ใช่การรับรอง availability สำหรับระบบที่ต้องพร้อมตลอดเวลา ดู [ข้อจำกัด Free](https://render.com/docs/free) Render อยู่ Oregon และ Neon อยู่ Singapore ซึ่งเพิ่ม network latency; ยังไม่ได้ย้าย region หรือเปลี่ยนแพ็กเกจ
- npm audit / Go vulnerability check อยู่ใน CI ที่ผ่าน ไม่พบ vulnerability ที่กระทบ code/imported Go packages ยังบันทึก unused OpenPGP module-only advisory ไว้ใน [รายงาน dependencies](UNPAUSE_DEPENDENCY_REMEDIATION_TH.md)
- ไม่บังคับตัด network/ฐานข้อมูล production เพื่อทำ chaos test; automatic retry failure cases ตรวจใน sender unit tests ส่วน live ตรวจ idle และ real rerun แยกกัน
- ไม่มี recurring automation ระหว่างงาน
