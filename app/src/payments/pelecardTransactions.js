import {supabase} from '@/api/supabaseClient';
const errors=new Set(['unauthorized','forbidden','retrieval_disabled','invalid_request','range_too_large','provider_timeout','provider_unavailable','invalid_provider_response','conflicting_provider_records','configuration_unavailable']);
export async function requestPelecardTransactions(body,signal,client=supabase,fetcher=fetch) {
 const {data}=await client.auth.getSession();
 if(!data?.session?.access_token)throw Error('unauthorized');
 const response=await fetcher('/api/pelecard-transactions',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(body),signal});
 let result;try{result=await response.json()}catch{throw Error('provider_unavailable')}
 if(!response.ok)throw Error(errors.has(result?.error)?result.error:'provider_unavailable');
 if(!Array.isArray(result?.transactions)||result.transactions.length>500)throw Error('invalid_provider_response');
 return result;
}
