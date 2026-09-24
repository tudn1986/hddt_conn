/** Domain contracts shared by the local server and WebUI. */

export type Direction = 'purchase' | 'sales';
export type InvoiceSource = 'standard' | 'pos';
export type ConnectorMode = 'live' | 'mock';
export type InvoiceRelationKind = 'replacement' | 'adjustment';

export interface OriginalInvoiceLocator {
  sellerTaxCode: string;
  templateNo: number | string;
  series: string;
  invoiceNo: number | string;
  issuedAt?: string;
}

export interface InvoiceRelation {
  kind: InvoiceRelationKind;
  original: OriginalInvoiceLocator;
  description?: string;
}

export interface DynamicField {
  section: string;
  name: string;
  dataType?: string;
  rawValue: unknown;
}

export interface Party {
  taxCode?: string;
  name?: string;
  address?: string;
  bankAccount?: string;
  bankName?: string;
  phone?: string;
  email?: string;
  fax?: string;
  website?: string;
  identityNo?: string;
  dynamicFields: DynamicField[];
}

export interface TaxSummary {
  vatRateText?: string;
  taxableAmount?: number;
  vatAmount?: number;
  vatRateValue?: number;
}

export interface InvoiceLookup {
  providerCode?: string;
  lookupCode?: string;
  lookupCodeType?: string;
  lookupBaseUrl?: string;
  lookupPathRaw?: string;
  sourceSection?: string;
  sourceField?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export type TvanCaptchaMode = 'none' | 'session' | 'per_invoice';
export type TvanDownloadPriority = 'P1' | 'P2' | 'P3';
export type TvanCaptchaKind = 'text' | 'slider';

export interface TvanProviderCapability {
  providerCode: string;
  displayName: string;
  supported: boolean;
  captchaMode: TvanCaptchaMode;
  priority: TvanDownloadPriority;
  reason?: string;
}

export interface TvanPresentationStep {
  stage: 'lookup_code' | 'metadata' | 'custom_data' | 'seller_tax_code' | 'security_code' | 'presentation_link';
  status: 'ok' | 'ready';
  label: string;
  value?: string;
}

/**
 * Supervised TVAN presentation-link resolution result.
 *
 * This intentionally contains only non-secret lookup data that may be shown in
 * the local WebUI. CAPTCHA/session tokens must never be added to this shape.
 */
export interface TvanPresentationLinkResult {
  providerCode: string;
  displayName: string;
  lookupCode: string;
  customData?: string;
  sellerTaxCode?: string;
  securityCode?: string;
  providerTaxCode?: string;
  metadataUrl: string;
  metadataMethod: 'GET' | 'POST';
  metadataRequestBody?: string;
  downloadUrl?: string;
  resolvedAt: string;
  steps: TvanPresentationStep[];
}

export interface TvanCaptchaChallenge {
  id: string;
  providerCode: string;
  kind: TvanCaptchaKind;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  pieceImageBase64?: string;
  pieceImageMimeType?: string;
  sliderMax?: number;
  sliderStart?: number;
  /** Provider-supplied vertical placement for a slider puzzle piece, in source-image pixels. */
  sliderY?: number;
  expiresAt?: string;
}

export interface TvanCaptchaProbeAttempt {
  endpoint: string;
  method: 'GET' | 'POST';
  requestBody?: string;
  responseStatus?: number;
  responseContentType?: string;
  responseKeys?: string[];
  responsePreview?: string;
  setCookieNames?: string[];
  tokenPresent?: boolean;
  imageCandidateCount?: number;
  note?: string;
}

export interface TvanCaptchaProbe {
  status: 'challenge_ready' | 'token_only' | 'no_challenge';
  attempts: TvanCaptchaProbeAttempt[];
  note?: string;
}

export interface TvanRequestTrace {
  endpoint: string;
  method: 'GET' | 'POST';
  requestBody?: string;
  responseStatus?: number;
  responseContentType?: string;
}

export interface TvanSupervisedPrepareResult {
  capability: TvanProviderCapability;
  lookup: Record<string, string>;
  challenge?: TvanCaptchaChallenge;
  challengeRequest?: TvanRequestTrace;
  captchaProbe?: TvanCaptchaProbe;
  preparedAt: string;
}

export type TvanArtifactStage =
  | 'new'
  | 'captcha_ready'
  | 'search_verified'
  | 'representation_ready'
  | 'artifact_descriptor_ready'
  | 'original_ready'
  | 'pdf_ready';

export interface TvanCaptchaVerificationResult {
  ok: true;
  providerCode: string;
  batchId?: string;
  verificationRequest?: TvanRequestTrace;
  tokenExpiresAt?: string;
  stage?: TvanArtifactStage;
  contextExpiresAt?: string;
  verifiedAt: string;
}

export interface TvanArtifactStatus {
  providerCode: string;
  stage: TvanArtifactStage;
  ready: boolean;
  canRetryPrepare: boolean;
  canView: boolean;
  canDownloadPdf: boolean;
  canDownloadOriginal: boolean;
  expiresAt?: string;
  originalKind?: 'pdf' | 'zip';
  originalFileName?: string;
  pdfFileName?: string;
}

export interface TvanDownloadRequestPlan {
  providerCode: string;
  displayName: string;
  lookup: Record<string, string>;
  endpoint: string;
  method: 'GET' | 'POST';
  requestBody?: string;
  tokenReady: boolean;
  tokenExpiresAt?: string;
  plannedAt: string;
}

export type TvanPdfTaskStatus =
  | 'pending'
  | 'waiting_captcha'
  | 'downloading'
  | 'done'
  | 'failed';

export interface TvanPdfTask {
  id: string;
  documentKey: string;
  providerCode: string;
  priority: TvanDownloadPriority;
  status: TvanPdfTaskStatus;
  fileName?: string;
  size?: number;
  error?: string;
}

export interface TvanBatchState {
  id: string;
  status: 'running' | 'waiting_captcha' | 'done';
  createdAt: string;
  updatedAt: string;
  tasks: TvanPdfTask[];
  challenge?: TvanCaptchaChallenge;
  archiveReady: boolean;
}

export interface TvanBackportAnalysis {
  providerCode: string;
  detectedFields: Array<{ name: string; value: string; source: 'json' | 'xml' }>;
  urls: string[];
  lookupCandidates: string[];
  taxCodeCandidates: string[];
  notes: string[];
}

export interface LineSupplementalInfo {
  type?: number | string;
  name?: string;
  rawValue?: unknown;
}

export interface InvoiceLine {
  itemCode?: string;
  portalLineId?: string;
  portalInvoiceId?: string;
  lineNo?: number;
  sortOrder?: number;
  lineType?: number | string;
  itemName?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  vatRateText?: string;
  vatRate?: number;
  vatAmount?: number;
  amountBeforeTax?: number;
  discountRate?: number;
  discountAmount?: number;
  amountInWords?: string;
  currency?: string;
  exchangeRate?: number;
  dynamicFields: DynamicField[];
  supplementalInfo: LineSupplementalInfo[];
  /** Backward-compatible raw mirror of tthhdtrung. */
  duplicateGoodsInfo?: unknown;
  raw?: unknown;
}

export interface InvoiceProviderIdentity {
  taxCode?: string;
  code?: string;
  name?: string;
}

export interface InvoicePresentationProvider {
  providerCode?: string;
  adapterCode?: string;
  domain?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface InvoiceProviderInfo {
  solution?: InvoiceProviderIdentity;
  transport?: InvoiceProviderIdentity;
  presentation?: InvoicePresentationProvider;
}

export interface InvoiceDocument {
  key: string;
  direction: Direction;
  invoiceSource: InvoiceSource;
  portalInvoiceId?: string;
  documentTypeCode?: string;
  documentTypeName?: string;
  templateNo?: number | string;
  series?: string;
  invoiceNo?: number | string;
  issueDate?: string;
  signingTime?: string;
  receivedTime?: string;
  codedTime?: string;
  updatedTime?: string;
  seller: Party;
  buyer: Party;
  currency?: string;
  exchangeRate?: number;
  subtotal?: number;
  nonTaxableAmount?: number;
  discountAmount?: number;
  vatAmount?: number;
  feeAmount?: number;
  otherAmount?: number;
  grandTotal?: number;
  grandTotalInWords?: string;
  paymentMethod?: string;
  invoiceStatus?: number | string;
  processingStatus?: number | string;
  nature?: number | string;
  /** Direct relation exposed by GDT for replacement/adjustment invoices. */
  relation?: InvoiceRelation;
  providerCode?: string;
  providers?: InvoiceProviderInfo;
  lookup?: InvoiceLookup;
  qrCode?: string;
  taxSummaries: TaxSummary[];
  lines: InvoiceLine[];
  dynamicFields: DynamicField[];
  rawSummary?: unknown;
  rawDetail?: unknown;
}

/** GDT detail and download use this composite key, not the response UUID. */
export interface InvoiceLocator {
  sellerTaxCode: string;
  templateNo: number | string;
  series: string;
  invoiceNo: number | string;
}

export interface CaptchaChallenge {
  ckey: string;
  captchaImageBase64: string;
  expiresAt?: string;
}

export interface LoginInput {
  username: string;
  password: string;
  captcha: string;
  ckey: string;
}

/** Never add token, cookie, password or CAPTCHA fields to this public result. */
export interface LoginResult {
  success: boolean;
  message?: string;
}

export interface InvoiceQuery {
  direction: Direction;
  /** Singular source for a direct connector query. Defaults to standard for compatibility. */
  source?: InvoiceSource;
  /** Source set used by query-auto. Purchase defaults to both standard and pos. */
  sources?: InvoiceSource[];
  fromDate: string;
  toDate: string;
  documentType?: string;
  status?: string;
  statuses?: Array<'5' | '6' | '8'>;
  partnerTaxCode?: string;
  invoiceNo?: string;
  series?: string;
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PortalInvoicePage {
  total: number;
  page: number;
  pageSize: number;
  items: unknown[];
  nextCursor?: string;
}

export interface PortalInvoiceDetail { raw: unknown; }

export interface DownloadedFile {
  content: Buffer;
  filename: string;
  contentType?: string;
  size: number;
}

export type DownloadTaskStatus = 'pending' | 'downloading' | 'done' | 'failed' | 'skipped';

export interface DownloadTask {
  id: string;
  invoiceSource: InvoiceSource;
  locator: InvoiceLocator;
  issueDate: string;
  type: 'xml' | 'zip';
  status: DownloadTaskStatus;
  attempts: number;
  targetPath: string;
  fileName: string;
  overwrite: boolean;
  createdAt: string;
  completedAt?: string;
  size?: number;
  sha256?: string;
  error?: string;
}

export interface DownloadManifestEntry {
  key: string;
  invoiceSource: InvoiceSource;
  fileName: string;
  type: 'xml' | 'zip';
  downloadedAt: string;
  size: number;
  sha256: string;
}

export interface DownloadManifest { schemaVersion: 1; files: DownloadManifestEntry[]; }

export interface DatasetMeta {
  accountTaxCode: string;
  direction: Direction;
  fromDate: string;
  toDate: string;
  createdAt: string;
  source: string;
  recordCount: number;
  detailCount: number;
  sourceCounts?: { standard: number; pos: number };
}

export interface DatasetDocument {
  key: string;
  normalized: InvoiceDocument;
  rawSummary?: unknown;
  rawDetail?: unknown;
}

export interface DatasetFile {
  format: 'hddt-dataset';
  schemaVersion: 1;
  appVersion: string;
  meta: DatasetMeta;
  documents: DatasetDocument[];
}

export interface AppConfig {
  schemaVersion: 1;
  app: {
    language: 'vi-VN';
    openBrowserOnStart: boolean;
    port: number;
    connectorMode: ConnectorMode;
    defaultDirection: Direction;
  };
  storage: {
    dataRoot: string;
    datasetSaveMode: 'ask' | 'auto';
    maxDatasetBytes: number;
  };
  network: {
    detailConcurrency: number;
    downloadConcurrency: number;
    requestDelayMs: number;
    requestTimeoutMs: number;
    maxRetries: number;
    maxResponseBytes: number;
    maxDownloadBytes: number;
  };
  gdt: {
    origin: 'https://hoadondientu.gdt.gov.vn';
    captchaPath: string;
    loginPath: string;
    purchasePath: string;
    /** Standard sales list endpoint; locked by the production release profile. */
    salesPath: string;
    posPurchasePath: string;
    /** POS sales remains disabled until a live request is captured. */
    posSalesPath: string;
    detailPath: string;
    posDetailPath: string;
    exportPath: string;
    posExportPath: string;
    exportMethod: 'GET' | 'POST';
    posExportMethod: 'GET' | 'POST';
  };
  export: { defaultFormat: 'xlsx'; };
}

export interface AccountEntry {
  username: string;
  displayName?: string;
  rememberPassword: false;
  passwordStorage: 'none';
}

export interface AccountsFile { schemaVersion: 1; lastUsername?: string; accounts: AccountEntry[]; }

export type ExportTransform = 'trim' | 'uppercase' | 'lowercase' | `default:${string}`;

export interface ExportColumnMapping {
  targetColumn: string;
  source: string;
  type: 'text' | 'number' | 'date' | 'vat-rate';
  required?: boolean;
  transform?: ExportTransform[];
}

export interface ExportSheetProfile { name: string; columns: ExportColumnMapping[]; }

export interface ExportProfile {
  id: string;
  name: string;
  version: string;
  documentDirection?: Direction;
  sheets: ExportSheetProfile[];
}

export interface RuntimeInfo { port: number; pid: number; startedAt: string; }

export interface ExistingInvoiceRef {
  key: string;
  invoiceSource: InvoiceSource;
  portalInvoiceId?: string;
  sellerTaxCode: string;
  buyerTaxCode?: string;
  templateNo: number | string;
  series: string;
  invoiceNo: number | string;
  hasDetail: boolean;
  invoiceStatus?: number | string;
  processingStatus?: number | string;
  updatedTime?: string;
}

export interface QueryAutoInput extends InvoiceQuery {
  /** Compact index of the currently opened dataset. Never send rawDetail/lines here. */
  existingDocuments?: ExistingInvoiceRef[];
  /** Last date already covered by the opened dataset. Main incremental query starts on the next day. */
  baselineToDate?: string;
  /** Enabled by default when baselineToDate is present for purchase/standard. */
  supplementTtxly6?: boolean;
}

export interface QueryAutoWarning { stage: 'query' | 'detail' | 'relation'; code: string; message: string; source?: InvoiceSource; status?: '5' | '6' | '8'; chunk?: { start: string; end: string }; key?: string; }

export interface QueryWindowInfo {
  main?: { start: string; end: string };
  ttxly6Supplement?: { start: string; end: string };
}

export interface QueryAutoSyncStats {
  /** Unique invoices returned by the refreshed GDT list chains. */
  found: number;
  /** Refreshed invoices already present in the opened dataset. */
  existing: number;
  /** Existing invoices that already had detail and therefore skipped detail API. */
  existingComplete: number;
  /** Existing invoices that were only summary/incomplete and therefore required hydration. */
  existingMissingDetail: number;
  /** Invoices not present in the opened dataset. */
  newDocuments: number;
  /** Existing invoices whose invoiceStatus and/or processingStatus changed. */
  statusChanged: number;
  /** Number of detail API calls intentionally skipped because cached detail was reusable. */
  detailSkipped: number;
  /** Unique invoices first discovered by the bounded ttxly=6 supplement chain. */
  ttxly6SupplementFound: number;
  /** Duplicate list items observed across main/supplement chains. */
  duplicateAcrossQueries: number;
  replacementFound: number;
  adjustmentFound: number;
  originalMatched: number;
  originalNotFound: number;
  originalMarkedReplaced: number;
  originalMarkedAdjusted: number;
}

export interface QueryAutoResult {
  /** Refreshed documents inside the requested range. The WebUI merges these into its current dataset. */
  documents: InvoiceDocument[];
  total: number;
  warnings: QueryAutoWarning[];
  partial: boolean;
  sessionExpired: boolean;
  chunks: number;
  completedChunks: number;
  pages: number;
  hydrated: number;
  windows: QueryWindowInfo;
  sync: QueryAutoSyncStats;
}

/** Persistent aggregate metadata for TVAN development/admin catalog. Never include raw invoice payloads or secrets. */
export type TvanCatalogSource = 'dataset_import' | 'gdt_query' | 'gdt_query_auto';

export interface TvanCatalogProvider {
  id: number;
  providerCode?: string;
  providerTaxCode?: string;
  solutionProviderTaxCode?: string;
  transportProviderCode?: string;
  transportProviderTaxCode?: string;
  presentationProviderCode?: string;
  displayName: string;
  adapterSupported: boolean;
  pdfSupported: boolean;
  captchaMode?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenDocuments: number;
  seenDatasetImport: number;
  seenGdtQuery: number;
  seenGdtQueryAuto: number;
  primaryPortal?: string;
  observedHosts: string[];
}

export interface TvanCatalogAlias {
  type: 'provider_code' | 'tax_code' | 'host' | 'solution_tax_code';
  value: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

export interface TvanCatalogEndpoint {
  kind: 'provider_portal' | 'lookup_portal';
  origin: string;
  host: string;
  pathPattern: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

export interface TvanCatalogFieldMapping {
  semanticRole: string;
  fieldName: string;
  fieldPath: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

export interface TvanCatalogProviderDetail extends TvanCatalogProvider {
  aliases: TvanCatalogAlias[];
  endpoints: TvanCatalogEndpoint[];
  fieldMappings: TvanCatalogFieldMapping[];
}

export interface TvanCatalogStats {
  providers: number;
  supportedProviders: number;
  unsupportedProviders: number;
  observedDocuments: number;
  datasetImportDocuments: number;
  gdtQueryDocuments: number;
  gdtQueryAutoDocuments: number;
  lastObservedAt?: string;
  databasePath: string;
  schemaVersion: number;
}

export interface TvanCatalogFilter {
  q?: string;
  providerCode?: string;
  providerTaxCode?: string;
  supported?: boolean;
  source?: TvanCatalogSource;
  host?: string;
  page?: number;
  pageSize?: number;
  sort?: 'lastSeenAt' | 'firstSeenAt' | 'seenDocuments' | 'displayName';
  order?: 'asc' | 'desc';
}

export interface TvanCatalogListResult {
  items: TvanCatalogProvider[];
  total: number;
  page: number;
  pageSize: number;
}
