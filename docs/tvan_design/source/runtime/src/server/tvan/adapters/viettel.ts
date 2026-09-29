import crypto from 'node:crypto';
import type { InvoiceDocument, TvanCaptchaChallenge, TvanCaptchaProbe, TvanCaptchaProbeAttempt, TvanDownloadRequestPlan, TvanProviderCapability } from '../../../shared/models/index.js';
import { AppError, isRecord, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf, providerCodeOf } from '../extract.js';
import {
  assertAllowedUrl,
  ensurePdf,
  fetchWithTimeout,
  readJson,
  readLimited,
  responseFileName,
  safePdfFileName,
} from '../http.js';
import type { TvanAdapter, TvanAdapterContext, TvanCaptchaProbeResult, TvanCaptchaVerifyTrace, TvanChallengeResult, TvanPdfResult } from '../types.js';

const ORIGIN = 'https://vinvoice.viettel.vn';
const ALLOWED_HOSTS = ['vinvoice.viettel.vn'] as const;
const VERIFY_ENDPOINT = `${ORIGIN}/api/services/einvoiceuaa/api/captcha/verify`;
const DOWNLOAD_ENDPOINT = `${ORIGIN}/api/services/einvoicequery/sync/utility/downloadPDF`;
const CAPTCHA_ENDPOINTS = [
  // Current Viettel invoice-search bundle calls /captcha/generate first.
  `${ORIGIN}/api/services/einvoiceuaa/api/captcha/generate`,
  // Keep older endpoints as compatibility fallbacks only.
  `${ORIGIN}/api/services/einvoiceuaa/api/captcha/get`,
  `${ORIGIN}/api/services/einvoiceuaa/api/captcha`,
] as const;

type ViettelPrivateChallenge = { token: string; cookieHeader?: string };

type ParsedChallenge = {
  token: string;
  kind: 'text' | 'slider';
  imageSource?: string;
  pieceImageSource?: string;
  sliderMax?: number;
  sliderStart?: number;
  sliderY?: number;
  expiresAt?: string;
};

function reservationCodeOf(document: InvoiceDocument): string | undefined {
  return findNamedValue(document, ['Mã số bí mật', 'Ma so bi mat', 'reservationCode'])
    || (providerCodeOf(document).includes('viettel') ? lookupCodeOf(document) : undefined);
}

function sellerTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.seller?.taxCode)
    || findNamedValue(document, ['nbmst', 'supplierTaxCode', 'MST người bán']);
}

function defaultName(document: InvoiceDocument): string {
  return safePdfFileName([
    document.seller?.taxCode,
    document.series,
    document.invoiceNo,
  ].filter(Boolean).join('_') || 'Viettel_invoice');
}

function recordsDeep(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 5 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (typeof node === 'string') {
      const text = node.trim();
      if (text.startsWith('{') || text.startsWith('[')) {
        try { visit(JSON.parse(text) as unknown, depth + 1); } catch { /* plain string */ }
      }
      return;
    }
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);
    records.push(node);
    for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(value, 0);
  return records;
}

function firstDeepString(records: Record<string, unknown>[], names: string[]): string | undefined {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase()));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(key.toLocaleLowerCase())) continue;
      const text = safeString(value);
      if (text) return text;
    }
  }
  return undefined;
}

function firstDeepNumber(records: Record<string, unknown>[], names: string[]): number | undefined {
  const value = firstDeepString(records, names);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function hasDeepKey(records: Record<string, unknown>[], names: string[]): boolean {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase()));
  return records.some((record) => Object.keys(record).some((key) => wanted.has(key.toLocaleLowerCase())));
}

type ResolvedImage = { base64: string; mimeType: string };

type DeepStringEntry = { key: string; value: string };

function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const prefix = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8').trimStart().toLocaleLowerCase();
  if (prefix.startsWith('<svg') || prefix.startsWith('<?xml') && prefix.includes('<svg')) return 'image/svg+xml';
  return undefined;
}

