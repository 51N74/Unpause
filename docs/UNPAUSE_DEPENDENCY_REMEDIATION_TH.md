# ผลแก้ dependencies และการเตรียมทดสอบจริง

วันที่ 4 พฤศจิกายน 2026 · Branch `codex/github-continuity`

## การแก้ไข

อัปเดตเฉพาะ dependencies ที่มี advisory และส่วน compatibility ที่เกี่ยวข้อง ไม่เปลี่ยน domain behavior หรือ schema ของ Scope/Decision/Issue

| ส่วน | เวอร์ชันที่ใช้หลังแก้ | เหตุผล |
|---|---|---|
| Go | 1.27.3 ขั้นต่ำและ Docker builder | แก้ advisory stdlib และทดสอบด้วยเวอร์ชันเดียวกับ deployment |
| pgx/v5 | 5.9.2 | แก้ advisory ของ SQL placeholder parsing และ connection protocol |
| x/crypto | 0.58.0 stable | ปรับ dependency ที่ใช้ Argon2id/bcrypt |
| x/net, x/text, x/sys | 0.62.0, 0.43.0, 0.49.0 | แก้ advisory ของ HTTP/2, HTML/IDNA และ text processing |
| Vitest | 5.1.0 | แก้ advisory ของ mocker/tinypool |
| Vite | 6.4.5 | security patch ภายใน major เดิม |
| React Router DOM | 7.18.5 | แก้ open redirect/hydration advisory โดยคง declarative routes เดิม |
| Zod | 4.6.7 | แก้ validation resource-exhaustion advisory |
| Hook Form resolvers | 7.0.2 | รองรับ Zod 4 |
| follow-redirects, body-parser | 1.16.2, 1.20.9 | security patches ผ่าน lockfile โดยคง Axios/Express major เดิม |
| deepmerge-ts | 8.0.2 | override เพื่อแก้ advisory ใน Prisma config loader |
| Prisma CLI/client | 6.19.3 | คง major และ schema เดิม |

Prisma CLI ย้ายจาก devDependency ของ API workspace มาไว้ root เพื่อให้ npm ใช้ root override ได้จริงเมื่อต้นไม้ dependencies ผ่าน workspace link (พบว่า npm ในเครื่องยังคงเวอร์ชันเก่าเมื่อ CLI อยู่ใน workspace) คำสั่งเดิม `npm --workspace=apps/api run build` ยังเรียก Prisma CLI จาก root ได้ ต้องทดสอบ generate/build และ legacy API ต่อเนื่อง

ปรับ Zod `required_error` เป็น `error`, เปลี่ยน jest-dom setup ให้ใช้ entrypoint `/vitest` และ import `defineConfig` ของ Vitest สำหรับ config test types กำหนด Node ขั้นต่ำ 22.12.0 ตาม Vitest 5 โดยทดสอบในเครื่องด้วย Node 24.14.1

## ผลตรวจช่องโหว่หลังแก้

- `npm audit`: **0 vulnerabilities** รวม dependencies และ devDependencies จาก lockfile ปัจจุบัน [ผล JSON](reports/DEPENDENCY_NPM_AUDIT_AFTER.json)
- `govulncheck` ด้วย Go 1.27.3: **0 vulnerabilities affecting code** และ **0 ใน imported packages** [ผลฉบับเต็ม](reports/DEPENDENCY_GO_AUDIT_AFTER.txt)
- ยังมี module-only advisory **GO-2026-5932** ของ `golang.org/x/crypto/openpgp` ซึ่งระบบไม่ได้ import/เรียกใช้ ระบบใช้ x/crypto สำหรับ Argon2id/bcrypt ไม่ได้ใช้ OpenPGP ไม่ suppress finding นี้ และเลือก stable release แทนการขยับไป pseudo-version ที่ยังไม่ออก stable เพียงเพื่อทำตัวเลขเป็นศูนย์
- ผลสแกนไม่แทนการตรวจ configuration, secrets และช่องโหว่ที่ยังไม่อยู่ในฐานข้อมูล

## การยืนยัน

- Go API tests, React 10 tests และ Node API 19 tests ผ่านหลังอัปเดต
- Production build และ Prisma generate/TypeScript build ผ่าน
- Sender unit tests 4 tests และ workflow YAML validation ผ่าน
- Browser desktop/mobile, Go race detector และ go vet ผ่าน
- Browser smoke หลังอัปเดตวัด request → stored 74 ms และ stored → visible 20,018 ms บน localhost/GitHub stub ไม่ใช่ผลบน Render จริง

## GitHub Actions และ Render/Neon

GitHub เชื่อมต่อบัญชี 51N74 และตรวจสิทธิ์ admin/push ใน 51N74/Unpause แล้ว เตรียม workflow สำหรับ branch นี้และกำลังดำเนินการ push/ตรวจ run จริง

ผู้ใช้เลือก staging แยกจากระบบหลัก แต่ Render/Neon ยังไม่ได้เชื่อมบัญชี จึงยังไม่ได้สร้าง staging หรือวัด cold start จริง ไม่ใช้ผลจำลองแทนผลจริง

Workflow `Continuity verification` pin actions ด้วย SHA จาก repositories ทางการ และใช้ `contents: read` ตรวจ locked install, npm audit, tests, build, Go race/vet/govulncheck, browser test และ production Docker build เก็บ screenshot/ผล browser เป็น artifact 7 วัน

การผ่าน CI บน GitHub Actions เป็นหลักฐานการรันตรวจบน runner จริง แต่ยังไม่ใช่หลักฐานว่า Actions sender ส่งถึง Render/Neon จริง ต้องยืนยัน delivery และ cold-start แยกด้วย endpoint/บัญชีที่เข้าถึงได้

อ้างอิงการ migration: [Vitest 5](https://vitest.dev/guide/migration/), [Zod 4](https://zod.dev/v4/changelog), [React Router compatibility](https://api.reactrouter.com/v7/modules/react-router-dom.html), [Prisma deepmerge-ts advisory discussion](https://github.com/prisma/orm/issues/30052), [npm workspace overrides issue](https://github.com/npm/cli/issues/9659), [OpenPGP advisory](https://pkg.go.dev/vuln/GO-2026-5932)
