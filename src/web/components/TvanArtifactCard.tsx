import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Space, Tag, Typography } from 'antd';
import type {
  InvoiceDocument,
  TvanArtifactStatus,
  TvanCaptchaChallenge,
} from '../../shared/models/index.js';
import { api, downloadBlob, type TvanArtifactInfo } from '../api/client';

const { Text } = Typography;

type BusyState = 'captcha' | 'verify' | 'prepare' | 'view' | 'pdf' | 'original' | 'status' | null;

type UiError = {
  message: string;
  code?: string;
  preserveContext?: boolean;
  retryStage?: string;
};

function toUiError(error: unknown, fallback: string): UiError {
  if (!(error instanceof Error)) return { message: fallback };
  const candidate = error as Error & {
    code?: string;
    preserveContext?: boolean;
    retryStage?: string;
  };
  return {
    message: candidate.message || fallback,
    code: candidate.code,
    preserveContext: candidate.preserveContext,
    retryStage: candidate.retryStage,
  };
}

function statusTag(status: TvanArtifactStatus | null, challenge: TvanCaptchaChallenge | null, busy: BusyState) {
  if (busy === 'captcha') return <Tag color="processing">Đang lấy CAPTCHA</Tag>;
  if (busy === 'verify') return <Tag color="processing">Đang xác thực</Tag>;
  if (busy === 'prepare') return <Tag color="processing">Đang tạo bản thể hiện</Tag>;
  if (busy) return <Tag color="processing">Đang xử lý</Tag>;
  if (status?.stage === 'pdf_ready') return <Tag color="success">Bản thể hiện sẵn sàng</Tag>;
  if (status?.stage === 'search_verified') return <Tag color="blue">Đã xác thực hóa đơn</Tag>;
  if (status?.stage === 'representation_ready') return <Tag color="blue">Đã dựng bản thể hiện</Tag>;
  if (status?.stage === 'artifact_descriptor_ready') return <Tag color="blue">Đã tạo file tại SoftDreams</Tag>;
  if (status?.stage === 'original_ready') return <Tag color="blue">Đã tải file gốc</Tag>;
  if (challenge) return <Tag color="gold">Đã nhận CAPTCHA</Tag>;
  return <Tag>Chưa xử lý</Tag>;
}

