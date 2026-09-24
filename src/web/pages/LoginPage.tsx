import React, { useEffect, useRef, useState } from 'react';
import { Card, Form, Input, Button, Checkbox, Typography, Space, message, Image, Alert, Divider, Segmented } from 'antd';
import { FolderOpenOutlined, LoginOutlined, ReloadOutlined } from '@ant-design/icons';
import { api, type AppStatus } from '../api/client';

const { Title, Text, Paragraph } = Typography;

interface Props {
  connectorMode: 'live' | 'mock';
  capabilities?: AppStatus['capabilities'];
  onSuccess: () => void | Promise<void>;
  onDataset: (dataset: any) => void;
  onConnectorModeChanged: () => void | Promise<void>;
}

export default function LoginPage({
  connectorMode,
  capabilities,
  onSuccess,
  onDataset,
  onConnectorModeChanged,
}: Props) {
  const [form] = Form.useForm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [ckey, setCkey] = useState('');
  const [captchaImg, setCaptchaImg] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [modeChanging, setModeChanging] = useState(false);

  const loadCaptcha = async () => {
    setLoadingCaptcha(true);
    try {
      const data = await api.getCaptcha();
      setCkey(data.ckey);
      setCaptchaImg(data.captchaImageBase64);
      form.setFieldValue('captcha', '');
    } catch (error) {
      setCkey('');
      setCaptchaImg('');
      message.error(error instanceof Error ? error.message : 'Không lấy được Captcha');
    } finally {
      setLoadingCaptcha(false);
    }
  };

  useEffect(() => {
    void loadCaptcha();
    void api.getAccounts().then((accounts) => {
      if (accounts.lastUsername) form.setFieldValue('username', accounts.lastUsername);
    }).catch(() => undefined);
  }, [connectorMode]);

  const changeMode = async (value: string | number) => {
    const mode = value === 'mock' ? 'mock' : 'live';
    if (mode === connectorMode) return;
    setModeChanging(true);
    try {
      await api.saveSettings({ app: { connectorMode: mode } });
      await onConnectorModeChanged();
      message.success(mode === 'live' ? 'Đã chuyển sang GDT live' : 'Đã chuyển sang dữ liệu demo');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không đổi được chế độ kết nối');
    } finally {
      setModeChanging(false);
    }
  };

  const onFinish = async (values: {
    username: string;
    password: string;
    captcha: string;
    rememberUsername?: boolean;
  }) => {
    if (!ckey) {
      message.warning('Hãy tải lại Captcha trước khi đăng nhập.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.login({
        username: values.username.trim(),
        password: values.password,
        captcha: values.captcha.trim(),
        ckey,
        rememberUsername: values.rememberUsername === true,
      });
      if (!result.success) throw new Error(result.message || 'Đăng nhập thất bại');
      form.setFieldValue('password', '');
      message.success(result.message || 'Đăng nhập thành công');
      await onSuccess();
    } catch (error) {
      form.setFieldValue('password', '');
      message.error(error instanceof Error ? error.message : 'Lỗi đăng nhập');
      await loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const importDataset = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      message.error('Dataset vượt giới hạn 200 MB mặc định.');
      return;
    }
    setLoading(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const dataset = await api.importDataset(parsed);
      onDataset(dataset);
      message.success(`Đã mở ${dataset.meta?.recordCount ?? 0} chứng từ, không cần đăng nhập GDT.`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Dataset JSON không hợp lệ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'linear-gradient(135deg, #3155a6 0%, #593b8f 100%)' }}>
      <Card style={{ width: 460, maxWidth: '100%', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={3} style={{ marginBottom: 4 }}>hddt_conn</Title>
            <Text type="secondary">Tra cứu hóa đơn điện tử</Text>
          </div>

          {connectorMode === 'mock' ? (
            <Alert type="warning" showIcon message="Chế độ demo" description="Dùng MST hợp lệ bất kỳ, mật khẩu bất kỳ và Captcha AB12. Không có request nào gửi tới GDT." />
          ) : (
            <Alert
              type={capabilities?.liveSales ? 'success' : 'info'}
              showIcon
              message="Kết nối trực tiếp hoadondientu.gdt.gov.vn"
              description={capabilities?.liveSales
                ? 'Mua vào, bán ra, chi tiết và tải XML/ZIP đã được cấu hình.'
                : 'Mua vào, chi tiết và export-xml dùng endpoint đã quan sát. Endpoint bán ra chưa được xác minh nên ứng dụng sẽ báo rõ thay vì đoán endpoint.'}
            />
          )}

          <Form form={form} layout="vertical" initialValues={{ rememberUsername: true }} onFinish={onFinish}>
            <Form.Item name="username" label="MST / Tài khoản" rules={[{ required: true, message: 'Nhập MST' }, { pattern: /^\d{10}(?:-\d{3})?$/, message: 'MST phải có 10 số hoặc dạng 10 số-3 số' }]}>
              <Input autoComplete="username" placeholder="Ví dụ: 0101234567" size="large" maxLength={14} />
            </Form.Item>
            <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
              <Input.Password autoComplete="current-password" size="large" maxLength={512} />
            </Form.Item>
            <Form.Item label="Captcha">
              <Space>
                {captchaImg ? (
                  <Image src={captchaImg} width={160} height={50} preview={false} alt="Captcha" style={{ objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 4 }} />
                ) : <div style={{ width: 160, height: 50, background: '#f0f0f0' }} />}
                <Button aria-label="Làm mới Captcha" icon={<ReloadOutlined />} loading={loadingCaptcha} onClick={() => void loadCaptcha()} />
              </Space>
            </Form.Item>
            <Form.Item name="captcha" rules={[{ required: true, message: 'Nhập Captcha' }]}>
              <Input placeholder="Nhập mã Captcha" size="large" maxLength={64} autoComplete="off" />
            </Form.Item>
            <Form.Item name="rememberUsername" valuePropName="checked">
              <Checkbox>Ghi nhớ MST (ứng dụng không lưu mật khẩu)</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={loading} icon={<LoginOutlined />}>Đăng nhập</Button>
          </Form>

          <Divider plain>hoặc</Divider>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importDataset} />
          <Button block size="large" icon={<FolderOpenOutlined />} loading={loading} onClick={() => fileInput.current?.click()}>
            Mở dataset JSON ngoại tuyến
          </Button>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
            Dataset có dữ liệu doanh nghiệp/đối tác. Chỉ mở file tin cậy và cân nhắc trước khi chia sẻ.
          </Paragraph>
        </Space>
      </Card>
    </div>
  );
}
