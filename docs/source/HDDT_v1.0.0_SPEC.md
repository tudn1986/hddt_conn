# HDDT_v1.0.0 — Đặc tả sản phẩm, kiến trúc và triển khai

**Tên hệ thống:** HDDT  
**Phiên bản:** 1.0.0  
**Trạng thái tài liệu:** Thiết kế cơ sở để triển khai  
**Định hướng:** WebUI chạy cục bộ, không sử dụng cơ sở dữ liệu, lưu dữ liệu nghiệp vụ dạng JSON/file, hỗ trợ tải XML/ZIP và kết xuất Excel.  
**Nền tảng mục tiêu:** Windows, macOS; có thể mở rộng Linux.  
**Nguồn dữ liệu:** Cổng Hóa đơn điện tử `hoadondientu.gdt.gov.vn` và dữ liệu JSON trả về từ API của hệ thống.

---

## 1. Mục tiêu phiên bản 1.0.0

HDDT_v1.0.0 là công cụ WebUI chạy trên máy người dùng, dùng để:

1. Đăng nhập Cổng HĐĐT bằng tài khoản/MST, mật khẩu và Captcha do người dùng nhập.
2. Tra cứu hóa đơn/chứng từ mua vào và bán ra từ hệ thống HĐĐT.
3. Lấy dữ liệu danh sách và dữ liệu chi tiết hàng hóa/dịch vụ trực tiếp từ API JSON của hệ thống.
4. Hiển thị dữ liệu, tổng hợp và báo cáo ngay trên giao diện web cục bộ.
5. Lưu dữ liệu đã tải thành file JSON để mở lại và sử dụng sau mà không cần truy cập lại Cổng HĐĐT.
6. Kết xuất dữ liệu ra Excel phục vụ kiểm tra, báo cáo và xử lý kế toán.
7. Tải file XML và ZIP của hóa đơn/chứng từ về máy người dùng.
8. Chuẩn bị nền tảng xuất file Excel theo mẫu import của phần mềm kế toán, trước mắt là MISA AMIS; mapping cụ thể sẽ hoàn thiện khi có file mẫu chính thức.

### 1.1. Ba nhóm tính năng chính

**Nhóm A — Tra cứu, tải dữ liệu và báo cáo**
- Mua vào.
- Bán ra.
- Hóa đơn GTGT.
- Hóa đơn bán hàng.
- Phiếu xuất kho kiêm vận chuyển nội bộ và các loại chứng từ khác hệ thống trả về.
- Dữ liệu header.
- Thông tin người bán/người mua.
- Tổng tiền, thuế, tỷ giá, tiền tệ.
- Chi tiết hàng hóa/dịch vụ.
- Trường mở rộng/dynamic fields.
- Mã/link tra cứu theo TVAN/HĐĐT khi có.
- Báo cáo trực tiếp trên WebUI.
- Lưu/mở dataset JSON.
- Xuất Excel.

**Nhóm B — Tải file gốc**
- Tải XML.
- Tải ZIP khi endpoint của hệ thống hỗ trợ.
- Tải một hóa đơn hoặc tải hàng loạt.
- Có hàng đợi, tiến độ, retry, pause/resume trong phiên chạy.
- Tất cả XML/ZIP được lưu trực tiếp trong thư mục của MST đăng nhập, không tạo cây thư mục năm/tháng/mua/bán.

**Nhóm C — Kết xuất kế toán**
- Engine mapping dữ liệu normalized sang cột Excel đích.
- Template báo cáo thông thường.
- Template import kế toán.
- MISA AMIS là profile đầu tiên; chi tiết profile được hoàn thiện sau khi nhận file Excel mẫu.
- Thiết kế cho phép bổ sung MISA SME, FAST, Bravo, ERP nội bộ... mà không sửa core dữ liệu.

---

## 2. Quyết định kiến trúc cốt lõi

### 2.1. Không dùng database trong v1.0.0

Phiên bản 1.0.0 không dùng SQLite/PostgreSQL/MySQL hay database nhúng.

Lý do:
- Dữ liệu chủ yếu được lấy theo từng lần tra cứu.
- Người dùng cần mở lại, xuất Excel hoặc lưu file chứng từ, không cần truy vấn lịch sử phức tạp ở quy mô rất lớn.
- Giảm phụ thuộc, giảm migration, giảm rủi ro lock/corrupt DB.
- Dễ đóng gói và triển khai trên Windows/macOS.
- Dễ backup: chỉ cần sao chép thư mục dữ liệu.
- Dữ liệu API gốc có thể giữ nguyên trong JSON để re-normalize về sau.

Database chỉ xem xét lại ở phiên bản tương lai khi có nhu cầu như:
- hàng trăm nghìn hóa đơn nhiều năm;
- tìm kiếm xuyên toàn bộ lịch sử trong thời gian thực;
- đồng bộ tự động định kỳ;
- nhiều người dùng/RBAC;
- audit trail lâu dài;
- đối chiếu ERP liên tục.

### 2.2. WebUI chạy cục bộ

HDDT_v1.0.0 là **local WebUI**, không phải website cloud.

Kiến trúc:

```text
Trình duyệt của người dùng
        │
        │ http://127.0.0.1:<port>
        ▼
HDDT Local Server
        │
        ├── Auth/Session với GDT
        ├── Query/List API
        ├── Detail API
        ├── Download XML/ZIP
        ├── Normalize dữ liệu
        ├── JSON File Store
        ├── Excel Export
        └── Settings/Credential Service
        │
        ▼
hoadondientu.gdt.gov.vn
```

Ưu điểm:
- Một giao diện web dùng chung cho Windows/macOS/Linux.
- Không cần Electron ở v1.0.0.
- Không phải cài web server riêng.
- Trình duyệt chỉ giao tiếp với `127.0.0.1`.
- Token/Cookie GDT được giữ ở local server, không cần đưa ra JavaScript phía trình duyệt.

### 2.3. API-first, XML là chứng từ gốc chứ không phải nguồn dữ liệu bắt buộc

Dữ liệu đã quan sát cho thấy API detail trả `hdhhdvu[]`, gồm chi tiết từng dòng hàng hóa/dịch vụ, do đó luồng chính là:

