import { RivhitError } from './client.ts';
import { safeRivhitDocumentUrl, type reconcileImmediateDocument } from './reconciliation.ts';

export interface DocumentCopyClient {getDocumentCopy(documentType:number,documentNumber:number):Promise<unknown>}
/** Official Document.Copy returns a copy of an existing document; it cannot
 * issue, cancel or email. Call only after Status + Details verified the identity.
 * https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/GetDocumentCopy */
export async function recoverImmediateArtifact(client:DocumentCopyClient,verified:Awaited<ReturnType<typeof reconcileImmediateDocument>>){
  if(verified.status!=='artifact_required')return verified;
  const number=Number(verified.document.documentNumber);
  if(verified.document.documentType!==2||!Number.isSafeInteger(number)||number<1||!verified.document.documentId)throw new RivhitError('Document artifact identity is invalid',{reconciliationRequired:true});
  try{
    const value=await client.getDocumentCopy(2,number);
    if(!value||typeof value!=='object'||Array.isArray(value))return verified;
    const copy=value as Record<string,unknown>;
    const url=safeRivhitDocumentUrl(copy.document_link);
    // Copy's GUID identifies the generated artifact, not the immutable issued
    // document: repeated DEMO copies of one number return different GUIDs.
    // Keep the original Status identity and bind this copy to its response URL.
    const artifactId=copy.document_identity;
    if(copy.document_type!==2||String(copy.document_number)!==verified.document.documentNumber||typeof artifactId!=='string'||
      !/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(artifactId)||
      !url||!url.toLowerCase().includes(artifactId.toLowerCase()))return verified;
    return {...verified,status:'succeeded' as const,document:{...verified.document,documentUrl:url}};
  }catch{
    // Retain confirmed document identity even when the artifact endpoint fails.
    return verified;
  }
}
