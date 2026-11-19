import { quotationDelivery } from './_deployed_shared/quotation-delivery/runtime.ts';
Deno.serve(quotationDelivery('whatsapp'));
