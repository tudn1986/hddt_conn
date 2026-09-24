import React, { useState } from 'react';
import { Alert, Button, Card, Progress, Space, Typography, message } from 'antd';
import { api } from '../api/client';
import { localWorkspace } from '../storage/local-workspace';
import type { InvoiceDocument } from '../../shared/models/index.js';

const { Text } = Typography;

function locatorOf(document: InvoiceDocument) {
  return {
    sellerTaxCode: String(document.seller?.taxCode || ''),
    templateNo: document.templateNo ?? '',
    series: String(document.series || ''),
    invoiceNo: document.invoiceNo ?? '',
  };
}

export default function DownloadPage({ documents }: { documents: InvoiceDocument[] }) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);

  const download = async (types: Array<'xml' | 'zip'>) => {
    if (!documents.length) return message.warning('Chưa có hóa đơn được chọn. Quay lại Quản lý hóa đơn và chọn chứng từ cần tải.');
    setRunning(true); setCompleted(0); setFailed(0); setTotal(documents.length * types.length);
    let ok = 0; let errors = 0;
    for (const document of documents) {
      for (const type of types) {
        try {
          const result = await api.downloadFile({
            invoiceSource: document.invoiceSource || 'standard',
            locator: locatorOf(document),
            issueDate: document.issueDate,
            type,
          });
          await localWorkspace.saveBlob(result.blob, result.fileName);
          ok += 1;
          setCompleted(ok);
        } catch {
          errors += 1;
          setFailed(errors);
        }
      }
    }
    setRunning(false);
    if (errors) message.warning(`Đã lưu ${ok} file; ${errors} file lỗi.`);
    else message.success(`Đã lưu ${ok} file trên máy của bạn.`);
  };

  const percent = total ? Math.round(((completed + failed) / total) * 100) : 0;
  return (
    <Space direction="vertical" className="hddt-page-stack" size="middle">
      <Card title={`Tải XML / ZIP đã chọn (${documents.length.toLocaleString('vi-VN')} hóa đơn)`} size="small" className="hddt-section-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert showIcon type="info" message="Chỉ tải các hóa đơn đã chọn ở màn hình Quản lý hóa đơn"
            description="XML/ZIP được stream thẳng về trình duyệt và lưu vào nơi bạn đã chọn trong Cài đặt; các hóa đơn không được chọn sẽ không được đưa vào tác vụ tải." />
          <Space wrap>
            <Button type="primary" loading={running} disabled={!documents.length} onClick={() => void download(['xml'])}>Tải XML ({documents.length})</Button>
            <Button loading={running} disabled={!documents.length} onClick={() => void download(['zip'])}>Tải ZIP ({documents.length})</Button>
            <Button loading={running} disabled={!documents.length} onClick={() => void download(['xml', 'zip'])}>Tải XML + ZIP ({documents.length})</Button>
          </Space>
          {total > 0 && <>
            <Progress percent={percent} status={failed ? 'exception' : running ? 'active' : 'success'} />
            <Text>Hoàn tất {completed}/{total} · Lỗi {failed}</Text>
          </>}
        </Space>
      </Card>
    </Space>
  );
}
