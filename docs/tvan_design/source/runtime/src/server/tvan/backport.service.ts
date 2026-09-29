import fs from 'node:fs/promises';
import path from 'node:path';
import type { TvanBackportAnalysis } from '../../shared/models/index.js';
import { AppError, atomicWriteJson, ensureDir, generateId, isRecord, safeString } from '../../shared/utils/index.js';
import type { SettingsService } from '../services/settings.service.js';

export interface TvanBackportInput {
  providerCode: string;
  rawJson?: string;
  rawXml?: string;
  notes?: string;
}

export interface TvanBackportSampleMeta {
  id: string;
  providerCode: string;
  createdAt: string;
  hasJson: boolean;
  hasXml: boolean;
  notes?: string;
  analysis: TvanBackportAnalysis;
}

const FIELD_HINT = /(transaction|lookup|mã.?tra.?cứu|ma.?tra.?cuu|tra.?cuu|mã.?số.?bí.?mật|ma.?so.?bi.?mat|reservation|token|captcha|tax.?code|mst|url|link|pdf|download)/i;
const LOOKUP_HINT = /(transactionid|mã.?tra.?cứu|ma.?tra.?cuu|mã.?số.?bí.?mật|ma.?so.?bi.?mat|reservationcode|fkey|searchkey)/i;
const SENSITIVE_HINT = /(authorization|cookie|password|passwd|access.?token|refresh.?token|captcha.?token|session.?token|secret)/i;
const TAX_CODE = /\b\d{10}(?:-\d{3})?\b/g;
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/gi;

function safeProviderCode(value: string): string {
  const providerCode = value.trim().toLocaleLowerCase('vi-VN');
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(providerCode)) {
    throw new AppError('TVAN_PROVIDER_INVALID', 'Mã TVAN chỉ gồm a-z, 0-9, dấu chấm, gạch ngang hoặc gạch dưới.', 400);
  }
  return providerCode;
}

function pushField(
  output: TvanBackportAnalysis['detectedFields'],
  name: string,
  value: unknown,
  source: 'json' | 'xml',
): void {
  const text = safeString(value);
  if (!text || !FIELD_HINT.test(name)) return;
  output.push({ name: name.slice(0, 160), value: SENSITIVE_HINT.test(name) ? '[REDACTED]' : text.slice(0, 500), source });
}

function traverseJson(value: unknown, output: TvanBackportAnalysis['detectedFields'], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 2000)) traverseJson(child, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  const semanticName = safeString(value.ttruong ?? value.name ?? value.key ?? value.ten);
  const semanticValue = value.dlieu ?? value.value ?? value.giatri ?? value.rawValue;
  if (semanticName) pushField(output, semanticName, semanticValue, 'json');
  for (const [key, child] of Object.entries(value)) {
    pushField(output, key, child, 'json');
    if (Array.isArray(child) || isRecord(child)) traverseJson(child, output, depth + 1);
  }
}

