# HDDT v1.2.1 r5 — Financial totals hotfix

App version remains **1.2.1**. `r5` is only the source revision.

## Fixed symptom

Invoice table columns **Tiền HHDV** (`subtotal`) and **Tiền thuế** (`vatAmount`) could be blank for GDT records with `ttxly=5`, especially document type `hdon=02` and `hdon=06/06_01`.

## Root causes

1. The normalizer only read standard fields such as `tgtcthue` and `tgtthue`.
2. MISA stores invoice-level totals for these document types in dynamic arrays, for example `TotalAmountWithoutVATOC`, `TotalVATAmountOC`, `StockTotalAmountOC`.
3. Some type-02 providers omit subtotal/VAT but do provide `tgtttbso` because the document is no-VAT.
4. Type-06 providers may only expose the amount in hydrated `hdhhdvu` detail rows.
5. A detail response containing an empty `ttkhac/ttttkhac` array could mask useful values that existed in the list summary.
6. Previously saved datasets could contain blank normalized financial fields even though their raw payload still contained enough data.

## Implementation

- Added `src/shared/normalizer/financial-amounts.ts`.
- Resolve financial values from both summary and detail instead of from the merged object only.
- For foreign-currency invoices, prefer `...OC` provider fields before base-currency fields.
- Subtotal resolution order: standard field → provider invoice total → tax summary → hydrated line totals → no-VAT grand-total fallback.
- VAT resolution order: standard field → provider invoice total → tax summary → hydrated line VAT → `0` for document type 02 and 06/06_01.
- Line normalization now recognizes provider fields such as `AmountOC`, `AmountWithoutVATOC`, `VATAmountOC`.
- Dataset open/import repairs only missing `subtotal`/`vatAmount` from `rawSummary/rawDetail`; it does not overwrite status/relation decisions stored in the normalized dataset.
- Cached type-06 detail is considered incomplete if HHDV still cannot be resolved, allowing query-auto to hydrate it again.

## Important behavior for type 06

Some GDT list summaries for Viettel/FPT type `06_01` contain no amount at all. There is no correct amount that can be invented from such a summary. The application therefore resolves the amount from hydrated detail rows. Query-auto already hydrates new/missing-detail documents; existing incomplete cached type-06 documents are now marked for re-hydration.
