// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,test,vi} from 'vitest';

const state=vi.hoisted(()=>({role:'admin',navigate:vi.fn(),start:vi.fn(),physical:vi.fn(),direct:vi.fn()}));
const productId='11111111-1111-4111-8111-111111111111';
const serviceId='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:{role:state.role,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}})}));
vi.mock('react-router-dom',()=>({useLocation:()=>({search:''}),useNavigate:()=>state.navigate}));
vi.mock('@/api/supabaseClient',()=>({supabase:{from:table=>({select:()=>({eq:async()=>({data:table==='products'
  ?[{id:'11111111-1111-4111-8111-111111111111',name:'Water',price:1,status:'פעיל'}]
  :[{id:'22222222-2222-4222-8222-222222222222',name:'Climb',price_per_person:1,status:'פעיל'}],error:null})})})}}));
vi.mock('@/components/cashregister/ActivityGrid',()=>({default:({activities,onAdd})=><div>{activities.map(item=><button key={item.id} onClick={()=>onAdd(item)}>add service</button>)}</div>}));
vi.mock('@/components/cashregister/ProductGrid',()=>({default:({products,onAdd})=><div>{products.map(item=><button key={item.id} onClick={()=>onAdd(item)}>add product</button>)}</div>}));
vi.mock('@/components/cashregister/Cart',()=>({default:({onCheckout,onLinkOrder})=><div><button onClick={onCheckout}>checkout</button><button onClick={()=>onLinkOrder({id:orderId,order_number:'ORD-1'})}>link order</button></div>}));
vi.mock('@/components/cashregister/PaymentScreen',()=>({default:({onPelecard,pelecardEnabled,onPhysicalTerminal,physicalTerminalVisible,physicalTerminalEnabled})=><><button disabled={!pelecardEnabled} onClick={()=>onPelecard({kind:'person',name:'Test Customer',identity:'123456782',email:'test@example.com'})}>Pelecard</button>{physicalTerminalVisible&&<button disabled={!physicalTerminalEnabled} onClick={onPhysicalTerminal}>Physical</button>}</>}));
vi.mock('@/components/cashregister/ReceiptScreen',()=>({default:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn()}}));
vi.mock('@/payments/posPayments',async importOriginal=>({...(await importOriginal()),startPosCheckout:(...args)=>state.start(...args)}));
vi.mock('@/payments/physical/client',()=>({startHostedPhysical:(...args)=>state.physical(...args),
  startDirectPhysical:(...args)=>state.direct(...args)}));
import CashRegister from './CashRegister';

afterEach(()=>{cleanup();state.navigate.mockReset();state.start.mockReset();state.physical.mockReset();state.direct.mockReset();state.role='admin';vi.unstubAllEnvs();sessionStorage.clear();localStorage.clear()});
describe('Cash Register hosted routes',()=>{
  test('unaccepted physical route is shown disabled while standalone digital remains available',async()=>{
    vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED','false');
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));
    expect(screen.getByText('Physical')).toBeDisabled();
    expect(screen.getByText('Pelecard')).toBeEnabled();
    fireEvent.click(screen.getByText('Physical'));
    expect(state.physical).not.toHaveBeenCalled();
  });
  test('physical cart starts hosted EMV directly after the Pay click',async()=>{
    vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED','true');
    state.physical.mockResolvedValue({state:'pending',route:'hosted',redirectUrl:'https://gateway21.pelecard.biz/PaymentGW?transactionId=22222222-2222-4222-8222-222222222222'});
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Physical'));
    await waitFor(()=>expect(state.physical).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({
      requestKey:expect.stringMatching(uuid),cart:{lines:[{kind:'service',id:serviceId,qty:1}],discount:null}})));
    expect(state.navigate).not.toHaveBeenCalledWith('/payment/physical',expect.anything());
  });
  test('direct activation queues standalone cart without opening hosted EMV',async()=>{
    vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED','true');
    vi.stubEnv('VITE_PELECARD_PHYSICAL_DIRECT_ENABLED','true');
    state.direct.mockResolvedValue({state:'reserved',route:'direct',registerNumber:'004',amountMinor:100,saleId:null});
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Physical'));
    await waitFor(()=>expect(state.direct).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({
      requestKey:expect.stringMatching(uuid),cart:{lines:[{kind:'service',id:serviceId,qty:1}],discount:null}})));
    expect(state.physical).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('pelecard.physicalPending.v1'))).toMatchObject({mode:'direct',orderId:null});
  });
  test('standalone product cart starts hosted checkout from the Pay click',async()=>{
    state.start.mockResolvedValue({canResume:true,redirectUrl:'https://gateway20.pelecard.biz/PaymentGW?transactionId=11111111-1111-4111-8111-111111111111'});
    render(<CashRegister/>);await screen.findByText('add service');
    fireEvent.click(screen.getByText('מוצרים'));fireEvent.click(screen.getByText('add product'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Pelecard'));
    await waitFor(()=>expect(state.start).toHaveBeenCalledWith(expect.anything(),{requestKey:expect.stringMatching(uuid),cart:{lines:[{kind:'product',id:productId,qty:1}],discount:null},billing:{kind:'person',name:'Test Customer',identity:'123456782',email:'test@example.com'}}));
    expect(state.navigate).not.toHaveBeenCalledWith('/payment/pos',expect.anything());
  });
  test('standalone activity cart starts the same direct checkout',async()=>{
    state.start.mockResolvedValue({canResume:true,redirectUrl:'https://gateway20.pelecard.biz/PaymentGW?transactionId=11111111-1111-4111-8111-111111111111'});
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Pelecard'));
    await waitFor(()=>expect(state.start).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({cart:{lines:[{kind:'service',id:serviceId,qty:1}],discount:null}})));
  });
  test('repeat click cannot start a second attempt',async()=>{
    state.start.mockImplementation(()=>new Promise(()=>{}));
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));fireEvent.click(screen.getByText('Pelecard'));fireEvent.click(screen.getByText('Pelecard'));
    expect(state.start).toHaveBeenCalledTimes(1);
  });
  test('linked order opens cashier collection, and shift manager cannot start hosted checkout',async()=>{
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('link order'));expect(state.navigate).toHaveBeenCalledWith(`/cashregister?orderId=${orderId}`);
    cleanup();state.navigate.mockReset();state.role='אחמ"ש';
    render(<CashRegister/>);await screen.findByText('add service');fireEvent.click(screen.getByText('add service'));
    fireEvent.click(screen.getByText('checkout'));expect(screen.getByText('Pelecard')).toBeDisabled();
    await waitFor(()=>expect(state.navigate).not.toHaveBeenCalled());
  });
});
