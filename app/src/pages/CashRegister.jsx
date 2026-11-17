import { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import ActivityGrid from "@/components/cashregister/ActivityGrid";
import ProductGrid from "@/components/cashregister/ProductGrid";
import Cart from "@/components/cashregister/Cart";
import PaymentScreen from "@/components/cashregister/PaymentScreen";
import ReceiptScreen from "@/components/cashregister/ReceiptScreen";
import OrderCollection from "@/components/cashregister/OrderCollection";
import { calculateCheckoutTotals } from "@/payments/pelecardPayments";
import { posCheckoutRequestKey, posPendingKeyForActor, startPosCheckout, posPaymentErrorMessage } from '@/payments/posPayments';
import { validOrderId } from '@/payments/orderPayments';
import { getPhysicalAvailability, startDirectPhysical, startHostedPhysical } from '@/payments/physical/client';
import { buildStandaloneCheckout } from "@/payments/standaloneCart";
import { useAuth } from "@/lib/AuthContext";
import { BRAND } from "@/lib/orderDocText";
import { filterProducts } from "@/lib/productCatalog";

function CategorySelector({ label, categories, selected, onSelect }) {
  return <nav aria-label={label} dir="rtl" className="mb-4 flex max-w-full gap-2 overflow-x-auto pb-2">
    {['all', ...categories].map(category => <button key={category} type="button"
      aria-pressed={selected === category} onClick={() => onSelect(category)}
      className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium ${selected === category
        ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
      {category === 'all' ? 'הכול' : category}
    </button>)}
  </nav>;
}

// SCREENS: menu | payment | receipt
export default function CashRegister() {
  const location = useLocation();
  const collectionOrderId = new URLSearchParams(location.search).get('orderId');
  const navigate = useNavigate();
  const { user } = useAuth();
  const canPayOrder = (user?.role === 'admin' || user?.role === 'קופאי') && validOrderId(user?.id);
  const canPayPhysical = Boolean(user?.role) && validOrderId(user?.id);
  const canUseLegacyManualSale = ['admin', 'קופאי', 'אחמ"ש'].includes(user?.role);
  const [activities, setActivities] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogTab, setCatalogTab] = useState('service');
  const [productCategory, setProductCategory] = useState('all');
  const [activityCategory, setActivityCategory] = useState('all');
  const [productSearch, setProductSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [cartItems, setCartItems] = useState([]);
  const [screen, setScreen] = useState("menu");
  const [receiptData, setReceiptData] = useState(null);
  // null = no discount; else { type, mode: 'percentage'|'fixed', value }
  const [discount, setDiscount] = useState(null);
  // null = standalone sale; else { id, order_number, client_name, client_phone, organization }
  const [linkedOrder, setLinkedOrder] = useState(null);
  const posCheckoutId = useRef(null);
  const digitalInFlight = useRef(false);
  const [digitalBusy, setDigitalBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const physicalCheckoutId = useRef(null);
  const [physicalBusy, setPhysicalBusy] = useState(false);
  const [physicalAvailability, setPhysicalAvailability] = useState(null);
  const manualSaleSubmitted = useRef(false);
  const checkRequestKey = useRef(null);
  const [manualSaleSaving, setManualSaleSaving] = useState(false);
  const [noncardEnabled, setNoncardEnabled] = useState({ cash: false, check: false });
  const physicalFlag = import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED === 'true';
  const physicalRoute = import.meta.env.VITE_PELECARD_PHYSICAL_DIRECT_ENABLED === 'true' ? 'direct' : 'hosted';
  const physicalAllowed = physicalAvailability?.visible === true && physicalAvailability.route === physicalRoute;
  const physicalReady = physicalAllowed && physicalAvailability.ready === true;

  useEffect(() => {
    if (collectionOrderId || screen !== 'payment' || !canPayPhysical || !physicalFlag) return;
    let active = true;
    getPhysicalAvailability(supabase).then(value => { if (active) setPhysicalAvailability(value); })
      .catch(() => { if (active) setPhysicalAvailability(null); });
    return () => { active = false; };
  }, [collectionOrderId, screen, canPayPhysical, physicalFlag]);

  useEffect(() => {
    if (collectionOrderId || screen !== 'payment' || !canPayOrder || !supabase.functions?.invoke) return;
    let active = true;
    supabase.functions.invoke('payper-noncard-collection', { body: { action: 'capabilities' } })
      .then(({ data, error }) => {
        if (active && !error) setNoncardEnabled({
          cash: data?.collectionEnabled?.cash === true,
          check: data?.collectionEnabled?.check === true,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [collectionOrderId, screen, canPayOrder]);

  useEffect(() => {
    if (collectionOrderId) return;
    const load = async () => {
      const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('status', 'פעיל');
      if (error) {
        console.error('activities fetch error:', error);
        toast.error('שגיאה בטעינת הפעילויות');
      }
      setActivities(data ?? []);
      const {data:productRows,error:productError}=await supabase.from('products').select('id,name,price,image_url,status,cafeteria_category').eq('status','פעיל');
      if(productError)toast.error('שגיאה בטעינת המוצרים');
      setProducts(productRows??[]);

      // Load prefilled item from URL (coming from Schedule)
      const params = new URLSearchParams(location.search);
      const prefill = params.get("prefill");
      if (prefill) {
        const item = JSON.parse(prefill);
        setCartItems([{ ...item, kind:'service', qty: item.qty || 1, customPrice: item.customPrice || 0,
          catalogPrice: data?.find(row=>row.id===item.id)?.price_per_person ?? null }]);
        setScreen("payment");
      }

      setLoading(false);
    };
    load();
  }, [collectionOrderId]);

  const addToCart = (activity) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.id === activity.id);
      if (existing) return prev.map(i => i.id === activity.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...activity, kind:'service', catalogPrice:activity.price_per_person,
        qty: 1, customPrice: activity.price_per_person || 0 }];
    });
  };

  const addProduct=(product)=>setCartItems(prev=>{
    const existing=prev.find(item=>item.id===product.id);
    if(existing)return prev.map(item=>item.id===product.id?{...item,qty:item.qty+1}:item);
    return [...prev,{...product,kind:'product',catalogPrice:product.price,qty:1,customPrice:product.price||0}];
  });

  const updateQty = (id, delta) => {
    setCartItems(prev =>
      prev.map(i => i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i)
    );
  };

  const updatePrice = (id, price) => {
    setCartItems(prev => prev.map(i => i.id === id ? { ...i, customPrice: Number(price) } : i));
  };

  const removeItem = (id) => setCartItems(prev => prev.filter(i => i.id !== id));

  // Use the same integer-agorot arithmetic as server-side initiation.
  // Selecting a discount type alone does not apply a discount. Never send a
  // zero-value discount: the server correctly rejects it as discount_invalid.
  const discountUnset = discount && (discount.value == null ||
    (typeof discount.value === 'string' && discount.value.trim() === '') ||
    Number(discount.value) === 0);
  const appliedDiscount = discountUnset ? null : discount;
  const checkoutTotals = calculateCheckoutTotals(cartItems, appliedDiscount);
  const { subtotal, discountAmount, total } = checkoutTotals;
  const discountValue = Number(appliedDiscount?.value) || 0;
  const discountValid = checkoutTotals.valid;
  let hostedPreview=null;
  try{
    hostedPreview=buildStandaloneCheckout(cartItems.map(item=>({kind:item.kind,id:item.id,qty:item.qty})),
      cartItems.map(item=>({kind:item.kind,id:item.id,name:item.name,price:Number(item.catalogPrice),status:'פעיל'})));
  }catch{/* The server makes the final eligibility decision. */}
  const canHostedCart=cartItems.length>0&&discountValid&&(!appliedDiscount||user?.role==='admin')&&
    hostedPreview&&cartItems.every((item,index)=>Number(item.customPrice)===hostedPreview.items[index].customPrice);
  const productCategories = [...new Set(products.map(item => item.cafeteria_category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
  const activityCategories = [...new Set(activities.map(item => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
  const visibleProducts = filterProducts(products, { cafeteria: null, category: productCategory, search: productSearch });
  const visibleActivities = activityCategory === 'all' ? activities
    : activities.filter(item => item.category === activityCategory);

  const handlePaymentConfirm = async (method, paymentDetails = null) => {
    if (!canUseLegacyManualSale) {
      toast.error('אמצעי תשלום זה אינו זמין לתפקיד זה');
      return;
    }
    if (manualSaleSubmitted.current) return;
    manualSaleSubmitted.current = true;
    setManualSaleSaving(true);
    if (linkedOrder?.id) {
      manualSaleSubmitted.current = false;
      setManualSaleSaving(false);
      navigate(`/cashregister?orderId=${encodeURIComponent(linkedOrder.id)}`);
      return;
    }
    if (method === "צ'ק" || method === "מזומן") {
      if (!(method === "צ'ק" ? noncardEnabled.check : noncardEnabled.cash)) {
        toast.error('אמצעי התשלום הזה עדיין לא הופעל לקופה זו. בחרו אמצעי תשלום זמין.');
        manualSaleSubmitted.current = false;
        setManualSaleSaving(false);
        return;
      }
      checkRequestKey.current ||= crypto.randomUUID();
      const { billing, document_type: documentType, reference_document_id: referenceDocumentId,
        ...check } = paymentDetails || {};
      const isCheck = method === "צ'ק";
      try {
        const { data, error } = await supabase.functions.invoke('payper-noncard-collection', { body: {
          action: 'collect', requestKey: checkRequestKey.current, method: isCheck ? 'check' : 'cash',
          amountMinor: Math.round(total * 100), check: isCheck ? check : null, billing, documentType,
          referenceDocumentId, lines: cartItems.map(item => ({ kind: item.kind,
            id: item.id, qty: item.qty })),
          discount: appliedDiscount ? { type: appliedDiscount.type, mode: appliedDiscount.mode,
            value: Number(appliedDiscount.value) } : null,
        } });
        if (error || data?.error || !data?.receiptNumber) throw new Error('check_collection_unresolved');
        setReceiptData({ items: cartItems, total, method, paymentDetails: isCheck ? check : null,
          discount: appliedDiscount ? { type: appliedDiscount.type, amount: discountAmount,
            original_total: subtotal } : null,
          linkedOrder: null, timestamp: new Date(), receiptNumber: data.receiptNumber,
          accounting: data.accounting });
        setScreen('receipt');
      } catch {
        toast.error('תוצאת שמירת התשלום אינה ודאית. יש לבדוק את דוח המכירות והנהלת החשבונות לפני ניסיון נוסף.');
        manualSaleSubmitted.current = false;
      } finally { setManualSaleSaving(false); }
      return;
    }
    const saleItems = cartItems.map(i => ({ id: i.id, name: i.name, qty: i.qty, customPrice: i.customPrice }));

    // Save sale to DB for reporting. receipt_number is generated by the DB
    // ('RCP-<seq>' DEFAULT) — never in JS — so we insert then read the row back.
    // payment_details holds manual-method extras (e.g. check fields); NULL otherwise.
    let data, error;
    try { ({ data, error } = await supabase
      .from('sales')
      .insert({
        items: saleItems,
        total,
        method,
        payment_details: paymentDetails,
        discount: appliedDiscount
          ? { type: appliedDiscount.type, mode: appliedDiscount.mode, value: discountValue, original_total: subtotal, final_total: total }
          : null,
        order_id: linkedOrder?.id || null,
        linked_order_info: linkedOrder
          ? { order_number: linkedOrder.order_number, client_name: linkedOrder.client_name, client_phone: linkedOrder.client_phone, organization: linkedOrder.organization || "" }
          : null,
        sale_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()); }
    catch (failure) { error = failure; }

    if (error || !data) {
      console.error('sale insert error:', error);
      toast.error('שמירת המכירה לא אושרה. בדקו את דוח המכירות לפני ניסיון נוסף; לא מוצג אישור תשלום.');
      setManualSaleSaving(false);
      return;
    }

    const receipt = {
      items: cartItems,
      total,
      method,
      paymentDetails,
      discount: appliedDiscount ? { type: appliedDiscount.type, amount: discountAmount, original_total: subtotal } : null,
      linkedOrder,
      timestamp: new Date(),
      receiptNumber: data.receipt_number,
    };
    setReceiptData(receipt);
    setManualSaleSaving(false);
    setScreen("receipt");
  };

  const handlePelecardStart = async billing => {
    if (!canPayOrder || digitalInFlight.current) return;
    if (linkedOrder?.id) { navigate(`/cashregister?orderId=${encodeURIComponent(linkedOrder.id)}`); return; }
    if (!canHostedCart) return;
    setPaymentError('');
    digitalInFlight.current = true; setDigitalBusy(true);
    const cart = {
      lines: cartItems.map(item => ({ kind: item.kind, id: item.id, qty: item.qty })),
      discount: appliedDiscount ? { type: appliedDiscount.type, mode: appliedDiscount.mode, value: Number(appliedDiscount.value) } : null,
    };
    const actorId = user.id;
    const cartIdentity = JSON.stringify(cart);
    const pendingKey = posPendingKeyForActor(actorId);
    if (posCheckoutId.current?.actorId !== actorId || posCheckoutId.current?.cart !== cartIdentity) {
      posCheckoutId.current = { actorId, cart: cartIdentity,
        requestKey: posCheckoutRequestKey(null, cart, sessionStorage.getItem(pendingKey),
          () => crypto.randomUUID(), actorId) };
    }
    const requestKey = posCheckoutId.current.requestKey;
    sessionStorage.setItem(pendingKey, JSON.stringify({ requestKey, cart: cartIdentity, actorId }));
    try {
      const result = await startPosCheckout(supabase, { requestKey, cart, billing });
      // A usable hosted URL redirects inside startPosCheckout. Otherwise the
      // existing route is only a read-only result or recovery screen.
      if (!result.canResume || !result.redirectUrl) navigate('/payment/pos', { state: { checkoutId: requestKey, cart } });
    } catch (reason) {
      const safe = ['capability_disabled', 'catalog_item_unavailable', 'cart_invalid',
        'cart_line_invalid', 'cart_amount_invalid', 'discount_invalid', 'pos_payment_forbidden',
        'request_key_conflict', 'pos_payment_in_progress', 'billing_identity_required',
        'billing_email_required'].includes(reason?.code);
      if (safe) {
        const message = posPaymentErrorMessage(reason.code);
        setPaymentError(message);
        toast.error(message);
        digitalInFlight.current = false; setDigitalBusy(false);
      } else {
        const message = 'מצב התשלום אינו ודאי. בדקו את הניסיון הקיים לפני פעולה נוספת.';
        setPaymentError(message);
        toast.error(message);
        navigate('/payment/pos', { state: { checkoutId: requestKey, cart } });
      }
    }
  };

  const handlePhysicalStart = async billing => {
    if (!physicalReady || import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED !== 'true' ||
      !canPayPhysical || linkedOrder?.id || !canHostedCart) return;
    physicalCheckoutId.current ||= crypto.randomUUID();
    const cart = {
      lines: cartItems.map(item => ({ kind: item.kind, id: item.id, qty: item.qty })),
      discount: appliedDiscount ? { type: appliedDiscount.type, mode: appliedDiscount.mode, value: Number(appliedDiscount.value) } : null,
    };
    const requestKey = physicalCheckoutId.current;
    const direct = import.meta.env.VITE_PELECARD_PHYSICAL_DIRECT_ENABLED === 'true';
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({ requestKey,
      orderId: null, cart: JSON.stringify(cart), mode: direct ? 'direct' : 'hosted' }));
    setPhysicalBusy(true);
    try {
      const result = await (direct ? startDirectPhysical : startHostedPhysical)(supabase, { requestKey, cart, billing,
        workstationCode: localStorage.getItem('pelecard.physicalWorkstation.v1') || null });
      if (direct || result.state !== 'pending' || !result.redirectUrl)
        navigate('/payment/physical', { state: { checkoutId: requestKey, cart } });
    } catch (reason) {
      if (reason?.message === 'physical_register_004_unavailable') {
        localStorage.removeItem('pelecard.physicalPending.v1');
        physicalCheckoutId.current = null;
        toast.error('לא נמצא מסופון CT20 משויך לקופה 004. בדקו את הגדרות המסופון.');
      } else {
        toast.error('מצב התשלום הפיזי אינו ודאי. בדקו את הניסיון הקיים לפני פעולה נוספת.');
        navigate('/payment/physical', { state: { checkoutId: requestKey, cart } });
      }
    } finally { setPhysicalBusy(false); }
  };

  const handleNewSale = () => {
    manualSaleSubmitted.current = false;
    checkRequestKey.current = null;
    posCheckoutId.current = null;
    digitalInFlight.current = false;
    setDigitalBusy(false);
    setPaymentError('');
    physicalCheckoutId.current = null;
    setPhysicalBusy(false);
    setCartItems([]);
    setScreen("menu");
    setReceiptData(null);
    setDiscount(null);
    setLinkedOrder(null);
  };

  if (collectionOrderId) return <OrderCollection orderId={collectionOrderId} />;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (screen === "receipt") {
    return <ReceiptScreen receipt={receiptData} onNewSale={handleNewSale} />;
  }

  if (screen === "payment") {
    return (
      <PaymentScreen
        total={total}
        cartItems={cartItems}
        onConfirm={handlePaymentConfirm}
        manualSaleSaving={manualSaleSaving}
        manualMethodsEnabled={canUseLegacyManualSale}
        noncardEnabled={noncardEnabled}
        onPelecard={handlePelecardStart}
        pelecardBusy={digitalBusy}
        paymentError={paymentError}
        onPhysicalTerminal={handlePhysicalStart}
        physicalTerminalBusy={physicalBusy}
        physicalTerminalVisible={!physicalFlag || physicalAllowed}
        physicalTerminalSelectable={Boolean(physicalFlag && physicalAllowed &&
          canPayPhysical && canHostedCart && !linkedOrder?.id && !physicalBusy)}
        physicalTerminalEnabled={Boolean(physicalFlag && physicalReady &&
          canPayPhysical && canHostedCart && !linkedOrder?.id && !physicalBusy)}
        pelecardEnabled={canPayOrder && (Boolean(linkedOrder?.id)||canHostedCart)}
        pelecardHint={linkedOrder?.id?'מעבר לתשלום ההזמנה השמורה; הסכום לפי ההזמנה':
          canHostedCart?'מחירי הקטלוג והסכום יאומתו בשרת לפני מעבר לפלאקארד':
          'תשלום פלאקארד דורש מחיר קטלוג קבוע וללא שינוי ידני; הנחה מחייבת מנהל'}
        onBack={() => { setPaymentError(''); setScreen("menu"); }}
      />
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white text-slate-900 lg:flex-row" dir="rtl">
      {/* Left: Activity Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-lg">א</div>
          <div>
            <h1 className="text-xl font-bold">{BRAND.name} — קופה</h1>
            <p className="text-slate-400 text-sm">בחר פעילות או מוצר להוספה לסל</p>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <button className={`rounded-lg px-4 py-2 ${catalogTab==='service'?'bg-primary text-white':'bg-slate-100'}`} onClick={()=>setCatalogTab('service')}>פעילויות ושירותים</button>
          <button className={`rounded-lg px-4 py-2 ${catalogTab==='product'?'bg-primary text-white':'bg-slate-100'}`} onClick={()=>setCatalogTab('product')}>מוצרים</button>
        </div>
        {catalogTab==='service'?<>
          <CategorySelector label="קטגוריות פעילויות ושירותים" categories={activityCategories}
            selected={activityCategory} onSelect={setActivityCategory}/>
          {visibleActivities.length ? <ActivityGrid activities={visibleActivities} onAdd={addToCart}/>
            : <p className="py-8 text-center text-slate-500">לא נמצאו פעילויות בקטגוריה שנבחרה.</p>}
        </>:<>
          <CategorySelector label="קטגוריות מוצרים" categories={productCategories}
            selected={productCategory} onSelect={setProductCategory}/>
          <input type="search" aria-label="חיפוש מוצר בקופה" placeholder="חיפוש מוצר לפי שם"
            value={productSearch} onChange={event => setProductSearch(event.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900"/>
          {visibleProducts.length ? <ProductGrid products={visibleProducts} onAdd={addProduct}/>
            : <p className="py-8 text-center text-slate-500">לא נמצאו מוצרים בקטגוריה ובחיפוש שנבחרו.</p>}
        </>}
      </div>

      {/* Right: Cart */}
      <div className="flex max-h-[44dvh] min-h-0 w-full flex-col overflow-y-auto border-t border-slate-200 bg-slate-50 lg:max-h-none lg:w-80 lg:overflow-hidden lg:border-r lg:border-t-0">
        <Cart
          items={cartItems}
          subtotal={subtotal}
          discount={discount}
          discountAmount={discountAmount}
          discountValid={discountValid}
          total={total}
          linkedOrder={linkedOrder}
          onLinkOrder={order => order?.id
            ? navigate(`/cashregister?orderId=${encodeURIComponent(order.id)}`)
            : setLinkedOrder(null)}
          onSetDiscount={setDiscount}
          onUpdateQty={updateQty}
          onUpdatePrice={updatePrice}
          onRemove={removeItem}
          onCheckout={() => setScreen("payment")}
        />
      </div>
    </div>
  );
}
