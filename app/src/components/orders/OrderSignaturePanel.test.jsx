// @vitest-environment jsdom
import {render,screen,fireEvent,cleanup,waitFor,act} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {PDFDocument,PDFName,PDFString,PDFRef} from 'pdf-lib';
import {Blob as BinaryBlob} from 'node:buffer';
import OrderSignaturePanel from './OrderSignaturePanel';
import {signatureRequest,downloadConfirmation} from '@/lib/orderSignatureClient';
vi.mock('@/lib/orderSignatureClient',()=>({signatureRequest:vi.fn(),downloadConfirmation:vi.fn(),signatureStateText:{signed:'חתום',expired:'פג תוקף',revoked:'בוטל',superseded:'הוחלף בגרסה חדשה',awaiting_signature:'ממתין לחתימה'}}));
vi.mock('../customers/CustomerSelector',()=>({default:()=>null}));
vi.mock('@/api/supabaseClient',()=>({supabase:{from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{id:'old',channel:'email',destination:'qa@example.test',state:'accepted',created_at:'2026-10-01'}]})})})})}}));
beforeEach(()=>{vi.clearAllMocks();HTMLElement.prototype.scrollIntoView=vi.fn();URL.createObjectURL=vi.fn(()=>`blob:protected-${URL.createObjectURL.mock.calls.length}`);URL.revokeObjectURL=vi.fn();signatureRequest.mockResolvedValue({revisions:[{id:'signed',revision_number:1,status:'signed',full_name:'ישראל ישראלי',signed_at:'2026-10-11T10:00:00Z',current_differs:true},{id:'pending',revision_number:2,status:'awaiting_signature',expires_at:'2026-10-18'}],deliveries:[]});});
afterEach(cleanup);
it('shows historical ID when present without labeling ID-free evidence as legacy',async()=>{
 signatureRequest.mockResolvedValue({revisions:[{id:'old',revision_number:1,status:'signed',full_name:'Legacy Signer',signed_at:'2026-10-11T10:00:00Z'},{id:'new',revision_number:2,status:'signed',full_name:'New Signer',signer_id:'012345674',signed_at:'2026-10-11T11:00:00Z'}],deliveries:[]});
 render(<OrderSignaturePanel orderId="order"/>);
 await screen.findByText('012345674');expect(screen.queryByText(/לפני דרישת תעודת זהות/)).toBeNull();
 expect(screen.getByText('012345674')).toBeTruthy();
 expect(screen.getByRole('button',{name:'הורדת האישור המקורי (ללא חתימה) — גרסה 1'})).toBeTruthy();
 expect(screen.getAllByText(/פרטי החתימה מופיעים בעמודים האחרונים/)).toHaveLength(2);
});
it('shows old signed revision, difference warning, protected download and legacy delivery history',async()=>{
 render(<OrderSignaturePanel orderId="order" email="qa@example.test"/>);
 await screen.findByText(/חתם\/ה: ישראל ישראלי/);expect(screen.getByText(/ההזמנה הנוכחית שונה/)).toBeTruthy();
 await screen.findByText(/היסטוריית שליחות קודמות/);
 signatureRequest.mockResolvedValueOnce(new Blob(['signed pdf']));fireEvent.click(screen.getByRole('button',{name:'הורדת האישור החתום — גרסה 1'}));
 await waitFor(()=>expect(downloadConfirmation).toHaveBeenCalled());
 expect(signatureRequest).toHaveBeenCalledWith({action:'pdf',revisionId:'signed',signed:true},{staff:true});
});
it('binds delivery to revision and never supplies browser PDF data',async()=>{
 render(<OrderSignaturePanel orderId="order" email="qa@example.test"/>);await screen.findByRole('button',{name:'שליחת האישור בוואטסאפ'});
 fireEvent.click(screen.getByRole('button',{name:'שליחת האישור בוואטסאפ'}));
 await waitFor(()=>expect(signatureRequest).toHaveBeenCalledWith(expect.objectContaining({action:'deliver',revisionId:'pending',channel:'whatsapp'}),{staff:true}));
 const body=signatureRequest.mock.calls.map(([body])=>body).find(body=>body.action==='deliver');expect(body.pdfBase64).toBeUndefined();expect(body.token).toBeUndefined();
});
it('offers explicit recovery after an old dispatched attempt, never an automatic resend',async()=>{
 signatureRequest.mockResolvedValue({revisions:[{id:'pending',revision_number:2,status:'pending',expires_at:'2026-10-18'}],deliveries:[{id:'attempt',revision_id:'pending',channel:'whatsapp',state:'dispatched',created_at:new Date(Date.now()-180000).toISOString()}]});
 render(<OrderSignaturePanel orderId="order" email="qa@example.test"/>);
 const resend=await screen.findByRole('button',{name:'שליחה חוזרת בוואטסאפ'});expect(resend.disabled).toBe(false);
 fireEvent.click(resend);expect(screen.getByRole('alertdialog')).toBeTruthy();
 expect(signatureRequest.mock.calls.some(([body])=>body.action==='deliver')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'אישור',exact:true}));
 await waitFor(()=>expect(signatureRequest).toHaveBeenCalledWith(expect.objectContaining({action:'deliver',resendOf:'attempt',confirmed:true}),{staff:true}));
});
it('allows staff to revoke an interrupted signing claim',async()=>{
 signatureRequest.mockResolvedValue({revisions:[{id:'signing',revision_number:2,status:'signing',expires_at:'2026-10-18'}],deliveries:[]});
 render(<OrderSignaturePanel orderId="order"/>);
 fireEvent.click(await screen.findByRole('button',{name:'ביטול קישור החתימה'}));
 fireEvent.click(screen.getByRole('button',{name:'אישור',exact:true}));
 await waitFor(()=>expect(signatureRequest).toHaveBeenCalledWith({action:'revoke',revisionId:'signing'},{staff:true}));
});

