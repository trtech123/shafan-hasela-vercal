import PublicPolicyLayout, { PolicySection } from "@/components/public/PublicPolicyLayout";

export default function DataDeletion() {
  return (
    <PublicPolicyLayout
      eyebrow="שליטה במידע"
      title="בקשה למחיקת מידע"
      intro="אפשר לבקש מאיתנו לבדוק ולמחוק מידע שמקושר לשימוש שלך בצ׳אטבוט או בשיחות WhatsApp עם שפן הסלע."
    >
      <PolicySection number="01" title="איך שולחים בקשה">
        <p>שולחים אימייל לכתובת שמופיעה בתחתית העמוד וכותבים שמדובר בבקשת מחיקת מידע הקשור ל-WhatsApp או לצ׳אטבוט.</p>
        <p>כדי שנוכל לאתר את הפנייה הנכונה, יש לצרף רק:</p>
        <ul className="space-y-3 pr-5 marker:text-amber-600">
          <li className="list-disc"><strong className="text-emerald-950">שם מלא</strong></li>
          <li className="list-disc"><strong className="text-emerald-950">מספר הטלפון שבו התנהלה השיחה ב-WhatsApp</strong></li>
          <li className="list-disc"><strong className="text-emerald-950">הקשר קצר לשיחה או להזמנה</strong>, למשל נושא הפנייה או מספר הזמנה אם הוא ידוע.</li>
        </ul>
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-semibold text-amber-950">אין לשלוח מספר כרטיס אשראי, קוד אבטחה או פרטי כרטיס אחרים.</p>
      </PolicySection>

      <PolicySection number="02" title="בדיקת הבקשה">
        <p>ייתכן שנבקש לאמת שהבקשה נשלחה על ידי האדם שהמידע קשור אליו, או לבקש הבהרה מצומצמת שתעזור לאתר את השיחה או ההזמנה. המטרה היא למנוע מחיקה של מידע השייך לאדם אחר.</p>
        <p>לאחר זיהוי הרשומות המתאימות נבדוק את הבקשה ונשיב דרך פרטי הקשר שנמסרו.</p>
      </PolicySection>

      <PolicySection number="03" title="מה קורה לאחר הבדיקה">
        <p>מחיקת מידע אינה מתבצעת באופן אוטומטי או מיידי. הבקשה נבדקת, ולאחר מכן נפעל לגבי המידע שניתן למחוק בהתאם לנסיבות ולצרכים החלים על הרשומה.</p>
        <p>במקרים מסוימים ייתכן שנצטרך לשמור מידע או מסמכים לצרכים תפעוליים, חשבונאיים או משפטיים. במקרה כזה הטיפול בבקשה עשוי שלא לכלול מחיקה של כל הרשומות.</p>
      </PolicySection>

      <PolicySection number="04" title="איזה מידע אפשר לכלול בבקשה">
        <p>אפשר לבקש טיפול בפרטי הקשר, בתוכן שיחה ובהודעות, ובמידע שירותי או מידע על הזמנה שמקושר לשימוש ב-WhatsApp או בצ׳אטבוט ושניתן לזהות לפי הפרטים שנמסרו.</p>
        <p>אם הבקשה נוגעת גם לתיקון מידע או לקבלת מידע על הרשומות שמקושרות אליך, כדאי לציין זאת באותו אימייל.</p>
      </PolicySection>
    </PublicPolicyLayout>
  );
}
