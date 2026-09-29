import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Typography, Button, Space, Tag, message, Spin, Modal, Tooltip } from 'antd';
import {
  AccountBookOutlined,
  ClearOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { api, type AppStatus } from './api/client';
import type { DatasetFile, InvoiceDocument } from '../shared/models/index.js';
import type { InvoiceMenuActions } from './pages/InvoicePage';
import { authoritativeCoverageRange } from './storage/dataset-coverage';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const InvoicePage = lazy(() => import('./pages/InvoicePage'));
const DownloadPage = lazy(() => import('./pages/DownloadPage'));
const AccountingExportPage = lazy(() => import('./pages/AccountingExportPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminBackportPage = lazy(() => import('./pages/TvanBackportPage'));

const { Header, Content } = Layout;
const { Text } = Typography;
type PageKey = 'invoices' | 'downloads' | 'accounting' | 'settings';

function PageFallback() {
  return <div style={{ display: 'grid', minHeight: 240, placeItems: 'center' }}><Spin tip="Đang tải giao diện..." /></div>;
}

type OpenedDataset = DatasetFile;

function MainApp() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineTaxCode, setOfflineTaxCode] = useState<string | null>(null);
  const [page, setPage] = useState<PageKey>('invoices');
  const [documents, setDocuments] = useState<InvoiceDocument[]>([]);
  const [direction, setDirection] = useState<'purchase' | 'sales'>('purchase');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  /** Last fully covered dataset range; distinct from the range currently requested in the UI. */
  const [coverageRange, setCoverageRange] = useState<[string, string] | null>(null);
  const [openedDatasetScope, setOpenedDatasetScope] = useState<'full' | 'selection' | null>(null);
  const [invoiceMenuActions, setInvoiceMenuActions] = useState<InvoiceMenuActions | null>(null);
  const [selectedInvoiceKeys, setSelectedInvoiceKeys] = useState<React.Key[]>([]);
  const selectedDocuments = useMemo(() => {
    if (!selectedInvoiceKeys.length) return [];
    const selectedKeys = new Set(selectedInvoiceKeys);
    return documents.filter((document) => selectedKeys.has(document.key));
  }, [documents, selectedInvoiceKeys]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (error) {
      setStatus(null);
      message.error(error instanceof Error ? error.message : 'Không kết nối được local server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    const expired = () => {
      setStatus((current) => current ? { ...current, authenticated: false, session: null } : current);
      message.warning('Phiên GDT đã hết hạn. Đăng nhập lại để tiếp tục các tác vụ trực tuyến.');
    };
    window.addEventListener('hddt-session-expired', expired);
    return () => window.removeEventListener('hddt-session-expired', expired);
  }, []);

  const openDataset = (dataset: OpenedDataset) => {
    const docs = (dataset.documents || []).map((item) => item.normalized);
    setDocuments(docs);
    if (dataset.meta?.direction) setDirection(dataset.meta.direction);
    if (dataset.meta?.fromDate && dataset.meta?.toDate) {
      const range: [string, string] = [dataset.meta.fromDate, dataset.meta.toDate];
      setDateRange(range);
      const authoritativeRange = authoritativeCoverageRange(dataset);
      setCoverageRange(authoritativeRange);
      setOpenedDatasetScope(authoritativeRange ? 'full' : 'selection');
    }
    setOfflineTaxCode(dataset.meta?.accountTaxCode || null);
    setSelectedInvoiceKeys([]);
    setOfflineMode(true);
    setPage('invoices');
  };

  const updateCoverageRange = useCallback((range: [string, string] | null) => {
    setCoverageRange(range);
    if (range) setOpenedDatasetScope('full');
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
      setStatus((current) => current ? { ...current, authenticated: false, session: null } : current);
      message.success('Đã đăng xuất; dữ liệu đang mở vẫn được giữ trong RAM.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Lỗi đăng xuất');
    }
  };

  const handleExit = () => {
    Modal.confirm({
      title: 'Thoát HDDT?',
      content: 'Các tác vụ chưa hoàn tất và dữ liệu chưa lưu có thể bị mất.',
      okText: 'Thoát',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await api.exit(false);
        } catch (error: any) {
          if (error?.code === 'TASKS_ACTIVE') {
            Modal.confirm({
              title: 'Đang có tác vụ tải file',
              content: 'Bạn có chắc muốn dừng tác vụ và thoát?',
              okText: 'Buộc thoát',
              okButtonProps: { danger: true },
              onOk: () => api.exit(true).catch(() => undefined),
            });
          } else {
            message.error(error?.message || 'Không thể thoát ứng dụng');
          }
        }
      },
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="Đang khởi động HDDT..." />
      </div>
    );
  }

  const authenticated = status?.authenticated === true;
  if (!authenticated && !offlineMode) {
    return (
      <Suspense fallback={<PageFallback />}>
      <LoginPage
        connectorMode={status?.connectorMode || 'live'}
        capabilities={status?.capabilities}
        onSuccess={async () => {
          setOfflineMode(false);
          await refreshStatus();
        }}
        onDataset={openDataset}
        onConnectorModeChanged={refreshStatus}
      />
      </Suspense>
    );
  }

  const username = status?.session?.username || offlineTaxCode || '';
  const menuItems = [
    { key: 'purchase', icon: <FileTextOutlined />, label: 'Mua vào' },
    {
      key: 'sales',
      icon: <FileTextOutlined />,
      label: (
        <Space size={6}>
          Bán ra
          {authenticated && !status?.capabilities?.liveSales && (
            <Tag color="warning">chưa cấu hình live</Tag>
          )}
        </Space>
      ),
    },
    {
      key: 'downloads',
      icon: <DownloadOutlined />,
      label: `Tải hóa đơn XML${selectedDocuments.length ? ` (${selectedDocuments.length})` : ''}`,
      disabled: !authenticated || selectedDocuments.length === 0,
    },
    {
      key: 'accounting',
      icon: <AccountBookOutlined />,
      label: 'Kết xuất Form PMKT',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Cài đặt',
    },
  ];

  const selectedMenuKey = page === 'invoices' ? direction : page;

  const handleMenuClick = (key: string) => {
    if (key === 'purchase' || key === 'sales') {
      if (key !== direction) setSelectedInvoiceKeys([]);
      setDirection(key);
      setPage('invoices');
      return;
    }

    setPage(key as PageKey);
  };

  return (
    <Layout className="app-shell" style={{ minHeight: '100vh' }}>
      <Header className="app-header app-topbar">
        <div className="app-topbar-left" aria-label="Điều hướng và tác vụ dữ liệu">
          <Menu
            className="app-topbar-menu"
            theme="dark"
            mode="horizontal"
            selectedKeys={[selectedMenuKey]}
            items={menuItems}
            onClick={({ key }) => handleMenuClick(key)}
          />

          {page === 'invoices' && invoiceMenuActions && (
            <div className="app-topbar-data-actions" aria-label="Tác vụ dữ liệu hóa đơn">
              <Tooltip title="Lưu dataset hiện tại">
                <Button className="app-topbar-action-button" size="small" icon={<SaveOutlined />} onClick={invoiceMenuActions.saveData} disabled={!invoiceMenuActions.hasDocuments}>Lưu dữ liệu</Button>
              </Tooltip>
              <Tooltip title="Mở dataset JSON đã lưu">
                <Button className="app-topbar-action-button" size="small" icon={<FolderOpenOutlined />} onClick={invoiceMenuActions.openData}>Mở dữ liệu</Button>
              </Tooltip>
              <Tooltip title={invoiceMenuActions.selectedCount ? `Xuất ${invoiceMenuActions.selectedCount} hóa đơn/chứng từ đã chọn ra Excel` : 'Chọn hóa đơn trong bảng trước khi xuất Excel'}>
                <Button className="app-topbar-action-button" size="small" icon={<FileExcelOutlined />} onClick={invoiceMenuActions.exportExcel} disabled={invoiceMenuActions.selectedCount === 0}>Xuất Excel{invoiceMenuActions.selectedCount ? ` (${invoiceMenuActions.selectedCount})` : ''}</Button>
              </Tooltip>
              <Tooltip title={invoiceMenuActions.selectedCount ? `Tải XML cho ${invoiceMenuActions.selectedCount} hóa đơn đã chọn` : 'Chọn hóa đơn trong bảng trước khi tải XML'}>
                <Button className="app-topbar-action-button" size="small" icon={<DownloadOutlined />} onClick={invoiceMenuActions.queueXml} disabled={!authenticated || invoiceMenuActions.selectedCount === 0}>Tải XML{invoiceMenuActions.selectedCount ? ` (${invoiceMenuActions.selectedCount})` : ''}</Button>
              </Tooltip>
              <Tooltip title={invoiceMenuActions.selectedCount ? `Tải PDF bản thể hiện cho ${invoiceMenuActions.selectedCount} hóa đơn đã chọn` : 'Chọn hóa đơn trong bảng trước khi tải PDF'}>
                <Button className="app-topbar-action-button" size="small" icon={<FilePdfOutlined />} onClick={invoiceMenuActions.exportPdf} disabled={invoiceMenuActions.selectedCount === 0}>Tải PDF{invoiceMenuActions.selectedCount ? ` (${invoiceMenuActions.selectedCount})` : ''}</Button>
              </Tooltip>
              <Tooltip title="Xóa bộ lọc cột và lọc nhanh">
                <Button className="app-topbar-action-button" size="small" icon={<ClearOutlined />} onClick={invoiceMenuActions.clearFilters}>Xóa lọc</Button>
              </Tooltip>
              {invoiceMenuActions.hasQueryResult && (
                <Tooltip title="Xem kết quả và cảnh báo của lần tra cứu gần nhất">
                  <Button className="app-topbar-action-button" size="small" icon={<InfoCircleOutlined />} danger={invoiceMenuActions.warningCount > 0} onClick={invoiceMenuActions.showLastResult}>
                    Kết quả{invoiceMenuActions.warningCount ? ` (${invoiceMenuActions.warningCount})` : ''}
                  </Button>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        <div className="app-topbar-brand" title={offlineMode && !authenticated ? 'Dataset ngoại tuyến' : status?.connectorMode === 'mock' ? 'Kết nối MOCK' : 'Kết nối GDT LIVE'}>
          <img
            src="/branding/hddt_conn_web_logo_horizontal.svg"
            alt="hddt_conn"
            className="app-topbar-brand-logo"
          />
        </div>

        <Space className="app-session-group" size={4}>
          <Text className="app-session-tax-code">MST: {username || '—'}</Text>
          {authenticated ? (
            <Tooltip title="Đăng xuất khỏi phiên GDT nhưng giữ dữ liệu đang mở trong RAM">
              <Button type="text" icon={<LogoutOutlined />} className="app-header-text-button" onClick={handleLogout} aria-label="Đăng xuất" />
            </Tooltip>
          ) : (
            <Button type="text" className="app-header-text-button" onClick={() => { setOfflineMode(false); setPage('invoices'); }}>Đăng nhập GDT</Button>
          )}
          <Button type="text" danger className="app-header-exit-button" onClick={handleExit}>Thoát</Button>
        </Space>
      </Header>

      <Content className="app-content">
        <Suspense fallback={<PageFallback />}>
          {page === 'invoices' && (
            <InvoicePage
              documents={documents}
              setDocuments={setDocuments}
              direction={direction}
              dateRange={dateRange}
              setDateRange={setDateRange}
              coverageRange={coverageRange}
              setCoverageRange={updateCoverageRange}
              openedDatasetScope={openedDatasetScope}
              username={username}
              authenticated={authenticated}
              capabilities={status?.capabilities}
              onDataset={openDataset}
              selectedDocuments={selectedDocuments}
              selectedRowKeys={selectedInvoiceKeys}
              setSelectedRowKeys={setSelectedInvoiceKeys}
              onMenuActionsChange={setInvoiceMenuActions}
            />
          )}
          {page === 'downloads' && authenticated && <DownloadPage documents={selectedDocuments} />}
          {page === 'accounting' && <AccountingExportPage documents={selectedDocuments} direction={direction} />}
          {page === 'settings' && <SettingsPage />}
        </Suspense>
      </Content>
    </Layout>
  );
}


export default function App() {
  const path = window.location.pathname;
  if (path === '/admin/backport' || path === '/admin/backport/') {
    return <Suspense fallback={<PageFallback />}><AdminBackportPage /></Suspense>;
  }
  if (path === '/admin' || path === '/admin/') {
    return <Suspense fallback={<PageFallback />}><AdminPage /></Suspense>;
  }
  return <MainApp />;
}
