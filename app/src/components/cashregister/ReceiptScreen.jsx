import { useRef } from "react";
import { CheckCircle, Printer, Mail, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import moment from "moment";

export default function ReceiptScreen({ receipt, onNewSale }) {
  const receiptRef = useRef(null);

  const handlePrint = () => {
    const content = receiptRef.current.innerHTML;
    const win = window.open("", "_blank");
    win.document.write(`
      <html dir="rtl"><head><title>קבלה</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 320px; margin: 0 auto; padding: 20px; }
        h2 { text-align: center; } table { width: 100%; border-collapse: collapse; }
        td { padding: 4px 0; } .total { font-size: 1.4em; font-weight: bold; border-top: 2px solid #000; padding-top: 8px; }
        .center { text-align: center; } .small { font-size: 0.8em; color: #666; }
      </style></head>
      <body>${content}</body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-md space-y-6">

        {/* Success */}
        <div className="text-center space-y-2">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold">התשלום אושר!</h2>
          <p className="text-slate-400">אמצעי תשלום: <span className="text-white font-semibold">{receipt.method}</span></p>
        </div>

        {/* Receipt */}
        <div ref={receiptRef} className="bg-white text-slate-900 rounded-2xl p-6 space-y-4">
          <div className="text-center border-b border-slate-200 pb-3">
            <h2 className="font-bold text-lg">אדוונצ׳ר</h2>
            <p className="text-slate-500 text-sm">קבלה מספר {receipt.receiptNumber}</p>
            <p className="text-slate-400 text-xs">{moment(receipt.timestamp).format("DD/MM/YYYY HH:mm")}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-100">
                <th className="text-right pb-2">פעילות</th>
                <th className="text-center pb-2">כמות</th>
                <th className="text-left pb-2">סכום</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipt.items.map(item => (
                <tr key={item.id}>
                  <td className="py-2 font-medium">{item.name}</td>
                  <td className="py-2 text-center text-slate-500">{item.qty}</td>
                  <td className="py-2 text-left font-semibold">{(item.customPrice * item.qty).toLocaleString()}₪</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t-2 border-slate-900 pt-3 flex justify-between items-center">
            <span className="font-bold text-lg">סה״כ לתשלום</span>
            <span className="font-bold text-2xl text-emerald-700">{receipt.total.toLocaleString()}₪</span>
          </div>

          {/* Manual payment details (e.g. check) — printed on the receipt. */}
          {receipt.paymentDetails && (
            <div className="border-t border-slate-200 pt-3 text-sm space-y-1">
              <p className="font-semibold text-slate-700">פרטי צ'ק</p>
              {receipt.paymentDetails.check_number && <div className="flex justify-between"><span className="text-slate-500">מספר צ'ק</span><span>{receipt.paymentDetails.check_number}</span></div>}
              {receipt.paymentDetails.bank && <div className="flex justify-between"><span className="text-slate-500">בנק</span><span>{receipt.paymentDetails.bank}</span></div>}
              {receipt.paymentDetails.branch && <div className="flex justify-between"><span className="text-slate-500">סניף</span><span>{receipt.paymentDetails.branch}</span></div>}
              {receipt.paymentDetails.account_number && <div className="flex justify-between"><span className="text-slate-500">חשבון</span><span>{receipt.paymentDetails.account_number}</span></div>}
              {receipt.paymentDetails.account_holder && <div className="flex justify-between"><span className="text-slate-500">בעל החשבון</span><span>{receipt.paymentDetails.account_holder}</span></div>}
              {receipt.paymentDetails.due_date && <div className="flex justify-between"><span className="text-slate-500">תאריך פירעון</span><span>{moment(receipt.paymentDetails.due_date).format("DD/MM/YYYY")}</span></div>}
              {receipt.paymentDetails.amount != null && <div className="flex justify-between"><span className="text-slate-500">סכום צ'ק</span><span>{Number(receipt.paymentDetails.amount).toLocaleString()}₪</span></div>}
              {receipt.paymentDetails.notes && <div className="flex justify-between"><span className="text-slate-500">הערות</span><span>{receipt.paymentDetails.notes}</span></div>}
            </div>
          )}

          <p className="text-center text-slate-400 text-xs">תשלום ב{receipt.method} | אדוונצ׳ר — תודה!</p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button onClick={handlePrint} variant="outline" className="w-full border-slate-600 text-white bg-slate-800 hover:bg-slate-700 gap-2">
            <Printer className="w-4 h-4" /> הדפס קבלה
          </Button>

          {/* Email sending is out of scope for the MVP — disabled with a Hebrew "in progress" tooltip. */}
          <div className="flex gap-2" title="אימייל לא זמין כרגע — בבנייה">
            <Input
              placeholder="שלח לאימייל..."
              type="email"
              disabled
              className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 disabled:opacity-50"
            />
            <Button disabled className="gap-2 bg-blue-600 hover:bg-blue-500 flex-shrink-0 disabled:opacity-50">
              <Mail className="w-4 h-4" /> שלח
            </Button>
          </div>

          <Button onClick={onNewSale} className="w-full h-12 text-lg font-bold bg-primary hover:bg-primary/90 gap-2 rounded-xl">
            <RotateCcw className="w-5 h-5" /> מכירה חדשה
          </Button>
        </div>
      </div>
    </div>
  );
}