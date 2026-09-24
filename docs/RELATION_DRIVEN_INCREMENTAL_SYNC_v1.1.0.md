# HDDT v1.1.0 — Relation-Driven Incremental Synchronization

## 1. Mục tiêu

Tài liệu này thay thế nguyên tắc **“luôn refresh toàn bộ danh sách trong khoảng dữ liệu cũ”** bằng cơ chế đồng bộ tăng dần dựa trên:

1. **cửa sổ dữ liệu mới**;
2. **quan hệ hóa đơn thay thế / điều chỉnh với hóa đơn gốc**;
3. **cửa sổ truy vấn bù riêng cho `ttxly==6`** nhằm giảm nguy cơ bỏ sót hóa đơn mua vào do người bán chuyển dữ liệu muộn cho cơ quan thuế.

Nguyên tắc chính:

> **Dataset JSON đã lưu được coi là baseline. Ứng dụng không truy vấn lại toàn bộ lịch sử chỉ để kiểm tra trạng thái. Ứng dụng chỉ truy vấn phần dữ liệu mới và một cửa sổ bù giới hạn cho `ttxly==6`. Khi phát hiện hóa đơn thay thế hoặc hóa đơn điều chỉnh, ứng dụng dùng locator hóa đơn gốc có ngay trên hóa đơn mới để tìm hóa đơn gốc trong dataset và cập nhật trạng thái gốc locally. Không tải lại detail của hóa đơn gốc đã có đầy đủ detail.**

Mục tiêu kỹ thuật:

- giảm mạnh số request list và detail gửi tới GDT;
- tránh scan lại toàn bộ hóa đơn đã lưu trong JSON;
- vẫn phát hiện hóa đơn mới;
- vẫn phát hiện hóa đơn thay thế / điều chỉnh liên quan đến hóa đơn gốc cũ;
- cập nhật trạng thái hóa đơn gốc mà không phải query lại hóa đơn gốc;
- bổ sung truy vấn bù `ttxly==6` trong phạm vi thời gian hẹp để giảm rủi ro hóa đơn mua vào được người bán chuyển dữ liệu muộn;
- giữ nguyên detail, line, tax summary và raw detail đã lưu của hóa đơn cũ;
- merge dữ liệu mới vào dataset hiện tại, không thay thế toàn bộ dataset.

---

## 2. Cơ sở từ payload đã xác minh

### 2.1 Hóa đơn bình thường

Payload `tthai=1` cho thấy hóa đơn bình thường có:

```text
tchat = 1
tthai = 1

khmshdgoc = null
khhdgoc   = null
shdgoc    = null
tdlhdgoc  = null
gchdgoc   = null
```

### 2.2 Hóa đơn thay thế

Payload thực tế xác nhận hóa đơn thay thế có:

```text
tchat = 2
tthai = 2
```

và trực tiếp mang locator của hóa đơn gốc:

```text
khmshdgoc
khhdgoc
shdgoc
tdlhdgoc
lhdgoc
gchdgoc
```

Ví dụ:

```text
Hóa đơn mới:
nbmst       = 4601576518
khmshdon    = 1
khhdon      = C26TJB
shdon       = 116
tchat       = 2
tthai       = 2

Hóa đơn gốc được tham chiếu:
khmshdgoc   = 1
khhdgoc     = C26TJB
shdgoc      = 109
```

Trong dữ liệu hóa đơn gốc tương ứng:

```text
nbmst       = 4601576518
khmshdon    = 1
khhdon      = C26TJB
shdon       = 109
tchat       = 1
tthai       = 4
```

Kết luận:

```text
tchat/tthai = 2
    ↓
hóa đơn mới là hóa đơn thay thế

hóa đơn gốc tương ứng
    ↓
tchat = 1
tthai = 4
```

### 2.3 Hóa đơn điều chỉnh

Payload thực tế xác nhận hóa đơn điều chỉnh có:

```text
tchat = 3
tthai = 3
```

và dùng cùng cơ chế tham chiếu hóa đơn gốc:

```text
khmshdgoc
khhdgoc
shdgoc
tdlhdgoc
lhdgoc
gchdgoc
```

Ví dụ:

```text
Hóa đơn mới:
nbmst       = 2301000920
khmshdon    = 1
khhdon      = C26TAB
shdon       = 843
tchat       = 3
tthai       = 3

Hóa đơn gốc được tham chiếu:
khmshdgoc   = 1
khhdgoc     = C26TAB
shdgoc      = 839
```

Hóa đơn gốc tương ứng có:

```text
nbmst       = 2301000920
khmshdon    = 1
khhdon      = C26TAB
shdon       = 839
tchat       = 1
tthai       = 5
```

Kết luận:

```text
tchat/tthai = 3
    ↓
hóa đơn mới là hóa đơn điều chỉnh

hóa đơn gốc tương ứng
    ↓
tchat = 1
tthai = 5
```

### 2.4 Hóa đơn gốc không chứa ID ngược của hóa đơn mới

Payload `tthai=4` và `tthai=5` cho thấy hóa đơn gốc sau khi bị thay thế / điều chỉnh vẫn có:

```text
tchat = 1
```

và các trường quan hệ gốc thường là:

```text
khmshdgoc = null
khhdgoc   = null
shdgoc    = null
tdlhdgoc  = null
gchdgoc   = null
```

Do đó quan hệ do GDT cung cấp là quan hệ một chiều:

```text
Hóa đơn thay thế / điều chỉnh
               │
               │ original locator
               ▼
           Hóa đơn gốc
```

Không được thiết kế dựa trên giả định rằng hóa đơn gốc sẽ chứa ID của hóa đơn thay thế / điều chỉnh.

---

## 3. Locator chính xác của hóa đơn gốc

### 3.1 Locator từ hóa đơn mới

Khi `tchat` là `2` hoặc `3`, locator của hóa đơn gốc được tạo như sau:

```ts
const originalLocator = {
  sellerTaxCode: raw.nbmst,
  templateNo: raw.khmshdgoc,
  series: raw.khhdgoc,
  invoiceNo: raw.shdgoc
};
```

### 3.2 So khớp với hóa đơn đã lưu

Locator trên phải khớp với hóa đơn gốc trong dataset:

```text
new.nbmst
    ==
original.nbmst

new.khmshdgoc
    ==
original.khmshdon

new.khhdgoc
    ==
original.khhdon

new.shdgoc
    ==
original.shdon
```

Canonical relation key:

```text
sellerTaxCode|templateNo|series|invoiceNo
```

Tương đương:

```text
nbmst|khmshdgoc|khhdgoc|shdgoc
```

khi đọc từ hóa đơn thay thế / điều chỉnh.

### 3.3 Không dùng `id`, `hsgoc` làm khóa quan hệ

Không được suy diễn:

```text
new.id == original.id
new.hsgoc == original.id
new.hsgoc == original.hsgoc
```

Các payload cho thấy `id` và `hsgoc` của hai hóa đơn là các giá trị riêng biệt.

### 3.4 Trường hỗ trợ kiểm tra consistency

Các trường sau được dùng làm cross-check, không phải canonical relation key:

```text
tdlhdgoc
gchdgoc
lhdgoc
```

`tdlhdgoc` có thể dùng để kiểm tra ngày lập hóa đơn gốc.

`gchdgoc` có thể dùng để hiển thị / audit lý do quan hệ.

Không đưa `tdlhdgoc` vào key vì timestamp có timezone và có khả năng nullable.

---

## 4. Mô hình dữ liệu relation đề xuất

```ts
export type InvoiceRelationKind =
  | 'replacement'
  | 'adjustment';

export interface OriginalInvoiceLocator {
  sellerTaxCode: string;
  templateNo: string | number;
  series: string;
  invoiceNo: string | number;
  issuedAt?: string;
}

export interface InvoiceRelation {
  kind: InvoiceRelationKind;
  original: OriginalInvoiceLocator;
  description?: string;
}
```

Trong `InvoiceDocument`:

```ts
export interface InvoiceDocument {
  // existing fields...

  relation?: InvoiceRelation;
}
```

Normalizer:

```ts
if (raw.tchat === 2) {
  relation = {
    kind: 'replacement',
    original: {
      sellerTaxCode: raw.nbmst,
      templateNo: raw.khmshdgoc,
      series: raw.khhdgoc,
      invoiceNo: raw.shdgoc,
      issuedAt: raw.tdlhdgoc
    },
    description: raw.gchdgoc
  };
}

if (raw.tchat === 3) {
  relation = {
    kind: 'adjustment',
    original: {
      sellerTaxCode: raw.nbmst,
      templateNo: raw.khmshdgoc,
      series: raw.khhdgoc,
      invoiceNo: raw.shdgoc,
      issuedAt: raw.tdlhdgoc
    },
    description: raw.gchdgoc
  };
}
```