function analyzeXml(xml: string, output: TvanBackportAnalysis['detectedFields']): void {
  // Capture ordinary XML tags and GDT <TTin><TTruong>...<DLieu>...</TTin> extension fields.
  const ttin = /<TTin\b[^>]*>[\s\S]*?<TTruong\b[^>]*>([\s\S]*?)<\/TTruong>[\s\S]*?<DLieu\b[^>]*>([\s\S]*?)<\/DLieu>[\s\S]*?<\/TTin>/gi;
  for (const match of xml.matchAll(ttin)) pushField(output, decodeXml(match[1]), decodeXml(match[2]), 'xml');
  const tags = /<([A-Za-z_][\w:.-]{0,120})\b[^>]*>([^<]{1,1000})<\/\1>/g;
  for (const match of xml.matchAll(tags)) pushField(output, match[1], decodeXml(match[2]), 'xml');
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class TvanBackportService {
  private readonly root: string;

  constructor(private readonly settings: SettingsService) {
    this.root = path.join(settings.getAppDataDir(), 'tvan-backport');
  }

  analyze(input: TvanBackportInput): TvanBackportAnalysis {
    const providerCode = safeProviderCode(input.providerCode);
    const rawJson = (input.rawJson || '').trim();
    const rawXml = (input.rawXml || '').trim();
    if (!rawJson && !rawXml) throw new AppError('TVAN_BACKPORT_EMPTY', 'Cần cung cấp raw JSON hoặc XML.', 400);
    if (rawJson.length > 20 * 1024 * 1024 || rawXml.length > 20 * 1024 * 1024) {
      throw new AppError('TVAN_BACKPORT_TOO_LARGE', 'Mỗi payload backport tối đa 20 MB.', 413);
    }

    const detectedFields: TvanBackportAnalysis['detectedFields'] = [];
    if (rawJson) {
      let parsed: unknown;
      try { parsed = JSON.parse(rawJson); }
      catch { throw new AppError('TVAN_BACKPORT_JSON_INVALID', 'Raw JSON không hợp lệ.', 400); }
      traverseJson(parsed, detectedFields);
    }
    if (rawXml) analyzeXml(rawXml, detectedFields);

    const combined = `${rawJson}\n${rawXml}`;
    const urls = unique(Array.from(combined.matchAll(URL_PATTERN)).map((match) => match[0].replace(/[),.;]+$/, ''))).slice(0, 100);
    const lookupCandidates = unique(
      detectedFields.filter((field) => LOOKUP_HINT.test(field.name)).map((field) => field.value)
    ).slice(0, 100);
    const taxCodeCandidates = unique(Array.from(combined.matchAll(TAX_CODE)).map((match) => match[0])).slice(0, 100);
    const notes: string[] = [];
    if (urls.some((url) => /captcha/i.test(url))) notes.push('Có endpoint CAPTCHA trong payload.');
    if (urls.some((url) => /(pdf|download)/i.test(url))) notes.push('Có endpoint/URL liên quan PDF hoặc download.');
    if (detectedFields.some((field) => /transactionid/i.test(field.name))) notes.push('Phát hiện TransactionID.');
    if (detectedFields.some((field) => /mã.?số.?bí.?mật|ma.?so.?bi.?mat/i.test(field.name))) notes.push('Phát hiện Mã số bí mật.');
    if (!lookupCandidates.length) notes.push('Chưa phát hiện trường mã tra cứu rõ ràng; cần thêm request/response mẫu.');

    return { providerCode, detectedFields: detectedFields.slice(0, 500), urls, lookupCandidates, taxCodeCandidates, notes };
  }

  async save(input: TvanBackportInput): Promise<TvanBackportSampleMeta> {
    const analysis = this.analyze(input);
    const id = generateId();
    const createdAt = new Date().toISOString();
    const directory = path.join(this.root, analysis.providerCode);
    await ensureDir(directory);
    const record = {
      schemaVersion: 1,
      id,
      providerCode: analysis.providerCode,
      createdAt,
      notes: safeString(input.notes)?.slice(0, 2000),
      rawJson: input.rawJson || undefined,
      rawXml: input.rawXml || undefined,
      analysis,
    };
    await atomicWriteJson(path.join(directory, `${createdAt.replace(/[:.]/g, '-')}_${id}.json`), record);
    return {
      id,
      providerCode: analysis.providerCode,
      createdAt,
      hasJson: Boolean(input.rawJson?.trim()),
      hasXml: Boolean(input.rawXml?.trim()),
      notes: record.notes,
      analysis,
    };
  }

  async list(): Promise<TvanBackportSampleMeta[]> {
    const providers = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const result: TvanBackportSampleMeta[] = [];
    for (const provider of providers.filter((entry) => entry.isDirectory())) {
      const directory = path.join(this.root, provider.name);
      const files = await fs.readdir(directory).catch(() => []);
      for (const fileName of files.filter((name) => name.endsWith('.json')).slice(-100)) {
        try {
          const record = JSON.parse(await fs.readFile(path.join(directory, fileName), 'utf8')) as Record<string, unknown>;
          if (!isRecord(record.analysis)) continue;
          result.push({
            id: String(record.id || ''),
            providerCode: String(record.providerCode || provider.name),
            createdAt: String(record.createdAt || ''),
            hasJson: typeof record.rawJson === 'string' && Boolean(record.rawJson),
            hasXml: typeof record.rawXml === 'string' && Boolean(record.rawXml),
            notes: safeString(record.notes),
            analysis: record.analysis as unknown as TvanBackportAnalysis,
          });
        } catch { /* Ignore corrupted local sample metadata. */ }
      }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
  }
}
