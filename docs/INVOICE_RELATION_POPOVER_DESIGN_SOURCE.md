# HDDT_CON — Thiết kế hiển thị quan hệ hóa đơn thay thế / điều chỉnh

## 1. Mục tiêu

Tính năng bổ sung khả năng xem nhanh quan hệ nghiệp vụ của hóa đơn ngay tại bảng dữ liệu, chủ yếu trên hai cột:

**Số hóa đơn** và **Tình trạng hóa đơn**.

Khi người dùng hover, focus hoặc chạm/click vào một trong hai ô, ứng dụng hiển thị thông tin hóa đơn liên quan:

```text
Thay thế cho hóa đơn nào
Điều chỉnh cho hóa đơn nào
Bị thay thế bởi hóa đơn nào
Bị điều chỉnh bởi hóa đơn nào
```

Yêu cầu quan trọng:

```text
Không gọi GDT API khi hover.
Không query detail khi hover.
Không scan toàn bộ dataset mỗi lần hover.
```

Toàn bộ dữ liệu tooltip/popover phải được chuẩn bị từ dataset hiện có trong RAM.

---

# 2. Quan hệ đã xác minh từ payload GDT

## 2.1 Hóa đơn thay thế

Payload xác nhận hóa đơn thay thế có:

```text
tchat = 2
tthai = 2
```

và chứa locator của hóa đơn gốc:

```text
nbmst
khmshdgoc
khhdgoc
shdgoc
tdlhdgoc
gchdgoc
```

Ví dụ thực tế:

```text
Hóa đơn mới

nbmst       = 4601576518
khmshdon    = 1
khhdon      = C26TJB
shdon       = 116

tchat       = 2
tthai       = 2

Hóa đơn gốc

khmshdgoc   = 1
khhdgoc     = C26TJB
shdgoc      = 109
tdlhdgoc    = 2026-08-29T17:00:00Z
```

`gchdgoc` đồng thời mô tả đây là hóa đơn thay thế cho hóa đơn số 109.

Quan hệ:

```text
HĐ 116
tchat=2
tthai=2
      │
      │ replacement
      ▼
HĐ 109
tchat=1
tthai=4
```

---

## 2.2 Hóa đơn điều chỉnh

Hóa đơn điều chỉnh có:

```text
tchat = 3
tthai = 3
```

và dùng cùng cơ chế locator.

Ví dụ:

```text
Hóa đơn mới

nbmst       = 2301000920
khmshdon    = 1
khhdon      = C26TAB
shdon       = 843

tchat       = 3
tthai       = 3

Hóa đơn gốc

khmshdgoc   = 1
khhdgoc     = C26TAB
shdgoc      = 839
tdlhdgoc    = 2026-09-07T17:00:00Z
```

Payload cũng chứa mô tả điều chỉnh cho hóa đơn số 839.

Quan hệ:

```text
HĐ 843
tchat=3
tthai=3
      │
      │ adjustment
      ▼
HĐ 839
tchat=1
tthai=5
```

---

# 3. Quan hệ một chiều trong payload

Điểm rất quan trọng:

GDT cung cấp:

```text
Replacement / Adjustment
          ↓
       Original
```

nhưng không cung cấp trực tiếp chiều:

```text
Original
   ↓
Replacement / Adjustment
```

Ví dụ hóa đơn gốc số 109 khi đã bị thay thế:

```text
tchat = 1
tthai = 4

khmshdgoc = null
khhdgoc   = null
shdgoc    = null
tdlhdgoc  = null
gchdgoc   = null
```



Vì vậy ứng dụng phải tạo chiều ngược.

Kiến trúc:

```text
              PAYLOAD GDT
                  │
                  ▼
         Forward Relation
                  │
 replacement/adjustment
                  │
                  ▼
               original
                  │
                  │
                  ▼
        Application indexing
                  │
                  ▼
         Reverse Relation
                  │
                  ▼
 original → related invoices[]
```

---

# 4. Khóa xác định hóa đơn

## 4.1 Business locator

Để nối quan hệ, sử dụng:

```text
sellerTaxCode
+
templateNo
+
series
+
invoiceNo
```

Tương ứng raw GDT:

```text
nbmst
+
khmshdon
+
khhdon
+
shdon
```

Ví dụ:

```text
4601576518|1|C26TJB|109
```

---

## 4.2 Locator gốc từ hóa đơn mới

Với replacement/adjustment:

```text
nbmst
+
khmshdgoc
+
khhdgoc
+
shdgoc
```

Map:

```text
new.nbmst
       →
original.nbmst

new.khmshdgoc
       →
original.khmshdon

new.khhdgoc
       →
original.khhdon

new.shdgoc
       →
original.shdon
```

Không dùng:

```text
id
hsgoc
mhdon
```

để xác định quan hệ này.

---

# 5. Data model

## 5.1 Forward relation

```ts
export type InvoiceRelationKind =
  | 'replacement'
  | 'adjustment';

export interface InvoiceRelationTarget {
  sellerTaxCode: string;

  templateNo:
    | string
    | number;

  series: string;

  invoiceNo:
    | string
    | number;

  issuedAt?: string;
}

export interface InvoiceRelation {
  kind: InvoiceRelationKind;

  original: InvoiceRelationTarget;

  description?: string;
}
```

Trong `InvoiceDocument`:

```ts
export interface InvoiceDocument {
  key: string;

  direction:
    | 'purchase'
    | 'sold';

  invoiceSource:
    | 'standard'
    | 'pos';

  sellerTaxCode?: string;

  templateNo?:
    | string
    | number;

  series?: string;

  invoiceNo?:
    | string
    | number;

  issuedAt?: string;

  // tchat
  nature?:
    | string
    | number;

  // tthai
  invoiceStatus?:
    | string
    | number;

  relation?: InvoiceRelation;

  rawSummary?: unknown;
  rawDetail?: unknown;

  // other current fields...
}
```

`relation` là dữ liệu normalized từ payload.

---

# 6. Normalize relation từ GDT

```ts
export function normalizeInvoiceRelation(
  raw: Record<string, unknown>
): InvoiceRelation | undefined {

  const nature = Number(raw.tchat);

  if (
    nature !== 2 &&
    nature !== 3
  ) {
    return undefined;
  }

  const sellerTaxCode =
    normalizeString(raw.nbmst);

  const templateNo =
    normalizeScalar(raw.khmshdgoc);

  const series =
    normalizeString(raw.khhdgoc);

  const invoiceNo =
    normalizeScalar(raw.shdgoc);

  if (
    !sellerTaxCode ||
    templateNo == null ||
    !series ||
    invoiceNo == null
  ) {
    return undefined;
  }

  return {
    kind:
      nature === 2
        ? 'replacement'
        : 'adjustment',

    original: {
      sellerTaxCode,
      templateNo,
      series,
      invoiceNo,

      issuedAt:
        normalizeString(
          raw.tdlhdgoc
        )
    },

    description:
      normalizeString(
        raw.gchdgoc
      )
  };
}
```

Mapping:

| Payload | Model |
|---|---|
| `tchat=2` | `replacement` |
| `tchat=3` | `adjustment` |
| `nbmst` | `original.sellerTaxCode` |
| `khmshdgoc` | `original.templateNo` |
| `khhdgoc` | `original.series` |
| `shdgoc` | `original.invoiceNo` |
| `tdlhdgoc` | `original.issuedAt` |
| `gchdgoc` | `relation.description` |

---

# 7. Reverse relation

Reverse relation là dữ liệu **application-derived**, không phải field GDT.

Model:

```ts
export interface ReverseInvoiceRelation {
  kind: InvoiceRelationKind;

  sourceInvoiceKey: string;

  sellerTaxCode?: string;

  templateNo?:
    | string
    | number;

  series?: string;

  invoiceNo?:
    | string
    | number;

  issuedAt?: string;

  description?: string;
}
```

Index:

```ts
export type ReverseRelationIndex =
  Map<
    string,
    ReverseInvoiceRelation[]
  >;
```

Map key:

```text
business key của original
```

Map value:

```text
tất cả hóa đơn
replacement/adjustment
trỏ tới original đó
```

---

# 8. Vì sao phải dùng array

Không nên:

```ts
Map<
  string,
  ReverseInvoiceRelation
>
```

Nên:

```ts
Map<
  string,
  ReverseInvoiceRelation[]
>
```

vì một hóa đơn có thể có nhiều lần điều chỉnh:

```text
Original 100
│
├── Adjustment 105
├── Adjustment 108
└── Adjustment 112
```

UI phải có khả năng hiển thị toàn bộ.

---

# 9. Data flow khi load dataset

```text
JSON file
   │
   ▼
InvoiceDocument[]
   │
   ▼
Normalize forward relation
   │
   ├──────────────────┐
   │                  │
   ▼                  ▼
Business index    Reverse relation index
   │                  │
   └─────────┬────────┘
             ▼
       Relation context
             │
             ▼
       Invoice table
             │
     ┌───────┴───────┐
     ▼               ▼
Số hóa đơn      Tình trạng
     │               │
     └───────┬───────┘
             ▼
    Relation ViewModel
             │
             ▼
 Hover / Focus / Click
             │
             ▼
      Local Popover

       NO API CALL
```

---

# 10. Business index

Không dùng `documents.find()` mỗi khi hover.

Tạo index một lần:

```ts
export function buildBusinessKey(
  sellerTaxCode:
    | string
    | undefined,

  templateNo:
    | string
    | number
    | undefined,

  series:
    | string
    | undefined,

  invoiceNo:
    | string
    | number
    | undefined
): string | undefined {

  if (
    !sellerTaxCode ||
    templateNo == null ||
    !series ||
    invoiceNo == null
  ) {
    return undefined;
  }

  return [
    sellerTaxCode.trim(),
    String(templateNo).trim(),
    series.trim(),
    String(invoiceNo).trim()
  ].join('|');
}
```

Index:

```ts
export function buildInvoiceIndex(
  documents: InvoiceDocument[]
) {
  const result =
    new Map<
      string,
      InvoiceDocument[]
    >();

  for (const doc of documents) {
    const key =
      buildBusinessKey(
        doc.sellerTaxCode,
        doc.templateNo,
        doc.series,
        doc.invoiceNo
      );

    if (!key) continue;

    const bucket =
      result.get(key) ?? [];

    bucket.push(doc);

    result.set(
      key,
      bucket
    );
  }

  return result;
}
```

Array giúp phát hiện trường hợp bất thường:

```text
1 locator
→ nhiều record
```

khi đó không tự chọn hóa đơn.

---

# 11. Dựng reverse relation index

```ts
export function buildReverseRelationIndex(
  documents: InvoiceDocument[]
): ReverseRelationIndex {

  const result =
    new Map<
      string,
      ReverseInvoiceRelation[]
    >();

  for (const doc of documents) {

    const relation =
      doc.relation;

    if (!relation) {
      continue;
    }

    const originalKey =
      buildBusinessKey(
        relation.original
          .sellerTaxCode,

        relation.original
          .templateNo,

        relation.original
          .series,

        relation.original
          .invoiceNo
      );

    if (!originalKey) {
      continue;
    }

    const item:
      ReverseInvoiceRelation = {

      kind:
        relation.kind,

      sourceInvoiceKey:
        doc.key,

      sellerTaxCode:
        doc.sellerTaxCode,

      templateNo:
        doc.templateNo,

      series:
        doc.series,

      invoiceNo:
        doc.invoiceNo,

      issuedAt:
        doc.issuedAt,

      description:
        relation.description
    };

    const bucket =
      result.get(
        originalKey
      ) ?? [];

    const duplicate =
      bucket.some(
        x =>
          x.sourceInvoiceKey
          ===
          item.sourceInvoiceKey
      );

    if (!duplicate) {
      bucket.push(item);
    }

    result.set(
      originalKey,
      bucket
    );
  }

  return result;
}
```

Chi phí:

```text
Build index: O(n)
Lookup hover: O(1)
```

---

# 12. Relation ViewModel

UI không nên đọc:

```text
tchat
khmshdgoc
khhdgoc
...
```

trực tiếp.

Tạo lớp trung gian:

```ts
export type RelationTooltipMode =
  | 'replaces'
  | 'adjusts'
  | 'replaced-by'
  | 'adjusted-by'
  | 'none';

export interface RelatedInvoiceView {
  invoiceKey?: string;

  invoiceNo?: string;

  series?: string;

  templateNo?: string;

  issuedDate?: string;

  inDataset: boolean;
}

export interface RelationTooltipViewModel {
  mode: RelationTooltipMode;

  title: string;

  related:
    RelatedInvoiceView[];

  description?: string;

  ambiguous?: boolean;
}
```

---

# 13. ViewModel cho hóa đơn tthai=2/3

Hóa đơn replacement/adjustment có forward relation trực tiếp.

```ts
function buildForwardViewModel(
  doc: InvoiceDocument,

  index:
    Map<
      string,
      InvoiceDocument[]
    >
):
  RelationTooltipViewModel
  | undefined {

  if (!doc.relation) {
    return undefined;
  }

  const original =
    doc.relation.original;

  const key =
    buildBusinessKey(
      original.sellerTaxCode,
      original.templateNo,
      original.series,
      original.invoiceNo
    );

  if (!key) {
    return undefined;
  }

  const matches =
    index.get(key) ?? [];

  return {
    mode:
      doc.relation.kind
        === 'replacement'
        ? 'replaces'
        : 'adjusts',

    title:
      doc.relation.kind
        === 'replacement'
        ? 'Thay thế cho hóa đơn'
        : 'Điều chỉnh cho hóa đơn',

    related: [{
      invoiceKey:
        matches.length === 1
          ? matches[0].key
          : undefined,

      invoiceNo:
        String(
          original.invoiceNo
        ),

      series:
        String(
          original.series
        ),

      templateNo:
        String(
          original.templateNo
        ),

      issuedDate:
        formatVietnamDate(
          original.issuedAt
        ),

      inDataset:
        matches.length === 1
    }],

    description:
      doc.relation.description,

    ambiguous:
      matches.length > 1
  };
}
```

Ngay cả khi original không nằm trong JSON, UI vẫn hiển thị được:

```text
Thay thế cho hóa đơn

Số:       109
Ký hiệu:  C26TJB
Mẫu:      1
Ngày:     30/08/2026

Chưa có hóa đơn gốc
trong dữ liệu hiện tại
```

---

# 14. ViewModel cho hóa đơn tthai=4/5

Original không có forward relation.

Dùng reverse index:

```ts
function buildReverseViewModel(
  doc: InvoiceDocument,

  reverse:
    ReverseRelationIndex
):
  RelationTooltipViewModel
  | undefined {

  const status =
    Number(
      doc.invoiceStatus
    );

  if (
    status !== 4 &&
    status !== 5
  ) {
    return undefined;
  }

  const key =
    buildBusinessKey(
      doc.sellerTaxCode,
      doc.templateNo,
      doc.series,
      doc.invoiceNo
    );

  if (!key) {
    return undefined;
  }

  const expectedKind =
    status === 4
      ? 'replacement'
      : 'adjustment';

  const matches =
    (
      reverse.get(key)
      ?? []
    ).filter(
      item =>
        item.kind
        ===
        expectedKind
    );

  return {
    mode:
      status === 4
        ? 'replaced-by'
        : 'adjusted-by',

    title:
      status === 4
        ? 'Bị thay thế bởi'
        : 'Bị điều chỉnh bởi',

    related:
      matches.map(
        item => ({
          invoiceKey:
            item.sourceInvoiceKey,

          invoiceNo:
            item.invoiceNo == null
              ? undefined
              : String(
                  item.invoiceNo
                ),

          series:
            item.series == null
              ? undefined
              : String(
                  item.series
                ),

          templateNo:
            item.templateNo == null
              ? undefined
              : String(
                  item.templateNo
                ),

          issuedDate:
            formatVietnamDate(
              item.issuedAt
            ),

          inDataset:
            true
        })
      )
  };
}
```

---

# 15. Timezone

Không được lấy phần ngày bằng:

```ts
iso.substring(0, 10)
```

Ví dụ:

```text
2026-08-29T17:00:00Z
```

theo giờ Việt Nam là:

```text
30/08/2026 00:00
```

Format:

```ts
export function formatVietnamDate(
  value?: string
):
  string
  | undefined {

  if (!value) {
    return undefined;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return undefined;
  }

  return new Intl.DateTimeFormat(
    'vi-VN',
    {
      timeZone:
        'Asia/Ho_Chi_Minh',

      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }
  ).format(date);
}
```

---

# 16. UX — cột Số hóa đơn

Layout bảng không nên bị kéo rộng.

Hiển thị:

```text
116 ↗
```

thay vì:

```text
116 - thay thế cho HĐ 109 ngày 30/08/2026
```

Indicator chỉ cho biết:

```text
invoice này có quan hệ
```

Hover:

```text
┌─────────────────────────────────┐
│ Thay thế cho hóa đơn            │
│                                 │
│ Số hóa đơn     109              │
│ Ký hiệu        C26TJB           │
│ Mẫu số         1                │
│ Ngày lập       30/08/2026       │
│                                 │
│ Hóa đơn có trong dữ liệu        │
└─────────────────────────────────┘
```

---

# 17. UX — cột Tình trạng

Cell:

```text
[ Thay thế ]
```

hoặc:

```text
[ Bị thay thế ]
```

chính badge/status label là trigger.

Hai cột phải dùng cùng:

```text
RelationTooltipViewModel
```

để tránh trường hợp:

```text
Số hóa đơn nói A
Status tooltip nói B
```

---

# 18. UX cho adjustment

Ví dụ forward:

```text
┌─────────────────────────────────┐
│ Điều chỉnh cho hóa đơn          │
│                                 │
│ Số hóa đơn     839              │
│ Ký hiệu        C26TAB           │
│ Ngày lập       08/09/2026       │
│                                 │
│ Điều chỉnh giảm tiền thuế       │
│ GTGT 12.226.560...              │
└─────────────────────────────────┘
```

`gchdgoc` có thể hiển thị dưới dạng description.

Không nên hiển thị toàn bộ text rất dài nếu vượt kích thước popover.

---

# 19. UX cho nhiều adjustment

Ví dụ original có ba adjustment:

```text
HĐ 100
├── HĐ 105
├── HĐ 108
└── HĐ 112
```

Popover:

```text
┌─────────────────────────────────┐
│ Bị điều chỉnh bởi 3 hóa đơn     │
│                                 │
│ HĐ 105 · C26ABC · 05/06/2026    │
│ HĐ 108 · C26ABC · 12/06/2026    │
│ HĐ 112 · C26ABC · 25/06/2026    │
└─────────────────────────────────┘
```

Nếu có quá nhiều:

```text
HĐ 105 · 05/06/2026
HĐ 108 · 12/06/2026
HĐ 112 · 25/06/2026

+ 4 hóa đơn khác
```

---

# 20. Tooltip hay Popover?

Về hình thức:

```text
giống tooltip
```

nhưng về semantics nên dùng:

```text
Popover
```

vì nội dung có thể chứa:

```text
link
button
invoice navigation
```

Tooltip chuẩn không nên chứa interactive element.

Tên component:

```text
InvoiceRelationPopover
```

---

# 21. React component mô phỏng

```tsx
type RelationTriggerProps = {
  document:
    InvoiceDocument;

  model?:
    RelationTooltipViewModel;

  children:
    React.ReactNode;

  onOpenInvoice?:
    (
      invoiceKey: string
    ) => void;
};

export function RelationTrigger({
  document,
  model,
  children,
  onOpenInvoice
}: RelationTriggerProps) {

  if (
    !model ||
    model.mode === 'none'
  ) {
    return <>{children}</>;
  }

  return (
    <InvoiceRelationPopover
      content={
        <RelationContent
          model={model}
          onOpenInvoice={
            onOpenInvoice
          }
        />
      }
    >
      <button
        type="button"
        className={
          'invoice-relation-trigger'
        }
        aria-label={
          buildRelationAriaLabel(
            document,
            model
          )
        }
      >
        {children}

        <RelationIndicator />
      </button>
    </InvoiceRelationPopover>
  );
}
```

Cột số hóa đơn:

