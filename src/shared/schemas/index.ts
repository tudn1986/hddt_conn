import { z } from 'zod';

export const directionSchema = z.enum(['purchase', 'sales']);
export const invoiceSourceSchema = z.enum(['standard', 'pos']);
export const connectorModeSchema = z.enum(['live', 'mock']);
export const isoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Ngày không tồn tại trong lịch');

export const locatorSchema = z.object({
  sellerTaxCode: z.string().trim().min(1).max(32),
  templateNo: z.union([z.string().max(64), z.number().finite()]),
  series: z.string().trim().min(1).max(100),
  invoiceNo: z.union([z.string().max(100), z.number().finite()]),
}).strict();

export const loginSchema = z.object({
  username: z.string().trim().regex(/^\d{10}(?:-\d{3})?$/, 'MST không hợp lệ'),
  password: z.string().min(1).max(512),
  captcha: z.string().trim().min(1).max(64),
  ckey: z.string().min(1).max(4096),
  rememberUsername: z.boolean().optional().default(true),
}).strict();

const invoiceQueryShape = {
  direction: directionSchema,
  source: invoiceSourceSchema.optional(),
  sources: z.array(invoiceSourceSchema).min(1).max(2).transform(values => [...new Set(values)]).optional(),
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  documentType: z.string().trim().max(64).optional(),
  status: z.string().trim().max(32).optional(),
  statuses: z.array(z.enum(['5', '6', '8'])).min(1).max(3).transform(values => [...new Set(values)]).optional(),
  partnerTaxCode: z.string().trim().max(32).optional(),
  invoiceNo: z.string().trim().max(100).optional(),
  series: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.number().int().min(1).max(500).optional().default(50),
  cursor: z.string().max(8192).optional(),
};

const validateDateRange = (value: { fromDate: string; toDate: string }, context: z.RefinementCtx) => {
  if (value.fromDate > value.toDate) {
    context.addIssue({ code: 'custom', path: ['toDate'], message: 'Đến ngày phải từ hoặc sau Từ ngày' });
  }
};

export const invoiceQuerySchema = z.object(invoiceQueryShape).strict().superRefine(validateDateRange);

export const existingInvoiceRefSchema = z.object({
  key: z.string().min(1).max(512),
  invoiceSource: invoiceSourceSchema,
  portalInvoiceId: z.string().max(256).optional(),
  sellerTaxCode: z.string().trim().min(1).max(32),
  buyerTaxCode: z.string().trim().max(32).optional(),
  templateNo: z.union([z.string().max(64), z.number().finite()]),
  series: z.string().trim().min(1).max(100),
  invoiceNo: z.union([z.string().max(100), z.number().finite()]),
  hasDetail: z.boolean(),
  invoiceStatus: z.union([z.string().max(64), z.number().finite()]).optional(),
  processingStatus: z.union([z.string().max(64), z.number().finite()]).optional(),
  updatedTime: z.string().max(128).optional(),
}).strict();

export const queryAutoSchema = z.object({
  ...invoiceQueryShape,
  existingDocuments: z.array(existingInvoiceRefSchema).max(100_000).optional().default([]),
  baselineToDate: isoDateSchema.optional(),
  supplementTtxly6: z.boolean().optional().default(true),
}).strict().superRefine((value, context) => {
  validateDateRange(value, context);
  if (value.baselineToDate && value.baselineToDate > value.toDate) {
    context.addIssue({
      code: 'custom',
      path: ['baselineToDate'],
      message: 'Ngày baseline không được sau Đến ngày',
    });
  }
});

const VERIFIED_GDT_ORIGIN = 'https://hoadondientu.gdt.gov.vn';
const pathSchema = z.string().trim().min(1).max(260).refine(
  (value) => {
    try {
      const url = new URL(value, VERIFIED_GDT_ORIGIN);
      return url.origin === VERIFIED_GDT_ORIGIN &&
        !url.username &&
        !url.password &&
        url.pathname.startsWith('/api/');
    } catch {
      return false;
    }
  },
  'Endpoint phải nằm dưới /api/ của GDT sau canonicalization'
);

export const appConfigSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({
    language: z.literal('vi-VN'),
    openBrowserOnStart: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    connectorMode: connectorModeSchema,
    defaultDirection: directionSchema,
  }).strict(),
  storage: z.object({
    dataRoot: z.string().trim().min(1).max(4096),
    datasetSaveMode: z.enum(['ask', 'auto']),
    maxDatasetBytes: z.number().int().min(1024 * 1024).max(1024 * 1024 * 1024),
  }).strict(),
  network: z.object({
    detailConcurrency: z.number().int().min(1).max(5),
    downloadConcurrency: z.number().int().min(1).max(5),
    requestDelayMs: z.number().int().min(0).max(10_000),
    requestTimeoutMs: z.number().int().min(1_000).max(120_000),
    maxRetries: z.number().int().min(1).max(10),
    maxResponseBytes: z.number().int().min(1024).max(200 * 1024 * 1024),
    maxDownloadBytes: z.number().int().min(1024).max(500 * 1024 * 1024),
  }).strict(),
  gdt: z.object({
    origin: z.literal('https://hoadondientu.gdt.gov.vn'),
    captchaPath: pathSchema,
    loginPath: pathSchema,
    purchasePath: pathSchema,
    salesPath: z.union([z.literal(''), pathSchema]),
    posPurchasePath: pathSchema,
    posSalesPath: z.union([z.literal(''), pathSchema]),
    detailPath: pathSchema,
    posDetailPath: pathSchema,
    exportPath: pathSchema,
    posExportPath: pathSchema,
    exportMethod: z.enum(['GET', 'POST']),
    posExportMethod: z.enum(['GET', 'POST']),
  }).strict(),
  export: z.object({ defaultFormat: z.literal('xlsx') }).strict(),
}).strict();

export const settingsPatchSchema = z.object({
  app: appConfigSchema.shape.app.partial().optional(),
  storage: appConfigSchema.shape.storage.partial().optional(),
  network: appConfigSchema.shape.network.partial().optional(),
  gdt: z.object({
    salesPath: z.union([z.literal(''), pathSchema]),
    posSalesPath: z.union([z.literal(''), pathSchema]),
  }).strict().partial().optional(),
  export: appConfigSchema.shape.export.partial().optional(),
}).strict();

export const datasetEnvelopeSchema = z.object({
  format: z.literal('hddt-dataset'),
  schemaVersion: z.literal(1),
  appVersion: z.string().min(1).max(64),
  meta: z.object({
    accountTaxCode: z.string().min(1).max(32),
    direction: directionSchema,
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    createdAt: z.string().min(1),
    source: z.string().min(1).max(256),
    recordCount: z.number().int().nonnegative(),
    detailCount: z.number().int().nonnegative(),
  }).passthrough(),
  documents: z.array(z.object({
    key: z.string().min(1).max(512),
    normalized: z.object({
      key: z.string().min(1).max(512),
      direction: directionSchema,
      invoiceSource: invoiceSourceSchema.optional(),
      seller: z.object({ dynamicFields: z.array(z.unknown()) }).passthrough(),
      buyer: z.object({ dynamicFields: z.array(z.unknown()) }).passthrough(),
      taxSummaries: z.array(z.unknown()),
      lines: z.array(z.unknown()),
      dynamicFields: z.array(z.unknown()),
    }).passthrough(),
    rawSummary: z.unknown().optional(),
    rawDetail: z.unknown().optional(),
  }).passthrough()).max(100_000),
}).strict();
