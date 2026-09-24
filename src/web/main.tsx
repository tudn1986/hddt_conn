import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import App from './App';
import 'antd/dist/reset.css';
import './ui-tokens.css';
import './invoice-page.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={viVN}
      theme={{
        token: {
          colorPrimary: '#1890ff',
          colorText: '#0f172a',
          colorTextSecondary: '#475569',
          colorBorder: '#cbd5e1',
          colorBgLayout: '#fafafa',
          borderRadius: 6,
          fontSize: 13,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