```text
Query/List API
    ↓
Detail API
    ↓
Normalizer
    ↓
WebUI / JSON / Excel / AMIS
```

XML/ZIP chạy song song như nguồn chứng từ gốc:

```text
GDT File API
    ↓
XML / ZIP
    ↓
<MST đăng nhập>/
```

Không cần parse XML để tạo invoice line trong luồng chính của v1.0.0.

---

## 3. Nền tảng công nghệ đề xuất

### 3.1. Backend/local server

- Node.js 22 LTS hoặc phiên bản LTS tương đương tại thời điểm phát hành.
- TypeScript strict mode.
- Fastify.
- Native `fetch`/Undici cho HTTP client.
- Zod cho validation.
- Pino cho log kỹ thuật.
- ExcelJS cho Excel.
- Không Playwright trong core v1 nếu đăng nhập/API hoạt động ổn định bằng HTTP trực tiếp.

### 3.2. Frontend

- React.
- TypeScript.
- Vite.
- Ant Design hoặc bộ component tương đương có DataGrid/Table tốt.
- Virtual scrolling cho bảng nhiều dòng.

### 3.3. Lý do không dùng Electron ở v1

- WebUI đã đáp ứng đa nền tảng.
- Electron tăng kích thước gói và RAM.
- Tách desktop app sang giai đoạn sau giúp v1 nhẹ hơn.
- Kiến trúc local server hiện tại có thể tái sử dụng khi về sau bọc bằng Electron/Tauri nếu cần.

---

## 4. Đóng gói và cách chạy

### 4.1. Mục tiêu trải nghiệm triển khai

Người dùng không cần:
- cài Node.js;
- cài pnpm/npm;
- cài Python;
- cài database;
- chạy migration;
- mở nhiều terminal;
- cấu hình thủ công port thông thường.

Mục tiêu sử dụng:

**Windows**
1. Tải `HDDT_v1.0.0_windows_x64.zip`.
2. Giải nén.
3. Double-click `Start-HDDT.exe` hoặc `Start-HDDT.cmd`.
4. Trình duyệt tự mở WebUI.

**macOS**
1. Tải `HDDT_v1.0.0_macos_arm64.zip` hoặc bản Intel.
2. Giải nén.
3. Double-click `Start HDDT.command` hoặc chạy binary đã ký/notarize nếu có.
4. Trình duyệt mặc định tự mở.

### 4.2. Cách đóng gói đề xuất

Ưu tiên Node Single Executable Application (SEA) hoặc giải pháp đóng gói runtime tương đương.

Gói phát hành:

```text
HDDT_v1.0.0/
├── hddt-server(.exe)
├── Start-HDDT.cmd                 # Windows
├── Start HDDT.command             # macOS
├── public/                        # React build
├── README_FIRST.txt
├── LICENSE.txt
└── VERSION
```

Không yêu cầu người dùng cài Node.

Nếu SEA gây hạn chế ở một nền tảng, fallback là đóng gói runtime Node cùng app trong thư mục portable; trải nghiệm chạy vẫn phải là một launcher duy nhất.

### 4.3. Khởi động ứng dụng

Local server:
- mặc định bind `127.0.0.1`, không bind `0.0.0.0`;
- thử port cấu hình, ví dụ 3210;
- nếu bận, tự chọn port khả dụng;
- ghi runtime port vào file tạm;
- tự mở trình duyệt đến URL đang chạy.

Ví dụ:

```text
http://127.0.0.1:3210
```

### 4.4. Một instance

Khi người dùng chạy lần hai:
- kiểm tra instance hiện tại;
- nếu server đang chạy thì chỉ mở lại trình duyệt vào instance đang có;
- không khởi động server thứ hai.

### 4.5. Thoát

WebUI có menu **Thoát HDDT**:
- cảnh báo nếu đang tải file/đang lấy detail;
- hủy hoặc chờ task theo lựa chọn người dùng;
- logout session nếu thích hợp;
- đóng local server.

Có thể đóng bằng `Ctrl+C` từ terminal/console khi dùng launcher dạng console.

---

## 5. Cấu trúc lưu trữ cục bộ

### 5.1. Thư mục cấu hình ứng dụng

Không trộn cấu hình với dữ liệu hóa đơn.

Ví dụ:

**Windows**
```text
%APPDATA%\HDDT\
├── config.json
├── accounts.json
├── logs/
└── runtime.json
```

**macOS**
```text
~/Library/Application Support/HDDT/
├── config.json
├── accounts.json
├── logs/
└── runtime.json
```

### 5.2. Thư mục dữ liệu người dùng

Người dùng chọn `dataRoot`, ví dụ:

```text
D:\HDDT_DATA
```

Mỗi MST đăng nhập có đúng một thư mục:

```text
D:\HDDT_DATA\4601622475\
```

Không tạo subfolder mua/bán/năm/tháng cho XML/ZIP.

Trong thư mục MST có thể có:

```text
4601622475/
├── HDDT_PURCHASE_20260701_20260731.json
├── HDDT_SALES_20260701_20260731.json
├── HDDT_PURCHASE_20260701_20260731.xlsx
├── 20260512_4501622475_1C26SND_12345678.xml
├── 20260512_4501622475_1C26SND_12345678.zip
├── ...
└── download-manifest.json
```

---

## 6. Quy tắc đặt tên XML/ZIP

### 6.1. Format bắt buộc

```text
YYYYMMDD_<MST người bán>_<Ký hiệu>_<Số hóa đơn>.<ext>
```

Ví dụ:

```text
20260512_4501622475_1C26SND_12345678.xml
20260512_4501622475_1C26SND_12345678.zip
```

### 6.2. Mapping dữ liệu

- `YYYYMMDD`: ngày lập hóa đơn theo ngày nghiệp vụ hiển thị tại Việt Nam.
- `MST người bán`: `nbmst`.
- `Ký hiệu`: ký hiệu hóa đơn normalized từ trường `khhdon`/chuỗi ký hiệu thực tế mà GDT trả và hiển thị.
- `Số hóa đơn`: `shdon`.
- `.xml` hoặc `.zip`: theo loại file.

### 6.3. Quy tắc ngày

