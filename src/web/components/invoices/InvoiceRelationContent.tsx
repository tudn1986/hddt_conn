import React from 'react';
import { Button, Divider, Tag, Typography } from 'antd';
import type { RelationTooltipViewModel } from '../../../shared/invoice-relations/index.js';

const { Text, Paragraph } = Typography;

const MAX_VISIBLE_RELATED = 3;

function relationAvailabilityLabel(model: RelationTooltipViewModel): string | undefined {
  if (model.ambiguous) {
    return 'Có nhiều hóa đơn trùng locator trong dữ liệu hiện tại; ứng dụng không tự chọn bản ghi.';
  }
  if (!model.related.length) {
    if (model.mode === 'replaced-by') return 'Chưa có thông tin hóa đơn thay thế trong dữ liệu hiện tại.';
    if (model.mode === 'adjusted-by') return 'Chưa có thông tin hóa đơn điều chỉnh trong dữ liệu hiện tại.';
    return 'Chưa có thông tin hóa đơn liên quan trong dữ liệu hiện tại.';
  }
  if (model.related.some(item => !item.inDataset)) {
    return 'Hóa đơn gốc chưa có trong dữ liệu hiện tại.';
  }
  return undefined;
}

export function InvoiceRelationContent({
  model,
  onOpenInvoice,
}: {
  model: RelationTooltipViewModel;
  onOpenInvoice?: (key: string) => void;
}) {
  const visible = model.related.slice(0, MAX_VISIBLE_RELATED);
  const hiddenCount = Math.max(0, model.related.length - visible.length);
  const availability = relationAvailabilityLabel(model);

  return (
    <div className="invoice-relation-content">
      <div className="invoice-relation-heading">
        <Text strong>{model.title}</Text>
        {model.ambiguous && <Tag color="orange">Không xác định duy nhất</Tag>}
      </div>

      {visible.length > 0 && (
        <div className="invoice-relation-list">
          {visible.map((related, index) => {
            const body = (
              <>
                <div className="invoice-relation-related-main">
                  <Text strong>HĐ {related.invoiceNo || '—'}</Text>
                  {related.series && <Text>{related.series}</Text>}
                  {related.issuedDate && <Text type="secondary">{related.issuedDate}</Text>}
                </div>
                <div className="invoice-relation-related-meta">
                  {related.templateNo && <Text type="secondary">Mẫu {related.templateNo}</Text>}
                  <Text type={related.inDataset ? 'success' : 'secondary'}>
                    {model.ambiguous
                      ? 'Không xác định bản ghi'
                      : related.inDataset
                        ? 'Có trong dữ liệu'
                        : 'Ngoài dữ liệu hiện tại'}
                  </Text>
                </div>
              </>
            );

            if (related.invoiceKey && onOpenInvoice) {
              return (
                <Button
                  key={related.invoiceKey}
                  type="text"
                  className="invoice-relation-related-button"
                  onClick={() => onOpenInvoice(related.invoiceKey!)}
                >
                  {body}
                </Button>
              );
            }

            return (
              <div
                key={`${related.invoiceNo || 'invoice'}-${related.series || ''}-${index}`}
                className="invoice-relation-related-static"
              >
                {body}
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <Text type="secondary" className="invoice-relation-more">
          + {hiddenCount} hóa đơn khác
        </Text>
      )}

      {availability && (
        <div className="invoice-relation-availability">
          <Text type="secondary">{availability}</Text>
        </div>
      )}

      {model.description && (
        <>
          <Divider className="invoice-relation-divider" />
          <Paragraph
            className="invoice-relation-description"
            ellipsis={{ rows: 3, expandable: false }}
            title={model.description}
          >
            {model.description}
          </Paragraph>
        </>
      )}
    </div>
  );
}
