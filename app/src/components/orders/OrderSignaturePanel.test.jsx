// @vitest-environment jsdom
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import OrderSignaturePanel from './OrderSignaturePanel';
import {signatureRequest,downloadConfirmation} from '@/lib/orderSignatureClient';
vi.mock('@/lib/orderSignatureClient',()=>({signatureRequest:vi.fn(),downloadConfirmation:vi.fn(),signatureStateText:{signed:'חתום',expired:'פג תוקף',revoked:'בוטל',superseded:'הוחלף בגרסה חדשה',awaiting_signature:'ממתין לחתימה'}}));
vi.mock('../customers/CustomerSelector',()=>({default:()=>null}));
vi.mock('@/api/supabaseClient',()=>({supabase:{from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{id:'old',channel:'email',destination:'qa@example.test',state:'accepted',created_at:'2026-10-01'}]})})})})}}));
beforeEach(()=>{vi.clearAllMocks();signatureRequest.mockResolvedValue({revisions:[{id:'signed',revision_number:1,status:'signed',full_name:'ישראל ישראלי',signed_at:'2026-10-11T10:00:00Z',current_differs:true},{id:'pending',revision_number:2,status:'awaiting_signature',expires_at:'2026-10-18'}],deliveries:[]});});
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

it('blocks preparation with actionable billing readiness details',async()=>{
 signatureRequest.mockResolvedValue({readiness:['billing_identification','customer_snapshot'],revisions:[],deliveries:[]});
 render(<OrderSignaturePanel orderId="order"/>);
 await screen.findByText(/מספר הזיהוי של הלקוח לחיוב/);
 expect(screen.getByRole('button',{name:'הכנת אישור לחתימה'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'השלמת פרטי לקוח ועדכון ההזמנה'})).toBeTruthy();
});

it('keeps actionable guidance and disables preparation when readiness recovery fails',async()=>{
 let histories=0;
 signatureRequest.mockImplementation(async body=>{
  if(body.action==='create')throw Error('billing_customer_incomplete');
  if(++histories>1)throw Error('offline');
  return {readiness:[],revisions:[],deliveries:[]};
 });
 render(<OrderSignaturePanel orderId="order"/>);
 await screen.findByText('טרם הוכנה גרסת אישור לחתימה.');
 fireEvent.click(screen.getByRole('button',{name:'הכנת אישור לחתימה'}));
 await screen.findByText('יש להשלים את פרטי הלקוח לפני הכנת האישור. לא ניתן לרענן כרגע; נסו לרענן חתימות ושליחות שוב.');
 expect(screen.getByRole('button',{name:'הכנת אישור לחתימה'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'רענון חתימות ושליחות'}).disabled).toBe(false);
});