it('prepares without customer setup even when older history returns missing billing fields',async()=>{
 signatureRequest.mockImplementation(async body=>body.action==='create'?{signingUrl:'https://example.invalid/order-sign#test'}:{readiness:['active_customer','customer_snapshot','billing_identification','vat_applicable'],customerReview:{customerId:null,version:0},revisions:[],deliveries:[]});
 render(<OrderSignaturePanel orderId="order"/>);
 await screen.findByText('טרם הוכנה גרסת אישור לחתימה.');
 const prepare=screen.getByRole('button',{name:'הכנת אישור לחתימה'});
 expect(prepare.disabled).toBe(false);
 expect(screen.queryByRole('button',{name:'השלמת פרטי לקוח ועדכון ההזמנה'})).toBeNull();
 fireEvent.click(prepare);
 await screen.findByRole('button',{name:'העתקת קישור חתימה'});
 expect(signatureRequest).toHaveBeenCalledWith({action:'create',orderId:'order'},{staff:true});
 expect(signatureRequest.mock.calls.map(([body])=>body.action)).toEqual(['history','create','history']);
});

async function signedPdf(pages=5,openPage=null){const pdf=await PDFDocument.create();for(let n=0;n<pages;n++)pdf.addPage();if(openPage!==null)pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.obj([pdf.getPage(openPage).ref,PDFName.of('Fit')]));return new BinaryBlob([await pdf.save()],{type:'application/pdf'});}
it('previews the protected signed revision at its actual last page and downloads identical bytes',async()=>{
 const pdf=await signedPdf();render(<OrderSignaturePanel orderId="order"/>);
 await screen.findByText(/חתם\/ה: ישראל ישראלי/);
 signatureRequest.mockResolvedValueOnce(pdf);
 fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));
 const frame=await screen.findByTitle('האישור החתום — גרסה 1');
 expect(frame.getAttribute('src')).toBe('blob:protected-1#page=5&zoom=page-width');
 expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({block:'start',behavior:'smooth'});
 expect(HTMLElement.prototype.scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('region',{name:'תצוגת אישור חתום'}));
 expect(URL.createObjectURL).toHaveBeenCalledWith(pdf);
 expect(signatureRequest).toHaveBeenCalledWith({action:'pdf',revisionId:'signed',signed:true},{staff:true});
 fireEvent.click(screen.getByRole('button',{name:'הורדת המסמך המוצג (חתום) — גרסה 1'}));
 await waitFor(()=>expect(downloadConfirmation).toHaveBeenCalledWith(pdf,'order-confirmation-v1-signed.pdf'));
 expect(signatureRequest.mock.calls.filter(([body])=>body.action==='pdf')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'סגירת התצוגה החתומה'}));
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected-1');
 expect(screen.queryByTitle('האישור החתום — גרסה 1')).toBeNull();
});
it('reports signed preview failures without requesting an unsigned fallback',async()=>{
 render(<OrderSignaturePanel orderId="order"/>);await screen.findByText(/חתם\/ה: ישראל ישראלי/);
 signatureRequest.mockRejectedValueOnce(Error('artifact_unavailable'));
 fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));
 await screen.findByText('לא ניתן לפתוח את האישור החתום כרגע. נסו שוב.');
 expect(screen.queryByTitle('האישור החתום — גרסה 1')).toBeNull();
 expect(signatureRequest.mock.calls.filter(([body])=>body.action==='pdf').map(([body])=>body)).toEqual([{action:'pdf',revisionId:'signed',signed:true}]);
 expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('revokes protected preview URLs when changing revision and on unmount',async()=>{
 signatureRequest.mockResolvedValue({revisions:[{id:'one',revision_number:1,signed_at:'2026-10-11'},{id:'three',revision_number:3,signed_at:'2026-10-11'}]});
 const view=render(<OrderSignaturePanel orderId="order"/>);await screen.findByRole('button',{name:'צפייה באישור החתום — גרסה 1'});
 signatureRequest.mockResolvedValueOnce(await signedPdf(2));fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));await screen.findByTitle('האישור החתום — גרסה 1');
 signatureRequest.mockResolvedValueOnce(await signedPdf(7));fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 3'}));
 expect((await screen.findByTitle('האישור החתום — גרסה 3')).getAttribute('src')).toContain('#page=7');
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected-1');
 view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected-2');
});

