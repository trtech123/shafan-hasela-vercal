import { quotationDelivery } from '../_shared/quotation-delivery/runtime.ts';
Deno.serve(quotationDelivery('whatsapp'));
