import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  TvanCatalogAlias,
  TvanCatalogEndpoint,
  TvanCatalogFieldMapping,
  TvanCatalogFilter,
  TvanCatalogListResult,
  TvanCatalogProvider,
  TvanCatalogProviderDetail,
  TvanCatalogSource,
  TvanCatalogStats,
} from '../../shared/models/index.js';
import type { TvanObservation } from '../../shared/tvan-catalog/index.js';
import type { SettingsService } from './settings.service.js';

const SCHEMA_VERSION = 2;

type DbRow = Record<string, unknown>;
export interface TvanCatalogDbEntry {
  observation: TvanObservation;
  documentCount: number;
  aliasCounts: Record<string, number>;
  endpointCounts: Record<string, number>;
  mappingCounts: Record<string, number>;
}

function text(row: DbRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' && value ? value : undefined;
}
function numberValue(row: DbRow, key: string): number { return Number(row[key] ?? 0); }
function boolValue(row: DbRow, key: string): boolean { return Number(row[key] ?? 0) === 1; }

export class TvanCatalogDbService {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;

  constructor(settings: SettingsService) {
    this.dbPath = path.join(settings.getAppDataDir(), 'tvan-catalog.sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.configure();
    this.migrate();
  }

  private configure(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tvan_catalog_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tvan_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_code TEXT,
        provider_tax_code TEXT,
        solution_provider_tax_code TEXT,
        transport_provider_code TEXT,
        transport_provider_tax_code TEXT,
        presentation_provider_code TEXT,
        display_name TEXT NOT NULL,
        adapter_supported INTEGER NOT NULL DEFAULT 0,
        pdf_supported INTEGER NOT NULL DEFAULT 0,
        captcha_mode TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        seen_documents INTEGER NOT NULL DEFAULT 0,
        seen_dataset_import INTEGER NOT NULL DEFAULT 0,
        seen_gdt_query INTEGER NOT NULL DEFAULT 0,
        seen_gdt_query_auto INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tvan_provider_code ON tvan_providers(provider_code);
      CREATE INDEX IF NOT EXISTS idx_tvan_provider_tax_code ON tvan_providers(provider_tax_code);
      CREATE INDEX IF NOT EXISTS idx_tvan_provider_last_seen ON tvan_providers(last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS tvan_provider_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER NOT NULL,
        alias_type TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(provider_id) REFERENCES tvan_providers(id) ON DELETE CASCADE,
        UNIQUE(alias_type, alias_value)
      );
      CREATE INDEX IF NOT EXISTS idx_tvan_alias_provider ON tvan_provider_aliases(provider_id);

      CREATE TABLE IF NOT EXISTS tvan_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER NOT NULL,
        endpoint_kind TEXT NOT NULL,
        origin TEXT NOT NULL,
        host TEXT NOT NULL,
        path_pattern TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(provider_id) REFERENCES tvan_providers(id) ON DELETE CASCADE,
        UNIQUE(provider_id, endpoint_kind, origin, path_pattern)
      );
      CREATE INDEX IF NOT EXISTS idx_tvan_endpoint_provider ON tvan_endpoints(provider_id);
      CREATE INDEX IF NOT EXISTS idx_tvan_endpoint_host ON tvan_endpoints(host);

      CREATE TABLE IF NOT EXISTS tvan_field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER NOT NULL,
        semantic_role TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_path TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(provider_id) REFERENCES tvan_providers(id) ON DELETE CASCADE,
        UNIQUE(provider_id, semantic_role, field_name, field_path)
      );
      CREATE INDEX IF NOT EXISTS idx_tvan_mapping_provider ON tvan_field_mappings(provider_id);

