# HDDT v1.1.0 — Query Auto Contract

## Input dimensions

```text
direction: purchase | sales
source: standard | pos
status: 5 | 6 | 8
```

Purchase mặc định nếu không truyền source: `standard,pos`. Sales mặc định: `standard` vì POS sales chưa xác minh.

`query-auto` nhận thêm `existingDocuments[]`: compact index của dataset đang mở. Index chỉ chứa identity/status/`hasDetail`, không chứa `lines` hoặc `rawDetail`.

## Chain model

```text
for month
  for source
    for status
      follow state cursor sequentially
```

Mỗi `month × source × status` có `state` riêng. Page size portal là 15 trong connector; không dùng `items.length < pageSize` để suy hết dữ liệu khi portal còn cursor.

## Identity

```text
direction|source|sellerTaxCode|templateNo|series|invoiceNo
```

Backend recompute key từ compact index và reject key không khớp locator.

`portalInvoiceId` và buyer tax code là consistency signal; canonical identity vẫn là business locator ở trên.

## Incremental hydration

Sau list, document được phân loại:

```text
NEW
  -> detail

EXISTING + hasDetail=false
  -> detail

EXISTING + hasDetail=true
  -> refresh summary/status only
  -> NEVER call detail
```

Detail endpoint theo source:

- standard `/api/query/invoices/detail`;
- pos `/api/sco-query/invoices/detail`.

Nếu một detail lỗi, summary được giữ và warning source-aware được trả. SessionExpired dừng phần online còn lại và trả partial result.

## Frontend merge

`response.documents` chỉ là tập document tìm thấy trong phạm vi refresh, không phải toàn bộ dataset.

WebUI phải merge theo key:

```text
current dataset + refreshed documents -> merged dataset
```

Không được replace dataset bằng response.

Với existing-complete, cached `rawDetail`/`lines` được giữ; summary/status mới được áp dụng.

## Limits

- 10.000 page / chain.
- 50.000 document merged / request.
- `existingDocuments` tối đa 100.000 compact refs.
- detail concurrency lấy từ network config.

## Output

`QueryAutoResult` giữ:

- `documents`;
- `warnings`;
- `partial/sessionExpired`;
- `chunks/completedChunks`;
- `pages`;
- `hydrated`;
- `sync`:
  - `found`;
  - `existing`;
  - `existingComplete`;
  - `existingMissingDetail`;
  - `newDocuments`;
  - `statusChanged`;
  - `detailSkipped`.

Chi tiết đầy đủ: `docs/INCREMENTAL_SYNC_v1.1.0.md`.