Chỉ tạo `relation` khi locator tối thiểu hợp lệ:

```text
nbmst
khmshdgoc
khhdgoc
shdgoc
```

Nếu `tchat=2/3` nhưng thiếu một trong các thành phần này:

```text
RELATION_LOCATOR_INCOMPLETE
```

và không được tự cập nhật trạng thái hóa đơn gốc.

---

## 5. Nguyên tắc đồng bộ mới

Không còn áp dụng:

> Luôn query lại toàn bộ khoảng thời gian đã có trong JSON để refresh trạng thái.

Thay bằng:

> **Chỉ query cửa sổ phát sinh mới và cửa sổ bù `ttxly==6`. Hóa đơn lịch sử trong JSON chỉ bị thay đổi khi có bằng chứng quan hệ trực tiếp từ một hóa đơn thay thế / điều chỉnh mới hoặc khi bản thân hóa đơn đó xuất hiện trong cửa sổ truy vấn bù.**

Luồng tổng quát:

```text
MỞ DATASET JSON
      │
      ▼
Đọc sync metadata / coverage
      │
      ├────────────────────────────────────┐
      │                                    │
      ▼                                    ▼
MAIN INCREMENTAL WINDOW            TTXLY=6 SUPPLEMENT WINDOW
dữ liệu mới                        từ đầu tháng liền trước
      │                            đến toDate
      └──────────────────┬─────────────────┘
                         ▼
                 Query LIST GDT
                         │
                         ▼
                  Normalize summary
                         │
            ┌────────────┼────────────┐
            │            │            │
         tchat=1      tchat=2      tchat=3
            │            │            │
            │            │            │
            │       replacement    adjustment
            │            │            │
            │            └─────┬──────┘
            │                  ▼
            │          build original locator
            │                  │
            │                  ▼
            │          find in JSON baseline
            │                  │
            │           ┌──────┴──────┐
            │           │             │
            │          found       not found
            │           │             │
            │           ▼             ▼
            │       update old      keep new
            │       status local    + warning
            │
            ▼
     deduplicate / hydrate
            │
            ▼
        merge dataset
```

---

## 6. Main incremental window

### 6.1 Mục tiêu

Main incremental window chỉ dùng để phát hiện các hóa đơn phát sinh sau vùng dữ liệu đã được đồng bộ thành công.

Dataset nên lưu metadata:

```ts
interface DatasetSyncMetadata {
  lastSuccessfulSyncAt?: string;
  normalCoverageToDate?: string;
}
```

Ví dụ JSON đã truy vấn đầy đủ đến:

```text
normalCoverageToDate = 2026-05-16
```

thì lần đồng bộ tiếp theo không được mặc định query lại:

```text
01/01/2026 → 16/05/2026
```

Main query chỉ đi vào phần dữ liệu mới theo yêu cầu đồng bộ kế tiếp.

### 6.2 Không dùng “không thấy trong query mới” để xóa hóa đơn cũ

Một hóa đơn cũ không xuất hiện trong main window không có nghĩa là hóa đơn đó không còn tồn tại.

Không:

```text
not returned
→ delete
```

Không:

```text
not returned
→ reset status
```

Dataset cũ tiếp tục là baseline.

---

## 7. Cửa sổ truy vấn bù `ttxly==6`

### 7.1 Mục đích

Một số hóa đơn mua vào có thể được người bán chuyển dữ liệu tới cơ quan thuế muộn.

Nếu chỉ query đúng phần ngày mới sau `normalCoverageToDate`, có khả năng một hóa đơn có `tdlap` thuộc khoảng cũ nhưng chỉ xuất hiện trên hệ thống sau thời điểm dataset đã được lưu.

Để giảm rủi ro này, thực hiện thêm một query giới hạn cho:

```text
ttxly == 6
```

### 7.2 Quy tắc tính cửa sổ

Cho:

```text
toDate = ngày kết thúc coverage / ngày kết thúc lần truy vấn hiện tại
```

Ta tính:

