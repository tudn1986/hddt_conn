import { randomUUID } from 'node:crypto';
import type {
  CaptchaChallenge,
  ConnectorMode,
  DownloadedFile,
  InvoiceLocator,
  InvoiceQuery,
  InvoiceSource,
  LoginInput,
  LoginResult,
  PortalInvoiceDetail,
  PortalInvoicePage,
} from '../../shared/models/index.js';
import { AppError, isRecord, safeString, sleep } from '../../shared/utils/index.js';
import { createMockInvoiceZip, extractInvoiceXml, isZip, validateInvoiceXml } from './zip.js';

export interface GdtConnector {
  startSession(): Promise<CaptchaChallenge>;
  login(input: LoginInput): Promise<LoginResult>;
  logout(): Promise<void>;
  queryInvoices(input: InvoiceQuery): Promise<PortalInvoicePage>;
  getInvoiceDetail(source: InvoiceSource, locator: InvoiceLocator): Promise<PortalInvoiceDetail>;
  downloadXml(source: InvoiceSource, locator: InvoiceLocator): Promise<DownloadedFile>;
  downloadZip(source: InvoiceSource, locator: InvoiceLocator): Promise<DownloadedFile>;
  isAuthenticated(): boolean;
  getSessionInfo(): { username?: string } | null;
}

export class SessionExpiredError extends AppError {
  constructor() {
    super('SESSION_EXPIRED', 'Phiên GDT đã hết hạn hoặc chưa đăng nhập.', 401);
    this.name = 'SessionExpiredError';
  }
}

export interface LiveConnectorOptions {
  origin?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxDownloadBytes?: number;
  captchaPath?: string;
  loginPath?: string;
  purchasePath?: string;
  salesPath?: string;
  posPurchasePath?: string;
  posSalesPath?: string;
  detailPath?: string;
  posDetailPath?: string;
  exportPath?: string;
  posExportPath?: string;
  exportMethod?: 'GET' | 'POST';
  posExportMethod?: 'GET' | 'POST';
  fetchImpl?: typeof fetch;
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;
  authenticated?: boolean;
  maxBytes?: number;
  action?: string;
};

const VERIFIED_ORIGIN = 'https://hoadondientu.gdt.gov.vn';

export class LiveGdtConnector implements GdtConnector {
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxDownloadBytes: number;
  private readonly paths: {
    captcha: string;
    login: string;
    purchase: string;
    sales: string;
    posPurchase: string;
    posSales: string;
    detail: string;
    posDetail: string;
    export: string;
    posExport: string;
  };
  private readonly exportMethods: { standard: 'GET' | 'POST'; pos: 'GET' | 'POST' };
  private readonly fetchImpl: typeof fetch;
  private readonly cookies = new Map<string, string>();
  private token: string | null = null;
  private username: string | null = null;
  private challenge: { key: string; createdAt: number } | null = null;

