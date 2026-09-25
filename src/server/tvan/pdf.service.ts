import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yazl from 'yazl';
import type {
  InvoiceDocument,
  TvanArtifactStatus,
  TvanBatchState,
  TvanCaptchaChallenge,
  TvanCaptchaVerificationResult,
  TvanDownloadRequestPlan,
  TvanPdfTask,
  TvanPresentationLinkResult,
  TvanProviderCapability,
  TvanSupervisedPrepareResult,
} from '../../shared/models/index.js';
import { AppError, ensureDir, generateId, sha256Buffer } from '../../shared/utils/index.js';
import type { SettingsService } from '../services/settings.service.js';
import { safePdfFileName } from './http.js';
import { TvanRegistry } from './registry.js';
import { presentationAdapters, presentationIdentityOf } from '../presentation/manifest.js';
import type { FetchLike, TvanAdapter, TvanAdapterContext, TvanChallengeResult, TvanOriginalFileResult, TvanPdfResult, TvanTokenState } from './types.js';

type PendingChallenge = {
  challenge: TvanCaptchaChallenge;
  privateState: unknown;
  adapter: TvanAdapter;
  document: InvoiceDocument;
  batchId?: string;
  createdAt: number;
};

type CachedArtifact = {
  id: string;
  cacheKey: string;
  providerCode: string;
  original: Buffer;
  originalFileName: string;
  originalContentType: 'application/pdf' | 'application/zip';
  pdf: Buffer;
  pdfFileName: string;
  expiresAt: number;
};

type BatchInternal = {
  state: TvanBatchState;
  ordered: Array<{ document: InvoiceDocument; task: TvanPdfTask; adapter?: TvanAdapter }>;
  cursor: number;
  directory: string;
  archivePath: string;
  currentChallengeId?: string;
};

function cloneState(state: TvanBatchState): TvanBatchState {
  return structuredClone(state);
}

