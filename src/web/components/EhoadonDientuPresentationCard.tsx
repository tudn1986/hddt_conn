import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import type { InvoiceDocument } from '../../shared/models/index.js';
import { api, downloadBlob } from '../api/client';

const { Text } = Typography;
const EHOADON_MSTTCGP = '0314743623';

function rawSolutionTaxCode(document: InvoiceDocument): string | undefined {
  const direct = document.providers?.solution?.taxCode;
  if (direct) return String(direct).trim();
  const candidates = [document.rawSummary, document.rawDetail];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const value = (candidate as Record<string, unknown>).msttcgp
      ?? (candidate as Record<string, unknown>).MSTTCGP;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  for (const field of document.dynamicFields || []) {
    if (String(field.name || '').trim().toLowerCase() === 'msttcgp') {
      const value = String(field.rawValue ?? '').trim();
      if (value) return value;
    }
  }
  return undefined;
}

export function isEhoadonDientuInvoice(document: InvoiceDocument): boolean {
  return rawSolutionTaxCode(document) === EHOADON_MSTTCGP;
}

export function ehoadonNeedsGdtXml(document: InvoiceDocument): boolean {
  return isEhoadonDientuInvoice(document) && !String(document.lookup?.lookupCode || '').trim();
}
export default function EhoadonDientuPresentationCard({
  document,
  authenticated,
}: {
  document: InvoiceDocument;
  authenticated: boolean;
}) {
  const supportedHere = useMemo(() => isEhoadonDientuInvoice(document), [document]);
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!supportedHere) return null;

  const needsGdtXml = ehoadonNeedsGdtXml(document);
  const ensureReady = () => {
    if (needsGdtXml && !authenticated) {
      setError('Hóa đơn này không có mã tra cứu. Hãy đăng nhập GDT để backend tải XML và xác định bản thể hiện PDF.');
      return false;
    }
    return true;
  };

  const viewPdf = async () => {
    if (!ensureReady()) return;
    setBusy('view');
    setError(null);
    const popup = window.open('about:blank', '_blank');
    try {
      const blob = await api.viewTvanPdf(document);
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.replace(url);
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (requestError) {
      popup?.close();
      setError(requestError instanceof Error ? requestError.message : 'Không xem được PDF bản thể hiện.');
    } finally {
      setBusy(null);
    }
  };
  const downloadPdf = async () => {
    if (!ensureReady()) return;
    setBusy('download');
    setError(null);
    try {
      const result = await api.downloadTvanPdf(document);
      downloadBlob(result.blob, result.fileName);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không tải được PDF bản thể hiện.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card size="small" title="Bản thể hiện hóa đơn · ehoadondientu.com" style={{ marginTop: 16 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space wrap>
          <Text strong>MSTTCGP:</Text><Text code>{EHOADON_MSTTCGP}</Text>
          <Tag color="success">P1 · Không CAPTCHA</Tag>
          <Tag>{needsGdtXml ? 'Nguồn tham chiếu: XML GDT' : 'Nguồn tham chiếu: mã tra cứu'}</Tag>
        </Space>
        {needsGdtXml && !authenticated && (
          <Alert
            type="warning"
            showIcon
            message="Cần đăng nhập GDT"
            description="Hóa đơn không có mã tra cứu ehoadondientu; backend cần tải XML từ GDT để lấy DLHDon/@Id trước khi tải PDF."
          />
        )}
        {error && <Alert type="error" showIcon message="Không lấy được bản thể hiện" description={error} />}
        <Space wrap>
          <Button type="primary" icon={<EyeOutlined />} loading={busy === 'view'} onClick={() => void viewPdf()}>
            Xem PDF
          </Button>
          <Button icon={<DownloadOutlined />} loading={busy === 'download'} onClick={() => void downloadPdf()}>
            Tải PDF
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