      CREATE TABLE IF NOT EXISTS tvan_ingest_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        document_count INTEGER NOT NULL,
        provider_count INTEGER NOT NULL,
        duration_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'ok'
      );
      CREATE INDEX IF NOT EXISTS idx_tvan_batch_observed ON tvan_ingest_batches(observed_at DESC);
    `);
    // Existing v1 databases retain their provider rows and all related observations.
    const columns = new Set((this.db.prepare('PRAGMA table_info(tvan_providers)').all() as DbRow[]).map((row) => text(row, 'name')));
    for (const column of [
      'solution_provider_tax_code', 'transport_provider_code',
      'transport_provider_tax_code', 'presentation_provider_code',
    ]) {
      if (!columns.has(column)) {
        try {
          this.db.exec(`ALTER TABLE tvan_providers ADD COLUMN ${column} TEXT`);
        } catch (error) {
          // Another app instance may have completed this migration after PRAGMA.
          const current = this.db.prepare('PRAGMA table_info(tvan_providers)').all() as DbRow[];
          if (!current.some((row) => text(row, 'name') === column)) throw error;
        }
      }
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tvan_solution_tax_code ON tvan_providers(solution_provider_tax_code) WHERE solution_provider_tax_code IS NOT NULL');
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO tvan_catalog_meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(SCHEMA_VERSION));
    this.db.prepare(`INSERT INTO tvan_catalog_meta(key, value) VALUES('created_at', ?) ON CONFLICT(key) DO NOTHING`).run(now);
  }

  private sourceColumn(source: TvanCatalogSource): string {
    if (source === 'dataset_import') return 'seen_dataset_import';
    if (source === 'gdt_query') return 'seen_gdt_query';
    return 'seen_gdt_query_auto';
  }

  private providerIdsForAliases(observation: TvanObservation): number[] {
    if (observation.solutionProviderTaxCode) {
      // A transport alias can belong to many distinct solution providers.
      return (this.db.prepare('SELECT id FROM tvan_providers WHERE solution_provider_tax_code = ?')
        .all(observation.solutionProviderTaxCode) as DbRow[]).map((row) => numberValue(row, 'id'));
    }
    const ids = new Set<number>();
    const lookup = this.db.prepare(`SELECT a.provider_id FROM tvan_provider_aliases a
      JOIN tvan_providers p ON p.id = a.provider_id
      WHERE a.alias_type = ? AND a.alias_value = ? AND p.solution_provider_tax_code IS NULL`);
    for (const alias of observation.aliases) {
      const row = lookup.get(alias.type, alias.value) as DbRow | undefined;
      if (row) ids.add(numberValue(row, 'provider_id'));
    }
    if (observation.providerCode) {
      for (const row of this.db.prepare('SELECT id FROM tvan_providers WHERE provider_code = ? AND solution_provider_tax_code IS NULL').all(observation.providerCode) as DbRow[]) ids.add(numberValue(row, 'id'));
    }
    if (observation.providerTaxCode) {
      for (const row of this.db.prepare('SELECT id FROM tvan_providers WHERE provider_tax_code = ? AND solution_provider_tax_code IS NULL').all(observation.providerTaxCode) as DbRow[]) ids.add(numberValue(row, 'id'));
    }
    return [...ids].filter((id) => id > 0).sort((a, b) => a - b);
  }

  private mergeProvider(fromId: number, intoId: number): void {
    if (fromId === intoId) return;
    const from = this.db.prepare('SELECT * FROM tvan_providers WHERE id = ?').get(fromId) as DbRow | undefined;
    const into = this.db.prepare('SELECT * FROM tvan_providers WHERE id = ?').get(intoId) as DbRow | undefined;
    if (!from || !into) return;
    const fromSolution = text(from, 'solution_provider_tax_code');
    const intoSolution = text(into, 'solution_provider_tax_code');
    if (fromSolution !== intoSolution) throw new Error('Cannot merge providers with different solution identities');

    for (const row of this.db.prepare('SELECT * FROM tvan_provider_aliases WHERE provider_id = ?').all(fromId) as DbRow[]) {
      this.db.prepare(`
        INSERT INTO tvan_provider_aliases(provider_id, alias_type, alias_value, first_seen_at, last_seen_at, seen_count)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(alias_type, alias_value) DO UPDATE SET
          provider_id=excluded.provider_id,
          first_seen_at=MIN(tvan_provider_aliases.first_seen_at, excluded.first_seen_at),
          last_seen_at=MAX(tvan_provider_aliases.last_seen_at, excluded.last_seen_at),
          seen_count=tvan_provider_aliases.seen_count + excluded.seen_count
      `).run(
        intoId,
        text(row, 'alias_type') ?? '',
        text(row, 'alias_value') ?? '',
        text(row, 'first_seen_at') ?? '',
        text(row, 'last_seen_at') ?? '',
        numberValue(row, 'seen_count'),
      );
    }
    for (const row of this.db.prepare('SELECT * FROM tvan_endpoints WHERE provider_id = ?').all(fromId) as DbRow[]) {
      this.db.prepare(`
        INSERT INTO tvan_endpoints(provider_id, endpoint_kind, origin, host, path_pattern, first_seen_at, last_seen_at, seen_count)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, endpoint_kind, origin, path_pattern) DO UPDATE SET
          first_seen_at=MIN(tvan_endpoints.first_seen_at, excluded.first_seen_at),
          last_seen_at=MAX(tvan_endpoints.last_seen_at, excluded.last_seen_at),
          seen_count=tvan_endpoints.seen_count + excluded.seen_count
      `).run(
        intoId,
        text(row, 'endpoint_kind') ?? '',
        text(row, 'origin') ?? '',
        text(row, 'host') ?? '',
        text(row, 'path_pattern') ?? '',
        text(row, 'first_seen_at') ?? '',
        text(row, 'last_seen_at') ?? '',
        numberValue(row, 'seen_count'),
      );
    }
    for (const row of this.db.prepare('SELECT * FROM tvan_field_mappings WHERE provider_id = ?').all(fromId) as DbRow[]) {
      this.db.prepare(`
        INSERT INTO tvan_field_mappings(provider_id, semantic_role, field_name, field_path, first_seen_at, last_seen_at, seen_count)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, semantic_role, field_name, field_path) DO UPDATE SET
          first_seen_at=MIN(tvan_field_mappings.first_seen_at, excluded.first_seen_at),
          last_seen_at=MAX(tvan_field_mappings.last_seen_at, excluded.last_seen_at),
          seen_count=tvan_field_mappings.seen_count + excluded.seen_count
      `).run(
        intoId,
        text(row, 'semantic_role') ?? '',
        text(row, 'field_name') ?? '',
        text(row, 'field_path') ?? '',
        text(row, 'first_seen_at') ?? '',
        text(row, 'last_seen_at') ?? '',
        numberValue(row, 'seen_count'),
      );
    }

    this.db.prepare(`
      UPDATE tvan_providers SET
        provider_code=COALESCE(provider_code, ?),
        provider_tax_code=COALESCE(provider_tax_code, ?),
        solution_provider_tax_code=COALESCE(solution_provider_tax_code, ?),
        transport_provider_code=COALESCE(transport_provider_code, ?),
        transport_provider_tax_code=COALESCE(transport_provider_tax_code, ?),
        presentation_provider_code=COALESCE(presentation_provider_code, ?),
        display_name=CASE WHEN display_name LIKE 'TVAN chưa xác định%' THEN ? ELSE display_name END,
        adapter_supported=MAX(adapter_supported, ?),
        pdf_supported=MAX(pdf_supported, ?),
        captcha_mode=COALESCE(captcha_mode, ?),
        first_seen_at=MIN(first_seen_at, ?),
        last_seen_at=MAX(last_seen_at, ?),
        seen_documents=seen_documents + ?,
        seen_dataset_import=seen_dataset_import + ?,
        seen_gdt_query=seen_gdt_query + ?,
        seen_gdt_query_auto=seen_gdt_query_auto + ?,
        updated_at=MAX(updated_at, ?)
      WHERE id=?
    `).run(
      text(from, 'provider_code') ?? null, text(from, 'provider_tax_code') ?? null,
      fromSolution ?? null, text(from, 'transport_provider_code') ?? null,
      text(from, 'transport_provider_tax_code') ?? null, text(from, 'presentation_provider_code') ?? null,
      text(from, 'display_name') || 'TVAN chưa xác định',
      numberValue(from, 'adapter_supported'), numberValue(from, 'pdf_supported'), text(from, 'captcha_mode') ?? null,
      text(from, 'first_seen_at') || '', text(from, 'last_seen_at') || '', numberValue(from, 'seen_documents'),
      numberValue(from, 'seen_dataset_import'), numberValue(from, 'seen_gdt_query'), numberValue(from, 'seen_gdt_query_auto'),
      text(from, 'updated_at') || '', intoId,
    );
    this.db.prepare('DELETE FROM tvan_providers WHERE id = ?').run(fromId);
  }

  private ensureProvider(observation: TvanObservation, now: string): number {
    const ids = this.providerIdsForAliases(observation);
    if (!ids.length) {
      const result = this.db.prepare(`
        INSERT INTO tvan_providers(
          provider_code, provider_tax_code, solution_provider_tax_code, transport_provider_code,
          transport_provider_tax_code, presentation_provider_code,
          display_name, adapter_supported, pdf_supported, captcha_mode,
          first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        observation.providerCode ?? null,
        observation.providerTaxCode ?? null,
        observation.solutionProviderTaxCode ?? null,
        observation.transportProviderCode ?? null,
        observation.transportProviderTaxCode ?? null,
        observation.presentationProviderCode ?? null,
        observation.displayName,
        observation.adapterSupported ? 1 : 0,
        observation.pdfSupported ? 1 : 0,
        observation.captchaMode ?? null,
        now, now, now, now,
      );
      return Number(result.lastInsertRowid);
    }
    const keep = ids[0];
    for (const duplicate of ids.slice(1)) this.mergeProvider(duplicate, keep);
    return keep;
  }

  private upsertEntry(entry: TvanCatalogDbEntry, source: TvanCatalogSource, now: string): number {
    const providerId = this.ensureProvider(entry.observation, now);
    const sourceColumn = this.sourceColumn(source);
    this.db.prepare(`
      UPDATE tvan_providers SET
        provider_code=COALESCE(?, provider_code),
        provider_tax_code=COALESCE(?, provider_tax_code),
        solution_provider_tax_code=COALESCE(?, solution_provider_tax_code),
        transport_provider_code=COALESCE(?, transport_provider_code),
        transport_provider_tax_code=COALESCE(?, transport_provider_tax_code),
        presentation_provider_code=COALESCE(?, presentation_provider_code),
        display_name=CASE WHEN ? NOT IN ('', 'unknown') THEN ? ELSE display_name END,
        adapter_supported=MAX(adapter_supported, ?),
        pdf_supported=MAX(pdf_supported, ?),
        captcha_mode=COALESCE(?, captcha_mode),
        last_seen_at=?,
        seen_documents=seen_documents + ?,
        ${sourceColumn}=${sourceColumn} + ?,
        updated_at=?
      WHERE id=?
    `).run(
      entry.observation.providerCode ?? null,
      entry.observation.providerTaxCode ?? null,
      entry.observation.solutionProviderTaxCode ?? null,
      entry.observation.transportProviderCode ?? null,
      entry.observation.transportProviderTaxCode ?? null,
      entry.observation.presentationProviderCode ?? null,
      entry.observation.displayName,
      entry.observation.displayName,
      entry.observation.adapterSupported ? 1 : 0,
      entry.observation.pdfSupported ? 1 : 0,
      entry.observation.captchaMode ?? null,
      now,
      entry.documentCount,
      entry.documentCount,
      now,
      providerId,
    );

    const aliasStatement = this.db.prepare(`
      INSERT INTO tvan_provider_aliases(provider_id, alias_type, alias_value, first_seen_at, last_seen_at, seen_count)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias_type, alias_value) DO UPDATE SET
        provider_id=excluded.provider_id,
        last_seen_at=excluded.last_seen_at,
        seen_count=tvan_provider_aliases.seen_count + excluded.seen_count
    `);
    // The v1 alias table is globally unique. Never assign a shared transport/host
    // alias to one of several solution providers (or steal it from a legacy row).
    if (entry.observation.solutionProviderTaxCode) {
      aliasStatement.run(providerId, 'solution_tax_code', entry.observation.solutionProviderTaxCode, now, now, entry.documentCount);
    } else for (const alias of entry.observation.aliases) {
      const key = `${alias.type}|${alias.value}`;
      aliasStatement.run(providerId, alias.type, alias.value, now, now, entry.aliasCounts[key] ?? 1);
    }

    const endpointStatement = this.db.prepare(`
      INSERT INTO tvan_endpoints(provider_id, endpoint_kind, origin, host, path_pattern, first_seen_at, last_seen_at, seen_count)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, endpoint_kind, origin, path_pattern) DO UPDATE SET
        last_seen_at=excluded.last_seen_at,
        seen_count=tvan_endpoints.seen_count + excluded.seen_count
    `);
    for (const endpoint of entry.observation.endpoints) {
      const key = `${endpoint.kind}|${endpoint.origin}|${endpoint.pathPattern}`;
      endpointStatement.run(providerId, endpoint.kind, endpoint.origin, endpoint.host, endpoint.pathPattern, now, now, entry.endpointCounts[key] ?? 1);
    }

    const mappingStatement = this.db.prepare(`
      INSERT INTO tvan_field_mappings(provider_id, semantic_role, field_name, field_path, first_seen_at, last_seen_at, seen_count)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, semantic_role, field_name, field_path) DO UPDATE SET
        last_seen_at=excluded.last_seen_at,
        seen_count=tvan_field_mappings.seen_count + excluded.seen_count
    `);
    for (const item of entry.observation.mappings) {
      const key = `${item.semanticRole}|${item.fieldName}|${item.fieldPath}`;
      mappingStatement.run(providerId, item.semanticRole, item.fieldName, item.fieldPath, now, now, entry.mappingCounts[key] ?? 1);
    }
    return providerId;
  }

  writeBatch(entries: TvanCatalogDbEntry[], source: TvanCatalogSource, documentCount: number, durationMs: number): number {
    const now = new Date().toISOString();
    const providerIds = new Set<number>();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of entries) providerIds.add(this.upsertEntry(entry, source, now));
      this.db.prepare(`
        INSERT INTO tvan_ingest_batches(source_type, observed_at, document_count, provider_count, duration_ms, status)
        VALUES(?, ?, ?, ?, ?, 'ok')
      `).run(source, now, documentCount, providerIds.size, durationMs);
      this.db.exec('COMMIT');
      return providerIds.size;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* no-op */ }
      throw error;
    }
  }

  private providerFromRow(row: DbRow): TvanCatalogProvider {
    const id = numberValue(row, 'id');
    const endpoints = this.db.prepare('SELECT host, origin, endpoint_kind FROM tvan_endpoints WHERE provider_id = ? ORDER BY endpoint_kind, seen_count DESC').all(id) as DbRow[];
    const primary = endpoints.find((item) => text(item, 'endpoint_kind') === 'provider_portal') || endpoints[0];
    return {
      id,
      providerCode: text(row, 'provider_code'),
      providerTaxCode: text(row, 'provider_tax_code'),
      solutionProviderTaxCode: text(row, 'solution_provider_tax_code'),
      transportProviderCode: text(row, 'transport_provider_code'),
      transportProviderTaxCode: text(row, 'transport_provider_tax_code'),
      presentationProviderCode: text(row, 'presentation_provider_code'),
      displayName: text(row, 'display_name') || 'TVAN chưa xác định',
      adapterSupported: boolValue(row, 'adapter_supported'),
      pdfSupported: boolValue(row, 'pdf_supported'),
      captchaMode: text(row, 'captcha_mode'),
      firstSeenAt: text(row, 'first_seen_at') || '',
      lastSeenAt: text(row, 'last_seen_at') || '',
      seenDocuments: numberValue(row, 'seen_documents'),
      seenDatasetImport: numberValue(row, 'seen_dataset_import'),
      seenGdtQuery: numberValue(row, 'seen_gdt_query'),
      seenGdtQueryAuto: numberValue(row, 'seen_gdt_query_auto'),
      primaryPortal: primary ? text(primary, 'origin') : undefined,
      observedHosts: [...new Set(endpoints.map((item) => text(item, 'host')).filter((value): value is string => Boolean(value)))],
    };
  }

  listProviders(filter: TvanCatalogFilter): TvanCatalogListResult {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.q) {
      const q = `%${filter.q.trim()}%`;
      where.push(`(p.provider_code LIKE ? OR p.provider_tax_code LIKE ? OR p.solution_provider_tax_code LIKE ?
        OR p.transport_provider_code LIKE ? OR p.transport_provider_tax_code LIKE ? OR p.presentation_provider_code LIKE ?
        OR p.display_name LIKE ? OR EXISTS (
        SELECT 1 FROM tvan_endpoints e WHERE e.provider_id=p.id AND (e.host LIKE ? OR e.origin LIKE ? OR e.path_pattern LIKE ?)
      ))`);
      params.push(q, q, q, q, q, q, q, q, q, q);
    }
    if (filter.providerCode) { where.push('p.provider_code = ?'); params.push(filter.providerCode); }
    if (filter.providerTaxCode) { where.push('p.provider_tax_code = ?'); params.push(filter.providerTaxCode); }
    if (filter.supported !== undefined) { where.push('p.adapter_supported = ?'); params.push(filter.supported ? 1 : 0); }
    if (filter.source) { where.push(`p.${this.sourceColumn(filter.source)} > 0`); }
    if (filter.host) { where.push('EXISTS (SELECT 1 FROM tvan_endpoints e WHERE e.provider_id=p.id AND e.host LIKE ?)'); params.push(`%${filter.host}%`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS count FROM tvan_providers p ${clause}`).get(...params) as DbRow;
    const sortMap = { lastSeenAt: 'p.last_seen_at', firstSeenAt: 'p.first_seen_at', seenDocuments: 'p.seen_documents', displayName: 'p.display_name' } as const;
    const sort = sortMap[filter.sort ?? 'lastSeenAt'];
    const order = filter.order === 'asc' ? 'ASC' : 'DESC';
    const rows = this.db.prepare(`SELECT p.* FROM tvan_providers p ${clause} ORDER BY ${sort} ${order}, p.id ASC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as DbRow[];
    return { items: rows.map((row) => this.providerFromRow(row)), total: numberValue(totalRow, 'count'), page, pageSize };
  }

  getProvider(id: number): TvanCatalogProviderDetail | undefined {
    const row = this.db.prepare('SELECT * FROM tvan_providers WHERE id = ?').get(id) as DbRow | undefined;
    if (!row) return undefined;
    const base = this.providerFromRow(row);
    const aliases = (this.db.prepare('SELECT * FROM tvan_provider_aliases WHERE provider_id = ? ORDER BY alias_type, alias_value').all(id) as DbRow[]).map((item): TvanCatalogAlias => ({
      type: text(item, 'alias_type') as TvanCatalogAlias['type'], value: text(item, 'alias_value') || '', firstSeenAt: text(item, 'first_seen_at') || '', lastSeenAt: text(item, 'last_seen_at') || '', seenCount: numberValue(item, 'seen_count'),
    }));
    const endpoints = (this.db.prepare('SELECT * FROM tvan_endpoints WHERE provider_id = ? ORDER BY endpoint_kind, seen_count DESC').all(id) as DbRow[]).map((item): TvanCatalogEndpoint => ({
      kind: text(item, 'endpoint_kind') as TvanCatalogEndpoint['kind'], origin: text(item, 'origin') || '', host: text(item, 'host') || '', pathPattern: text(item, 'path_pattern') || '', firstSeenAt: text(item, 'first_seen_at') || '', lastSeenAt: text(item, 'last_seen_at') || '', seenCount: numberValue(item, 'seen_count'),
    }));
    const fieldMappings = (this.db.prepare('SELECT * FROM tvan_field_mappings WHERE provider_id = ? ORDER BY semantic_role, seen_count DESC').all(id) as DbRow[]).map((item): TvanCatalogFieldMapping => ({
      semanticRole: text(item, 'semantic_role') || '', fieldName: text(item, 'field_name') || '', fieldPath: text(item, 'field_path') || '', firstSeenAt: text(item, 'first_seen_at') || '', lastSeenAt: text(item, 'last_seen_at') || '', seenCount: numberValue(item, 'seen_count'),
    }));
    return { ...base, aliases, endpoints, fieldMappings };
  }

  getStats(): TvanCatalogStats {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS providers,
        COALESCE(SUM(CASE WHEN adapter_supported=1 THEN 1 ELSE 0 END), 0) AS supported,
        COALESCE(SUM(CASE WHEN adapter_supported=0 THEN 1 ELSE 0 END), 0) AS unsupported,
        COALESCE(SUM(seen_documents), 0) AS documents,
        COALESCE(SUM(seen_dataset_import), 0) AS dataset_docs,
        COALESCE(SUM(seen_gdt_query), 0) AS gdt_docs,
        COALESCE(SUM(seen_gdt_query_auto), 0) AS auto_docs,
        MAX(last_seen_at) AS last_observed
      FROM tvan_providers
    `).get() as DbRow;
    return {
      providers: numberValue(row, 'providers'), supportedProviders: numberValue(row, 'supported'), unsupportedProviders: numberValue(row, 'unsupported'),
      observedDocuments: numberValue(row, 'documents'), datasetImportDocuments: numberValue(row, 'dataset_docs'), gdtQueryDocuments: numberValue(row, 'gdt_docs'), gdtQueryAutoDocuments: numberValue(row, 'auto_docs'),
      lastObservedAt: text(row, 'last_observed'), databasePath: this.dbPath, schemaVersion: SCHEMA_VERSION,
    };
  }

  close(): void { this.db.close(); }
}