Không dùng trực tiếp ngày UTC trong chuỗi ISO nếu việc đó làm lệch ngày nghiệp vụ.

Ví dụ API có thể trả:

```text
2026-07-30T17:00:00Z
```

nhưng ngày nghiệp vụ Việt Nam là 31/07/2026. Filename phải dùng:

```text
20260731_...
```

Normalizer cần chuyển sang timezone `Asia/Ho_Chi_Minh` hoặc dùng trường ngày nghiệp vụ tương ứng.

### 6.4. Ký tự filename

Trước khi tạo file:
- loại các ký tự không hợp lệ trên Windows/macOS;
- trim khoảng trắng;
- không thay đổi số hóa đơn;
- không tự động đổi ký hiệu sang lowercase/uppercase nếu không cần;
- giữ tối đa khả năng truy nguyên về hóa đơn gốc.

### 6.5. Trùng tên

Khóa nghiệp vụ bình thường đã đủ phân biệt với `(ngày, nbsmt, ký hiệu, số hóa đơn)`.

Nếu file đã tồn tại:
- mặc định không ghi đè;
- so sánh kích thước/hash nếu có;
- trạng thái hiển thị “Đã có”;
- cho phép người dùng chọn “Tải lại và ghi đè” ở menu nâng cao.

Không tự thêm `(1)`, `(2)` cho XML/ZIP vì sẽ phá quy tắc tên chuẩn.

---

## 7. Đăng nhập và quản lý phiên

### 7.1. Luồng

```text
Khởi tạo session
    ↓
Lấy Captcha + ckey/challenge
    ↓
Hiển thị Captcha trên WebUI
    ↓
Người dùng nhập MST/password/Captcha
    ↓
POST login
    ↓
Nhận token/cookie
    ↓
Giữ session trong RAM local server
```

### 7.2. Nguyên tắc

- Captcha luôn do người dùng nhập.
- Không tự động giải Captcha.
- Token/cookie phiên không ghi vào dataset JSON.
- Không ghi token/password vào log.
- Session chỉ dùng cho request đến Cổng HĐĐT.

### 7.3. accounts.json

Mục tiêu file:
- lưu danh sách MST đã dùng;
- lưu tên hiển thị nếu có;
- tùy chọn ghi nhớ mật khẩu.

Đề xuất:

```json
{
  "schemaVersion": 1,
  "lastUsername": "4601622475",
  "accounts": [
    {
      "username": "4601622475",
      "displayName": "CINOTEX",
      "rememberPassword": true,
      "passwordCiphertext": "...",
      "passwordStorage": "os-protected"
    }
  ]
}
```

Không lưu plaintext password mặc định.

### 7.4. Bảo vệ mật khẩu

Ưu tiên:
- Windows: DPAPI hoặc cơ chế bảo vệ theo user của OS.
- macOS: Keychain/secure storage theo user.
- `accounts.json` chỉ giữ ciphertext hoặc reference.

Nếu triển khai secure store làm tăng phụ thuộc đáng kể, ứng dụng phải có mode đơn giản:
- chỉ lưu username;
- password nhập lại mỗi phiên.

Không nên hạ xuống plaintext chỉ để giảm thao tác triển khai.

---

## 8. Kết nối API HĐĐT

### 8.1. Connector abstraction

Core không gọi URL rải rác. Dùng interface:

```ts
interface GdtConnector {
  startSession(): Promise<CaptchaChallenge>;
  login(input: LoginInput): Promise<LoginResult>;
  logout(): Promise<void>;

  queryInvoices(input: InvoiceQuery): Promise<PortalInvoicePage>;
  getInvoiceDetail(locator: InvoiceLocator): Promise<PortalInvoiceDetail>;

  downloadXml(locator: InvoiceLocator): Promise<DownloadedFile>;
  downloadZip(locator: InvoiceLocator): Promise<DownloadedFile>;
}
```

Mục tiêu: GDT đổi endpoint/header thì sửa connector, không sửa UI/export engine.

### 8.2. Query/list

Bộ lọc tối thiểu:
- hướng: mua vào/bán ra;
- từ ngày;
- đến ngày;
- loại hóa đơn/chứng từ nếu endpoint hỗ trợ;
- trạng thái nếu endpoint hỗ trợ;
- pagination.

Kết quả list dùng để:
- hiển thị nhanh;
- xác định các invoice locator;
- lấy tổng quan;
- lựa chọn hóa đơn cần detail/XML/ZIP.

### 8.3. Detail API

Endpoint đã quan sát có dạng:

```text
GET /api/query/invoices/detail
    ?nbmst=<MST người bán>
    &khhdon=<Ký hiệu>
    &shdon=<Số hóa đơn>
    &khmshdon=<Mẫu số>
```

Do đó locator nên dùng composite:

```ts
type InvoiceLocator = {
  sellerTaxCode: string;     // nbmst
  templateNo: number|string; // khmshdon
  series: string;            // khhdon
  invoiceNo: number|string;  // shdon
};
```

Không phụ thuộc duy nhất vào UUID `id` của response.

### 8.4. Chi tiết hàng hóa/dịch vụ

Detail response có `hdhhdvu[]`.

Các field normalized đã quan sát:

| GDT | Normalized | Ý nghĩa |
|---|---|---|
| `id` | `portalLineId` | ID dòng |
| `idhdon` | `portalInvoiceId` | ID hóa đơn cha |
| `stt` | `lineNo` | STT |
| `sxep` | `sortOrder` | Thứ tự |
| `tchat` | `lineType` | Tính chất dòng |
| `ten` | `itemName` | Tên hàng/dịch vụ |
| `dvtinh` | `unit` | ĐVT |
| `sluong` | `quantity` | Số lượng |
| `dgia` | `unitPrice` | Đơn giá |
| `thtien` | `amount` | Thành tiền |
| `ltsuat` | `vatRateText` | Thuế suất text |
| `tsuat` | `vatRate` | Thuế suất số |
| `tthue` | `vatAmount` | Tiền thuế |
| `thtcthue` | `amountBeforeTax` | Tiền trước thuế ở dòng nếu có |
| `tlckhau` | `discountRate` | % chiết khấu |
| `stckhau` | `discountAmount` | Tiền chiết khấu |
| `stbchu` | `amountInWords` | Bằng chữ nếu có |
| `dvtte` | `currency` | Tiền tệ cấp dòng |
| `tgia` | `exchangeRate` | Tỷ giá cấp dòng |
| `ttkhac` | `dynamicFields` | Field mở rộng cấp dòng |
| `tthhdtrung` | `duplicateGoodsInfo` | Dữ liệu bổ sung/nested nếu có |

