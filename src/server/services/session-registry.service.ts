import crypto from 'node:crypto';
import type { GdtConnector, LiveConnectorOptions } from '../gdt/connector.js';
import { createConnector } from '../gdt/connector.js';
import type { ConnectorMode } from '../../shared/models/index.js';
import { SessionService } from './session.service.js';
import { TvanPdfService } from '../tvan/pdf.service.js';
import type { SettingsService } from './settings.service.js';

export const SESSION_COOKIE = '__Host-hddt_session';
export const INSECURE_SESSION_COOKIE = 'hddt_session';

export type AuditEvent = {
  at: string;
  action: string;
  sessionId: string;
  username?: string;
  ipHash?: string;
  detail?: Record<string, string | number | boolean | null>;
};

export type SessionContext = {
  id: string;
  adminId: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  revokedAt?: number;
  ipHash?: string;
  userAgentHash?: string;
  loginFailures: number[];
  abortController: AbortController;
  session: SessionService;
  tvanPdf: TvanPdfService;
  cleanupHandlers: Set<() => void | Promise<void>>;
};

type RegistryOptions = {
  mode: ConnectorMode;
  settings: SettingsService;
  liveOptions: LiveConnectorOptions;
  connectorFactory?: typeof createConnector;
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  maxSessions?: number;
  auditLimit?: number;
  now?: () => number;
  auditSalt?: string;
};

function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hash(value: string | undefined, salt: string): string | undefined {
  if (!value) return undefined;
  return crypto.createHmac('sha256', salt).update(value).digest('base64url').slice(0, 22);
}

export class SessionRegistry {
  private readonly contexts = new Map<string, SessionContext>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private readonly absoluteTimeoutMs: number;
  private readonly maxSessions: number;
  private readonly auditLimit: number;
  private readonly auditSalt: string;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly options: RegistryOptions) {
    this.now = options.now ?? Date.now;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
    this.absoluteTimeoutMs = options.absoluteTimeoutMs ?? 8 * 60 * 60_000;
    this.maxSessions = options.maxSessions ?? 500;
    this.auditLimit = options.auditLimit ?? 10_000;
    this.auditSalt = options.auditSalt ?? randomSecret();
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), Math.min(60_000, this.idleTimeoutMs));
    this.cleanupTimer.unref();
  }

  create(metadata: { ip?: string; userAgent?: string } = {}): SessionContext {
    this.evictIfNeeded();
    const now = this.now();
    const context: SessionContext = {
      id: randomSecret(),
      adminId: randomSecret(18),
      csrfToken: randomSecret(),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + this.absoluteTimeoutMs,
      ipHash: hash(metadata.ip, this.auditSalt),
      userAgentHash: hash(metadata.userAgent, this.auditSalt),
      loginFailures: [],
      abortController: new AbortController(),
      session: new SessionService(this.options.mode, this.options.liveOptions, this.options.connectorFactory),
      tvanPdf: new TvanPdfService(this.options.settings, { namespace: randomSecret(12) }),
      cleanupHandlers: new Set(),
    };
    context.cleanupHandlers.add(() => context.tvanPdf.dispose());
    this.contexts.set(context.id, context);
    this.audit('session.created', context);
    return context;
  }

  resolve(id: string | undefined): SessionContext | undefined {
    if (!id) return undefined;
    const context = this.contexts.get(id);
    if (!context || this.expired(context)) {
      if (context) void this.destroy(context.id, 'session.expired');
      return undefined;
    }
    context.lastSeenAt = this.now();
    return context;
  }

  async rotate(context: SessionContext): Promise<SessionContext> {
    const oldId = context.id;
    this.contexts.delete(oldId);
    context.id = randomSecret();
    context.csrfToken = randomSecret();
    context.lastSeenAt = this.now();
    this.contexts.set(context.id, context);
    this.audit('session.rotated', context, { previous: hash(oldId, this.auditSalt) ?? '' });
    return context;
  }

  list(): Array<{ id: string; createdAt: string; lastSeenAt: string; expiresAt: string; authenticated: boolean; username?: string; ipHash?: string; userAgentHash?: string }> {
    return [...this.contexts.values()].filter((context) => !this.expired(context)).map((context) => ({
      id: context.adminId,
      createdAt: new Date(context.createdAt).toISOString(),
      lastSeenAt: new Date(context.lastSeenAt).toISOString(),
      expiresAt: new Date(Math.min(context.absoluteExpiresAt, context.lastSeenAt + this.idleTimeoutMs)).toISOString(),
      authenticated: context.session.isAuthenticated(),
      username: context.session.getSessionInfo()?.username,
      ipHash: context.ipHash,
      userAgentHash: context.userAgentHash,
    }));
  }

  getAudit(limit = 200): AuditEvent[] {
    return this.auditEvents.slice(-Math.max(1, Math.min(limit, 1_000))).map((event) => structuredClone(event));
  }

  audit(action: string, context: SessionContext, detail?: AuditEvent['detail']): void {
    this.auditEvents.push({
      at: new Date(this.now()).toISOString(),
      action,
      sessionId: context.adminId,
      username: context.session.getSessionInfo()?.username,
      ipHash: context.ipHash,
      detail,
    });
    if (this.auditEvents.length > this.auditLimit) this.auditEvents.splice(0, this.auditEvents.length - this.auditLimit);
  }

  async destroyByAdminId(adminId: string, action = 'session.revoked'): Promise<boolean> {
    const context = [...this.contexts.values()].find((item) => item.adminId === adminId);
    return context ? this.destroy(context.id, action) : false;
  }

  async destroy(id: string, action = 'session.revoked'): Promise<boolean> {
    const context = this.contexts.get(id);
    if (!context) return false;
    this.contexts.delete(id);
    context.revokedAt = this.now();
    context.abortController.abort();
    for (const cleanup of context.cleanupHandlers) await cleanup();
    context.cleanupHandlers.clear();
    await context.session.logout().catch(() => undefined);
    this.audit(action, context);
    return true;
  }

  async cleanupExpired(): Promise<void> {
    const expired = [...this.contexts.values()].filter((context) => this.expired(context));
    await Promise.all(expired.map((context) => this.destroy(context.id, 'session.expired')));
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    await Promise.all([...this.contexts.keys()].map((id) => this.destroy(id, 'server.shutdown')));
  }

  private expired(context: SessionContext): boolean {
    const now = this.now();
    return !!context.revokedAt || now >= context.absoluteExpiresAt || now - context.lastSeenAt >= this.idleTimeoutMs;
  }

  private evictIfNeeded(): void {
    if (this.contexts.size < this.maxSessions) return;
    const oldest = [...this.contexts.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
    if (oldest) void this.destroy(oldest.id, 'session.capacity_evicted');
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export function sessionCookie(value: string, maxAgeSeconds: number, secure = true): string {
  const name = secure ? SESSION_COOKIE : INSECURE_SESSION_COOKIE;
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = true): string {
  const name = secure ? SESSION_COOKIE : INSECURE_SESSION_COOKIE;
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
