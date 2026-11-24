// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import SignedContactHistory from './SignedContactHistory';

vi.mock('@/api/supabaseClient',()=>({supabase:{from:()=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[{revision_id:'r1',order_id:'o1',lead_id:'l1',lead_link_status:'linked',full_name:'ישראל ישראלי',details:{phone:'0501234567'},signed_at:'2026-11-24T10:00:00Z'}],error:null})})})})})}}));
afterEach(cleanup);
it('shows signed contact details as separate evidence without changing the customer card',async()=>{
 render(<SignedContactHistory customerId="c1"/>);
 expect(await screen.findByText('0501234567')).toBeTruthy();
 expect(screen.getByText(/ליד מקושר/)).toBeTruthy();
});