function normalizeInlineImage(value: string | undefined): ResolvedImage | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(text);
  if (dataMatch) {
    const base64 = dataMatch[2].replace(/\s+/g, '');
    return base64 ? { base64, mimeType: dataMatch[1].toLocaleLowerCase() } : undefined;
  }
  if (/^base64,/i.test(text)) {
    const base64 = text.slice(text.indexOf(',') + 1).replace(/\s+/g, '');
    if (!base64) return undefined;
    try {
      const bytes = Buffer.from(base64, 'base64');
      return { base64, mimeType: sniffImageMime(bytes) || 'image/png' };
    } catch { return undefined; }
  }
  if (/^(?:https?:\/\/|\/)/i.test(text)) return undefined;
  const normalized = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length < 16) return undefined;
  try {
    const bytes = Buffer.from(normalized, 'base64');
    const mimeType = sniffImageMime(bytes);
    return mimeType ? { base64: normalized, mimeType } : undefined;
  } catch { return undefined; }
}

function deepStringEntries(value: unknown): DeepStringEntry[] {
  const entries: DeepStringEntry[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, key: string, depth: number) => {
    if (depth > 6 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      entries.push({ key, value: node });
      const text = node.trim();
      if ((text.startsWith('{') || text.startsWith('[')) && text.length <= 2 * 1024 * 1024) {
        try { visit(JSON.parse(text) as unknown, `${key}.json`, depth + 1); } catch { /* plain string */ }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${key}[${index}]`, depth + 1));
      return;
    }
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);
    for (const [childKey, child] of Object.entries(node)) visit(child, key ? `${key}.${childKey}` : childKey, depth + 1);
  };
  visit(value, '', 0);
  return entries;
}

function imageCandidatesFromPayload(payload: unknown): Array<{ key: string; source: string; inline?: ResolvedImage }> {
  const candidates: Array<{ key: string; source: string; inline?: ResolvedImage }> = [];
  for (const entry of deepStringEntries(payload)) {
    const inline = normalizeInlineImage(entry.value);
    if (inline) {
      candidates.push({ key: entry.key, source: entry.value, inline });
      continue;
    }
    const lowerKey = entry.key.toLocaleLowerCase();
    if (/image|img|captcha|jigsaw|slider|piece|puzzle|background|master|tile/.test(lowerKey)
      && /^(?:https?:\/\/|\/)/i.test(entry.value.trim())) {
      candidates.push({ key: entry.key, source: entry.value.trim() });
    }
  }
  return candidates;
}

function responseCookieInfo(response: Response): { cookieHeader?: string; names: string[] } {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : []);
  const pairs: string[] = [];
  const names: string[] = [];
  for (const raw of values) {
    // The first name=value pair is enough for a subsequent Cookie header. Node's
    // getSetCookie() returns one item per cookie; the fallback still extracts the
    // leading pair without exposing the value to the supervised UI.
    const match = /^\s*([^=;,\s]+)=([^;]*)/.exec(raw);
    if (!match) continue;
    pairs.push(`${match[1]}=${match[2]}`);
    names.push(match[1]);
  }
  return { cookieHeader: pairs.length ? pairs.join('; ') : undefined, names: [...new Set(names)] };
}

async function resolveImageSource(
  source: string | undefined,
  context: TvanAdapterContext,
  cookieHeader?: string,
): Promise<ResolvedImage | undefined> {
  const inline = normalizeInlineImage(source);
  if (inline) return inline;
  const text = source?.trim();
  if (!text || !/^(?:https?:\/\/|\/)/i.test(text)) return undefined;
  const target = assertAllowedUrl(text.startsWith('/') ? `${ORIGIN}${text}` : text, ALLOWED_HOSTS);
  const response = await fetchWithTimeout(context.fetchImpl, target, {
    method: 'GET',
    headers: {
      Accept: 'image/*,*/*',
      Referer: `${ORIGIN}/utilities/invoice-search`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  }, context.timeoutMs, ALLOWED_HOSTS);
  if (!response.ok) return undefined;
  const bytes = await readLimited(response, Math.min(context.maxDownloadBytes, 4 * 1024 * 1024));
  const declared = response.headers.get('content-type')?.split(';', 1)[0].trim().toLocaleLowerCase();
  const mimeType = (declared?.startsWith('image/') ? declared : undefined) || sniffImageMime(bytes);
  if (!mimeType) return undefined;
  return { base64: bytes.toString('base64'), mimeType };
}

function responseKeys(payload: unknown): string[] {
  const keys = new Set<string>();
  const visit = (node: unknown, prefix: string, depth: number) => {
    if (depth > 5 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length) visit(node[0], `${prefix}[]`, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      keys.add(path);
      visit(value, path, depth + 1);
    }
  };
  visit(payload, '', 0);
  return [...keys].sort().slice(0, 120);
}

function safeProbePreview(payload: unknown, secrets: string[] = []): string {
  const secretSet = new Set(secrets.filter(Boolean));
  const sanitize = (node: unknown, key = '', depth = 0): unknown => {
    if (depth > 6) return '[depth-limit]';
    if (node === null || node === undefined || typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'string') {
      if (/token|secret|recaptcha|authorization|cookie/i.test(key) || secretSet.has(node)) return '[redacted]';
      let text = node;
      for (const secret of secretSet) {
        if (secret && text.includes(secret)) text = text.split(secret).join('[redacted]');
      }
      const trimmed = text.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length <= 2 * 1024 * 1024) {
        try { return sanitize(JSON.parse(trimmed) as unknown, key, depth + 1); } catch { /* plain text */ }
      }
      const inline = normalizeInlineImage(text);
      if (inline) return `[${inline.mimeType} base64 ${inline.base64.length} chars]`;
      if (text.length > 1_500) return `${text.slice(0, 1_500)}…[truncated ${text.length - 1_500} chars]`;
      return text;
    }
    if (Array.isArray(node)) return node.slice(0, 20).map((item) => sanitize(item, key, depth + 1));
    if (!isRecord(node)) return String(node);
    const out: Record<string, unknown> = {};
    for (const [childKey, value] of Object.entries(node).slice(0, 80)) out[childKey] = sanitize(value, childKey, depth + 1);
    return out;
  };
  try { return JSON.stringify(sanitize(payload), null, 2).slice(0, 8_000); }
  catch { return '[unavailable]'; }
}

function tokenFromHeaders(response: Response): string | undefined {
  for (const name of ['x-captcha-token', 'captcha-token', 'x-token', 'token']) {
    const value = safeString(response.headers.get(name));
    if (value) return value;
  }
  return undefined;
}

function challengeFromPayload(payload: unknown): ParsedChallenge | undefined {
  const records = recordsDeep(payload);
  if (!records.length) return undefined;
  const token = firstDeepString(records, ['token', 'captchaToken', 'captcha_token', 'key', 'id']);
  if (!token) return undefined;

  const imageSource = firstDeepString(records, [
    // Common slider CAPTCHA names, including the shape used by AJ-Captcha style components.
    'originalImageBase64', 'original_image_base64', 'backgroundImageBase64', 'background_image_base64',
    'backgroundImage', 'background', 'bgImage', 'bigImage', 'masterImage', 'master_image',
    'captchaImageBase64', 'captchaImage', 'imageBase64', 'image', 'imageUrl', 'backgroundImageUrl',
  ]);
  const pieceImageSource = firstDeepString(records, [
    'jigsawImageBase64', 'jigsaw_image_base64', 'sliderImageBase64', 'slider_image_base64',
    'pieceImageBase64', 'piece_image_base64', 'jigsawImage', 'sliderImage', 'pieceImage',
    'tileImage', 'tile_image', 'smallImageBase64', 'smallImage', 'pieceImageUrl', 'sliderImageUrl',
  ]);
  const slider = Boolean(pieceImageSource) || hasDeepKey(records, [
    'offsetX', 'offset_x', 'secretKey', 'originalImageBase64', 'jigsawImageBase64',
    'sliderImage', 'pieceImage', 'tileImage', 'xPosition', 'x_position',
  ]);
  const backgroundWidth = firstDeepNumber(records, ['originalImageWidth', 'backgroundWidth', 'masterWidth', 'master_width', 'width']);
  const pieceWidth = firstDeepNumber(records, ['jigsawImageWidth', 'sliderWidth', 'pieceWidth', 'tileWidth', 'tile_width']);
  const explicitMax = firstDeepNumber(records, ['sliderMax', 'maxX', 'max_x', 'maxOffsetX', 'max_offset_x']);
  const sliderMax = explicitMax
    ?? (backgroundWidth && pieceWidth && backgroundWidth > pieceWidth ? backgroundWidth - pieceWidth : undefined);
  // Never initialize the user's answer from offsetX/point.x even if a provider accidentally returns it.
  const sliderStart = firstDeepNumber(records, ['sliderStart', 'startX', 'start_x']) ?? 0;
  // Viettel production returns offsetY so the puzzle piece can be rendered at the same vertical position as its hole.
  const sliderY = firstDeepNumber(records, ['offsetY', 'offset_y', 'puzzleY', 'pieceY', 'yPosition', 'y_position']);
  const expiresAt = firstDeepString(records, ['expiresAt', 'expiredAt', 'expires_at', 'expired_at']);
  return { token, imageSource, pieceImageSource, kind: slider ? 'slider' : 'text', sliderMax, sliderStart, sliderY, expiresAt };
}

function tokenTtl(payload: unknown): number {
  if (!isRecord(payload)) return 5 * 60_000;
  const seconds = Number(payload.expiresIn ?? payload.expireIn ?? payload.ttl);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60 * 60_000);
  return 5 * 60_000;
}

async function pdfFromResponse(response: Response, context: TvanAdapterContext): Promise<{ bytes: Buffer; name?: string }> {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json') || type.includes('text/json')) {
    const body = await readJson(response, Math.min(context.maxDownloadBytes, 12 * 1024 * 1024));
    const records: Record<string, unknown>[] = isRecord(body) ? [body] : [];
    if (isRecord(body) && isRecord(body.data)) records.push(body.data);
    for (const record of records) {
      const base64 = firstDeepString([record], ['data', 'file', 'fileData', 'pdf', 'pdfData', 'content']);
      if (base64 && /^[A-Za-z0-9+/=\r\n]+$/.test(base64)) {
        const bytes = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
        if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return { bytes };
      }
      const url = firstDeepString([record], ['url', 'downloadUrl', 'fileUrl']);
      if (url) {
        const target = assertAllowedUrl(url.startsWith('/') ? `${ORIGIN}${url}` : url, ALLOWED_HOSTS);
        const next = await fetchWithTimeout(context.fetchImpl, target, { method: 'GET', headers: { Accept: 'application/pdf' } }, context.timeoutMs, ALLOWED_HOSTS);
        if (next.ok) {
          const bytes = await readLimited(next, context.maxDownloadBytes);
          if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return { bytes, name: responseFileName(next) };
        }
      }
    }
    throw new AppError('TVAN_PDF_INVALID', 'Viettel trả dữ liệu nhưng không tìm thấy PDF.', 502, true);
  }
  const bytes = await readLimited(response, context.maxDownloadBytes);
  ensurePdf(bytes);
  return { bytes, name: responseFileName(response) };
}

function parsedChallengeToken(payload: unknown): string | undefined {
  const records = recordsDeep(payload);
  return firstDeepString(records, ['token', 'captchaToken', 'captcha_token', 'key', 'id']);
}

async function probeViettelCaptcha(context: TvanAdapterContext): Promise<TvanCaptchaProbeResult> {
  const attempts: TvanCaptchaProbeAttempt[] = [];
  let sawTokenOnly = false;

  for (const endpoint of CAPTCHA_ENDPOINTS) {
    const target = assertAllowedUrl(endpoint, ALLOWED_HOSTS);
    let response: Response | undefined;
    try {
      response = await fetchWithTimeout(context.fetchImpl, target, {
        method: 'GET',
        headers: {
          Accept: 'application/json, image/*, */*',
          Referer: `${ORIGIN}/utilities/invoice-search`,
        },
      }, context.timeoutMs, ALLOWED_HOSTS);
    } catch (error) {
      attempts.push({
        endpoint: target.toString(),
        method: 'GET',
        note: error instanceof Error ? `network: ${error.message}` : 'network error',
      });
      continue;
    }

    const contentType = response.headers.get('content-type') || '';
    const cookieInfo = responseCookieInfo(response);
    const attempt: TvanCaptchaProbeAttempt = {
      endpoint: target.toString(),
      method: 'GET',
      responseStatus: response.status,
      responseContentType: contentType || undefined,
      setCookieNames: cookieInfo.names.length ? cookieInfo.names : undefined,
    };

    if (!response.ok) {
      attempt.note = `HTTP ${response.status}`;
      attempts.push(attempt);
      continue;
    }

    const bytes = await readLimited(response, Math.min(context.maxDownloadBytes, 4 * 1024 * 1024));
    const bodyMime = sniffImageMime(bytes);
    if (bodyMime) {
      const headerToken = tokenFromHeaders(response);
      attempt.tokenPresent = Boolean(headerToken);
      attempt.imageCandidateCount = 1;
      attempt.responsePreview = `[binary ${bodyMime}, ${bytes.length} bytes]`;
      attempts.push(attempt);
      if (!headerToken) continue;
      const challenge: TvanCaptchaChallenge = {
        id: crypto.randomUUID(),
        providerCode: 'tvan_viettel',
        kind: 'slider',
        prompt: 'Kéo thanh trượt để đặt mảnh ghép đúng vị trí trên ảnh Viettel.',
        imageBase64: bytes.toString('base64'),
        imageMimeType: bodyMime,
        sliderStart: 0,
      };
      return {
        probe: {
          status: 'challenge_ready',
          attempts,
          note: 'Viettel trả trực tiếp ảnh CAPTCHA và token trong response header.',
        },
        challengeResult: {
          challenge,
          privateState: { token: headerToken, cookieHeader: cookieInfo.cookieHeader } satisfies ViettelPrivateChallenge,
          trace: {
            endpoint: target.toString(),
            method: 'GET',
            responseStatus: response.status,
            responseContentType: contentType || undefined,
          },
        },
      };
    }

    let payload: unknown;
    try {
      const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trim();
      payload = text ? JSON.parse(text) as unknown : {};
    } catch {
      attempt.responsePreview = bytes.toString('utf8').slice(0, 4_000);
      attempt.note = 'HTTP 200 nhưng response không phải JSON/ảnh nhận diện được.';
      attempts.push(attempt);
      continue;
    }

    const records = recordsDeep(payload);
    const token = parsedChallengeToken(payload) || tokenFromHeaders(response);
    const parsed = challengeFromPayload(payload);
    const candidates = imageCandidatesFromPayload(payload);
    attempt.responseKeys = responseKeys(payload);
    attempt.responsePreview = safeProbePreview(payload, token ? [token] : []);
    attempt.tokenPresent = Boolean(token);
    attempt.imageCandidateCount = candidates.length;

    let background: ResolvedImage | undefined;
    let piece: ResolvedImage | undefined;

    // First honor the provider's named fields if present, then inspect every
    // JSON string for actual image bytes/URLs. This makes supervised probing
    // resilient to field-name changes without exposing the private token.
    if (parsed?.imageSource) {
      background = await resolveImageSource(parsed.imageSource, context, cookieInfo.cookieHeader).catch(() => undefined);
    }
    if (parsed?.pieceImageSource) {
      piece = await resolveImageSource(parsed.pieceImageSource, context, cookieInfo.cookieHeader).catch(() => undefined);
    }
    for (const candidate of candidates) {
      if (background && piece) break;
      const resolved = candidate.inline
        || await resolveImageSource(candidate.source, context, cookieInfo.cookieHeader).catch(() => undefined);
      if (!resolved) continue;
      if (!background) background = resolved;
      else if (!piece && resolved.base64 !== background.base64) piece = resolved;
    }

    attempt.imageCandidateCount = [background, piece].filter(Boolean).length || candidates.length;
    if (!token) {
      attempt.note = 'Có response hợp lệ nhưng chưa tìm thấy challenge token.';
      attempts.push(attempt);
      continue;
    }
    if (!background) {
      sawTokenOnly = true;
      attempt.note = 'Token đã có nhưng không tìm thấy ảnh trong payload, URL ảnh hoặc response body.';
      attempts.push(attempt);
      continue;
    }

    attempts.push(attempt);
    const challenge: TvanCaptchaChallenge = {
      id: crypto.randomUUID(),
      providerCode: 'tvan_viettel',
      kind: piece ? 'slider' : (parsed?.kind || 'text'),
      prompt: (!piece && parsed?.kind === 'text')
        ? 'Nhập CAPTCHA hiển thị trong ảnh Viettel.'
        : 'Kéo thanh trượt để đặt mảnh ghép đúng vị trí trên ảnh Viettel.',
      imageBase64: background.base64,
      imageMimeType: background.mimeType,
      pieceImageBase64: piece?.base64,
      pieceImageMimeType: piece?.mimeType,
      sliderMax: parsed?.sliderMax,
      sliderStart: parsed?.sliderStart ?? 0,
      sliderY: parsed?.sliderY,
      expiresAt: parsed?.expiresAt,
    };
    return {
      probe: {
        status: 'challenge_ready',
        attempts,
        note: 'Đã tìm được challenge token và ảnh CAPTCHA bằng GET production-safe.',
      },
      challengeResult: {
        challenge,
        privateState: { token, cookieHeader: cookieInfo.cookieHeader } satisfies ViettelPrivateChallenge,
        trace: {
          endpoint: target.toString(),
          method: 'GET',
          responseStatus: response.status,
          responseContentType: contentType || undefined,
        },
      },
    };
  }

  const probe: TvanCaptchaProbe = {
    status: sawTokenOnly ? 'token_only' : 'no_challenge',
    attempts,
    note: sawTokenOnly
      ? 'Viettel đã trả token qua GET nhưng payload/body chưa có ảnh CAPTCHA nhận diện được. Probe đã che token; dùng response keys/preview trên card để xác nhận schema production.'
      : 'Chưa lấy được challenge token + ảnh từ các GET CAPTCHA đã biết.',
  };
  return { probe };
}

export class ViettelTvanAdapter implements TvanAdapter {
  readonly providerCode = 'tvan_viettel';
  readonly displayName = 'Viettel SInvoice';
  readonly captchaMode = 'session' as const;
  readonly priority = 'P2' as const;

  matches(document: InvoiceDocument): boolean {
    return providerCodeOf(document).includes('viettel');
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const reservationCode = reservationCodeOf(document);
    const sellerTaxCode = sellerTaxCodeOf(document);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported: Boolean(reservationCode && sellerTaxCode),
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: reservationCode && sellerTaxCode ? undefined : 'Thiếu MST người bán hoặc Mã số bí mật của Viettel.',
    };
  }

  async probeCaptchaChallenge(_document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanCaptchaProbeResult> {
    return probeViettelCaptcha(context);
  }

  async getCaptchaChallenge(_document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult> {
    const result = await probeViettelCaptcha(context);
    if (result.challengeResult) return result.challengeResult;
    const successful = result.probe.attempts.filter((attempt) => attempt.responseStatus === 200);
    const detail = successful.map((attempt) => `${new URL(attempt.endpoint).pathname}=200`).join('; ');
    throw new AppError(
      'TVAN_CAPTCHA_CHALLENGE_FAILED',
      result.probe.status === 'token_only'
        ? `Viettel đã trả token CAPTCHA qua GET nhưng chưa tìm thấy ảnh trong response${detail ? ` (${detail})` : ''}. Mở card giám sát Viettel để xem response keys/preview đã che token; không nhập offset mù.`
        : `Không lấy được CAPTCHA Viettel${detail ? ` (${detail})` : ''}. Mở card giám sát Viettel để xem probe chi tiết.`,
      502,
      true,
    );
  }

  async verifyCaptcha(
    _document: InvoiceDocument,
    _challenge: TvanCaptchaChallenge,
    privateState: unknown,
    answer: string,
    context: TvanAdapterContext,
  ): Promise<TvanCaptchaVerifyTrace> {
    const state = isRecord(privateState) ? privateState : undefined;
    const challengeToken = state ? safeString(state.token) : undefined;
    const cookieHeader = state ? safeString(state.cookieHeader) : undefined;
    if (!challengeToken) throw new AppError('TVAN_CAPTCHA_STATE_LOST', 'Phiên CAPTCHA Viettel không còn hợp lệ.', 409);
    const rawAnswer = answer.trim();
    if (!rawAnswer) throw new AppError('TVAN_CAPTCHA_EMPTY', 'Chưa hoàn thành CAPTCHA.', 400);
    const numeric = Number(rawAnswer);
    const body = Number.isFinite(numeric)
      ? { token: challengeToken, offsetX: numeric }
      : { token: challengeToken, captcha: rawAnswer, answer: rawAnswer };
    const response = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(VERIFY_ENDPOINT, ALLOWED_HOSTS), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: `${ORIGIN}/utilities/invoice-search`,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(body),
    }, context.timeoutMs, ALLOWED_HOSTS);
    if (!response.ok) throw new AppError('TVAN_CAPTCHA_INVALID', 'Viettel từ chối CAPTCHA.', 422);
    const payload = await readJson(response, 2 * 1024 * 1024);
    if (!isRecord(payload) || payload.success !== true) {
      throw new AppError('TVAN_CAPTCHA_INVALID', safeString(isRecord(payload) ? payload.message : undefined) || 'CAPTCHA Viettel không đúng.', 422);
    }
    const token = safeString(payload.token);
    if (!token) throw new AppError('TVAN_CAPTCHA_TOKEN_MISSING', 'Viettel xác thực CAPTCHA nhưng không trả token.', 502);
    const expiresAt = Date.now() + tokenTtl(payload);
    context.setToken({ token, expiresAt });
    return {
      request: {
        endpoint: VERIFY_ENDPOINT,
        method: 'POST',
        requestBody: JSON.stringify(Number.isFinite(numeric)
          ? { token: '[backend-private-challenge-token]', offsetX: numeric }
          : { token: '[backend-private-challenge-token]', captcha: '[user-answer]', answer: '[user-answer]' }),
        responseStatus: response.status,
        responseContentType: response.headers.get('content-type') || undefined,
      },
      tokenExpiresAt: new Date(expiresAt).toISOString(),
    };
  }

  describeDownloadRequest(document: InvoiceDocument, context: TvanAdapterContext): TvanDownloadRequestPlan {
    const reservationCode = reservationCodeOf(document);
    const sellerTaxCode = sellerTaxCodeOf(document);
    if (!reservationCode || !sellerTaxCode) {
      throw new AppError('TVAN_LOOKUP_MISSING', 'Thiếu MST người bán hoặc Mã số bí mật của hóa đơn Viettel.', 422);
    }
    const target = new URL(DOWNLOAD_ENDPOINT);
    target.searchParams.set('taxCode', sellerTaxCode);
    const token = context.token && context.token.expiresAt > Date.now() ? context.token : undefined;
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookup: {
        supplierTaxCode: sellerTaxCode,
        reservationCode,
      },
      endpoint: target.toString(),
      method: 'POST',
      requestBody: JSON.stringify({
        supplierTaxCode: sellerTaxCode,
        reservationCode,
        recaptcha: token ? '[backend-private-session-token]' : '[captcha-session-token-not-ready]',
      }),
      tokenReady: Boolean(token),
      tokenExpiresAt: token ? new Date(token.expiresAt).toISOString() : undefined,
      plannedAt: new Date().toISOString(),
    };
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const reservationCode = reservationCodeOf(document);
    const sellerTaxCode = sellerTaxCodeOf(document);
    if (!reservationCode || !sellerTaxCode) {
      throw new AppError('TVAN_LOOKUP_MISSING', 'Thiếu MST người bán hoặc Mã số bí mật của hóa đơn Viettel.', 422);
    }
    if (!context.token || context.token.expiresAt <= Date.now()) {
      context.setToken(undefined);
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Cần xác thực CAPTCHA Viettel.', 428);
    }
    const target = new URL(DOWNLOAD_ENDPOINT);
    target.searchParams.set('taxCode', sellerTaxCode);
    const response = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(target.toString(), ALLOWED_HOSTS), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/pdf, application/json, */*', Referer: `${ORIGIN}/utilities/invoice-search` },
      body: JSON.stringify({
        supplierTaxCode: sellerTaxCode,
        reservationCode,
        recaptcha: context.token.token,
      }),
    }, context.timeoutMs, ALLOWED_HOSTS);
    if ([401, 403, 419, 422].includes(response.status)) {
      context.setToken(undefined);
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Token CAPTCHA Viettel đã hết hạn hoặc không hợp lệ.', 428, true);
    }
    if (!response.ok) throw new AppError('TVAN_VIETTEL_DOWNLOAD_FAILED', `Viettel trả HTTP ${response.status}.`, 502, true);
    const pdf = await pdfFromResponse(response, context);
    ensurePdf(pdf.bytes);
    return {
      content: pdf.bytes,
      contentType: 'application/pdf',
      fileName: pdf.name || defaultName(document),
    };
  }
}