### 8.5. Detail concurrency

Không gọi detail cho toàn bộ danh sách ở mức concurrency cao.

Default:
- `detailConcurrency = 3`;
- có delay configurable giữa request;
- retry exponential backoff cho lỗi tạm thời;
- nếu session expired: dừng hàng đợi, yêu cầu login lại, sau đó cho Resume.

---

## 9. Mô hình dữ liệu normalized

### 9.1. InvoiceDocument

```ts
interface InvoiceDocument {
  key: string;
  direction: 'purchase' | 'sales';

  portalInvoiceId?: string;
  documentTypeCode?: string;
  documentTypeName?: string;
  templateNo?: number | string;
  series?: string;
  invoiceNo?: number | string;

  issueDate?: string;
  signingTime?: string;
  receivedTime?: string;
  codedTime?: string;
  updatedTime?: string;

  seller: Party;
  buyer: Party;

  currency?: string;
  exchangeRate?: number;
  subtotal?: number;
  nonTaxableAmount?: number;
  discountAmount?: number;
  vatAmount?: number;
  feeAmount?: number;
  otherAmount?: number;
  grandTotal?: number;
  grandTotalInWords?: string;
  paymentMethod?: string;

  invoiceStatus?: number | string;
  processingStatus?: number | string;
  nature?: number | string;

  providerCode?: string;
  lookup?: InvoiceLookup;
  qrCode?: string;

  taxSummaries: TaxSummary[];
  lines: InvoiceLine[];
  dynamicFields: DynamicField[];

  rawSummary?: unknown;
  rawDetail?: unknown;
}
```

### 9.2. Party

```ts
interface Party {
  taxCode?: string;
  name?: string;
  address?: string;
  bankAccount?: string;
  bankName?: string;
  phone?: string;
  email?: string;
  fax?: string;
  website?: string;
  identityNo?: string;
  dynamicFields: DynamicField[];
}
```

### 9.3. TaxSummary

```ts
interface TaxSummary {
  vatRateText?: string;
  taxableAmount?: number;
  vatAmount?: number;
  vatRateValue?: number;
}
```

### 9.4. DynamicField

```ts
interface DynamicField {
  section: string;
  name: string;
  dataType?: string;
  rawValue: unknown;
}
```

Các section:

```text
invoice.cttkhac
seller.nbttkhac
buyer.nmttkhac
invoice.ttkhac
totals.ttttkhac
line.ttkhac
```

---

## 10. Trường dynamic và nguyên tắc bảo tồn dữ liệu

Không cố đưa mọi field của mọi TVAN thành column cố định.

Ứng dụng phải:
1. Normalize các field nghiệp vụ chung.
2. Giữ nguyên dynamic field.
3. Giữ raw JSON của list/detail.
4. Cho phép exporter/profile AMIS truy cập cả normalized và dynamic field.

Ví dụ các field đã thấy:

**Cấp hóa đơn**
- `InvoiceTemplateID`
- `IsTaxReduction`
- `RefID`
- `TransactionID`
- `InvSubTotal`
- `DiscountAmount`
- `TotalDiscount`
- `Mã tra cứu`
- `Mã số bí mật`
- `PortalLink`
- `Fkey`
- `Ghi chú`
- `Trạng thái thanh toán`

**Cấp người bán**
- `SellerAddress`
- `SellerBankAccount`
- `SellerBankName`
- `SellerEmail`
- `SellerPhoneNumber`
- `Link tra cứu người bán`

**Cấp dòng hàng**
- `Amount`
- `RowDiscount`
- `ProdSubTotal`

Dynamic fields phải xuất hiện trong màn hình chi tiết ở tab “Trường mở rộng”.

---

## 11. Mã tra cứu và link tra cứu TVAN/HĐĐT

### 11.1. Model

```ts
interface InvoiceLookup {
  providerCode?: string;
  lookupCode?: string;
  lookupCodeType?: string;
  lookupBaseUrl?: string;
  lookupPathRaw?: string;
  sourceSection?: string;
  sourceField?: string;
  confidence?: 'high' | 'medium' | 'low';
}
```

### 11.2. Pattern đã quan sát

| Provider `ngcnhat` | Mã | Link/path |
|---|---|---|
| `tvan_softdreams` | `Fkey` | `PortalLink` |
| `tvan_viettel` | `Mã số bí mật` | `Link tra cứu người bán` khi có |
| `tvan_wintech` | `Mã tra cứu` | chưa thấy URL ổn định trong mẫu |
| `tvan_invoice` | `Mã tra cứu` | chưa thấy URL ổn định trong mẫu |
| `tvan_misa` | chưa xác định pattern ổn định từ mẫu hiện tại | giữ dynamic/raw |
| `tvan_bkav` | chưa xác định pattern ổn định từ mẫu hiện tại | giữ dynamic/raw |
| `tvan_fpt` | chưa xác định pattern ổn định từ mẫu hiện tại | giữ dynamic/raw |

SoftDreams đã thấy `PortalLink` dạng:
- `tracuu.easyinvoice.vn`
- subdomain kiểu `http://<mst>hd.easyinvoice.com.vn`

Viettel đã thấy `Mã số bí mật`; link phải lấy từ dynamic data nếu API trả, không hard-code một portal duy nhất.

### 11.3. Extractor

Lookup extractor hoạt động theo 2 lớp:

**Lớp semantic**
- tìm `Fkey`;
- `Mã tra cứu`;
- `MA_TRA_CUU` nếu gặp;
- `Mã số bí mật`;
- `PortalLink`;
- `Link tra cứu người bán`;
- `PATH` nếu gặp.

**Lớp provider adapter**
- dùng `ngcnhat` để bổ sung diễn giải;
- không bỏ qua field lạ;
- không dựng URL giả khi không có bằng chứng từ data.

---

## 12. Lưu dataset JSON