```text
supplementFromDate =
    ngày 01 của tháng liền trước tháng chứa toDate
```

và:

```text
supplementToDate = toDate
```

Công thức:

```ts
function getTtxly6SupplementFromDate(toDate: Date): Date {
  return new Date(
    toDate.getFullYear(),
    toDate.getMonth() - 1,
    1
  );
}
```

### 7.3 Ví dụ bắt buộc

Nếu dataset đã truy vấn đến:

```text
toDate = 16/05/2026
```

thì:

```text
main baseline:
... → 16/05/2026

ttxly==6 supplement:
01/04/2026 → 16/05/2026
```

Không query `ttxly==6` từ ngày đầu dataset.

Ví dụ khác:

```text
toDate = 30/09/2026
```

thì:

```text
supplementFromDate = 01/08/2026
supplementToDate   = 30/09/2026
```

Qua biên năm:

```text
toDate = 10/01/2027
```

thì:

```text
supplementFromDate = 01/12/2026
supplementToDate   = 10/01/2027
```

### 7.4 Phạm vi nghiệp vụ

Cửa sổ bù `ttxly==6` ưu tiên cho:

```text
direction = purchase
source    = standard
```

vì mục đích là phát hiện hóa đơn mua vào do người bán chuyển dữ liệu muộn.

Không tự suy rộng quy tắc này cho POS hoặc source khác nếu chưa xác minh API tương ứng.

### 7.5 Bằng chứng / mức xác minh

Payload đã upload hiện xác minh chắc chắn quan hệ `tchat/tthai` và locator hóa đơn gốc.

Đối với **list payload `ttxly==6`**, bộ file hiện tại chưa có capture list đầy đủ để khóa toàn bộ semantic response.

Vì vậy:

```text
“query bù ttxly==6 từ đầu tháng liền trước đến toDate”
```

là **chính sách đồng bộ của ứng dụng**, nhằm chống bỏ sót dữ liệu chuyển muộn.

Không được dùng tài liệu này để suy diễn thêm các ý nghĩa nghiệp vụ khác của `ttxly==6` nếu chưa có payload xác minh.

---

## 8. Merge kết quả từ main window và `ttxly==6` supplement

Hai nguồn query có thể trả lại cùng một hóa đơn.

Phải deduplicate trước khi hydrate:

```text
mainResults
+
ttxly6SupplementResults
        │
        ▼
canonical key
        │
        ▼
unique invoice summaries
```

Canonical invoice key hiện tại:

```text
direction
| invoiceSource
| sellerTaxCode
| templateNo
| series
| invoiceNo
```

Tức:

```text
purchase|standard|nbmst|khmshdon|khhdon|shdon
```

Nếu một hóa đơn đã tồn tại trong JSON:

```text
existing + hasDetail = true
```

thì:

```text
merge latest summary fields
skip detail
```

Nếu:

```text
existing + hasDetail = false
```

thì:

```text
hydrate detail exactly once
```

Nếu là hóa đơn mới:

```text
hydrate detail
append / merge into dataset
```

---

## 9. Xử lý hóa đơn thay thế

Điều kiện:

```text
tchat == 2
OR
tthai == 2
```

Khuyến nghị primary classifier:

```text
tchat == 2
```

và dùng `tthai==2` làm consistency signal.

Sau khi normalize hóa đơn thay thế:

```ts
const relation = buildOriginalRelation(raw);
```

Tìm original trong dataset:

```ts
const original = existingByBusinessLocator.get(
  relation.originalKey
);
```

### 9.1 Nếu tìm thấy original

Cập nhật locally:

```text
original.tchat = giữ nguyên giá trị cũ, thông thường 1
original.tthai = 4
```

Không:

```text
getInvoiceDetail(original)
```

Không cần:

```text
query lại toàn bộ tháng của original
```

Giữ nguyên:

```text
original.rawDetail
original.lines
original.taxSummaries
original.dynamicFields
original.qr
```

Có thể lưu relation reverse ở tầng ứng dụng:

```ts
original.relationsFrom.push({
  kind: 'replacement',
  invoiceKey: replacement.key
});
```

### 9.2 Nếu không tìm thấy original

Không query toàn bộ lịch sử tự động.

Hóa đơn thay thế mới vẫn được lưu.

Ghi warning:

```text
ORIGINAL_INVOICE_NOT_IN_DATASET
```

