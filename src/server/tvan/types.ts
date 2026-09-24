import type {
  InvoiceDocument,
  TvanCaptchaChallenge,
  TvanArtifactStatus,
  TvanCaptchaMode,
  TvanCaptchaProbe,
  TvanDownloadPriority,
  TvanDownloadRequestPlan,
  TvanPresentationLinkResult,
  TvanProviderCapability,
  TvanRequestTrace,
} from '../../shared/models/index.js';

export type FetchLike = typeof fetch;

export interface TvanPdfResult {
  content: Buffer;
  fileName: string;
  contentType: 'application/pdf';
}

export interface TvanOriginalFileResult {
  content: Buffer;
  fileName: string;
  contentType: 'application/pdf' | 'application/zip' | 'application/octet-stream';
}

export interface TvanPreparedArtifact {
  original: Buffer;
  originalFileName: string;
  originalContentType: 'application/pdf' | 'application/zip';
  pdf: Buffer;
  pdfFileName: string;
}

export interface TvanTokenState {
  token: string;
  expiresAt: number;
}

export interface TvanAdapterContext {
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxDownloadBytes: number;
  token?: TvanTokenState;
  setToken: (token: TvanTokenState | undefined) => void;
  loadInvoiceXml?: (document: InvoiceDocument) => Promise<Buffer>;
}

export interface TvanChallengeResult {
  challenge: TvanCaptchaChallenge;
  /** Adapter-private state. It never leaves the local backend. */
  privateState: unknown;
  /** Safe request trace for supervised development. Never include provider secrets. */
  trace?: TvanRequestTrace;
}


export interface TvanCaptchaProbeResult {
  probe: TvanCaptchaProbe;
  challengeResult?: TvanChallengeResult;
}

export interface TvanCaptchaVerifyTrace {
  request?: TvanRequestTrace;
  tokenExpiresAt?: string;
  stage?: TvanArtifactStatus['stage'];
  contextExpiresAt?: string;
}

export interface TvanAdapter {
  readonly providerCode: string;
  readonly displayName: string;
  readonly captchaMode: TvanCaptchaMode;
  readonly priority: TvanDownloadPriority;
  matches(document: InvoiceDocument): boolean;
  capability(document: InvoiceDocument): TvanProviderCapability;
  getCaptchaChallenge?(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult>;
  probeCaptchaChallenge?(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanCaptchaProbeResult>;
  verifyCaptcha?(
    document: InvoiceDocument,
    challenge: TvanCaptchaChallenge,
    privateState: unknown,
    answer: string,
    context: TvanAdapterContext,
  ): Promise<TvanCaptchaVerifyTrace | void>;
  describeDownloadRequest?(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): TvanDownloadRequestPlan;
  resolvePresentationLink?(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): Promise<TvanPresentationLinkResult>;
  prepareArtifact?(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): Promise<TvanPreparedArtifact>;
  artifactStatus?(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): TvanArtifactStatus;
  downloadOriginal?(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): Promise<TvanOriginalFileResult>;
  downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult>;
}
