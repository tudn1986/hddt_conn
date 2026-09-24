import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import type { TvanBackportAnalysis } from '../../shared/models/index.js';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

type BackportForm = {
  providerCode: string;
  rawJson?: string;
  rawXml?: string;
  notes?: string;
};

async function adminRequest<T>(path: string, adminToken: string, csrfToken: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${adminToken}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
    headers.set('X-HDDT-CSRF', csrfToken || String((await (await fetch('/api/app/status', { credentials: 'same-origin' })).json()).csrfToken || ''));
  }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function TvanBackportPage() {
  const adminToken = sessionStorage.getItem('hddt_admin_token') || '';
  const [csrfToken] = useState('');
  const [form] = Form.useForm<BackportForm>();
  const [analysis, setAnalysis] = useState<TvanBackportAnalysis | null>(null);
  const [samples, setSamples] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    try { setSamples((await adminRequest<{ samples: any[] }>('/api/admin/tvan-backport/samples', adminToken, csrfToken)).samples || []); }
    catch { setSamples([]); }
  };

  useEffect(() => { void reload(); }, []);

  const values = (): BackportForm => {
    const value = form.getFieldsValue();
    return {
      providerCode: String(value.providerCode || '').trim(),
      rawJson: value.rawJson?.trim() || undefined,
      rawXml: value.rawXml?.trim() || undefined,
      notes: value.notes?.trim() || undefined,
    };
  };

  const analyze = async () => {
    setLoading(true);
    try {
      const response = await adminRequest<{ analysis: TvanBackportAnalysis }>('/api/admin/tvan-backport/analyze', adminToken, csrfToken, { method: 'POST', body: JSON.stringify(values()) });
      setAnalysis(response.analysis);
      message.success('Backend đã phân tích payload TVAN.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không phân tích được payload.');
    } finally { setLoading(false); }
  };

  const save = async () => {
    setLoading(true);
    try {
      const response = await adminRequest<{ sample: any }>('/api/admin/tvan-backport/samples', adminToken, csrfToken, { method: 'POST', body: JSON.stringify(values()) });
      setAnalysis(response.sample.analysis);
      await reload();
      message.success('Đã lưu mẫu backport cục bộ để bổ sung adapter TVAN.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không lưu được mẫu backport.');
    } finally { setLoading(false); }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="TVAN Backport — thu thập payload cho nhà cung cấp chưa hỗ trợ"
        description="Dán raw JSON và/hoặc XML quan sát được từ DevTools. Backend chỉ phân tích và lưu cục bộ; dữ liệu ở trang này không được dùng làm URL proxy thực thi. Khi adapter TVAN đã có, người dùng cuối chỉ thao tác CAPTCHA, không phải nhập mã tra cứu/API."
      />

      <Card size="small" title="Payload mẫu">
        <Form form={form} layout="vertical" initialValues={{ providerCode: '' }}>
          <Form.Item
            name="providerCode"
            label="Mã TVAN"
            rules={[{ required: true, message: 'Nhập mã TVAN, ví dụ tvan_fpt.' }]}
          >
            <Input placeholder="tvan_fpt / tvan_bkav / ..." maxLength={80} />
          </Form.Item>
          <Form.Item name="rawJson" label="Raw JSON request/response">
            <TextArea rows={10} spellCheck={false} placeholder={'{\n  "...": "..."\n}'} />
          </Form.Item>
          <Form.Item name="rawXml" label="Raw XML">
            <TextArea rows={10} spellCheck={false} placeholder="<HDon>...</HDon>" />
          </Form.Item>
          <Form.Item name="notes" label="Ghi chú quan sát">
            <TextArea rows={3} placeholder="Ví dụ: endpoint này trả PDF; token dùng được nhiều hóa đơn; CAPTCHA bắt buộc mỗi lần..." />
          </Form.Item>
          <Space>
            <Button onClick={() => void analyze()} loading={loading}>Phân tích</Button>
            <Button type="primary" onClick={() => void save()} loading={loading}>Lưu mẫu backport</Button>
          </Space>
        </Form>
      </Card>

      {analysis && (
        <Card size="small" title={`Kết quả phân tích · ${analysis.providerCode}`}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div>
              {analysis.notes.map((note) => <Tag key={note}>{note}</Tag>)}
            </div>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>URL quan sát được:</Text> {analysis.urls.length ? analysis.urls.join(' · ') : '—'}
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>Mã tra cứu ứng viên:</Text> {analysis.lookupCandidates.length ? analysis.lookupCandidates.join(' · ') : '—'}
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>MST ứng viên:</Text> {analysis.taxCodeCandidates.length ? analysis.taxCodeCandidates.join(' · ') : '—'}
            </Paragraph>
            <Table
              size="small"
              rowKey={(_, index) => String(index)}
              pagination={{ pageSize: 20 }}
              dataSource={analysis.detectedFields}
              columns={[
                { title: 'Nguồn', dataIndex: 'source', width: 80 },
                { title: 'Trường', dataIndex: 'name', width: 220 },
                { title: 'Giá trị', dataIndex: 'value', ellipsis: true },
              ]}
            />
          </Space>
        </Card>
      )}

      <Card size="small" title={`Mẫu đã lưu (${samples.length})`}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 20 }}
          dataSource={samples}
          columns={[
            { title: 'TVAN', dataIndex: 'providerCode', width: 150 },
            { title: 'Thời điểm', dataIndex: 'createdAt', width: 210 },
            { title: 'JSON', dataIndex: 'hasJson', width: 70, render: (value) => value ? 'Có' : '—' },
            { title: 'XML', dataIndex: 'hasXml', width: 70, render: (value) => value ? 'Có' : '—' },
            { title: 'Ghi chú', dataIndex: 'notes', ellipsis: true },
          ]}
        />
      </Card>
    </Space>
  );
}
