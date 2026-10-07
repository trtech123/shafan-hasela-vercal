/** Reviewed Accounting.VatRate metadata; dispatch rechecks the current account.
 * Updating this policy requires a reviewed configuration migration as well. */
export const IMMEDIATE_VAT_POLICY={ratePercent:18,revision:'rivhit-account-2026-09-30'} as const;
export interface FrozenCustomerBilling {
 name:string;email:string;phone:string;companyId?:string;
 customerId?:string;customerSnapshotId?:string;customerVersion?:number;
 vatApplicable?:boolean|null;address?:string;city?:string;postalCode?:string;countryCode?:string;
}
export interface FrozenVat {
 applicable:boolean;configuredRatePercent:number;vatPercent:number;
 grossMinor:number;netMinor:number;vatMinor:number;policyRevision:string;
}
export function customerVat(grossMinor:number,applicable:unknown,ratePercent:number=IMMEDIATE_VAT_POLICY.ratePercent):FrozenVat {
 if(typeof applicable!=='boolean')throw Error('customer_vat_required');
 if(!Number.isSafeInteger(grossMinor)||grossMinor<1||!Number.isFinite(ratePercent)||ratePercent<=0||ratePercent>100)throw Error('accounting_vat_invalid');
 const vatPercent=applicable?ratePercent:0;
 const vatMinor=Math.round(grossMinor*vatPercent/(100+vatPercent));
 return {applicable,configuredRatePercent:ratePercent,vatPercent,grossMinor,netMinor:grossMinor-vatMinor,vatMinor,policyRevision:IMMEDIATE_VAT_POLICY.revision};
}
export function validateFrozenVat(vat:FrozenVat|undefined,grossMinor:number,applicable:unknown):FrozenVat {
 if(!vat)throw Error('customer_vat_required');
 const wanted=customerVat(grossMinor,applicable,vat.configuredRatePercent);
 if(Object.entries(wanted).some(([key,value])=>vat[key as keyof FrozenVat]!==value))throw Error('accounting_vat_invalid');
 return vat;
}
export function requireVerifiedVatIssuance(vat:FrozenVat){
 if(!vat.applicable)throw Error('vat_exemption_configuration_required');
}
