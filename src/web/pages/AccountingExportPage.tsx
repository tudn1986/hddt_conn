import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Space, Table, Tabs, Typography, message } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { api, downloadBlob } from '../api/client';
import type { InvoiceDocument } from '../../shared/models/index.js';

const { Paragraph, Text } = Typography;
interface Props { documents: InvoiceDocument[]; direction: 'purchase' | 'sales'; }

function amount(value: unknown): string {
  return Number(value || 0).toLocaleString('vi-VN');
}

export default function AccountingExportPage({ documents, direction }: Props) {
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [profileId, setProfileId] = useState(direction === 'purchase' ? 'amis-foundation-v1' : 'amis-sales-foundation-v1');

  useEffect(() => {
    setProfileId(direction === 'purchase' ? 'amis-foundation-v1' : 'amis-sales-foundation-v1');
  }, [direction]);

  useEffect(() => {
    void api.listProfiles().then((result) => setProfiles(result.profiles || [])).catch(() => setProfiles([]));
  }, []);

  const exportReport = async () => {
    if (!documents.length) return message.warning('Chưa có hóa đơn được chọn. Quay lại Quản lý hóa đơn và chọn chứng từ cần kết xuất.');
    setLoading(true);
    try {
      const blob = await api.exportReport({ documents, direction });
      downloadBlob(blob, `HDDT_Report_${direction}_${documents.length}HD_${Date.now()}.xlsx`);
      message.success(`Đã xuất báo cáo Excel cho ${documents.length.toLocaleString('vi-VN')} hóa đơn/chứng từ đã chọn.`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi xuất Excel');
    } finally {
      setLoading(false);
    }
  };

  const exportProfile = async () => {
    if (!documents.length) return message.warning('Chưa có hóa đơn được chọn. Quay lại Quản lý hóa đơn và chọn chứng từ cần kết xuất.');
    setLoading(true);
    try {
      const blob = await api.exportProfile({ documents, profileId });
      downloadBlob(blob, `HDDT_${profileId}_${documents.length}HD_${Date.now()}.xlsx`);
      message.success(`Đã xuất profile cho ${documents.length.toLocaleString('vi-VN')} hóa đơn/chứng từ đã chọn.`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi xuất profile');
    } finally {
      setLoading(false);
    }
  };

  const partnerRows = useMemo(() => summarizePartners(documents, direction), [documents, direction]);
  const vatRows = useMemo(() => summarizeVat(documents), [documents]);
  const typeRows = useMemo(() => summarizeTypes(documents), [documents]);
  const lineRows = useMemo(() => documents.flatMap((document) => (document.lines || []).map((line, index: number) => ({
    key: `${document.key}:${index}`,
    invoiceKey: document.key,
    invoiceNo: document.invoiceNo,
    ...line,
  }))), [documents]);

  return (
    <Space direction="vertical" className="hddt-page-stack" size="middle">
      <Card title="Kết xuất kế toán" size="small" className="hddt-section-card">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Báo cáo chỉ dùng ${documents.length.toLocaleString('vi-VN')} hóa đơn/chứng từ đã chọn`}
          description={documents.length
            ? 'Báo cáo trên màn hình và các file Excel/Profile bên dưới chỉ lấy dữ liệu từ tập hóa đơn đang được chọn ở Quản lý hóa đơn. AMIS hiện là mapping nền.'
            : 'Quay lại Quản lý hóa đơn, chọn ít nhất một chứng từ rồi mở lại tab này để báo cáo/kết xuất.'}
        />
        <Space wrap>
          <Button type="primary" icon={<FileExcelOutlined />} loading={loading} disabled={!documents.length} onClick={() => void exportReport()}>
            Xuất báo cáo Excel chuẩn
          </Button>
          <Select
            value={profileId}
            onChange={setProfileId}
            style={{ minWidth: 360 }}
            options={profiles.map((profile) => ({ value: profile.id, label: `${profile.name} (${profile.version})`, disabled: !!profile.documentDirection && profile.documentDirection !== direction }))}
          />
          <Button loading={loading} disabled={!documents.length} onClick={() => void exportProfile()}>Xuất profile đã chọn</Button>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          Dữ liệu đã chọn: <Text strong>{documents.length}</Text> chứng từ ({direction === 'purchase' ? 'mua vào' : 'bán ra'}).
        </Paragraph>
      </Card>

      <Card title="Báo cáo trên màn hình" size="small">
        <Tabs items={[
          { key: 'partner', label: `Theo đối tác (${partnerRows.length})`, children: <Table className="hddt-data-table" size="small" rowKey="key" pagination={{ pageSize: 50 }} dataSource={partnerRows} columns={[
            { title: 'MST', dataIndex: 'taxCode', width: 140 },
            { title: 'Tên đối tác', dataIndex: 'name' },
            { title: 'Số chứng từ', dataIndex: 'count', width: 110 },
            { title: 'Trước thuế', dataIndex: 'subtotal', align: 'right', render: amount },
            { title: 'VAT', dataIndex: 'vat', align: 'right', render: amount },
            { title: 'Tổng tiền', dataIndex: 'total', align: 'right', render: amount },
          ]} /> },
          { key: 'vat', label: `Theo thuế suất (${vatRows.length})`, children: <Table className="hddt-data-table" size="small" rowKey="rate" pagination={false} dataSource={vatRows} columns={[
            { title: 'Thuế suất', dataIndex: 'rate' },
            { title: 'Số dòng/HĐ', dataIndex: 'count' },
            { title: 'Tiền chịu thuế', dataIndex: 'taxable', align: 'right', render: amount },
            { title: 'Tiền thuế', dataIndex: 'vat', align: 'right', render: amount },
          ]} /> },
          { key: 'type', label: `Theo loại chứng từ (${typeRows.length})`, children: <Table className="hddt-data-table" size="small" rowKey="key" pagination={false} dataSource={typeRows} columns={[
            { title: 'Mã loại', dataIndex: 'code', width: 140 },
            { title: 'Tên loại', dataIndex: 'name' },
            { title: 'Số chứng từ', dataIndex: 'count', width: 110 },
            { title: 'Tổng tiền', dataIndex: 'total', align: 'right', render: amount },
          ]} /> },
          { key: 'lines', label: `Hàng hóa/dịch vụ (${lineRows.length})`, children: <Table className="hddt-data-table" size="small" rowKey="key" pagination={{ pageSize: 50 }} scroll={{ x: 1260 }} dataSource={lineRows} columns={[
            { title: 'Số HĐ', dataIndex: 'invoiceNo', width: 110 },
            { title: 'Mã hàng hóa/dịch vụ', dataIndex: 'itemCode', width: 160, ellipsis: true },
            { title: 'Tên hàng hóa/dịch vụ', dataIndex: 'itemName', width: 280 },
            { title: 'ĐVT', dataIndex: 'unit', width: 80 },
            { title: 'SL', dataIndex: 'quantity', align: 'right', render: amount },
            { title: 'Đơn giá', dataIndex: 'unitPrice', align: 'right', render: amount },
            { title: 'Thành tiền', dataIndex: 'amount', align: 'right', render: amount },
            { title: 'VAT', dataIndex: 'vatRateText', width: 80 },
            { title: 'Chiết khấu', dataIndex: 'discountAmount', align: 'right', render: amount },
            { title: 'Invoice key', dataIndex: 'invoiceKey', width: 260, ellipsis: true },
          ]} /> },
        ]} />
      </Card>
    </Space>
  );
}

function summarizePartners(documents: any[], direction: 'purchase' | 'sales') {
  const groups = new Map<string, { key: string; taxCode: string; name: string; count: number; subtotal: number; vat: number; total: number }>();
  for (const document of documents) {
    const partner = direction === 'purchase' ? document.seller : document.buyer;
    const taxCode = String(partner?.taxCode || 'Không có MST');
    const key = `${taxCode}|${partner?.name || ''}`;
    const row = groups.get(key) || { key, taxCode, name: String(partner?.name || ''), count: 0, subtotal: 0, vat: 0, total: 0 };
    row.count += 1;
    row.subtotal += Number(document.subtotal) || 0;
    row.vat += Number(document.vatAmount) || 0;
    row.total += Number(document.grandTotal) || 0;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

function summarizeVat(documents: any[]) {
  const groups = new Map<string, { rate: string; count: number; taxable: number; vat: number }>();
  for (const document of documents) {
    const entries = document.taxSummaries?.length ? document.taxSummaries : [{ vatRateText: 'Không có bảng thuế', taxableAmount: document.subtotal, vatAmount: document.vatAmount }];
    for (const item of entries) {
      const rate = String(item.vatRateText ?? item.vatRateValue ?? 'Khác');
      const row = groups.get(rate) || { rate, count: 0, taxable: 0, vat: 0 };
      row.count += 1;
      row.taxable += Number(item.taxableAmount) || 0;
      row.vat += Number(item.vatAmount) || 0;
      groups.set(rate, row);
    }
  }
  return [...groups.values()];
}

function summarizeTypes(documents: any[]) {
  const groups = new Map<string, { key: string; code: string; name: string; count: number; total: number }>();
  for (const document of documents) {
    const code = String(document.documentTypeCode || 'Khác');
    const name = String(document.documentTypeName || '');
    const key = `${code}|${name}`;
    const row = groups.get(key) || { key, code, name, count: 0, total: 0 };
    row.count += 1;
    row.total += Number(document.grandTotal) || 0;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