### 12.1. Mục tiêu

- Mở lại dữ liệu mà không cần login GDT.
- Tạo lại báo cáo/Excel.
- Dùng cho AMIS exporter về sau.
- Giữ raw response để không mất thông tin khi normalizer thay đổi.

### 12.2. Tên file đề xuất

```text
HDDT_PURCHASE_YYYYMMDD_YYYYMMDD.json
HDDT_SALES_YYYYMMDD_YYYYMMDD.json
```

Ví dụ:

```text
HDDT_PURCHASE_20260701_20260731.json
```

### 12.3. Schema

```json
{
  "format": "hddt-dataset",
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "meta": {
    "accountTaxCode": "4601622475",
    "direction": "purchase",
    "fromDate": "2026-07-01",
    "toDate": "2026-07-31",
    "createdAt": "...",
    "source": "hoadondientu.gdt.gov.vn",
    "recordCount": 0,
    "detailCount": 0
  },
  "documents": [
    {
      "key": "...",
      "normalized": {},
      "rawSummary": {},
      "rawDetail": {}
    }
  ]
}
```

### 12.4. Save an toàn

Không ghi thẳng file đích.

```text
write -> .tmp
fsync/close
validate JSON
rename -> .json
```

Nếu ghi thất bại, file cũ không bị hỏng.

### 12.5. Mở dataset

Khi mở:
- validate `format`;
- validate `schemaVersion`;
- migrate in-memory nếu schema cũ;
- không sửa file gốc nếu người dùng chưa Save.

---

## 13. WebUI — cấu trúc giao diện

### 13.1. Navigation chính

Chỉ 3 menu chính:

1. **Hóa đơn / Chứng từ**
2. **Tải XML / ZIP**
3. **Kết xuất kế toán**

Menu phụ:
- Cài đặt.
- Hướng dẫn.
- Thông tin phiên bản.
- Thoát.

### 13.2. Trang đăng nhập

Hiển thị:
- MST/User.
- Password.
- checkbox “Ghi nhớ mật khẩu”.
- Captcha image.
- Captcha input.
- nút Làm mới Captcha.
- nút Đăng nhập.
- trạng thái kết nối.

Sau login:
- thanh header hiển thị MST đang dùng;
- trạng thái session;
- nút Đăng xuất.

---

## 14. Trang Hóa đơn / Chứng từ

### 14.1. Tabs

- Mua vào.
- Bán ra.

### 14.2. Bộ lọc

- Từ ngày.
- Đến ngày.
- Loại chứng từ.
- Trạng thái.
- MST đối tác.
- Số hóa đơn.
- Ký hiệu.
- Tìm kiếm text tại dữ liệu đang có.

### 14.3. Actions

- Tra cứu.
- Lấy chi tiết đã chọn.
- Lấy chi tiết tất cả.
- Dừng.
- Mở JSON.
- Lưu JSON.
- Xuất Excel.
- Chuyển hóa đơn đã chọn sang hàng đợi XML/ZIP.

### 14.4. Invoice grid

Cột mặc định:
- checkbox.
- Ngày.
- Loại chứng từ.
- Mẫu số.
- Ký hiệu.
- Số hóa đơn.
- MST người bán/người mua theo direction.
- Tên đối tác.
- Tiền hàng.
- Thuế.
- Tổng tiền.
- Tiền tệ.
- Trạng thái.
- TVAN.
- Mã tra cứu.
- trạng thái detail.
- trạng thái XML/ZIP.

Cho phép:
- resize cột;
- sort;
- filter;
- hide/show columns;
- virtual scroll.

### 14.5. Invoice detail drawer/page

Tabs:
1. Tổng quan.
2. Người bán.
3. Người mua.
4. Hàng hóa/dịch vụ.
5. Thuế & tổng tiền.
6. Tra cứu/TVAN.
7. Trường mở rộng.
8. Raw JSON.

---

## 15. Báo cáo trên màn hình

Báo cáo dùng dữ liệu hiện tại trong RAM hoặc dataset JSON đang mở, không cần DB.

### 15.1. Tổng quan

- số chứng từ;
- số hóa đơn có detail;
- tổng tiền trước thuế;
- tổng VAT;
- tổng thanh toán;
- số chứng từ theo trạng thái;
- số chứng từ theo loại tiền.

### 15.2. Theo đối tác

- MST.
- Tên.
- Số chứng từ.
- Tiền trước thuế.
- VAT.
- Tổng thanh toán.

### 15.3. Theo thuế suất

- KCT.
- 0%.
- 5%.
- 8%.
- 10%.
- các giá trị khác từ dữ liệu thực tế.

Không hard-code chỉ các mức trên; phải tổng hợp động.

### 15.4. Theo loại chứng từ

- GTGT.
- Hóa đơn bán hàng.
- Phiếu xuất kho kiêm vận chuyển nội bộ.
- các loại khác.

### 15.5. Chi tiết hàng hóa/dịch vụ

- Tên.
- ĐVT.
- SL.
- Đơn giá.
- Thành tiền.
- VAT.
- Chiết khấu.
- Invoice key/số hóa đơn để truy ngược.

---

## 16. Excel báo cáo chung

### 16.1. Workbook mặc định

Một file có thể gồm:

**Sheet `HoaDon`**
- 1 dòng / hóa đơn.

**Sheet `ChiTiet`**
- 1 dòng / line item.

**Sheet `Thue`**
- 1 dòng / tax summary.

**Sheet `Dynamic`**
- extra fields dạng key/value.

**Sheet `TraCuu`**
- provider, mã tra cứu, link.

### 16.2. Yêu cầu format

- UTF-8/Vietnamese đầy đủ.
- Freeze header.
- Auto filter.
- Date theo `dd/mm/yyyy`.
- Số không được biến thành scientific notation khi không mong muốn.
- MST, số tài khoản, số chứng từ cần giữ kiểu text khi có nguy cơ mất số 0 đầu.
- Không tự làm tròn dữ liệu tiền tệ nguồn; chỉ format hiển thị.

---

## 17. Kết xuất import MISA AMIS

### 17.1. Phạm vi v1

Tạo framework/profile engine.

Chưa khóa cứng cấu trúc cột AMIS cho đến khi nhận file mẫu Excel chính thức.

