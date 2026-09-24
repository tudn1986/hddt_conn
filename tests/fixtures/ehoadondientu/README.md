Fixture provenance:

- `gdt-dataset.json` and `invoice.xml` preserve the provider identities, invoice locator, and `DLHDon/@Id` values from the reviewed production samples. Unrelated fields are omitted.
- `tracuu-production-capture.html` is a sanitized verbatim table fragment extracted from the `smple.txt` production response. The malformed production markup is intentionally preserved, including direct `<th>` children and the unclosed/reopened `lblData` / `lblStt` spans.
- `invoice.pdf` is a minimal valid PDF used only for byte validation. It is not the production invoice.
