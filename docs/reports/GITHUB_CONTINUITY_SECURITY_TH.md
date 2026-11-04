# รายงานตรวจ dependencies — 4 พฤศจิกายน 2026

> ผลในเอกสารนี้เป็น baseline ก่อนแก้ dependencies; ดูผลแก้ไขและการทดสอบล่าสุดใน [รายงาน dependency remediation](../UNPAUSE_DEPENDENCY_REMEDIATION_TH.md)


ตรวจจาก lockfile และ Go module เดิม โดยไม่ได้เปลี่ยนเวอร์ชัน dependencies ในงานนี้ ผลนี้เป็นการคัดกรองจากฐานข้อมูล advisory ไม่ใช่ข้อพิสูจน์ว่าทุกช่องโหว่โจมตีระบบนี้ได้จริง

## npm audit

พบ 12 รายการตามการนับแพ็กเกจของ npm: critical 2, high 6, moderate 4 รวมทั้งเครื่องมือพัฒนาและ Node API ทางเลือกที่ไม่ได้ใช้ใน Docker production

| แพ็กเกจ | ระดับ | ทางแก้ที่ npm เสนอ |
|---|---|---|
| @prisma/config | high | มีเวอร์ชันแก้ไข |
| @vitest/mocker | moderate | อัปเกรด vitest เป็น 5.1.0 (major) |
| body-parser | high | มีเวอร์ชันแก้ไข |
| deepmerge-ts | high | มีเวอร์ชันแก้ไข |
| follow-redirects | high | มีเวอร์ชันแก้ไข |
| prisma | high | มีเวอร์ชันแก้ไข |
| react-router | moderate | อัปเกรด react-router-dom เป็น 7.18.5 (major) |
| react-router-dom | moderate | อัปเกรด react-router-dom เป็น 7.18.5 (major) |
| tinypool | critical | อัปเกรด vitest เป็น 5.1.0 (major) |
| vite | moderate | มีเวอร์ชันแก้ไข |
| vitest | critical | อัปเกรด vitest เป็น 5.1.0 (major) |
| zod | high | อัปเกรด zod เป็น 4.6.7 (major) |

ลิงก์ advisory ที่ registry ส่งกลับ:

- @vitest/mocker: [Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- @vitest/mocker: [Vitest: Code injection via unauthenticated manual mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
- body-parser: [body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body](https://github.com/advisories/GHSA-27r3-jxmh-p828)
- deepmerge-ts: [DeepmergeTS has stack exhaustion when merging recursive object graphs](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- follow-redirects: [follow-redirects: Cross-realm sensitiveHeaders arrays are discarded and custom credentials can follow redirects](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)
- react-router: [React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass)](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)
- react-router: [React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration](https://github.com/advisories/GHSA-337j-9hxr-rhxg)
- tinypool: [Tinypool: Prototype Pollution gadget in worker options leads to Remote Code Execution](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)
- tinypool: [Tinypool: Prototype Pollution Gadget to RCE in run() options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)
- vite: [Vite: `server.fs.deny` bypassed with queries](https://github.com/advisories/GHSA-8g5g-mxqh-grgj)
- zod: [Zod can exhaust memory while validating oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

## Go govulncheck

ใช้ govulncheck v1.9.0, source/symbol scan, Go 1.26.9 ในเครื่อง พบ advisory ไม่ซ้ำ 47 รายการ: มี symbol trace 9, ระดับ package โดยไม่มี symbol trace 14, ระดับ module อย่างเดียว 24

ระดับ symbol หมายถึง scanner พบเส้นทางการเรียก ไม่ได้ยืนยัน exploit; module อย่างเดียวอาจเป็นแพ็กเกจที่ระบบไม่ได้ import เช่น SSH/Windows ต้องตรวจบริบทก่อนจัดลำดับแก้ไข

| Advisory | ระดับสูงสุดที่พบ | รายละเอียด |
|---|---|---|
| [GO-2026-5970](https://pkg.go.dev/vuln/GO-2026-5970) | symbol | Infinite loop on invalid input in golang.org/x/text |
| [GO-2026-6629](https://pkg.go.dev/vuln/GO-2026-6629) | symbol | Panic parsing crafted input in x/text/secure/precis in golang.org/x/text |
| [GO-2026-5024](https://pkg.go.dev/vuln/GO-2026-5024) | module | Invoking integer overflow in NewNTUnicodeString in golang.org/x/sys/windows |
| [GO-2026-4771](https://pkg.go.dev/vuln/GO-2026-4771) | package | CVE-2026-33815 in github.com/jackc/pgx |
| [GO-2026-4772](https://pkg.go.dev/vuln/GO-2026-4772) | package | CVE-2026-33816 in github.com/jackc/pgx |
| [GO-2026-5004](https://pkg.go.dev/vuln/GO-2026-5004) | symbol | SQL Injection via placeholder confusion with dollar quoted string literals in github.com/jackc/pgx |
| [GO-2025-3487](https://pkg.go.dev/vuln/GO-2025-3487) | module | Potential denial of service in golang.org/x/crypto |
| [GO-2025-4116](https://pkg.go.dev/vuln/GO-2025-4116) | module | Potential denial of service in golang.org/x/crypto/ssh/agent |
| [GO-2025-4134](https://pkg.go.dev/vuln/GO-2025-4134) | module | Unbounded memory consumption in golang.org/x/crypto/ssh |
| [GO-2025-4135](https://pkg.go.dev/vuln/GO-2025-4135) | module | Malformed constraint may cause denial of service in golang.org/x/crypto/ssh/agent |
| [GO-2026-5005](https://pkg.go.dev/vuln/GO-2026-5005) | module | Invoking key constraints not enforced in golang.org/x/crypto/ssh/agent |
| [GO-2026-5006](https://pkg.go.dev/vuln/GO-2026-5006) | module | Invoking agent constraints dropped when forwarding keys in golang.org/x/crypto/ssh/agent |
| [GO-2026-5013](https://pkg.go.dev/vuln/GO-2026-5013) | module | Invoking byte arithmetic causes underflow and panic in golang.org/x/crypto/ssh |
| [GO-2026-5014](https://pkg.go.dev/vuln/GO-2026-5014) | module | Invoking bypass of certificate restrictions in golang.org/x/crypto/ssh |
| [GO-2026-5015](https://pkg.go.dev/vuln/GO-2026-5015) | module | Invoking server panic during CheckHostKey/Authenticate in golang.org/x/crypto/ssh |
| [GO-2026-5016](https://pkg.go.dev/vuln/GO-2026-5016) | module | Invoking memory leak when rejecting channels can lead to DoS in golang.org/x/crypto/ssh |
| [GO-2026-5017](https://pkg.go.dev/vuln/GO-2026-5017) | module | Invoking client can cause server deadlock on unexpected responses in golang.org/x/crypto/ssh |
| [GO-2026-5018](https://pkg.go.dev/vuln/GO-2026-5018) | module | Invoking pathological RSA/DSA parameters may cause DoS in golang.org/x/crypto/ssh |
| [GO-2026-5019](https://pkg.go.dev/vuln/GO-2026-5019) | module | Invoking bypass of FIDO/U2F security keys physical interaction in golang.org/x/crypto/ssh |
| [GO-2026-5020](https://pkg.go.dev/vuln/GO-2026-5020) | module | Invoking infinite loop on large channel writes in golang.org/x/crypto/ssh |
| [GO-2026-5021](https://pkg.go.dev/vuln/GO-2026-5021) | module | Invoking auth bypass via unenforced @revoked status in golang.org/x/crypto/ssh/knownhosts |
| [GO-2026-5023](https://pkg.go.dev/vuln/GO-2026-5023) | module | Invoking VerifiedPublicKeyCallback permissions skip enforcement in golang.org/x/crypto/ssh |
| [GO-2026-5033](https://pkg.go.dev/vuln/GO-2026-5033) | module | Invoking pathological inputs can lead to client panic in golang.org/x/crypto/ssh/agent |
| [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) | module | The golang.org/x/crypto/openpgp package is unmaintained, unsafe by design, and has known security issues |
| [GO-2026-6303](https://pkg.go.dev/vuln/GO-2026-6303) | module | Source-address critical option not enforced for non-public-key auth callbacks in golang.org/x/crypto/ssh |
| [GO-2026-6354](https://pkg.go.dev/vuln/GO-2026-6354) | module | Prevent DoS on deadlocked undecided channel in golang.org/x/crypto/ssh |
| [GO-2026-6355](https://pkg.go.dev/vuln/GO-2026-6355) | module | Prevent DoS on deadlocked established channel in golang.org/x/crypto/ssh |
| [GO-2025-3503](https://pkg.go.dev/vuln/GO-2025-3503) | module | HTTP Proxy bypass using IPv6 Zone IDs in golang.org/x/net |
| [GO-2025-3595](https://pkg.go.dev/vuln/GO-2025-3595) | symbol | Incorrect Neutralization of Input During Web Page Generation in x/net in golang.org/x/net |
| [GO-2026-4440](https://pkg.go.dev/vuln/GO-2026-4440) | package | Quadratic parsing complexity in golang.org/x/net/html |
| [GO-2026-4441](https://pkg.go.dev/vuln/GO-2026-4441) | package | Infinite parsing loop in golang.org/x/net |
| [GO-2026-4918](https://pkg.go.dev/vuln/GO-2026-4918) | package | Infinite loop in HTTP/2 transport when given bad SETTINGS_MAX_FRAME_SIZE in net/http/internal/http2 in golang.org/x/net |
| [GO-2026-5025](https://pkg.go.dev/vuln/GO-2026-5025) | package | Invoking incorrect handling of namespaced elements in foreign content in golang.org/x/net/html |
| [GO-2026-5026](https://pkg.go.dev/vuln/GO-2026-5026) | package | Invoking failure to reject ASCII-only Punycode-encoded labels in golang.org/x/net/idna |
| [GO-2026-5027](https://pkg.go.dev/vuln/GO-2026-5027) | package | Invoking incorrect handling of HTML elements in foreign content in golang.org/x/net/html |
| [GO-2026-5028](https://pkg.go.dev/vuln/GO-2026-5028) | package | Invoking denial of service when parsing arbitrary HTML in golang.org/x/net/html |
| [GO-2026-5029](https://pkg.go.dev/vuln/GO-2026-5029) | package | Invoking incorrect handling of character references in DOCTYPE nodes in golang.org/x/net/html |
| [GO-2026-5030](https://pkg.go.dev/vuln/GO-2026-5030) | package | Invoking duplicate attributes can cause XSS in golang.org/x/net/html |
| [GO-2026-5942](https://pkg.go.dev/vuln/GO-2026-5942) | module | Parsing an invalid SVCB or HTTPS RR can panic in golang.org/x/net/dns/dnsmessage |
| [GO-2026-6603](https://pkg.go.dev/vuln/GO-2026-6603) | symbol | HTTP/2 server memory exhaustion due to Trailer headers in net/http |
| [GO-2026-6610](https://pkg.go.dev/vuln/GO-2026-6610) | package | HTTP/2 transport accepts malformed framing-related headers in net/http |
| [GO-2026-6611](https://pkg.go.dev/vuln/GO-2026-6611) | symbol | Excessive CPU consumption from repeated initial window changes in net/http |
| [GO-2026-6612](https://pkg.go.dev/vuln/GO-2026-6612) | symbol | Double flow control refund on HTTP/2 server streams in net/http |
| [GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) | symbol | HTTP/2 server crash due to HPACK encoder race in net/http |
| [GO-2026-6860](https://pkg.go.dev/vuln/GO-2026-6860) | package | Avoid quadratic complexity when coalescing text nodes in html in golang.org/x/net |
| [GO-2026-6866](https://pkg.go.dev/vuln/GO-2026-6866) | package | Check all ancestor namespace transitions when rendering raw text in html in golang.org/x/net |
| [GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809) | symbol | Distrust compromised intermediate certificates in crypto/x509 |

## การตีความและงานแก้ไขต่อ

- ตรวจ pgx (เช่น GO-2026-5004) และ x/text ที่มี symbol trace ก่อน พร้อมอัปเดตภายใน major เดิมและรัน regression tests; อย่าแทน query parameters ด้วย string concatenation
- Frontend ใช้ Axios/follow-redirects, React Router และ Zod จาก dependencies เดิม ควรทบทวน advisory แม้หน้าที่เพิ่มจะใช้ URL ตายตัว, render ข้อความผ่าน React และไม่ใช้ server-side hydration
- Vitest/tinypool และ Vite เกี่ยวกับเครื่องมือพัฒนา/ทดสอบ ห้ามเปิด test/dev server สู่เครือข่ายที่ไม่เชื่อถือ
- ข้อเตือน stdlib อ้างอิง Go 1.26.9 ที่ใช้ตรวจในเครื่อง; Dockerfile เดิมระบุ Go 1.27.3 จึงต้องสแกน image ที่ build จริงแยก ไม่เหมารวมว่า production มีปัญหา stdlib แบบเดียวกัน
- ยังไม่ได้ตรวจ container image, TLS/proxy ของ Render, Neon configuration, repository secret permissions หรือ GitHub account จริง
- ไม่ใช้ `npm audit fix --force` เพราะข้อเสนอหลายรายการข้าม major และอาจกระทบส่วนที่ผู้ใช้ขอให้คงไว้ งานนี้ตรวจและรายงานผล โดยไม่ได้รับรองว่าความเสี่ยงเดิมถูกแก้หมดแล้ว
