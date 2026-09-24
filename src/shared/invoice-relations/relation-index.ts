import type {
  InvoiceDocument,
  InvoiceRelationKind,
} from '../models/index.js';
import {
  businessKeyFromDocument,
  businessKeyFromLocator,
} from './keys.js';

export interface ReverseInvoiceRelation {
  kind: InvoiceRelationKind;
  sourceInvoiceKey: string;
  sellerTaxCode?: string;
  templateNo?: string | number;
  series?: string;
  invoiceNo?: string | number;
  issuedAt?: string;
  description?: string;
}

export type InvoiceBusinessIndex = Map<string, InvoiceDocument[]>;
export type ReverseRelationIndex = Map<string, ReverseInvoiceRelation[]>;

export interface InvoiceRelationContext {
  businessIndex: InvoiceBusinessIndex;
  reverseIndex: ReverseRelationIndex;
}

export function buildInvoiceIndex(documents: InvoiceDocument[]): InvoiceBusinessIndex {
  const result: InvoiceBusinessIndex = new Map();

  for (const document of documents) {
    const key = businessKeyFromDocument(document);
    if (!key) continue;

    const bucket = result.get(key) ?? [];
    bucket.push(document);
    result.set(key, bucket);
  }

  return result;
}

export function buildReverseRelationIndex(
  documents: InvoiceDocument[],
): ReverseRelationIndex {
  const result: ReverseRelationIndex = new Map();

  for (const document of documents) {
    const relation = document.relation;
    if (!relation) continue;

    const originalKey = businessKeyFromLocator(relation.original);
    if (!originalKey) continue;

    const item: ReverseInvoiceRelation = {
      kind: relation.kind,
      sourceInvoiceKey: document.key,
      sellerTaxCode: document.seller?.taxCode,
      templateNo: document.templateNo,
      series: document.series,
      invoiceNo: document.invoiceNo,
      issuedAt: document.issueDate,
      description: relation.description,
    };

    const bucket = result.get(originalKey) ?? [];
    if (!bucket.some(existing => existing.sourceInvoiceKey === item.sourceInvoiceKey)) {
      bucket.push(item);
      result.set(originalKey, bucket);
    }
  }

  return result;
}

export function buildInvoiceRelationContext(
  documents: InvoiceDocument[],
): InvoiceRelationContext {
  return {
    businessIndex: buildInvoiceIndex(documents),
    reverseIndex: buildReverseRelationIndex(documents),
  };
}
