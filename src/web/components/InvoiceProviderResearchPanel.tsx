import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, List, Space, Tag, Typography } from 'antd';
import type { InvoiceDocument, TvanPresentationLinkResult } from '../../shared/models/index.js';
import { providerResearchFor } from '../../shared/provider-research.js';
import { api } from '../api/client';

const { Link, Text, Paragraph } = Typography;

const SOURCE_LABEL: Record<string, string> = {
  dataset: 'Dataset / Raw JSON',
  adapter: 'Adapter đã xác minh',
  official: 'Nguồn nhà cung cấp',
  community: 'Cộng đồng / discovery',
};

const SOURCE_COLOR: Record<string, string> = {
  dataset: 'blue',
  adapter: 'green',
  official: 'cyan',
  community: 'gold',
};

export default function InvoiceProviderResearchPanel({
  document,
  authenticated,
}: {
  document: InvoiceDocument;
  authenticated: boolean;
}) {
  const research = useMemo(() => providerResearchFor(document), [document]);
  const [resolved, setResolved] = useState<TvanPresentationLinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveFromBackend = async () => {
    setBusy(true);
    setError(null);
    try {
      setResolved(await api.resolveTvanPresentationLink(document));
    } catch (requestError) {
      setResolved(null);
      setError(requestError instanceof Error ? requestError.message : 'Không phân giải được thông tin tra cứu từ backend/XML.');
    } finally {
      setBusy(false);
    }
  };

  const missingCoreEvidence = !research.lookupCode && !research.portals.length;
  const unsupported = !research.supportedByKnownAdapter;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Nhà cung cấp & thông tin tra cứu">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="NCC HĐĐT">{research.providerName || 'Chưa xác định'}</Descriptions.Item>
          <Descriptions.Item label="MSTTCGP"><Text code>{research.solutionTaxCode || '—'}</Text></Descriptions.Item>
          <Descriptions.Item label="Transport code">{document.providers?.transport?.code || document.providerCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="MST transport"><Text code>{document.providers?.transport?.taxCode || '—'}</Text></Descriptions.Item>
          <Descriptions.Item label="Presentation adapter">
            {research.adapterCode ? <Tag color="green">{research.adapterCode}</Tag> : <Tag>Chưa có adapter</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Trạng thái">
            {research.supportedByKnownAdapter ? <Tag color="success">Đã có workflow PDF</Tag> : <Tag color="warning">Đang nghiên cứu</Tag>}
          </Descriptions.Item>
        </Descriptions>
        {research.known?.note && <Alert style={{ marginTop: 12 }} type="info" showIcon message={research.known.note} />}
      </Card>

      <Card size="small" title="Mã tra cứu">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Mã tra cứu" span={2}>
            {research.lookupCode ? <Text code copyable>{research.lookupCode}</Text> : <Text type="secondary">Chưa tìm thấy trong dataset hiện tại</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Loại mã">{research.lookupCodeType || '—'}</Descriptions.Item>
          <Descriptions.Item label="Confidence">{research.lookupConfidence || '—'}</Descriptions.Item>
          <Descriptions.Item label="Nguồn" span={2}>{research.lookupSource || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title="Portal / URL tra cứu hóa đơn">
        {research.portals.length ? (
          <List
            size="small"
            dataSource={research.portals}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color={SOURCE_COLOR[item.source]}>{SOURCE_LABEL[item.source]}</Tag>
                    <Tag>{item.confidence}</Tag>
                    <Text strong>{item.label}</Text>
                  </Space>
                  <Link href={item.url} target="_blank" rel="noreferrer">{item.url}</Link>
                  {item.note && <Text type="secondary">{item.note}</Text>}
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Alert type="warning" showIcon message="Chưa có portal/link tra cứu đáng tin cậy trong dataset hoặc knowledge hiện tại." />
        )}
      </Card>

      <Card size="small" title="Phân giải qua backend / XML GDT">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Nút này gọi workflow provider hiện có. Nếu dataset thiếu mã tra cứu, adapter có thể dùng XML GDT để tìm Fkey/mã tra cứu/providerRef.
          </Paragraph>
          {!authenticated && research.supportedByKnownAdapter && !research.lookupCode && (
            <Alert type="warning" showIcon message="Nếu adapter cần XML GDT, hãy đăng nhập GDT trước khi phân giải." />
          )}
          <Button loading={busy} disabled={!research.supportedByKnownAdapter} onClick={() => void resolveFromBackend()}>
            Phân giải thông tin tra cứu
          </Button>
          {error && <Alert type="error" showIcon message={error} />}
          {resolved && (
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Provider">{resolved.displayName} ({resolved.providerCode})</Descriptions.Item>
              <Descriptions.Item label="Mã tra cứu"><Text code copyable>{resolved.lookupCode || '—'}</Text></Descriptions.Item>
              <Descriptions.Item label="URL metadata">
                <Link href={resolved.metadataUrl} target="_blank" rel="noreferrer">{resolved.metadataUrl}</Link>
              </Descriptions.Item>
              {resolved.downloadUrl && (
                <Descriptions.Item label="Link tải / bản thể hiện">
                  <Link href={resolved.downloadUrl} target="_blank" rel="noreferrer">{resolved.downloadUrl}</Link>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Các bước">
                <Space direction="vertical" size={2}>
                  {resolved.steps.map((step, index) => (
                    <Text key={index}><Tag color={step.status === 'ready' ? 'green' : 'blue'}>{step.stage}</Tag>{step.label}{step.value ? `: ${step.value}` : ''}</Text>
                  ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          )}
        </Space>
      </Card>

      {(unsupported || missingCoreEvidence) && (
        <Alert
          type="warning"
          showIcon
          message="Chưa đủ dữ liệu để hoàn thiện workflow PDF cho NCC này"
          description={(
            <div>
              <Paragraph style={{ marginBottom: 6 }}>
                Vui lòng cung cấp càng nhiều bằng chứng thực tế càng tốt qua email/kênh hỗ trợ nội bộ của dự án:
              </Paragraph>
              <ol style={{ margin: '0 0 8px 20px', padding: 0 }}>
                <li>File XML gốc tải từ GDT hoặc từ email nhà cung cấp.</li>
                <li>File PDF/bản thể hiện thật của cùng hóa đơn.</li>
                <li>Email gốc hoặc file <Text code>.eml</Text> chứa link/mã tra cứu/QR (có thể forward email).</li>
                <li>Ảnh chụp trang tra cứu và URL portal; tốt hơn nữa là HAR/network capture khi tự tra cứu thủ công.</li>
                <li>Giữ các định danh: MST người bán, ký hiệu, số hóa đơn, ngày lập, MSTTCGP và mã tra cứu nếu có.</li>
              </ol>
              <Text strong>Không gửi:</Text> mật khẩu GDT, cookie phiên, access token, refresh token hoặc CAPTCHA đã nhập.
            </div>
          )}
        />
      )}
    </Space>
  );
}
