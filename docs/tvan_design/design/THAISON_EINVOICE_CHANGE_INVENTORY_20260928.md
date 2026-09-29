# Báo cáo kiểm kê thay đổi mã nguồn - THÁI SƠN eInvoice PDF

## 1. Baseline và phương pháp kiểm kê

Baseline của báo cáo là working tree DEV ngay trước phase Thái Sơn, chụp tại:

~~~text
/opt/hddt_conn/dev/scope-backups/thaison-pdf-phase1-20260928-083135
~~~

Baseline này đã bao gồm các thay đổi đang tồn tại của selected-JSON, ACMAN và FAST. Vì vậy báo cáo chỉ ghi phần phát sinh bởi phase Thái Sơn, không gộp thay đổi lịch sử từ HEAD Git.

Audit artifacts:
- source-baseline.sha256: hash source/tests/docs trước phase;
- deploy-protected.sha256: hash package/lock/Docker/compose/tsconfig;
- thaison-phase.patch: patch cô lập baseline -> phase Thái Sơn;
- phase-file-hashes.tsv: SHA-256 trước/sau từng file;
- docker-before.txt và docker-after.txt: inventory container;
- rollback-image.txt: Docker image rollback.

Kết quả scope guard: EXTRA=[]; DELETED=[].

## 2. File runtime hiện hữu đã hiệu chỉnh

| File | Vùng sau triển khai | Thay đổi |
|---|---:|---|
| src/shared/provider-resolution.ts | 13-14, 37-39 | Thêm MST 0101300842/domain einvoice.vn và ánh xạ exact solution provider sang tvan_thaison. |
| src/shared/lookup/index.ts | 15-16, 62-63 | Thêm Mã TC/DC TC theo provider-specific branch; generic lookup provider khác không đổi. |
| src/shared/provider-research.ts | 2, 39, 123-134 | Nâng Thái Sơn thành adapter-backed; hiển thị portal/Mã TC và fallback canonical. |
| src/shared/tvan-catalog/index.ts | 43, 47-48 | Thêm metadata tvan_thaison; nhận diện dc tc/ma tc trong catalog diagnostics. |
| src/server/presentation/manifest.ts | 16 | Register thaison-einvoice-browser-captcha-v1 version 1.0.0. |
| src/server/tvan/registry.ts | 14, 20 | Import và register ThaisonEinvoiceTvanAdapter sau FAST. |
| src/server/tvan/types.ts | 76 | Thêm optional adapter policy challengeSingleUse; provider không khai báo giữ hành vi cũ. |
| src/server/tvan/adapters/fast.ts | 181 | FAST opt-in challengeSingleUse=true; protocol FAST không đổi. |
| src/server/tvan/pdf.service.ts | 319-326, 403-408, 420-423, 751-760 | Thay hard-code FAST bằng generic challengeSingleUse policy ở refresh/expiry/failure/batch cleanup. |
| src/web/components/InvoiceProviderResearchPanel.tsx | 9-42, 101-106, 126-137, 315-323, 540-555, 838-850 | Thêm Thái Sơn vào UI provider/CAPTCHA registry, Mã TC/DC TC, single-use refresh, GIF rendering qua MIME hiện có và input max 8. |

## 3. File runtime mới

### src/server/tvan/adapters/thaison.ts - 362 dòng

Các vùng chính:
- 51-119: nhận diện solution MST, allowlist portal, resolve DC TC/Mã TC và canonical fallback;
- 121-161: filename/private state validation;
- 173-213: adapter identity, capability, cache;
- 215-258: tạo CAPTCHA challenge, thử observed portal rồi fallback canonical;
- 260-325: verify CAPTCHA, lấy PDF, ensurePdf, cache 5 phút;
- 327-342: artifact status;
- 344-359: view/download cache, discard challenge, dispose.

Invariants:
- chỉ matches khi MSTTCGP=0101300842;
- không dùng transport provider để nhận diện;
- không OCR CAPTCHA;
- không persist cookie/token/PDF;
- PDF phải qua ensurePdf.

### src/server/tvan/adapters/thaison-browser.ts - 536 dòng

Các vùng chính:
- 12-94: Chromium executable, shared browser process, context limit;
- 96-118: exact-origin allowlist;
- 128-188: streaming binary fetch có size guard;
- 190-251: POST form-urlencoded MaNhanHoaDon/CaptchaDeText/CaptchaInputText với streaming HTML guard;
- 253-264: validate CAPTCHA GIF/PNG/JPEG signature;
- 270-292: parse/validate same-origin PDF links;
- 339-354: session manager state;
- 356-364: close challenge/document;
- 366-456: bootstrap portal, parse token/image, tạo challenge TTL 5 phút;
- 458-527: POST CAPTCHA và GET PDF trong cùng BrowserContext, finally đóng context;
- 530-535: dispose toàn bộ context còn lại.