export default function TvanArtifactCard({ document }: { document: InvoiceDocument }) {
  const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLowerCase();
  const supportedHere = providerCode === 'tvan_softdreams' || providerCode.includes('softdreams');
  const [challenge, setChallenge] = useState<TvanCaptchaChallenge | null>(null);
  const [status, setStatus] = useState<TvanArtifactStatus | null>(null);
  const [artifact, setArtifact] = useState<TvanArtifactInfo | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<UiError | null>(null);

  const portalUrl = document.lookup?.lookupBaseUrl || '';
  const lookupCode = document.lookup?.lookupCode || '';

  const refreshStatus = async (quiet = false) => {
    if (!supportedHere) return null;
    if (!quiet) setBusy('status');
    try {
      const next = await api.tvanPdfStatus(document);
      setStatus(next);
      return next;
    } catch (requestError) {
      if (!quiet) setError(toUiError(requestError, 'Không đọc được trạng thái SoftDreams.'));
      return null;
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  useEffect(() => {
    setChallenge(null);
    setArtifact(null);
    setAnswer('');
    setError(null);
    setStatus(null);
    void refreshStatus(true);
  }, [document.key]);

  const stateLabel = useMemo(
    () => statusTag(status, challenge, busy),
    [status, challenge, busy],
  );

  if (!supportedHere) return null;

  const requestCaptcha = async () => {
    setBusy('captcha');
    setError(null);
    setArtifact(null);
    try {
      const prepared = await api.prepareTvanSupervised(document);
      if (!prepared.challenge) {
        setError({ message: 'SoftDreams chưa trả ảnh CAPTCHA hợp lệ.' });
        return;
      }
      setChallenge(prepared.challenge);
      setAnswer('');
      setStatus({
        providerCode: 'tvan_softdreams',
        stage: 'captcha_ready',
        ready: false,
        canRetryPrepare: false,
        canView: false,
        canDownloadPdf: false,
        canDownloadOriginal: false,
        expiresAt: prepared.challenge.expiresAt,
      });
    } catch (requestError) {
      setError(toUiError(requestError, 'Không lấy được CAPTCHA SoftDreams.'));
    } finally {
      setBusy(null);
    }
  };

  const prepareArtifact = async () => {
    setBusy('prepare');
    setError(null);
    try {
      const nextArtifact = await api.prepareTvanPdfArtifact(document);
      setArtifact(nextArtifact);
      await refreshStatus(true);
      setChallenge(null);
    } catch (requestError) {
      const nextError = toUiError(requestError, 'Không tạo được bản thể hiện SoftDreams.');
      setError(nextError);
      await refreshStatus(true);
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!challenge) return;
    if (!answer.trim()) {
      setError({ message: 'Hãy nhập mã CAPTCHA.' });
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      const verification = await api.submitTvanCaptcha(challenge.id, answer.trim());
      setChallenge(null);
      setStatus({
        providerCode: verification.providerCode,
        stage: verification.stage || 'search_verified',
        ready: false,
        canRetryPrepare: true,
        canView: false,
        canDownloadPdf: false,
        canDownloadOriginal: false,
        expiresAt: verification.contextExpiresAt || verification.tokenExpiresAt,
      });
    } catch (requestError) {
      setError(toUiError(requestError, 'SoftDreams không xác thực được CAPTCHA.'));
      setBusy(null);
      return;
    }
    setBusy(null);
    await prepareArtifact();
  };

  const viewPdf = async () => {
    setBusy('view');
    setError(null);
    const popup = window.open('about:blank', '_blank');
    try {
      const blob = await api.viewTvanPdf(document);
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.replace(url);
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (requestError) {
      popup?.close();
      setError(toUiError(requestError, 'Không xem được PDF SoftDreams.'));
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = async () => {
    setBusy('pdf');
    setError(null);
    try {
      const result = await api.downloadTvanPdf(document);
      downloadBlob(result.blob, result.fileName);
    } catch (requestError) {
      setError(toUiError(requestError, 'Không tải được PDF SoftDreams.'));
    } finally {
      setBusy(null);
    }
  };

  const downloadOriginal = async () => {
    setBusy('original');
    setError(null);
    try {
      const result = await api.downloadTvanOriginalArtifact(document);
      downloadBlob(result.blob, result.fileName);
    } catch (requestError) {
      setError(toUiError(requestError, 'Không tải được file gốc SoftDreams.'));
    } finally {
      setBusy(null);
    }
  };

  const ready = status?.stage === 'pdf_ready' || Boolean(artifact);
  const canRetryPrepare = Boolean(status?.canRetryPrepare || error?.preserveContext);

  return (
    <Card size="small" title="Bản thể hiện hóa đơn · SoftDreams EasyInvoice" style={{ marginTop: 16 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="PDF được tạo bởi workflow SoftDreams; cookie, invoice token và HTML representation chỉ tồn tại trong local backend."
        />
        <Space wrap>
          <Text strong>TVAN:</Text><Text>tvan_softdreams</Text>
          <Text strong>Trạng thái:</Text>{stateLabel}
        </Space>
        {portalUrl && <Text type="secondary">Portal: {portalUrl}</Text>}
        {lookupCode && <Text type="secondary">Mã tra cứu: {lookupCode}</Text>}

        {challenge && (
          <Card size="small" type="inner" title="CAPTCHA EasyInvoice">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text>{challenge.prompt}</Text>
              {challenge.imageBase64 && (
                <img
                  src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
                  alt="CAPTCHA SoftDreams EasyInvoice"
                  style={{ maxWidth: 320, maxHeight: 160, objectFit: 'contain' }}
                />
              )}
              <Input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                onPressEnter={() => void verify()}
                placeholder="Nhập mã xác thực"
                style={{ maxWidth: 320 }}
              />
            </Space>
          </Card>
        )}

        {ready && (
          <Alert
            type="success"
            showIcon
            message="Bản thể hiện sẵn sàng"
            description={`PDF: ${status?.pdfFileName || artifact?.pdfFileName || 'đã cache'} · File gốc: ${
              status?.originalKind?.toUpperCase()
              || (artifact?.originalContentType === 'application/zip' ? 'ZIP' : 'PDF')
            }`}
          />
        )}

        {error && (
          <Alert
            type={error.preserveContext ? 'warning' : 'error'}
            showIcon
            message={error.message}
            description={error.preserveContext
              ? 'Ngữ cảnh xác thực vẫn được giữ. Có thể thử tạo file lại mà không nhập CAPTCHA mới.'
              : undefined}
          />
        )}

        <Space wrap>
          {!challenge && !ready && !canRetryPrepare && (
            <Button type="primary" loading={busy === 'captcha'} onClick={() => void requestCaptcha()}>
              Lấy CAPTCHA
            </Button>
          )}
          {challenge && (
            <>
              <Button type="primary" loading={busy === 'verify'} onClick={() => void verify()}>
                Xác thực
              </Button>
              <Button disabled={Boolean(busy)} onClick={() => void requestCaptcha()}>
                Làm mới CAPTCHA
              </Button>
            </>
          )}
          {!ready && canRetryPrepare && (
            <Button type="primary" loading={busy === 'prepare'} onClick={() => void prepareArtifact()}>
              Thử tạo file lại
            </Button>
          )}
          {ready && (
            <>
              <Button type="primary" loading={busy === 'view'} onClick={() => void viewPdf()}>
                Xem PDF
              </Button>
              <Button loading={busy === 'pdf'} onClick={() => void downloadPdf()}>
                Tải PDF
              </Button>
              <Button loading={busy === 'original'} onClick={() => void downloadOriginal()}>
                Tải file gốc
              </Button>
            </>
          )}
        </Space>
      </Space>
    </Card>
  );
}
