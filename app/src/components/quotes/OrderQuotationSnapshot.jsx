import { useState } from 'react';
import { Button } from '@/components/ui/button';
import QuotePDFDocument from './QuotePDFDocument';

// Read-only companion to the existing order/payment workflow.
export default function OrderQuotationSnapshot({ order }) {
  const [open,setOpen] = useState(false);
  if (!order?.quotation_snapshot) return null;
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>תכולה מהצעת מחיר</Button>{open && <QuotePDFDocument mode="order" quote={{...order.quotation_snapshot,order_number:order.order_number}} onClose={() => setOpen(false)}/>}</>;
}
