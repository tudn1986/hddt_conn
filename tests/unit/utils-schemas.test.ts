import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoiceQuerySchema, loginSchema, settingsPatchSchema } from '../../src/shared/schemas/index.js';
import { assertPathInside, atomicWriteJson, escapeExcelFormula, requireSafeTaxCode } from '../../src/shared/utils/index.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('shared validation and security utilities', () => {
  it.each(['=1+1', ' +SUM(A1)', '\t@cmd', '-10'])('escapes risky Excel text: %s', (value) => {
    expect(escapeExcelFormula(value)).toBe(`'${value}`);
  });

  it('leaves ordinary Excel text unchanged', () => {
    expect(escapeExcelFormula('0101234567')).toBe('0101234567');
  });

  it('rejects path traversal and invalid tax codes', () => {
    expect(() => assertPathInside('/safe/root', '/safe/root2/file')).toThrow(/ngoài thư mục/i);
    expect(() => assertPathInside('/safe/root', '/safe/root/../secret')).toThrow(/ngoài thư mục/i);
    expect(requireSafeTaxCode('0101234567-001')).toBe('0101234567-001');
    expect(() => requireSafeTaxCode('../x')).toThrow(/MST/);
  });

  it('writes JSON atomically and leaves no temporary file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-utils-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'config.json');
    await atomicWriteJson(file, { hello: 'world' });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ hello: 'world' });
    expect((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });


  it('rejects endpoint traversal after URL canonicalization', () => {
    expect(settingsPatchSchema.safeParse({ gdt: { salesPath: '/api/query/invoices/sold' } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ gdt: { salesPath: '/api/../outside' } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ gdt: { salesPath: 'https://evil.example/api/query' } }).success).toBe(false);
  });

  it('validates login shape and calendar dates strictly', () => {
    expect(loginSchema.safeParse({
      username: '0101234567', password: 'secret', captcha: 'AB12', ckey: 'k', rememberUsername: true,
    }).success).toBe(true);
    expect(loginSchema.safeParse({
      username: 'admin', password: 'secret', captcha: 'AB12', ckey: 'k', extra: true,
    }).success).toBe(false);
    expect(invoiceQuerySchema.safeParse({
      direction: 'purchase', fromDate: '2026-02-30', toDate: '2026-03-01', page: 1, pageSize: 50,
    }).success).toBe(false);
    expect(invoiceQuerySchema.safeParse({
      direction: 'purchase', fromDate: '2026-03-02', toDate: '2026-03-01', page: 1, pageSize: 50,
    }).success).toBe(false);
  });
});
