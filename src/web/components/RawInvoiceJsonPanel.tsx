import React from 'react';
import { Button, Card, Space, Tabs, Typography } from 'antd';
import type { InvoiceDocument } from '../../shared/models/index.js';
import { sanitizeRawForDisplay } from '../../shared/provider-research.js';

const { Text } = Typography;

function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(sanitizeRawForDisplay(value), null, 2);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* best effort */ }
  };
  return (
    <Card
      size="small"
      extra={<Button size="small" onClick={() => void copy()}>Copy JSON</Button>}
      styles={{ body: { padding: 0 } }}
    >
      <pre style={{
        margin: 0,
        padding: 12,
        maxHeight: '58vh',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 12,
        lineHeight: 1.45,
      }}>
        {text}
      </pre>
    </Card>
  );
}

export default function RawInvoiceJsonPanel({ document }: { document: InvoiceDocument }) {
  const normalized = {
    key: document.key,
    direction: document.direction,
    invoiceSource: document.invoiceSource,
    providerCode: document.providerCode,
    providers: document.providers,
    lookup: document.lookup,
    seller: document.seller,
    buyer: document.buyer,
    templateNo: document.templateNo,
    series: document.series,
    invoiceNo: document.invoiceNo,
    issueDate: document.issueDate,
  };
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text type="secondary">
        Raw JSON giữ nguyên dữ liệu nghiệp vụ cần nghiên cứu như Fkey, PortalLink và mã tra cứu; các khóa bí mật phổ biến như password/cookie/token/CAPTCHA được che khi hiển thị.
      </Text>
      <Tabs
        size="small"
        items={[
          { key: 'summary', label: 'Raw Summary', children: <JsonBlock value={document.rawSummary ?? null} /> },
          { key: 'detail', label: 'Raw Detail', children: <JsonBlock value={document.rawDetail ?? null} /> },
          { key: 'normalized', label: 'Normalized', children: <JsonBlock value={normalized} /> },
        ]}
      />
    </Space>
  );
}
