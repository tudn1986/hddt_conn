import React, { useEffect } from 'react';
import { Button, Empty, Space, Table, Tooltip, Typography } from 'antd';
import { CloseOutlined, FullscreenOutlined } from '@ant-design/icons';
import type { InvoiceDocument } from '../../../shared/models/index.js';

const { Text } = Typography;

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(number);
}

export interface InvoiceLinesModalProps {
  invoice: InvoiceDocument | null;
  onClose: () => void;
}

export function InvoiceLinesModal({ invoice, onClose }: InvoiceLinesModalProps) {
  useEffect(() => {
    if (!invoice) return undefined;
    const previousOverflow = typeof window !== 'undefined' ? window.document.body.style.overflow : '';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    if (typeof window !== 'undefined') window.document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof window !== 'undefined') window.document.body.style.overflow = previousOverflow;
    };
  }, [invoice, onClose]);

  if (!invoice) return null;

  const lines = invoice.lines || [];
  const title = `Chi tiết HHDV · ${invoice.series || ''} ${String(invoice.invoiceNo ?? '')}`.trim();
  const resizeDialog = (target: HTMLElement, widthDelta = 0, heightDelta = 0) => {
    const dialog = target.closest('.invoice-lines-dialog') as HTMLElement | null;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const maxWidth = Math.max(320, window.innerWidth - 24);
    const maxHeight = Math.max(240, window.innerHeight - 24);
    const minWidth = Math.min(720, maxWidth);
    const minHeight = Math.min(420, maxHeight);
    dialog.style.width = `${Math.min(maxWidth, Math.max(minWidth, rect.width + widthDelta))}px`;
    dialog.style.height = `${Math.min(maxHeight, Math.max(minHeight, rect.height + heightDelta))}px`;
  };

  return (
    <div className="invoice-lines-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="invoice-lines-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="invoice-lines-dialog-header">
          <div className="invoice-lines-dialog-title-wrap">
            <Text strong className="invoice-lines-dialog-title">{title}</Text>
            <Text type="secondary" className="invoice-lines-dialog-meta">
              {lines.length.toLocaleString('vi-VN')} dòng · {invoice.currency || 'VND'}
            </Text>
          </div>
          <Space size={4}>
            <Tooltip title="Giảm chiều ngang"><Button size="small" onClick={event => resizeDialog(event.currentTarget, -120, 0)}>Rộng −</Button></Tooltip>
            <Tooltip title="Tăng chiều ngang"><Button size="small" onClick={event => resizeDialog(event.currentTarget, 120, 0)}>Rộng +</Button></Tooltip>
            <Tooltip title="Giảm chiều dọc"><Button size="small" onClick={event => resizeDialog(event.currentTarget, 0, -100)}>Cao −</Button></Tooltip>
            <Tooltip title="Tăng chiều dọc"><Button size="small" onClick={event => resizeDialog(event.currentTarget, 0, 100)}>Cao +</Button></Tooltip>
            <Tooltip title="Khôi phục kích thước gần toàn màn hình">
              <Button
                size="small"
                icon={<FullscreenOutlined />}
                onClick={event => {
                  const dialog = event.currentTarget.closest('.invoice-lines-dialog') as HTMLElement | null;
                  if (!dialog) return;
                  dialog.style.width = 'calc(100vw - 32px)';
                  dialog.style.height = 'calc(100vh - 32px)';
                }}
              >
                Toàn trang
              </Button>
            </Tooltip>
            <Tooltip title="Đóng bảng chi tiết (Esc)">
              <Button size="small" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
            </Tooltip>
          </Space>
        </header>

        <div className="invoice-lines-dialog-hint">
          <Text type="secondary">Kéo góc dưới bên phải để thay đổi chiều ngang và chiều dọc của cửa sổ.</Text>
        </div>

        <div className="invoice-lines-dialog-body">
          {lines.length > 0 ? (
            <Table
              className="hddt-data-table invoice-lines-fullpage-table"
              size="small"
              rowKey={(_, index) => String(index)}
              pagination={false}
              sticky
              scroll={{ x: 1240 }}
              dataSource={lines}
              columns={[
                { title: 'STT', width: 60, render: (_: unknown, row: any, index: number) => row.lineNo ?? index + 1 },
                { title: 'Mã hàng hóa/dịch vụ', dataIndex: 'itemCode', width: 160, ellipsis: true },
                { title: 'Tên hàng hóa/dịch vụ', dataIndex: 'itemName', width: 320, ellipsis: true },
                { title: 'ĐVT', dataIndex: 'unit', width: 80 },
                { title: 'Số lượng', dataIndex: 'quantity', width: 110, align: 'right', render: formatNumber },
                { title: 'Đơn giá', dataIndex: 'unitPrice', width: 130, align: 'right', render: formatNumber },
                { title: 'Thành tiền', dataIndex: 'amount', width: 145, align: 'right', render: formatNumber },
                { title: 'Thuế suất', dataIndex: 'vatRateText', width: 100, align: 'center' },
                { title: 'Tiền thuế', dataIndex: 'vatAmount', width: 130, align: 'right', render: formatNumber },
                { title: 'Chiết khấu', dataIndex: 'discountAmount', width: 130, align: 'right', render: formatNumber },
              ]}
            />
          ) : (
            <div className="invoice-lines-dialog-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Hóa đơn chưa có dữ liệu chi tiết hàng hóa/dịch vụ trong dataset hiện tại" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default InvoiceLinesModal;
