import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Slider, Space, Tag, Typography } from 'antd';
import type { InvoiceDocument, TvanCaptchaChallenge } from '../../shared/models/index.js';
import { api, downloadBlob, type TvanArtifactInfo } from '../api/client';

const { Text } = Typography;

export default function TvanArtifactCard({ document }: { document: InvoiceDocument }) {
  const providerCode = String(document.providerCode || document.lookup?.providerCode || '').trim().toLowerCase();
  const supportedHere = providerCode === 'tvan_softdreams' || providerCode.includes('softdreams');
  const [challenge, setChallenge] = useState<TvanCaptchaChallenge | null>(null);
  const [artifact, setArtifact] = useState<TvanArtifactInfo | null>(null);
  const [answer, setAnswer] = useState('');
  const [sliderValue, setSliderValue] = useState(0);
  const [sliderTouched, setSliderTouched] = useState(false);
  const [busy, setBusy] = useState<'prepare' | 'verify' | 'file' | 'pdf' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setChallenge(null);
    setArtifact(null);
    setAnswer('');
    setSliderValue(0);
    setSliderTouched(false);
    setBusy(null);
    setError('');
  }, [document.key]);

  const stateLabel = useMemo(() => {
    if (busy) return <Tag color="processing">Đang xử lý</Tag>;
    if (artifact) return <Tag color="success">File đã sẵn sàng</Tag>;
    if (challenge) return <Tag color="gold">Chờ xác thực CAPTCHA</Tag>;
    if (error) return <Tag color="error">Thất bại</Tag>;
    return <Tag>Chưa chuẩn bị</Tag>;
  }, [artifact, busy, challenge, error]);

  if (!supportedHere) return null;

  const prepare = async () => {
    setBusy('prepare');
    setError('');
    setArtifact(null);
    try {
      const state = await api.prepareTvanPdfView(document);
      if (state.ready) {
        const readyArtifact = await api.prepareTvanArtifact(document);
        setArtifact(readyArtifact);
        setChallenge(null);
      } else if (state.challenge) {
        setChallenge(state.challenge);
        setAnswer('');
        setSliderValue(state.challenge.sliderStart ?? 0);
        setSliderTouched(false);
      } else {
        setError('Nhà cung cấp chưa trả được bước xác thực cần thiết.');
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không chuẩn bị được file hóa đơn.');
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!challenge) return;
    const isSlider = challenge.kind === 'slider';
    if (isSlider && !sliderTouched) {
      setError('Hãy kéo thanh trượt CAPTCHA trước khi xác thực.');
      return;
    }
    if (!isSlider && !answer.trim()) {
      setError('Hãy nhập mã CAPTCHA.');
      return;
    }
    setBusy('verify');
    setError('');
    try {
      const verificationAnswer = isSlider ? String(Math.round(sliderValue)) : answer.trim();
      await api.submitTvanCaptcha(challenge.id, verificationAnswer);
      const readyArtifact = await api.prepareTvanArtifact(document);
      setArtifact(readyArtifact);
      setChallenge(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không xác thực được CAPTCHA.');
    } finally {
      setBusy(null);
    }
  };

  const downloadOriginal = async () => {
    if (!artifact) return;
    setBusy('file');
    try {
      const blob = await api.downloadTvanArtifactFile(artifact.id);
      downloadBlob(blob, artifact.originalFileName);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không tải được file gốc.');
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = async () => {
    if (!artifact) return;
    setBusy('pdf');
    try {
      const blob = await api.downloadTvanArtifactPdf(artifact.id);
      downloadBlob(blob, artifact.pdfFileName);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không tải được PDF.');
    } finally {
      setBusy(null);
    }
  };

  return <Card size="small" title="File hóa đơn" style={{ marginTop: 16 }}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Backend chuẩn bị file an toàn; thông tin phiên và thông tin kỹ thuật của nhà cung cấp không được đưa xuống trình duyệt."
      />
      <Space><Text strong>Trạng thái:</Text>{stateLabel}</Space>
      {challenge && <Card size="small" type="inner" title="Xác thực CAPTCHA">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text>{challenge.prompt}</Text>
          {challenge.imageBase64 && <img
            src={`data:${challenge.imageMimeType || 'image/png'};base64,${challenge.imageBase64}`}
            alt="CAPTCHA hóa đơn"
            style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain' }}
          />}
          {challenge.kind === 'slider'
            ? <Slider
              min={0}
              max={Math.max(1, challenge.sliderMax ?? 280)}
              value={sliderValue}
              onChange={(value) => { setSliderValue(value); setSliderTouched(true); }}
            />
            : <Input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onPressEnter={() => void verify()}
              placeholder="Nhập mã CAPTCHA"
            />}
        </Space>
      </Card>}
      {artifact && <Alert
        type="success"
        showIcon
        message="File hóa đơn đã sẵn sàng"
        description={`File gốc: ${artifact.originalContentType === 'application/zip' ? 'ZIP' : 'PDF'} · PDF đã sẵn sàng để tải hoặc xem.`}
      />}
      {error && <Alert type="error" showIcon message={error} />}
      <Space wrap>
        <Button type="primary" loading={busy === 'prepare'} onClick={() => void prepare()}>
          Chuẩn bị file hóa đơn
        </Button>
        {challenge && <Button type="primary" loading={busy === 'verify'} onClick={() => void verify()}>
          Xác thực
        </Button>}
        <Button disabled={!artifact} loading={busy === 'file'} onClick={() => void downloadOriginal()}>
          Tải file gốc (ZIP/PDF)
        </Button>
        <Button disabled={!artifact} loading={busy === 'pdf'} onClick={() => void downloadPdf()}>
          Tải PDF
        </Button>
        <Button disabled={!artifact} onClick={() => artifact && window.open(api.tvanArtifactPdfUrl(artifact.id), '_blank')}>
          Xem PDF
        </Button>
      </Space>
    </Space>
  </Card>;
}