### 17.2. Export Profile

```ts
interface ExportProfile {
  id: string;
  name: string;
  version: string;
  documentDirection?: 'purchase' | 'sales';
  sheets: ExportSheetProfile[];
}
```

Cấu hình cột:

```json
{
  "targetColumn": "...",
  "source": "seller.taxCode",
  "type": "text",
  "required": true,
  "transform": []
}
```

### 17.3. Transform hỗ trợ

- `date`.
- `number`.
- `text`.
- `vat-rate`.
- `concat`.
- `default`.
- `lookup`.
- `if`.
- `account-map`.
- `cost-center-map` về sau.

### 17.4. Mục tiêu khi nhận template AMIS

- xác định workbook/sheet chuẩn;
- cột bắt buộc;
- format cell;
- dữ liệu mua vào;
- dữ liệu bán ra;
- mapping tài khoản;
- mapping mã đối tượng;
- mapping mã hàng;
- mapping đơn vị tính;
- mapping thuế suất;
- validate trước export;
- báo lỗi dòng/cột rõ ràng.

---

## 18. Trang Tải XML / ZIP

### 18.1. Nguồn task

- từ hóa đơn đang chọn;
- toàn bộ hóa đơn của kết quả tra cứu;
- dataset JSON đã mở.

### 18.2. Queue model trong RAM

```ts
type DownloadTask = {
  id: string;
  locator: InvoiceLocator;
  type: 'xml' | 'zip';
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'skipped';
  attempts: number;
  targetPath: string;
  error?: string;
};
```

### 18.3. Controls

- Start.
- Pause.
- Resume.
- Retry failed.
- Clear completed.
- Open folder.

### 18.4. Concurrency

Default:
- download concurrency = 3;
- configurable 1–5;
- delay giữa request;
- exponential backoff;
- không retry vô hạn.

### 18.5. `.part`

Đang tải:

```text
20260512_4501622475_1C26SND_12345678.xml.part
```

Hoàn tất mới rename thành `.xml`.

### 18.6. download-manifest.json

Không phải database; chỉ là metadata tiện ích.

```json
{
  "schemaVersion": 1,
  "files": [
    {
      "key": "...",
      "fileName": "20260512_4501622475_1C26SND_12345678.xml",
      "type": "xml",
      "downloadedAt": "...",
      "size": 12345,
      "sha256": "..."
    }
  ]
}
```

Manifest có thể rebuild bằng cách scan folder nếu bị mất.

---

## 19. Local API của HDDT WebUI

Frontend không gọi GDT trực tiếp.

Đề xuất routes:

```text
GET    /api/app/status
POST   /api/app/exit

GET    /api/settings
PUT    /api/settings

GET    /api/accounts
PUT    /api/accounts/:username

POST   /api/auth/session
GET    /api/auth/captcha
POST   /api/auth/login
POST   /api/auth/logout

POST   /api/invoices/query
POST   /api/invoices/details
POST   /api/invoices/detail

POST   /api/datasets/open
POST   /api/datasets/save

POST   /api/downloads/queue
POST   /api/downloads/start
POST   /api/downloads/pause
POST   /api/downloads/resume
POST   /api/downloads/retry
GET    /api/downloads/status

POST   /api/exports/report
POST   /api/exports/profile
```

Progress nên dùng SSE hoặc WebSocket local; SSE đủ cho v1 và đơn giản hơn.

---

## 20. Cấu hình

### 20.1. config.json

```json
{
  "schemaVersion": 1,
  "app": {
    "language": "vi-VN",
    "openBrowserOnStart": true,
    "port": 3210
  },
  "storage": {
    "dataRoot": "D:\\HDDT_DATA",
    "datasetSaveMode": "ask"
  },
  "network": {
    "detailConcurrency": 3,
    "downloadConcurrency": 3,
    "requestDelayMs": 400,
    "requestTimeoutMs": 30000,
    "maxRetries": 3
  },
  "export": {
    "defaultFormat": "xlsx"
  }
}
```

### 20.2. UI Settings

Người dùng chỉnh được:
- thư mục dataRoot;
- concurrency detail;
- concurrency download;
- delay;
- có/không auto-open browser;
- default purchase/sales;
- nhớ tài khoản;
- mở folder dữ liệu.

Không cần yêu cầu chỉnh `.env` ở bản phát hành.

---

## 21. Logging

### 21.1. Mục tiêu

Log hỗ trợ debug nhưng không chứa bí mật.

Có:
- startup/shutdown;
- login success/fail code chung;
- query parameters không nhạy cảm;
- số lượng invoice;
- detail task progress;
- download progress;
- export result;
- lỗi HTTP/status.

Không log:
- password;
- bearer token;
- cookie;
- captcha text;
- full authorization header.

### 21.2. Rotation

- tối đa số ngày/file cấu hình;
- mặc định 7 ngày;
- cleanup tự động.

---

## 22. Security

