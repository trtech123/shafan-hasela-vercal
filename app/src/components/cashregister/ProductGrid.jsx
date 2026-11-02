import {Plus} from 'lucide-react';

export default function ProductGrid({products,onAdd}){
  return <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
    {products.map(product=><button key={product.id} onClick={()=>onAdd(product)}
      className="rounded-2xl border bg-white p-4 text-right shadow-sm hover:shadow-md">
      {product.image_url&&<img src={product.image_url} alt="" className="mb-3 h-28 w-full rounded-xl object-cover"/>}
      <span className="block font-semibold">{product.name}</span>
      <span className="mt-2 flex items-center justify-between text-emerald-700">
        {product.price!=null?`${Number(product.price).toFixed(2)} ₪`:'מחיר חסר'}<Plus className="h-4 w-4"/>
      </span>
    </button>)}
  </div>;
}
