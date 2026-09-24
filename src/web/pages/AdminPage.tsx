import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  Layout,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  LockOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type {
  TvanCatalogEndpoint,
  TvanCatalogFieldMapping,
  TvanCatalogListResult,
  TvanCatalogProvider,
  TvanCatalogProviderDetail,
  TvanCatalogStats,
} from '../../shared/models/index';

const { Header, Content } = Layout;
const { Title, Text, Link } = Typography;
const TOKEN_KEY = 'hddt_admin_token';

type AdminSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  authenticated: boolean;
  username?: string;
  ipHash?: string;
  userAgentHash?: string;
};

type AuditEvent = {
  at: string;
  action: string;
  sessionId: string;
  username?: string;
  ipHash?: string;
  detail?: Record<string, string | number | boolean | null>;
};

type AdminError = Error & { status?: number; code?: string };

type CatalogFilters = {
  q: string;
  providerCode: string;
  providerTaxCode: string;
  host: string;
  supported?: 'true' | 'false';
  source?: 'dataset_import' | 'gdt_query' | 'gdt_query_auto';
};

const emptyStats: TvanCatalogStats = {
  providers: 0,
  supportedProviders: 0,
  unsupportedProviders: 0,
  observedDocuments: 0,
  datasetImportDocuments: 0,
  gdtQueryDocuments: 0,
  gdtQueryAutoDocuments: 0,
  databasePath: '',
  schemaVersion: 2,
};

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

async function parseError(response: Response): Promise<AdminError> {
  let body: any = null;
  try { body = await response.json(); } catch { /* no-op */ }
  const error = new Error(body?.message || `HTTP ${response.status}`) as AdminError;
  error.status = response.status;
  error.code = body?.error;
  return error;
}

async function adminFetch<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

function sourceLabel(value: string): string {
  if (value === 'dataset_import') return 'Dataset import';
  if (value === 'gdt_query') return 'GDT query';
  if (value === 'gdt_query_auto') return 'GDT query-auto';
  return value;
}