1. Server chỉ bind `127.0.0.1` mặc định.
2. Không bật CORS rộng.
3. Frontend chỉ được serve từ local server.
4. Có local session nonce/CSRF token nếu cần.
5. Validate path để tránh path traversal.
6. Không cho filename từ API chèn `/`, `\`, `..`.
7. Password không plaintext trong log/dataset.
8. GDT token/cookie ở RAM.
9. Dataset raw có thể chứa thông tin doanh nghiệp/đối tác; cảnh báo người dùng khi chia sẻ file.
10. Export Excel phải escape nội dung có nguy cơ formula injection khi source text bắt đầu bằng `=`, `+`, `-`, `@` trong các cột text không có chủ ý công thức.

---

## 23. Error handling

### 23.1. Nhóm lỗi

- Login/Captcha sai.
- Session expired.
- Network timeout.
- GDT trả 4xx/5xx.
- API schema thay đổi.
- File permission denied.
- Disk full.
- JSON invalid.
- Excel export failed.
- Download file empty/corrupt.

### 23.2. Nguyên tắc UI

Không hiển thị stack trace cho user thông thường.

Mỗi lỗi có:
- thông báo dễ hiểu;
- invoice key nếu liên quan;
- nút Retry nếu retry được;
- nút Copy technical detail ở phần mở rộng.

### 23.3. Session expired

- pause detail/download queues;
- yêu cầu đăng nhập lại;
- sau login cho Resume;
- không mất danh sách task trong RAM.

---

## 24. Hiệu năng

### 24.1. Không tải detail vô điều kiện

Query list phải hiển thị nhanh.

Detail chỉ lấy khi:
- user bấm xem;
- user chọn “Lấy chi tiết”;
- cần export detail/AMIS;
- cần lưu dataset đầy đủ.

### 24.2. Frontend

- virtualized grid;
- không render toàn bộ raw JSON của hàng nghìn hóa đơn đồng thời;
- detail drawer load theo nhu cầu;
- aggregate reports tính memoized/background worker nếu dataset lớn.

### 24.3. JSON

Với dataset rất lớn:
- save bằng stream hoặc chunk trong implementation;
- UI hiển thị progress;
- không stringify toàn bộ object khổng lồ bằng một blocking call nếu gây memory peak.

---

## 25. Project structure đề xuất

```text
hddt-v1/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── README.md
│
├── src/
│   ├── server/
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── invoice.routes.ts
│   │   │   ├── download.routes.ts
│   │   │   ├── dataset.routes.ts
│   │   │   ├── export.routes.ts
│   │   │   └── settings.routes.ts
│   │   │
│   │   ├── gdt/
│   │   │   ├── connector.ts
│   │   │   ├── auth.ts
│   │   │   ├── query.ts
│   │   │   ├── detail.ts
│   │   │   └── download.ts
│   │   │
│   │   ├── services/
│   │   │   ├── session.service.ts
│   │   │   ├── dataset.service.ts
│   │   │   ├── download.service.ts
│   │   │   ├── settings.service.ts
│   │   │   ├── credential.service.ts
│   │   │   └── browser-launch.service.ts
│   │   │
│   │   └── export/
│   │       ├── excel-report.ts
│   │       ├── profile-engine.ts
│   │       └── profiles/
│   │           └── amis/
│   │
│   ├── web/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── InvoicePage.tsx
│   │   │   ├── DownloadPage.tsx
│   │   │   ├── AccountingExportPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── api/
│   │
│   └── shared/
│       ├── models/
│       ├── schemas/
│       ├── normalizer/
│       ├── dynamic-fields/
│       ├── lookup/
│       ├── filenames/
│       └── utils/
│
├── tests/
│   ├── fixtures/
│   │   ├── purchase/
│   │   ├── detail/
│   │   └── downloads/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── build/
│   ├── windows/
│   └── macos/
│
└── docs/
    ├── USER_GUIDE.md
    ├── DEVELOPER_GUIDE.md
    ├── API_OBSERVATIONS.md
    └── AMIS_PROFILE.md
