import React from 'react';
import { Card, Tooltip, Typography } from 'antd';

const { Text } = Typography;

export type CurrencySummaryTotal = {
  currency: string;
  subtotal: number;
  vat: number;
  grandTotal: number;
};

export interface InvoiceSummaryBarProps {
  visibleCount: number;
  datasetCount: number;
  withDetailCount: number;
  currencies: CurrencySummaryTotal[];
}

export function normalizeCurrencyCode(value?: string | null): string {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toUpperCase();

  if (!normalized || normalized === 'VND' || normalized === 'VNĐ' || normalized === 'Đ' || normalized === 'D') {
    return 'VND';
  }

  return normalized;
}

function formatAmount(value: number, currency: string): string {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const isVnd = normalizedCurrency === 'VND';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: isVnd ? 0 : 6,
  }).format(Number.isFinite(value) ? value : 0);
}

function SummaryMetric({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <Tooltip title={label} mouseEnterDelay={0.25}>
      <div className={`invoice-summary-metric ${className}`} tabIndex={0} aria-label={`${label}: ${value}`}>
        <span className="invoice-summary-metric-value">{value}</span>
      </div>
    </Tooltip>
  );
}

export function InvoiceCountSummary({
  visibleCount,
  datasetCount,
  withDetailCount,
}: {
  visibleCount: number;
  datasetCount: number;
  withDetailCount: number;
}) {
  return (
    <Card size="small" className="invoice-summary-count-block" bodyStyle={{ padding: 0 }}>
      <div className="invoice-summary-count-grid">
        <Tooltip title="Số hóa đơn đang hiển thị sau khi áp dụng bộ lọc" mouseEnterDelay={0.25}>
          <div className="invoice-summary-count-cell" tabIndex={0} aria-label={`Đang hiển thị ${visibleCount} trên ${datasetCount} hóa đơn`}>
            <strong>{visibleCount.toLocaleString('vi-VN')}</strong>
            <span>/ {datasetCount.toLocaleString('vi-VN')} HĐ</span>
          </div>
        </Tooltip>
        <Tooltip title="Số hóa đơn trong danh sách hiện tại đã có chi tiết hàng hóa, dịch vụ" mouseEnterDelay={0.25}>
          <div className="invoice-summary-count-cell" tabIndex={0} aria-label={`${withDetailCount} hóa đơn đã có chi tiết HHDV`}>
            <strong>{withDetailCount.toLocaleString('vi-VN')}</strong>
            <span>có HHDV</span>
          </div>
        </Tooltip>
      </div>
    </Card>
  );
}

export function CurrencySummaryCard({ total }: { total: CurrencySummaryTotal }) {
  const currency = normalizeCurrencyCode(total.currency);
  const subtotalText = formatAmount(total.subtotal, currency);
  const vatText = formatAmount(total.vat, currency);
  const grandTotalText = formatAmount(total.grandTotal, currency);

  return (
    <Card size="small" className="invoice-currency-summary-card" bodyStyle={{ padding: 0 }}>
      <div className="invoice-currency-summary-grid">
        <Tooltip title="Loại tiền tệ" mouseEnterDelay={0.25}>
          <div className="invoice-currency-quadrant invoice-currency-code-quadrant" tabIndex={0} aria-label={`Loại tiền tệ ${currency}`}>
            <span className="invoice-currency-code">{currency}</span>
          </div>
        </Tooltip>
        <SummaryMetric label={`Tiền HHDV / tiền trước thuế của các hóa đơn ${currency}`} value={subtotalText} />
        <SummaryMetric label={`Tổng tiền thanh toán của các hóa đơn ${currency}`} value={grandTotalText} className="invoice-summary-metric-total" />
        <SummaryMetric label={`Tiền thuế của các hóa đơn ${currency}`} value={vatText} />
      </div>
    </Card>
  );
}

export function InvoiceSummaryBar({ visibleCount, datasetCount, withDetailCount, currencies }: InvoiceSummaryBarProps) {
  return (
    <section className="invoice-summary-bar" aria-label="Tổng hợp hóa đơn">
      <InvoiceCountSummary visibleCount={visibleCount} datasetCount={datasetCount} withDetailCount={withDetailCount} />
      <div className="invoice-summary-currency-strip" role="list" aria-label="Tổng hợp theo loại tiền tệ">
        {currencies.length > 0 ? currencies.map(total => (
          <div key={normalizeCurrencyCode(total.currency)} role="listitem" className="invoice-summary-currency-item">
            <CurrencySummaryCard total={total} />
          </div>
        )) : (
          <div className="invoice-summary-empty-currency"><Text type="secondary">Chưa có dữ liệu tiền tệ</Text></div>
        )}
      </div>
    </section>
  );
}

export default InvoiceSummaryBar;
