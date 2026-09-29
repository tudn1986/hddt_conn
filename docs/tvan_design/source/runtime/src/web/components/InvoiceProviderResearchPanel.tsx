import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Slider, Space, Tag, Typography } from 'antd';
import type { InvoiceDocument, PresentationStatusResult, TvanCaptchaChallenge, TvanPresentationLinkResult } from '../../shared/models/index.js';
import { providerResearchFor } from '../../shared/provider-research.js';
import { api, downloadBlob, type TvanArtifactInfo } from '../api/client';

const { Link, Text } = Typography;

const PUBLIC_PROVIDER_NAMES = new Set([
  'MISA',
  'VIETTEL',
  'SOFTDREAMS',
  'PVOIL',
  'M-INVOICE',
  'EHOADONDIENTU',
  'VNPT',
  'ACMAN',
  'FAST',
  'THÁI SƠN',
]);

const CAPTCHA_PROVIDER_NAMES = new Set([
  'VIETTEL',
  'SOFTDREAMS',
  'PVOIL',
  'VNPT',
  'FAST',
  'THÁI SƠN',
]);

const PROVIDER_NAME_BY_CODE: Record<string, string> = {
  tvan_misa: 'MISA',
  tvan_viettel: 'VIETTEL',
  tvan_softdreams: 'SOFTDREAMS',
  tvan_pvoil: 'PVOIL',
  tvan_invoice: 'M-INVOICE',
  ehoadondientu: 'EHOADONDIENTU',
  tvan_vnpt: 'VNPT',
  tvan_acman: 'ACMAN',
  tvan_fast: 'FAST',
  tvan_thaison: 'THÁI SƠN',
};

const RESOLVE_LINK_PROVIDER_NAMES = new Set([
  'MISA',
  'SOFTDREAMS',
  'M-INVOICE',
  'VNPT',
  'ACMAN',
]);

function providerNameOf(document: InvoiceDocument, researchName?: string): string {
  const known = String(researchName || '').trim().toLocaleUpperCase('vi-VN');
  if (known) return known;
  const code = String(
    document.providers?.presentation?.adapterCode
      || document.providerCode
      || document.lookup?.providerCode
      || '',
  ).trim().toLocaleLowerCase('vi-VN');
  return PROVIDER_NAME_BY_CODE[code] || 'Chưa xác định';
}