```tsx
<RelationTrigger
  document={invoice}
  model={relationModel}
  onOpenInvoice={
    openInvoice
  }
>
  {invoice.invoiceNo}
</RelationTrigger>
```

Cột tình trạng:

```tsx
<RelationTrigger
  document={invoice}
  model={relationModel}
  onOpenInvoice={
    openInvoice
  }
>
  <InvoiceStatusBadge
    status={
      invoice.invoiceStatus
    }
  />
</RelationTrigger>
```

---

# 22. Nội dung Popover

```tsx
export function RelationContent({
  model,
  onOpenInvoice
}: {
  model:
    RelationTooltipViewModel;

  onOpenInvoice?:
    (
      key: string
    ) => void;
}) {

  return (
    <div
      className={
        'invoice-relation-content'
      }
    >
      <div
        className={
          'relation-heading'
        }
      >
        {model.title}
      </div>

      {model.related.length === 0
        ? (
          <div
            className={
              'relation-empty'
            }
          >
            Chưa có thông tin
            hóa đơn liên quan
            trong dữ liệu hiện tại.
          </div>
        )
        : (
          <div
            className={
              'relation-list'
            }
          >
            {model.related.map(
              (
                related,
                index
              ) => (
                <button
                  key={
                    related.invoiceKey
                    ?? index
                  }
                  type="button"
                  disabled={
                    !related.invoiceKey
                  }
                  onClick={() => {
                    if (
                      related.invoiceKey
                    ) {
                      onOpenInvoice?.(
                        related.invoiceKey
                      );
                    }
                  }}
                >
                  <strong>
                    HĐ {
                      related.invoiceNo
                      ?? '—'
                    }
                  </strong>

                  {related.series && (
                    <span>
                      {related.series}
                    </span>
                  )}

                  {related.issuedDate && (
                    <span>
                      {
                        related.issuedDate
                      }
                    </span>
                  )}
                </button>
              )
            )}
          </div>
        )}

      {model.description && (
        <div
          className={
            'relation-description'
          }
        >
          {model.description}
        </div>
      )}
    </div>
  );
}
```

---

# 23. Build index trong React

```tsx
const relationContext =
  useMemo(
    () => ({
      businessIndex:
        buildInvoiceIndex(
          documents
        ),

      reverseIndex:
        buildReverseRelationIndex(
          documents
        )
    }),
    [documents]
  );
```

ViewModel:

```tsx
const relationModels =
  useMemo(() => {

    const result =
      new Map<
        string,
        RelationTooltipViewModel
      >();

    for (
      const doc
      of documents
    ) {

      const forward =
        buildForwardViewModel(
          doc,
          relationContext
            .businessIndex
        );

      const reverse =
        forward
          ? undefined
          : buildReverseViewModel(
              doc,
              relationContext
                .reverseIndex
            );

      const model =
        forward
        ?? reverse;

      if (model) {
        result.set(
          doc.key,
          model
        );
      }
    }

    return result;

  }, [
    documents,
    relationContext
  ]);
```

Trong row:

```ts
const relationModel =
  relationModels.get(
    invoice.key
  );
```

O(1).

---

# 24. Khi nào rebuild index?

Index rebuild khi:

```text
Load JSON mới
Merge incremental sync
Thêm hóa đơn mới
Relation mới xuất hiện
Reset dataset
```

Không rebuild khi:

```text
Hover
Focus
Open popover
Close popover
Sort table
Filter table
```

Sort/filter chỉ tác động view.

---

# 25. Data flow sau incremental sync

```text
GDT
 │
 ▼
incremental list
 │
 ▼
normalize
 │
 ├── relation tchat=2
 │
 ├── relation tchat=3
 │
 ▼
hydrate new/missing only
 │
 ▼
merge dataset
 │
 ├── replacement
 │      original.tthai = 4
 │
 └── adjustment
        original.tthai = 5
 │
 ▼
React documents state
 │
 ▼
rebuild relation indexes
 │
 ▼
popover immediately ready
```

Không cần một bước API bổ sung.

---

# 26. Có cần persist reverse relation không?

Khuyến nghị:

```text
Không.
```

Persist:

```text
forward relation
```

vì đó là dữ liệu normalized trực tiếp từ GDT.

