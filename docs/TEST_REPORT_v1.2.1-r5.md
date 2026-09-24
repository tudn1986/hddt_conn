# HDDT v1.2.1 r5 — Test report

## Scope

Financial normalization fix for invoice table columns `subtotal` (Tiền HHDV) and `vatAmount` (Tiền thuế), with emphasis on `ttxly=5`, `hdon=02` and `hdon=06/06_01`.

## Production payload replay

The normalizer was transpiled with the system TypeScript compiler and executed against the supplied payload captures.

- MISA type `06_01`, USD: subtotal `6975.10`, VAT `0`; two detail lines `1047.56 + 5927.54`.
- Viettel type `06_01`, VND: subtotal `122265600`, VAT `0`; resolved from hydrated `hdhhdvu[].thtien`.
- MISA type `02`, USD: subtotal `4888.61`, VAT `0`; resolved from `TotalAmountWithoutVATOC` / `TotalVATAmountOC` while preserving line amounts in USD.
- GDT list capture `tthai=1, ttxly=5`: all type-02 rows that previously had blank subtotal/VAT now resolve subtotal from the supplied total and VAT `0`.
- MISA type-06 list rows resolve `StockTotalAmountOC` and VAT `0`.
- Viettel/FPT type-06 list-only rows correctly keep subtotal unresolved until detail hydration, while VAT resolves to `0`; no fabricated HHDV amount is written.

## Regression checks

- Ordinary VAT invoice (`hdon=01`) keeps standard `tgtcthue/tgtthue` values unchanged.
- Summary dynamic totals remain available even when detail contains empty dynamic containers.
- Foreign currency prefers `...OC` values, preventing VND totals from being shown in a USD row.
- Old dataset import fills only missing normalized `subtotal/vatAmount` from raw payload.
- Type-06 cached detail with unresolved subtotal is marked incomplete so incremental sync can hydrate it again.

## Static checks in packaging environment

- Source TS/TSX syntax transpile: 58 implementation files, 0 syntax diagnostics.
- Test TS/TSX syntax transpile: 21 test files, 0 syntax diagnostics.
- `.mjs` syntax: 7 scripts pass `node --check`.
- `tsc -p tsconfig.server.json`: dependency-enabled full check could not complete because this packaging environment does not contain `node_modules` / external typings. The emitted diagnostics are missing Node/Fastify/Zod/etc. dependencies; no semantic diagnostic was emitted for the new financial normalizer or incremental-sync code.

## Added tests

`tests/unit/normalizer.test.ts` now covers MISA type-02, Viettel type-02, MISA type-06, summary/detail masking, detail-line provider amount fields, and ordinary VAT regression. `tests/unit/dataset.test.ts` covers migration of blank financial fields. `tests/unit/incremental-sync.test.ts` covers re-hydration of unresolved cached type-06 detail.