function portalRoot(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

type PresentationBusy = 'prepare' | 'view' | 'pdf' | 'original' | null;

type PresentationUiError = {
  message: string;
  preserveContext?: boolean;
  retryStage?: string;
};

function presentationErrorOf(error: unknown, fallback: string): PresentationUiError {
  if (!(error instanceof Error)) return { message: fallback };
  const candidate = error as Error & { preserveContext?: boolean; retryStage?: string };
  return {
    message: candidate.message || fallback,
    preserveContext: candidate.preserveContext,
    retryStage: candidate.retryStage,
  };
}

type LookupCodeCandidate = {
  value: string;
  type: string;
};

type LookupUrlCandidate = {
  url: string;
  type: string;
};

const LOOKUP_URL_NAMES_BY_PROVIDER: Record<string, string[]> = {
  SOFTDREAMS: ['PortalLink', 'Portal Link', 'portalLink'],
  VNPT: ['PortalLink', 'Portal Link', 'portalLink', 'lookupUrl', 'LookupUrl', 'PATH'],
  EHOADONDIENTU: ['PortalLink', 'portalLink', 'lookupUrl', 'LookupUrl'],
  'THÁI SƠN': ['DC TC', 'ĐC TC', 'Dia chi TC'],
};

const GENERIC_LOOKUP_URL_NAMES = [
  'PortalLink',
  'Portal Link',
  'portalLink',
  'Link tra cứu người bán',
  'Link tra cuu nguoi ban',
  'lookupUrl',
  'lookupURL',
  'LookupUrl',
  'PATH',
];

const BACKEND_BROWSER_LOOKUP_PROVIDERS = new Set([
  'SOFTDREAMS',
  'VNPT',
  'ACMAN',
]);

const LOOKUP_CODE_NAMES_BY_PROVIDER: Record<string, string[]> = {
  MISA: ['TransactionID', 'transactionID'],
  VIETTEL: ['Mã số bí mật', 'Ma so bi mat', 'reservationCode'],
  SOFTDREAMS: ['Fkey', 'FKey', 'fkey'],
  PVOIL: ['Fkey', 'FKey', 'fkey'],
  VNPT: ['Fkey', 'FKey', 'fkey'],
  'M-INVOICE': ['Mã tra cứu', 'Ma tra cuu', 'Số bảo mật', 'So bao mat', 'sobaomat', 'securityCode'],
  EHOADONDIENTU: ['Mã tra cứu', 'Ma tra cuu', 'mahoadon'],
  ACMAN: ['MA_TRA_CUU', 'MaTraCuu', 'Mã tra cứu', 'Ma tra cuu'],
  FAST: ['KeySearch', 'keySearch', 'KEYSEARCH'],
  'THÁI SƠN': ['Mã TC', 'Ma TC', 'MA TC'],
};

const GENERIC_LOOKUP_CODE_NAMES = [
  'KeySearch',
  'Fkey',
  'FKey',
  'fkey',
  'Hilo-SearchKey',
  'Mã tra cứu',
  'Ma tra cuu',
  'MA_TRA_CUU',
  'Mã số bí mật',
  'Ma so bi mat',
  'Số bảo mật',
  'So bao mat',
  'sobaomat',
  'TransactionID',
  'transactionID',
  'lookupCode',
  'reservationCode',
  'securityCode',
];

function normalizedFieldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lookupText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

function safeLookupUrl(value: unknown, baseUrl?: string): string | undefined {
  const text = lookupText(value);
  if (!text) return undefined;
  try {
    const url = baseUrl ? new URL(text, baseUrl) : new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function datasetLookupUrlOf(document: InvoiceDocument, providerName: string): LookupUrlCandidate | undefined {
  if (document.lookup?.lookupBaseUrl) {
    const direct = safeLookupUrl(
      document.lookup.lookupPathRaw || document.lookup.lookupBaseUrl,
      document.lookup.lookupBaseUrl,
    );
    if (direct) {
      return {
        url: direct,
        type: document.lookup.sourceField || 'Link tra cứu trong dataset',
      };
    }
  }

  const candidates: Array<{ name: string; value: string }> = [];
  const push = (name: unknown, value: unknown) => {
    const fieldName = lookupText(name);
    const fieldValue = lookupText(value);
    if (fieldName && fieldValue) candidates.push({ name: fieldName, value: fieldValue });
  };

  for (const field of document.dynamicFields || []) push(field.name, field.rawValue);
  for (const party of [document.seller, document.buyer]) {
    for (const field of party?.dynamicFields || []) push(field.name, field.rawValue);
  }

  const collect = (value: unknown, depth = 0): void => {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    const fieldName = lookupText(record.ttruong ?? record.ten ?? record.name ?? record.key);
    const fieldValue = lookupText(record.dlieu ?? record.value ?? record.giatri ?? record.rawValue);
    if (fieldName && fieldValue) candidates.push({ name: fieldName, value: fieldValue });

    for (const [name, child] of Object.entries(record)) {
      const direct = lookupText(child);
      if (direct) candidates.push({ name, value: direct });
      if (Array.isArray(child) || (child && typeof child === 'object')) collect(child, depth + 1);
    }
  };

  collect(document.rawSummary);
  collect(document.rawDetail);

  const preferredNames = [
    ...(LOOKUP_URL_NAMES_BY_PROVIDER[providerName] || []),
    ...GENERIC_LOOKUP_URL_NAMES,
  ].map(normalizedFieldName);

  for (const preferred of preferredNames) {
    const found = candidates.find((candidate) => normalizedFieldName(candidate.name) === preferred);
    const url = found ? safeLookupUrl(found.value, document.lookup?.lookupBaseUrl) : undefined;
    if (found && url) return { url, type: found.name };
  }
  return undefined;
}

function backendBrowserLookupUrlOf(
  resolved: TvanPresentationLinkResult | null,
  providerName: string,
): string | undefined {
  if (!resolved || !BACKEND_BROWSER_LOOKUP_PROVIDERS.has(providerName)) return undefined;
  return safeLookupUrl(resolved.metadataUrl);
}

function datasetLookupCodeOf(document: InvoiceDocument, providerName: string): LookupCodeCandidate | undefined {
  const candidates: Array<{ name: string; value: string }> = [];
  const push = (name: unknown, value: unknown) => {
    const fieldName = lookupText(name);
    const fieldValue = lookupText(value);
    if (fieldName && fieldValue) candidates.push({ name: fieldName, value: fieldValue });
  };

  for (const field of document.dynamicFields || []) push(field.name, field.rawValue);
  for (const party of [document.seller, document.buyer]) {
    for (const field of party?.dynamicFields || []) push(field.name, field.rawValue);
  }

  const collect = (value: unknown, depth = 0): void => {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    const fieldName = lookupText(record.ttruong ?? record.ten ?? record.name ?? record.key);
    const fieldValue = lookupText(record.dlieu ?? record.value ?? record.giatri ?? record.rawValue);
    if (fieldName && fieldValue) candidates.push({ name: fieldName, value: fieldValue });

    for (const [name, child] of Object.entries(record)) {
      const direct = lookupText(child);
      if (direct) candidates.push({ name, value: direct });
      if (Array.isArray(child) || (child && typeof child === 'object')) collect(child, depth + 1);
    }
  };

  collect(document.rawSummary);
  collect(document.rawDetail);

  const preferredNames = [
    ...(LOOKUP_CODE_NAMES_BY_PROVIDER[providerName] || []),
    ...GENERIC_LOOKUP_CODE_NAMES,
  ].map(normalizedFieldName);

  for (const preferred of preferredNames) {
    const found = candidates.find((candidate) => normalizedFieldName(candidate.name) === preferred);
    if (found) return { value: found.value, type: found.name };
  }
  return undefined;
}

export default function InvoiceProviderResearchPanel({
  document,
  authenticated: _authenticated,
}: {
  document: InvoiceDocument;
  authenticated: boolean;
}) {
  const research = useMemo(() => providerResearchFor(document), [document]);
  const providerName = providerNameOf(document, research.providerName);
  const providerKnown = PUBLIC_PROVIDER_NAMES.has(providerName);
  const fallbackCaptchaExpected = CAPTCHA_PROVIDER_NAMES.has(providerName);
  const supportsResolveLink = RESOLVE_LINK_PROVIDER_NAMES.has(providerName);
  const isViettel = providerName === 'VIETTEL';
  const isSoftdreams = providerName === 'SOFTDREAMS';
  const isFast = providerName === 'FAST';
  const isSingleUseCaptcha = isFast;
  const presentationDocument = useMemo<InvoiceDocument>(() => {
    if (!isViettel && !isSoftdreams) return document;
    return {
      ...document,
      seller: {
        ...document.seller,
        dynamicFields: Array.isArray(document.seller?.dynamicFields) ? document.seller.dynamicFields : [],
      },
      buyer: {
        ...document.buyer,
        dynamicFields: Array.isArray(document.buyer?.dynamicFields) ? document.buyer.dynamicFields : [],
      },
      taxSummaries: Array.isArray(document.taxSummaries) ? document.taxSummaries : [],
      lines: Array.isArray(document.lines)
        ? document.lines.map((line) => ({
            ...line,
            dynamicFields: Array.isArray(line.dynamicFields) ? line.dynamicFields : [],
            supplementalInfo: Array.isArray(line.supplementalInfo) ? line.supplementalInfo : [],
          }))
        : [],
      dynamicFields: Array.isArray(document.dynamicFields) ? document.dynamicFields : [],
    };
  }, [document, isViettel, isSoftdreams]);

  const [resolved, setResolved] = useState<TvanPresentationLinkResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [challenge, setChallenge] = useState<TvanCaptchaChallenge | null>(null);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const [sliderTouched, setSliderTouched] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [backgroundWidth, setBackgroundWidth] = useState(0);
  const [backgroundHeight, setBackgroundHeight] = useState(0);
  const [pieceWidth, setPieceWidth] = useState(0);
  const [presentationBusy, setPresentationBusy] = useState<PresentationBusy>(null);
  const [presentationError, setPresentationError] = useState<PresentationUiError | null>(null);
  const [softdreamArtifact, setSoftdreamArtifact] = useState<TvanArtifactInfo | null>(null);
  const [presentationStatus, setPresentationStatus] = useState<PresentationStatusResult | null>(null);

  useEffect(() => {
    setResolved(null);
    setLookupBusy(false);
    setLookupError(null);
    setChallenge(null);
    setCaptchaBusy(false);
    setCaptchaAnswer('');
    setSliderValue(0);
    setSliderTouched(false);
    setCaptchaVerified(false);
    setCaptchaError(null);
    setBackgroundWidth(0);
    setBackgroundHeight(0);
    setPieceWidth(0);
    setPresentationBusy(null);
    setPresentationError(null);
    setSoftdreamArtifact(null);
    setPresentationStatus(null);

    if (!providerKnown) return;
    let active = true;
    void api.presentationStatus(presentationDocument)
      .then((status) => {
        if (!active) return;
        setPresentationStatus(status);
        if (status.artifact.ready || (isSoftdreams && status.artifact.stage !== 'new')) {
          setCaptchaVerified(true);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [document.key, isSoftdreams, presentationDocument, providerKnown]);

  const publicPortals = useMemo(
    () => research.portals.filter(item => item.label !== 'URL quan sát trong Raw JSON'),
    [research.portals],
  );
  const datasetLookupUrl = useMemo(
    () => datasetLookupUrlOf(document, providerName),
    [document, providerName],
  );
  const normalizedDatasetPortal = publicPortals.find(
    item => item.source === 'dataset' && item.label === 'Link tra cứu trong dataset',
  );
  const knownLookupPortal = publicPortals.find(
    item => item.source !== 'dataset' && /tra cứu tham khảo/i.test(item.label),
  );
  const providerPortal = publicPortals.find(
    item => item.source !== 'dataset' && /portal/i.test(item.label),
  );
  const backendLookupUrl = backendBrowserLookupUrlOf(resolved, providerName);
  const lookupUrl = normalizedDatasetPortal?.url
    || datasetLookupUrl?.url
    || backendLookupUrl
    || knownLookupPortal?.url
    || providerPortal?.url;
  const portalUrl = providerPortal?.url || portalRoot(lookupUrl);

  const datasetLookupCode = useMemo(
    () => datasetLookupCodeOf(document, providerName),
    [document, providerName],
  );
  const lookupCode = research.lookupCode || datasetLookupCode?.value || resolved?.lookupCode;
  const lookupCodeType = research.lookupCodeType || datasetLookupCode?.type || 'Mã tra cứu';
  const capability = presentationStatus?.capability;
  const artifactStatus = presentationStatus?.artifact;
  const supported = capability ? capability.supported : providerKnown;
  const captchaExpected = capability ? capability.captchaMode !== 'none' : fallbackCaptchaExpected;

  const resolveLookup = async () => {
    setLookupBusy(true);
    setLookupError(null);
    try {
      setResolved(await api.resolvePresentationLink(presentationDocument));
    } catch {
      setResolved(null);
      setLookupError('Chưa lấy được thông tin tra cứu. Vui lòng thử lại.');
    } finally {
      setLookupBusy(false);
    }
  };

  const refreshPresentationStatus = async () => {
    if (!providerKnown) return null;
    try {
      const status = await api.presentationStatus(presentationDocument);
      setPresentationStatus(status);
      if (status.artifact.ready || (isSoftdreams && status.artifact.stage !== 'new')) {
        setCaptchaVerified(true);
      }
      return status;
    } catch {
      return null;
    }
  };

  const prepareSoftdreamArtifact = async () => {
    if (!isSoftdreams) return;
    setPresentationBusy('prepare');
    setPresentationError(null);
    try {
      const artifact = await api.prepareTvanPdfArtifact(presentationDocument);
      setSoftdreamArtifact(artifact);
      await refreshPresentationStatus();
    } catch (error) {
      setPresentationError(presentationErrorOf(error, 'Không tạo được bản thể hiện SoftDreams.'));
      await refreshPresentationStatus();
    } finally {
      setPresentationBusy(null);
    }
  };

  const loadCaptcha = async () => {
    if (!supported) {
      setCaptchaError(capability?.reason || 'Nhà cung cấp hoặc dữ liệu hóa đơn hiện chưa đủ điều kiện xử lý CAPTCHA.');
      return;
    }
    setCaptchaBusy(true);
    setCaptchaError(null);
    setCaptchaVerified(false);
    setPresentationError(null);
    try {
      const prepared = await api.preparePresentation(presentationDocument);
      await refreshPresentationStatus();
      if (prepared.challenge) {
        setChallenge(prepared.challenge);
        setCaptchaAnswer('');
        setSliderValue(prepared.challenge.sliderStart ?? 0);
        setSliderTouched(false);
      } else {
        setChallenge(null);
        setCaptchaVerified(true);
        if (isSoftdreams) {
          setCaptchaBusy(false);
          await prepareSoftdreamArtifact();
        }
      }
    } catch (error) {
      setChallenge(null);
      setCaptchaError(error instanceof Error ? error.message : 'Chưa lấy được CAPTCHA. Vui lòng thử lại.');
    } finally {
      setCaptchaBusy(false);
    }
  };

  const verifyCaptcha = async () => {
    if (!challenge) return;
    const isSlider = challenge.kind === 'slider';
    if (isSlider && !sliderTouched) {
      setCaptchaError('Hãy kéo thanh trượt để khớp mảnh ghép.');
      return;
    }
    if (!isSlider && !captchaAnswer.trim()) {
      setCaptchaError('Hãy nhập CAPTCHA.');
      return;
    }

    setCaptchaBusy(true);
    setCaptchaError(null);
    setPresentationError(null);
    try {
      const answer = isSlider ? String(Math.round(sliderValue)) : captchaAnswer.trim();
      await api.submitPresentationChallenge(challenge.id, answer);
      setCaptchaVerified(true);
      setChallenge(null);
      setCaptchaAnswer('');
      setSliderTouched(false);
      if (isSoftdreams) {
        setCaptchaBusy(false);
        await prepareSoftdreamArtifact();
      } else {
        await refreshPresentationStatus();
      }
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : 'CAPTCHA chưa đúng hoặc đã hết hạn. Vui lòng thử lại.';
      setCaptchaError(failureMessage);
      if (isSingleUseCaptcha) {
        // Single-use CAPTCHA providers must never keep/reuse a failed challenge in the UI.
        setChallenge(null);
        setCaptchaAnswer('');
        setSliderTouched(false);
        try {
          const prepared = await api.preparePresentation(presentationDocument);
          if (prepared.challenge) {
            setChallenge(prepared.challenge);
            setSliderValue(prepared.challenge.sliderStart ?? 0);
          }
        } catch (refreshError) {
          const refreshMessage = refreshError instanceof Error ? refreshError.message : 'Không lấy được CAPTCHA mới.';
          setCaptchaError(failureMessage + ' · ' + refreshMessage);
        }
      }
    } finally {
      setCaptchaBusy(false);
    }
  };

  const viewPresentationPdf = async () => {
    if (!supported) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setPresentationBusy('view');
    setPresentationError(null);
    try {
      if (providerName === 'MISA') {
        const link = resolved || await api.resolvePresentationLink(presentationDocument);
        setResolved(link);
        if (!link.downloadUrl) throw new Error('MISA chưa trả link bản thể hiện PDF.');
        if (popup) popup.location.replace(link.downloadUrl);
        else window.open(link.downloadUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      const blob = await api.viewPresentationPdf(presentationDocument);
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.replace(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await refreshPresentationStatus();
    } catch (error) {
      popup?.close();
      setPresentationError(presentationErrorOf(error, 'Không xem được PDF ' + providerName + '.'));
    } finally {
      setPresentationBusy(null);
    }
  };

  const downloadPresentationPdf = async () => {
    if (!supported) return;
    setPresentationBusy('pdf');
    setPresentationError(null);
    try {
      const result = await api.downloadPresentationPdf(presentationDocument);
      downloadBlob(result.blob, result.fileName);
      await refreshPresentationStatus();
    } catch (error) {
      setPresentationError(presentationErrorOf(error, 'Không tải được PDF ' + providerName + '.'));
    } finally {
      setPresentationBusy(null);
    }
  };

  const downloadSoftdreamOriginal = async () => {
    if (!isSoftdreams) return;
    setPresentationBusy('original');
    setPresentationError(null);
    try {
      const result = await api.downloadPresentationOriginal(presentationDocument);
      downloadBlob(result.blob, result.fileName);
    } catch (error) {
      setPresentationError(presentationErrorOf(error, 'Không tải được file gốc SoftDreams.'));
    } finally {
      setPresentationBusy(null);
    }
  };

  const artifactReady = Boolean(artifactStatus?.ready);
  const softdreamReady = isSoftdreams && (artifactReady || Boolean(softdreamArtifact));
  const softdreamCanRetry = isSoftdreams && Boolean(
    artifactStatus?.canRetryPrepare || presentationError?.preserveContext,
  );
  const providerPdfReady = supported && (
    artifactReady
    || !captchaExpected
    || (captchaVerified && !isSoftdreams)
    || softdreamReady
  );
  const canResolveLookup = supportsResolveLink && providerKnown && !lookupUrl;
  const presentationLink = softdreamArtifact
    ? api.tvanArtifactPdfUrl(softdreamArtifact.id)
    : resolved?.downloadUrl;
  const presentationStateTag = (() => {
    if (!providerKnown) return <Tag>Chưa hỗ trợ tự động</Tag>;
    if (!supported) return <Tag color="warning">Chưa đủ dữ liệu xử lý</Tag>;
    if (presentationBusy === 'prepare') return <Tag color="processing">Đang tạo bản thể hiện</Tag>;
    if (artifactReady || softdreamReady) return <Tag color="success">Bản thể hiện sẵn sàng</Tag>;
    if (isSoftdreams && captchaVerified) {
      return softdreamCanRetry
        ? <Tag color="warning">Có thể thử tạo lại</Tag>
        : <Tag color="processing">Đã xác thực · đang chuẩn bị PDF</Tag>;
    }
    if (captchaExpected) {
      if (captchaVerified) return <Tag color="success">Sẵn sàng xem / tải PDF</Tag>;
      if (challenge) return <Tag color="gold">Đã nhận CAPTCHA</Tag>;
      return <Tag>Cần xác thực CAPTCHA</Tag>;
    }
    return <Tag color="blue">Không yêu cầu CAPTCHA</Tag>;
  })();

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Tra cứu hóa đơn">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="NCC HĐĐT">{providerName}</Descriptions.Item>
            <Descriptions.Item label="MSTTCGP">
              <Text code>{research.solutionTaxCode || '—'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Mã tra cứu" span={2}>
              {lookupCode ? (
                <Space size={8} wrap>
                  <Text code copyable>{lookupCode}</Text>
                  {lookupCodeType !== 'Mã tra cứu' && <Tag>{lookupCodeType}</Tag>}
                </Space>
              ) : (
                <Text type="secondary">Chưa có trong dữ liệu hiện tại</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Link tra cứu" span={2}>
              {lookupUrl
                ? <Link href={lookupUrl} target="_blank" rel="noopener noreferrer">{lookupUrl}</Link>
                : portalUrl
                  ? <Link href={portalUrl} target="_blank" rel="noopener noreferrer">{portalUrl}</Link>
                  : <Text type="secondary">Chưa có trong dữ liệu hiện tại</Text>}
            </Descriptions.Item>
            {presentationLink && (
              <Descriptions.Item label="Link bản thể hiện" span={2}>
                <Link href={presentationLink} target="_blank" rel="noopener noreferrer">
                  Mở bản thể hiện PDF
                </Link>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Bản thể hiện" span={2}>
              {presentationStateTag}
            </Descriptions.Item>
          </Descriptions>

          {canResolveLookup && (
            <Button loading={lookupBusy} onClick={() => void resolveLookup()}>
              Lấy thông tin tra cứu
            </Button>
          )}

          {!providerKnown && (
            <Alert
              type="info"
              showIcon
              message="Nhà cung cấp này hiện chưa có adapter bản thể hiện tự động."
            />
          )}
          {providerKnown && !supported && capability?.reason && (
            <Alert type="warning" showIcon message={capability.reason} />
          )}
          {lookupError && <Alert type="warning" showIcon message={lookupError} />}
          {presentationError && (
            <Alert
              type={presentationError.preserveContext ? 'warning' : 'error'}
              showIcon
              message={presentationError.message}
              description={presentationError.preserveContext
                ? 'Ngữ cảnh xác thực vẫn được giữ. Có thể thử tạo bản thể hiện lại mà không nhập CAPTCHA mới.'
                : undefined}
            />
          )}

          <Space wrap>
            <Button
              type="primary"
              disabled={!providerPdfReady}
              loading={presentationBusy === 'view'}
              onClick={() => void viewPresentationPdf()}
            >
              Xem PDF
            </Button>
            <Button
              disabled={!providerPdfReady}
              loading={presentationBusy === 'pdf'}
              onClick={() => void downloadPresentationPdf()}
            >
              Tải PDF
            </Button>
            {isSoftdreams && (
              <Button
                disabled={!softdreamReady}
                loading={presentationBusy === 'original'}
                onClick={() => void downloadSoftdreamOriginal()}
              >
                Tải file gốc
              </Button>
            )}
            {isSoftdreams && !softdreamReady && softdreamCanRetry && (
              <Button
                type="primary"
                loading={presentationBusy === 'prepare'}
                onClick={() => void prepareSoftdreamArtifact()}
              >
                Thử tạo bản thể hiện lại
              </Button>
            )}
          </Space>
        </Space>
      </Card>

      <Card size="small" title="Nhập CAPTCHA">
        {!providerKnown ? (
          <Alert
            type="info"
            showIcon
            message="Chưa xác định workflow CAPTCHA cho nhà cung cấp này."
            description="Ứng dụng không tự động đoán hoặc gửi CAPTCHA khi chưa có adapter tương ứng."
          />
        ) : !supported ? (
          <Alert
            type="warning"
            showIcon
            message="Chưa thể gọi CAPTCHA với dữ liệu hóa đơn hiện tại."
            description={capability?.reason}
          />
        ) : !captchaExpected ? (
          <Alert
            type="success"
            showIcon
            message={providerName + ' không yêu cầu CAPTCHA cho luồng bản thể hiện hiện tại.'}
          />
        ) : captchaVerified && !challenge ? (
          <Alert
            type={softdreamReady ? 'success' : 'info'}
            showIcon
            message={isSoftdreams
              ? softdreamReady
                ? 'CAPTCHA đã xác thực và bản thể hiện SoftDreams đã sẵn sàng.'
                : 'CAPTCHA SoftDreams đã xác thực. Không cần nhập lại khi ngữ cảnh còn hiệu lực.'
              : 'CAPTCHA ' + providerName + ' đã xác thực. Phiên hiện tại sẵn sàng để xem/tải PDF.'}
          />
        ) : challenge ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>{challenge.prompt}</Text>
            {challenge.kind === 'slider' ? (
              <>
                {challenge.imageBase64 ? (
                  <div className="tvan-slider-captcha-stage">
                    <img
                      src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
                      alt="Ảnh CAPTCHA"
                      className="tvan-slider-captcha-background"
                      onLoad={(event) => {
                        setBackgroundWidth(event.currentTarget.naturalWidth || 0);
                        setBackgroundHeight(event.currentTarget.naturalHeight || 0);
                      }}
                    />
                    {challenge.pieceImageBase64 && backgroundWidth > 0 && backgroundHeight > 0 && challenge.sliderY !== undefined && (
                      <img
                        src={`data:${challenge.pieceImageMimeType || 'image/png'};base64,${challenge.pieceImageBase64}`}
                        alt="Mảnh ghép CAPTCHA"
                        className="tvan-slider-captcha-piece-overlay"
                        onLoad={(event) => setPieceWidth(event.currentTarget.naturalWidth || 0)}
                        style={{
                          left: `${Math.min(100, Math.max(0, (sliderValue / backgroundWidth) * 100))}%`,
                          top: `${Math.min(100, Math.max(0, (challenge.sliderY / backgroundHeight) * 100))}%`,
                          width: `${Math.min(100, Math.max(1, ((pieceWidth || 50) / backgroundWidth) * 100))}%`,
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <Alert type="warning" showIcon message="Không tải được ảnh CAPTCHA. Hãy thử lại." />
                )}
                <Slider
                  min={0}
                  max={Math.max(1, challenge.sliderMax ?? (backgroundWidth > 0 ? Math.max(1, backgroundWidth - pieceWidth) : 280))}
                  value={sliderValue}
                  tooltip={{ open: false }}
                  onChange={(value) => {
                    setSliderValue(value);
                    setSliderTouched(true);
                  }}
                />
                <Text type="secondary">Kéo thanh trượt để khớp mảnh ghép.</Text>
              </>
            ) : (
              <>
                {challenge.imageBase64 && (
                  <img
                    src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
                    alt="CAPTCHA"
                    style={{ maxWidth: isSingleUseCaptcha ? 300 : '100%', maxHeight: 260, objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 6 }}
                  />
                )}
                <Input
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  onPressEnter={() => void verifyCaptcha()}
                  maxLength={isFast ? 6 : undefined}
                  placeholder="Nhập CAPTCHA"
                />
              </>
            )}
            <Space wrap>
              <Button type="primary" loading={captchaBusy} onClick={() => void verifyCaptcha()}>
                Xác thực CAPTCHA
              </Button>
              <Button disabled={captchaBusy} onClick={() => void loadCaptcha()}>
                Làm mới CAPTCHA
              </Button>
            </Space>
          </Space>
        ) : (
          <Button loading={captchaBusy} onClick={() => void loadCaptcha()}>
            Lấy CAPTCHA
          </Button>
        )}

        {captchaError && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={captchaError} />}
      </Card>
    </Space>
  );
}