  constructor(options: LiveConnectorOptions = {}) {
    const origin = new URL(options.origin ?? VERIFIED_ORIGIN);
    if (origin.origin !== VERIFIED_ORIGIN || origin.username || origin.password) {
      throw new AppError('PORTAL_ORIGIN', 'Connector live chỉ cho phép origin GDT đã xác minh.', 500);
    }
    this.origin = origin.origin;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 50 * 1024 * 1024;
    this.maxDownloadBytes = options.maxDownloadBytes ?? 100 * 1024 * 1024;
    this.paths = {
      captcha: options.captchaPath ?? '/api/captcha',
      login: options.loginPath ?? '/api/security-taxpayer/authenticate',
      purchase: options.purchasePath ?? '/api/query/invoices/purchase',
      sales: options.salesPath ?? '/api/query/invoices/sold',
      posPurchase: options.posPurchasePath ?? '/api/sco-query/invoices/purchase',
      posSales: options.posSalesPath ?? '',
      detail: options.detailPath ?? '/api/query/invoices/detail',
      posDetail: options.posDetailPath ?? '/api/sco-query/invoices/detail',
      export: options.exportPath ?? '/api/query/invoices/export-xml',
      posExport: options.posExportPath ?? '/api/sco-query/invoices/export-xml',
    };
    for (const endpoint of Object.values(this.paths).filter(Boolean)) {
      this.validateEndpointPath(endpoint);
    }
    this.exportMethods = {
      standard: options.exportMethod ?? 'GET',
      pos: options.posExportMethod ?? 'POST',
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isAuthenticated(): boolean { return !!this.token; }
  getSessionInfo(): { username?: string } | null {
    return this.username ? { username: this.username } : null;
  }

  private validateEndpointPath(path: string): void {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/')) {
      throw new AppError('PORTAL_PATH', 'Endpoint GDT phải nằm dưới /api/ sau canonicalization.', 500);
    }
  }

  private url(path: string, query?: Record<string, string>): URL {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/')) {
      throw new AppError('PORTAL_ORIGIN', 'Từ chối request ra ngoài namespace /api/ của GDT.', 403);
    }
    for (const [name, value] of Object.entries(query || {})) {
      url.searchParams.set(name, value);
    }
    return url;
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private captureCookies(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? [];
    for (const header of values) {
      const first = header.split(';', 1)[0];
      const separator = first.indexOf('=');
      if (separator > 0) this.cookies.set(first.slice(0, separator).trim(), first.slice(separator + 1));
    }
  }

  private async request(operation: string, path: string, options: RequestOptions = {}): Promise<Response> {
    if (options.authenticated && !this.token) throw new SessionExpiredError();
    const headers = new Headers({
      Accept: operation === 'download'
        ? 'application/octet-stream, */*'
        : 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/152.0.0.0 Safari/537.36',
      Referer: `${this.origin}/vn/tra-cuu/tra-cuu-hoa-don`,
      'End-Point': '/tra-cuu/tra-cuu-hoa-don',
      Dnt: '1',
      // GDT started requiring a request-id header on API calls in September 2026.
      // Generate a fresh UUID for every upstream request, matching browser-style calls.
      'request-id': randomUUID(),
    });
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    const cookie = this.cookieHeader();
    if (cookie) headers.set('Cookie', cookie);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.action) headers.set('Action', options.action);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('PORTAL_TIMEOUT', `GDT không phản hồi kịp thời (${operation}).`, 504, true);
      }
      throw new AppError('NETWORK_ERROR', `Không kết nối được GDT (${operation}).`, 503, true);
    } finally {
      clearTimeout(timer);
    }
    this.captureCookies(response);
    if (options.authenticated && (response.status === 401 || response.status === 403)) {
      this.clearAuth();
      throw new SessionExpiredError();
    }
    if (!response.ok) {
      if (operation === 'login' && [400, 401, 403].includes(response.status)) {
        throw new AppError('AUTH_FAILED', 'Sai tài khoản, mật khẩu hoặc Captcha.', 401);
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new AppError(
        response.status === 429 ? 'RATE_LIMITED' : 'PORTAL_HTTP',
        `GDT trả HTTP ${response.status} (${operation}).`,
        502,
        retryable
      );
    }
    const maxBytes = options.maxBytes ?? this.maxResponseBytes;
    const advertised = Number(response.headers.get('content-length') || 0);
    if (advertised > maxBytes) {
      throw new AppError('PORTAL_SIZE', 'Phản hồi GDT vượt giới hạn dung lượng.', 502);
    }
    return response;
  }

  private async bytes(response: Response, maxBytes: number): Promise<Buffer> {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new AppError('PORTAL_SIZE', 'Phản hồi GDT vượt giới hạn dung lượng.', 502);
    }
    return bytes;
  }

  private async json(response: Response, maxBytes = this.maxResponseBytes): Promise<unknown> {
    const bytes = await this.bytes(response, maxBytes);
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new AppError('PORTAL_FORMAT', 'GDT không trả JSON hợp lệ.', 502);
    }
  }

  async startSession(): Promise<CaptchaChallenge> {
    const response = await this.request('captcha', this.paths.captcha, { maxBytes: 1024 * 1024 });
    const value = await this.json(response, 1024 * 1024);
    if (!isRecord(value)) throw new AppError('PORTAL_FORMAT', 'Captcha không đúng schema.', 502);
    const key = safeString(value.key ?? value.ckey);
    const content = safeString(value.content ?? value.image ?? value.captchaImage);
    if (!key || key.length > 4096 || !content) {
      throw new AppError('PORTAL_FORMAT', 'Captcha thiếu key hoặc nội dung ảnh.', 502);
    }
    const captchaImageBase64 = normalizeCaptchaImage(content);
    this.challenge = { key, createdAt: Date.now() };
    return {
      ckey: key,
      captchaImageBase64,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const challenge = this.challenge;
    this.challenge = null;
    // Keep cookies issued with the CAPTCHA; some portal deployments bind the
    // challenge to that cookie jar. Only clear the previous authenticated state.
    this.token = null;
    this.username = null;
    if (!challenge || challenge.key !== input.ckey || Date.now() - challenge.createdAt > 5 * 60_000) {
      return { success: false, message: 'Captcha đã hết hạn; vui lòng lấy ảnh mới.' };
    }
    try {
      const response = await this.request('login', this.paths.login, {
        method: 'POST',
        body: {
          username: input.username,
          password: input.password,
          cvalue: input.captcha,
          ckey: input.ckey,
        },
        maxBytes: 1024 * 1024,
      });
      const value = await this.json(response, 1024 * 1024);
      const token = isRecord(value) ? safeString(value.token) : undefined;
      if (!token || token.length > 16_384 || /[\r\n]/.test(token)) {
        return { success: false, message: 'GDT không trả phiên đăng nhập hợp lệ.' };
      }
      this.token = token;
      this.username = input.username;
      return { success: true, message: 'Đăng nhập thành công.' };
    } catch (error) {
      if (error instanceof AppError && error.code === 'AUTH_FAILED') {
        return { success: false, message: error.message };
      }
      throw error;
    }
  }

  async logout(): Promise<void> { this.clearAuth(); }

  private clearAuth(): void {
    this.token = null;
    this.username = null;
    this.cookies.clear();
  }

  async queryInvoices(input: InvoiceQuery): Promise<PortalInvoicePage> {
    const source = input.source ?? 'standard';
    const endpoint = input.direction === 'purchase'
      ? (source === 'pos' ? this.paths.posPurchase : this.paths.purchase)
      : (source === 'pos' ? this.paths.posSales : this.paths.sales);
    if (!endpoint) {
      throw new AppError(
        source === 'pos' ? 'LIVE_POS_SALES_ENDPOINT_UNCONFIGURED' : 'LIVE_SALES_ENDPOINT_UNCONFIGURED',
        source === 'pos'
          ? 'Endpoint bán ra POS chưa được capture/xác minh.'
          : 'Endpoint bán ra chưa được xác minh/cấu hình.',
        409
      );
    }
    const search = buildInvoiceSearch(input);
    const pageSize = 15;
    const query: Record<string, string> = {
      sort: 'tdlap:desc',
      size: String(pageSize),
      search,
    };
    if (input.cursor) query.state = input.cursor;
    const action = source === 'standard'
      ? (input.direction === 'purchase' ? 'Tìm kiếm (hóa đơn mua vào)' : 'Tìm kiếm (hóa đơn bán ra)')
      : undefined;
    const response = await this.request('query', endpoint, {
      query,
      authenticated: true,
      action: action ? encodeURIComponent(action) : undefined,
    });
    const value = await this.json(response);
    if (!isRecord(value)) throw new AppError('PORTAL_FORMAT', 'Danh sách GDT không đúng schema.', 502);
    const items = value.datas ?? value.items ?? value.data;
    if (!Array.isArray(items) || items.length > 1000 || !items.every(isRecord)) {
      throw new AppError('PORTAL_FORMAT', 'Danh sách GDT thiếu mảng datas hợp lệ.', 502);
    }
    const total = Number(value.total ?? value.totalElements ?? items.length);
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new AppError('PORTAL_FORMAT', 'Tổng số hóa đơn GDT không hợp lệ.', 502);
    }
    const nextCursor = safeString(value.state ?? value.nextCursor);
    if (nextCursor && nextCursor === input.cursor) {
      throw new AppError('PORTAL_FORMAT', 'GDT trả lại cùng pagination state.', 502);
    }
    return {
      total,
      page: input.page ?? 1,
      pageSize,
      items,
      nextCursor: items.length ? nextCursor : undefined,
    };
  }

  async getInvoiceDetail(source: InvoiceSource, locator: InvoiceLocator): Promise<PortalInvoiceDetail> {
    const endpoint = source === 'pos' ? this.paths.posDetail : this.paths.detail;
    if (!endpoint) {
      throw new AppError('POS_DETAIL_ENDPOINT_UNCONFIGURED', 'Endpoint chi tiết POS chưa được cấu hình.', 409);
    }
    const response = await this.request('detail', endpoint, {
      query: locatorQuery(locator),
      authenticated: true,
      // Do not invent a POS Action header. Standard value is captured from the portal.
      action: source === 'standard' ? encodeURIComponent('Xem hóa đơn (hóa đơn điện tử)') : undefined,
    });
    const value = await this.json(response);
    if (!isRecord(value)) throw new AppError('PORTAL_FORMAT', 'Chi tiết GDT không đúng schema.', 502);
    return { raw: isRecord(value.data) ? value.data : value };
  }

  private async downloadPackage(
    source: InvoiceSource,
    locator: InvoiceLocator
  ): Promise<{ bytes: Buffer; contentType?: string; kind: 'zip' | 'xml' }> {
    const endpoint = source === 'pos' ? this.paths.posExport : this.paths.export;
    if (!endpoint) {
      throw new AppError('POS_EXPORT_ENDPOINT_UNCONFIGURED', 'Endpoint export POS chưa được cấu hình.', 409);
    }
    const response = await this.request('download', endpoint, {
      method: this.exportMethods[source],
      query: locatorQuery(locator),
      authenticated: true,
      maxBytes: this.maxDownloadBytes,
    });
    const bytes = await this.bytes(response, this.maxDownloadBytes);
    if (isZip(bytes)) {
      return { bytes, kind: 'zip', contentType: response.headers.get('content-type') ?? undefined };
    }
    // Some deployments may return XML directly. Accept it only after strict XML validation.
    try {
      validateInvoiceXml(bytes);
      return { bytes, kind: 'xml', contentType: response.headers.get('content-type') ?? 'application/xml' };
    } catch {
      throw new AppError('DOWNLOAD_INVALID', 'GDT export-xml không trả ZIP hoặc XML hóa đơn hợp lệ.', 502);
    }
  }

  async downloadXml(source: InvoiceSource, locator: InvoiceLocator): Promise<DownloadedFile> {
    const pkg = await this.downloadPackage(source, locator);
    const content = pkg.kind === 'zip' ? await extractInvoiceXml(pkg.bytes) : pkg.bytes;
    return {
      content,
      filename: `${locator.sellerTaxCode}_${locator.series}_${locator.invoiceNo}.xml`,
      contentType: 'application/xml',
      size: content.length,
    };
  }

  async downloadZip(source: InvoiceSource, locator: InvoiceLocator): Promise<DownloadedFile> {
    const pkg = await this.downloadPackage(source, locator);
    if (pkg.kind !== 'zip') {
      throw new AppError('ZIP_UNAVAILABLE', 'Endpoint export chỉ trả XML trực tiếp; không có gói ZIP gốc.', 409);
    }
    return {
      content: pkg.bytes,
      filename: `${locator.sellerTaxCode}_${locator.series}_${locator.invoiceNo}.zip`,
      contentType: pkg.contentType || 'application/zip',
      size: pkg.bytes.length,
    };
  }
}

