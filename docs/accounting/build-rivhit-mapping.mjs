import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const output = new URL('./rivhit-journal-mapping-for-anat-20261122.xlsx', import.meta.url);
const workbook = Workbook.create();
const mapping = workbook.worksheets.add('מיפוי לענת');
mapping.showGridLines = false;
mapping.getRange('A2').values = [['שפן הסלע — מיפוי פקודות יומן לריווחית | טיוטה לאישור ענת']];
mapping.getRange('A3').values = [['אין ערכי חשבון או קודי מיון מאושרים. אין להפעיל סנכרון מתוך גיליון זה.']];
const headers = ['תרחיש', 'אירוע מקור מוצע לבדיקה', 'מסמך Payper נדרש', 'חשבון חובה', 'חשבון זכות', 'קוד מיון', 'טיפול מע״מ', 'אתר / פרויקט Rivhit', 'תאריך רישום', 'אסמכתה', 'טיפול בהחזר / קיזוז', 'החלטה נדרשת מענת'];
mapping.getRange('A5:L5').values = [headers];
const rows = [
  ['אשראי Hosted — הזמנה', 'תשלום מאומת + מסמך מקושר', 'חשבונית־קבלה / מסמך מאושר', '', '', '', '', '', '', '', '', 'הכנסה מול סליקה; אין כפל מול Payper'],
  ['אשראי Hosted — קופה', 'תשלום מאומת + מכירה + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'מיפוי הכנסה לפי מוצר / אתר'],
  ['CT20 ישיר — הזמנה', 'J4 מאומת + מכירה + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'התאמה ל־ParamX / UID ולמסמך'],
  ['CT20 ישיר — קופה', 'J4 מאומת + מכירה + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'חשבון סליקה ומועד הכרה'],
  ['מזומן — הזמנה', 'גבייה מאומתת + מכירה + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'חשבון קופה ומועד הכרה'],
  ['מזומן — קופה', 'גבייה מאומתת + מכירה + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'חשבון קופה ומועד הכרה'],
  ['המחאה', 'קבלה מאושרת + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'פרטי המחאה, דחוי/נפרע, כשל פירעון'],
  ['אשראי חיצוני', 'אישור חיצוני מתועד + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'ראיית סליקה ומניעת כפילות'],
  ['העברה בנקאית', 'אישור קליטה בבנק + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'מועד הכרה וחשבון בנק'],
  ['Bit / Paybox', 'ראיית קבלה חיצונית + מסמך', 'מסמך מאושר', '', '', '', '', '', '', '', '', 'חשבון מעבר / עמלות / ראיית תשלום'],
  ['תשלום חלקי או מפוצל', 'כל פירעון מאומת, מול חוב קיים', 'מסמך מתאים לכל שלב', '', '', '', '', '', '', '', '', 'לא לרשום הכנסה ומע״מ פעמיים'],
  ['מקדמה / חיוב נדחה', 'אירוע הכרה לפי כלל מאושר', 'מסמך מתאים לפי שלב', '', '', '', '', '', '', '', '', 'מקדמה, חייבים, סגירת יתרה'],
  ['החזר / ביטול', 'החזר מאומת + מסמך זיכוי', 'זיכוי מאושר', '', '', '', '', '', '', '', '', 'היפוך, קשר לפקודה מקורית, סימן סכום'],
  ['סל מע״מ / אתרים מעורב', 'פיצול לפי שורות מסמך שמורות', 'מסמך עם רכיבי מס', '', '', '', '', '', '', '', '', 'פיצול מע״מ והכנסה לפי אתר ומוצר'],
];
mapping.getRange(`A6:L${5 + rows.length}`).values = rows;
mapping.getRange('A2:L2').format.font = { name: 'Arial', size: 14, bold: true, color: '#17324D' };
mapping.getRange('A3:L3').format.font = { name: 'Arial', size: 10, color: '#9A3412' };
mapping.getRange('A5:L5').format = { fill: '#17324D', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' } };
mapping.getRange(`A6:L${5 + rows.length}`).format.font = { name: 'Arial', size: 10, color: '#1F2937' };
mapping.getRange(`D6:I${5 + rows.length}`).format.fill = '#FFF4D6';
mapping.getRange(`A5:L${5 + rows.length}`).format.rowHeight = 24;
mapping.getRange('A:A').format.columnWidth = 25;
mapping.getRange('B:C').format.columnWidth = 33;
mapping.getRange('D:I').format.columnWidth = 21;
mapping.getRange('J:K').format.columnWidth = 23;
mapping.getRange('L:L').format.columnWidth = 39;
mapping.freezePanes.freezeRows(5);

const questions = workbook.worksheets.add('החלטות ומקורות');
questions.showGridLines = false;
questions.getRange('A2').values = [['החלטות לפני פיתוח סנכרון']];
questions.getRange('A4:C4').values = [['נושא', 'תשובה / מזהה מאושר', 'מי מאשר']];
const q = [
  ['דוגמת פקודה ידנית לכל תרחיש (ללא פרטים אישיים)', '', 'ענת'],
  ['אירוע הכרה בהכנסה ובמע״מ; מניעת כפילות מול Payper', '', 'ענת + הנהלה'],
  ['קודי מיון, חשבונות חובה/זכות, חשבונות סליקה והכנסה', '', 'ענת'],
  ['מע״מ רגיל/אפס/פטור ופיצול מע״מ אוטומטי או ידני', '', 'ענת'],
  ['מיפוי אתר ומוצר ל־project_id ולחשבון הכנסה', '', 'ענת + הנהלה'],
  ['תשלומים חלקיים, פיצול, מקדמה וחיוב נדחה', '', 'ענת'],
  ['החזר, ביטול, זיכוי, וקשר לרישום המקורי', '', 'ענת'],
  ['אסמכתאות, תאריכים, תקופה סגורה ומטבע חוץ', '', 'ענת'],
  ['מועד cutover ורשימת רישומים ידניים קיימים', '', 'ענת + הנהלה'],
  ['הבטחת idempotency ב־AddJournal ויכולת readback', '', 'Rivhit'],
];
questions.getRange(`A5:C${4 + q.length}`).values = q;
questions.getRange('A2:C2').format.font = { name: 'Arial', size: 14, bold: true, color: '#17324D' };
questions.getRange('A4:C4').format = { fill: '#17324D', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' } };
questions.getRange(`A5:C${4 + q.length}`).format.font = { name: 'Arial', size: 10, color: '#1F2937' };
questions.getRange(`B5:B${4 + q.length}`).format.fill = '#FFF4D6';
questions.getRange('A:A').format.columnWidth = 64;
questions.getRange('B:B').format.columnWidth = 48;
questions.getRange('C:C').format.columnWidth = 21;
questions.getRange('A17').values = [['מקור API רשמי: https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/AddJournal']];
questions.getRange('A18').values = [['קריאת פקודות: https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/JournalsReport']];
workbook.recalculate();
const inspected = await workbook.inspect({ kind: 'sheet', include: 'id,name', maxChars: 1500 });
console.log(inspected.ndjson ?? inspected);
await fs.mkdir(new URL('.', output), { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(fileURLToPath(output));
console.log(fileURLToPath(output));
