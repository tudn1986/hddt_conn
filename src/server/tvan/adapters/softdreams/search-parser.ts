import { parse } from 'parse5';
import { AppError, isRecord, safeNumber, safeString } from '../../../../shared/utils/index.js';

export interface SoftdreamsRenderModel {
  IsAutoRow: boolean;
  IsRowPerPage: boolean;
  DiffRowBreaking: number | null;
  DiffFooterBreaking: number | null;
  DiffEmptyRowAppended: number | null;
  IsAppendEmptyRow: boolean;
  Layout: number;
  toolbarType: string;
}

export interface SoftdreamsSearchResult {
  invoiceHtml: string;
  invoiceToken: string;
  idInvoice?: number;
  pattern?: string;
  customerType?: string;
  clientNotSign?: boolean;
  attachFile?: boolean;
  status?: number;
  rowPerPage?: number;
  renderModel: SoftdreamsRenderModel;
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
  data?: string;
};

function walk(node: HtmlNode, visit: (node: HtmlNode) => boolean | void): HtmlNode | undefined {
  if (visit(node) === true) return node;
  for (const child of node.childNodes || []) {
    const found = walk(child, visit);
    if (found) return found;
  }
  return undefined;
}

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.value;
}

function elementById(root: HtmlNode, id: string): HtmlNode | undefined {
  const target = id.toLocaleLowerCase();
  return walk(root, (node) => attr(node, 'id')?.toLocaleLowerCase() === target);
}

function scriptTexts(root: HtmlNode): string[] {
  const scripts: string[] = [];
  walk(root, (node) => {
    if (node.tagName?.toLocaleLowerCase() !== 'script') return;
    const text = (node.childNodes || []).map((child) => child.value ?? child.data ?? '').join('');
    if (text.trim()) scripts.push(text);
  });
  return scripts;
}

function matchingDelimiter(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArguments(text: string): string[] {
  const args: string[] = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === ',' && paren === 0 && brace === 0 && bracket === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

function jsStringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2 || !["'", '"'].includes(trimmed[0]) || trimmed.at(-1) !== trimmed[0]) return undefined;
  const quote = trimmed[0];
  const body = trimmed.slice(1, -1);
  try {
    if (quote === '"') return JSON.parse(trimmed) as string;
    const normalized = '"' + body
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\\'/g, "'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t') + '"';
    return JSON.parse(normalized) as string;
  } catch {
    return undefined;
  }
}

function findShowInvInvocation(scripts: string[]): { args: string[]; script: string } {
  for (const script of scripts) {
    const pattern = /\bshowInv\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(script))) {
      const open = script.indexOf('(', match.index);
      const close = matchingDelimiter(script, open, '(', ')');
      if (close < 0) continue;
      const args = splitTopLevelArguments(script.slice(open + 1, close));
      if (args[0]?.replace(/\s+/g, '') === 'data.str' && args.length >= 2) {
        return { args, script };
      }
    }
  }
  throw new AppError(
    'TVAN_SOFTDREAMS_TOKEN_NOT_FOUND',
    'Không tìm thấy contract showInv(data.str, ...) trong phản hồi SoftDreams.',
    502,
  );
}

function extractObjectLiteral(script: string, variableName: string): string | undefined {
  const pattern = new RegExp(`\\b(?:var|let|const)\\s+${variableName}\\s*=\\s*\\{`, 'm');
  const match = pattern.exec(script);
  if (!match) return undefined;
  const start = script.indexOf('{', match.index);
  const end = matchingDelimiter(script, start, '{', '}');
  return end >= 0 ? script.slice(start + 1, end) : undefined;
}