function locatorQuery(locator: InvoiceLocator): Record<string, string> {
  return {
    nbmst: String(locator.sellerTaxCode),
    khhdon: String(locator.series),
    shdon: String(locator.invoiceNo),
    khmshdon: String(locator.templateNo),
  };
}

function formatPortalDate(value: string, end = false): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AppError('INVALID_DATE', 'Ngày truy vấn phải có dạng YYYY-MM-DD.');
  return `${match[3]}/${match[2]}/${match[1]}T${end ? '23:59:59' : '00:00:00'}`;
}

function searchValue(value: string, label: string): string {
  if (/[;=\r\n]/.test(value)) throw new AppError('INVALID_FILTER', `${label} chứa ký tự không hợp lệ.`);
  return value;
}

export function buildInvoiceSearch(input: InvoiceQuery): string {
  const filters = [
    `tdlap=ge=${formatPortalDate(input.fromDate)}`,
    `tdlap=le=${formatPortalDate(input.toDate, true)}`,
  ];
  const status = input.status === undefined ? '5' : input.status;
  if (status && status !== '*') filters.push(`ttxly==${searchValue(status, 'Trạng thái')}`);
  if (input.partnerTaxCode) {
    filters.push(`${input.direction === 'purchase' ? 'nbmst' : 'nmmst'}==${searchValue(input.partnerTaxCode, 'MST đối tác')}`);
  }
  if (input.invoiceNo) filters.push(`shdon==${searchValue(input.invoiceNo, 'Số hóa đơn')}`);
  if (input.series) filters.push(`khhdon==${searchValue(input.series, 'Ký hiệu')}`);
  if (input.documentType) filters.push(`khmshdon==${searchValue(input.documentType, 'Loại chứng từ')}`);
  return filters.join(';');
}

