# Thiết kế và triển khai xem/tải PDF THÁI SƠN eInvoice

## 1. Mục tiêu và baseline

Tính năng bổ sung khả năng **Xem PDF** và **Tải PDF** cho hóa đơn có nhà cung cấp giải pháp HĐĐT THÁI SƠN, nhưng vẫn đi qua presentation pipeline hiện hữu của hddt_conn.

Baseline kỹ thuật là working tree DEV tại thời điểm 2026-09-28 trước khi sửa Thái Sơn. Working tree đã có các phase selected-JSON, ACMAN và FAST; các thay đổi đó được coi là baseline và không được hoàn nguyên hay chỉnh ngoài phạm vi ghi trong tài liệu này.

Nguồn bằng chứng:
- HDDT_PURCHASE_SELECTED_20240101_20260925_13HD_20260928T022713015Z.json
- 1einvoice.vn.har
- Thaison_report.md
- source DEV hiện hành

## 2. Nhận diện và lookup

Nhà cung cấp giải pháp được nhận diện **chỉ** theo:

~~~text
MSTTCGP = 0101300842
providerCode = tvan_thaison
canonical domain = einvoice.vn
~~~

Không dùng tvandnkntt, ngcnhat hoặc legacy providerCode để cưỡng bức nhận diện solution provider.

Dữ liệu lookup trong TTKhac:

~~~text
TTruong = "Mã TC"  -> MaNhanHoaDon
TTruong = "DC TC"  -> portal tra cứu
~~~

Mã TC được xử lý provider-specific để không thay priority lookup của provider khác.

## 3. Portal selection và SSRF guard

Thứ tự portal:

~~~text
1. DC TC của hóa đơn nếu URL thuộc allowlist Thái Sơn
2. https://einvoice.vn/tra-cuu
~~~

Allowlist phase 1 gồm exact einvoice.vn, www.einvoice.vn và subdomain một cấp *.einvoice.com.vn. Chỉ path /tra-cuu được dùng để bootstrap. Seller-specific portal không tương thích sẽ fallback về canonical portal.

Mọi request trong BrowserContext chỉ được phép tới **đúng origin của challenge hiện tại**; data:, blob: và about: được phép cho browser internals. Không có allow-all network policy.

## 4. Browser-backed challenge

File src/server/tvan/adapters/thaison-browser.ts quản lý Chromium, BrowserContext và Page.

Một challenge gồm documentKey, lookupCode/Mã TC, portalUrl, CaptchaDeText, BrowserContext riêng, Page riêng và expiresAt.

Một Chromium process được chia sẻ trong module Thái Sơn; mỗi CAPTCHA có BrowserContext riêng. Số context mặc định là 2, có thể override bằng HDDT_THAISON_MAX_CONTEXTS, clamp 1..6.

Chromium executable tái sử dụng HDDT_CHROMIUM_EXECUTABLE và runtime Chromium đã có từ deployment FAST; không thêm package/dependency/Docker layer.

## 5. Luồng lấy CAPTCHA

~~~text
GET <portal>/tra-cuu
    -> HTML có #CaptchaDeText và #CaptchaImage
    -> GET ảnh CAPTCHA trong cùng BrowserContext
    -> validate GIF/PNG/JPEG signature + size guard
    -> TvanCaptchaChallenge -> frontend
~~~

Dữ liệu live hiện tại của einvoice.vn trả CAPTCHA GIF. Code không hard-code chỉ PNG.

Challenge TTL là 5 phút. Ứng dụng không OCR, không tự giải CAPTCHA; người dùng nhập CAPTCHA trong card hiện hữu của InvoiceProviderResearchPanel.

## 6. Luồng xác thực và lấy PDF

Trong cùng BrowserContext:

~~~text
POST <portal>/tra-cuu
Content-Type: application/x-www-form-urlencoded

MaNhanHoaDon=<Mã TC>
CaptchaDeText=<hidden token>
CaptchaInputText=<user input>
~~~

Cookie ASP.NET/session/server affinity do Chromium quản lý.

HTML success chỉ được parse để tìm link PDF same-origin thuộc một trong hai route đã quan sát:

~~~text
/tra-cuu/xem-hoa-don?code=<Mã TC>
/tra-cuu/tai-hoa-don-dien-tu?format=pdf
~~~

Ưu tiên xem-hoa-don vì HAR thực tế đã ghi nhận route này trả application/pdf. Link có code khác Mã TC hiện tại bị loại bỏ.

Browser GET PDF trong **cùng BrowserContext**. Response phải HTTP 2xx, không vượt network.maxDownloadBytes, qua ensurePdf() và filename phải qua safePdfFileName().

Cả HTML và binary response đều được đọc theo streaming size limit; không đọc response không giới hạn khi upstream thiếu Content-Length.

## 7. Single-use CAPTCHA và lifecycle

THÁI SƠN và FAST khai báo challengeSingleUse=true. TvanPdfService không còn hard-code FAST ở các điểm cleanup/reissue; provider không khai báo policy này giữ nguyên retry behavior cũ.

Với Thái Sơn:
- refresh challenge đóng context cũ;
- CAPTCHA sai đóng context, challenge không reuse;
- CAPTCHA đúng lấy PDF rồi đóng context;
- TTL tự đóng;
- batch delete đóng;
- service dispose đóng mọi context còn lại.

## 8. PDF cache và API chung

PDF verified được cache RAM theo document.key trong 5 phút.

presentation/view và presentation/download dùng lại PDF cache này; frontend không gọi trực tiếp einvoice.vn.

CAPTCHA token, cookie, BrowserContext và PDF bytes không được ghi vào dataset.

## 9. UI

