# HDDT v1.2.1 r8 — test report

## Scope

Viettel supervised CAPTCHA acquisition after live r7 evidence showed GET=200 token-only and guessed POST variants=405.

## Executed checks

- TypeScript/TSX syntax transpilation: **PASS**, 79 source/test `.ts/.tsx` files, 0 syntax diagnostics (declaration file excluded from transpilation by design).
- `.mjs` syntax (`node --check`): **PASS**.
- Viettel challenge-ready runtime harness: **PASS**.
  - GET `/captcha/get` token-only response is accepted as diagnostic but not shown as a blind challenge.
  - GET `/captcha/generate` with previously unknown image field names is discovered by image-signature scanning.
  - no POST is made during initial CAPTCHA probing.
  - challenge/session token values are not exposed in public probe output.
  - verify `{token, offsetX}` succeeds and session token is reused for `downloadPDF`.
  - returned PDF starts with `%PDF-`.
- Viettel token-only runtime harness: **PASS**.
  - supervised probe returns `status=token_only` rather than throwing;
  - raw JSON preview is returned with token value redacted;
  - Set-Cookie value is not exposed; cookie name may be shown for diagnostics.

## Full project tsc

`tsc -p tsconfig.server.json --noEmit` was attempted. The release workspace has no installed dependency/type tree, so TypeScript stops on missing Node/Fastify/ExcelJS/Yazl/Zod typings. No new non-dependency diagnostic was observed in the r8 Viettel changes; full project typecheck must still be run after `pnpm install --frozen-lockfile` on the deployment machine.

## Live acceptance still required

r8 intentionally does not claim that the live Viettel image schema has been solved. Its purpose is to produce enough safe production diagnostics directly on the Overview card so the next mapping can be made from evidence rather than guessed endpoints/bodies.
