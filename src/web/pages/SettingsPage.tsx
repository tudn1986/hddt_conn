import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Typography, message } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { localWorkspace } from '../storage/local-workspace';

const { Text, Paragraph } = Typography;

export default function SettingsPage() {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void localWorkspace.currentName().then(setFolderName); }, []);

  const choose = async () => {
    setBusy(true);
    try {
      const name = await localWorkspace.choose();
      setFolderName(name);
      message.success(`Đã chọn nơi lưu: ${name}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không chọn được nơi lưu dữ liệu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Cài đặt" size="small" style={{ maxWidth: 720 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          showIcon
          type="info"
          message="Dữ liệu hóa đơn chỉ lưu trên máy tính của bạn"
          description="Máy chủ không giữ dataset JSON, XML, ZIP hoặc PDF. Quyền truy cập thư mục do trình duyệt quản lý và có thể được hỏi lại sau khi đóng trình duyệt."
        />
        <div>
          <Text strong>Nơi lưu hiện tại</Text>
          <Paragraph style={{ marginBottom: 0 }}>
            {folderName || 'Chưa chọn — file sẽ được tải qua hộp Downloads của trình duyệt.'}
          </Paragraph>
        </div>
        <Button type="primary" icon={<FolderOpenOutlined />} loading={busy} onClick={() => void choose()}>
          Chọn nơi lưu dữ liệu
        </Button>
        {!localWorkspace.supported() && (
          <Alert
            showIcon
            type="warning"
            message="Trình duyệt chưa hỗ trợ File System Access API"
            description="Ứng dụng vẫn hoạt động an toàn và sẽ tải từng file về thư mục Downloads theo cấu hình của trình duyệt. Khuyến nghị Chrome hoặc Edge phiên bản mới qua HTTPS."
          />
        )}
      </Space>
    </Card>
  );
}
