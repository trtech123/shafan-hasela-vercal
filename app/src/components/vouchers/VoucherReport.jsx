const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
const dateTime = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '—';
const fields = [
  ['register_name','קופה'], ['billing_name','לקוח / חברה'], ['billing_company_id','ח.פ / ע.מ'],
  ['contact_name','איש קשר'], ['phone','טלפון'], ['creator_name','יוצר השובר'], ['order_number','הזמנה קשורה'],
];
export default function VoucherReport({ rows, filters = {}, generatedAt, registerLabel }) {
  return <section dir="rtl" lang="he" style={{ background:'#fff', color:'#111827', fontFamily:'Arial, sans-serif', width:794, padding:28, boxSizing:'border-box', fontSize:14, lineHeight:1.65, textAlign:'right' }}>
    <header data-pdf-block style={{marginBottom:20}}>
      <h1 style={{fontSize:26,fontWeight:700,margin:0}}>שפן הסלע — דו״ח שוברי הקפה</h1>
      <p>הופק: {dateTime(generatedAt)} (שעון ישראל) · {rows.length} שוברים</p>
      <p>סינון: {[
        `מתאריך: ${filters.dateFrom || 'ללא הגבלה'}`, `עד תאריך: ${filters.dateTo || 'ללא הגבלה'}`,
        `קופה: ${registerLabel || filters.register || 'כל הקופות'}`, `יוצר: ${filters.creator || 'כולם'}`, `חיפוש: ${filters.search || 'ללא'}`,
      ].join(' · ')}</p>
      <p style={{fontWeight:700}}>דו״ח מידע בלבד. אינו אישור תשלום או מסמך חשבונאי. הורדתו אינה משנה את מצב השוברים.</p>
    </header>
    {!rows.length && <p data-pdf-block>לא נמצאו שוברים התואמים לסינון.</p>}
    {rows.map((row,index) => <article key={`${row.voucher_number}-${index}`} data-pdf-block style={{borderTop:'2px solid #d1d5db',paddingTop:14,marginBottom:24}}>
      <h2 data-pdf-block style={{fontSize:18,fontWeight:700,margin:'0 0 8px'}}>שובר <bdi>{text(row.voucher_number)}</bdi> · {dateTime(row.created_at)}</h2>
      <dl style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 18px',margin:0}}>
        {fields.map(([key,label]) => <div key={key} data-pdf-block style={{minWidth:0,overflowWrap:'anywhere'}}><dt style={{fontWeight:700}}>{label}</dt><dd style={{margin:0}}><bdi>{text(key === 'register_name' ? row.register_name || row.register_code : row[key])}</bdi></dd></div>)}
        <div data-pdf-block><dt style={{fontWeight:700}}>תחולת מע״מ במועד יצירת השובר</dt><dd style={{margin:0}}>{row.vat_applicable === true ? 'חייב במע״מ' : row.vat_applicable === false ? 'לא חייב במע״מ' : 'לא נקבע'}</dd></div>
      </dl>
      {[['service_description','תיאור שירות / הזמנה'],['notes','הערות']].map(([key,label]) => <div key={key} data-pdf-block style={{marginTop:10}}><strong>{label}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'2px 0'}}>{text(row[key])}</p></div>)}
    </article>)}
    <footer data-pdf-block>הנתונים מבוססים על העותק ההיסטורי של כל שובר. חתימות הלקוחות שמורות בפרטי השובר במערכת ואינן נכללות בדו״ח.</footer>
  </section>;
}