và giữ original locator trong `relation.original` để có thể resolve sau này.

---

## 10. Xử lý hóa đơn điều chỉnh

Điều kiện:

```text
tchat == 3
OR
tthai == 3
```

Khuyến nghị primary classifier:

```text
tchat == 3
```

### 10.1 Nếu tìm thấy original

Cập nhật locally:

```text
original.tchat = giữ nguyên giá trị cũ, thông thường 1
original.tthai = 5
```

Không tải lại detail original.

Giữ nguyên toàn bộ dữ liệu detail cũ.

Có thể lưu reverse relation:

```ts
original.relationsFrom.push({
  kind: 'adjustment',
  invoiceKey: adjustment.key
});
```

### 10.2 Nhiều hóa đơn điều chỉnh cùng một hóa đơn gốc

Cho phép:

```text
Original A
├── Adjustment B
├── Adjustment C
└── Adjustment D
```

Không coi relation là one-to-one đối với adjustment.

Original giữ:

```text
tthai = 5
```

và danh sách relation reverse có thể chứa nhiều phần tử.

---

## 11. Trường hợp chuỗi quan hệ

Có thể xuất hiện:

```text
A
↓ replaced by
B
↓ adjusted by
C
```

hoặc các chuỗi quan hệ khác.

Không flatten mất quan hệ.

Mỗi hóa đơn lưu relation trực tiếp mà payload cung cấp:

```text
B → A
C → B
```

Ứng dụng có thể dựng graph:

```text
A ← B ← C
```

khi hiển thị.

Không tự suy diễn:

```text
C → A
```

nếu payload không nói như vậy.

---

## 12. Quy tắc hydrate detail

### 12.1 Hóa đơn đã có và có detail

```text
existing == true
hasDetail == true
```

Bất kể hóa đơn xuất hiện từ:

```text
main incremental query
hoặc
ttxly==6 supplement query
```

thì:

```text
KHÔNG gọi detail lại
```

### 12.2 Hóa đơn đã có nhưng thiếu detail

```text
existing == true
hasDetail == false
```

thì:

```text
hydrate detail exactly once
```

### 12.3 Hóa đơn mới

```text
existing == false
```

thì:

```text
hydrate detail
```

Sau hydrate, merge vào dataset.

### 12.4 Hóa đơn gốc bị thay thế / điều chỉnh

Nếu original đã tồn tại:

```text
KHÔNG hydrate original
```

Chỉ cập nhật relation-derived status locally.

---

## 13. Thứ tự xử lý đề xuất

```text
1. Load dataset JSON
2. Build invoice index
3. Đọc normalCoverageToDate
4. Tính main incremental window
5. Tính ttxly==6 supplement window
6. Query main incremental list
7. Query purchase/standard ttxly==6 supplement
8. Normalize toàn bộ list item
9. Deduplicate giữa các query
10. Phân loại existing/new
11. Parse relation tchat=2/3
12. Resolve original locator trong dataset
13. Cập nhật original.tthai locally:
       replacement → 4
       adjustment  → 5
14. Lập hydration queue:
       new invoice
       existing missing detail
15. KHÔNG cho existing complete vào hydration queue
16. Hydrate queue
17. Merge summary/detail vào dataset
18. Gắn reverse relation nếu cần
19. Update sync metadata khi các query bắt buộc đã thành công
20. Save JSON khi người dùng yêu cầu
```

---

## 14. Sync metadata đề xuất

```ts
export interface DatasetSyncMetadata {
  lastSuccessfulSyncAt?: string;

  normalCoverage?: {
    fromDate?: string;
    toDate?: string;
  };

  ttxly6Supplement?: {
    lastFromDate?: string;
    lastToDate?: string;
    lastSuccessfulSyncAt?: string;
  };
}
```

Ví dụ:

```json
{
  "sync": {
    "lastSuccessfulSyncAt": "2026-05-16T09:30:00+07:00",
    "normalCoverage": {
      "fromDate": "2026-01-01",
      "toDate": "2026-05-16"
    },
    "ttxly6Supplement": {
      "lastFromDate": "2026-04-01",
      "lastToDate": "2026-05-16",
      "lastSuccessfulSyncAt": "2026-05-16T09:30:00+07:00"
    }
  }
}
```

