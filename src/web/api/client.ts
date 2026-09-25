import type {
  QueryAutoInput,
  QueryAutoResult,
  PresentationAdapterIdentity,
  PresentationPrepareResult,
  PresentationStatusResult,
  TvanArtifactStatus,
  TvanBatchState,
  TvanBackportAnalysis,
  TvanCaptchaChallenge,
  TvanCaptchaVerificationResult,
  TvanDownloadRequestPlan,
  TvanPresentationLinkResult,
  TvanProviderCapability,
  TvanSupervisedPrepareResult,
} from '../../shared/models/index.js';
/** Local API client. The browser never calls the GDT portal directly. */

const BASE = '';
let csrfToken = '';

export interface AppStatus {
  version: string;
  authenticated: boolean;
  session: { username?: string } | null;
  connectorMode: 'live' | 'mock';
  csrfToken: string;
  capabilities: {
    livePurchase: boolean;
    livePurchaseStandard?: boolean;
    livePurchasePos?: boolean;
    liveSales: boolean;
    liveSalesPos?: boolean;
    detail: boolean;
    detailStandard?: boolean;
    detailPos?: boolean;
    xml: boolean;
    zip: boolean;
    exportStandard?: boolean;
    exportPos?: boolean;
    offlineDataset: boolean;
  };
  config: { storageMode: 'browser' };
}

export type TvanArtifactInfo = { id: string; providerCode: string; originalFileName: string; originalContentType: 'application/pdf' | 'application/zip'; pdfFileName: string; expiresAt: string };

type ApiError = Error & {
  status?: number;
  body?: unknown;
  code?: string;
  retryable?: boolean;
  retryStage?: string;
  preserveContext?: boolean;
  outcomeUnknown?: boolean;
};

function mutation(method?: string): boolean {
  return !!method && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function fileNameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* ignore invalid filename encoding */ }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1];
}

async function parseError(path: string, res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  const error = new Error(
    record?.message ? String(record.message)
      : record?.error ? String(record.error)
        : typeof body === 'string' && body ? body : `HTTP ${res.status}`
  ) as ApiError;
  error.status = res.status;
  error.body = body;
  error.code = record?.error ? String(record.error) : undefined;
  error.retryable = record?.retryable === true;
  error.retryStage = record?.retryStage ? String(record.retryStage) : undefined;
  error.preserveContext = record?.preserveContext === true;
  error.outcomeUnknown = record?.outcomeUnknown === true;
  // A 401 from the login endpoint is an authentication failure, not an expired local/GDT session.
  if (res.status === 401 && path !== '/api/auth/login') {
    window.dispatchEvent(new CustomEvent('hddt-session-expired'));
  }
  return error;
}

async function resyncCsrfToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/app/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const status = await res.json() as Partial<AppStatus>;
    const next = typeof status.csrfToken === 'string' ? status.csrfToken : '';
    if (!next) return false;
    csrfToken = next;
    return true;
  } catch {
    return false;
  }
}

async function rawRequest(path: string, options: RequestInit = {}, allowCsrfRetry = true): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (mutation(options.method)) {
    if (!csrfToken) {
      const recovered = await resyncCsrfToken();
      if (!recovered) throw new Error('Chưa khởi tạo mã bảo vệ phiên cục bộ. Hãy tải lại trang.');
    }
    headers.set('X-HDDT-CSRF', csrfToken);
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const error = await parseError(path, res);
    if (
      allowCsrfRetry
      && mutation(options.method)
      && res.status === 403
      && error.code === 'CSRF_INVALID'
      && await resyncCsrfToken()
    ) {
      return rawRequest(path, options, false);
    }
    throw error;
  }
  return res;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await rawRequest(path, options);
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json() as Promise<T>;
  return res.blob() as unknown as T;
}

