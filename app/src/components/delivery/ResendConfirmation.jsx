import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
export default function ResendConfirmation({selection,onCancel,onConfirm,busy}) {
 return <AlertDialog open={Boolean(selection)} onOpenChange={open=>{if(!open&&!busy)onCancel();}}>
  <AlertDialogContent dir="rtl">
   <AlertDialogHeader><AlertDialogTitle>שליחה חוזרת {selection?.channel==='email'?'במייל':'ב-WhatsApp'}</AlertDialogTitle>
    <AlertDialogDescription>{selection?.state==='accepted'?'המסמך כבר נשלח בעבר. האם לשלוח אותו שוב?':selection?.state==='failed'?'השליחה הקודמת נכשלה. האם לשלוח שוב?':'קיימת שליחה קודמת שמצבה אינו ניתן לאימות. שליחה חוזרת עלולה לגרום לכך שהלקוח יקבל את המסמך פעמיים. האם לשלוח שוב?'}</AlertDialogDescription>
   </AlertDialogHeader>
   <p className="text-sm">המסמך יישלח ל־<bdi>{selection?.destination}</bdi>. השליחה הקודמת תישאר בהיסטוריה.</p>
   <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={onCancel}>ביטול</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();onConfirm();}}>כן, שלח שוב</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