### 14.1 Không nâng watermark khi query bù lỗi

Nếu main query thành công nhưng `ttxly==6 supplement` lỗi:

- không giả định supplement đã hoàn tất;
- giữ metadata `ttxly6Supplement.lastSuccessfulSyncAt` cũ;
- trả partial warning;
- lần sau chạy lại supplement window cần thiết.

Không được vì main query thành công mà ghi supplement thành công.

---

## 15. Pseudocode tổng thể

```ts
async function incrementalSync(dataset, requestedToDate) {
  const existing = buildDatasetIndex(dataset.documents);

  const mainWindow = getMainIncrementalWindow(
    dataset.sync?.normalCoverage?.toDate,
    requestedToDate
  );

  const ttxly6Window = {
    fromDate: firstDayOfPreviousMonth(requestedToDate),
    toDate: requestedToDate
  };

  const main = await queryMainWindow(mainWindow);

  const latePurchase = await queryPurchaseInvoices({
    fromDate: ttxly6Window.fromDate,
    toDate: ttxly6Window.toDate,
    ttxly: 6
  });

  const summaries = deduplicateByCanonicalKey([
    ...main.documents,
    ...latePurchase.documents
  ]);

  const hydrateQueue = [];

  for (const fresh of summaries) {
    const old = existing.byKey.get(fresh.key);

    if (fresh.relation) {
      const originalKey = buildOriginalKey(
        fresh.relation.original
      );

      const original = existing.byBusinessLocator.get(
        originalKey
      );

      if (original) {
        if (fresh.relation.kind === 'replacement') {
          original.invoiceStatus = 4;
        }

        if (fresh.relation.kind === 'adjustment') {
          original.invoiceStatus = 5;
        }

        attachReverseRelation(original, fresh);
      } else {
        addWarning(
          fresh,
          'ORIGINAL_INVOICE_NOT_IN_DATASET'
        );
      }
    }

    if (!old) {
      hydrateQueue.push(fresh);
      continue;
    }

    mergeSummaryPreservingDetail(old, fresh);

    if (!hasDetail(old)) {
      hydrateQueue.push(old);
    }
  }

  await hydrateExactlyOnce(hydrateQueue);

  mergeIntoDataset(dataset, summaries);

  return dataset;
}
```

---

## 16. Thống kê đồng bộ đề xuất

Response backend nên trả:

```ts
interface IncrementalSyncStats {
  mainFound: number;
  ttxly6SupplementFound: number;

  duplicateAcrossQueries: number;

  existingComplete: number;
  existingMissingDetail: number;
  newDocuments: number;

  replacementFound: number;
  adjustmentFound: number;

  originalMatched: number;
  originalNotFound: number;

  originalMarkedReplaced: number;
  originalMarkedAdjusted: number;

  detailHydrated: number;
  detailSkipped: number;
}
```

WebUI có thể hiển thị:

```text
Đồng bộ hoàn tất

Hóa đơn mới:                         37
Hóa đơn từ kiểm tra bù ttxly=6:      4
Hóa đơn đã có, bỏ qua detail:        21
Hóa đơn được hydrate mới:            20

Hóa đơn thay thế phát hiện:           2
Hóa đơn điều chỉnh phát hiện:         1
Hóa đơn gốc khớp trong dataset:       3
Hóa đơn gốc không có trong dataset:   0
```

---

## 17. Invariant bắt buộc

### INV-01 — Không full-history refresh mặc định

Nếu JSON đã có lịch sử cũ, hệ thống không tự query lại toàn bộ lịch sử chỉ để refresh status.

### INV-02 — Existing complete không gọi detail

```text
existing && hasDetail
→ detailCalls = 0
```

### INV-03 — Hóa đơn thay thế tự cập nhật original

```text
new.tchat == 2
+ original locator match
→ original.tthai = 4
```

không cần query lại original.

### INV-04 — Hóa đơn điều chỉnh tự cập nhật original

```text
new.tchat == 3
+ original locator match
→ original.tthai = 5
```

không cần query lại original.

### INV-05 — Không dùng portal ID để resolve original

Original phải resolve bằng:

```text
nbmst + khmshdgoc + khhdgoc + shdgoc
```

### INV-06 — Supplement `ttxly==6` có giới hạn

```text
supplementFromDate =
first day of previous calendar month(toDate)

supplementToDate =
toDate
```