function uniqueFileName(existing: Set<string>, preferred: string): string {
  const safe = safePdfFileName(preferred);
  if (!existing.has(safe.toLocaleLowerCase())) {
    existing.add(safe.toLocaleLowerCase());
    return safe;
  }
  const stem = safe.replace(/\.pdf$/i, '');
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}_${index}.pdf`;
    if (!existing.has(candidate.toLocaleLowerCase())) {
      existing.add(candidate.toLocaleLowerCase());
      return candidate;
    }
  }
  return `${stem}_${generateId()}.pdf`;
}

export class TvanPdfService {
  private readonly registry: TvanRegistry;
  private readonly fetchImpl: FetchLike;
  private readonly loadInvoiceXml?: (document: InvoiceDocument) => Promise<Buffer>;
  private readonly tokens = new Map<string, TvanTokenState>();
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly batches = new Map<string, BatchInternal>();
  private readonly artifacts = new Map<string, CachedArtifact>();
  private readonly artifactCache = new Map<string, CachedArtifact>();
  private readonly inflightArtifacts = new Map<string, Promise<CachedArtifact>>();
  private readonly batchRoot: string;
  private readonly maxBatchBytes: number;
  private readonly artifactTtlMs: number;
  private cleanupTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(
    private readonly settings: SettingsService,
    options: { registry?: TvanRegistry; fetchImpl?: FetchLike; namespace?: string; loadInvoiceXml?: (document: InvoiceDocument) => Promise<Buffer> } = {},
  ) {
    this.registry = options.registry || new TvanRegistry();
    this.fetchImpl = options.fetchImpl || fetch;
    this.loadInvoiceXml = options.loadInvoiceXml;
    const namespace = options.namespace && /^[A-Za-z0-9_-]{8,64}$/.test(options.namespace)
      ? options.namespace
      : generateId();
    this.batchRoot = path.join(os.tmpdir(), 'hddt-session-temp', namespace);
    this.maxBatchBytes = Math.max(1, Number(process.env.HDDT_TVAN_BATCH_MAX_BYTES || 256 * 1024 * 1024));
    this.artifactTtlMs = Math.max(1_000, Number(process.env.HDDT_TVAN_ARTIFACT_TTL_MS || 10 * 60_000));
    void this.cleanupOldBatches();
    this.cleanupTimer = setInterval(() => void this.cleanupOldBatches(), 60_000);
    this.cleanupTimer.unref();
  }

  private ensureActive(): void {
    if (this.disposed) throw new AppError('SESSION_REVOKED', 'Phiên đã bị thu hồi.', 410);
  }

  capabilities(documents: InvoiceDocument[]): TvanProviderCapability[] {
    const byKey = new Map<string, TvanProviderCapability>();
    for (const document of documents) {
      const capability = this.registry.capability(document);
      const key = `${capability.providerCode}|${capability.supported}|${capability.reason || ''}`;
      if (!byKey.has(key)) byKey.set(key, capability);
    }
    return [...byKey.values()];
  }

  presentationAdapters() {
    return presentationAdapters(this.registry.getAdapters());
  }

  presentationStatus(document: InvoiceDocument) {
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    return {
      adapter: adapter ? presentationIdentityOf(adapter) : undefined,
      capability,
      artifact: this.artifactStatus(document),
    };
  }

  async preparePresentation(document: InvoiceDocument) {
    const prepared = await this.prepareView(document);
    const adapter = this.registry.resolve(document);
    return {
      adapter: adapter ? presentationIdentityOf(adapter) : undefined,
      ...prepared,
    };
  }

  private documentFingerprint(document: InvoiceDocument): string {
    return sha256Buffer(Buffer.from(JSON.stringify({
      key: document.key,
      providerCode: document.providerCode || document.lookup?.providerCode || '',
      direction: document.direction,
      invoiceSource: document.invoiceSource,
      sellerTaxCode: document.seller?.taxCode || '',
      templateNo: document.templateNo ?? '',
      series: document.series || '',
      invoiceNo: document.invoiceNo ?? '',
      issueDate: document.issueDate || '',
      lookupCode: document.lookup?.lookupCode || '',
      lookupBaseUrl: document.lookup?.lookupBaseUrl || '',
    }), 'utf8'));
  }

  private artifactCacheKey(adapter: TvanAdapter, document: InvoiceDocument): string {
    return `${adapter.providerCode}|${this.documentFingerprint(document)}`;
  }

  private tokenKey(adapter: TvanAdapter, document?: InvoiceDocument): string {
    if (adapter.captchaMode === 'per_invoice') {
      return document
        ? this.artifactCacheKey(adapter, document)
        : `${adapter.providerCode}|__missing_document__`;
    }
    return adapter.providerCode;
  }

  private tokenFor(adapter: TvanAdapter, document?: InvoiceDocument): TvanTokenState | undefined {
    const key = this.tokenKey(adapter, document);
    const token = this.tokens.get(key);
    if (!token) return undefined;
    if (token.expiresAt <= Date.now()) {
      this.tokens.delete(key);
      return undefined;
    }
    return token;
  }

  private context(adapter: TvanAdapter, document?: InvoiceDocument): TvanAdapterContext {
    const network = this.settings.getConfig().network;
    const key = this.tokenKey(adapter, document);
    return {
      fetchImpl: this.fetchImpl,
      loadInvoiceXml: this.loadInvoiceXml,
      timeoutMs: network.requestTimeoutMs,
      maxDownloadBytes: network.maxDownloadBytes,
      token: this.tokenFor(adapter, document),
      setToken: (token) => {
        if (token) this.tokens.set(key, token);
        else this.tokens.delete(key);
      },
    };
  }

  private cachedArtifact(adapter: TvanAdapter, document: InvoiceDocument): CachedArtifact | undefined {
    const key = this.artifactCacheKey(adapter, document);
    const cached = this.artifactCache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.artifactCache.delete(key);
      this.artifacts.delete(cached.id);
      return undefined;
    }
    return cached;
  }

  private async ensureArtifact(adapter: TvanAdapter, document: InvoiceDocument): Promise<CachedArtifact> {
    const cached = this.cachedArtifact(adapter, document);
    if (cached) return cached;

    const cacheKey = this.artifactCacheKey(adapter, document);
    const running = this.inflightArtifacts.get(cacheKey);
    if (running) return running;

    const operation = (async () => {
      const context = this.context(adapter, document);
      const prepared = adapter.prepareArtifact
        ? await adapter.prepareArtifact(document, context)
        : await adapter.downloadPdf(document, context).then((pdf) => ({
          original: pdf.content,
          originalFileName: pdf.fileName,
          originalContentType: 'application/pdf' as const,
          pdf: pdf.content,
          pdfFileName: pdf.fileName,
        }));
      const id = generateId();
      const artifact: CachedArtifact = {
        ...prepared,
        id,
        cacheKey,
        providerCode: adapter.providerCode,
        expiresAt: Date.now() + this.artifactTtlMs,
      };
      this.artifactCache.set(cacheKey, artifact);
      this.artifacts.set(id, artifact);
      return artifact;
    })().finally(() => {
      this.inflightArtifacts.delete(cacheKey);
    });

    this.inflightArtifacts.set(cacheKey, operation);
    return operation;
  }

  private artifactInfo(artifact: CachedArtifact) {
    return {
      id: artifact.id,
      providerCode: artifact.providerCode,
      originalFileName: artifact.originalFileName,
      originalContentType: artifact.originalContentType,
      pdfFileName: artifact.pdfFileName,
      expiresAt: new Date(artifact.expiresAt).toISOString(),
    };
  }

  async prepareView(document: InvoiceDocument): Promise<{
    capability: TvanProviderCapability;
    ready: boolean;
    challenge?: TvanCaptchaChallenge;
  }> {
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) return { capability, ready: false };
    if (this.cachedArtifact(adapter, document)) return { capability, ready: true };
    if (adapter.captchaMode === 'none' || this.tokenFor(adapter, document)) return { capability, ready: true };
    const challenge = await this.createChallenge(adapter, document);
    return { capability, ready: false, challenge };
  }

  async resolvePresentationLink(document: InvoiceDocument): Promise<TvanPresentationLinkResult> {
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      throw new AppError(
        'TVAN_PRESENTATION_LINK_UNSUPPORTED',
        capability.reason || 'TVAN chưa hỗ trợ luồng xác minh link bản thể hiện.',
        422,
      );
    }
    if (!adapter.resolvePresentationLink) {
      throw new AppError(
        'TVAN_PRESENTATION_LINK_UNSUPPORTED',
        `${capability.displayName} chưa triển khai luồng xác minh link bản thể hiện.`,
        422,
      );
    }
    return adapter.resolvePresentationLink(document, this.context(adapter, document));
  }

  private async createChallengeResult(
    adapter: TvanAdapter,
    document: InvoiceDocument,
    batchId?: string,
  ): Promise<TvanChallengeResult> {
    if (!adapter.getCaptchaChallenge) throw new AppError('TVAN_CAPTCHA_UNSUPPORTED', 'Adapter TVAN chưa khai báo endpoint CAPTCHA.', 501);
    const result = await adapter.getCaptchaChallenge(document, this.context(adapter, document));
    this.challenges.set(result.challenge.id, {
      challenge: result.challenge,
      privateState: result.privateState,
      adapter,
      document,
      batchId,
      createdAt: Date.now(),
    });
    return result;
  }

  private async createChallenge(
    adapter: TvanAdapter,
    document: InvoiceDocument,
    batchId?: string,
  ): Promise<TvanCaptchaChallenge> {
    return (await this.createChallengeResult(adapter, document, batchId)).challenge;
  }

  async prepareSupervised(document: InvoiceDocument): Promise<TvanSupervisedPrepareResult> {
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      throw new AppError('TVAN_SUPERVISED_UNSUPPORTED', capability.reason || 'TVAN chưa hỗ trợ luồng giám sát.', 422);
    }
    if (adapter.captchaMode === 'none') {
      throw new AppError('TVAN_SUPERVISED_CAPTCHA_NOT_REQUIRED', `${capability.displayName} không yêu cầu CAPTCHA.`, 422);
    }
    const plan = adapter.describeDownloadRequest?.(document, this.context(adapter, document));
    if (adapter.probeCaptchaChallenge) {
      const probed = await adapter.probeCaptchaChallenge(document, this.context(adapter, document));
      const challengeResult = probed.challengeResult;
      if (challengeResult) {
        this.challenges.set(challengeResult.challenge.id, {
          challenge: challengeResult.challenge,
          privateState: challengeResult.privateState,
          adapter,
          document,
          createdAt: Date.now(),
        });
      }
      return {
        capability,
        lookup: plan?.lookup || {},
        challenge: challengeResult?.challenge,
        challengeRequest: challengeResult?.trace,
        captchaProbe: probed.probe,
        preparedAt: new Date().toISOString(),
      };
    }
    const result = await this.createChallengeResult(adapter, document);
    return {
      capability,
      lookup: plan?.lookup || {},
      challenge: result.challenge,
      challengeRequest: result.trace,
      preparedAt: new Date().toISOString(),
    };
  }

  describeDownloadRequest(document: InvoiceDocument): TvanDownloadRequestPlan {
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      throw new AppError('TVAN_DOWNLOAD_PLAN_UNSUPPORTED', capability.reason || 'TVAN chưa hỗ trợ dựng request tải PDF.', 422);
    }
    if (!adapter.describeDownloadRequest) {
      throw new AppError('TVAN_DOWNLOAD_PLAN_UNSUPPORTED', `${capability.displayName} chưa khai báo request tải PDF có giám sát.`, 422);
    }
    return adapter.describeDownloadRequest(document, this.context(adapter, document));
  }

  async verifyCaptcha(challengeId: string, answer: string): Promise<TvanCaptchaVerificationResult> {
    const pending = this.challenges.get(challengeId);
    if (!pending) throw new AppError('TVAN_CAPTCHA_NOT_FOUND', 'CAPTCHA đã hết hạn hoặc không tồn tại.', 404);
    if (Date.now() - pending.createdAt > 15 * 60_000) {
      this.challenges.delete(challengeId);
      throw new AppError('TVAN_CAPTCHA_EXPIRED', 'CAPTCHA đã hết hạn.', 410);
    }
    if (!pending.adapter.verifyCaptcha) throw new AppError('TVAN_CAPTCHA_UNSUPPORTED', 'Adapter TVAN chưa hỗ trợ xác thực CAPTCHA.', 501);
    const verification = await pending.adapter.verifyCaptcha(
      pending.document,
      pending.challenge,
      pending.privateState,
      answer,
      this.context(pending.adapter, pending.document),
    );
    this.challenges.delete(challengeId);
    return {
      ok: true,
      providerCode: pending.adapter.providerCode,
      batchId: pending.batchId,
      verificationRequest: verification?.request,
      tokenExpiresAt: verification?.tokenExpiresAt,
      stage: verification?.stage,
      contextExpiresAt: verification?.contextExpiresAt,
      verifiedAt: new Date().toISOString(),
    };
  }

  artifactStatus(document: InvoiceDocument): TvanArtifactStatus {
    this.ensureActive();
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      return {
        providerCode: capability.providerCode,
        stage: 'new',
        ready: false,
        canRetryPrepare: false,
        canView: false,
        canDownloadPdf: false,
        canDownloadOriginal: false,
      };
    }
    const cached = this.cachedArtifact(adapter, document);
    if (cached) {
      return {
        providerCode: adapter.providerCode,
        stage: 'pdf_ready',
        ready: true,
        canRetryPrepare: false,
        canView: true,
        canDownloadPdf: true,
        canDownloadOriginal: true,
        expiresAt: new Date(cached.expiresAt).toISOString(),
        originalKind: cached.originalContentType === 'application/zip' ? 'zip' : 'pdf',
        originalFileName: cached.originalFileName,
        pdfFileName: cached.pdfFileName,
      };
    }
    return adapter.artifactStatus
      ? adapter.artifactStatus(document, this.context(adapter, document))
      : {
        providerCode: adapter.providerCode,
        stage: 'new',
        ready: false,
        canRetryPrepare: false,
        canView: false,
        canDownloadPdf: false,
        canDownloadOriginal: false,
      };
  }

  async prepareArtifact(document: InvoiceDocument) {
    this.ensureActive();
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      throw new AppError('TVAN_ARTIFACT_UNSUPPORTED', capability.reason || 'TVAN chưa hỗ trợ chuẩn bị file hóa đơn.', 422);
    }
    return this.artifactInfo(await this.ensureArtifact(adapter, document));
  }

  async downloadOriginal(document: InvoiceDocument): Promise<TvanOriginalFileResult> {
    this.ensureActive();
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      throw new AppError('TVAN_FILE_UNSUPPORTED', capability.reason || 'TVAN chưa hỗ trợ tải file gốc.', 422);
    }
    if (adapter.prepareArtifact) {
      const artifact = await this.ensureArtifact(adapter, document);
      return {
        content: artifact.original,
        fileName: artifact.originalFileName,
        contentType: artifact.originalContentType,
      };
    }
    if (!adapter.downloadOriginal) {
      throw new AppError('TVAN_FILE_UNSUPPORTED', `${capability.displayName} chưa hỗ trợ tải file gốc.`, 422);
    }
    return adapter.downloadOriginal(document, this.context(adapter, document));
  }

  private artifact(id: string): CachedArtifact {
    this.ensureActive();
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new AppError('TVAN_ARTIFACT_NOT_FOUND', 'Không tìm thấy file hóa đơn đã chuẩn bị.', 404);
    if (artifact.expiresAt <= Date.now()) {
      this.artifacts.delete(id);
      this.artifactCache.delete(artifact.cacheKey);
      throw new AppError('TVAN_ARTIFACT_EXPIRED', 'File hóa đơn đã hết thời gian lưu tạm.', 410);
    }
    return artifact;
  }

  getArtifactFile(id: string) {
    const artifact = this.artifact(id);
    return { content: artifact.original, contentType: artifact.originalContentType, fileName: artifact.originalFileName };
  }

  getArtifactPdf(id: string): TvanPdfResult {
    const artifact = this.artifact(id);
    return { content: artifact.pdf, contentType: 'application/pdf', fileName: artifact.pdfFileName };
  }

  async viewPdf(document: InvoiceDocument): Promise<TvanPdfResult> {
    const adapter = this.registry.resolve(document);
    const capability = this.registry.capability(document);
    if (!adapter || !capability.supported) {
      throw new AppError('TVAN_PDF_UNSUPPORTED', capability.reason || 'TVAN chưa hỗ trợ xem PDF.', 422);
    }
    if (adapter.prepareArtifact) {
      const artifact = await this.ensureArtifact(adapter, document);
      return {
        content: artifact.pdf,
        contentType: 'application/pdf',
        fileName: artifact.pdfFileName,
      };
    }
    return adapter.downloadPdf(document, this.context(adapter, document));
  }

  async startBatch(documents: InvoiceDocument[]): Promise<TvanBatchState> {
    this.ensureActive();
    if (!documents.length) throw new AppError('TVAN_BATCH_EMPTY', 'Chưa chọn hóa đơn để tải PDF.', 400);
    if (documents.length > 2_000) throw new AppError('TVAN_BATCH_TOO_LARGE', 'Mỗi lần tối đa 2.000 hóa đơn.', 400);
    const id = generateId();
    const createdAt = new Date().toISOString();
    const directory = path.join(this.batchRoot, id);
    await ensureDir(directory);
    const ordered = documents.map((document) => {
      const adapter = this.registry.resolve(document);
      const capability = this.registry.capability(document);
      const task: TvanPdfTask = {
        id: generateId(),
        documentKey: document.key,
        providerCode: capability.providerCode,
        priority: capability.priority,
        status: capability.supported ? 'pending' : 'failed',
        error: capability.supported ? undefined : capability.reason,
      };
      return { document, task, adapter };
    }).sort((left, right) => left.task.priority.localeCompare(right.task.priority));

    const state: TvanBatchState = {
      id,
      status: 'running',
      createdAt,
      updatedAt: createdAt,
      tasks: ordered.map((item) => item.task),
      archiveReady: false,
    };
    const batch: BatchInternal = {
      state,
      ordered,
      cursor: 0,
      directory,
      archivePath: path.join(directory, `HDDT_PDF_${id}.zip`),
    };
    this.batches.set(id, batch);
    await this.runBatch(batch);
    return cloneState(batch.state);
  }

  getBatch(id: string): TvanBatchState {
    const batch = this.batches.get(id);
    if (!batch) throw new AppError('TVAN_BATCH_NOT_FOUND', 'Không tìm thấy phiên tải PDF.', 404);
    return cloneState(batch.state);
  }

  async submitBatchCaptcha(batchId: string, challengeId: string, answer: string): Promise<TvanBatchState> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new AppError('TVAN_BATCH_NOT_FOUND', 'Không tìm thấy phiên tải PDF.', 404);
    if (batch.currentChallengeId !== challengeId) throw new AppError('TVAN_CAPTCHA_MISMATCH', 'CAPTCHA không thuộc bước tải hiện tại.', 409);
    const pending = this.challenges.get(challengeId);
    if (!pending || pending.batchId !== batchId) throw new AppError('TVAN_CAPTCHA_NOT_FOUND', 'CAPTCHA đã hết hạn.', 404);
    await this.verifyCaptcha(challengeId, answer);
    batch.currentChallengeId = undefined;
    batch.state.challenge = undefined;
    batch.state.status = 'running';
    const current = batch.ordered[batch.cursor];
    if (current?.task.status === 'waiting_captcha') current.task.status = 'pending';
    await this.runBatch(batch);
    return cloneState(batch.state);
  }

  getArchivePath(batchId: string): string {
    const batch = this.batches.get(batchId);
    if (!batch) throw new AppError('TVAN_BATCH_NOT_FOUND', 'Không tìm thấy phiên tải PDF.', 404);
    if (!batch.state.archiveReady) throw new AppError('TVAN_ARCHIVE_NOT_READY', 'Gói PDF chưa sẵn sàng.', 409);
    return batch.archivePath;
  }

  private async runBatch(batch: BatchInternal): Promise<void> {
    const existingNames = new Set(
      batch.ordered.map((item) => item.task.fileName?.toLocaleLowerCase()).filter((value): value is string => Boolean(value))
    );
    while (batch.cursor < batch.ordered.length) {
      const current = batch.ordered[batch.cursor];
      const { task, document, adapter } = current;
      if (task.status === 'failed' || task.status === 'done') {
        batch.cursor += 1;
        continue;
      }
      if (!adapter) {
        task.status = 'failed';
        task.error ||= 'TVAN chưa có adapter PDF.';
        batch.cursor += 1;
        continue;
      }

      const context = this.context(adapter, document);
      const needsCaptcha = (adapter.captchaMode === 'per_invoice' || adapter.captchaMode === 'session')
        && !context.token;
      if (needsCaptcha) {
        try {
          const challenge = await this.createChallenge(adapter, document, batch.state.id);
          task.status = 'waiting_captcha';
          batch.currentChallengeId = challenge.id;
          batch.state.challenge = challenge;
          batch.state.status = 'waiting_captcha';
          batch.state.updatedAt = new Date().toISOString();
          return;
        } catch (error) {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : 'Không lấy được CAPTCHA TVAN.';
          batch.cursor += 1;
          continue;
        }
      }

      task.status = 'downloading';
      batch.state.updatedAt = new Date().toISOString();
      try {
        const pdf = adapter.prepareArtifact
          ? await this.ensureArtifact(adapter, document).then((artifact) => ({
            content: artifact.pdf,
            contentType: 'application/pdf' as const,
            fileName: artifact.pdfFileName,
          }))
          : await adapter.downloadPdf(document, context);
        this.ensureActive();
        const usedBytes = batch.ordered.reduce((sum, item) => sum + (item.task.size || 0), 0);
        if (usedBytes + pdf.content.length > this.maxBatchBytes) {
          throw new AppError('TVAN_BATCH_QUOTA', 'Gói PDF vượt giới hạn dung lượng phiên.', 413);
        }
        const fileName = uniqueFileName(existingNames, pdf.fileName);
        const target = path.join(batch.directory, fileName);
        await fsp.writeFile(target, pdf.content, { flag: 'wx', mode: 0o600 });
        task.fileName = fileName;
        task.size = pdf.content.length;
        task.status = 'done';
        task.error = undefined;
        batch.cursor += 1;
      } catch (error) {
        if (error instanceof AppError && error.code === 'TVAN_CAPTCHA_REQUIRED') {
          try {
            const challenge = await this.createChallenge(adapter, document, batch.state.id);
            task.status = 'waiting_captcha';
            batch.currentChallengeId = challenge.id;
            batch.state.challenge = challenge;
            batch.state.status = 'waiting_captcha';
            batch.state.updatedAt = new Date().toISOString();
            return;
          } catch (challengeError) {
            task.status = 'failed';
            task.error = challengeError instanceof Error ? challengeError.message : 'Không lấy được CAPTCHA TVAN.';
            batch.cursor += 1;
            continue;
          }
        }
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Tải PDF thất bại.';
        batch.cursor += 1;
      }
    }

    await this.buildArchive(batch);
    batch.state.status = 'done';
    batch.state.archiveReady = true;
    batch.state.challenge = undefined;
    batch.state.updatedAt = new Date().toISOString();
  }

  private buildArchive(batch: BatchInternal): Promise<void> {
    return new Promise((resolve, reject) => {
      const zip = new yazl.ZipFile();
      const output = fs.createWriteStream(batch.archivePath, { flags: 'wx', mode: 0o600 });
      output.once('error', reject);
      output.once('close', resolve);
      zip.outputStream.once('error', reject);
      zip.outputStream.pipe(output);
      for (const item of batch.ordered) {
        if (item.task.status === 'done' && item.task.fileName) {
          zip.addFile(path.join(batch.directory, item.task.fileName), item.task.fileName);
        }
      }
      const manifest = Buffer.from(JSON.stringify({
        schemaVersion: 1,
        batchId: batch.state.id,
        createdAt: batch.state.createdAt,
        completedAt: new Date().toISOString(),
        tasks: batch.state.tasks.map((task) => ({
          documentKey: task.documentKey,
          providerCode: task.providerCode,
          priority: task.priority,
          status: task.status,
          fileName: task.fileName,
          size: task.size,
          error: task.error,
        })),
      }, null, 2));
      zip.addBuffer(manifest, 'manifest.json');
      zip.end();
    });
  }

  async describePdf(pdf: TvanPdfResult): Promise<{ fileName: string; size: number; sha256: string }> {
    return { fileName: pdf.fileName, size: pdf.content.length, sha256: sha256Buffer(pdf.content) };
  }

  async deleteBatch(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    this.batches.delete(batchId);
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.batchId === batchId) this.challenges.delete(challengeId);
    }
    await fsp.rm(batch.directory, { recursive: true, force: true }).catch(() => undefined);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.tokens.clear();
    this.challenges.clear();
    this.batches.clear();
    this.artifacts.clear();
    this.artifactCache.clear();
    this.inflightArtifacts.clear();
    await fsp.rm(this.batchRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  private async cleanupOldBatches(): Promise<void> {
    await ensureDir(this.batchRoot).catch(() => undefined);
    const cutoff = Date.now() - 10 * 60_000;
    const entries = await fsp.readdir(this.batchRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const directory = path.join(this.batchRoot, entry.name);
      const stat = await fsp.stat(directory).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }));
  }
}
