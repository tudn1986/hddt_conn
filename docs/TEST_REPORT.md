# Báo cáo kiểm thử HDDT v1.0.0

Ngày kiểm thử: 09/09/2026  
Môi trường: Linux x64, Node.js v24.19.0, pnpm 11.19.0.  
Phạm vi live: không dùng credential GDT; mock, fixture và HTTP contract mock.

## Kết quả cuối

| Hạng mục | Kết quả |
|---|---|
| TypeScript strict (`tsc --noEmit`) | Pass |
| Node script syntax | Pass |
| Test files | 12/12 pass |
| Test cases | 56/56 pass |
| Production server build | Pass |
| Vite production build | Pass, 2.984 modules transformed |
| Web chunk lớn nhất sau code-split | 495,37 kB; gzip 161,19 kB |
| Production smoke | Pass: 2 invoice detail, 4 XML/ZIP downloads |
| Dependency peer check | No peer dependency issues |
| Dependency audit | No known vulnerabilities |
| Secret-pattern scan | Clean |
| Linux x64 SEA build | Pass |
| Linux x64 SEA runtime status + static WebUI | Pass |
| Source ZIP clean extraction + frozen offline install | Pass |
| Windows/macOS portable runtime | Chưa chạy trong Linux; phải chạy target CI |
| GDT live | Chưa chạy vì không có credential được ủy quyền |

## Các vòng chạy

### Baseline audit

Baseline có 2 file/4 test đều pass nhưng typecheck thất bại do dependency/UI/type thiếu; scripts package trỏ tới file không tồn tại. Đây không được coi là release-ready.

### Vòng regression khi mở rộng test

Lần đầu với 56 test: 54 pass, 2 fail. Hai fail đã phát hiện:

1. Nested party name không ưu tiên data detail.
2. Header HTTP `Action` chứa Unicode thô gây lỗi ByteString.

Fix tương ứng:

- ưu tiên nested party field và giữ dynamic party đúng section;
- dùng đúng giá trị `Action` percent-encoded ASCII từ ảnh DevTools.

Sau fix: 12/12 file, 56/56 case pass.

### Ba vòng verify tổng hợp

`pnpm verify` gồm lint/typecheck, test, build server, build WebUI và production smoke.

| Vòng | Test | Build | Smoke |
|---|---:|---|---|
| 1 | 56/56 | Pass | `{"ok":true,"version":"1.0.0","invoices":2,"downloads":4}` |
| 2 | 56/56 | Pass | Cùng kết quả, sau code-split + script checker |
| 3 | 56/56 | Pass | Cùng kết quả, chạy độc lập lần nữa |

Không test nào gọi GDT live, nên kết quả ổn định và không phụ thuộc trạng thái portal.

## Ma trận test

| Nhóm | Nội dung |
|---|---|
| Filename/date | VN timezone, actual calendar, exact pattern, invalid chars, traversal/dot parts |
| Normalizer | `hdhhdvu`, summary+detail merge, status preservation, party nested/dynamic, re-normalization |
| Dynamic/lookup | Array/object containers, unknown fields, dedupe, code+URL, no fabricated URL |
| Schemas/utils | Login/query/date, strict fields, tax code, path containment, formula escape, atomic JSON |
| Live connector contract | Captcha cookie, auth payload, no token leak, Authorization, purchase URL, detail composite keys/Action, export ZIP/XML, sales fail-closed |
| ZIP/XML | Valid package, canonical selection, ambiguous/missing/oversize/HTML/prefix-spoof rejection |
| Settings | Secure defaults, strict patch, sales path allowlist, username-only persistence, corrupt-config quarantine |
| Dataset | Save/list/open/import, raw split/rehydrate, count/key/direction/duplicate, lexical + symlink escape |
| Download | Batch all-or-nothing validation, XML/ZIP, exact names, SHA-256 manifest, skip/corrupt collision, retry, expiry pause/resume, symlink |
| Excel/profile | Loadable workbooks, 5 sheets, identifier text, formula escape, paths/dynamic, direction/required validation |
| Local API security | CSRF, Origin, security headers, malformed JSON sanitization |
| Integration/E2E | Login, cursor pages, purchase/sales mock, detail, dataset, report/profile, bulk XML/ZIP, logout, offline import |
| Detail concurrency | Max worker count, stable order, partial response on session expiry |
| Built artifact smoke | Fastify listen, same-origin API, compiled WebUI, Excel and download files |

Hai symlink cases dùng `it.runIf(process.platform !== 'win32')`; Windows chạy 54 case và dựa trên Windows path/collision integration tương ứng. Linux/macOS chạy đủ 56.

## Dependency audit trail

1. Audit production ban đầu phát hiện một advisory Moderate ở `uuid` gián tiếp qua ExcelJS.
2. Thêm pnpm override `uuid@11.1.1`; production audit sạch.
3. Full audit phát hiện advisory toolchain cũ ở Vitest/Vite/esbuild.
4. Nâng Vitest 5.0.0, Vite 8.2.2, `@vitejs/plugin-react` 6.1.1 và esbuild 0.28.2.
5. `pnpm peers check`: không lỗi.
6. `pnpm audit`: `No known vulnerabilities found`.

## Test chưa thực hiện trong môi trường này

- Đăng nhập và truy vấn GDT thật.
- Live sales vì endpoint chưa được cung cấp/xác minh.
- Import workbook vào AMIS thật vì chưa có template.
- Windows x64 và macOS SEA runtime smoke; packaging script bắt buộc build trên đúng target để tránh artifact giả.

Các mục này là điều kiện QA triển khai, không bị ghi nhận sai là “pass”. Xem `DEPLOYMENT_GUIDE.md`.

## Kiểm tra artifact source

`HDDT-v1.0.0-source.zip` được kiểm tra bằng `unzip -t`, quét entry loại trừ, sau đó giải nén vào một thư mục tạm sạch. Từ chính bản giải nén:

```text
pnpm install --frozen-lockfile --offline   PASS (286 packages từ content-addressable store)
pnpm typecheck                             PASS
pnpm test                                  PASS (12 files, 56 cases)
```

Việc này xác nhận source ZIP có đủ lockfile, config, source và test để tái dựng mà không dựa vào `node_modules` của workspace gốc.