Không persist:

```text
affectedBy[]
```

vì nó hoàn toàn có thể dựng lại từ dataset.

Lợi ích:

```text
Không duplicate dữ liệu
Không có hai nguồn relation bị lệch
JSON gọn hơn
Dễ migration
```

---

# 27. Trường hợp original không có trong dataset

Forward relation vẫn đủ để hiển thị:

```text
Thay thế cho hóa đơn

HĐ 109
C26TJB
30/08/2026

Chưa có hóa đơn gốc
trong dữ liệu hiện tại
```

Đây không phải error.

Nguyên nhân có thể là:

```text
original nằm ngoài khoảng JSON
dataset bắt đầu sau ngày original
người dùng chỉ load một phần dữ liệu
```

Không gọi API tự động khi hover.

---

# 28. Status 4/5 nhưng không tìm thấy reverse relation

Ví dụ JSON có:

```text
HĐ 109
tthai=4
```

nhưng HĐ 116 chưa có trong dataset.

Popover:

```text
Bị thay thế

Chưa có thông tin
hóa đơn thay thế
trong dữ liệu hiện tại.
```

Không hiển thị:

```text
Lỗi
```

vì dataset có thể cố ý không bao phủ invoice liên quan.

---

# 29. Relation chain

Ví dụ:

```text
A
↓ replacement
B
↓ adjustment
C
```

Lưu:

```text
B → A
C → B
```

Reverse index:

```text
A → B
B → C
```

Không tự tạo:

```text
C → A
```

nếu payload không xác nhận.

Trong table popover chỉ nên hiển thị relation trực tiếp phù hợp trạng thái.

Invoice Detail có thể hiển thị graph đầy đủ.

---

# 30. Accessibility

Không thiết kế chỉ cho mouse.

Trigger phải hỗ trợ:

```text
Hover
Focus
Click / Tap
Escape
```

Nên dùng:

```html
<button type="button">
```

hoặc component popover có semantics tương đương.

Ví dụ aria label:

```text
Hóa đơn 116,
hóa đơn thay thế,
thay thế cho hóa đơn 109
ký hiệu C26TJB
ngày 30 tháng 8 năm 2026.
```

Không dùng màu làm tín hiệu duy nhất.

---

# 31. Visual design

Không cần thêm màu mạnh.

Status badge hiện tại vẫn là nguồn màu chính.

Relation indicator nên nhỏ:

```text
↗
↘
link icon
relation dot
```

Ví dụ:

```text
Số HĐ       Tình trạng

116 ↗       Thay thế

109 ↘       Bị thay thế

843 ↗       Điều chỉnh

839 ↘       Bị điều chỉnh
```

Ý nghĩa icon phải có accessible label.

---

# 32. Hành vi click

Nếu related invoice tồn tại trong dataset:

```text
Click related invoice
        ↓
Open Invoice Detail
```

Khuyến nghị mở detail hơn là scroll tới row vì row có thể:

```text
bị filter
ở page khác
không nằm trong viewport
```

---

# 33. Invariant mạng

Tính năng phải tuân thủ:

```text
Hover:
0 API requests

Focus:
0 API requests

Open popover:
0 API requests
```

Không được:

```ts
onMouseEnter={() =>
  api.getInvoice(...)
}
```

Không:

```ts
useEffect(() => {
  if (open) {
    fetchRelation();
  }
}, [open]);
```

Chỉ:

```ts
relationModels.get(
  invoice.key
);
```

---

# 34. Diagnostics

Các trạng thái bất thường nên log riêng:

```text
RELATION_LOCATOR_INCOMPLETE

RELATION_ORIGINAL_NOT_FOUND

RELATION_ORIGINAL_AMBIGUOUS

RELATION_STATUS_MISMATCH
```

Ví dụ:

```text
tchat=2
nhưng thiếu shdgoc
```

thì invoice vẫn hiển thị bình thường.

Không làm crash row.

---

# 35. Test — Replacement

Dataset ban đầu:

```text
109
tthai=1
```

Incremental trả:

```text
116
tchat=2
tthai=2
original=109
```

Sau merge:

```text
109.tthai = 4

116.relation.original
→ 109
```

