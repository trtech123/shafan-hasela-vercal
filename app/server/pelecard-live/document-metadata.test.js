import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocumentMetadata} from './document-metadata.js';

const url='https://cloud.tamal.co.il/GetDocument.aspx';
test('only documented root TamalData is considered',()=>{
 for(const value of [{},{ResultData:{TamalData:{InvoiceNumber:'12'}}},{PayperData:{InvoiceNumber:'12'}},null,[]])assert.equal(parseDocumentMetadata(value),null);
});
test('exact status and conservative invoice metadata remain unverified',()=>{
 const result=parseDocumentMetadata({TamalData:{InvoiceStatus:' 000',InvoiceNumber:'00123',InvoiceLink:url,InvoiceError:'',RawResponse:'{"private":"discard"}'}});
 assert.deepEqual(result,{schemaVersion:1,provider:'tamal',source:'pelecard_get_transaction',state:'unverified',invoiceStatus:' 000',invoiceNumber:'00123',invoiceUrl:url,errorPresent:false,errorCode:null,rawResponsePresent:true,metadataInvalid:false,urlReviewRequired:false});
 assert.ok(!JSON.stringify(result).includes('private'));
});
test('status values never assert successful issuance or normalize whitespace',()=>{
 for(const status of ['000',' 000','00','003','Success','OK']){const result=parseDocumentMetadata({TamalData:{InvoiceStatus:status}});assert.equal(result.invoiceStatus,status);assert.equal(result.state,'unverified');}
});
test('provider error text and RawResponse are never forwarded',()=>{
 const result=parseDocumentMetadata({TamalData:{InvoiceError:'sensitive customer or card text',RawResponse:{card:'sensitive'},Unexpected:'sensitive'}});
 assert.equal(result.errorPresent,true);assert.equal(result.errorCode,null);assert.equal(result.rawResponsePresent,true);assert.ok(!JSON.stringify(result).includes('sensitive'));
 assert.equal(parseDocumentMetadata({TamalData:{InvoiceError:'003'}}).errorCode,'003');
});
test('malformed or oversized fields are metadata failures only',()=>{
 for(const TamalData of [null,[],42,'private'])assert.equal(parseDocumentMetadata({TamalData}).metadataInvalid,true);
 for(const patch of [{InvoiceStatus:'x'.repeat(33)},{InvoiceStatus:'000\n'},{InvoiceNumber:'x'.repeat(65)},{InvoiceNumber:{}},{InvoiceNumber:-1},{InvoiceLink:42}])assert.equal(parseDocumentMetadata({TamalData:patch}).metadataInvalid,true);
});
test('only documented HTTPS host/path is eligible, unknown hosts await review',()=>{
 for(const link of ['https://evil.example/GetDocument.aspx?document=synthetic','https://cloud.tamal.co.il.evil.example/GetDocument.aspx']){const r=parseDocumentMetadata({TamalData:{InvoiceLink:link}});assert.equal(r.invoiceUrl,null);assert.equal(r.urlReviewRequired,true);}
 const query=parseDocumentMetadata({TamalData:{InvoiceLink:url+'?document=synthetic'}});assert.equal(query.invoiceUrl,null);assert.equal(query.urlReviewRequired,true);
 for(const link of ['http://cloud.tamal.co.il/GetDocument.aspx','https://u:p@cloud.tamal.co.il/GetDocument.aspx','https://cloud.tamal.co.il/GetDocument.aspx#secret','https://cloud.tamal.co.il:444/GetDocument.aspx','https://cloud.tamal.co.il/other','javascript:alert(1)',url+'\n']){const r=parseDocumentMetadata({TamalData:{InvoiceLink:link}});assert.equal(r.invoiceUrl,null);assert.equal(r.metadataInvalid,true);}
});
test('credential guard checks raw and decoded URL data before forwarding',()=>{
 const guard=value=>{if(String(value).includes('secret-value'))throw Error('provider_secret_echo');};
 for(const field of ['InvoiceStatus','InvoiceNumber','InvoiceLink','InvoiceError']){const value=field==='InvoiceLink'?url+'?private=secret%2Dvalue':'secret-value';const r=parseDocumentMetadata({TamalData:{[field]:value}},guard);assert.equal(r.metadataInvalid,true);assert.ok(!JSON.stringify(r).includes('secret'));}
});
