import React from 'react';
import { Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, QuestionCircleOutlined, SwapOutlined } from '@ant-design/icons';

const { Text } = Typography;

export const INVOICE_STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  '1': { label: 'Hóa đơn mới', color: 'green', icon: <CheckCircleOutlined /> },
  '2': { label: 'Hóa đơn thay thế', color: 'blue', icon: <SwapOutlined /> },
  '3': { label: 'Hóa đơn điều chỉnh', color: 'cyan', icon: <EditOutlined /> },
  '4': { label: 'Đã bị thay thế', color: 'orange', icon: <SwapOutlined /> },
  '5': { label: 'Đã bị điều chỉnh', color: 'orange', icon: <EditOutlined /> },
  '6': { label: 'Đã bị hủy', color: 'red', icon: <CloseCircleOutlined /> },
};

export function invoiceStatusLabel(value: unknown): string {
  const code = String(value ?? '').trim();
  return INVOICE_STATUS_META[code]?.label || (code ? `Không rõ (${code})` : '—');
}

export function renderInvoiceStatus(value: unknown) {
  const code = String(value ?? '').trim();
  const meta = INVOICE_STATUS_META[code];
  if (!code) return <Text type="secondary">—</Text>;
  const label = meta?.label || `Không rõ (${code})`;
  return (
    <Tag
      className="invoice-status-tag"
      color={meta?.color}
      icon={meta?.icon || <QuestionCircleOutlined />}
      title={label}
    >
      {label}
    </Tag>
  );
}
