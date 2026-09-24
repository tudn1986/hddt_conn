import type {
  InvoiceDocument,
  TvanCatalogFilter,
  TvanCatalogListResult,
  TvanCatalogProviderDetail,
  TvanCatalogSource,
  TvanCatalogStats,
} from '../../shared/models/index.js';
import { extractTvanObservation, tvanObservationIdentity } from '../../shared/tvan-catalog/index.js';
import { TvanRegistry } from '../tvan/registry.js';
import type { SettingsService } from './settings.service.js';
import { TvanCatalogDbService, type TvanCatalogDbEntry } from './tvan-catalog-db.service.js';

export interface TvanObserveResult {
  documents: number;
  providers: number;
  durationMs: number;
}

export class TvanCatalogService {
  private readonly db: TvanCatalogDbService;
  private readonly registry: TvanRegistry;

  constructor(settings: SettingsService, registry = new TvanRegistry()) {
    this.db = new TvanCatalogDbService(settings);
    this.registry = registry;
  }

  observeDocuments(documents: InvoiceDocument[], source: TvanCatalogSource): TvanObserveResult {
    const started = Date.now();
    const aggregates = new Map<string, TvanCatalogDbEntry>();

    for (const document of documents) {
      const adapter = this.registry.resolve(document);
      const capability = this.registry.capability(document);
      const observation = extractTvanObservation(document, capability);
      if (!observation) continue;
      // Adapter availability is a provider-level fact; capability.supported may be false for a specific invoice missing lookup fields.
      observation.adapterSupported = Boolean(adapter);
      observation.pdfSupported = capability.supported;
      const identity = tvanObservationIdentity(observation);
      const current = aggregates.get(identity);
      if (!current) {
        aggregates.set(identity, {
          observation,
          documentCount: 1,
          aliasCounts: Object.fromEntries(observation.aliases.map((item) => [`${item.type}|${item.value}`, 1])),
          endpointCounts: Object.fromEntries(observation.endpoints.map((item) => [`${item.kind}|${item.origin}|${item.pathPattern}`, 1])),
          mappingCounts: Object.fromEntries(observation.mappings.map((item) => [`${item.semanticRole}|${item.fieldName}|${item.fieldPath}`, 1])),
        });
        continue;
      }
      current.documentCount += 1;
      current.observation.adapterSupported ||= observation.adapterSupported;
      current.observation.pdfSupported ||= observation.pdfSupported;
      if (!current.observation.providerCode) current.observation.providerCode = observation.providerCode;
      if (!current.observation.providerTaxCode) current.observation.providerTaxCode = observation.providerTaxCode;
      if (current.observation.displayName === 'TVAN chưa xác định' && observation.displayName !== 'TVAN chưa xác định') current.observation.displayName = observation.displayName;
      const aliasKeys = new Set(current.observation.aliases.map((item) => `${item.type}|${item.value}`));
      for (const alias of observation.aliases) {
        const key = `${alias.type}|${alias.value}`;
        current.aliasCounts[key] = (current.aliasCounts[key] ?? 0) + 1;
        if (!aliasKeys.has(key)) { current.observation.aliases.push(alias); aliasKeys.add(key); }
      }
      const endpointKeys = new Set(current.observation.endpoints.map((item) => `${item.kind}|${item.origin}|${item.pathPattern}`));
      for (const endpoint of observation.endpoints) {
        const key = `${endpoint.kind}|${endpoint.origin}|${endpoint.pathPattern}`;
        current.endpointCounts[key] = (current.endpointCounts[key] ?? 0) + 1;
        if (!endpointKeys.has(key)) { current.observation.endpoints.push(endpoint); endpointKeys.add(key); }
      }
      const mappingKeys = new Set(current.observation.mappings.map((item) => `${item.semanticRole}|${item.fieldName}|${item.fieldPath}`));
      for (const mapping of observation.mappings) {
        const key = `${mapping.semanticRole}|${mapping.fieldName}|${mapping.fieldPath}`;
        current.mappingCounts[key] = (current.mappingCounts[key] ?? 0) + 1;
        if (!mappingKeys.has(key)) { current.observation.mappings.push(mapping); mappingKeys.add(key); }
      }
    }

    const durationMs = Date.now() - started;
    const providers = this.db.writeBatch([...aggregates.values()], source, documents.length, durationMs);
    return { documents: documents.length, providers, durationMs };
  }

  listProviders(filter: TvanCatalogFilter): TvanCatalogListResult { return this.db.listProviders(filter); }
  getProvider(id: number): TvanCatalogProviderDetail | undefined { return this.db.getProvider(id); }
  getStats(): TvanCatalogStats { return this.db.getStats(); }
  close(): void { this.db.close(); }
}
