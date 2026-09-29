import { AppError, safeString } from '../../shared/utils/index.js';
import type { FetchLike } from './types.js';

export function assertAllowedUrl(input: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError('TVAN_URL_INVALID', 'URL TVAN không hợp lệ.', 502); }
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname.toLocaleLowerCase())) {
    throw new AppError('TVAN_URL_REJECTED', 'TVAN trả URL ngoài miền được phép.', 502);
  }
  return url;
}

export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  allowedHosts?: readonly string[],
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let current = allowedHosts
    ? assertAllowedUrl(String(input), allowedHosts)
    : new URL(String(input));
  let currentInit: RequestInit = { ...init };
  try {
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetchImpl(current, {
        ...currentInit,
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'hddt-conn/1.2.1',
          ...currentInit.headers,
        },
      });
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      const location = response.headers.get('location');
      if (!isRedirect || !location) return response;
      try { await response.body?.cancel(); } catch { /* best-effort connection cleanup */ }
      if (!allowedHosts) {
        throw new AppError('TVAN_REDIRECT_REJECTED', 'TVAN trả redirect nhưng chưa có allow-list đích.', 502);
      }
      current = assertAllowedUrl(new URL(location, current).toString(), allowedHosts);
      if (response.status === 303 || ([301, 302].includes(response.status) && String(currentInit.method || 'GET').toUpperCase() === 'POST')) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
    }
    throw new AppError('TVAN_TOO_MANY_REDIRECTS', 'TVAN redirect quá nhiều lần.', 502, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('TVAN_TIMEOUT', 'TVAN phản hồi quá thời gian chờ.', 504, true);
    }
    throw new AppError('TVAN_NETWORK', 'Không kết nối được TVAN.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'Dữ liệu TVAN vượt giới hạn dung lượng.', 502);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'Dữ liệu TVAN vượt giới hạn dung lượng.', 502);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readLimited(response, maxBytes);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new AppError('TVAN_JSON_INVALID', 'TVAN trả JSON không hợp lệ.', 502); }
}

export function ensurePdf(bytes: Buffer): void {
  if (bytes.length < 8 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new AppError('TVAN_PDF_INVALID', 'TVAN không trả file PDF hợp lệ.', 502, true);
  }
}

export function safePdfFileName(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const base = cleaned || 'invoice';
  return base.toLocaleLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

export function responseFileName(response: Response): string | undefined {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const value = utf8 ? decodeURIComponent(utf8) : plain;
  return value ? safePdfFileName(value) : undefined;
}

export function stringField(value: unknown, name: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return safeString((value as Record<string, unknown>)[name]);
}
