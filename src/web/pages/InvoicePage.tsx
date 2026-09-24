import { filterInvoices, typeOfInvoice, type InvoiceFilters } from './invoice-filters';
import {
  computeInvoiceTableMetrics,
  type InvoiceColumnKey,
} from './invoice-table-layout';
import {
  ALL_INVOICE_COLUMN_KEYS,
  INVOICE_COLUMN_PRESETS,
  INVOICE_COLUMN_PRESET_LABELS,
  loadInvoiceUiPreferences,
  loadInvoiceUiSessionState,
  saveInvoiceUiPreferences,
  saveInvoiceUiSessionState,
  type InvoiceColumnPreset,
} from './invoice-ui-preferences';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Slider,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  EditOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  StopOutlined,
  SwapOutlined,
  UpOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, downloadBlob, type AppStatus } from '../api/client';
import { localWorkspace } from '../storage/local-workspace';
import type {
  DatasetFile,
  InvoiceDocument,
  QueryAutoResult,
  TvanBatchState,
  TvanCaptchaChallenge,
  TvanCaptchaVerificationResult,
  TvanDownloadRequestPlan,
  TvanPresentationLinkResult,
  TvanSupervisedPrepareResult,
} from '../../shared/models/index.js';
import { mergeIncrementalDocuments, toExistingInvoiceRef } from '../../shared/incremental-sync/index.js';
import { solutionProviderDisplayOf, solutionProviderFriendlyName, solutionProviderTaxCodeOf } from '../../shared/solution-provider.js';
import { ACMAN_SOLUTION_TAX_CODE, presentationForSolutionTaxCode, PVOIL_SOLUTION_TAX_CODE, VNPT_SOLUTION_TAX_CODE } from '../../shared/provider-resolution.js';
import {
  buildInvoiceRelationContext,
  buildRelationViewModels,
} from '../../shared/invoice-relations/index.js';
import { InvoiceRelationTrigger } from '../components/invoices/InvoiceRelationPopover.js';
import { InvoiceSummaryBar, normalizeCurrencyCode } from '../components/invoices/InvoiceSummaryBar.js';
import { InvoiceLinesModal } from '../components/invoices/InvoiceLinesModal.js';
import TvanArtifactCard from '../components/TvanArtifactCard.js';
import EhoadonDientuPresentationCard, { ehoadonNeedsGdtXml, isEhoadonDientuInvoice } from '../components/EhoadonDientuPresentationCard.js';
import InvoiceProviderResearchPanel from '../components/InvoiceProviderResearchPanel.js';
import RawInvoiceJsonPanel from '../components/RawInvoiceJsonPanel.js';

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

const INVOICE_STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  '1': { label: 'Hóa đơn mới', color: 'green', icon: <CheckCircleOutlined /> },
  '2': { label: 'Hóa đơn thay thế', color: 'blue', icon: <SwapOutlined /> },
  '3': { label: 'Hóa đơn điều chỉnh', color: 'cyan', icon: <EditOutlined /> },
  '4': { label: 'Đã bị thay thế', color: 'orange', icon: <SwapOutlined /> },
  '5': { label: 'Đã bị điều chỉnh', color: 'orange', icon: <EditOutlined /> },
  '6': { label: 'Đã bị hủy', color: 'red', icon: <CloseCircleOutlined /> },
};

function invoiceStatusLabel(value: unknown): string {
  const code = String(value ?? '').trim();
  return INVOICE_STATUS_META[code]?.label || (code ? `Không rõ (${code})` : '—');
}