function normalizeCaptchaImage(content: string): string {
  if (/^\s*<svg[\s>]/i.test(content)) {
    if (
      Buffer.byteLength(content) > 512 * 1024 ||
      /<(script|foreignObject|iframe|object|embed)\b|\son\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|data:)/i.test(content)
    ) {
      throw new AppError('CAPTCHA_UNSAFE', 'Nội dung Captcha SVG không an toàn.', 502);
    }
    return `data:image/svg+xml;base64,${Buffer.from(content, 'utf8').toString('base64')}`;
  }
  if (/^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(content)) {
    if (content.length > 1024 * 1024) throw new AppError('CAPTCHA_SIZE', 'Ảnh Captcha quá lớn.', 502);
    return content.replace(/\s/g, '');
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(content) && content.length <= 1024 * 1024) {
    return `data:image/png;base64,${content.replace(/\s/g, '')}`;
  }
  throw new AppError('PORTAL_FORMAT', 'Định dạng ảnh Captcha không hợp lệ.', 502);
}

export class MockGdtConnector implements GdtConnector {
  private authenticated = false;
  private username: string | null = null;
  private challengeKey: string | null = null;

  isAuthenticated(): boolean { return this.authenticated; }
  getSessionInfo(): { username?: string } | null {
    return this.username ? { username: this.username } : null;
  }

