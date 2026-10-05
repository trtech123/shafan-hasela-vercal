import {describe,expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';

// Exercise the real existing Edge entrypoint with fake auth clients; no network.
function harness(callerRole){
 const createUser=vi.fn().mockResolvedValue({data:{user:{id:'new-instructor'}},error:null});
 const upsert=vi.fn().mockResolvedValue({error:null});
 const caller={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:callerRole},error:null})})})})};
 const createClient=vi.fn().mockReturnValueOnce(caller).mockReturnValue({auth:{admin:{createUser}},from:()=>({upsert})});
 const source=readFileSync(new URL('../../../supabase/functions/create-user/index.ts',import.meta.url),'utf8').replace(/import \{ createClient \} from .*?;/,'');
 let handler;
 const Deno={env:{get:()=> 'synthetic-test-setting'},serve:fn=>{handler=fn;}};
 const js=transpileModule(source,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
 new Function('createClient','Deno',js)(createClient,Deno);
 return {handler,createClient,createUser,upsert};
}
const request=role=>new Request('https://example.invalid/create-user',{method:'POST',headers:{Authorization:'synthetic-test-session','Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.invalid',password:'synthetic-password',full_name:'Synthetic Instructor',role})});
describe('existing admin provisioning for instructor role',()=>{
 test('admin may provision instructor through existing authenticated mechanism',async()=>{
  const h=harness('admin');const result=await h.handler(request('instructor'));
  expect(result.status).toBe(200);expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({role:'instructor'}),expect.anything());
 });
 test.each(['instructor','cashier','operations'])('%s cannot provision users',async role=>{
  const h=harness(role);const result=await h.handler(request('instructor'));
  expect(result.status).toBe(403);expect(h.createUser).not.toHaveBeenCalled();expect(h.createClient).toHaveBeenCalledTimes(1);
 });
 test('arbitrary role remains rejected before privileged client creation',async()=>{
  const h=harness('admin');expect((await h.handler(request('superadmin'))).status).toBe(400);expect(h.createUser).not.toHaveBeenCalled();
 });
});
