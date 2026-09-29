import { AppError } from '../../../../shared/utils/index.js';
import type { TvanAdapterContext } from '../../types.js';
import type { ThaisonLookup } from './lookup.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

function cookiePairs(raw: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw) return result;
  for (const item of raw.split(/;\s*/)) {
    const equal = item.indexOf('=');
    if (equal <= 0) continue;
    const name = item.slice(0, equal).trim();
    const value = item.slice(equal + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

function responseSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const direct = headers.getSetCookie?.();
  if (direct?.length) return direct;
  const fallback = response.headers.get('set-cookie');
  return fallback ? [fallback] : [];
}

function mergeCookies(previous: string | undefined, response: Response): string | undefined {
  const values = cookiePairs(previous);
  for (const raw of responseSetCookies(response)) {
    const first = raw.split(';', 1)[0] || '';
    const equal = first.indexOf('=');
    if (equal <= 0) continue;
    const name = first.slice(0, equal).trim();
    const value = first.slice(equal + 1).trim();
    if (!name) continue;
    if (!value) values.delete(name);
    else values.set(name, value);
  }
  if (!values.size) return undefined;
  return [...values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function assertPortalUrl(lookup: ThaisonLookup, candidate: URL): void {
  if (candidate.protocol !== 'https:' || candidate.hostname.toLocaleLowerCase('vi-VN') !== lookup.portalHost) {
    throw new AppError(
      'TVAN_THAISON_PORTAL_REJECTED',
      'Thái Sơn redirect/request ra ngoài tenant portal đã xác minh.',
      502,
    );
  }
  if (candidate.username || candidate.password || candidate.port || candidate.hash) {
    throw new AppError('TVAN_THAISON_PORTAL_REJECTED', 'URL tenant Thái Sơn không đạt policy an toàn.', 502);
  }
}

export type ThaisonFetchResult = {
  response: Response;
  cookieHeader?: string;
  finalUrl: string;
};

export async function fetchThaisonPortal(
  context: TvanAdapterContext,
  lookup: ThaisonLookup,
  url: string,
  init: RequestInit,
  initialCookie?: string,
): Promise<ThaisonFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  timer.unref?.();

  let current = new URL(url);
  let cookieHeader = initialCookie;
  let currentInit: RequestInit = { ...init };

  try {
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      assertPortalUrl(lookup, current);
      const headers = new Headers(currentInit.headers || {});
      headers.set('User-Agent', USER_AGENT);
      if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7');
      if (cookieHeader) headers.set('Cookie', cookieHeader);

      const response = await context.fetchImpl(current, {
        ...currentInit,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      cookieHeader = mergeCookies(cookieHeader, response);

      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        return { response, cookieHeader, finalUrl: current.toString() };
      }

      try { await response.body?.cancel(); } catch { /* best effort */ }
      current = new URL(location, current);
      assertPortalUrl(lookup, current);

      if (
        response.status === 303
        || ([301, 302].includes(response.status) && String(currentInit.method || 'GET').toUpperCase() === 'POST')
      ) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
    }

    throw new AppError('TVAN_THAISON_TOO_MANY_REDIRECTS', 'Thái Sơn redirect quá nhiều lần.', 502, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('TVAN_THAISON_TIMEOUT', 'Cổng Thái Sơn phản hồi quá thời gian chờ.', 504, true);
    }
    throw new AppError('TVAN_THAISON_NETWORK', 'Không kết nối được tenant portal Thái Sơn.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}
