# Security audit — HDDT v1.0.0

Ngày audit: 09/09/2026. Phạm vi: source TypeScript/React, local API, connector GDT, file IO, export, dependencies và packaging script.

## Kết luận

Không còn finding Critical/High/Moderate đã biết trong dependency tree tại lần chạy `pnpm audit` cuối. Các boundary nhạy cảm có validation và test hồi quy. Release vẫn có rủi ro vận hành được nêu ở cuối tài liệu, đặc biệt vì chưa live-test GDT và endpoint bán ra chưa được xác minh.

## Finding đã sửa

| Mức | Finding ban đầu | Khắc phục |
|---|---|---|
| Critical | Token đăng nhập có thể đi qua result/public API ở baseline | Public `LoginResult` chỉ có success/message; token/cookie private trong connector RAM; integration test quét response. |
| High | Captcha/login baseline dùng endpoint sai và không giữ đúng cookie lifecycle | Dùng contract đã quan sát; cookie Captcha giữ tới login; contract test. |
| High | Mock ZIP không phải ZIP thật; XML download không trích package an toàn | yauzl/yazl, magic/schema/entry/size validation và ambiguity rejection. |
| High | Dataset open/path có nguy cơ traversal/symlink escape | Tax-code allowlist, lexical + realpath containment, extension/size/schema checks. |
| High | Download file có thể partial/ghi đè mất dữ liệu | Batch prevalidation, `.part`, fsync, link/rename, backup recovery, no suffix collision. |
| High | Không có CSRF/origin boundary cho local mutations | Random CSRF token, same-origin client, loopback Origin allowlist, no broad CORS. |
| Moderate | Excel formula injection | Escape text bắt đầu bằng whitespace/control + `=`, `+`, `-`, `@`; test workbook. |
| Moderate | Filename/date không chặt | Actual calendar validation, VN timezone, invalid-char stripping, dot-only rejection. |
| Moderate | Error có thể lộ stack/internal message | Central sanitized error response; detailed error chỉ trong local log. |
| Moderate | Cookie Captcha bị xóa ngay trước login | Chỉ reset token/username, giữ cookie jar của challenge. |
| Moderate | Manifest có thể ghi sang MST mới sau logout/relogin | Manifest gắn với thư mục target của task, không phụ thuộc session hiện tại. |
| Moderate | Advisory `uuid` qua ExcelJS | Pnpm override `uuid@11.1.1`. |
| Critical/High/Moderate (dev) | Vitest/Vite/esbuild cũ có advisory | Nâng Vitest 5, Vite 8, plugin React 6, esbuild 0.28; audit lại sạch. |

## Kiểm soát hiện có

### Session và bí mật

- Password/Captcha chỉ xuất hiện trong request memory; form xóa password sau login attempt.
- Token và cookie là private state của `LiveGdtConnector`.
- Pino redact Authorization, Cookie, password, captcha và token paths.
- `accounts.json` chỉ lưu username, `rememberPassword:false`, `passwordStorage:none`.
- Logout, connector change, shutdown và app close đều clear phiên.
- Login thất bại giới hạn 10 lần/phút cho local instance.

### Network

- Bind `127.0.0.1`; không bind `0.0.0.0`.
- Không đăng ký permissive CORS.
- Live origin khóa cứng host GDT HTTPS.
- Redirect `manual`, timeout, response/download size limit.
- Endpoint cấu hình phải là relative `/api/...`.
- Security headers: CSP production, frame deny, no-sniff, referrer and permissions policy.

### Dữ liệu/file

- File cấu hình, account, dataset và manifest dùng atomic write + fsync, mặc định mode `0600` trên POSIX.
- `dataRoot/<MST>` dùng MST allowlist.
- Dataset có format/schema version, count/key/direction consistency và duplicate detection.
- File JSON được mở qua realpath containment; symlink thoát root bị từ chối.
- Download target do ứng dụng tạo, không lấy filename response từ portal.
- Existing symlink/corrupt collision bị fail, không silently skip.
- ZIP defense chặn traversal, Windows path, encrypted/symlink entry, entry count và uncompressed size.

### Export

- Identifier columns được format text.
- Untrusted text được formula-escape.
- Excel row limit được kiểm tra trước khi tạo workbook.
- Profile bắt buộc direction/type/required validation.

## Dữ liệu nhạy cảm trong input audit

Ảnh DevTools do người dùng cung cấp hiển thị một Bearer token và nhiều Cookie phiên thật. Release này không sao chép ảnh hoặc giá trị đó vào source, fixture, report hay ZIP. Chủ tài khoản nên logout/revoke phiên đã chụp và coi token/cookies trong ảnh là đã lộ.

## Rủi ro tồn dư

| Rủi ro | Mức | Giảm thiểu/điều kiện phát hành |
|---|---|---|
| API GDT không chính thức có thể đổi | Trung bình | Connector cô lập, fail-closed, contract fixture; live smoke trước rollout. |
| Chưa live-test bằng tài khoản thật | Trung bình | QA có thẩm quyền phải chạy checklist live trong Deployment Guide. |
| Endpoint bán ra chưa xác minh | Trung bình | Capability false mặc định; chỉ cấu hình sau capture/test. |
| AMIS chưa có template chính thức | Thấp về bảo mật, cao về tương thích | Gắn nhãn mapping nền; không tuyên bố import-ready. |
| Local process cùng user có thể đọc RAM/file user được phép | Trung bình | OS account isolation, disk encryption, không chạy trên máy dùng chung. |
| Portable nội bộ chưa có publisher certificate/notarization production | Trung bình | Ký Authenticode/Developer ID trong release pipeline chính thức. |
| GDT response có dữ liệu cá nhân/kinh doanh | Trung bình | `dataRoot` mã hóa, quyền tối thiểu, backup/chia sẻ theo chính sách. |

## Lệnh tái kiểm tra

```bash
pnpm install --frozen-lockfile
pnpm audit
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

Ngoài ra chạy secret scan trước mỗi release và xác minh ZIP không chứa `.env`, HAR, screenshot, app-data, dataset thật, log, `node_modules` hoặc release tạm.
