import { requireAdmin, corsHeaders, json, HttpError } from './_deployed_shared/admin.ts';
import { RivhitClient, RivhitError } from './_deployed_shared/rivhit/client.ts';
import { handleImmediateAction, ImmediateError } from './_deployed_shared/rivhit/immediate-handler.ts';
import { SupabaseImmediateRepository } from './_deployed_shared/rivhit/immediate-repository.ts';

// Preparation and read-only provider recovery only. No issuance capability here.
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try{
    const {adminClient,caller}=await requireAdmin(req);
    let body:unknown;
    try{body=await req.json();}catch{throw new ImmediateError('invalid_json',400);}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ImmediateError('invalid_request',400);
    const result=await handleImmediateAction(body as Record<string,unknown>,caller.id,new SupabaseImmediateRepository(adminClient),()=>{
      const token=Deno.env.get('RIVHIT_API_TOKEN');
      if(!token)throw new ImmediateError('provider_not_configured',503);
      const client=new RivhitClient({apiToken:token});
      return {lookupDocumentRequest:(reference)=>client.lookupDocumentRequest(reference),getDocumentDetails:(type,number)=>client.getDocumentDetails(type,number),getDocumentCopy:(type,number)=>client.getDocumentCopy(type,number)};
    });
    return json({ok:true,...result});
  }catch(error){
    if(error instanceof HttpError)return json({ok:false,error:error.message},error.status);
    if(error instanceof ImmediateError)return json({ok:false,error:error.code,issuanceHeld:true},error.status);
    if(error instanceof Error&&/^(customer_vat_required|customer_snapshot_required|customer_snapshot_invalid|vat_exemption_configuration_required|accounting_vat_configuration_required|accounting_vat_invalid|check_general_register_required)$/.test(error.message))return json({ok:false,error:error.message,issuanceHeld:true},409);
    if(error instanceof RivhitError)return json({ok:false,error:'reconciliation_required',reconciliationRequired:true,issuanceHeld:true},409);
    if(error instanceof Error&&/^(invalid_billing_(name|email|phone|company_id)|invalid_check_(account|date)|invalid_accounting_integer|invalid_order_number)$/.test(error.message))return json({ok:false,error:error.message,issuanceHeld:true},400);
    // Never return raw database/provider errors, which can contain billing data.
    return json({ok:false,error:'accounting_request_failed',issuanceHeld:true},500);
  }
});