  async startSession(): Promise<CaptchaChallenge> {
    await sleep(5);
    this.challengeKey = `mock_${Date.now()}`;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50"><rect fill="#f0f0f0" width="160" height="50"/><text x="30" y="32" font-family="sans-serif" font-size="18">AB12</text></svg>';
    return {
      ckey: this.challengeKey,
      captchaImageBase64: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    await sleep(5);
    const valid = !!this.challengeKey && input.ckey === this.challengeKey && input.captcha.toUpperCase() === 'AB12';
    this.challengeKey = null;
    if (!valid) return { success: false, message: 'Sai Captcha (demo: AB12).' };
    this.authenticated = true;
    this.username = input.username;
    return { success: true, message: 'Đăng nhập demo thành công.' };
  }

  async logout(): Promise<void> {
    this.authenticated = false;
    this.username = null;
  }

  private requireLogin(): void {
    if (!this.authenticated) throw new SessionExpiredError();
  }

  async queryInvoices(input: InvoiceQuery): Promise<PortalInvoicePage> {
    this.requireLogin();
    const all = buildMockSummaries(input);
    const start = input.cursor ? Number(input.cursor) : 0;
    const pageSize = input.pageSize ?? 50;
    const items = all.slice(start, start + pageSize);
    const next = start + items.length;
    return {
      total: all.length,
      page: input.page ?? 1,
      pageSize,
      items,
      nextCursor: next < all.length ? String(next) : undefined,
    };
  }

  async getInvoiceDetail(_source: InvoiceSource, locator: InvoiceLocator): Promise<PortalInvoiceDetail> {
    this.requireLogin();
    return { raw: buildMockDetail(locator) };
  }

  private async mockPackage(locator: InvoiceLocator): Promise<Buffer> {
    this.requireLogin();
    const xml = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><HDon><DLHDon><TTChung><SHDon>${locator.invoiceNo}</SHDon><KHHDon>${locator.series}</KHHDon></TTChung><NDHDon><NBan><MST>${locator.sellerTaxCode}</MST></NBan></NDHDon></DLHDon></HDon>`,
      'utf8'
    );
    return createMockInvoiceZip(xml);
  }

  async downloadXml(_source: InvoiceSource, locator: InvoiceLocator): Promise<DownloadedFile> {
    const zip = await this.mockPackage(locator);
    const content = await extractInvoiceXml(zip);
    return { content, filename: 'invoice.xml', contentType: 'application/xml', size: content.length };
  }

  async downloadZip(_source: InvoiceSource, locator: InvoiceLocator): Promise<DownloadedFile> {
    const content = await this.mockPackage(locator);
    return { content, filename: 'invoice.zip', contentType: 'application/zip', size: content.length };
  }
}

function buildMockSummaries(input: InvoiceQuery): Record<string, unknown>[] {
  const seller = input.direction === 'purchase' ? '4501622475' : '4601622475';
  return [1, 2, 3].map((offset) => ({
    id: `mock-${input.source ?? 'standard'}-${input.direction}-${offset}`,
    nbmst: seller,
    nbten: `CÔNG TY DEMO ${offset}`,
    nmmst: input.direction === 'purchase' ? '4601622475' : `010010910${offset}`,
    nmten: `KHÁCH HÀNG DEMO ${offset}`,
    khmshdon: 1,
    khhdon: '1C26SND',
    shdon: 12345670 + offset,
    tdlap: `${offset === 1 ? input.fromDate : input.toDate}T00:00:00+07:00`,
    tgtcthue: 1_000_000 * offset,
    tgtthue: 100_000 * offset,
    tgtttbso: 1_100_000 * offset,
    dvtte: 'VND',
    tthai: 1,
    ttxly: Number(input.status ?? '5'),
    ngcnhat: offset === 1 ? 'tvan_softdreams' : 'tvan_viettel',
    loaihd: '01GTKT',
    tenloaihd: 'Hóa đơn GTGT',
  }));
}

function buildMockDetail(locator: InvoiceLocator): Record<string, unknown> {
  return {
    id: 'mock-detail',
    nbmst: locator.sellerTaxCode,
    nbten: 'CÔNG TY TNHH DEMO',
    nbdchi: 'Hà Nội',
    nmmst: '4601622475',
    nmten: 'CÔNG TY MUA DEMO',
    nmdchi: 'Thành phố Hồ Chí Minh',
    khmshdon: locator.templateNo,
    khhdon: locator.series,
    shdon: locator.invoiceNo,
    tdlap: '2026-07-15T00:00:00+07:00',
    dvtte: 'VND',
    tgia: 1,
    tgtcthue: 1_000_000,
    tgtthue: 100_000,
    tgtttbso: 1_100_000,
    htttoan: 'TM/CK',
    ngcnhat: 'tvan_softdreams',
    cttkhac: [
      { ttruong: 'Fkey', kdlieu: 'string', dlieu: 'DEMO-LOOKUP-001' },
      { ttruong: 'PortalLink', kdlieu: 'string', dlieu: 'https://tracuu.easyinvoice.vn/lookup/DEMO-LOOKUP-001' },
    ],
    hdhhdvu: [{
      id: 'line-1',
      stt: 1,
      sxep: 1,
      ten: 'Dịch vụ phần mềm HDDT',
      dvtinh: 'Gói',
      sluong: 1,
      dgia: 1_000_000,
      thtien: 1_000_000,
      ltsuat: '10%',
      tsuat: 10,
      tthue: 100_000,
    }],
    thttltsuat: [{ ltsuat: '10%', tsuat: 10, thtien: 1_000_000, tthue: 100_000 }],
  };
}

export function createConnector(
  mode: ConnectorMode = 'mock',
  options: LiveConnectorOptions = {}
): GdtConnector {
  return mode === 'live' ? new LiveGdtConnector(options) : new MockGdtConnector();
}