Reverse index:

```text
109 → 116
```

Expected UI:

```text
Hover 116
→ Thay thế cho HĐ 109

Hover 109
→ Bị thay thế bởi HĐ 116
```

---

# 36. Test — Adjustment

Dataset:

```text
839
```

Incremental:

```text
843
tchat=3
original=839
```

Expected:

```text
839.tthai = 5
```

UI:

```text
Hover 843
→ Điều chỉnh cho HĐ 839

Hover 839
→ Bị điều chỉnh bởi HĐ 843
```

---

# 37. Test — Multiple adjustment

Dataset:

```text
Original 100
```

Relations:

```text
105 → 100
108 → 100
112 → 100
```

Expected:

```text
reverseIndex[100].length
= 3
```

Popover:

```text
Bị điều chỉnh bởi
3 hóa đơn
```

---

# 38. Test — Original ngoài dataset

Input:

```text
Replacement 116
relation → 109
```

nhưng:

```text
109 not in dataset
```

Expected:

```text
Forward popover vẫn hiển thị:
109
C26TJB
30/08/2026

inDataset=false
```

Không request network.

---

# 39. Test timezone

Input:

```text
2026-08-29T17:00:00Z
```

Expected:

```text
30/08/2026
```

khi hiển thị theo timezone Việt Nam.

---

# 40. Performance

Với `n` invoice:

```text
normalize relation:
O(n)

build business index:
O(n)

build reverse relation:
O(n)

build view models:
O(n)

hover lookup:
O(1)
```

Không duplicate:

```text
rawDetail
lines
tax data
```

Reverse relation chỉ chứa metadata rất nhỏ.

---

# 41. Phân chia source code

Khuyến nghị kiến trúc:

```text
src/shared/invoice-relations/
    keys.ts

    normalize-relation.ts

    relation-index.ts

    relation-view-model.ts

src/web/components/invoices/
    InvoiceRelationPopover.tsx

    InvoiceRelationContent.tsx
```

Trách nhiệm:

```text
normalizer
→ raw GDT → forward relation

relation-index
→ forward → reverse map

relation-view-model
→ domain → UI model

React
→ chỉ render UI model
```

React component không đọc trực tiếp:

```text
khmshdgoc
shdgoc
tchat
```

---

# 42. Acceptance criteria

Tính năng hoàn thành khi:

```text
tthai=2:
hiển thị original number,
series và date

tthai=3:
hiển thị original number,
series và date

tthai=4:
hiển thị replacement
nếu replacement có trong dataset

tthai=5:
hiển thị một hoặc nhiều
adjustment liên quan

Không request API khi hover

Ngày đúng timezone Việt Nam

Không crash khi related invoice
không tồn tại

Relation tự cập nhật sau
incremental merge
```

---

# 43. Kết luận kiến trúc

Kiến trúc cuối cùng:

```text
             GDT PAYLOAD
                  │
                  ▼
        Normalize Invoice
                  │
                  ▼
        Forward Relation
                  │
   replacement/adjustment
                  │
                  ▼
              original
                  │
                  ▼
        Dataset documents[]
                  │
          ┌───────┴───────┐
          ▼               ▼
   Business Index    Reverse Index
                          │
                          ▼
                 original → related[]
          └───────┬───────┘
                  ▼
         Relation ViewModel
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  Invoice number       Status badge
        │                   │
        └─────────┬─────────┘
                  ▼
       InvoiceRelationPopover
```

Điểm quan trọng nhất của giải pháp:

> **Hóa đơn thay thế/điều chỉnh tự mang locator của hóa đơn gốc nên chiều forward có thể hiển thị trực tiếp. Hóa đơn bị thay thế/bị điều chỉnh không mang locator ngược, nên ứng dụng dựng reverse relation index từ toàn dataset. Sau khi index được tạo, mọi thao tác hover/focus/click chỉ là lookup trong RAM, không phát sinh truy vấn GDT.**

Thiết kế này phù hợp trực tiếp với cơ chế relation-driven incremental sync hiện tại và có thể triển khai mà không thay đổi nguyên tắc “không tải lại detail hóa đơn cũ”.