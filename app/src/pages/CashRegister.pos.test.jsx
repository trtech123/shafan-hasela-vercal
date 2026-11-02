// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,test,vi} from 'vitest';

const state=vi.hoisted(()=>({role:'admin',navigate:vi.fn()}));
const productId='11111111-1111-4111-8111-111111111111';
const serviceId='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:{role:state.role}})}));
vi.mock('react-router-dom',()=>({useLocation:()=>({search:''}),useNavigate:()=>state.navigate}));
vi.mock('@/api/supabaseClient',()=>({supabase:{from:table=>({select:()=>({eq:async()=>({data:table==='products'
  ?[{id:'11111111-1111-4111-8111-111111111111',name:'Water',price:1,status:'פעיל'}]
  :[{id:'22222222-2222-4222-8222-222222222222',name:'Climb',price_per_person:1,status:'פעיל'}],error:null})})})}}));
vi.mock('@/components/cashregister/ActivityGrid',()=>({default:({activities,onAdd})=><div>{activities.map(item=><button key={item.id} onClick={()=>onAdd(item)}>add service</button>)}</div>}));
vi.mock('@/components/cashregister/ProductGrid',()=>({default:({products,onAdd})=><div>{products.map(item=><button key={item.id} onClick={()=>onAdd(item)}>add product</button>)}</div>}));
vi.mock('@/components/cashregister/Cart',()=>({default:({onCheckout,onLinkOrder})=><div><button onClick={onCheckout}>checkout</button><button onClick={()=>onLinkOrder({id:orderId,order_number:'ORD-1'})}>link order</button></div>}));
vi.mock('@/components/cashregister/PaymentScreen',()=>({default:({onPelecard,pelecardEnabled})=><button disabled={!pelecardEnabled} onClick={onPelecard}>Pelecard</button>}));
vi.mock('@/components/cashregister/ReceiptScreen',()=>({default:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn()}}));
import CashRegister from './CashRegister';

afterEach(()=>{cleanup();state.navigate.mockReset();state.role='admin'});
describe('Cash Register hosted routes',()=>{
  test('standalone product cart reaches POS review without a client amount',async()=>{
    render(<CashRegister/>);await screen.findByText('add service');
    fireEvent.click(screen.getByText('מוצרים'));fireEvent.click(screen.getByText('add product'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Pelecard'));
    expect(state.navigate).toHaveBeenCalledWith('/payment/pos',{state:{cart:{lines:[{kind:'product',id:productId,qty:1}],discount:null}}});
  });
  test('standalone service cart reaches POS review',async()=>{
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Pelecard'));
    expect(state.navigate).toHaveBeenCalledWith('/payment/pos',{state:{cart:{lines:[{kind:'service',id:serviceId,qty:1}],discount:null}}});
  });
  test('linked saved order uses order review, and shift manager cannot start hosted checkout',async()=>{
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('link order'));fireEvent.click(screen.getByText('checkout'));
    fireEvent.click(screen.getByText('Pelecard'));expect(state.navigate).toHaveBeenCalledWith(`/payment/order?orderId=${orderId}`);
    cleanup();state.navigate.mockReset();state.role='אחמ"ש';
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));expect(screen.getByText('Pelecard')).toBeDisabled();
    await waitFor(()=>expect(state.navigate).not.toHaveBeenCalled());
  });
});
