import { filterInvoices, typeOfInvoice, type InvoiceFilters } from './invoice-filters';
import { computeInvoiceTableMetrics, estimateInvoiceColumnContentWidth, type InvoiceColumnKey, type InvoiceTableContentWidthHints } from './invoice-table-layout';
import { ALL_INVOICE_COLUMN_KEYS, INVOICE_COLUMN_PRESETS, INVOICE_COLUMN_PRESET_LABELS, loadInvoiceUiPreferences, loadInvoiceUiSessionState, saveInvoiceUiPreferences, saveInvoiceUiSessionState, type InvoiceColumnPreset } from './invoice-ui-preferences';
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Empty, Form, Input, Modal, Popover, Select, Slider, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { DownOutlined, FileExcelOutlined, FilePdfOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, SettingOutlined, StopOutlined, UpOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, downloadBlob, type AppStatus } from '../api/client';
import { localWorkspace } from '../storage/local-workspace';
import type { DatasetFile, InvoiceDocument, QueryAutoResult, TvanBatchState, TvanCaptchaChallenge } from '../../shared/models/index.js';
import { mergeIncrementalDocuments, toExistingInvoiceRef } from '../../shared/incremental-sync/index.js';
import { solutionProviderDisplayOf, solutionProviderFriendlyName, solutionProviderTaxCodeOf } from '../../shared/solution-provider.js';
import { ACMAN_SOLUTION_TAX_CODE, PVOIL_SOLUTION_TAX_CODE, VNPT_SOLUTION_TAX_CODE } from '../../shared/provider-resolution.js';
import { buildInvoiceRelationContext, buildRelationViewModels } from '../../shared/invoice-relations/index.js';
import { InvoiceRelationTrigger } from '../components/invoices/InvoiceRelationPopover.js';
import { InvoiceSummaryBar, normalizeCurrencyCode } from '../components/invoices/InvoiceSummaryBar.js';
import { InvoiceLinesModal } from '../components/invoices/InvoiceLinesModal.js';
import { ehoadonNeedsGdtXml } from '../components/EhoadonDientuPresentationCard.js';
import { invoiceStatusLabel, renderInvoiceStatus } from '../components/invoices/invoice-status';
import { formatAmount, money } from '../components/invoices/invoice-format';

const InvoiceDrawer = lazy(() => import('../components/invoices/InvoiceDrawer'));

const { RangePicker } = DatePicker;
const { Text, Paragraph } = Typography;

const INVOICE_COLUMN_CHOICES: Array<{ key: InvoiceColumnKey; label: string }> = [
  { key: 'invoiceSource', label: 'Nguồn' },
  { key: 'issueDate', label: 'Ngày' },
  { key: 'documentType', label: 'Loại hóa đơn' },
  { key: 'templateNo', label: 'Mẫu số' },
  { key: 'series', label: 'Ký hiệu' },
  { key: 'invoiceNo', label: 'Số hóa đơn' },
  { key: 'partnerTaxCode', label: 'MST đối tác' },
  { key: 'partner', label: 'Tên đối tác' },
  { key: 'currency', label: 'Loại tiền tệ' },
  { key: 'subtotal', label: 'Tiền HHDV' },
  { key: 'vatAmount', label: 'Tiền thuế' },
  { key: 'grandTotal', label: 'Tổng tiền thanh toán' },
  { key: 'invoiceStatus', label: 'Tình trạng hóa đơn' },
  { key: 'processingStatus', label: 'Trạng thái xử lý' },
  { key: 'providerCode', label: 'NCC HĐĐT' },
  { key: 'detail', label: 'Detail' },
  { key: 'actions', label: 'Thao tác xem' },
];
const PUBLIC_HIDDEN_INVOICE_COLUMNS = new Set<InvoiceColumnKey>(['lookupCode']);

function shortInvoiceTypeLabel(
  value?: string,
  code?: string,
): string {
  const text = String(value || '').trim();
  const normalized = text.toLocaleLowerCase('vi-VN');

  if (normalized.includes('giá trị gia tăng')) {
    return 'GTGT';
  }

  if (normalized.includes('bán hàng')) {
    return 'Bán hàng';
  }

  if (
    normalized.includes('xuất kho') &&
    normalized.includes('vận chuyển nội bộ')
  ) {
    return 'PXK nội bộ';
  }

  if (
    normalized.includes('xuất kho') &&
    normalized.includes('gửi bán')
  ) {
    return 'PXK gửi bán';
  }

  return text || String(code || '').trim() || '—';
}

export interface InvoiceMenuActions {
  saveData: () => void;
  openData: () => void;
  exportExcel: () => void;
  exportPdf: () => void;
  queueXml: () => void;
  clearFilters: () => void;
  showLastResult: () => void;
  hasDocuments: boolean;
  selectedCount: number;
  hasQueryResult: boolean;
  warningCount: number;
}

const DEFAULT_QUERY_STATUSES: Array<'5' | '6' | '8'> = ['5', '6', '8'];
const PURCHASE_QUERY_SOURCES: Array<'standard' | 'pos'> = ['standard', 'pos'];

interface Props {
  documents: InvoiceDocument[];
  setDocuments: (documents: InvoiceDocument[]) => void;
  direction: 'purchase' | 'sales';
  dateRange: [string, string] | null;
  setDateRange: (range: [string, string] | null) => void;
  /** Last fully covered range from the opened/successfully synced dataset. */
  coverageRange: [string, string] | null;
  setCoverageRange: (range: [string, string] | null) => void;
  openedDatasetScope: 'full' | 'selection' | null;
  username: string;
  authenticated: boolean;
  capabilities?: AppStatus['capabilities'];
  onDataset: (dataset: DatasetFile) => void;
  selectedDocuments: InvoiceDocument[];
  selectedRowKeys: React.Key[];
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  onMenuActionsChange?: (actions: InvoiceMenuActions | null) => void;
}

function locatorOf(document: InvoiceDocument) {
  return {
    sellerTaxCode: String(document.seller?.taxCode || ''),
    templateNo: document.templateNo ?? '',
    series: String(document.series || ''),
    invoiceNo: document.invoiceNo ?? '',
  };
}


const PUBLIC_PDF_PROVIDER_CODES = new Set([
  'tvan_misa',
  'tvan_viettel',
  'tvan_softdreams',
  'tvan_pvoil',
  'tvan_invoice',
  'ehoadondientu',
  'tvan_thaison',
]);

const PUBLIC_PDF_PROVIDER_NAMES = new Set([
  'MISA',
  'VIETTEL',
  'SOFTDREAMS',
  'PVOIL',
  'M-INVOICE',
  'EHOADONDIENTU',
  'THÁI SƠN',
]);

function canPublicViewPdf(document: InvoiceDocument): boolean {
  const providerCode = String(
    document.providers?.presentation?.adapterCode
      || document.providerCode
      || document.lookup?.providerCode
      || '',
  ).trim().toLocaleLowerCase('vi-VN');
  if (PUBLIC_PDF_PROVIDER_CODES.has(providerCode)) return true;

  const providerName = String(
    solutionProviderFriendlyName(solutionProviderTaxCodeOf(document)) || '',
  ).trim().toLocaleUpperCase('vi-VN');
  return PUBLIC_PDF_PROVIDER_NAMES.has(providerName);
}