Resource guard:
- HDDT_THAISON_MAX_CONTEXTS mặc định 2, clamp 1..6;
- CAPTCHA image tối đa 512 KiB và không vượt network max;
- HTML/PDF stream-limited ngay cả khi upstream thiếu Content-Length.

## 4. Frontend behavior

Không tạo page, modal, CSS hay PDF viewer mới.

Frontend tiếp tục dùng:
- InvoiceProviderResearchPanel;
- /api/presentation/prepare;
- /api/presentation/challenge;
- /api/presentation/view;
- /api/presentation/download;
- viewer/download flow hiện hữu.

Thái Sơn chỉ được thêm metadata lookup/provider và single-use CAPTCHA refresh.

## 5. Test thay đổi

| File | Vùng | Nội dung |
|---|---:|---|
| tests/unit/thaison.test.ts | 1-352, new | 7 test adapter/browser lifecycle. |
| tests/unit/dynamic-lookup.test.ts | 54-69 | Mã TC/DC TC chỉ được ưu tiên khi provider=tvan_thaison. |
| tests/unit/provider-research.test.ts | 44-71 | Thái Sơn adapter-backed và portal dataset được ưu tiên. |
| tests/unit/solution-provider.test.ts | 21 | 0101300842 -> THÁI SƠN. |
| tests/unit/fast.test.ts | không sửa | Được chạy regression để xác nhận FAST giữ behavior. |

Test Thái Sơn bao phủ:
1. exact MST mapping;
2. extraction Mã TC/DC TC và isolation generic lookup;
3. registry resolution;
4. CAPTCHA -> verified PDF cache;
5. seller portal fallback -> canonical einvoice.vn;
6. failed challenge single-use trong TvanPdfService;
7. cùng BrowserContext cho bootstrap/token/POST/PDF và context cap/refresh cleanup.

## 6. Kết quả kiểm thử

Targeted gate:

~~~text
5 test files passed
42 tests passed
TypeScript/lint passed
~~~

Full gate:

~~~text
38 test files passed
233 tests passed
server build passed
Vite build passed
smoke passed
{"ok":true,"version":"1.3.0-rc.2","invoices":2,"streamedDownloads":1,"serverBusinessFiles":0}
~~~

git diff --check: PASS.

## 7. Scope guard / protected files

Không có file ngoài whitelist Thái Sơn thay đổi so với baseline phase.

Các file deployment/core được hash trước và sau, tất cả OK:

~~~text
package.json
pnpm-lock.yaml
Dockerfile
compose.dev.yml
compose.yml
tsconfig.json
tsconfig.server.json
~~~

Không thay đổi:
- GDT connector/ZIP;
- normalizer và dynamic-fields core;
- dataset service/schema/persistence;
- invoice query/incremental sync/relations;
- auth/session business logic;
- financial calculation;
- App.tsx / InvoicePage.tsx;
- adapter provider khác ngoài 1 policy flag ở fast.ts;
- Docker/compose/package dependency.

## 8. Browser smoke với portal thật

Trước recreate DEV, chính image mới được chạy browser smoke:

~~~text
portal=https://einvoice.vn/tra-cuu
result=OK
CAPTCHA MIME=image/gif
CAPTCHA bytes=1237
TTL=300000 ms
~~~

Smoke chỉ GET trang tra cứu và ảnh CAPTCHA. Không OCR, không giải CAPTCHA, không POST CAPTCHA giả vào hóa đơn thực tế.

## 9. Deployment DEV

Rollback image:

~~~text
hddt_conn:dev-pre-thaison-20260928-084514
~~~

Image mới:

~~~text
sha256:c101e80c9f71582967e4e70940f94c653a6d047f8b31930f878281d3a5a40fbe
~~~

Container sau deploy:

~~~text
name=hddt_conn_dev
container=2eb57082f6e0
image=hddt_conn:dev
port=8288 -> 3210
health=healthy
version=1.3.0-rc.2
memory≈100 MiB / 1 GiB
~~~

Health API:

~~~json
{"ok":true,"version":"1.3.0-rc.2"}
~~~

Presentation adapters API đã trả:

~~~text
providerFamily=thaison
adapterId=thaison-einvoice-browser-captcha-v1
adapterVersion=1.0.0
providerCode=tvan_thaison
displayName=THÁI SƠN eInvoice
~~~

Chromium runtime:

~~~text
Chromium 153.0.8010.52
~~~

Frontend bundle có cả marker THÁI SƠN và Mã TC.

So sánh docker-before/docker-after sau khi loại hddt_conn_dev: OTHER_CONTAINERS_UNCHANGED=OK.

## 10. Trạng thái E2E

Đã chứng minh:
- nhận diện adapter;
- lookup Mã TC/DC TC;
- bootstrap browser thật;
- lấy CAPTCHA GIF thật từ portal;
- lifecycle, resource limit, PDF validation bằng test;
- deployment/API/UI bundle trên DEV.

Chưa tuyên bố E2E PDF thật hoàn tất vì chưa có bước người dùng nhập CAPTCHA thật sau deploy.

E2E cuối cần thực hiện trên một hóa đơn Thái Sơn thực tế:

~~~text
Mở hóa đơn -> Xem bản thể hiện
-> Lấy CAPTCHA
-> người dùng nhập đúng CAPTCHA
-> POST /tra-cuu thành công
-> GET PDF same-session
-> Xem PDF
-> Tải PDF
~~~

Chỉ sau bước này mới xác nhận contract portal end-to-end với dữ liệu thật.

## 11. Audit files

~~~text
/opt/hddt_conn/dev/scope-backups/thaison-pdf-phase1-20260928-083135/
  source-baseline.sha256
  deploy-protected.sha256
  git-status-baseline.txt
  git-diff-baseline.patch
  git-diff-staged-baseline.patch
  untracked-baseline.txt
  phase-file-hashes.tsv
  thaison-phase.patch
  rollback-image.txt
  new-image-id.txt
  presentation-adapters.json
  docker-before.txt
  docker-after.txt
~~~

## 12. Hotfix CAPTCHA từ HAR 2einvoice.vn.har

### Nguyên nhân

Source phase 1 dùng browserFetchBinary() để gọi lại URL /DefaultCaptcha/Generate?... sau khi trang /tra-cuu đã load.

HAR mới cho thấy CAPTCHA đúng được tải như tài nguyên ảnh tự nhiên:

~~~text
Sec-Fetch-Dest: image
Sec-Fetch-Mode: no-cors
Referer: https://einvoice.vn/tra-cuu
~~~

Chromium live xác minh cùng token:

~~~text
natural image response : GIF ~3906 bytes
fetch() same URL       : GIF 1237 bytes
same=false
~~~

GIF 1,237 bytes chính là ảnh đen có dấu X đỏ đã xuất hiện trên UI. Portal vẫn trả HTTP 200 + image/gif nên validator signature ban đầu không phát hiện.

Trang còn có 3 phần tử CaptchaImage; selector global có thể ghép nhầm token/ảnh giữa các form.

### File runtime sửa

src/server/tvan/adapters/thaison-browser.ts:
- selector CAPTCHA được scope vào form chứa input MaNhanHoaDon;
- chờ ảnh tự nhiên hoàn tất bằng page.waitForFunction;
- bỏ request fetch() thứ hai tới CAPTCHA;
- dùng canvas đọc pixel của ảnh đã load và encode PNG;
- vẫn kiểm tra exact-origin, PNG signature và max bytes;
- PDF fetch/streaming guard giữ nguyên.

Không sửa protocol FAST, provider khác, frontend, GDT, dataset, Docker/compose/package.

### Test sửa

tests/unit/thaison.test.ts:
- fake browser hỗ trợ waitForFunction;
- CAPTCHA browser flow trả rendered PNG;
- assert không có lần page.evaluate nào refetch CAPTCHA bằng request Accept: image/*;
- lifecycle/context cap và PDF same-session tests giữ nguyên.

### Kết quả

~~~text
TypeScript/lint: PASS
Thái Sơn + FAST: 2 files / 16 tests PASS
Full verify: 38 files / 233 tests PASS
Build + smoke: PASS
~~~

Browser smoke image trước deploy:

~~~text
mime=image/png
imageBytes=10513
sentinelAvoided=true
TTL=300000 ms
~~~

Post-deploy smoke trong hddt_conn_dev:

~~~text
mime=image/png
imageBytes=10643
sentinelAvoided=true
Chromium before=0
Chromium after=0
~~~

Hotfix image:

~~~text
sha256:096e578051272ed0da5b156c472ca9621a6318b8f4efff15605b63e1c2a35779
~~~

Rollback image:

~~~text
hddt_conn:dev-pre-thaison-captcha-hotfix-20260928-091937
~~~

Audit hotfix:

~~~text
/opt/hddt_conn/dev/scope-backups/thaison-captcha-hotfix-20260928-091628
~~~
