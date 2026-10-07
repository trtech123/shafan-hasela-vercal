// Type-only declaration recovered from existing local integration source.
// The deployed ESZIP bundles erase this dependency; no runtime implementation is included.
export interface OrderPaymentView {
 order_id:string;order_number:string;amount:number|string;payment_status:string;order_status:string;
 payment_id:string|null;payment_state:string|null;payment_amount:number|string|null;payment_currency:string|null;sale_id:string|null;
 provider_session_id:string|null;provider_redirect_url:string|null;controlled:boolean;accounting_held:boolean;init_enabled:boolean;
}