it('does not create a protected URL when the pending preview resolves after unmount',async()=>{
 const pdf=await signedPdf();let resolvePdf;
 const view=render(<OrderSignaturePanel orderId="order"/>);await screen.findByRole('button',{name:'צפייה באישור החתום — גרסה 1'});
 signatureRequest.mockImplementationOnce(()=>new Promise(resolve=>{resolvePdf=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));
 await waitFor(()=>expect(resolvePdf).toBeTypeOf('function'));
 view.unmount();
 await act(async()=>{resolvePdf(pdf);await new Promise(resolve=>setTimeout(resolve,0));});
 expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('closes and revokes a signed preview when switching orders',async()=>{
 const view=render(<OrderSignaturePanel orderId="order"/>);await screen.findByRole('button',{name:'צפייה באישור החתום — גרסה 1'});
 signatureRequest.mockResolvedValueOnce(await signedPdf());fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));await screen.findByTitle('האישור החתום — גרסה 1');
 view.rerender(<OrderSignaturePanel orderId="other-order"/>);
 expect(screen.queryByTitle('האישור החתום — גרסה 1')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected-1');
 await waitFor(()=>expect(signatureRequest).toHaveBeenCalledWith({action:'history',orderId:'other-order'},{staff:true}));
});

it('opens the internal signature destination when evidence spans multiple appendix pages',async()=>{
 const pdf=await signedPdf(3,1);render(<OrderSignaturePanel orderId="order"/>);await screen.findByRole('button',{name:'צפייה באישור החתום — גרסה 1'});
 signatureRequest.mockResolvedValueOnce(pdf);fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));
 expect((await screen.findByTitle('האישור החתום — גרסה 1')).getAttribute('src')).toContain('#page=2');
});

it.each(['external action','foreign page'])('ignores %s destinations and falls back to the archived final page',async kind=>{
 const document=await PDFDocument.create();for(let n=0;n<3;n++)document.addPage();
 document.catalog.set(PDFName.of('OpenAction'),kind==='external action'?document.context.obj({S:PDFName.of('URI'),URI:PDFString.of('https://external.invalid')}):document.context.obj([PDFRef.of(999),PDFName.of('Fit')]));
 const pdf=new BinaryBlob([await document.save()],{type:'application/pdf'});
 render(<OrderSignaturePanel orderId="order"/>);await screen.findByRole('button',{name:'צפייה באישור החתום — גרסה 1'});
 signatureRequest.mockResolvedValueOnce(pdf);fireEvent.click(screen.getByRole('button',{name:'צפייה באישור החתום — גרסה 1'}));
 expect((await screen.findByTitle('האישור החתום — גרסה 1')).getAttribute('src')).toBe('blob:protected-1#page=3&zoom=page-width');
});
