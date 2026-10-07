// Type declarations only; recovered from existing integration source.
// Runtime implementations are deliberately excluded: production bundles erase these imports.
import type {ApprovedImmediatePreparation} from './immediate-dispatch.ts';
export interface ImmediateCustomerClaim {claimed:boolean;requestReference:string;customerId?:string|null}

export interface ImmediateCustomerRepository {
  claimCustomer(preparation:ApprovedImmediatePreparation,actorId:string):Promise<ImmediateCustomerClaim>;
  persistCustomer(preparation:ApprovedImmediatePreparation,actorId:string,customerId:string):Promise<{customerId:string;accountingCustomerId:string;accountNamespace:string}>;
}

export interface ImmediateCustomerClient {
  createCustomer(request:{last_name:string;email:string;phone:string;id_number?:number;request_reference:string;exempt_vat:boolean}):Promise<{customerId:string}>;
  lookupCustomerRequest(reference:string):Promise<{customerId:string}>;
  getCustomerById(id:string):Promise<{customerId:string;name:string;email:string;phone:string;companyId?:string;exemptVat?:boolean}>;
}
