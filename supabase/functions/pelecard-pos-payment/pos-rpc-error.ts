import {PaymentHttpError} from '../pelecard-order-payment/_deployed_shared/payment-http.ts';

const reservationErrors:Record<string,number>={
  pos_payment_in_progress:409,
  catalog_item_unavailable:422,
  cart_invalid:422,
  cart_line_invalid:422,
  cart_amount_invalid:422,
  discount_invalid:422,
  request_key_conflict:409,
  pos_payment_forbidden:403,
};

export function classifyPosRpcError(error:unknown,operation:string):PaymentHttpError{
  if(operation==='reserve_pos_pelecard'&&error&&typeof error==='object'){
    const row=error as {code?:unknown;message?:unknown};
    const code=String(row.message??'');
    if((row.code==='23514'||row.code==='42501')&&Object.hasOwn(reservationErrors,code))
      return new PaymentHttpError(reservationErrors[code],code);
  }
  return new PaymentHttpError(502,'payment_database_unavailable');
}
