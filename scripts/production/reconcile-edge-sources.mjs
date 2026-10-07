// Local-only reconstruction/verification. Never calls Supabase or any provider.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(root+'/docs/production-source/edge/manifest.json','utf8'));
const write=process.argv.includes('--write');
const norm=s=>s.replace(/\r\n/g,'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
let count=0,rewrites=0,typeOnlyFallbacks=0;
for(const [name,fn] of Object.entries(manifest.functions)) {
  const own='supabase/functions/'+name+'/';
  const mapped=p=>{
    if(p.startsWith(own))return p;
    if(p.startsWith('supabase/functions/_shared/'))return own+'_deployed_shared/'+p.slice('supabase/functions/_shared/'.length);
    assert.ok(p.startsWith('supabase/functions/'),'unexpected dependency location '+p);
    return own+'_deployed_functions/'+p.slice('supabase/functions/'.length);
  };
  for(const [p,file] of Object.entries(fn.files)) {
    const bytes=fs.readFileSync(root+'/'+file.blob);assert.equal(hash(bytes),file.sha256);
    const text=bytes.toString('utf8');assert.ok(!/import\.meta|Deno\.(read|open)|require\(/.test(text),'location-dependent code requires manual review');
    const destination=mapped(p);
    const sourceFile=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true);
    const edits=[];
    function visit(node){
      let literal,typeOnly=false;
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
        literal=node.moduleSpecifier;
        typeOnly=!!node.isTypeOnly||!!node.importClause?.isTypeOnly;
      } else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)literal=node.arguments[0];
      if(literal&&ts.isStringLiteral(literal)&&literal.text.startsWith('.')){
      const specifier=literal.text;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(p),specifier));
      // ESZIP omits erased type-only modules. Keep those declarations on the
      // existing repository path; they are never a deployed runtime dependency.
      if(!fn.files[target]){assert.ok(typeOnly&&fs.existsSync(root+'/'+target),'runtime dependency absent from deployed graph: '+p+' -> '+target);typeOnlyFallbacks++;}
      let relative=path.posix.relative(path.posix.dirname(destination),fn.files[target]?mapped(target):target);
      if(!relative.startsWith('.'))relative='./'+relative;
      if(relative!==specifier)rewrites++;
      edits.push({start:literal.getStart(sourceFile)+1,end:literal.getEnd()-1,text:relative});
      }
      ts.forEachChild(node,visit);
    }
    visit(sourceFile);
    let output=text;for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
    if(write){fs.mkdirSync(path.dirname(root+'/'+destination),{recursive:true});fs.writeFileSync(root+'/'+destination,output);}
    assert.equal(norm(fs.readFileSync(root+'/'+destination,'utf8')),norm(output),'source drift '+destination);
    count++;
  }
}
const config='project_id = "shafan-hasela"\n\n'+Object.entries(manifest.functions).map(([name,f])=>'[functions.'+name+']\nverify_jwt = '+f.verifyJwt+'\n').join('\n');
if(write)fs.writeFileSync(root+'/supabase/config.toml',config);
assert.equal(norm(fs.readFileSync(root+'/supabase/config.toml','utf8')),config);
console.log(JSON.stringify({functions:Object.keys(manifest.functions).length,sourceFiles:count,relativeImportRewrites:rewrites,typeOnlyFallbacks,allDeployedGraphsPreserved:true,remoteCalls:0}));