export default function InvoicePage(props: Props) {
  const {
    documents,
    setDocuments,
    direction,
    dateRange,
    setDateRange,
    coverageRange,
    setCoverageRange,
    openedDatasetScope,
    username,
    authenticated,
    capabilities,
    onDataset,
    selectedDocuments,
    selectedRowKeys,
    setSelectedRowKeys,
    onMenuActionsChange,
  } = props;
  const [form] = Form.useForm();
  const queryDocumentType = Form.useWatch('documentType', form);
  const fileInput = useRef<HTMLInputElement>(null);
  const tableContainer = useRef<HTMLDivElement>(null);
  const operation = useRef(0);
  const [initialUiPreferences] = useState(() => loadInvoiceUiPreferences());
  const [initialUiSession] = useState(() => loadInvoiceUiSessionState());
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<InvoiceColumnKey[]>(initialUiPreferences.visibleColumns);
  const [columnPreset, setColumnPreset] = useState<InvoiceColumnPreset>(initialUiPreferences.selectedPreset);
  const [drawerDoc, setDrawerDoc] = useState<any | null>(null);
  const [localText, setLocalText] = useState(initialUiSession.quickSearch);
  const [debouncedLocalText, setDebouncedLocalText] = useState(initialUiSession.quickSearch);
  const abort = useRef<AbortController | null>(null);
  const [filters, setFilters] = useState<InvoiceFilters>(initialUiSession.filters);
  const [advancedOpen, setAdvancedOpen] = useState(initialUiSession.advancedOpen);
  const [linesModalDoc, setLinesModalDoc] = useState<InvoiceDocument | null>(null);
  const [tableHeight, setTableHeight] = useState(500);
  const [tableViewportWidth, setTableViewportWidth] = useState(1280);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const [queryInfo, setQueryInfo] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [lastQueryLoadedCount, setLastQueryLoadedCount] = useState(0);
  const [lastSyncStats, setLastSyncStats] = useState<QueryAutoResult['sync'] | null>(null);
  const [tvanBusyKey, setTvanBusyKey] = useState<string | null>(null);
  const [tvanBatchBusy, setTvanBatchBusy] = useState(false);
  const [tvanBatchState, setTvanBatchState] = useState<TvanBatchState | null>(null);
  const [captchaFlow, setCaptchaFlow] = useState<{
    challenge: TvanCaptchaChallenge;
    kind: 'view' | 'batch';
    document?: InvoiceDocument;
    batchId?: string;
  } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaSliderValue, setCaptchaSliderValue] = useState(0);
  const [captchaSliderTouched, setCaptchaSliderTouched] = useState(false);
  const [captchaBackgroundWidth, setCaptchaBackgroundWidth] = useState(0);
  const [captchaBackgroundHeight, setCaptchaBackgroundHeight] = useState(0);
  const [captchaPieceWidth, setCaptchaPieceWidth] = useState(0);
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => () => { abort.current?.abort(); operation.current++; }, []);
  useEffect(() => { setLinesModalDoc(null); }, [direction]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedLocalText(localText), 160);
    return () => window.clearTimeout(timer);
  }, [localText]);
  useEffect(() => {
    saveInvoiceUiPreferences({ schemaVersion: 2, visibleColumns: visibleColumnKeys, selectedPreset: columnPreset });
  }, [visibleColumnKeys, columnPreset]);
  useEffect(() => {
    if (!captchaFlow) return;
    if (captchaFlow.challenge.kind === 'slider') {
      setCaptchaSliderValue(captchaFlow.challenge.sliderStart ?? 0);
      setCaptchaSliderTouched(false);
      setCaptchaBackgroundWidth(0);
      setCaptchaBackgroundHeight(0);
      setCaptchaPieceWidth(0);
    }
  }, [captchaFlow?.challenge.id]);
  useEffect(() => {
    saveInvoiceUiSessionState({ schemaVersion: 1, quickSearch: localText, filters, advancedOpen });
  }, [localText, filters, advancedOpen]);
  const stopCurrentOperation = () => {
    abort.current?.abort(); operation.current++;
    setLoading(false); setDetailLoading(false);
    message.info('Đã hủy request; máy chủ dừng ở ranh giới request GDT tiếp theo.');
  };
  const queryPage = async () => {
    if (!authenticated) return message.warning('Cần đăng nhập GDT.');
    if (!dateRange) return message.warning('Chọn khoảng ngày.');
    if (direction === 'sales' && !capabilities?.liveSales) return message.error('Endpoint bán ra live chưa được xác minh/cấu hình.');
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const currentOperation = ++operation.current;
    setLoading(true); setWarnings([]); setQueryInfo('Đang truy vấn tăng dần, kiểm tra bù ttxly=6 và chỉ tải detail còn thiếu…');
    const baseDocuments = documents.filter((document) => document.direction === direction);
    const apply = (response: QueryAutoResult) => {
      const merged = mergeIncrementalDocuments(baseDocuments, response.documents);
      setDocuments(merged); setSelectedRowKeys([]); setLinesModalDoc(null);
      setLastQueryLoadedCount(response.sync.found);
      setLastSyncStats(response.sync);
      setWarnings((response.warnings || []).map((w) => [w.stage, w.source, w.status ? `ttxly=${w.status}` : '', w.chunk?.start || w.key, w.code, w.message].filter(Boolean).join(' — ')));
      const mainWindowText = response.windows.main
        ? `${response.windows.main.start} → ${response.windows.main.end}`
        : 'không có ngày mới';
      const supplementText = response.windows.ttxly6Supplement
        ? `${response.windows.ttxly6Supplement.start} → ${response.windows.ttxly6Supplement.end}`
        : 'không chạy';
      setQueryInfo(
        `Main: ${mainWindowText}; bù ttxly=6: ${supplementText}. `
        + `Nhận ${response.sync.found} hóa đơn; ${response.sync.newDocuments} mới; `
        + `${response.sync.originalMarkedReplaced} gốc → tthai=4; `
        + `${response.sync.originalMarkedAdjusted} gốc → tthai=5; `
        + `${response.sync.detailSkipped} detail được tái sử dụng; ${response.hydrated} detail tải mới.`
      );
      if (!response.partial) {
        setCoverageRange([coverageRange?.[0] ?? dateRange[0], dateRange[1]]);
      }
      setResultModalOpen(true);
    };
    try {
      const fields = form.getFieldsValue();
      const response = await api.queryAuto({ direction, fromDate: dateRange[0], toDate: dateRange[1],
        documentType: fields.documentType || undefined, statuses: DEFAULT_QUERY_STATUSES,
        sources: direction === 'sales' ? ['standard'] : PURCHASE_QUERY_SOURCES,
        partnerTaxCode: fields.partnerTaxCode?.trim() || undefined, invoiceNo: fields.invoiceNo?.trim() || undefined, series: fields.series?.trim() || undefined,
        existingDocuments: baseDocuments.map(toExistingInvoiceRef),
        baselineToDate: coverageRange?.[1],
        supplementTtxly6: true }, controller.signal);
      if (currentOperation !== operation.current) return;
      apply(response);
      if (response.partial) message.warning('Đã giữ kết quả tải được; xem cảnh báo.');
      else message.success('Đã đồng bộ tăng dần; đã kiểm tra bù ttxly=6 và không tải lại detail đã có.');
    } catch (error: any) {
      if (currentOperation !== operation.current) return;
      if (Array.isArray(error?.body?.documents) && error?.body?.sync) apply(error.body as QueryAutoResult);
      else setQueryInfo('Truy vấn chưa hoàn tất; dữ liệu trước đó được giữ nguyên.');
      message.error(error?.message || 'Lỗi tra cứu');
    } finally { if (currentOperation === operation.current) setLoading(false); }
  };

  const loadDetails = async (all: boolean) => {
    if (!authenticated) return message.warning('Cần đăng nhập GDT để lấy chi tiết.');
    const targets = all ? documents : selectedDocuments;
    if (!targets.length) return message.warning('Chọn hóa đơn cần lấy chi tiết.');
    const currentOperation = ++operation.current;
    setDetailLoading(true);
    try {
      const response: { documents: any[]; errors: unknown[] } = { documents: [], errors: [] };
      for (let offset = 0; offset < targets.length; offset += 500) {
      if (currentOperation !== operation.current) return;
      const batch = await api.getDetails({
        direction,
        items: targets.slice(offset, offset + 500).map((document) => ({
          invoiceSource: document.invoiceSource || 'standard',
          locator: locatorOf(document),
          summary: document.rawSummary && typeof document.rawSummary === 'object'
            ? document.rawSummary
            : undefined,
        })),
      });
      if (currentOperation !== operation.current) return;
      response.documents.push(...batch.documents); response.errors.push(...(batch.errors || []));
      }
      const byKey = new Map((response.documents as any[]).map((document) => [document.key, document]));
      setDocuments(documents.map((document) => byKey.get(document.key) || document));
      message.success(`Đã lấy chi tiết ${response.documents.length}/${targets.length} hóa đơn.`);
      if (response.errors?.length) message.warning(`${response.errors.length} hóa đơn lỗi; có thể thử lại.`);
    } catch (error: any) {
      const partial = error?.body?.partial;
      if (Array.isArray(partial) && partial.length) {
        const byKey = new Map(partial.map((document: any) => [document.key, document]));
        setDocuments(documents.map((document) => byKey.get(document.key) || document));
      }
      if (currentOperation === operation.current) message.error(error?.message || 'Lỗi lấy chi tiết');
    } finally {
      if (currentOperation === operation.current) setDetailLoading(false);
    }
  };

  const saveJson = async () => {
    if (openedDatasetScope === 'selection') {
      return message.warning('Dataset đang mở là tập hóa đơn được chọn, chưa phải coverage đầy đủ. Hãy đồng bộ đầy đủ trước khi dùng “Lưu dữ liệu”, hoặc dùng “Lưu JSON” cho tập hóa đơn đã chọn.');
    }
    if (!documents.length || !dateRange || !username) return message.warning('Không đủ dữ liệu để lưu.');
    const saveRange = coverageRange ?? dateRange;
    try {
      const result = await localWorkspace.saveDataset({
        accountTaxCode: username,
        direction,
        fromDate: saveRange[0],
        toDate: saveRange[1],
        documents,
      });
      message.success(result.destination === 'workspace'
        ? `Đã lưu dữ liệu tại thư mục đã chọn: ${result.fileName}`
        : `Đã tải dữ liệu qua trình duyệt: ${result.fileName}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi lưu dữ liệu');
    }
  };

  const saveSelectedJson = async () => {
    if (!selectedDocuments.length || !dateRange || !username) return message.warning('Không đủ dữ liệu đã chọn để lưu.');
    const saveRange = coverageRange ?? dateRange;
    try {
      const result = await localWorkspace.saveSelectedDataset({
        accountTaxCode: username,
        direction,
        fromDate: saveRange[0],
        toDate: saveRange[1],
        documents: selectedDocuments,
        sourceRecordCount: documents.length,
      });
      message.success(result.destination === 'workspace'
        ? `Đã lưu JSON ${selectedDocuments.length} hóa đơn đã chọn: ${result.fileName}`
        : `Đã tải JSON ${selectedDocuments.length} hóa đơn đã chọn: ${result.fileName}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi lưu JSON hóa đơn đã chọn');
    }
  };

  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    try {
      const dataset = await api.importDataset(JSON.parse(await file.text()));
      onDataset(dataset);
      setSelectedRowKeys([]); setLinesModalDoc(null); setWarnings([]); setQueryInfo('');
      message.success(`Đã mở ${dataset.meta?.recordCount || 0} chứng từ.`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không mở được dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = async () => {
    if (!selectedDocuments.length) return message.warning('Chọn ít nhất một hóa đơn/chứng từ để xuất Excel.');
    try {
      const blob = await api.exportReport({ documents: selectedDocuments, direction });
      downloadBlob(blob, `HDDT_Report_${direction}_${selectedDocuments.length}HD_${Date.now()}.xlsx`);
      message.success(`Đã tạo báo cáo Excel cho ${selectedDocuments.length.toLocaleString('vi-VN')} hóa đơn/chứng từ đã chọn.`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi xuất Excel');
    }
  };

  const queueXml = async () => {
    if (!authenticated) return message.warning('Cần đăng nhập GDT để tải XML.');
    const targets = selectedDocuments;
    if (!targets.length) return message.warning('Chọn ít nhất một hóa đơn.');
    try {
      for (const document of targets) {
        const result = await api.downloadFile({
          invoiceSource: document.invoiceSource || 'standard',
          locator: locatorOf(document),
          issueDate: document.issueDate,
          type: 'xml',
        });
        await localWorkspace.saveBlob(result.blob, result.fileName, username);
      }
      message.success(`Đã lưu ${targets.length} XML trên máy của bạn.`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi xếp hàng tải');
    }
  };

  const closePdfViewer = () => {
    setPdfViewer((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const openPdfBlob = (blob: Blob, title: string) => {
    const url = URL.createObjectURL(blob);
    setPdfViewer((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return { url, title: title || 'Bản thể hiện hóa đơn' };
    });
  };

  const fetchAndOpenTvanPdf = async (document: InvoiceDocument) => {
    setTvanBusyKey(document.key);
    try {
      const blob = await api.viewTvanPdf(document);
      openPdfBlob(blob, `${document.series || ''}_${document.invoiceNo || ''}`.replace(/^_+|_+$/g, ''));
    } catch (error: any) {
      if (error?.status === 428 || error?.code === 'TVAN_CAPTCHA_REQUIRED') {
        const prepared = await api.preparePresentation(document);
        if (prepared.challenge) {
          setCaptchaAnswer('');
          setCaptchaFlow({ challenge: prepared.challenge, kind: 'view', document });
          return;
        }
      }
      message.error('Không thể mở bản thể hiện PDF. Vui lòng thử lại.');
    } finally {
      setTvanBusyKey(null);
    }
  };

  const requestTvanPdfView = async (document: InvoiceDocument) => {
    const solutionTaxCode = solutionProviderTaxCodeOf(document);
    const vnptNeedsGdtXml = solutionTaxCode === VNPT_SOLUTION_TAX_CODE && !String(document.lookup?.lookupCode || '').trim();
    const acmanNeedsGdtXml = solutionTaxCode === ACMAN_SOLUTION_TAX_CODE && !String(document.lookup?.lookupCode || '').trim();
    const pvoilNeedsGdtXml = solutionTaxCode === PVOIL_SOLUTION_TAX_CODE && !String(document.lookup?.lookupCode || '').trim();
    if (!authenticated && (ehoadonNeedsGdtXml(document) || vnptNeedsGdtXml || acmanNeedsGdtXml || pvoilNeedsGdtXml)) {
      message.warning('Cần đăng nhập để chuẩn bị bản thể hiện PDF của hóa đơn này.');
      return;
    }

    // MISA's supervised card is the stable production path: resolve customData and let the
    // real browser open DownloadHandler. Server-side byte fetching is intermittently rejected
    // by MISA's edge/WAF even when the presentation URL itself is valid.
    const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLocaleLowerCase();
    if (providerCode.includes('misa')) {
      const popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      setTvanBusyKey(document.key);
      try {
        const resolved = await api.resolvePresentationLink(document);
        if (!resolved.downloadUrl) throw new Error('Chưa thể mở bản thể hiện PDF.');
        if (popup) popup.location.replace(resolved.downloadUrl);
        else window.open(resolved.downloadUrl, '_blank', 'noopener,noreferrer');
      } catch (error) {
        popup?.close();
        message.error('Không thể mở bản thể hiện PDF. Vui lòng thử lại.');
      } finally {
        setTvanBusyKey(null);
      }
      return;
    }

    setTvanBusyKey(document.key);
    try {
      const prepared = await api.preparePresentation(document);
      if (!prepared.capability.supported) {
        message.warning('Chưa thể xem/tải PDF bản thể hiện của hóa đơn này.');
        return;
      }
      if (prepared.challenge) {
        setCaptchaAnswer('');
        setCaptchaFlow({ challenge: prepared.challenge, kind: 'view', document });
        return;
      }
      await fetchAndOpenTvanPdf(document);
    } catch (error) {
      message.error('Không thể mở bản thể hiện PDF. Vui lòng thử lại.');
    } finally {
      setTvanBusyKey(null);
    }
  };

  const finishTvanBatch = async (state: TvanBatchState) => {
    setTvanBatchState(state);
    if (state.status === 'waiting_captcha' && state.challenge) {
      setCaptchaAnswer('');
      setCaptchaFlow({ challenge: state.challenge, kind: 'batch', batchId: state.id });
      return;
    }
    if (state.status === 'done' && state.archiveReady) {
      const blob = await api.downloadTvanPdfArchive(state.id);
      downloadBlob(blob, `HDDT_PDF_${state.id}.zip`);
      const done = state.tasks.filter((task) => task.status === 'done').length;
      const failed = state.tasks.filter((task) => task.status === 'failed').length;
      if (failed) message.warning(`Đã tải ${done} PDF; ${failed} hóa đơn chưa tải được.`);
      else message.success(`Đã tải ${done} PDF.`);
    }
  };

  const startTvanPdfBatch = async () => {
    const targets = selectedDocuments;
    if (!targets.length) return message.warning('Chọn ít nhất một hóa đơn.');
    const hasXmlDependentProvider = targets.some(document => {
      const solutionTaxCode = solutionProviderTaxCodeOf(document);
      return ehoadonNeedsGdtXml(document)
        || ((solutionTaxCode === VNPT_SOLUTION_TAX_CODE || solutionTaxCode === ACMAN_SOLUTION_TAX_CODE || solutionTaxCode === PVOIL_SOLUTION_TAX_CODE)
          && !String(document.lookup?.lookupCode || '').trim());
    });
    if (!authenticated && hasXmlDependentProvider) {
      return message.warning('Cần đăng nhập để tải PDF cho các hóa đơn đã chọn.');
    }
    setTvanBatchBusy(true);
    try {
      await finishTvanBatch(await api.startTvanPdfBatch(targets));
    } catch (error) {
      message.error('Không thể tải PDF. Vui lòng thử lại.');
    } finally {
      setTvanBatchBusy(false);
    }
  };

  const submitCurrentCaptcha = async () => {
    if (!captchaFlow) return;
    const isSlider = captchaFlow.challenge.kind === 'slider';
    if (isSlider && !captchaSliderTouched) return message.warning('Hãy kéo CAPTCHA đến đúng vị trí trước khi tiếp tục.');
    if (!isSlider && !captchaAnswer.trim()) return message.warning('Nhập CAPTCHA trước khi tiếp tục.');
    const answer = isSlider ? String(Math.round(captchaSliderValue)) : captchaAnswer.trim();
    const current = captchaFlow;
    setTvanBatchBusy(current.kind === 'batch');
    try {
      if (current.kind === 'view' && current.document) {
        await api.submitPresentationChallenge(current.challenge.id, answer);
        setCaptchaFlow(null);
        setCaptchaAnswer('');
        setCaptchaSliderTouched(false);
        await fetchAndOpenTvanPdf(current.document);
      } else if (current.kind === 'batch' && current.batchId) {
        const state = await api.submitTvanBatchCaptcha(current.batchId, current.challenge.id, answer);
        setCaptchaFlow(null);
        setCaptchaAnswer('');
        setCaptchaSliderTouched(false);
        await finishTvanBatch(state);
      }
    } catch (error) {
      message.error('CAPTCHA chưa đúng hoặc đã hết hạn. Vui lòng thử lại.');
    } finally {
      setTvanBatchBusy(false);
    }
  };

  const clearLocalFilters = () => {
    setFilters({});
    setLocalText('');
  };

  // Các tác vụ dữ liệu được hiển thị trên cùng hàng với menu chương trình ở App.tsx.
  // Dùng ref + proxy ổn định để tránh vòng lặp render khi App nhận lại callbacks từ trang hóa đơn.
  const menuHandlersRef = useRef({
    saveData: () => { void saveJson(); },
    openData: () => fileInput.current?.click(),
    exportExcel: () => { void exportExcel(); },
    exportPdf: () => { void startTvanPdfBatch(); },
    queueXml: () => { void queueXml(); },
    clearFilters: clearLocalFilters,
    showLastResult: () => setResultModalOpen(true),
  });
  menuHandlersRef.current = {
    saveData: () => { void saveJson(); },
    openData: () => fileInput.current?.click(),
    exportExcel: () => { void exportExcel(); },
    exportPdf: () => { void startTvanPdfBatch(); },
    queueXml: () => { void queueXml(); },
    clearFilters: clearLocalFilters,
    showLastResult: () => setResultModalOpen(true),
  };

  const stableMenuActions = useMemo(() => ({
    saveData: () => menuHandlersRef.current.saveData(),
    openData: () => menuHandlersRef.current.openData(),
    exportExcel: () => menuHandlersRef.current.exportExcel(),
    exportPdf: () => menuHandlersRef.current.exportPdf(),
    queueXml: () => menuHandlersRef.current.queueXml(),
    clearFilters: () => menuHandlersRef.current.clearFilters(),
    showLastResult: () => menuHandlersRef.current.showLastResult(),
  }), []);

  useEffect(() => {
    onMenuActionsChange?.({
      ...stableMenuActions,
      hasDocuments: documents.length > 0,
      selectedCount: selectedDocuments.length,
      hasQueryResult: Boolean(queryInfo),
      warningCount: warnings.length,
    });
  }, [
    documents.length,
    onMenuActionsChange,
    queryInfo,
    selectedDocuments.length,
    stableMenuActions,
    warnings.length,
  ]);

  useEffect(() => () => onMenuActionsChange?.(null), [onMenuActionsChange]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLocaleLowerCase('vi-VN');
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        stableMenuActions.saveData();
      } else if ((event.ctrlKey || event.metaKey) && key === 'e') {
        event.preventDefault();
        stableMenuActions.exportExcel();
      } else if (event.key === 'Escape' && advancedOpen) {
        setAdvancedOpen(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [advancedOpen, stableMenuActions]);

  const filteredDocuments = useMemo(() => {
    const needle = debouncedLocalText.trim().toLocaleLowerCase('vi-VN');
    const base = filterInvoices(documents, filters);
    if (!needle) return base;
    return base.filter((document) => [
      document.invoiceNo,
      document.series,
      document.seller?.taxCode,
      document.seller?.name,
      document.buyer?.taxCode,
      document.buyer?.name,
      document.lookup?.lookupCode,
    ].some((value) => String(value ?? '').toLocaleLowerCase('vi-VN').includes(needle)));
  }, [documents, debouncedLocalText, filters]);

  const relationContext = useMemo(
    () => buildInvoiceRelationContext(documents),
    [documents],
  );
  const relationModels = useMemo(
    () => buildRelationViewModels(documents, relationContext),
    [documents, relationContext],
  );
  const documentsByKey = useMemo(
    () => new Map(documents.map(document => [document.key, document] as const)),
    [documents],
  );
  const openRelatedInvoice = (invoiceKey: string) => {
    const related = documentsByKey.get(invoiceKey);
    if (!related) {
      message.info('Hóa đơn liên quan không còn trong dữ liệu hiện tại.');
      return;
    }
    setDrawerDoc(related);
  };

  const options = useMemo(() => {
    const unique = (values: unknown[]) => [...new Set(values.filter(v => v !== undefined && v !== null && v !== '').map(String))].sort().map(value => ({ value, label: value }));
    const invoiceStatuses = unique(documents.map(d => d.invoiceStatus)).map(option => ({
      ...option,
      label: `${invoiceStatusLabel(option.value)} (${option.value})`,
    }));
    return {
      type: unique(documents.map(typeOfInvoice)),
      invoiceStatuses,
      processingStatuses: unique(documents.map(d => d.processingStatus)),
      providerCodes: unique(documents.map(solutionProviderTaxCodeOf)).map(option => ({
        ...option,
        label: solutionProviderFriendlyName(option.value) === option.value
          ? option.value
          : `${solutionProviderFriendlyName(option.value)} · ${option.value}`,
      })),
    };
  }, [documents]);
  const currencyTotals = useMemo(() => {
    const totals = new Map<string, { subtotal: number; vat: number; grandTotal: number }>();
    for (const document of filteredDocuments) {
      const currency = normalizeCurrencyCode(document.currency);
      const current = totals.get(currency) || { subtotal: 0, vat: 0, grandTotal: 0 };
      current.subtotal += Number(document.subtotal) || 0;
      current.vat += Number(document.vatAmount) || 0;
      current.grandTotal += Number(document.grandTotal) || 0;
      totals.set(currency, current);
    }
    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'vi'))
      .map(([currency, values]) => ({ currency, ...values }));
  }, [filteredDocuments]);
  const withDetail = filteredDocuments.filter((document) => document.lines?.length > 0).length;

  const activeFilterChips: Array<{ key: string; label: string; onClose: () => void }> = [];
  if (localText.trim()) {
    activeFilterChips.push({ key: 'quick', label: `Tìm nhanh: ${localText.trim()}`, onClose: () => setLocalText('') });
  }
  if (filters.issueDateFrom || filters.issueDateTo) {
    const from = filters.issueDateFrom ? dayjs(filters.issueDateFrom).format('DD/MM/YYYY') : '…';
    const to = filters.issueDateTo ? dayjs(filters.issueDateTo).format('DD/MM/YYYY') : '…';
    activeFilterChips.push({
      key: 'issueDate',
      label: `Ngày: ${from} → ${to}`,
      onClose: () => setFilters(current => ({ ...current, issueDateFrom: undefined, issueDateTo: undefined })),
    });
  }
  const addTextChip = (field: keyof InvoiceFilters, label: string) => {
    const value = filters[field];
    if (typeof value === 'string' && value.trim()) {
      activeFilterChips.push({
        key: String(field),
        label: `${label}: ${value}`,
        onClose: () => setFilters(current => ({ ...current, [field]: undefined })),
      });
    }
  };
  addTextChip('type', 'Loại HĐ');
  addTextChip('templateNo', 'Mẫu số');
  addTextChip('series', 'Ký hiệu');
  addTextChip('invoiceNo', 'Số HĐ');
  addTextChip('partnerTaxCode', 'MST');
  addTextChip('partner', 'Đối tác');
  if (filters.invoiceStatuses?.length) {
    activeFilterChips.push({
      key: 'invoiceStatuses',
      label: `Tình trạng: ${filters.invoiceStatuses.map(invoiceStatusLabel).join(', ')}`,
      onClose: () => setFilters(current => ({ ...current, invoiceStatuses: undefined })),
    });
  }
  if (filters.processingStatuses?.length) {
    activeFilterChips.push({
      key: 'processingStatuses',
      label: `Xử lý: ${filters.processingStatuses.join(', ')}`,
      onClose: () => setFilters(current => ({ ...current, processingStatuses: undefined })),
    });
  }
  if (filters.providerCodes?.length) {
    activeFilterChips.push({
      key: 'providerCodes',
      label: `NCC HĐĐT: ${filters.providerCodes.map(value => solutionProviderFriendlyName(value) || value).join(', ')}`,
      onClose: () => setFilters(current => ({ ...current, providerCodes: undefined })),
    });
  }
  if (filters.detail) {
    activeFilterChips.push({
      key: 'detail',
      label: filters.detail === 'has' ? 'Detail: Đã có' : 'Detail: Chưa có',
      onClose: () => setFilters(current => ({ ...current, detail: undefined })),
    });
  }
  const advancedFilterCount = [
    queryDocumentType,
    filters.type,
    filters.invoiceStatuses?.length ? 'invoiceStatuses' : '',
    filters.processingStatuses?.length ? 'processingStatuses' : '',
    filters.providerCodes?.length ? 'providerCodes' : '',
    filters.detail,
  ].filter(Boolean).length;

  useEffect(() => {
    let frame = 0;
    const updateTableViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const containerRect = tableContainer.current?.getBoundingClientRect();
        const tableRect = tableContainer.current?.querySelector('.invoice-data-table')?.getBoundingClientRect();
        const tableTop = tableContainer.current?.querySelector('.ant-table')?.getBoundingClientRect().top
          ?? tableRect?.top
          ?? containerRect?.top
          ?? 420;
        const nextHeight = Math.max(320, Math.floor(window.innerHeight - tableTop - 32));
        const nextWidth = Math.max(320, Math.floor(tableRect?.width ?? containerRect?.width ?? window.innerWidth - 32));
        setTableHeight(current => current === nextHeight ? current : nextHeight);
        setTableViewportWidth(current => current === nextWidth ? current : nextWidth);
      });
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateTableViewport)
      : null;
    if (tableContainer.current) resizeObserver?.observe(tableContainer.current);
    updateTableViewport();
    window.addEventListener('resize', updateTableViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateTableViewport);
    };
  }, [queryInfo, warnings.length, currencyTotals.length, filteredDocuments.length, direction]);

  const textHeaderFilter = (field: keyof InvoiceFilters, placeholder: string) => ({
    filteredValue: filters[field] ? [String(filters[field])] : null,
    filterIcon: <SearchOutlined style={{ color: filters[field] ? '#1677ff' : undefined }} />,
    filterDropdown: () => (
      <div style={{ padding: 8, width: 220 }} onKeyDown={event => event.stopPropagation()}>
        <Input
          autoFocus
          allowClear
          placeholder={placeholder}
          value={String(filters[field] ?? '')}
          onChange={event => setFilters(old => ({ ...old, [field]: event.target.value || undefined }))}
        />
      </div>
    ),
  });

  const selectHeaderFilter = (
    field: 'type' | 'invoiceStatuses' | 'processingStatuses' | 'providerCodes' | 'detail',
    selectOptions: Array<{ value: string; label: string }>,
    multiple = false,
  ) => ({
    filteredValue: multiple
      ? (Array.isArray(filters[field]) && (filters[field] as string[]).length
        ? filters[field] as string[]
        : null)
      : (filters[field] ? [String(filters[field])] : null),
    filterIcon: <SearchOutlined style={{
      color: (Array.isArray(filters[field])
        ? (filters[field] as string[]).length > 0
        : !!filters[field]) ? '#1677ff' : undefined,
    }} />,
    filterDropdown: () => (
      <div style={{ padding: 8, width: 240 }} onKeyDown={event => event.stopPropagation()}>
        <Select
          autoFocus
          allowClear
          showSearch
          mode={multiple ? 'multiple' : undefined}
          placeholder="Chọn giá trị"
          style={{ width: '100%' }}
          value={filters[field] as any}
          options={selectOptions}
          onChange={(value: string | string[] | undefined) =>
            setFilters(old => ({ ...old, [field]: Array.isArray(value) && !value.length ? undefined : value }))
          }
        />
      </div>
    ),
  });

  const dateHeaderFilter = {
    filteredValue: filters.issueDateFrom || filters.issueDateTo ? [filters.issueDateFrom || '', filters.issueDateTo || ''] : null,
    filterIcon: <SearchOutlined style={{ color: filters.issueDateFrom || filters.issueDateTo ? '#1677ff' : undefined }} />,
    filterDropdown: () => (
      <div style={{ padding: 8 }} onKeyDown={event => event.stopPropagation()}>
        <RangePicker
          allowClear
          format="DD/MM/YYYY"
          value={filters.issueDateFrom && filters.issueDateTo
            ? [dayjs(filters.issueDateFrom), dayjs(filters.issueDateTo)]
            : null}
          onChange={range => setFilters(old => ({
            ...old,
            issueDateFrom: range?.[0]?.format('YYYY-MM-DD'),
            issueDateTo: range?.[1]?.format('YYYY-MM-DD'),
          }))}
        />
      </div>
    ),
  };

  const publicVisibleColumnKeys = visibleColumnKeys.filter(key => !PUBLIC_HIDDEN_INVOICE_COLUMNS.has(key));
  const tableContentWidthHints = useMemo<InvoiceTableContentWidthHints>(() => {
    const values = (select: (document: InvoiceDocument) => unknown) => filteredDocuments.map(select);
    return {
      invoiceSource: estimateInvoiceColumnContentWidth(
        values(document => document.invoiceSource === 'pos' ? 'Máy tính tiền' : 'HĐĐT'),
        'Nguồn',
        { headerControls: false },
      ),
      documentType: estimateInvoiceColumnContentWidth(
        values(document => shortInvoiceTypeLabel(document.documentTypeName, document.documentTypeCode)),
        'Loại HĐ',
      ),
      templateNo: estimateInvoiceColumnContentWidth(values(document => document.templateNo), 'Mẫu số'),
      series: estimateInvoiceColumnContentWidth(values(document => document.series), 'Ký hiệu'),
      invoiceNo: estimateInvoiceColumnContentWidth(values(document => document.invoiceNo), 'Số hóa đơn'),
      partnerTaxCode: estimateInvoiceColumnContentWidth(
        values(document => direction === 'purchase' ? document.seller?.taxCode : document.buyer?.taxCode),
        direction === 'purchase' ? 'MST bán' : 'MST mua',
      ),
      partner: estimateInvoiceColumnContentWidth(
        values(document => direction === 'purchase' ? document.seller?.name : document.buyer?.name),
        'Tên đối tác',
      ),
      currency: estimateInvoiceColumnContentWidth(values(document => document.currency), 'Loại tiền tệ', { headerControls: false }),
      subtotal: estimateInvoiceColumnContentWidth(values(document => formatAmount(document.subtotal, document.currency)), 'Tiền HHDV', { headerControls: false }),
      vatAmount: estimateInvoiceColumnContentWidth(values(document => formatAmount(document.vatAmount, document.currency)), 'Tiền thuế', { headerControls: false }),
      grandTotal: estimateInvoiceColumnContentWidth(values(document => formatAmount(document.grandTotal, document.currency)), 'Tổng tiền thanh toán'),
      invoiceStatus: estimateInvoiceColumnContentWidth(values(document => invoiceStatusLabel(document.invoiceStatus)), 'Tình trạng hóa đơn'),
      processingStatus: estimateInvoiceColumnContentWidth(values(document => document.processingStatus), 'Trạng thái xử lý'),
      providerCode: estimateInvoiceColumnContentWidth(values(document => solutionProviderDisplayOf(document).label), 'NCC HĐĐT'),
      lookupCode: estimateInvoiceColumnContentWidth(values(document => document.lookup?.lookupCode), 'Mã tra cứu'),
      detail: estimateInvoiceColumnContentWidth(
        values(document => document.lines?.length ? `${document.lines.length} dòng` : 'Chưa có'),
        'Detail',
      ),
    };
  }, [filteredDocuments, direction]);
  const tableMetrics = computeInvoiceTableMetrics(publicVisibleColumnKeys, tableViewportWidth, tableContentWidthHints);
  const { layout: tableLayout } = tableMetrics;
  const columnWidths = tableLayout.columnWidths;
  const tableHasHorizontalOverflow = tableMetrics.intrinsicWidth > tableMetrics.viewportWidth;

  const singleLineValue = (value: unknown, className = '') => {
    const text = String(value ?? '').trim();
    return (
      <span className={`invoice-single-line-cell ${className}`.trim()} title={text || undefined}>
        {text || '—'}
      </span>
    );
  };

  const moneyCell = (value: unknown, record: InvoiceDocument) => (
    <span className="invoice-money-value">{formatAmount(value, record?.currency)}</span>
  );

  const detailMoneyCell = (value: unknown, record: InvoiceDocument, kind: 'goods' | 'tax') => {
    const label = kind === 'goods' ? 'Tiền HHDV' : 'Tiền thuế';
    return (
      <Tooltip title={`Nhấp đúp để xem chi tiết HHDV của hóa đơn · ${label}`} placement="top" mouseEnterDelay={0.35}>
        <button
          type="button"
          className="invoice-detail-amount-trigger"
          onDoubleClick={() => setLinesModalDoc(record)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setLinesModalDoc(record);
            }
          }}
          aria-label={`${label} ${formatAmount(value, record.currency)}. Nhấp đúp hoặc nhấn Enter để xem chi tiết HHDV.`}
        >
          <span className="invoice-money-value">{formatAmount(value, record.currency)}</span>
        </button>
      </Tooltip>
    );
  };

  const allColumns: Array<any & { key: InvoiceColumnKey }> = [
    {
      key: 'invoiceSource',
      title: 'Nguồn',
      dataIndex: 'invoiceSource',
      width: columnWidths.invoiceSource,
      className: 'invoice-cell-nowrap',
      render: (value: string) => value === 'pos' ? <Tag color="blue">Máy tính tiền</Tag> : <Tag>HĐĐT</Tag>,
    },
    {
      key: 'issueDate',
      title: 'Ngày',
      dataIndex: 'issueDate',
      width: columnWidths.issueDate,
      align: 'center',
      className: 'invoice-cell-date',
      ...dateHeaderFilter,
      sorter: (a: any, b: any) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')),
      render: (value: string) => value ? String(value).slice(0, 10) : '',
    },
    {
      key: 'documentType',
      title: 'Loại HĐ',
      dataIndex: 'documentTypeName',
      width: columnWidths.documentType,
      ...selectHeaderFilter('type', options.type),
      render: (value: string, record: any) => {
        const fullText = String(value || record.documentTypeCode || '').trim();
        const shortText = shortInvoiceTypeLabel(value, record.documentTypeCode);
        return (
          <Tooltip title={fullText || undefined} placement="topLeft">
            <span className="invoice-type-label">{shortText}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'templateNo',
      title: 'Mẫu số',
      dataIndex: 'templateNo',
      width: columnWidths.templateNo,
      className: 'invoice-cell-identifier',
      ...textHeaderFilter('templateNo', 'Lọc mẫu số'),
      render: (value: unknown) => singleLineValue(value),
    },
    {
      key: 'series',
      title: 'Ký hiệu',
      dataIndex: 'series',
      width: columnWidths.series,
      className: 'invoice-cell-identifier',
      ...textHeaderFilter('series', 'Lọc ký hiệu'),
      render: (value: unknown) => singleLineValue(value),
    },
    {
      key: 'invoiceNo',
      title: 'Số hóa đơn',
      dataIndex: 'invoiceNo',
      width: columnWidths.invoiceNo,
      className: 'invoice-cell-identifier',
      ...textHeaderFilter('invoiceNo', 'Lọc số hóa đơn'),
      render: (value: unknown, record: InvoiceDocument) => {
        const text = String(value ?? '').trim();
        const relationModel = relationModels.get(record.key);
        const canViewPdf = canPublicViewPdf(record);
        return (
          <InvoiceRelationTrigger
            document={record}
            model={relationModel}
            onOpenInvoice={openRelatedInvoice}
            className="invoice-relation-number-trigger"
          >
            <span
              className={`invoice-single-line-cell ${canViewPdf ? 'invoice-pdf-double-click invoice-number-pdf-available' : 'invoice-number-pdf-unavailable'}${tvanBusyKey === record.key ? ' is-loading' : ''}`}
              title={text
                ? canViewPdf
                  ? `${text} · Có thể xem/tải PDF bản thể hiện · Nhấp đúp để xem`
                  : `${text} · Chưa thể xem/tải PDF bản thể hiện`
                : undefined}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (canViewPdf) void requestTvanPdfView(record);
              }}
            >
              {text || '—'}
            </span>
          </InvoiceRelationTrigger>
        );
      },
    },
    {
      key: 'partnerTaxCode',
      title: direction === 'purchase' ? 'MST bán' : 'MST mua',
      width: columnWidths.partnerTaxCode,
      className: 'invoice-cell-identifier invoice-cell-tax-code',
      ...textHeaderFilter('partnerTaxCode', 'Lọc mã số thuế'),
      render: (_: unknown, record: any) => singleLineValue(
        direction === 'purchase' ? record.seller?.taxCode : record.buyer?.taxCode,
      ),
    },
    {
      key: 'partner',
      title: 'Tên đối tác',
      width: columnWidths.partner,
      className: 'invoice-partner-cell',
      ...textHeaderFilter('partner', 'Lọc tên đối tác'),
      render: (_: unknown, record: any) => {
        const partnerName = String(
          direction === 'purchase'
            ? record.seller?.name || ''
            : record.buyer?.name || '',
        ).trim();
        return (
          <Tooltip title={partnerName || undefined} placement="topLeft">
            <div className="invoice-partner-name">{partnerName || '—'}</div>
          </Tooltip>
        );
      },
    },
    {
      key: 'currency',
      title: 'Loại tiền tệ',
      dataIndex: 'currency',
      width: columnWidths.currency,
      align: 'center',
      className: 'invoice-cell-currency',
      render: (value: unknown) => singleLineValue(value, 'invoice-currency-value'),
    },
    {
      key: 'subtotal',
      title: 'Tiền HHDV',
      dataIndex: 'subtotal',
      width: columnWidths.subtotal,
      align: 'right',
      className: 'invoice-cell-money',
      render: (value: unknown, record: InvoiceDocument) => detailMoneyCell(value, record, 'goods'),
    },
    {
      key: 'vatAmount',
      title: 'Tiền thuế',
      dataIndex: 'vatAmount',
      width: columnWidths.vatAmount,
      align: 'right',
      className: 'invoice-cell-money',
      render: (value: unknown, record: InvoiceDocument) => detailMoneyCell(value, record, 'tax'),
    },
    {
      key: 'grandTotal',
      title: 'Tổng tiền thanh toán',
      dataIndex: 'grandTotal',
      width: columnWidths.grandTotal,
      align: 'right',
      className: 'invoice-cell-money invoice-cell-grand-total',
      sorter: (a: any, b: any) => Number(a.grandTotal || 0) - Number(b.grandTotal || 0),
      render: moneyCell,
    },
    {
      key: 'invoiceStatus',
      title: 'Tình trạng hóa đơn',
      dataIndex: 'invoiceStatus',
      width: columnWidths.invoiceStatus,
      className: 'invoice-cell-status',
      ...selectHeaderFilter('invoiceStatuses', options.invoiceStatuses, true),
      render: (value: unknown, record: InvoiceDocument) => (
        <InvoiceRelationTrigger
          document={record}
          model={relationModels.get(record.key)}
          onOpenInvoice={openRelatedInvoice}
          showIndicator={false}
          className="invoice-relation-status-trigger"
        >
          {renderInvoiceStatus(value)}
        </InvoiceRelationTrigger>
      ),
    },
    {
      key: 'processingStatus',
      title: 'Trạng thái xử lý',
      dataIndex: 'processingStatus',
      width: columnWidths.processingStatus,
      className: 'invoice-cell-nowrap',
      ...selectHeaderFilter('processingStatuses', options.processingStatuses, true),
      render: (value: unknown) => singleLineValue(value),
    },
    {
      key: 'providerCode',
      title: 'NCC HĐĐT',
      width: columnWidths.providerCode,
      className: 'invoice-cell-nowrap',
      ...selectHeaderFilter('providerCodes', options.providerCodes, true),
      render: (_value: unknown, record: InvoiceDocument) => {
        const provider = solutionProviderDisplayOf(record);
        if (!provider.taxCode) return singleLineValue(undefined);
        return (
          <Tooltip title={`MSTTCGP: ${provider.taxCode}`} placement="topLeft">
            <span>{provider.label}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'lookupCode',
      title: 'Mã tra cứu',
      width: columnWidths.lookupCode,
      ...textHeaderFilter('lookupCode', 'Lọc mã tra cứu'),
      render: (_: unknown, record: any) => {
        const lookupCode = String(record.lookup?.lookupCode || '').trim();
        return (
          <Tooltip title={lookupCode || undefined} placement="topLeft">
            <span className="invoice-lookup-code">{lookupCode || '—'}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'detail',
      title: 'Detail',
      width: columnWidths.detail,
      className: 'invoice-cell-nowrap',
      ...selectHeaderFilter('detail', [{ value: 'has', label: 'Có detail' }, { value: 'missing', label: 'Chưa có detail' }]),
      render: (_: unknown, record: any) => record.lines?.length ? <Tag color="green">{record.lines.length} dòng</Tag> : <Tag>Chưa có</Tag>,
    },
    {
      key: 'actions',
      title: '',
      fixed: 'right',
      width: columnWidths.actions,
      className: 'invoice-cell-actions',
      render: (_: unknown, record: InvoiceDocument) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => setDrawerDoc(record)}>Xem</Button>
          {canPublicViewPdf(record) && (
            <Button type="link" size="small" loading={tvanBusyKey === record.key} onClick={() => void requestTvanPdfView(record)}>PDF</Button>
          )}
        </Space>
      ),
    },
  ];

  const visibleColumnSet = new Set(publicVisibleColumnKeys);
  const visibleColumns = allColumns.filter(column => visibleColumnSet.has(column.key));
  const spacerColumn = tableMetrics.spacerWidth > 0
    ? {
        key: '__layoutSpacer',
        title: '',
        width: tableMetrics.spacerWidth,
        className: 'invoice-layout-spacer-cell',
        render: () => null,
      }
    : null;
  const actionsIndex = visibleColumns.findIndex(column => column.key === 'actions');
  const columns = spacerColumn
    ? actionsIndex >= 0
      ? [
          ...visibleColumns.slice(0, actionsIndex),
          spacerColumn,
          ...visibleColumns.slice(actionsIndex),
        ]
      : [...visibleColumns, spacerColumn]
    : visibleColumns;

  useEffect(() => {
    const root = tableContainer.current;
    if (!root || !tableHasHorizontalOverflow) {
      setScrollEdges({ left: false, right: false });
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let scroller: HTMLElement | null = null;
    const update = () => {
      if (!scroller) return;
      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const left = scroller.scrollLeft > 2;
      const right = scroller.scrollLeft < maxScrollLeft - 2;
      setScrollEdges(current => current.left === left && current.right === right ? current : { left, right });
    };

    const bind = () => {
      const candidates = [...root.querySelectorAll<HTMLElement>(
        '.ant-table-body, .ant-table-content, .ant-table-tbody-virtual-holder',
      )];
      scroller = candidates.find(element => element.scrollWidth > element.clientWidth + 2) || null;
      if (!scroller) {
        setScrollEdges({ left: false, right: tableHasHorizontalOverflow });
        return;
      }
      scroller.addEventListener('scroll', update, { passive: true });
      resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
      resizeObserver?.observe(scroller);
      update();
    };

    const frame = window.requestAnimationFrame(bind);
    return () => {
      window.cancelAnimationFrame(frame);
      if (scroller) scroller.removeEventListener('scroll', update);
      resizeObserver?.disconnect();
    };
  }, [tableHasHorizontalOverflow, tableMetrics.scrollX, filteredDocuments.length, columns.length]);

  const applyColumnPreset = (preset: Exclude<InvoiceColumnPreset, 'custom'>) => {
    setVisibleColumnKeys(INVOICE_COLUMN_PRESETS[preset].filter(key => !PUBLIC_HIDDEN_INVOICE_COLUMNS.has(key)));
    setColumnPreset(preset);
  };

  const handleVisibleColumnsChange = (values: Array<string | number | boolean>) => {
    const next = values.filter((value): value is InvoiceColumnKey =>
      typeof value === 'string' && ALL_INVOICE_COLUMN_KEYS.includes(value as InvoiceColumnKey));
    if (!next.length) {
      message.warning('Cần hiển thị ít nhất một cột dữ liệu.');
      return;
    }
    setVisibleColumnKeys(next);
    setColumnPreset('custom');
  };

  const hiddenColumnCount = INVOICE_COLUMN_CHOICES.length - publicVisibleColumnKeys.length;
  const columnChooser = (
    <div className="invoice-column-chooser" onClick={event => event.stopPropagation()}>
      <div className="invoice-column-chooser-heading">
        <Text strong>Cột thông tin hóa đơn</Text>
        <Text type="secondary">{publicVisibleColumnKeys.length}/{INVOICE_COLUMN_CHOICES.length} cột dữ liệu</Text>
      </div>
      <Text type="secondary" className="invoice-column-selection-note">
        Bố cục: {tableLayout.label} · vùng bảng {tableMetrics.viewportWidth}px. Cột mở chi tiết và chọn hóa đơn luôn cố định kích thước.
      </Text>
      <div className="invoice-column-presets" aria-label="Preset cột">
        {(Object.keys(INVOICE_COLUMN_PRESET_LABELS) as Array<Exclude<InvoiceColumnPreset, 'custom'>>).map(preset => (
          <Button
            key={preset}
            size="small"
            type={columnPreset === preset ? 'primary' : 'default'}
            onClick={() => applyColumnPreset(preset)}
          >
            {INVOICE_COLUMN_PRESET_LABELS[preset]}
          </Button>
        ))}
      </div>
      <Checkbox.Group
        className="invoice-column-checkboxes"
        value={publicVisibleColumnKeys}
        onChange={handleVisibleColumnsChange}
        options={INVOICE_COLUMN_CHOICES.map(item => ({ label: item.label, value: item.key }))}
      />
      <div className="invoice-column-chooser-actions">
        <Text type="secondary">{columnPreset === 'custom' ? 'Đang dùng cấu hình tùy chỉnh' : `Preset: ${INVOICE_COLUMN_PRESET_LABELS[columnPreset as Exclude<InvoiceColumnPreset, 'custom'>]}`}</Text>
        <Button size="small" onClick={() => applyColumnPreset('default')}>Khôi phục mặc định</Button>
      </div>
    </div>
  );



  return (
    <Space direction="vertical" className="hddt-page-stack invoice-page-stack" size="middle">
      {!authenticated && <Alert showIcon type="info" message="Đang làm việc ngoại tuyến" description="Bạn có thể xem, tổng hợp và xuất Excel. Đăng nhập GDT để truy vấn, lấy chi tiết hoặc tải XML/ZIP." />}
      <Card size="small" className="invoice-query-card">
        <Form
          form={form}
          layout="inline"
          className="invoice-query-form"
          onFinish={() => void queryPage()}
        >
          <div className="invoice-query-main-row">
            <Form.Item className="invoice-query-date">
              <RangePicker
                aria-label="Khoảng ngày tra cứu hóa đơn"
                value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
                format="DD/MM/YYYY"
                allowClear
                onChange={(dates) => setDateRange(dates?.[0] && dates?.[1] ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')] : null)}
              />
            </Form.Item>
            <Form.Item name="partnerTaxCode"><Input placeholder="MST đối tác" allowClear className="invoice-query-tax-code" /></Form.Item>
            <Form.Item name="invoiceNo"><Input placeholder="Số hóa đơn" allowClear className="invoice-query-invoice-no" /></Form.Item>
            <Form.Item name="series"><Input placeholder="Ký hiệu" allowClear className="invoice-query-series" /></Form.Item>

            <Form.Item className="invoice-query-primary-actions">
              <Space size={6} wrap>
                <Button htmlType="submit" type="primary" icon={<SearchOutlined />} loading={loading} disabled={!authenticated}>Tra cứu</Button>
                <Button icon={<ReloadOutlined />} loading={detailLoading} disabled={!authenticated} onClick={() => void loadDetails(false)}>Lấy chi tiết HHDV</Button>
                <Button loading={detailLoading} disabled={!authenticated} onClick={() => void loadDetails(true)}>Lấy chi tiết HHDV tất cả</Button>
                {(loading || detailLoading) && <Button danger icon={<StopOutlined />} onClick={stopCurrentOperation}>Dừng</Button>}
              </Space>
            </Form.Item>

            <Form.Item className="invoice-query-quick-filter">
              <Input
                prefix={<SearchOutlined />}
                placeholder="MST, tên đối tác, số HĐ…"
                aria-label="Tìm nhanh trong dữ liệu hóa đơn đang có"
                allowClear
                value={localText}
                onChange={(event) => setLocalText(event.target.value)}
              />
            </Form.Item>

            <Form.Item className="invoice-query-advanced-toggle">
              <Button
                type="text"
                icon={advancedOpen ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setAdvancedOpen(current => !current)}
              >
                Lọc nâng cao{advancedFilterCount ? ` (${advancedFilterCount})` : ''}
              </Button>
            </Form.Item>
          </div>

          {advancedOpen && (
            <div className="invoice-advanced-filter-panel" aria-label="Bộ lọc nâng cao">
              <Form.Item name="documentType" label="Loại / mẫu số truy vấn">
                <Input placeholder="Điều kiện gửi GDT" allowClear />
              </Form.Item>
              <div className="invoice-advanced-field">
                <Text className="invoice-advanced-label">Loại HĐ trong dữ liệu</Text>
                <Select
                  allowClear
                  showSearch
                  placeholder="Tất cả"
                  value={filters.type}
                  options={options.type}
                  onChange={(value) => setFilters(current => ({ ...current, type: value || undefined }))}
                />
              </div>
              <div className="invoice-advanced-field">
                <Text className="invoice-advanced-label">Tình trạng hóa đơn</Text>
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="Tất cả"
                  value={filters.invoiceStatuses}
                  options={options.invoiceStatuses}
                  onChange={(value) => setFilters(current => ({ ...current, invoiceStatuses: value.length ? value : undefined }))}
                />
              </div>
              <div className="invoice-advanced-field">
                <Text className="invoice-advanced-label">Trạng thái xử lý</Text>
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="Tất cả"
                  value={filters.processingStatuses}
                  options={options.processingStatuses}
                  onChange={(value) => setFilters(current => ({ ...current, processingStatuses: value.length ? value : undefined }))}
                />
              </div>
              <div className="invoice-advanced-field">
                <Text className="invoice-advanced-label">NCC HĐĐT</Text>
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="Tất cả"
                  value={filters.providerCodes}
                  options={options.providerCodes}
                  onChange={(value) => setFilters(current => ({ ...current, providerCodes: value.length ? value : undefined }))}
                />
              </div>
              <div className="invoice-advanced-field">
                <Text className="invoice-advanced-label">Chi tiết HHDV</Text>
                <Select
                  allowClear
                  placeholder="Tất cả"
                  value={filters.detail}
                  options={[{ value: 'has', label: 'Đã có detail' }, { value: 'missing', label: 'Chưa có detail' }]}
                  onChange={(value) => setFilters(current => ({ ...current, detail: (value || undefined) as InvoiceFilters['detail'] }))}
                />
              </div>
            </div>
          )}
        </Form>
        {activeFilterChips.length > 0 && (
          <div className="invoice-filter-chips" aria-label="Các bộ lọc đang áp dụng">
            <Text type="secondary" className="invoice-filter-chips-label">Đang lọc:</Text>
            {activeFilterChips.map(chip => (
              <Tag key={chip.key} closable onClose={(event) => { event.preventDefault(); chip.onClose(); }}>
                {chip.label}
              </Tag>
            ))}
            <Button type="link" size="small" onClick={clearLocalFilters}>Xóa tất cả</Button>
          </div>
        )}
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importJson} />
      </Card>

      <Modal
        title="Kết quả truy vấn gần nhất"
        open={resultModalOpen}
        onCancel={() => setResultModalOpen(false)}
        footer={<Button type="primary" onClick={() => setResultModalOpen(false)}>Đóng</Button>}
        width={820}
        destroyOnClose={false}
      >
        <Alert type={warnings.length ? 'warning' : 'success'} showIcon message={queryInfo || 'Chưa có kết quả truy vấn.'} />
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} style={{ marginTop: 12 }}>
          <Descriptions.Item label="GDT trả về">{lastQueryLoadedCount ?? 0} hóa đơn</Descriptions.Item>
          <Descriptions.Item label="Đã có trong dataset">{lastSyncStats?.existing ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Hóa đơn mới">{lastSyncStats?.newDocuments ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Đổi trạng thái">{lastSyncStats?.statusChanged ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Detail đã bỏ qua">{lastSyncStats?.detailSkipped ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Cũ nhưng thiếu detail">{lastSyncStats?.existingMissingDetail ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Phát hiện từ bù ttxly=6">{lastSyncStats?.ttxly6SupplementFound ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Trùng giữa các query">{lastSyncStats?.duplicateAcrossQueries ?? 0}</Descriptions.Item>
          <Descriptions.Item label="HĐ thay thế">{lastSyncStats?.replacementFound ?? 0}</Descriptions.Item>
          <Descriptions.Item label="HĐ điều chỉnh">{lastSyncStats?.adjustmentFound ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Gốc → đã bị thay thế">{lastSyncStats?.originalMarkedReplaced ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Gốc → đã bị điều chỉnh">{lastSyncStats?.originalMarkedAdjusted ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Dataset hiện tại">{documents.length} chứng từ</Descriptions.Item>
          <Descriptions.Item label="Frontend đang hiển thị">{filteredDocuments.length} chứng từ</Descriptions.Item>
          <Descriptions.Item label="Đang bị bộ lọc ẩn">{Math.max(0, documents.length - filteredDocuments.length)} chứng từ</Descriptions.Item>
          <Descriptions.Item label="Cảnh báo">{warnings.length}</Descriptions.Item>
        </Descriptions>
        {warnings.length > 0 && <div className="query-warning-list">{warnings.map((warning, index) => <div key={index}>{warning}</div>)}</div>}
      </Modal>
      <Modal
        open={Boolean(pdfViewer)}
        title={pdfViewer ? `Bản thể hiện hóa đơn · ${pdfViewer.title}` : 'Bản thể hiện hóa đơn'}
        onCancel={closePdfViewer}
        footer={(
          <Space>
            {pdfViewer && <Button type="primary" href={pdfViewer.url} download={`${pdfViewer.title || 'invoice'}.pdf`}>Tải PDF</Button>}
            <Button onClick={closePdfViewer}>Đóng</Button>
          </Space>
        )}
        width="96vw"
        destroyOnClose
        className="invoice-pdf-viewer-modal"
      >
        {pdfViewer && (
          <iframe
            title={pdfViewer.title}
            src={pdfViewer.url}
            className="invoice-pdf-viewer-frame"
          />
        )}
      </Modal>

      <Modal
        title={captchaFlow?.kind === 'batch' ? 'Xác thực để tiếp tục tải PDF' : 'Xác thực để xem PDF'}
        open={Boolean(captchaFlow)}
        onCancel={() => { setCaptchaFlow(null); setCaptchaAnswer(''); setCaptchaSliderTouched(false); }}
        onOk={() => void submitCurrentCaptcha()}
        okText="Xác thực & tiếp tục"
        cancelText="Hủy"
        confirmLoading={tvanBatchBusy || Boolean(tvanBusyKey)}
        destroyOnClose
      >
        {captchaFlow && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>Hoàn tất CAPTCHA để tiếp tục.</Text>
            {captchaFlow.challenge.kind === 'slider' ? (
              <div className="tvan-slider-captcha">
                {captchaFlow.challenge.imageBase64 ? (
                  <div className="tvan-slider-captcha-stage">
                    <img
                      src={`data:${captchaFlow.challenge.imageMimeType || 'image/png'};base64,${captchaFlow.challenge.imageBase64}`}
                      alt="Ảnh CAPTCHA"
                      className="tvan-slider-captcha-background"
                      onLoad={(event) => {
                        setCaptchaBackgroundWidth(event.currentTarget.naturalWidth || 0);
                        setCaptchaBackgroundHeight(event.currentTarget.naturalHeight || 0);
                      }}
                    />
                    {captchaFlow.challenge.pieceImageBase64 && captchaBackgroundWidth > 0 && captchaBackgroundHeight > 0 && captchaFlow.challenge.sliderY !== undefined ? (
                      <img
                        src={`data:${captchaFlow.challenge.pieceImageMimeType || 'image/png'};base64,${captchaFlow.challenge.pieceImageBase64}`}
                        alt="Mảnh ghép CAPTCHA"
                        className="tvan-slider-captcha-piece-overlay"
                        onLoad={(event) => setCaptchaPieceWidth(event.currentTarget.naturalWidth || 0)}
                        style={{
                          left: `${Math.min(100, Math.max(0, (captchaSliderValue / captchaBackgroundWidth) * 100))}%`,
                          top: `${Math.min(100, Math.max(0, (captchaFlow.challenge.sliderY / captchaBackgroundHeight) * 100))}%`,
                          width: `${Math.min(100, Math.max(1, ((captchaPieceWidth || 50) / captchaBackgroundWidth) * 100))}%`,
                        }}
                      />
                    ) : captchaSliderTouched && captchaBackgroundWidth > 0 ? (
                      <span
                        className="tvan-slider-captcha-position"
                        aria-hidden="true"
                        style={{
                          left: `${Math.min(100, Math.max(0, (captchaSliderValue / captchaBackgroundWidth) * 100))}%`,
                          width: `${Math.min(28, Math.max(4, ((captchaPieceWidth || 42) / captchaBackgroundWidth) * 100))}%`,
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <Alert type="error" showIcon message="Không tải được CAPTCHA. Hãy hủy và thử lại." />
                )}

                <Slider
                  min={0}
                  max={Math.max(1, captchaFlow.challenge.sliderMax ?? (captchaBackgroundWidth > 0 ? Math.max(1, captchaBackgroundWidth - captchaPieceWidth) : 280))}
                  value={captchaSliderValue}
                  tooltip={{ open: false }}
                  onChange={(value) => { setCaptchaSliderValue(value); setCaptchaSliderTouched(true); }}
                />
                <Text type="secondary">Kéo thanh trượt để khớp mảnh ghép.</Text>
              </div>
            ) : (
              <>
                {captchaFlow.challenge.imageBase64 && (
                  <img
                    src={`data:${captchaFlow.challenge.imageMimeType || 'image/png'};base64,${captchaFlow.challenge.imageBase64}`}
                    alt="CAPTCHA"
                    style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 6 }}
                  />
                )}
                <Input
                  autoFocus
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  onPressEnter={() => void submitCurrentCaptcha()}
                  placeholder="Nhập CAPTCHA"
                />
              </>
            )}
            {captchaFlow.kind === 'batch' && tvanBatchState && (
              <Text type="secondary">
                Đã tải {tvanBatchState.tasks.filter((task) => task.status === 'done').length}/{tvanBatchState.tasks.length} PDF.
              </Text>
            )}
          </Space>
        )}
      </Modal>

      <InvoiceSummaryBar
        visibleCount={filteredDocuments.length}
        datasetCount={documents.length}
        withDetailCount={withDetail}
        currencies={currencyTotals}
      />

      <div ref={tableContainer} className="invoice-table-shell">
        <Card
          size="small"
          className="invoice-table-card"
          title="Thông tin hóa đơn"
          extra={(
            <Popover trigger="click" placement="bottomRight" content={columnChooser}>
              <Button size="small" icon={<SettingOutlined />}>
                Cột hiển thị ({publicVisibleColumnKeys.length}/{INVOICE_COLUMN_CHOICES.length})
                {hiddenColumnCount > 0 ? ` · Ẩn ${hiddenColumnCount}` : ''}
              </Button>
            </Popover>
          )}
          bodyStyle={{ padding: 0 }}
        >
          {selectedDocuments.length > 0 && (
            <div className="invoice-selection-action-bar" role="status" aria-live="polite">
              <Text strong>Đã chọn {selectedDocuments.length.toLocaleString('vi-VN')} hóa đơn</Text>
              <Space size={6} wrap>
                <Button size="small" loading={detailLoading} disabled={!authenticated} onClick={() => void loadDetails(false)}>
                  Lấy chi tiết HHDV
                </Button>
                <Tooltip title="Lưu một dataset JSON độc lập chỉ gồm các hóa đơn đang chọn; không thay đổi dataset đầy đủ hiện tại">
                  <Button size="small" icon={<SaveOutlined />} onClick={() => void saveSelectedJson()}>
                    Lưu JSON ({selectedDocuments.length.toLocaleString('vi-VN')})
                  </Button>
                </Tooltip>
                <Button size="small" icon={<FileExcelOutlined />} onClick={() => void exportExcel()}>
                  Xuất Excel ({selectedDocuments.length.toLocaleString('vi-VN')})
                </Button>
                <Button size="small" disabled={!authenticated} onClick={() => void queueXml()}>
                  Tải XML ({selectedDocuments.length.toLocaleString('vi-VN')})
                </Button>
                <Button size="small" type="primary" icon={<FilePdfOutlined />} loading={tvanBatchBusy} onClick={() => void startTvanPdfBatch()}>
                  Tải PDF ({selectedDocuments.length.toLocaleString('vi-VN')})
                </Button>
                <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>Bỏ chọn</Button>
              </Space>
            </div>
          )}
          <div
            className={`invoice-table-scroll-affordance${scrollEdges.left ? ' can-scroll-left' : ''}${scrollEdges.right ? ' can-scroll-right' : ''}`}
            role="region"
            aria-label={direction === 'purchase' ? 'Danh sách hóa đơn mua vào' : 'Danh sách hóa đơn bán ra'}
          >
            <Table
              className={`invoice-data-table invoice-table-profile-${tableLayout.profile}`}
              style={{
                '--invoice-selection-width': `${tableLayout.selectionWidth}px`,
              } as React.CSSProperties}
              size="small"
              tableLayout="fixed"
              rowKey="key"
              columns={columns}
              dataSource={filteredDocuments}
              loading={loading || detailLoading}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={documents.length ? 'Không có hóa đơn phù hợp bộ lọc hiện tại' : 'Chưa có dữ liệu hóa đơn'}
                  >
                    {documents.length > 0 && activeFilterChips.length > 0 && (
                      <Button size="small" onClick={clearLocalFilters}>Xóa bộ lọc</Button>
                    )}
                  </Empty>
                ),
              }}
              pagination={false}
              virtual
              rowClassName={(_, index) => index % 2 === 0 ? 'invoice-row-even' : 'invoice-row-odd'}
              scroll={{ x: tableMetrics.scrollX, y: tableHeight }}
              rowSelection={{
                selectedRowKeys,
                onChange: setSelectedRowKeys,
                columnWidth: tableLayout.selectionWidth,
                fixed: tableHasHorizontalOverflow,
                align: 'center',
              }}
            />
          </div>
        </Card>
      </div>

      <InvoiceLinesModal invoice={linesModalDoc} onClose={() => setLinesModalDoc(null)} />
      <Suspense fallback={null}>
        <InvoiceDrawer document={drawerDoc} authenticated={authenticated} onClose={() => setDrawerDoc(null)} />
      </Suspense>
    </Space>
  );
}