export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(Boolean(token));
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [currentAdminSessionId, setCurrentAdminSessionId] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState('sessions');

  const [catalog, setCatalog] = useState<TvanCatalogListResult>({ items: [], total: 0, page: 1, pageSize: 50 });
  const [catalogStats, setCatalogStats] = useState<TvanCatalogStats>(emptyStats);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(50);
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>({ q: '', providerCode: '', providerTaxCode: '', host: '' });
  const [detail, setDetail] = useState<TvanCatalogProviderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadCsrf = useCallback(async () => {
    const response = await fetch('/api/app/status', { credentials: 'same-origin' });
    if (!response.ok) throw await parseError(response);
    const status = await response.json() as { csrfToken?: string };
    const value = status.csrfToken || '';
    setCsrfToken(value);
    return value;
  }, []);

  const handleAdminAuthError = useCallback((error: unknown) => {
    const adminError = error as AdminError;
    if (adminError.status === 401 || adminError.code === 'ADMIN_UNAUTHORIZED') {
      sessionStorage.removeItem(TOKEN_KEY);
      setAuthenticated(false);
      setToken('');
    }
  }, []);

  const loadCoreDashboard = useCallback(async (adminToken: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [sessionResponse, auditResponse] = await Promise.all([
        adminFetch<{ sessions: AdminSession[]; currentAdminSessionId?: string }>('/api/admin/sessions', adminToken),
        adminFetch<{ events: AuditEvent[] }>('/api/admin/audit?limit=200', adminToken),
      ]);
      setSessions(sessionResponse.sessions);
      setCurrentAdminSessionId(sessionResponse.currentAdminSessionId || '');
      setEvents([...auditResponse.events].reverse());
      setLastRefreshAt(new Date());
      setAuthenticated(true);
      if (!csrfToken) void loadCsrf().catch(() => undefined);
    } catch (error) {
      handleAdminAuthError(error);
      throw error;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [csrfToken, handleAdminAuthError, loadCsrf]);

  const loadCatalog = useCallback(async (
    adminToken: string,
    options: { page?: number; pageSize?: number; filters?: CatalogFilters; quiet?: boolean } = {},
  ) => {
    if (!options.quiet) setCatalogLoading(true);
    const page = options.page ?? catalogPage;
    const pageSize = options.pageSize ?? catalogPageSize;
    const filters = options.filters ?? catalogFilters;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: 'lastSeenAt', order: 'desc' });
      if (filters.q.trim()) params.set('q', filters.q.trim());
      if (filters.providerCode.trim()) params.set('providerCode', filters.providerCode.trim());
      if (filters.providerTaxCode.trim()) params.set('providerTaxCode', filters.providerTaxCode.trim());
      if (filters.host.trim()) params.set('host', filters.host.trim());
      if (filters.supported) params.set('supported', filters.supported);
      if (filters.source) params.set('source', filters.source);
      const [list, stats] = await Promise.all([
        adminFetch<TvanCatalogListResult>(`/api/admin/tvan-catalog?${params.toString()}`, adminToken),
        adminFetch<TvanCatalogStats>('/api/admin/tvan-catalog/stats', adminToken),
      ]);
      setCatalog(list);
      setCatalogStats(stats);
      setCatalogPage(list.page);
      setCatalogPageSize(list.pageSize);
    } catch (error) {
      handleAdminAuthError(error);
      throw error;
    } finally {
      if (!options.quiet) setCatalogLoading(false);
    }
  }, [catalogFilters, catalogPage, catalogPageSize, handleAdminAuthError]);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    void Promise.all([loadCoreDashboard(token, true), loadCatalog(token, { quiet: true })])
      .catch(() => sessionStorage.removeItem(TOKEN_KEY))
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (values: { token: string }) => {
    const supplied = values.token.trim();
    if (supplied.length < 32) { message.error('Admin Token phải có tối thiểu 32 ký tự.'); return; }
    setLoading(true);
    try {
      await Promise.all([loadCoreDashboard(supplied, true), loadCatalog(supplied, { quiet: true, page: 1 })]);
      sessionStorage.setItem(TOKEN_KEY, supplied);
      setToken(supplied);
      message.success('Đăng nhập quản trị thành công.');
    } catch (error) {
      const adminError = error as AdminError;
      if (adminError.code === 'ADMIN_DISABLED') message.error('Chức năng quản trị chưa được bật trên server.');
      else message.error(adminError.message || 'Admin Token không hợp lệ.');
    } finally { setLoading(false); }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(''); setAuthenticated(false); setSessions([]); setEvents([]); setCurrentAdminSessionId(''); setCsrfToken('');
    setCatalog({ items: [], total: 0, page: 1, pageSize: 50 }); setCatalogStats(emptyStats); setDetail(null);
  };

  const handleRefresh = async () => {
    try {
      if (activeTab === 'tvan') await loadCatalog(token);
      else await loadCoreDashboard(token);
      message.success('Đã làm mới dữ liệu quản trị.');
    } catch (error) { message.error((error as Error).message || 'Không thể làm mới dữ liệu.'); }
  };

  const revoke = async (session: AdminSession) => {
    let csrf = csrfToken; if (!csrf) csrf = await loadCsrf();
    setLoading(true);
    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/sessions/${encodeURIComponent(session.id)}`, token, { method: 'DELETE', headers: { 'X-HDDT-CSRF': csrf } });
      message.success(`Đã thu hồi phiên ${session.username || session.id.slice(0, 8)}.`);
      await loadCoreDashboard(token, true);
    } catch (error) { message.error((error as Error).message || 'Không thể thu hồi phiên.'); }
    finally { setLoading(false); }
  };

  const confirmRevoke = (session: AdminSession) => Modal.confirm({
    title: 'Thu hồi phiên này?',
    content: session.authenticated ? `Phiên MST ${session.username || 'không xác định'} sẽ bị đăng xuất và context/secret tạm thời sẽ bị hủy.` : 'Phiên trình duyệt này sẽ bị hủy.',
    okText: 'Revoke', okButtonProps: { danger: true }, cancelText: 'Hủy', onOk: () => revoke(session),
  });

  const openProviderDetail = async (provider: TvanCatalogProvider) => {
    setDetailLoading(true);
    try { setDetail(await adminFetch<TvanCatalogProviderDetail>(`/api/admin/tvan-catalog/${provider.id}`, token)); }
    catch (error) { message.error((error as Error).message || 'Không tải được chi tiết TVAN.'); }
    finally { setDetailLoading(false); }
  };

  const applyCatalogFilters = async () => {
    setCatalogPage(1);
    try { await loadCatalog(token, { page: 1, filters: catalogFilters }); }
    catch (error) { message.error((error as Error).message || 'Không thể lọc TVAN Catalog.'); }
  };

  const clearCatalogFilters = async () => {
    const cleared: CatalogFilters = { q: '', providerCode: '', providerTaxCode: '', host: '' };
    setCatalogFilters(cleared); setCatalogPage(1);
    try { await loadCatalog(token, { page: 1, filters: cleared }); } catch (error) { message.error((error as Error).message); }
  };

  const activeAuthenticated = useMemo(() => sessions.filter((item) => item.authenticated).length, [sessions]);

  if (checking) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Text>Đang xác thực phiên quản trị…</Text></div>;

  if (!authenticated) {
    return <Layout style={{ minHeight: '100vh' }}><Content style={{ display: 'grid', placeItems: 'center', padding: 24 }}><Card style={{ width: '100%', maxWidth: 460 }}>
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}><SafetyCertificateOutlined style={{ fontSize: 40 }} /><Title level={3} style={{ margin: '12px 0 4px' }}>HDDT Admin</Title><Text type="secondary">Quản trị phiên và TVAN Catalog</Text></div>
        <Alert type="info" showIcon message="Admin Token chỉ được giữ trong tab hiện tại (sessionStorage), không đưa vào URL." />
        <Form layout="vertical" onFinish={handleLogin}>
          <Form.Item label="Admin Token" name="token" rules={[{ required: true, message: 'Nhập Admin Token.' }, { min: 32, message: 'Token tối thiểu 32 ký tự.' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="off" placeholder="HDDT_ADMIN_TOKEN" autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>Đăng nhập quản trị</Button>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>Địa chỉ quản trị: {window.location.origin}/admin</Text>
      </Space>
    </Card></Content></Layout>;
  }

  const sessionColumns: any[] = [
    { title: 'Username / MST', dataIndex: 'username', width: 150, render: (value?: string) => value ? <Text strong>{value}</Text> : <Text type="secondary">—</Text> },
    { title: 'Trạng thái', dataIndex: 'authenticated', width: 120, render: (value: boolean) => value ? <Tag color="success">Đã login GDT</Tag> : <Tag>Chưa login</Tag> },
    { title: 'Tạo lúc', dataIndex: 'createdAt', width: 175, render: formatDate },
    { title: 'Hoạt động gần nhất', dataIndex: 'lastSeenAt', width: 175, render: formatDate },
    { title: 'Hết hạn', dataIndex: 'expiresAt', width: 175, render: formatDate },
    { title: 'IP hash', dataIndex: 'ipHash', width: 180, render: (value: string) => value || '—' },
    { title: '', width: 105, fixed: 'right' as const, render: (_: unknown, record: AdminSession) => <Button danger size="small" icon={<DeleteOutlined />} disabled={record.id === currentAdminSessionId} onClick={() => confirmRevoke(record)}>Revoke</Button> },
  ];

  const auditColumns: any[] = [
    { title: 'Thời gian', dataIndex: 'at', width: 175, render: formatDate },
    { title: 'Action', dataIndex: 'action', width: 180, render: (value: string) => <Tag>{value}</Tag> },
    { title: 'Username / MST', dataIndex: 'username', width: 150, render: (value: string) => value || '—' },
    { title: 'Session ID', dataIndex: 'sessionId', width: 210, ellipsis: true },
    { title: 'IP hash', dataIndex: 'ipHash', width: 180, render: (value: string) => value || '—' },
    { title: 'Chi tiết', dataIndex: 'detail', render: (value?: Record<string, unknown>) => value && Object.keys(value).length ? <Text code>{JSON.stringify(value)}</Text> : <Text type="secondary">—</Text> },
  ];

  const catalogColumns: any[] = [
    { title: 'MST solution', dataIndex: 'solutionProviderTaxCode', width: 145, render: (value: string | undefined, row: TvanCatalogProvider) => <Space direction="vertical" size={0}><Text strong>{value || '—'}</Text><Text type="secondary" style={{ fontSize: 12 }}>{row.displayName}</Text></Space> },
    { title: 'Transport code', dataIndex: 'transportProviderCode', width: 155, render: (value?: string) => value || '—' },
    { title: 'MST transport', dataIndex: 'transportProviderTaxCode', width: 140, render: (value?: string) => value || '—' },
    { title: 'PDF provider', dataIndex: 'presentationProviderCode', width: 160, render: (value?: string) => value || '—' },
    { title: 'Adapter', dataIndex: 'adapterSupported', width: 105, render: (value: boolean) => value ? <Tag color="success">Supported</Tag> : <Tag color="warning">Chưa hỗ trợ</Tag> },
    { title: 'PDF', dataIndex: 'pdfSupported', width: 75, render: (value: boolean) => value ? <Tag color="success">Có</Tag> : <Tag>Không</Tag> },
    { title: 'CAPTCHA', dataIndex: 'captchaMode', width: 105, render: (value?: string) => value || '—' },
    { title: 'Portal / Host', width: 260, render: (_: unknown, row: TvanCatalogProvider) => <Space direction="vertical" size={2}>{row.primaryPortal ? <Text code>{row.primaryPortal}</Text> : null}<Text type="secondary" ellipsis>{row.observedHosts.join(', ') || '—'}</Text></Space> },
    { title: 'Documents', dataIndex: 'seenDocuments', width: 100 },
    { title: 'Dataset', dataIndex: 'seenDatasetImport', width: 90 },
    { title: 'GDT', dataIndex: 'seenGdtQuery', width: 80 },
    { title: 'Query-auto', dataIndex: 'seenGdtQueryAuto', width: 95 },
    { title: 'First seen', dataIndex: 'firstSeenAt', width: 175, render: formatDate },
    { title: 'Last seen', dataIndex: 'lastSeenAt', width: 175, render: formatDate },
    { title: '', width: 90, fixed: 'right' as const, render: (_: unknown, row: TvanCatalogProvider) => <Button size="small" icon={<EyeOutlined />} onClick={() => openProviderDetail(row)}>Chi tiết</Button> },
  ];

  const endpointColumns: any[] = [
    { title: 'Kind', dataIndex: 'kind', width: 130 }, { title: 'Origin', dataIndex: 'origin', width: 280, render: (value: string) => <Text code>{value}</Text> },
    { title: 'Path pattern', dataIndex: 'pathPattern', render: (value: string) => <Text code>{value}</Text> }, { title: 'Seen', dataIndex: 'seenCount', width: 80 },
  ];
  const mappingColumns: any[] = [
    { title: 'Role', dataIndex: 'semanticRole', width: 150 }, { title: 'Field', dataIndex: 'fieldName', width: 180 },
    { title: 'Path', dataIndex: 'fieldPath', render: (value: string) => <Text code>{value}</Text> }, { title: 'Seen', dataIndex: 'seenCount', width: 80 },
  ];

  const sessionsTab = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={8}><Card><Statistic title="Phiên đang hoạt động" value={sessions.length} prefix={<UserOutlined />} /></Card></Col>
      <Col xs={24} sm={8}><Card><Statistic title="Đã đăng nhập GDT" value={activeAuthenticated} /></Card></Col>
      <Col xs={24} sm={8}><Card><Statistic title="Audit đang hiển thị" value={events.length} /></Card></Col>
    </Row>
    <Card title="Danh sách session đang hoạt động"><Table<AdminSession> rowKey="id" columns={sessionColumns} dataSource={sessions} loading={loading} size="small" pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1200 }} /></Card>
  </Space>;

  const catalogTab = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="Catalog lưu riêng solution, transport và PDF provider trong SQLite; không lưu raw invoice, XML/PDF, lookup code, token hoặc cookie." />
    <Row gutter={[16, 16]}>
      <Col xs={12} md={6}><Card><Statistic title="Provider records" value={catalogStats.providers} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="Có adapter" value={catalogStats.supportedProviders} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="Documents quan sát" value={catalogStats.observedDocuments} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="Query-auto" value={catalogStats.gdtQueryAutoDocuments} /></Card></Col>
    </Row>
    <Card size="small" title="Tìm kiếm / lọc">
      <Space wrap>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tên / MST / provider / host" value={catalogFilters.q} onChange={(e) => setCatalogFilters((v) => ({ ...v, q: e.target.value }))} onPressEnter={applyCatalogFilters} style={{ width: 230 }} />
        <Input allowClear placeholder="Legacy provider code" value={catalogFilters.providerCode} onChange={(e) => setCatalogFilters((v) => ({ ...v, providerCode: e.target.value }))} style={{ width: 170 }} />
        <Input allowClear placeholder="Legacy MST" value={catalogFilters.providerTaxCode} onChange={(e) => setCatalogFilters((v) => ({ ...v, providerTaxCode: e.target.value }))} style={{ width: 150 }} />
        <Input allowClear placeholder="Host" value={catalogFilters.host} onChange={(e) => setCatalogFilters((v) => ({ ...v, host: e.target.value }))} style={{ width: 190 }} />
        <Select allowClear placeholder="Adapter" value={catalogFilters.supported} onChange={(value) => setCatalogFilters((v) => ({ ...v, supported: value }))} style={{ width: 150 }} options={[{ value: 'true', label: 'Supported' }, { value: 'false', label: 'Chưa hỗ trợ' }]} />
        <Select allowClear placeholder="Nguồn" value={catalogFilters.source} onChange={(value) => setCatalogFilters((v) => ({ ...v, source: value }))} style={{ width: 160 }} options={['dataset_import', 'gdt_query', 'gdt_query_auto'].map((value) => ({ value, label: sourceLabel(value) }))} />
        <Button type="primary" onClick={applyCatalogFilters} loading={catalogLoading}>Lọc</Button>
        <Button onClick={clearCatalogFilters}>Xóa lọc</Button>
      </Space>
    </Card>
    <Card title="Provider Catalog" extra={<Text type="secondary">DB schema {catalogStats.schemaVersion} · {catalogStats.databasePath || '—'}</Text>}>
      <Table<TvanCatalogProvider>
        rowKey="id" columns={catalogColumns} dataSource={catalog.items} loading={catalogLoading} size="small" scroll={{ x: 1950 }}
        pagination={{ current: catalog.page, pageSize: catalog.pageSize, total: catalog.total, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], showTotal: (total) => `${total} providers`, onChange: (page, pageSize) => void loadCatalog(token, { page, pageSize }) }}
      />
    </Card>
  </Space>;

  const auditTab = <Card title="Audit log (200 sự kiện gần nhất)"><Table<AuditEvent> rowKey={(record) => `${record.at}:${record.sessionId}:${record.action}`} columns={auditColumns} dataSource={events} loading={loading} size="small" pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1100 }} /></Card>;

  return <Layout style={{ minHeight: '100vh' }}>
    <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 20 }}>
      <Space><SafetyCertificateOutlined style={{ color: '#fff', fontSize: 22 }} /><Text style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>HDDT Admin</Text></Space>
      <Space><Button href="/admin/backport">TVAN Backport</Button><Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading || catalogLoading}>Refresh</Button><Button danger ghost icon={<LogoutOutlined />} onClick={handleLogout}>Đăng xuất Admin</Button></Space>
    </Header>
    <Content style={{ padding: 20 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="Thông tin quản trị" size="small"><Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Server">{window.location.host}</Descriptions.Item><Descriptions.Item label="Lần refresh">{lastRefreshAt ? formatDate(lastRefreshAt.toISOString()) : '—'}</Descriptions.Item><Descriptions.Item label="Admin browser session">{currentAdminSessionId ? `${currentAdminSessionId.slice(0, 10)}…` : '—'}</Descriptions.Item>
        </Descriptions></Card>
        <Tabs activeKey={activeTab} onChange={(key) => { setActiveTab(key); if (key === 'tvan') void loadCatalog(token, { quiet: true }).catch(() => undefined); }} items={[
          { key: 'sessions', label: 'Sessions', children: sessionsTab }, { key: 'tvan', label: `Provider Catalog (${catalogStats.providers})`, children: catalogTab }, { key: 'audit', label: 'Audit log', children: auditTab },
        ]} />
      </Space>
    </Content>
    <Drawer title={detail ? `${detail.displayName} · ${detail.solutionProviderTaxCode || detail.providerCode || detail.id}` : 'Provider detail'} width={900} open={Boolean(detail) || detailLoading} loading={detailLoading} onClose={() => setDetail(null)}>
      {detail ? <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="MST solution">{detail.solutionProviderTaxCode || '—'}</Descriptions.Item><Descriptions.Item label="Transport code">{detail.transportProviderCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="MST transport">{detail.transportProviderTaxCode || '—'}</Descriptions.Item><Descriptions.Item label="PDF provider">{detail.presentationProviderCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Legacy provider code">{detail.providerCode || '—'}</Descriptions.Item><Descriptions.Item label="Legacy MST">{detail.providerTaxCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Adapter">{detail.adapterSupported ? <Tag color="success">Supported</Tag> : <Tag color="warning">Chưa hỗ trợ</Tag>}</Descriptions.Item><Descriptions.Item label="CAPTCHA">{detail.captchaMode || '—'}</Descriptions.Item>
          <Descriptions.Item label="First seen">{formatDate(detail.firstSeenAt)}</Descriptions.Item><Descriptions.Item label="Last seen">{formatDate(detail.lastSeenAt)}</Descriptions.Item>
          <Descriptions.Item label="Documents">{detail.seenDocuments}</Descriptions.Item><Descriptions.Item label="Portal">{detail.primaryPortal && !detail.primaryPortal.includes('<') ? <Link href={detail.primaryPortal} target="_blank" rel="noopener noreferrer">{detail.primaryPortal}</Link> : detail.primaryPortal || '—'}</Descriptions.Item>
        </Descriptions>
        <Card size="small" title="Aliases"><Space wrap>{detail.aliases.map((item) => <Tag key={`${item.type}:${item.value}`}>{item.type}: {item.value} · {item.seenCount}</Tag>)}</Space></Card>
        <Card size="small" title="Portal / lookup mapping"><Table<TvanCatalogEndpoint> rowKey={(row) => `${row.kind}:${row.origin}:${row.pathPattern}`} columns={endpointColumns} dataSource={detail.endpoints} size="small" pagination={false} scroll={{ x: 800 }} /></Card>
        <Card size="small" title="Field mappings"><Table<TvanCatalogFieldMapping> rowKey={(row) => `${row.semanticRole}:${row.fieldName}:${row.fieldPath}`} columns={mappingColumns} dataSource={detail.fieldMappings} size="small" pagination={{ pageSize: 20 }} scroll={{ x: 800 }} /></Card>
      </Space> : null}
    </Drawer>
  </Layout>;
}