function renderInvoiceStatus(value: unknown) {
  const code = String(value ?? '').trim();
  const meta = INVOICE_STATUS_META[code];
  if (!code) return <Text type="secondary">—</Text>;
  const label = meta?.label || `Không rõ (${code})`;
  return (
    <Tag
      className="invoice-status-tag"
      color={meta?.color}
      icon={meta?.icon || <QuestionCircleOutlined />}
      title={label}
    >
      {label}
    </Tag>
  );
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
        const prepared = await api.prepareTvanPdfView(document);
        if (prepared.challenge) {
          setCaptchaAnswer('');
          setCaptchaFlow({ challenge: prepared.challenge, kind: 'view', document });
          return;
        }
      }
      message.error(error?.message || 'Không xem được PDF bản thể hiện.');
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
      message.warning(vnptNeedsGdtXml
        ? 'Hóa đơn VNPT chưa có Fkey trong dataset. Hãy đăng nhập GDT để backend tải XML và tìm mã tra cứu.'
        : acmanNeedsGdtXml
          ? 'Hóa đơn ACMAN chưa có mã tra cứu trong dataset. Hãy đăng nhập GDT để backend tải XML và tìm mã tra cứu.'
          : pvoilNeedsGdtXml
            ? 'Hóa đơn PVOIL chưa có Fkey trong dataset. Hãy đăng nhập GDT để backend tải XML và tìm mã tra cứu.'
            : 'Hóa đơn MSTTCGP 0314743623 cần đăng nhập GDT để tải XML trước khi xem PDF.');
      return;
    }
    setTvanBusyKey(document.key);
    try {
      const prepared = await api.prepareTvanPdfView(document);
      if (!prepared.capability.supported) {
        message.warning(prepared.capability.reason || `TVAN ${prepared.capability.providerCode} chưa hỗ trợ PDF.`);
        return;
      }
      if (prepared.challenge) {
        setCaptchaAnswer('');
        setCaptchaFlow({ challenge: prepared.challenge, kind: 'view', document });
        return;
      }
      await fetchAndOpenTvanPdf(document);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không chuẩn bị được bản thể hiện PDF.');
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
      if (failed) message.warning(`Đã tải ${done} PDF; ${failed} hóa đơn chưa tải được. Chi tiết có trong manifest.json.`);
      else message.success(`Đã tải đủ ${done} PDF theo thứ tự ưu tiên P1 → P2 → P3.`);
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
      return message.warning('Có hóa đơn cần XML GDT để xác định mã tra cứu PDF. Hãy đăng nhập GDT trước khi tải.');
    }
    setTvanBatchBusy(true);
    try {
      await finishTvanBatch(await api.startTvanPdfBatch(targets));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không khởi tạo được tải PDF hàng loạt.');
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
        await api.submitTvanCaptcha(current.challenge.id, answer);
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
      message.error(error instanceof Error ? error.message : 'CAPTCHA không hợp lệ hoặc đã hết hạn.');
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
  const tableMetrics = computeInvoiceTableMetrics(publicVisibleColumnKeys, tableViewportWidth);
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
        return (
          <InvoiceRelationTrigger
            document={record}
            model={relationModel}
            onOpenInvoice={openRelatedInvoice}
            className="invoice-relation-number-trigger"
          >
            <span
              className={`invoice-single-line-cell invoice-pdf-double-click${tvanBusyKey === record.key ? ' is-loading' : ''}`}
              title={text ? `${text} · Nhấp đúp để xem PDF bản thể hiện` : undefined}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void requestTvanPdfView(record);
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
          {(isEhoadonDientuInvoice(record) || Boolean(presentationForSolutionTaxCode(solutionProviderTaxCodeOf(record)))) && (
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
        title={captchaFlow?.kind === 'batch' ? 'Xác thực TVAN để tiếp tục tải PDF' : 'Xác thực TVAN để xem PDF'}
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
            <Alert
              type="info"
              showIcon
              message={`${captchaFlow.challenge.providerCode} · ${captchaFlow.challenge.kind === 'slider' ? 'CAPTCHA vị trí' : 'CAPTCHA'}`}
              description={captchaFlow.challenge.prompt}
            />
            {captchaFlow.challenge.kind === 'slider' ? (
              <div className="tvan-slider-captcha">
                {captchaFlow.challenge.imageBase64 ? (
                  <div className="tvan-slider-captcha-stage">
                    <img
                      src={`data:${captchaFlow.challenge.imageMimeType || 'image/png'};base64,${captchaFlow.challenge.imageBase64}`}
                      alt="Ảnh nền CAPTCHA Viettel"
                      className="tvan-slider-captcha-background"
                      onLoad={(event) => setCaptchaBackgroundWidth(event.currentTarget.naturalWidth || 0)}
                    />
                    {captchaSliderTouched && captchaBackgroundWidth > 0 && (
                      <span
                        className="tvan-slider-captcha-position"
                        aria-hidden="true"
                        style={{
                          left: `${Math.min(100, Math.max(0, (captchaSliderValue / captchaBackgroundWidth) * 100))}%`,
                          width: `${Math.min(28, Math.max(4, ((captchaPieceWidth || 42) / captchaBackgroundWidth) * 100))}%`,
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <Alert type="error" showIcon message="Không có ảnh CAPTCHA; vui lòng tải lại challenge." />
                )}
                {captchaFlow.challenge.pieceImageBase64 && (
                  <div className="tvan-slider-captcha-piece-row">
                    <Text type="secondary">Mảnh ghép:</Text>
                    <img
                      src={`data:${captchaFlow.challenge.pieceImageMimeType || 'image/png'};base64,${captchaFlow.challenge.pieceImageBase64}`}
                      alt="Mảnh ghép CAPTCHA Viettel"
                      className="tvan-slider-captcha-piece"
                      onLoad={(event) => setCaptchaPieceWidth(event.currentTarget.naturalWidth || 0)}
                    />
                    <Text type="secondary">Dải trên ảnh sẽ di chuyển theo thanh trượt để căn vị trí X.</Text>
                  </div>
                )}
                <Slider
                  min={0}
                  max={Math.max(1, captchaFlow.challenge.sliderMax ?? (captchaBackgroundWidth > 0 ? Math.max(1, captchaBackgroundWidth - captchaPieceWidth) : 280))}
                  value={captchaSliderValue}
                  tooltip={{ open: false }}
                  onChange={(value) => { setCaptchaSliderValue(value); setCaptchaSliderTouched(true); }}
                />
                <Text type="secondary">Kéo thanh trượt để khớp mảnh ghép; ứng dụng sẽ tự gửi vị trí cho Viettel.</Text>
              </div>
            ) : (
              <>
                {captchaFlow.challenge.imageBase64 && (
                  <img
                    src={`data:${captchaFlow.challenge.imageMimeType || 'image/png'};base64,${captchaFlow.challenge.imageBase64}`}
                    alt="TVAN CAPTCHA"
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
                Tiến độ: {tvanBatchState.tasks.filter((task) => task.status === 'done').length}/{tvanBatchState.tasks.length} PDF hoàn tất.
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
      <InvoiceDrawer document={drawerDoc} authenticated={authenticated} onClose={() => setDrawerDoc(null)} />
    </Space>
  );
}

function formatAmount(value: unknown, currency?: string): string {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const isVnd = normalizedCurrency === 'VND';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: isVnd ? 0 : 6,
  }).format(number);
}

function money(value: unknown): string {
  return formatAmount(value);
}

function partyDescription(party: any) {
  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="MST">{party?.taxCode || '—'}</Descriptions.Item>
      <Descriptions.Item label="Tên">{party?.name || '—'}</Descriptions.Item>
      <Descriptions.Item label="Địa chỉ">{party?.address || '—'}</Descriptions.Item>
      <Descriptions.Item label="Tài khoản NH">{party?.bankAccount || '—'}</Descriptions.Item>
      <Descriptions.Item label="Ngân hàng">{party?.bankName || '—'}</Descriptions.Item>
      <Descriptions.Item label="Điện thoại">{party?.phone || '—'}</Descriptions.Item>
      <Descriptions.Item label="Email">{party?.email || '—'}</Descriptions.Item>
    </Descriptions>
  );
}

function MisaPresentationCard({ document }: { document: InvoiceDocument }) {
  const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLocaleLowerCase();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TvanPresentationLinkResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(false);
    setResult(null);
    setError('');
  }, [document.key]);

  if (!providerCode.includes('misa')) return null;

  const lookupCode = result?.lookupCode || document.lookup?.lookupCode || '';
  const resolveLink = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.resolveTvanPresentationLink(document);
      setResult(response);
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : 'Không truy vấn được customData từ MISA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      size="small"
      title="Bản thể hiện hóa đơn · MISA (giám sát)"
      style={{ marginTop: 16 }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Luồng xác minh: Mã tra cứu → backend lấy customData → tạo link DownloadHandler. Link chỉ mở khi người dùng chủ động bấm."
        />
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Trạng thái">
            {loading ? (
              <Tag color="processing">Đang truy vấn customData</Tag>
            ) : result ? (
              <Tag color="success">Đã tạo link bản thể hiện</Tag>
            ) : error ? (
              <Tag color="error">Truy vấn lỗi</Tag>
            ) : (
              <Tag>Chưa truy vấn</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Mã tra cứu">
            {lookupCode || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="API truy vấn customData">
            {result ? `${result.metadataMethod} ${result.metadataUrl}` : 'Chưa truy vấn'}
          </Descriptions.Item>
          <Descriptions.Item label="Request body">
            {result?.metadataRequestBody || 'Chưa truy vấn'}
          </Descriptions.Item>
          <Descriptions.Item label="customData">
            {loading ? 'Đang truy vấn…' : result?.customData || 'Chưa truy vấn'}
          </Descriptions.Item>
          <Descriptions.Item label="Link truy vấn đầy đủ">
            {result?.downloadUrl ? (
              <Typography.Link
                href={result.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ overflowWrap: 'anywhere' }}
              >
                {result.downloadUrl}
              </Typography.Link>
            ) : 'Chưa tạo'}
          </Descriptions.Item>
          <Descriptions.Item label="Backend trả kết quả lúc">
            {result?.resolvedAt || '—'}
          </Descriptions.Item>
        </Descriptions>
        {result && (
          <div>
            <Text strong>Giám sát các bước backend</Text>
            <Space direction="vertical" size={4} style={{ display: 'flex', marginTop: 8 }}>
              {result.steps.map((step) => (
                <div key={step.stage}>
                  <Tag color={step.status === 'ready' ? 'blue' : 'green'}>{step.status.toUpperCase()}</Tag>
                  <Text>{step.label}</Text>
                  {step.value && <Text type="secondary"> — {step.value}</Text>}
                </div>
              ))}
            </Space>
          </div>
        )}
        {error && <Alert type="error" showIcon message={error} />}
        <Space wrap>
          <Button type="primary" loading={loading} onClick={() => void resolveLink()}>
            Xem bản thể hiện hóa đơn
          </Button>
          {result?.downloadUrl && (
            <Text type="secondary">
              Đã xác nhận customData. Bấm vào link phía trên để mở bản thể hiện trên tab mới.
            </Text>
          )}
        </Space>
      </Space>
    </Card>
  );
}

function InvoiceTvanPresentationCard({ document }: { document: InvoiceDocument }) {
  const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLocaleLowerCase();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TvanPresentationLinkResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(false);
    setResult(null);
    setError('');
  }, [document.key]);

  if (!(providerCode === 'tvan_invoice' || providerCode.includes('tvan_invoice'))) return null;

  const sellerTaxCode = result?.sellerTaxCode || document.seller?.taxCode || '';
  const securityCode = result?.securityCode || document.lookup?.lookupCode || '';
  const resolveLink = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.resolveTvanPresentationLink(document);
      setResult(response);
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : 'Không dựng được link PDF M-Invoice.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      size="small"
      title="Bản thể hiện hóa đơn · M-Invoice / tvan_invoice (giám sát)"
      style={{ marginTop: 16 }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Luồng xác minh: MST người bán + Số bảo mật → backend dựng URL SearchInvoice PDF → người dùng chủ động mở link trên tab mới."
          description="TVAN này không yêu cầu CAPTCHA/token. Backend không cần gửi mã bí mật nào ngoài chính Số bảo mật có sẵn trong payload hóa đơn."
        />
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Trạng thái">
            {loading ? (
              <Tag color="processing">Đang dựng link</Tag>
            ) : result ? (
              <Tag color="success">Đã dựng link bản thể hiện</Tag>
            ) : error ? (
              <Tag color="error">Có lỗi</Tag>
            ) : (
              <Tag>Chưa xác nhận</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="TVAN">tvan_invoice</Descriptions.Item>
          <Descriptions.Item label="MST TVAN / msttcgp">{result?.providerTaxCode || '0106026495'}</Descriptions.Item>
          <Descriptions.Item label="MST người bán / masothue">{sellerTaxCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Số bảo mật / sobaomat">
            {loading ? 'Đang đọc từ payload…' : securityCode || 'Chưa xác nhận từ backend'}
          </Descriptions.Item>
          <Descriptions.Item label="API bản thể hiện">
            {result ? `${result.metadataMethod} ${result.metadataUrl}` : 'Chưa dựng'}
          </Descriptions.Item>
          <Descriptions.Item label="Link truy vấn đầy đủ">
            {result?.downloadUrl ? (
              <Typography.Link
                href={result.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ overflowWrap: 'anywhere' }}
              >
                {result.downloadUrl}
              </Typography.Link>
            ) : 'Chưa tạo'}
          </Descriptions.Item>
          <Descriptions.Item label="Backend trả kết quả lúc">{result?.resolvedAt || '—'}</Descriptions.Item>
        </Descriptions>
        {result && (
          <div>
            <Text strong>Giám sát các bước backend</Text>
            <Space direction="vertical" size={4} style={{ display: 'flex', marginTop: 8 }}>
              {result.steps.map((step) => (
                <div key={`${step.stage}-${step.label}`}>
                  <Tag color={step.status === 'ready' ? 'blue' : 'green'}>{step.status.toUpperCase()}</Tag>
                  <Text>{step.label}</Text>
                  {step.value && <Text type="secondary"> — {step.value}</Text>}
                </div>
              ))}
            </Space>
          </div>
        )}
        {error && <Alert type="error" showIcon message={error} />}
        <Space wrap>
          <Button type="primary" loading={loading} onClick={() => void resolveLink()}>
            Xem bản thể hiện hóa đơn
          </Button>
          {result?.downloadUrl && (
            <Text type="secondary">Bấm link phía trên để mở PDF trực tiếp trên tab mới.</Text>
          )}
        </Space>
      </Space>
    </Card>
  );
}


function SoftdreamsPresentationCard({ document }: { document: InvoiceDocument }) {
  const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLocaleLowerCase();
  const [prepare, setPrepare] = useState<TvanSupervisedPrepareResult | null>(null);
  const [verification, setVerification] = useState<TvanCaptchaVerificationResult | null>(null);
  const [downloadPlan, setDownloadPlan] = useState<TvanDownloadRequestPlan | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [busy, setBusy] = useState<'captcha' | 'verify' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setPrepare(null);
    setVerification(null);
    setDownloadPlan(null);
    setCaptchaAnswer('');
    setBusy(null);
    setError('');
  }, [document.key]);

  if (!(providerCode === 'tvan_softdreams' || providerCode.includes('softdreams'))) return null;

  const challenge = prepare?.challenge;
  const portalUrl = prepare?.lookup.portalUrl
    || downloadPlan?.lookup.portalUrl
    || document.lookup?.lookupBaseUrl
    || '';
  const fkey = prepare?.lookup.fkey
    || downloadPlan?.lookup.fkey
    || document.lookup?.lookupCode
    || '';
  const sellerTaxCode = prepare?.lookup.sellerTaxCode
    || downloadPlan?.lookup.sellerTaxCode
    || document.seller?.taxCode
    || '';
  const providerTaxCode = prepare?.lookup.providerTaxCode
    || downloadPlan?.lookup.providerTaxCode
    || '0105987432';

  const requestCaptcha = async () => {
    setBusy('captcha');
    setError('');
    setVerification(null);
    setDownloadPlan(null);
    setCaptchaAnswer('');
    try {
      const next = await api.prepareTvanSupervised(document);
      setPrepare(next);
      if (!next.challenge) setError('SoftDreams chưa trả ảnh CAPTCHA hợp lệ.');
    } catch (requestError) {
      setPrepare(null);
      setError(requestError instanceof Error ? requestError.message : 'Không lấy được CAPTCHA SoftDreams.');
    } finally {
      setBusy(null);
    }
  };

  const verifyAndBuildLink = async () => {
    if (!challenge) return;
    if (!captchaAnswer.trim()) {
      setError('Hãy nhập mã xác thực trên ảnh EasyInvoice.');
      return;
    }
    setBusy('verify');
    setError('');
    try {
      const verified = await api.submitTvanCaptcha(challenge.id, captchaAnswer.trim());
      setVerification(verified);
      const plan = await api.describeTvanDownloadRequest(document);
      setDownloadPlan(plan);
      if (!plan.tokenReady) setError('Backend chưa tạo được fileGuid/fileName từ SoftDreams.');
    } catch (requestError) {
      setVerification(null);
      setDownloadPlan(null);
      setError(requestError instanceof Error ? requestError.message : 'SoftDreams từ chối CAPTCHA hoặc chưa trả link tải.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      size="small"
      title="Bản thể hiện hóa đơn · SoftDreams EasyInvoice (giám sát)"
      style={{ marginTop: 16 }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Luồng production quan sát được: Portal + Fkey → CAPTCHA → Search/Search → token + HTML → tạo fileGuid/fileName → link /Invoice/Download."
          description="Token, HTML hóa đơn và cookie phiên chỉ nằm ở backend. Giao diện chỉ hiển thị Portal, mã tra cứu và link tải cuối cùng."
        />
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="TVAN">tvan_softdreams</Descriptions.Item>
          <Descriptions.Item label="MST TVAN / msttcgp">{providerTaxCode}</Descriptions.Item>
          <Descriptions.Item label="MST người bán">{sellerTaxCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Portal">
            {portalUrl ? (
              <Typography.Link href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>
                {portalUrl}
              </Typography.Link>
            ) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Mã tra cứu / Fkey">{fkey || '—'}</Descriptions.Item>
          <Descriptions.Item label="Endpoint CAPTCHA">
            {prepare?.challengeRequest?.endpoint || (portalUrl ? `${portalUrl}/Captcha/Show` : '—')}
          </Descriptions.Item>
          <Descriptions.Item label="Trạng thái">
            {downloadPlan?.tokenReady ? (
              <Tag color="success">Đã tạo link tải</Tag>
            ) : verification ? (
              <Tag color="processing">Đã xác thực, đang chờ link</Tag>
            ) : challenge ? (
              <Tag color="blue">Đã nhận CAPTCHA</Tag>
            ) : error ? (
              <Tag color="error">Có lỗi</Tag>
            ) : (
              <Tag>Chưa xử lý</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="fileGuid">{downloadPlan?.lookup.fileGuid || 'Chưa tạo'}</Descriptions.Item>
          <Descriptions.Item label="fileName">{downloadPlan?.lookup.fileName || 'Chưa tạo'}</Descriptions.Item>
          <Descriptions.Item label="Link tải hóa đơn">
            {downloadPlan?.tokenReady && downloadPlan.endpoint ? (
              <Typography.Link
                href={downloadPlan.endpoint}
                target="_blank"
                rel="noopener noreferrer"
                style={{ overflowWrap: 'anywhere' }}
              >
                {downloadPlan.endpoint}
              </Typography.Link>
            ) : 'Chưa tạo'}
          </Descriptions.Item>
        </Descriptions>

        {challenge && (
          <Card size="small" type="inner" title="CAPTCHA EasyInvoice">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text>{challenge.prompt}</Text>
              {challenge.imageBase64 ? (
                <img
                  src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
                  alt="CAPTCHA SoftDreams EasyInvoice"
                  style={{ maxWidth: 320, maxHeight: 140, objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 6 }}
                />
              ) : <Alert type="error" showIcon message="Challenge không có ảnh CAPTCHA." />}
              <Input
                value={captchaAnswer}
                onChange={(event) => setCaptchaAnswer(event.target.value)}
                onPressEnter={() => void verifyAndBuildLink()}
                placeholder="Nhập mã xác thực"
                style={{ maxWidth: 320 }}
              />
            </Space>
          </Card>
        )}

        {downloadPlan?.tokenReady && (
          <Alert
            type="success"
            showIcon
            message="Đã dựng link tải production từ fileGuid + fileName."
            description={`Định dạng phía SoftDreams: ${downloadPlan.lookup.archiveFormat || 'không xác định'}. Backend có thể lấy ZIP và trích PDF khi dùng luồng xem PDF nội bộ.`}
          />
        )}
        {error && <Alert type="error" showIcon message={error} />}
        <Space wrap>
          <Button loading={busy === 'captcha'} onClick={() => void requestCaptcha()}>
            1. Lấy CAPTCHA SoftDreams
          </Button>
          <Button
            type="primary"
            disabled={!challenge || Boolean(downloadPlan?.tokenReady)}
            loading={busy === 'verify'}
            onClick={() => void verifyAndBuildLink()}
          >
            2. Xác thực & tạo link tải
          </Button>
        </Space>
      </Space>
    </Card>
  );
}

function ViettelPresentationCard({ document }: { document: InvoiceDocument }) {
  const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLocaleLowerCase();
  const [prepare, setPrepare] = useState<TvanSupervisedPrepareResult | null>(null);
  const [verification, setVerification] = useState<TvanCaptchaVerificationResult | null>(null);
  const [downloadPlan, setDownloadPlan] = useState<TvanDownloadRequestPlan | null>(null);
  const [busy, setBusy] = useState<'captcha' | 'verify' | 'pdf' | null>(null);
  const [error, setError] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const [sliderTouched, setSliderTouched] = useState(false);
  const [backgroundWidth, setBackgroundWidth] = useState(0);
  const [pieceWidth, setPieceWidth] = useState(0);
  const [pdfResult, setPdfResult] = useState<{ size: number; type: string; openedAt: string; objectUrl?: string } | null>(null);

  useEffect(() => {
    setPrepare(null);
    setVerification(null);
    setDownloadPlan(null);
    setBusy(null);
    setError('');
    setCaptchaAnswer('');
    setSliderValue(0);
    setSliderTouched(false);
    setBackgroundWidth(0);
    setPieceWidth(0);
    setPdfResult((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }, [document.key]);

  useEffect(() => () => {
    if (pdfResult?.objectUrl) URL.revokeObjectURL(pdfResult.objectUrl);
  }, [pdfResult?.objectUrl]);

  if (!providerCode.includes('viettel')) return null;

  const sellerTaxCode = prepare?.lookup.supplierTaxCode || downloadPlan?.lookup.supplierTaxCode || document.seller?.taxCode || '';
  const reservationCode = prepare?.lookup.reservationCode || downloadPlan?.lookup.reservationCode || document.lookup?.lookupCode || '';
  const challenge = prepare?.challenge;
  const probeAttempt = prepare?.captchaProbe?.attempts.find((attempt) => attempt.responseStatus === 200)
    || prepare?.captchaProbe?.attempts[0];
  const isSlider = challenge?.kind === 'slider';

  const requestCaptcha = async () => {
    setBusy('captcha');
    setError('');
    setVerification(null);
    setDownloadPlan(null);
    setPdfResult((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
    try {
      const response = await api.prepareTvanSupervised(document);
      setPrepare(response);
      setCaptchaAnswer('');
      setSliderValue(response.challenge?.sliderStart ?? 0);
      setSliderTouched(false);
      setBackgroundWidth(0);
      setPieceWidth(0);
    } catch (requestError) {
      setPrepare(null);
      setError(requestError instanceof Error ? requestError.message : 'Không lấy được CAPTCHA Viettel.');
    } finally {
      setBusy(null);
    }
  };

  const verifyCaptcha = async () => {
    if (!challenge) return;
    if (isSlider && !sliderTouched) {
      setError('Hãy kéo thanh trượt đến vị trí CAPTCHA trước khi xác thực.');
      return;
    }
    if (!isSlider && !captchaAnswer.trim()) {
      setError('Nhập CAPTCHA trước khi xác thực.');
      return;
    }
    setBusy('verify');
    setError('');
    try {
      const answer = isSlider ? String(Math.round(sliderValue)) : captchaAnswer.trim();
      const verified = await api.submitTvanCaptcha(challenge.id, answer);
      setVerification(verified);
      const plan = await api.describeTvanDownloadRequest(document);
      setDownloadPlan(plan);
      if (!plan.tokenReady) setError('Backend chưa ghi nhận token phiên Viettel sau khi xác thực CAPTCHA.');
    } catch (requestError) {
      setVerification(null);
      setDownloadPlan(null);
      setError(requestError instanceof Error ? requestError.message : 'Viettel từ chối CAPTCHA.');
    } finally {
      setBusy(null);
    }
  };

  const openPdf = async () => {
    if (!downloadPlan?.tokenReady) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) {
      try {
        popup.document.title = 'Đang tải bản thể hiện Viettel';
        popup.document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Đang tải bản thể hiện PDF từ Viettel qua backend HDDT…</p>';
      } catch { /* cross-window initialization is best effort only */ }
    }
    setBusy('pdf');
    setError('');
    try {
      const blob = await api.viewTvanPdf(document);
      const objectUrl = URL.createObjectURL(blob);
      setPdfResult((current) => {
        if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
        return { size: blob.size, type: blob.type || 'application/pdf', openedAt: new Date().toISOString(), objectUrl };
      });
      if (popup) popup.location.replace(objectUrl);
    } catch (requestError) {
      if (popup) popup.close();
      setError(requestError instanceof Error ? requestError.message : 'Không tải được PDF Viettel.');
    } finally {
      setBusy(null);
    }
  };

  const challengeMax = Math.max(
    1,
    challenge?.sliderMax ?? (backgroundWidth > 0 ? Math.max(1, backgroundWidth - pieceWidth) : 280),
  );

  return (
    <Card
      size="small"
      title="Bản thể hiện hóa đơn · Viettel (giám sát)"
      style={{ marginTop: 16 }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Luồng xác minh: MST + Mã số bí mật → lấy CAPTCHA → xác thực offsetX → backend giữ token phiên → dựng request downloadPDF → người dùng chủ động mở PDF."
          description="Token CAPTCHA/challenge thật không hiển thị ở frontend; request giám sát chỉ hiển thị token đã che."
        />
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Trạng thái">
            {busy ? (
              <Tag color="processing">{busy === 'captcha' ? 'Đang lấy CAPTCHA' : busy === 'verify' ? 'Đang xác thực CAPTCHA' : 'Đang tải PDF'}</Tag>
            ) : pdfResult ? (
              <Tag color="success">PDF đã được backend xác nhận</Tag>
            ) : verification ? (
              <Tag color="blue">CAPTCHA đã xác thực · token phiên sẵn sàng</Tag>
            ) : prepare?.challenge ? (
              <Tag color="gold">Đã lấy CAPTCHA · chờ xác thực</Tag>
            ) : prepare?.captchaProbe?.status === 'token_only' ? (
              <Tag color="warning">Đã probe · token-only · chưa có ảnh</Tag>
            ) : prepare ? (
              <Tag color="error">Probe CAPTCHA chưa hoàn tất</Tag>
            ) : error ? (
              <Tag color="error">Có lỗi</Tag>
            ) : (
              <Tag>Chưa bắt đầu</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="MST người bán / supplierTaxCode">{sellerTaxCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Mã tra cứu / reservationCode">{reservationCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="API cấp CAPTCHA">
            {prepare?.challengeRequest
              ? `${prepare.challengeRequest.method} ${prepare.challengeRequest.endpoint}`
              : probeAttempt
                ? `${probeAttempt.method} ${probeAttempt.endpoint}`
                : 'Chưa truy vấn'}
          </Descriptions.Item>
          <Descriptions.Item label="Body request CAPTCHA">{prepare?.challengeRequest?.requestBody || probeAttempt?.requestBody || '— (GET)'}</Descriptions.Item>
          <Descriptions.Item label="HTTP CAPTCHA">{prepare?.challengeRequest?.responseStatus ?? probeAttempt?.responseStatus ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="API xác thực CAPTCHA">
            {verification?.verificationRequest
              ? `${verification.verificationRequest.method} ${verification.verificationRequest.endpoint}`
              : 'Chưa xác thực'}
          </Descriptions.Item>
          <Descriptions.Item label="Body verify (token đã che)">
            {verification?.verificationRequest?.requestBody || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Token phiên hết hạn">{verification?.tokenExpiresAt || '—'}</Descriptions.Item>
          <Descriptions.Item label="API tải PDF">
            {downloadPlan ? `${downloadPlan.method} ${downloadPlan.endpoint}` : 'Chưa dựng request'}
          </Descriptions.Item>
          <Descriptions.Item label="Body downloadPDF (token đã che)">
            {downloadPlan?.requestBody || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Token backend sẵn sàng">
            {downloadPlan ? (downloadPlan.tokenReady ? <Tag color="success">Có</Tag> : <Tag color="error">Không</Tag>) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Kết quả PDF">
            {pdfResult
              ? `${pdfResult.type} · ${new Intl.NumberFormat('vi-VN').format(pdfResult.size)} bytes · ${pdfResult.openedAt}`
              : 'Chưa tải'}
          </Descriptions.Item>
          <Descriptions.Item label="Mở lại PDF cục bộ">
            {pdfResult?.objectUrl ? (
              <Typography.Link href={pdfResult.objectUrl} target="_blank" rel="noopener noreferrer">
                Mở bản thể hiện đã tải ở tab mới
              </Typography.Link>
            ) : '—'}
          </Descriptions.Item>
        </Descriptions>

        {prepare?.captchaProbe && (
          <Card size="small" type="inner" title="Probe CAPTCHA production">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Alert
                type={prepare.captchaProbe.status === 'challenge_ready' ? 'success' : prepare.captchaProbe.status === 'token_only' ? 'warning' : 'error'}
                showIcon
                message={prepare.captchaProbe.status === 'challenge_ready'
                  ? 'Đã tìm được token + ảnh CAPTCHA'
                  : prepare.captchaProbe.status === 'token_only'
                    ? 'Viettel trả token nhưng response chưa có ảnh CAPTCHA nhận diện được'
                    : 'Chưa lấy được challenge CAPTCHA'}
                description={prepare.captchaProbe.note}
              />
              {prepare.captchaProbe.attempts.map((attempt, index) => (
                <Card key={`${attempt.endpoint}-${index}`} size="small" title={`${index + 1}. ${attempt.method} ${attempt.endpoint}`}>
                  <Descriptions bordered size="small" column={1}>
                    <Descriptions.Item label="HTTP">{attempt.responseStatus ?? 'network/error'}</Descriptions.Item>
                    <Descriptions.Item label="Content-Type">{attempt.responseContentType || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Có token (đã che)">{attempt.tokenPresent ? <Tag color="success">Có</Tag> : <Tag>Không</Tag>}</Descriptions.Item>
                    <Descriptions.Item label="Ứng viên ảnh">{attempt.imageCandidateCount ?? 0}</Descriptions.Item>
                    <Descriptions.Item label="Set-Cookie">{attempt.setCookieNames?.length ? attempt.setCookieNames.join(', ') : '—'}</Descriptions.Item>
                    <Descriptions.Item label="Response keys">
                      {attempt.responseKeys?.length ? <Text code>{attempt.responseKeys.join(', ')}</Text> : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Raw response đã che token">
                      {attempt.responsePreview ? (
                        <Paragraph copyable={{ text: attempt.responsePreview }} style={{ marginBottom: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          <Text code>{attempt.responsePreview}</Text>
                        </Paragraph>
                      ) : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Ghi chú">{attempt.note || '—'}</Descriptions.Item>
                  </Descriptions>
                </Card>
              ))}
            </Space>
          </Card>
        )}

        {prepare && !challenge && prepare.captchaProbe?.status === 'token_only' && (
          <Alert
            type="warning"
            showIcon
            message="Dừng trước bước nhập offsetX: chưa có ảnh CAPTCHA"
            description="Không cần vào TVAN Backport thủ công ở bước này. Hãy copy phần Raw response đã che token trong Probe CAPTCHA production; dữ liệu đó đủ để map schema ảnh ở revision tiếp theo."
          />
        )}

        {challenge && (
          <Card size="small" type="inner" title="CAPTCHA Viettel">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text>{challenge.prompt}</Text>
              {challenge.kind === 'slider' ? (
                <div className="tvan-slider-captcha">
                  {challenge.imageBase64 ? (
                    <div className="tvan-slider-captcha-stage">
                      <img
                        src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
                        alt="Ảnh nền CAPTCHA Viettel"
                        className="tvan-slider-captcha-background"
                        onLoad={(event) => setBackgroundWidth(event.currentTarget.naturalWidth || 0)}
                      />
                      {sliderTouched && backgroundWidth > 0 && (
                        <span
                          className="tvan-slider-captcha-position"
                          aria-hidden="true"
                          style={{
                            left: `${Math.min(100, Math.max(0, (sliderValue / backgroundWidth) * 100))}%`,
                            width: `${Math.min(28, Math.max(4, ((pieceWidth || 42) / backgroundWidth) * 100))}%`,
                          }}
                        />
                      )}
                    </div>
                  ) : <Alert type="error" showIcon message="Challenge không có ảnh CAPTCHA." />}
                  {challenge.pieceImageBase64 && (
                    <div className="tvan-slider-captcha-piece-row">
                      <Text type="secondary">Mảnh ghép:</Text>
                      <img
                        src={`data:${challenge.pieceImageMimeType || 'image/png'};base64,${challenge.pieceImageBase64}`}
                        alt="Mảnh ghép CAPTCHA Viettel"
                        className="tvan-slider-captcha-piece"
                        onLoad={(event) => setPieceWidth(event.currentTarget.naturalWidth || 0)}
                      />
                    </div>
                  )}
                  <Slider
                    min={0}
                    max={challengeMax}
                    value={sliderValue}
                    tooltip={{ open: true, formatter: (value) => `${value ?? 0}px` }}
                    onChange={(value) => { setSliderValue(value); setSliderTouched(true); }}
                  />
                  <Text type="secondary">offsetX sẽ gửi: {sliderTouched ? Math.round(sliderValue) : 'chưa chọn'} px</Text>
                </div>
              ) : (
                <>
                  {challenge.imageBase64 && (
                    <img
                      src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
                      alt="CAPTCHA Viettel"
                      style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 6 }}
                    />
                  )}
                  <Input value={captchaAnswer} onChange={(event) => setCaptchaAnswer(event.target.value)} placeholder="Nhập CAPTCHA" />
                </>
              )}
            </Space>
          </Card>
        )}

        {error && <Alert type="error" showIcon message={error} />}
        <Space wrap>
          <Button loading={busy === 'captcha'} onClick={() => void requestCaptcha()}>
            1. Lấy CAPTCHA Viettel
          </Button>
          <Button
            type="primary"
            disabled={!challenge || Boolean(verification)}
            loading={busy === 'verify'}
            onClick={() => void verifyCaptcha()}
          >
            2. Xác thực CAPTCHA
          </Button>
          <Button
            type="primary"
            disabled={!downloadPlan?.tokenReady}
            loading={busy === 'pdf'}
            onClick={() => void openPdf()}
          >
            3. Mở bản thể hiện PDF
          </Button>
        </Space>
      </Space>
    </Card>
  );
}

function InvoiceDrawer({ document, authenticated, onClose }: { document: any | null; authenticated: boolean; onClose: () => void }) {
  if (!document) return null;
  const dynamicFields = [
    ...(document.dynamicFields || []),
    ...(document.seller?.dynamicFields || []),
    ...(document.buyer?.dynamicFields || []),
    ...(document.lines || []).flatMap((line: any) => line.dynamicFields || []),
  ].filter((field: any) => !/(fkey|portal.?link|fileguid|cookie|authorization|access.?token|rawsummary|rawdetail|provider.?detect|debug|url)/i.test(String(field?.name || '')));
  const lines = (
    <Table size="small" rowKey={(_, index) => String(index)} pagination={false} scroll={{ x: 900 }} dataSource={document.lines || []} columns={[
      { title: 'STT', dataIndex: 'lineNo', width: 60 },
      { title: 'Tên hàng hóa/dịch vụ', dataIndex: 'itemName', width: 260 },
      { title: 'ĐVT', dataIndex: 'unit', width: 80 },
      { title: 'SL', dataIndex: 'quantity', width: 90, render: money },
      { title: 'Đơn giá', dataIndex: 'unitPrice', width: 120, render: money },
      { title: 'Thành tiền', dataIndex: 'amount', width: 130, render: money },
      { title: 'VAT', dataIndex: 'vatRateText', width: 80 },
      { title: 'Tiền thuế', dataIndex: 'vatAmount', width: 120, render: money },
      { title: 'Chiết khấu', dataIndex: 'discountAmount', width: 120, render: money },
    ]} />
  );
  return (
    <Drawer title={`Chi tiết hóa đơn ${document.series || ''} ${document.invoiceNo || ''}`} width="min(1000px, 94vw)" open onClose={onClose}>
      <Tabs items={[
        { key: 'overview', label: 'Tổng quan', children: <>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="Key" span={2}>{document.key}</Descriptions.Item>
            <Descriptions.Item label="Nguồn">{document.invoiceSource === 'pos' ? 'Máy tính tiền' : 'HĐĐT thường'}</Descriptions.Item>
            <Descriptions.Item label="Ngày lập">{document.issueDate || '—'}</Descriptions.Item>
            <Descriptions.Item label="Loại">{document.documentTypeName || document.documentTypeCode || '—'}</Descriptions.Item>
            <Descriptions.Item label="Mẫu số">{String(document.templateNo ?? '—')}</Descriptions.Item>
            <Descriptions.Item label="Ký hiệu">{document.series || '—'}</Descriptions.Item>
            <Descriptions.Item label="Số hóa đơn">{String(document.invoiceNo ?? '—')}</Descriptions.Item>
            <Descriptions.Item label="Tiền tệ">{document.currency || '—'}</Descriptions.Item>
            <Descriptions.Item label="Tình trạng hóa đơn">{renderInvoiceStatus(document.invoiceStatus)}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái xử lý">{String(document.processingStatus ?? '—')}</Descriptions.Item>
            <Descriptions.Item label="Tổng thanh toán">{money(document.grandTotal)}</Descriptions.Item>
          </Descriptions>
          <MisaPresentationCard document={document as InvoiceDocument} />
          <InvoiceTvanPresentationCard document={document as InvoiceDocument} />
          <ViettelPresentationCard document={document as InvoiceDocument} />
          <EhoadonDientuPresentationCard document={document as InvoiceDocument} authenticated={authenticated} />
          <TvanArtifactCard document={document as InvoiceDocument} />
        </> },
        { key: 'seller', label: 'Người bán', children: partyDescription(document.seller) },
        { key: 'buyer', label: 'Người mua', children: partyDescription(document.buyer) },
        { key: 'lines', label: `Hàng hóa (${document.lines?.length || 0})`, children: lines },
        { key: 'tax', label: 'Thuế & tổng tiền', children: <><Table size="small" rowKey={(_, index) => String(index)} pagination={false} dataSource={document.taxSummaries || []} columns={[
          { title: 'Thuế suất', dataIndex: 'vatRateText' },
          { title: 'Tiền chịu thuế', dataIndex: 'taxableAmount', render: money },
          { title: 'Tiền thuế', dataIndex: 'vatAmount', render: money },
        ]} /><Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
          <Descriptions.Item label="Trước thuế">{money(document.subtotal)}</Descriptions.Item>
          <Descriptions.Item label="Thuế">{money(document.vatAmount)}</Descriptions.Item>
          <Descriptions.Item label="Chiết khấu">{money(document.discountAmount)}</Descriptions.Item>
          <Descriptions.Item label="Tổng tiền">{money(document.grandTotal)}</Descriptions.Item>
        </Descriptions></> },
        { key: 'provider-research', label: 'Tra cứu & NCC HĐĐT', children: <InvoiceProviderResearchPanel document={document as InvoiceDocument} authenticated={authenticated} /> },
        { key: 'dynamic', label: `Trường mở rộng (${dynamicFields.length})`, children: <Table size="small" rowKey={(_, index) => String(index)} pagination={{ pageSize: 50 }} dataSource={dynamicFields} columns={[
          { title: 'Section', dataIndex: 'section', width: 130 },
          { title: 'Tên', dataIndex: 'name', width: 220 },
          { title: 'Kiểu', dataIndex: 'dataType', width: 100 },
          { title: 'Giá trị', dataIndex: 'rawValue', render: (value: unknown) => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '') },
        ]} /> },
        { key: 'raw-json', label: 'Raw JSON', children: <RawInvoiceJsonPanel document={document as InvoiceDocument} /> },
      ]} />
    </Drawer>
  );
}
