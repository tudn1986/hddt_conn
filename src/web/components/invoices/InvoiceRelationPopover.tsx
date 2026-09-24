import React, { useEffect, useState } from 'react';
import { Popover } from 'antd';
import type { InvoiceDocument } from '../../../shared/models/index.js';
import {
  buildRelationAriaLabel,
  relationDirectionSymbol,
  type RelationTooltipViewModel,
} from '../../../shared/invoice-relations/index.js';
import { InvoiceRelationContent } from './InvoiceRelationContent.js';

export function InvoiceRelationPopover({
  open,
  onOpenChange,
  content,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <Popover
      trigger={['hover', 'focus', 'click']}
      placement="topLeft"
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="invoice-relation-popover"
      content={content}
    >
      {children}
    </Popover>
  );
}

export function RelationIndicator({ mode }: { mode: RelationTooltipViewModel['mode'] }) {
  const symbol = relationDirectionSymbol(mode);
  if (!symbol) return null;
  return (
    <span className="invoice-relation-indicator" aria-hidden="true">
      {symbol}
    </span>
  );
}

export function InvoiceRelationTrigger({
  document,
  model,
  children,
  onOpenInvoice,
  showIndicator = true,
  className = '',
}: {
  document: InvoiceDocument;
  model?: RelationTooltipViewModel;
  children: React.ReactNode;
  onOpenInvoice?: (invoiceKey: string) => void;
  showIndicator?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (!model || model.mode === 'none') return <>{children}</>;

  return (
    <InvoiceRelationPopover
      open={open}
      onOpenChange={setOpen}
      content={(
        <InvoiceRelationContent
          model={model}
          onOpenInvoice={onOpenInvoice ? (invoiceKey) => {
            setOpen(false);
            onOpenInvoice(invoiceKey);
          } : undefined}
        />
      )}
    >
      <button
        type="button"
        className={`invoice-relation-trigger ${className}`.trim()}
        aria-label={buildRelationAriaLabel(document, model)}
        aria-expanded={open}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="invoice-relation-trigger-content">{children}</span>
        {showIndicator && <RelationIndicator mode={model.mode} />}
      </button>
    </InvoiceRelationPopover>
  );
}