Không query `ttxly==6` từ ngày đầu dataset trong chế độ mặc định.

### INV-07 — Deduplicate trước hydrate

Cùng một hóa đơn xuất hiện từ main query và supplement query:

```text
detailCalls <= 1
```

### INV-08 — Không xóa record chỉ vì không được trả về

Absence from incremental query không thay đổi existence/status của record cũ.

### INV-09 — Không mất cached detail

Merge summary mới không được ghi đè:

```text
rawDetail
lines
detail-derived dynamic fields
detail-derived tax data
```

bằng giá trị rỗng từ list payload.

---

## 18. Edge cases bắt buộc xử lý

### 18.1 `tchat=2/3` nhưng original locator thiếu

Không cập nhật bất kỳ invoice cũ nào.

Warning:

```text
RELATION_LOCATOR_INCOMPLETE
```

### 18.2 Original locator match nhiều record

Đây là data integrity conflict.

Không tự chọn.

Warning:

```text
ORIGINAL_LOCATOR_AMBIGUOUS
```

### 18.3 Original không nằm trong JSON

Không full-history query tự động.

Giữ relation dangling:

```text
ORIGINAL_INVOICE_NOT_IN_DATASET
```

Có thể cho phép người dùng chạy chức năng audit/resolve riêng.

### 18.4 Hóa đơn đã có xuất hiện lại trong supplement

Nếu `hasDetail=true`:

```text
merge summary
skip detail
```

### 18.5 Main query và supplement cùng trả hóa đơn thay thế

Relation processing chỉ chạy một lần sau deduplicate.

### 18.6 `toDate` là tháng 1

Ví dụ:

```text
toDate = 2027-01-10
```

supplement phải là:

```text
2026-12-01 → 2027-01-10
```

### 18.7 Seller gửi dữ liệu trễ hơn cửa sổ một tháng

Cửa sổ bù “tháng liền trước + tháng hiện tại đến `toDate`” là chính sách tối ưu hiệu năng, không phải bảo đảm toán học rằng mọi dữ liệu trễ đều được phát hiện.

Nếu người bán chuyển dữ liệu trễ hơn phạm vi này, chế độ mặc định có thể không phát hiện.

Vì vậy nên có chức năng riêng:

```text
Kiểm tra toàn bộ / Audit lịch sử
```

do người dùng chủ động chạy khi cần đối soát toàn diện.

---

## 19. Chế độ audit toàn bộ

Relation-driven incremental sync là chế độ mặc định.

Ứng dụng nên giữ một thao tác riêng:

```text
[Kiểm tra lại toàn bộ trạng thái]
```

Chế độ audit có thể:

- query lại khoảng lịch sử do người dùng chọn;
- refresh summary/status rộng hơn;
- tìm relation còn dangling;
- kiểm tra dữ liệu `ttxly==6` ngoài cửa sổ bù mặc định.

Không được chạy full audit mặc định mỗi lần mở JSON.

---

## 20. Test cases bắt buộc

### TC-01 — Replacement match original

Dataset:

```text
C26TJB / 109 / tthai=1
```

Query trả:

```text
C26TJB / 116
tchat=2
khmshdgoc=1
khhdgoc=C26TJB
shdgoc=109
```

Expected:

```text
109.tthai = 4
116 được thêm
detail(109) = 0 calls
```

### TC-02 — Adjustment match original

Dataset:

```text
C26TAB / 839 / tthai=1
```

Query trả:

```text
C26TAB / 843
tchat=3
khmshdgoc=1
khhdgoc=C26TAB
shdgoc=839
```

Expected:

```text
839.tthai = 5
843 được thêm
detail(839) = 0 calls
```

### TC-03 — Existing replacement already cached

Replacement đã có trong JSON và có detail.

Supplement trả lại invoice đó.

Expected:

```text
detailCalls = 0
```

### TC-04 — Existing invoice missing detail

Invoice đã có summary nhưng không có detail.

Expected:

```text
detailCalls = 1
```

### TC-05 — `ttxly==6` window May

```text
toDate = 2026-05-16
```

Expected:

```text
from = 2026-04-01
to   = 2026-05-16
```

### TC-06 — `ttxly==6` year boundary

```text
toDate = 2027-01-10
```

Expected:

```text
from = 2026-12-01
to   = 2027-01-10
```

