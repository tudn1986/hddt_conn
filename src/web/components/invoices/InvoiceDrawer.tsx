import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Input, Slider, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { api } from '../../api/client';
import type { InvoiceDocument, TvanCaptchaVerificationResult, TvanDownloadRequestPlan, TvanPresentationLinkResult, TvanSupervisedPrepareResult } from '../../../shared/models/index.js';
import InvoiceProviderResearchPanel from '../InvoiceProviderResearchPanel.js';
import RawInvoiceJsonPanel from '../RawInvoiceJsonPanel.js';
import { renderInvoiceStatus } from './invoice-status';
import { money } from './invoice-format';

const { Text, Paragraph } = Typography;

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
  const [backgroundHeight, setBackgroundHeight] = useState(0);
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
    setBackgroundHeight(0);
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
      setBackgroundHeight(0);
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
                        onLoad={(event) => {
                          setBackgroundWidth(event.currentTarget.naturalWidth || 0);
                          setBackgroundHeight(event.currentTarget.naturalHeight || 0);
                        }}
                      />
                      {challenge.pieceImageBase64 && backgroundWidth > 0 && backgroundHeight > 0 && challenge.sliderY !== undefined ? (
                        <img
                          src={`data:${challenge.pieceImageMimeType || 'image/png'};base64,${challenge.pieceImageBase64}`}
                          alt="Vị trí mảnh ghép CAPTCHA Viettel"
                          className="tvan-slider-captcha-piece-overlay"
                          style={{
                            left: `${Math.min(100, Math.max(0, (sliderValue / backgroundWidth) * 100))}%`,
                            top: `${Math.min(100, Math.max(0, (challenge.sliderY / backgroundHeight) * 100))}%`,
                            width: `${Math.min(100, Math.max(1, ((pieceWidth || 50) / backgroundWidth) * 100))}%`,
                          }}
                        />
                      ) : sliderTouched && backgroundWidth > 0 ? (
                        <span
                          className="tvan-slider-captcha-position"
                          aria-hidden="true"
                          style={{
                            left: `${Math.min(100, Math.max(0, (sliderValue / backgroundWidth) * 100))}%`,
                            width: `${Math.min(28, Math.max(4, ((pieceWidth || 42) / backgroundWidth) * 100))}%`,
                          }}
                        />
                      ) : null}
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

export default function InvoiceDrawer({ document, authenticated, onClose }: { document: any | null; authenticated: boolean; onClose: () => void }) {
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
        { key: 'provider-research', label: 'Xem bản thể hiện', children: <InvoiceProviderResearchPanel document={document as InvoiceDocument} authenticated={authenticated} /> },
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
