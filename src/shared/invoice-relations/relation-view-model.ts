import type { InvoiceDocument } from '../models/index.js';
import { businessKeyFromDocument, businessKeyFromLocator } from './keys.js';
import type {
  InvoiceBusinessIndex,
  InvoiceRelationContext,
  ReverseRelationIndex,
} from './relation-index.js';

export type RelationTooltipMode =
  | 'replaces'
  | 'adjusts'
  | 'replaced-by'
  | 'adjusted-by'
  | 'none';

export interface RelatedInvoiceView {
  invoiceKey?: string;
  invoiceNo?: string;
  series?: string;
  templateNo?: string;
  issuedDate?: string;
  inDataset: boolean;
}

export interface RelationTooltipViewModel {
  mode: RelationTooltipMode;
  title: string;
  related: RelatedInvoiceView[];
  description?: string;
  ambiguous?: boolean;
}

export function formatVietnamDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function buildForwardViewModel(
  document: InvoiceDocument,
  index: InvoiceBusinessIndex,
): RelationTooltipViewModel | undefined {
  const relation = document.relation;
  if (!relation) return undefined;

  const key = businessKeyFromLocator(relation.original);
  if (!key) return undefined;

  const matches = index.get(key) ?? [];
  const original = relation.original;

  return {
    mode: relation.kind === 'replacement' ? 'replaces' : 'adjusts',
    title: relation.kind === 'replacement'
      ? 'Thay thế cho hóa đơn'
      : 'Điều chỉnh cho hóa đơn',
    related: [{
      invoiceKey: matches.length === 1 ? matches[0].key : undefined,
      invoiceNo: String(original.invoiceNo),
      series: String(original.series),
      templateNo: String(original.templateNo),
      issuedDate: formatVietnamDate(original.issuedAt),
      inDataset: matches.length === 1,
    }],
    description: relation.description,
    ambiguous: matches.length > 1,
  };
}

export function buildReverseViewModel(
  document: InvoiceDocument,
  reverse: ReverseRelationIndex,
): RelationTooltipViewModel | undefined {
  const status = Number(document.invoiceStatus);
  if (status !== 4 && status !== 5) return undefined;

  const key = businessKeyFromDocument(document);
  if (!key) return undefined;

  const expectedKind = status === 4 ? 'replacement' : 'adjustment';
  const matches = (reverse.get(key) ?? []).filter(item => item.kind === expectedKind);

  return {
    mode: status === 4 ? 'replaced-by' : 'adjusted-by',
    title: status === 4
      ? (matches.length > 1 ? `Bị thay thế bởi ${matches.length} hóa đơn` : 'Bị thay thế bởi')
      : (matches.length > 1 ? `Bị điều chỉnh bởi ${matches.length} hóa đơn` : 'Bị điều chỉnh bởi'),
    related: matches.map(item => ({
      invoiceKey: item.sourceInvoiceKey,
      invoiceNo: item.invoiceNo == null ? undefined : String(item.invoiceNo),
      series: item.series == null ? undefined : String(item.series),
      templateNo: item.templateNo == null ? undefined : String(item.templateNo),
      issuedDate: formatVietnamDate(item.issuedAt),
      inDataset: true,
    })),
  };
}

export function buildRelationViewModel(
  document: InvoiceDocument,
  context: InvoiceRelationContext,
): RelationTooltipViewModel | undefined {
  return buildForwardViewModel(document, context.businessIndex)
    ?? buildReverseViewModel(document, context.reverseIndex);
}

export function buildRelationViewModels(
  documents: InvoiceDocument[],
  context: InvoiceRelationContext,
): Map<string, RelationTooltipViewModel> {
  const result = new Map<string, RelationTooltipViewModel>();

  for (const document of documents) {
    const model = buildRelationViewModel(document, context);
    if (model) result.set(document.key, model);
  }

  return result;
}

export function relationDirectionSymbol(mode: RelationTooltipMode): '↗' | '↘' | '' {
  if (mode === 'replaces' || mode === 'adjusts') return '↗';
  if (mode === 'replaced-by' || mode === 'adjusted-by') return '↘';
  return '';
}

export function buildRelationAriaLabel(
  document: InvoiceDocument,
  model: RelationTooltipViewModel,
): string {
  const currentNo = String(document.invoiceNo ?? '').trim() || 'không rõ số';
  const first = model.related[0];
  const relationship = {
    replaces: 'hóa đơn thay thế, thay thế cho hóa đơn',
    adjusts: 'hóa đơn điều chỉnh, điều chỉnh cho hóa đơn',
    'replaced-by': 'hóa đơn đã bị thay thế bởi',
    'adjusted-by': 'hóa đơn đã bị điều chỉnh bởi',
    none: 'không có quan hệ hóa đơn',
  }[model.mode];

  const parts = [`Hóa đơn ${currentNo}, ${relationship}`];
  if (model.related.length > 1) {
    parts.push(`${model.related.length} hóa đơn liên quan`);
  } else if (first) {
    if (first.invoiceNo) parts.push(`hóa đơn ${first.invoiceNo}`);
    if (first.series) parts.push(`ký hiệu ${first.series}`);
    if (first.issuedDate) parts.push(`ngày ${first.issuedDate}`);
  } else {
    parts.push('chưa có thông tin hóa đơn liên quan trong dữ liệu hiện tại');
  }
  return parts.join(', ');
}