### TC-07 — Duplicate main + supplement

Cùng canonical invoice xuất hiện trong cả hai response.

Expected:

```text
dataset count +1 tối đa
detailCalls <= 1
```

### TC-08 — Original missing

Replacement/adjustment có locator hợp lệ nhưng original không có trong dataset.

Expected:

```text
new invoice retained
warning ORIGINAL_INVOICE_NOT_IN_DATASET
no historical auto-query
```

### TC-09 — Incomplete relation

`tchat=3` nhưng `shdgoc=null`.

Expected:

```text
no original update
warning RELATION_LOCATOR_INCOMPLETE
```

### TC-10 — Preserve original detail

Original có `rawDetail`, `lines[]`.

Sau relation update:

```text
tthai thay đổi
rawDetail unchanged
lines unchanged
```

---

## 21. Khuyến nghị giao diện

Màn hình đồng bộ nên tách rõ:

```text
Phạm vi dữ liệu mới:
17/05/2026 → 12/09/2026

Kiểm tra bù hóa đơn chuyển muộn (ttxly=6):
01/08/2026 → 12/09/2026
```

Nếu đang đồng bộ dataset có:

```text
toDate = 16/05/2026
```

thì trước khi chạy hoặc trong log có thể hiển thị:

```text
Kiểm tra bù ttxly=6:
01/04/2026 → 16/05/2026
```

Sau chạy:

```text
Hóa đơn mới:                 37
Phát hiện qua ttxly=6:        4
Thay thế:                     2
Điều chỉnh:                   1
Gốc cập nhật locally:         3
Detail cũ được bỏ qua:       21
```

---

## 22. Ranh giới trách nhiệm backend/frontend

### Backend

Backend chịu trách nhiệm:

- query GDT;
- tính / nhận query windows;
- normalize;
- deduplicate;
- parse relation;
- quyết định hydration;
- bảo đảm existing complete không gọi detail;
- trả stats và warnings.

### Frontend / dataset layer

Frontend hoặc dataset service chịu trách nhiệm:

- giữ baseline JSON;
- xây index hóa đơn đã có;
- merge result vào dataset;
- preserve detail cũ;
- cập nhật relation-derived status;
- cập nhật sync metadata;
- hiển thị thống kê / cảnh báo.

Nếu sau này dataset được chuyển hoàn toàn xuống backend persistence, các invariant vẫn giữ nguyên; chỉ thay vị trí thực thi merge.

---

## 23. Kết luận kiến trúc

Phương án chốt:

> **Hóa đơn thay thế (`tchat/tthai=2`) và hóa đơn điều chỉnh (`tchat/tthai=3`) trực tiếp chứa locator của hóa đơn gốc qua `nbmst + khmshdgoc + khhdgoc + shdgoc`. Hóa đơn gốc không chứa ID của hóa đơn con; khi bị thay thế nó chuyển sang `tthai=4`, khi bị điều chỉnh nó chuyển sang `tthai=5`, trong khi `tchat` của hóa đơn gốc vẫn là `1`. Vì vậy ứng dụng không cần query lại toàn bộ lịch sử để phát hiện các thay đổi này. Khi hóa đơn mới xuất hiện, ứng dụng resolve original ngay trong JSON và cập nhật trạng thái gốc locally, không tải lại detail của original.**

Bổ sung bắt buộc cho hóa đơn chuyển dữ liệu muộn:

> **Mỗi lần đồng bộ phải thực hiện thêm một query `ttxly==6` cho hóa đơn mua vào standard, với `fromDate` là ngày 01 của tháng liền trước tháng chứa `toDate`, và `toDate` là ngày kết thúc đồng bộ. Ví dụ dataset đã truy vấn đến `16/05/2026` thì query bù `ttxly==6` là `01/04/2026 → 16/05/2026`. Kết quả được deduplicate với main query; hóa đơn đã có detail không bị tải lại, hóa đơn mới hoặc hóa đơn cũ thiếu detail mới được hydrate.**

Thiết kế này tối ưu request theo ba tầng:

```text
Không full-history scan
        +
relation-driven original status update
        +
bounded ttxly==6 late-arrival supplement
```

và vẫn giữ một chế độ **full audit thủ công** để xử lý nhu cầu đối soát lịch sử toàn diện khi cần.
