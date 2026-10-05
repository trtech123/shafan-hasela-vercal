import { renderToStaticMarkup } from 'react-dom/server';
import { buildQuotePdf } from '@/components/quotes/quotePdf';
import VoucherReport from './VoucherReport';

// Reuse the production renderer without changing quotation behavior. No remote
// delivery, storage or record mutation occurs when building/downloading a report.
export async function downloadVoucherReport(props, { signal } = {}) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<VoucherReport {...props} />);
  const pdf = await buildQuotePdf(host.firstElementChild, { signal });
  if (signal?.aborted) throw new Error('report_timeout');
  const pages = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFontSize(9); pdf.setTextColor(90);
    pdf.text(`${page} / ${pages}`, 105, 292, { align:'center' });
  }
  pdf.save(`hakafa-report-${props.generatedAt.slice(0,10)}.pdf`);
  return { count: props.rows.length, pages };
}
