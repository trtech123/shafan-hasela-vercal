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
import { orderPaymentPath } from "@/payments/orderPayments";
import { buildStandaloneCheckout } from "@/payments/standaloneCart";
import { useAuth } from "@/lib/AuthContext";
import { BRAND } from "@/lib/orderDocText";

// SCREENS: menu | payment | receipt
export default function CashRegister() {
  const location = useLocation();
  const collectionOrderId = new URLSearchParams(location.search).get('orderId');
  const navigate = useNavigate();
  const { user } = useAuth();
  const canPayOrder = user?.role === 'admin' || user?.role === 'קופאי';
  const [activities, setActivities] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogTab, setCatalogTab] = useState('service');
  const [loading, setLoading] = useState(true);
  const [cartItems, setCartItems] = useState([]);
  const [screen, setScreen] = useState("menu");
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [receiptData, setReceiptData] = useState(null);
  // null = no discount; else { type, mode: 'percentage'|'fixed', value }
  const [discount, setDiscount] = useState(null);
  // null = standalone sale; else { id, order_number, client_name, client_phone, organization }
  const [linkedOrder, setLinkedOrder] = useState(null);
  const posCheckoutId = useRef(null);
  const physicalCheckoutId = useRef(null);
  const manualSaleSubmitted = useRef(false);
  const checkRequestKey = useRef(null);
  const [manualSaleSaving, setManualSaleSaving] = useState(false);

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
      const {data:productRows,error:productError}=await supabase.from('products').select('id,name,price,image_url,status').eq('status','פעיל');
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
  const checkoutTotals = calculateCheckoutTotals(cartItems, discount);
  const { subtotal, discountAmount, total } = checkoutTotals;
  const discountValue = Number(discount?.value) || 0;
  const discountValid = checkoutTotals.valid;
  let hostedPreview=null;
  try{
    hostedPreview=buildStandaloneCheckout(cartItems.map(item=>({kind:item.kind,id:item.id,qty:item.qty})),
      cartItems.map(item=>({kind:item.kind,id:item.id,name:item.name,price:Number(item.catalogPrice),status:'פעיל'})));
  }catch{/* The server makes the final eligibility decision. */}
  const canHostedCart=cartItems.length>0&&discountValid&&(!discount||user?.role==='admin')&&
    hostedPreview&&cartItems.every((item,index)=>Number(item.customPrice)===hostedPreview.items[index].customPrice);

  const handlePaymentConfirm = async (method, paymentDetails = null) => {
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
          discount: discount ? { type: discount.type, mode: discount.mode,
            value: Number(discount.value) } : null,
        } });
        if (error || data?.error || !data?.receiptNumber) throw new Error('check_collection_unresolved');
        setReceiptData({ items: cartItems, total, method, paymentDetails: isCheck ? check : null,
          discount: discount ? { type: discount.type, amount: discountAmount,
            original_total: subtotal } : null,
          linkedOrder: null, timestamp: new Date(), receiptNumber: data.receiptNumber,
          accounting: data.accounting });
        setPaymentMethod(method);
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
        discount: discount
          ? { type: discount.type, mode: discount.mode, value: discountValue, original_total: subtotal, final_total: total }
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
      discount: discount ? { type: discount.type, amount: discountAmount, original_total: subtotal } : null,
      linkedOrder,
      timestamp: new Date(),
      receiptNumber: data.receipt_number,
    };
    setReceiptData(receipt);
    setPaymentMethod(method);
    setManualSaleSaving(false);
    setScreen("receipt");
  };

  const handlePelecardStart = () => {
    if(!canPayOrder)return;
    if(linkedOrder?.id){navigate(orderPaymentPath(linkedOrder.id));return;}
    if(canHostedCart){
      posCheckoutId.current ||= crypto.randomUUID();
      navigate('/payment/pos',{state:{checkoutId:posCheckoutId.current,cart:{
      lines:cartItems.map(item=>({kind:item.kind,id:item.id,qty:item.qty})),
      discount:discount?{type:discount.type,mode:discount.mode,value:Number(discount.value)}:null,
      }}});
    }
  };

  const handlePhysicalStart = () => {
    if (!canPayOrder || linkedOrder?.id || !canHostedCart) return;
    physicalCheckoutId.current ||= crypto.randomUUID();
    navigate('/payment/physical', { state: { checkoutId: physicalCheckoutId.current, cart: {
      lines: cartItems.map(item => ({ kind: item.kind, id: item.id, qty: item.qty })),
      discount: discount ? { type: discount.type, mode: discount.mode, value: Number(discount.value) } : null,
    } } });
  };

  const handleNewSale = () => {
    manualSaleSubmitted.current = false;
    checkRequestKey.current = null;
    posCheckoutId.current = null;
    physicalCheckoutId.current = null;
    setCartItems([]);
    setScreen("menu");
    setPaymentMethod(null);
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
        onPelecard={handlePelecardStart}
        onPhysicalTerminal={handlePhysicalStart}
        physicalTerminalVisible={import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED === 'true'}
        physicalTerminalEnabled={Boolean(canPayOrder && canHostedCart && !linkedOrder?.id)}
        pelecardEnabled={canPayOrder && (Boolean(linkedOrder?.id)||canHostedCart)}
        pelecardHint={linkedOrder?.id?'מעבר לתשלום ההזמנה השמורה; הסכום לפי ההזמנה':
          canHostedCart?'מחירי הקטלוג והסכום יאומתו בשרת לפני מעבר לפלאקארד':
          'תשלום פלאקארד דורש מחיר קטלוג קבוע וללא שינוי ידני; הנחה מחייבת מנהל'}
        onBack={() => setScreen("menu")}
      />
    );
  }

  return (
    <div className="flex h-screen bg-white text-slate-900 overflow-hidden" dir="rtl">
      {/* Left: Activity Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-lg">א</div>
          <div>
            <h1 className="text-xl font-bold">{BRAND.name} — קופה</h1>
            <p className="text-slate-400 text-sm">בחר פעילות או מוצר להוספה לסל</p>
          </div>
        </div>
        <div className="mb-4 flex gap-2">
          <button className={`rounded-lg px-4 py-2 ${catalogTab==='service'?'bg-primary text-white':'bg-slate-100'}`} onClick={()=>setCatalogTab('service')}>פעילויות ושירותים</button>
          <button className={`rounded-lg px-4 py-2 ${catalogTab==='product'?'bg-primary text-white':'bg-slate-100'}`} onClick={()=>setCatalogTab('product')}>מוצרים</button>
        </div>
        {catalogTab==='service'?<ActivityGrid activities={activities} onAdd={addToCart}/>:<ProductGrid products={products} onAdd={addProduct}/>}
      </div>

      {/* Right: Cart */}
      <div className="w-80 border-r border-slate-200 flex flex-col bg-slate-50">
        <Cart
          items={cartItems}
          subtotal={subtotal}
          discount={discount}
          discountAmount={discountAmount}
          discountValid={discountValid}
          total={total}
          linkedOrder={linkedOrder}
          onLinkOrder={setLinkedOrder}
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
