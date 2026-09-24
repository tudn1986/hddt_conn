# HDDT v1.2.1 r7 — Viettel supervised presentation flow

App version remains **1.2.1**. `r7` is a source revision for supervised production validation of `tvan_viettel` after the same approach was introduced for MISA in r6.

## Evidence used

The implementation intentionally separates evidence from assumptions:

- Supplied production capture confirms CAPTCHA verification:
  - `POST https://vinvoice.viettel.vn/api/services/einvoiceuaa/api/captcha/verify`
  - body `{token, offsetX}`
  - successful response returns a reusable token.
- Supplied production capture confirms PDF retrieval:
  - `POST https://vinvoice.viettel.vn/api/services/einvoicequery/sync/utility/downloadPDF?taxCode=<seller MST>`
  - JSON body `{supplierTaxCode, reservationCode, recaptcha}`.
- `CLA1.zip` is used only as supporting evidence for the challenge endpoints, primarily `/captcha/get` and `/captcha/refresh`.
- CLA1's older GET-with-headers PDF example is **not** used as the production contract because it conflicts with the supplied production capture.

## Goal

Make every Viettel step observable inside **Chi tiết hóa đơn → Tổng quan** before automatic view/batch behavior is accepted as production-ready:

1. Display `supplierTaxCode` and `reservationCode` extracted by the backend.
2. User presses **1. Lấy CAPTCHA Viettel**.
3. Backend gets a CAPTCHA and returns only the displayable challenge plus a safe request trace.
4. User solves the slider/text CAPTCHA and presses **2. Xác thực CAPTCHA**.
5. Backend sends the provider-private challenge token with `offsetX`/answer, stores the returned session token only in memory, and returns a masked verification trace.
6. Backend creates a safe `downloadPDF` request plan. The real `recaptcha` token is never returned to the browser.
7. User presses **3. Mở bản thể hiện PDF**. A new browser tab is opened by the user action; HDDT then performs the POST through the local backend and replaces the tab with the returned PDF blob.

## Supervision card

For `tvan_viettel`, the Overview tab now shows **Bản thể hiện hóa đơn · Viettel (giám sát)** beneath the normal invoice information.

The card shows:

- current state;
- seller MST / `supplierTaxCode`;
- secret lookup code / `reservationCode`;
- actual challenge endpoint, HTTP method, request body and HTTP status used by the successful challenge attempt;
- CAPTCHA background/piece and the selected `offsetX`;
- verify endpoint and masked request body;
- backend session-token expiry time;
- exact `downloadPDF` endpoint;
- masked download JSON body;
- whether a reusable backend token is ready;
- PDF MIME type, byte size and completion time after a successful fetch;
- a local blob link for reopening the fetched PDF during the current page session.

## Security boundary

The following values stay backend-only:

- Viettel challenge token returned by the CAPTCHA endpoint;
- reusable Viettel session token returned by `/captcha/verify`.

The WebUI receives placeholders:

- `[backend-private-challenge-token]`
- `[backend-private-session-token]`

The challenge image itself and `offsetX` are intentionally visible because they are the user-interaction data required to solve the CAPTCHA.

## Challenge discovery

The existing bounded discovery remains in place:

1. `/captcha/get`
2. `/captcha/refresh`
3. `/captcha/generate`
4. `/captcha`

For each endpoint HDDT tries a bounded set of GET/POST shapes. The first response that contains a token **and an image** becomes the supervised challenge. Token-only responses are not shown as blind-offset CAPTCHA.

## Acceptance criteria

Viettel is considered production-confirmed only when a real invoice demonstrates all of these in the card:

1. challenge image is visible;
2. verify returns success and the card reports a backend token expiry;
3. `downloadPDF` plan shows the expected MST and reservation code;
4. step 3 opens a valid PDF in the new tab;
5. the same session token can then be reused for another Viettel invoice without another CAPTCHA, subject to its TTL.

If step 1 still fails, capture the raw response of the successful browser request that provides the CAPTCHA image. Do not capture or publish reusable session tokens outside the local backend.
