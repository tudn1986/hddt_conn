# MISA production PDF route — v1.2.1 r4

Contract do UAT/browser capture xác nhận:

```text
POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID
Content-Type: application/x-www-form-urlencoded

transactionID=<TransactionID>
```

Lấy `customData` trong JSON response, sau đó:

```text
GET https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>
```

Ví dụ:

```text
customData = 0K7QE2QR
TransactionID = VLF4IVJPR_J7

https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=0K7QE2QR&Code=VLF4IVJPR_J7
```

Backend chịu trách nhiệm toàn bộ mapping; frontend chỉ gửi `InvoiceDocument`/invoice identity như thiết kế TVAN hiện tại.