export const api = {
  status: async () => {
    const status = await request<AppStatus>('/api/app/status');
    csrfToken = status.csrfToken;
    return status;
  },
  exit: (force = false) => request('/api/app/exit', {
    method: 'POST',
    body: JSON.stringify({ force }),
  }),

  getCaptcha: () => request<{ ckey: string; captchaImageBase64: string; expiresAt?: string }>('/api/auth/captcha'),
  login: async (body: {
    username: string;
    password: string;
    captcha: string;
    ckey: string;
    rememberUsername?: boolean;
  }) => {
    const result = await request<{ success: boolean; message?: string; csrfToken?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (result.csrfToken) csrfToken = result.csrfToken;
    return result;
  },
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  queryAuto: (body: QueryAutoInput, signal?: AbortSignal) => request<QueryAutoResult>('/api/invoices/query-auto', { method: 'POST', body: JSON.stringify(body), signal }),
  queryInvoices: (body: unknown) => request<{
    total: number;
    documents: unknown[];
    page: number;
    pageSize: number;
    nextCursor?: string;
  }>('/api/invoices/query', { method: 'POST', body: JSON.stringify(body) }),
  getDetail: (body: unknown) => request<{ document: unknown }>('/api/invoices/detail', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  getDetails: (body: unknown) => request<{ documents: unknown[]; errors: unknown[] }>('/api/invoices/details', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  saveDataset: (body: unknown) => request<{ ok: boolean; filePath: string }>('/api/datasets/save', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  openDataset: (filePath: string) => request<any>('/api/datasets/open', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  }),
  importDataset: (dataset: unknown) => request<any>('/api/datasets/import', {
    method: 'POST',
    body: JSON.stringify({ dataset }),
  }),
  listDatasets: (accountTaxCode: string) => request<{
    datasets: Array<{ fileName: string; filePath: string; size: number }>;
  }>(`/api/datasets?accountTaxCode=${encodeURIComponent(accountTaxCode)}`),

  downloadFile: (body: unknown) => rawRequest('/api/downloads/file', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(async (res) => ({
    blob: await res.blob(),
    fileName: decodeURIComponent(res.headers.get('x-hddt-filename') || `HDDT_${Date.now()}`),
  })),
  queueDownloads: (body: unknown) => request<{ tasks: unknown[] }>('/api/downloads/queue', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  startDownloads: () => request('/api/downloads/start', { method: 'POST' }),
  pauseDownloads: () => request('/api/downloads/pause', { method: 'POST' }),
  resumeDownloads: () => request('/api/downloads/resume', { method: 'POST' }),
  retryDownloads: () => request('/api/downloads/retry', { method: 'POST' }),
  downloadStatus: () => request<{ running: boolean; paused: boolean; tasks: any[] }>('/api/downloads/status'),
  clearCompletedDownloads: () => request('/api/downloads/clear-completed', { method: 'POST' }),
  openDownloadFolder: () => request('/api/downloads/open-folder', { method: 'POST' }),

  presentationAdapters: () => request<{ adapters: PresentationAdapterIdentity[] }>('/api/presentation/adapters'),
  presentationStatus: (document: unknown) => request<PresentationStatusResult>('/api/presentation/status', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  preparePresentation: (document: unknown) => request<PresentationPrepareResult>('/api/presentation/prepare', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  submitPresentationChallenge: (challengeId: string, answer: string) => request<TvanCaptchaVerificationResult>('/api/presentation/challenge', {
    method: 'POST',
    body: JSON.stringify({ challengeId, answer }),
  }),
  resolvePresentationLink: (document: unknown) => request<TvanPresentationLinkResult>('/api/presentation/resolve-link', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  viewPresentationPdf: (document: unknown) => rawRequest('/api/presentation/view', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then((res) => res.blob()),
  downloadPresentationPdf: (document: unknown) => rawRequest('/api/presentation/download', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then(async (res) => ({
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get('content-disposition')) || `HDDT_${Date.now()}.pdf`,
  })),
  downloadPresentationOriginal: (document: unknown) => rawRequest('/api/presentation/download-original', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then(async (res) => ({
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get('content-disposition')) || `HDDT_${Date.now()}`,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  })),

  tvanCapabilities: (documents: unknown[]) => request<{ providers: TvanProviderCapability[] }>('/api/tvan/capabilities', {
    method: 'POST',
    body: JSON.stringify({ documents }),
  }),
  prepareTvanPdfView: (document: unknown) => request<{
    capability: TvanProviderCapability;
    ready: boolean;
    challenge?: TvanCaptchaChallenge;
  }>('/api/tvan/pdf/prepare-view', { method: 'POST', body: JSON.stringify({ document }) }),
  resolveTvanPresentationLink: (document: unknown) => request<TvanPresentationLinkResult>('/api/tvan/presentation-link/resolve', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  prepareTvanSupervised: (document: unknown) => request<TvanSupervisedPrepareResult>('/api/tvan/supervised/prepare', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  describeTvanDownloadRequest: (document: unknown) => request<TvanDownloadRequestPlan>('/api/tvan/supervised/download-plan', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  submitTvanCaptcha: (challengeId: string, answer: string) => request<TvanCaptchaVerificationResult>('/api/tvan/pdf/captcha', {
    method: 'POST',
    body: JSON.stringify({ challengeId, answer }),
  }),
  prepareTvanArtifact: (document: unknown) => request<TvanArtifactInfo>('/api/tvan/artifacts/prepare', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  prepareTvanPdfArtifact: (document: unknown) => request<TvanArtifactInfo>('/api/tvan/pdf/prepare-artifact', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  tvanPdfStatus: (document: unknown) => request<TvanArtifactStatus>('/api/tvan/pdf/status', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }),
  downloadTvanPdf: (document: unknown) => rawRequest('/api/tvan/pdf/download', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then(async (res) => ({
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get('content-disposition')) || `HDDT_${Date.now()}.pdf`,
  })),
  downloadTvanOriginalArtifact: (document: unknown) => rawRequest('/api/tvan/artifact/download-original', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then(async (res) => ({
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get('content-disposition')) || `HDDT_${Date.now()}`,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  })),
  downloadTvanOriginal: (document: unknown) => rawRequest('/api/tvan/file/download', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then(async (res) => ({
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get('content-disposition')) || `HDDT_${Date.now()}`,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  })),
  downloadTvanArtifactFile: (id: string) => rawRequest(`/api/tvan/artifacts/${encodeURIComponent(id)}/file`).then((res) => res.blob()),
  downloadTvanArtifactPdf: (id: string) => rawRequest(`/api/tvan/artifacts/${encodeURIComponent(id)}/pdf`).then((res) => res.blob()),
  tvanArtifactPdfUrl: (id: string) => `/api/tvan/artifacts/${encodeURIComponent(id)}/pdf`,
  viewTvanPdf: (document: unknown) => rawRequest('/api/tvan/pdf/view', {
    method: 'POST',
    body: JSON.stringify({ document }),
  }).then((res) => res.blob()),
  startTvanPdfBatch: (documents: unknown[]) => request<TvanBatchState>('/api/tvan/pdf/batch/start', {
    method: 'POST',
    body: JSON.stringify({ documents }),
  }),
  getTvanPdfBatch: (id: string) => request<TvanBatchState>(`/api/tvan/pdf/batch/${encodeURIComponent(id)}`),
  submitTvanBatchCaptcha: (batchId: string, challengeId: string, answer: string) => request<TvanBatchState>(`/api/tvan/pdf/batch/${encodeURIComponent(batchId)}/captcha`, {
    method: 'POST',
    body: JSON.stringify({ challengeId, answer }),
  }),
  downloadTvanPdfArchive: (batchId: string) => rawRequest(`/api/tvan/pdf/batch/${encodeURIComponent(batchId)}/archive`).then((res) => res.blob()),
  analyzeTvanBackport: (body: { providerCode: string; rawJson?: string; rawXml?: string; notes?: string }) => request<{ analysis: TvanBackportAnalysis }>('/api/tvan/backport/analyze', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  saveTvanBackport: (body: { providerCode: string; rawJson?: string; rawXml?: string; notes?: string }) => request<{ sample: any }>('/api/tvan/backport/samples', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  listTvanBackport: () => request<{ samples: any[] }>('/api/tvan/backport/samples'),

  exportReport: (body: unknown) => rawRequest('/api/exports/report', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((res) => res.blob()),
  exportProfile: (body: unknown) => rawRequest('/api/exports/profile', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((res) => res.blob()),
  listProfiles: () => request<{ profiles: any[] }>('/api/exports/profiles'),

  getSettings: () => request<any>('/api/settings'),
  saveSettings: (body: unknown) => request<any>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  }),
  openDataRoot: () => request('/api/settings/open-data-root', { method: 'POST' }),
  getAccounts: () => request<{
    lastUsername?: string;
    accounts: Array<{ username: string; displayName?: string }>;
  }>('/api/accounts'),
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