function propRaw(objectBody: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|[,\\n\\r])\\s*${name}\\s*:\\s*([^,}\\n\\r]+)`, 'm').exec(objectBody);
  return match?.[1]?.trim();
}

function boolProp(objectBody: string, name: string, fallback: boolean): boolean {
  const raw = propRaw(objectBody, name);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new AppError('TVAN_SOFTDREAMS_RENDER_MODEL_INVALID', `Render model SoftDreams có ${name} không hợp lệ.`, 502);
}

function numberOrNullProp(objectBody: string, name: string, fallback: number | null): number | null {
  const raw = propRaw(objectBody, name);
  if (raw === undefined) return fallback;
  if (raw === 'null') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new AppError('TVAN_SOFTDREAMS_RENDER_MODEL_INVALID', `Render model SoftDreams có ${name} không hợp lệ.`, 502);
  }
  return value;
}

function parseRenderModel(scripts: string[], preferredScript?: string): SoftdreamsRenderModel {
  const orderedScripts = preferredScript
    ? [preferredScript, ...scripts.filter((script) => script !== preferredScript)]
    : scripts;
  const body = orderedScripts.map((script) => extractObjectLiteral(script, 'model')).find(Boolean);
  if (!body) {
    throw new AppError('TVAN_SOFTDREAMS_RENDER_MODEL_INVALID', 'Không tìm thấy render model SoftDreams.', 502);
  }
  const toolbarRaw = propRaw(body, 'toolbarType');
  const toolbarType = toolbarRaw === undefined ? '' : jsStringLiteral(toolbarRaw);
  if (toolbarRaw !== undefined && toolbarType === undefined) {
    throw new AppError('TVAN_SOFTDREAMS_RENDER_MODEL_INVALID', 'toolbarType SoftDreams không hợp lệ.', 502);
  }
  return {
    IsAutoRow: boolProp(body, 'IsAutoRow', false),
    IsRowPerPage: boolProp(body, 'IsRowPerPage', false),
    DiffRowBreaking: numberOrNullProp(body, 'DiffRowBreaking', null),
    DiffFooterBreaking: numberOrNullProp(body, 'DiffFooterBreaking', null),
    DiffEmptyRowAppended: numberOrNullProp(body, 'DiffEmptyRowAppended', null),
    IsAppendEmptyRow: boolProp(body, 'IsAppendEmptyRow', false),
    Layout: numberOrNullProp(body, 'Layout', 1) ?? 1,
    toolbarType: toolbarType ?? '',
  };
}

function numberLiteral(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

export function parseSoftdreamsSearchResponse(pageHtml: string): SoftdreamsSearchResult {
  const document = parse(pageHtml) as unknown as HtmlNode;
  const invDataNode = elementById(document, 'InvData');
  const invDataValue = invDataNode ? attr(invDataNode, 'value') : undefined;
  if (!invDataValue) {
    throw new AppError('TVAN_SOFTDREAMS_INVDATA_NOT_FOUND', 'Không tìm thấy #InvData trong phản hồi SoftDreams.', 502);
  }

  let invData: unknown;
  try {
    invData = JSON.parse(invDataValue);
  } catch {
    throw new AppError('TVAN_SOFTDREAMS_INVDATA_INVALID', '#InvData của SoftDreams không phải JSON hợp lệ.', 502);
  }
  if (!isRecord(invData) || typeof invData.str !== 'string' || !invData.str.includes('VATTEMP')) {
    throw new AppError('TVAN_SOFTDREAMS_INVDATA_INVALID', '#InvData.str không chứa HTML hóa đơn SoftDreams hợp lệ.', 502);
  }

  const scripts = scriptTexts(document);
  const invocation = findShowInvInvocation(scripts);
  const token = jsStringLiteral(invocation.args.at(-1) || '');
  if (!token || token.length < 20 || token.length > 2_048 || /[\s<>]/.test(token)) {
    throw new AppError('TVAN_SOFTDREAMS_TOKEN_NOT_FOUND', 'Không parse được invoice token từ showInv SoftDreams.', 502);
  }

  const renderModel = parseRenderModel(scripts, invocation.script);
  const numericArgs = invocation.args.slice(1, -1).map(numberLiteral).filter((value): value is number => value !== undefined);
  const status = safeNumber(invData.status) ?? safeNumber(invData.Status) ?? numericArgs[0];
  const rowPerPage = safeNumber(invData.rowPerPage) ?? safeNumber(invData.RowPerPage) ?? numericArgs[1];

  return {
    invoiceHtml: invData.str,
    invoiceToken: token,
    idInvoice: safeNumber(invData.idInvoice) ?? safeNumber(invData.IdInvoice),
    pattern: safeString(invData.pattern) ?? safeString(invData.Pattern),
    customerType: safeString(invData.cusType) ?? safeString(invData.customerType),
    clientNotSign: readBoolean(invData.clientNotSign),
    attachFile: readBoolean(invData.attachFile),
    status,
    rowPerPage,
    renderModel,
  };
}
