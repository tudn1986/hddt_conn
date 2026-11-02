import { normalizeCurrencyCode } from './InvoiceSummaryBar.js';

export function formatAmount(value: unknown, currency?: string): string {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const isVnd = normalizedCurrency === 'VND';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: isVnd ? 0 : 6,
  }).format(number);
}

export function money(value: unknown): string {
  return formatAmount(value);
}