Không tạo page/modal/CSS/viewer riêng.

InvoiceProviderResearchPanel chỉ bổ sung:
- provider name THÁI SƠN;
- adapter code tvan_thaison;
- lookup names Mã TC/Ma TC/MA TC;
- URL names DC TC/ĐC TC/Dia chi TC;
- CAPTCHA provider set;
- single-use refresh behavior;
- input CAPTCHA tối đa 8 ký tự.

Nút Xem PDF, Tải PDF, CAPTCHA card và viewer hiện hữu được tái sử dụng.

## 10. Error codes

~~~text
TVAN_THAISON_BROWSER_UNAVAILABLE
TVAN_THAISON_BROWSER_BUSY
TVAN_THAISON_PORTAL_INVALID
TVAN_THAISON_BROWSER_BOOTSTRAP_FAILED
TVAN_THAISON_CAPTCHA_MARKUP_CHANGED
TVAN_THAISON_CAPTCHA_IMAGE_INVALID
TVAN_THAISON_CAPTCHA_HTTP_ERROR
TVAN_THAISON_CHALLENGE_MISMATCH
TVAN_THAISON_SESSION_EXPIRED
TVAN_THAISON_CAPTCHA_INVALID
TVAN_THAISON_LOOKUP_MISSING
TVAN_THAISON_LOOKUP_MISMATCH
TVAN_THAISON_PDF_HTTP_ERROR
TVAN_THAISON_PDF_INVALID
TVAN_THAISON_CAPTCHA_REQUIRED
~~~

## 11. Runtime source scope

~~~text
src/shared/provider-resolution.ts
src/shared/lookup/index.ts
src/shared/provider-research.ts
src/shared/tvan-catalog/index.ts
src/server/presentation/manifest.ts
src/server/tvan/registry.ts
src/server/tvan/types.ts
src/server/tvan/pdf.service.ts
src/server/tvan/adapters/fast.ts                  # chỉ policy flag, protocol FAST không đổi
src/server/tvan/adapters/thaison.ts               # new
src/server/tvan/adapters/thaison-browser.ts       # new
src/web/components/InvoiceProviderResearchPanel.tsx
~~~

## 12. Test scope

~~~text
tests/unit/thaison.test.ts                        # new
tests/unit/dynamic-lookup.test.ts
tests/unit/provider-research.test.ts
tests/unit/solution-provider.test.ts
tests/unit/fast.test.ts                           # regression
~~~

## 13. Protected scope

Phase Thái Sơn không được sửa GDT connector, normalizer/dynamic-fields core, invoice query/sync/relation, auth/session business logic, dataset service/schema, financial calculation, App.tsx, InvoicePage.tsx, adapter NCC khác, package.json, pnpm-lock.yaml, Dockerfile hoặc compose files.

Không migration DB, không thêm field CAPTCHA/browser vào dataset và không OCR CAPTCHA.

## 14. Release gate

1. git diff --check.
2. TypeScript/lint.
3. Targeted tests Thái Sơn + FAST + lookup/research/provider mapping.
4. Full pnpm run verify.
5. Hash guard protected scope.
6. Docker rollback image.
7. Browser smoke lấy CAPTCHA thật từ einvoice.vn nhưng không giải CAPTCHA.
8. Recreate duy nhất hddt_conn_dev.
9. Health check port 8288.
10. Browser smoke trong container Compose và kiểm tra cleanup context/process.

E2E PDF chỉ được tuyên bố hoàn tất khi người dùng nhập CAPTCHA thật cho một hóa đơn Thái Sơn thực tế và chuỗi hddt_conn -> POST tra-cuu -> PDF -> viewer/download thành công.

## 15. Hotfix CAPTCHA theo HAR 2einvoice.vn.har

Sau deployment phase 1, ảnh CAPTCHA hiển thị thành GIF nền đen có dấu X đỏ. HAR mới và Chromium live xác định đây không phải lỗi render frontend mà là sentinel GIF do portal trả khi endpoint CAPTCHA bị gọi lại bằng fetch/XHR semantics.

Bằng chứng:
- request CAPTCHA hợp lệ của portal là request ảnh tự nhiên với Sec-Fetch-Dest: image và Sec-Fetch-Mode: no-cors;
- response ảnh hợp lệ trong HAR có kích thước khoảng 3.6-3.9 KiB;
- cùng token, request ảnh tự nhiên trong Chromium trả GIF khoảng 3.9 KiB;
- nếu gọi lại chính URL CAPTCHA bằng fetch(), portal trả GIF 1,237 bytes, nền đen và dấu X đỏ;
- trang có 3 phần tử trùng id CaptchaImage, do đó selector global cũng không an toàn.

Hotfix:
1. xác định đúng form chứa input MaNhanHoaDon;
2. trong cùng form lấy CaptchaDeText và CaptchaImage;
3. chờ ảnh tự nhiên load hoàn tất;
4. không fetch lại URL CAPTCHA;
5. vẽ chính ảnh đã load lên canvas trong browser và xuất PNG base64;
6. kiểm tra same-origin URL, PNG signature và size limit;
7. trả PNG này về UI qua TvanCaptchaChallenge.

Cách này giữ nguyên BrowserContext/session/token của portal và không tạo thêm CAPTCHA request có semantics khác.

Release evidence hotfix:
- targeted Thái Sơn + FAST: 16/16 tests PASS;
- full verify: 38 test files / 233 tests PASS;
- pre-deploy image smoke: PNG 10,513 bytes, sentinelAvoided=true;
- post-deploy container smoke: PNG 10,643 bytes, sentinelAvoided=true;
- Chromium process trước/sau smoke: 0 -> 0;
- chỉ hddt_conn_dev được recreate.
