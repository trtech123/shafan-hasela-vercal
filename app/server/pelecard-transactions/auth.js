const supabase='https://divzxsynczeifkpnpupl.supabase.co';
export async function authenticateAdmin(bearer,read,fetcher=fetch) {
 const key=read('VITE_SUPABASE_ANON_KEY');
 if(!key)throw Error('configuration_unavailable');
 const options=()=>({method:'GET',headers:{apikey:key,Authorization:bearer},redirect:'error',signal:AbortSignal.timeout(5000)});
 const auth=await fetcher(supabase+'/auth/v1/user',options());
 if(!auth.ok)return null;
 const user=await auth.json();
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user?.id??''))return null;
 const profile=await fetcher(supabase+'/rest/v1/profiles?select=role&id=eq.'+user.id,options());
 if(!profile.ok)return null;
 const rows=await profile.json();
 return Array.isArray(rows)&&rows.length===1&&typeof rows[0]?.role==='string'?rows[0].role:null;
}