```

Không monorepo trong v1 nếu không có lý do thực tế; một repository/one package giúp đơn giản build và phát hành.

---

## 26. Hướng dẫn người dùng tối giản

### 26.1. Lần đầu

1. Giải nén HDDT.
2. Chạy launcher.
3. Chọn thư mục lưu dữ liệu.
4. Nhập MST/password.
5. Nhập Captcha.
6. Đăng nhập.

### 26.2. Tải hóa đơn

1. Chọn Mua vào hoặc Bán ra.
2. Chọn khoảng ngày.
3. Bấm Tra cứu.
4. Nếu cần chi tiết hàng hóa: bấm Lấy chi tiết.
5. Xem báo cáo hoặc Save JSON/Export Excel.

### 26.3. Tải XML/ZIP

1. Chọn hóa đơn.
2. Bấm “Thêm vào tải file”.
3. Chọn XML, ZIP hoặc cả hai.
4. Bấm Start.
5. File tự lưu vào `<dataRoot>/<MST user>/` theo format chuẩn.

### 26.4. Mở dữ liệu cũ

1. Bấm Mở JSON.
2. Chọn file `HDDT_*.json`.
3. Báo cáo, Excel và AMIS có thể dùng ngay mà không đăng nhập GDT.

---

## 27. Hướng dẫn kỹ thuật build/release

### 27.1. Development

```bash
pnpm install
pnpm dev
```

Một lệnh chạy:
- Vite dev server hoặc middleware;
- Fastify local server;
- mở trình duyệt.

### 27.2. Build production

```bash
pnpm build
```

Kết quả:
- server bundle;
- frontend static bundle.

### 27.3. Package

```bash
pnpm package:win-x64
pnpm package:mac-arm64
pnpm package:mac-x64
```

### 27.4. Release artifact

```text
HDDT_v1.0.0_windows_x64.zip
HDDT_v1.0.0_macos_arm64.zip
HDDT_v1.0.0_macos_x64.zip
```

Mỗi artifact phải kèm `README_FIRST.txt` hướng dẫn 3–5 bước.

---

## 28. Testing

### 28.1. Unit tests

- filename formatter.
- date timezone formatter.
- invoice normalizer.
- line normalizer.
- dynamic field extractor.
- lookup extractor.
- dataset serializer/deserializer.
- export transforms.

### 28.2. Fixture tests

Dùng JSON đã thu thập từ các hệ thống:
- Viettel.
- SoftDreams.
- MISA.
- BKAV.
- FPT.
- WinTech.
- các nguồn khác khi có.

Không để test phụ thuộc hoàn toàn vào GDT live.

### 28.3. Integration

- login mock.
- list pagination.
- detail concurrency.
- session expiry.
- download resume/retry.
- file collision.
- JSON save/open.
- Excel export.

### 28.4. E2E

- Start app -> browser opens.
- Login.
- Query purchase.
- Load detail.
- Save JSON.
- Open JSON.
- Export Excel.
- Queue XML.
- Validate filename.

---

## 29. Acceptance criteria v1.0.0

### Deployment
- [ ] Windows chạy từ gói portable không cần Node/Python/database.
- [ ] macOS chạy từ gói portable tương ứng.
- [ ] Một launcher, tự mở browser.
- [ ] Không yêu cầu người dùng chỉnh `.env`.

### Authentication
- [ ] Lấy Captcha và hiển thị.
- [ ] Login được bằng MST/password/Captcha.
- [ ] Session expiry xử lý rõ ràng.

### Invoice data
- [ ] Query mua vào.
- [ ] Query bán ra.
- [ ] Pagination.
- [ ] Lấy detail từ endpoint detail.
- [ ] Parse `hdhhdvu[]`.
- [ ] Giữ dynamic fields.
- [ ] Giữ raw JSON.

### Dataset
- [ ] Save JSON.
- [ ] Open JSON.
- [ ] Không cần login để dùng dataset cũ.

### UI/report
- [ ] Invoice grid.
- [ ] Detail view.
- [ ] Tổng hợp cơ bản.
- [ ] Theo đối tác.
- [ ] Theo thuế suất.
- [ ] Chi tiết hàng hóa.

### Download
- [ ] XML một file.
- [ ] XML hàng loạt.
- [ ] ZIP khi API hỗ trợ.
- [ ] Queue/retry.
- [ ] Filename đúng tuyệt đối:
  `YYYYMMDD_<MST người bán>_<Ký hiệu>_<Số hóa đơn>.<ext>`.
- [ ] Tất cả lưu trực tiếp vào `<dataRoot>/<MST user>/`.

### Excel
- [ ] Xuất danh sách hóa đơn.
- [ ] Xuất chi tiết hàng hóa.
- [ ] Dynamic sheet hoặc cơ chế giữ extra field.
- [ ] Dữ liệu số/text không bị Excel làm sai MST/số chứng từ.

### AMIS
- [ ] Profile engine hoàn chỉnh.
- [ ] Có placeholder profile AMIS.
- [ ] Có cơ chế nhập mapping/template sau khi nhận file mẫu.

---

## 30. Phạm vi chưa chốt / cần dữ liệu bổ sung

1. Endpoint tải ZIP/XML chính xác của GDT cần được capture và fixture hóa trong quá trình implementation.
2. Pattern mã/link tra cứu MISA, BKAV, FPT chưa đủ bằng chứng để hard-code.
3. Cấu trúc import MISA AMIS chưa được chốt do chưa có file Excel mẫu.
4. Một số code trạng thái (`tthai`, `ttxly`, `tchat`, `htttoan`...) cần lập bảng nghĩa đầy đủ bằng mẫu/quan sát UI hoặc tài liệu chính thức trước khi hiển thị label nghiệp vụ.
5. Nếu HTTP login của GDT thay đổi làm direct connector không ổn định, cần đánh giá fallback browser-assisted login; không đưa Playwright vào package v1 nếu chưa thực sự cần.

---

## 31. Roadmap triển khai đề xuất

### Phase 1 — Skeleton + packaging
- Local Fastify.
- React UI.
- Config.
- One-click launcher.
- Windows/macOS build pipeline.

### Phase 2 — Auth + list API
- Captcha.
- Login.
- Session.
- Query purchase/sales.
- Invoice grid.

### Phase 3 — Detail API + normalization
- Detail locator.
- Detail queue.
- `hdhhdvu`.
- dynamic fields.
- TVAN lookup extraction.
- detail view.

### Phase 4 — JSON + report + Excel
- Save/open dataset.
- summary reports.
- Excel general export.

### Phase 5 — XML/ZIP
- Capture file endpoints.
- download queue.
- retry.
- manifest.
- chuẩn filename.

### Phase 6 — AMIS profile engine
- Mapping framework.
- validation.
- Sau khi có mẫu AMIS: implement profile thực tế.

### Phase 7 — QA + release
- fixture regression.
- Windows test.
- macOS test.
- packaging.
- user guide.

---

## 32. Nguyên tắc giữ hệ thống gọn nhẹ

1. Một repository.
2. Một local server process.
3. Một WebUI.
4. Không database.
5. Không Electron ở v1.
6. Không Python.
7. Không Playwright nếu không bắt buộc.
8. Không yêu cầu runtime bên ngoài.
9. JSON là dữ liệu lưu nghiệp vụ.
10. XML/ZIP là file gốc.
11. Excel là kênh trao đổi dữ liệu.
12. Adapter cho GDT; profile cho phần mềm kế toán.
13. Raw JSON luôn được bảo tồn để chống thay đổi schema.

---

## 33. Tóm tắt kiến trúc cuối cùng

```text
                         ┌────────────────────────┐
                         │    Browser WebUI       │
                         │ React + TypeScript     │
                         └───────────┬────────────┘
                                     │ localhost
                                     ▼
                         ┌────────────────────────┐
                         │   HDDT Local Server    │
                         │ Node + Fastify         │
                         ├────────────────────────┤
                         │ Auth / Session         │
                         │ GDT Connector          │
                         │ Normalizer             │
                         │ Detail Queue           │
                         │ Download Queue         │
                         │ JSON Store             │
                         │ Excel/Profile Engine   │
                         └─────┬───────────┬──────┘
                               │           │
                    HTTPS      │           │ local filesystem
                               ▼           ▼
                  ┌────────────────┐   ┌───────────────────────┐
                  │ GDT HĐĐT       │   │ <dataRoot>/<MST>/    │
                  │ list/detail    │   │ JSON                  │
                  │ XML/ZIP        │   │ XLSX                  │
                  └────────────────┘   │ XML/ZIP               │
                                       └───────────────────────┘
```

**HDDT_v1.0.0 được định nghĩa là một ứng dụng WebUI local-first, file-based, API-first, không database; ưu tiên đơn giản triển khai và khả năng bảo tồn đầy đủ dữ liệu JSON của Cổng HĐĐT.**

---

## 34. Changelog thiết kế v1.0.0

So với kiến trúc nền ban đầu:
- chuyển trọng tâm từ Desktop/Electron sang local WebUI;
- bỏ SQLite/database;
- bỏ migration/backup DB;
- bỏ yêu cầu XML parser cho line item trong core;
- dùng API detail làm nguồn chi tiết hàng hóa/dịch vụ;
- JSON trở thành định dạng lưu dataset chính;
- ZIP/XML lưu file trực tiếp theo MST đăng nhập;
- thống nhất filename XML/ZIP theo quy tắc bắt buộc;
- Excel/Profile Engine trở thành lớp tích hợp phần mềm kế toán;
- AMIS là target đầu tiên nhưng chờ file template để hoàn thiện mapping.

