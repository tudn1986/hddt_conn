import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Slider, Space, Tag, Typography } from 'antd';
import type { InvoiceDocument, TvanCaptchaChallenge, TvanPresentationLinkResult } from '../../shared/models/index.js';
import { providerResearchFor } from '../../shared/provider-research.js';
import { api } from '../api/client';

const { Link, Text } = Typography;

const PUBLIC_PROVIDER_NAMES = new Set([
  'MISA',
  'VIETTEL',
  'SOFTDREAMS',
  'PVOIL',
  'M-INVOICE',
  'EHOADONDIENTU',
]);

const CAPTCHA_PROVIDER_NAMES = new Set([
  'VIETTEL',
  'SOFTDREAMS',
  'PVOIL',
]);

const PROVIDER_NAME_BY_CODE: Record<string, string> = {
  tvan_misa: 'MISA',
  tvan_viettel: 'VIETTEL',
  tvan_softdreams: 'SOFTDREAMS',
  tvan_pvoil: 'PVOIL',
  tvan_invoice: 'M-INVOICE',
  ehoadondientu: 'EHOADONDIENTU',
};

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

export default function InvoiceProviderResearchPanel({
  document,
  authenticated: _authenticated,
}: {
  document: InvoiceDocument;
  authenticated: boolean;
}) {
  const research = useMemo(() => providerResearchFor(document), [document]);
  const providerName = providerNameOf(document, research.providerName);
  const supported = PUBLIC_PROVIDER_NAMES.has(providerName);
  const captchaExpected = CAPTCHA_PROVIDER_NAMES.has(providerName);

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

  const publicPortals = useMemo(
    () => research.portals.filter(item => item.label !== 'URL quan sát trong Raw JSON'),
    [research.portals],
  );
  const lookupPortal = publicPortals.find(item => !/portal/i.test(item.label)) || publicPortals[0];
  const providerPortal = publicPortals.find(item => /portal/i.test(item.label));
  const lookupUrl = lookupPortal?.url;
  const portalUrl = providerPortal?.url || portalRoot(lookupUrl);

  const lookupCode = resolved?.lookupCode || research.lookupCode;
  const lookupCodeType = research.lookupCodeType || 'Mã tra cứu';

  const resolveLookup = async () => {
    setLookupBusy(true);
    setLookupError(null);
    try {
      setResolved(await api.resolvePresentationLink(document));
    } catch {
      setResolved(null);
      setLookupError('Chưa lấy được thông tin tra cứu. Vui lòng thử lại.');
    } finally {
      setLookupBusy(false);
    }
  };

  const loadCaptcha = async () => {
    setCaptchaBusy(true);
    setCaptchaError(null);
    setCaptchaVerified(false);
    try {
      const prepared = await api.preparePresentation(document);
      if (prepared.challenge) {
        setChallenge(prepared.challenge);
        setCaptchaAnswer('');
        setSliderValue(prepared.challenge.sliderStart ?? 0);
        setSliderTouched(false);
      } else {
        setChallenge(null);
        setCaptchaVerified(true);
      }
    } catch {
      setChallenge(null);
      setCaptchaError('Chưa lấy được CAPTCHA. Vui lòng thử lại.');
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
    try {
      const answer = isSlider ? String(Math.round(sliderValue)) : captchaAnswer.trim();
      await api.submitPresentationChallenge(challenge.id, answer);
      setCaptchaVerified(true);
      setChallenge(null);
      setCaptchaAnswer('');
      setSliderTouched(false);
    } catch {
      setCaptchaError('CAPTCHA chưa đúng hoặc đã hết hạn. Vui lòng thử lại.');
    } finally {
      setCaptchaBusy(false);
    }
  };

  if (!supported) {
    return (
      <Alert
        type="info"
        showIcon
        message="Nhà cung cấp này hiện chưa hỗ trợ xem/tải bản thể hiện PDF."
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Nhà cung cấp hóa đơn điện tử">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="NCC HĐĐT">{providerName}</Descriptions.Item>
          <Descriptions.Item label="MSTTCGP">
            <Text code>{research.solutionTaxCode || '—'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Trạng thái" span={2}>
            <Tag color="success">Có thể xem / tải PDF bản thể hiện</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title="Mã tra cứu">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label={lookupCodeType} span={2}>
            {lookupCode
              ? <Text code copyable>{lookupCode}</Text>
              : <Text type="secondary">Chưa có trong dữ liệu hiện tại</Text>}
          </Descriptions.Item>
        </Descriptions>
        {!lookupCode && (
          <Button
            style={{ marginTop: 12 }}
            loading={lookupBusy}
            onClick={() => void resolveLookup()}
          >
            Lấy thông tin tra cứu
          </Button>
        )}
        {lookupError && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={lookupError} />}
      </Card>

      <Card size="small" title="Portal / Link tra cứu hóa đơn">
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Link tra cứu">
            {lookupUrl
              ? <Link href={lookupUrl} target="_blank" rel="noreferrer">{lookupUrl}</Link>
              : <Text type="secondary">Chưa có trong dữ liệu hiện tại</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Portal tra cứu">
            {portalUrl
              ? <Link href={portalUrl} target="_blank" rel="noreferrer">{portalUrl}</Link>
              : <Text type="secondary">Chưa có trong dữ liệu hiện tại</Text>}
          </Descriptions.Item>
          {resolved?.downloadUrl && (
            <Descriptions.Item label="Link bản thể hiện">
              <Link href={resolved.downloadUrl} target="_blank" rel="noreferrer">
                Mở bản thể hiện PDF
              </Link>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card size="small" title="CAPTCHA">
        {!captchaExpected ? (
          <Text type="secondary">Nhà cung cấp này không yêu cầu CAPTCHA cho luồng hiện tại.</Text>
        ) : captchaVerified ? (
          <Alert type="success" showIcon message="Đã xác thực. Có thể tiếp tục xem/tải PDF." />
        ) : challenge ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
                    style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 6 }}
                  />
                )}
                <Input
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  onPressEnter={() => void verifyCaptcha()}
                  placeholder="Nhập CAPTCHA"
                />
              </>
            )}

            <Button type="primary" loading={captchaBusy} onClick={() => void verifyCaptcha()}>
              Xác thực CAPTCHA
            </Button>
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
