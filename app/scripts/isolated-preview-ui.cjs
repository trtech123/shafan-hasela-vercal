// Local browser smoke only. Run with the Playwright skill runner and Vite configured
// with https://preview-synthetic.supabase.co; every other external request is blocked.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = 'http://127.0.0.1:4177';
const synthetic = 'preview-synthetic.supabase.co';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const today = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date()).map(part => [part.type, part.value]));
const sessionDate = `${today.year}-${today.month}-${today.day}`;
const jwt = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'synthetic-signature',
].join('.');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const role of ['admin', 'cashier', 'instructor']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const calls = [];
      page.on('pageerror', error => console.error('PAGE ERROR', role, error.message));
      const customers = [];
      const sessions = [{ id: 'synthetic-session', club_id: 'synthetic-club', club_name: 'חוג בדיקה', session_date: sessionDate, start_time: '16:00', end_time: '17:00', status: 'scheduled', version: 0 }];
      let attendance = 'absent';
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname === '127.0.0.1' && url.pathname === '/api/pelecard-transactions') {
          calls.push(`${request.method()} ${url.pathname} ${request.postDataJSON()?.action}`);
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: [] }) });
        }
        if (url.hostname === '127.0.0.1') return route.continue();
        if (url.hostname !== synthetic) {
          calls.push(`BLOCKED ${url.origin}`);
          return route.abort();
        }
        calls.push(`${request.method()} ${url.pathname}`);
        const common = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'content-type': 'application/json' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: common, body: '' });
        const body = request.postDataJSON?.() || {};
        let data = [];
        if (url.pathname === '/auth/v1/token') data = { access_token: jwt, token_type: 'bearer', expires_in: 3600, refresh_token: 'synthetic-refresh', user: { id: userId, email: 'synthetic@example.test', aud: 'authenticated', role: 'authenticated' } };
        else if (url.pathname === '/auth/v1/user') data = { id: userId, email: 'synthetic@example.test', aud: 'authenticated', role: 'authenticated' };
        else if (url.pathname === '/rest/v1/profiles') data = { id: userId, email: 'synthetic@example.test', full_name: 'משתמש בדיקה', role };
        else if (url.pathname === '/rest/v1/clubs') data = [{ id: 'synthetic-club', name: 'חוג בדיקה', status: 'active', instructor_id: 'synthetic-instructor' }];
        else if (url.pathname === '/rest/v1/instructors') data = [{ id: 'synthetic-instructor', full_name: 'מדריך בדיקה' }];
        else if (url.pathname === '/rest/v1/club_sessions') data = sessions;
        else if (url.pathname === '/rest/v1/rpc/search_customers') data = customers.filter(row => body.p_include_archived || !row.archived_at).filter(row => !body.p_search || row.display_name.includes(body.p_search));
        else if (url.pathname === '/rest/v1/rpc/save_customer') {
          const current = customers.find(row => row.id === body.p_id);
          const row = { ...(current || {}), ...body.p_data, id: body.p_id || customerId, version: (current?.version || 0) + 1, archived_at: null };
          if (current) Object.assign(current, row); else customers.push(row);
          data = row;
        } else if (url.pathname === '/rest/v1/rpc/archive_customer') {
          const row = customers.find(item => item.id === body.p_id);
          if (row) row.archived_at = new Date().toISOString();
          data = row || {};
        } else if (url.pathname === '/rest/v1/rpc/get_club_attendance_history') {
          data = [{ session_id: sessions[0].id, membership_id: 'synthetic-membership', participant_id: 'synthetic-participant', participant_name: 'משתתף בדיקה', session_date: sessionDate, start_time: '16:00', session_status: 'scheduled', status: attendance, notes: '', version: attendance === 'absent' ? 0 : 1 }];
        } else if (url.pathname === '/rest/v1/rpc/get_instructor_club_sessions') data = { linked: true, sessions };
        else if (url.pathname === '/rest/v1/rpc/get_instructor_club_roster') data = [{ membership_id: 'synthetic-membership', participant_name: 'משתתף בדיקה', status: attendance, version: 0 }];
        else if (url.pathname === '/rest/v1/rpc/create_manual_club_session') {
          sessions.push({ id: 'synthetic-manual', club_id: body.p_club_id, session_date: body.p_date, start_time: body.p_start, end_time: body.p_end, status: 'scheduled', version: 0 });
          data = { id: 'synthetic-manual' };
        } else if (url.pathname === '/rest/v1/rpc/mark_club_attendance') {
          attendance = body.p_status; data = { status: attendance };
        }
        return route.fulfill({ status: 200, headers: common, body: JSON.stringify(data) });
      });
      await page.goto(`${base}/login`);
      await page.getByPlaceholder('name@example.com').fill('synthetic@example.test');
      await page.getByPlaceholder('••••••••').fill('synthetic-only');
      await page.getByRole('button', { name: 'כניסה' }).click();
      try { await page.getByText('משתמש בדיקה').first().waitFor({ timeout: 15000 }); }
      catch (error) { console.error('LOGIN DEBUG', role, page.url(), calls, (await page.locator('body').innerText()).slice(0, 600)); throw error; }
      if (role === 'admin') {
        await page.goto(`${base}/customers`);
        await page.getByRole('heading', { name: 'לקוחות' }).waitFor();
        await page.getByRole('button', { name: 'לקוח חדש' }).click();
        await page.getByLabel('שם לתצוגה').fill('לקוח סינתטי');
        await page.getByLabel('מדיניות מע״מ').selectOption('true');
        await page.getByRole('button', { name: 'שמירת כרטיס לקוח' }).click();
        await page.getByRole('heading', { name: 'לקוח סינתטי' }).waitFor();
        await page.getByRole('button', { name: 'עריכת כרטיס לקוח' }).click();
        await page.getByLabel('שם לתצוגה').fill('לקוח סינתטי מעודכן');
        await page.getByRole('button', { name: 'שמירת כרטיס לקוח' }).click();
        await page.getByRole('heading', { name: 'לקוח סינתטי מעודכן' }).waitFor();
        await page.getByLabel('חיפוש לקוחות').fill('מעודכן');
        await page.getByRole('heading', { name: 'לקוח סינתטי מעודכן' }).waitFor();
        await page.getByRole('button', { name: 'העברה לארכיון' }).click();
        await page.getByRole('button', { name: 'אישור העברה לארכיון' }).click();
        await page.getByText('לא נמצאו לקוחות').waitFor();
        await page.goto(`${base}/club-attendance`);
        await page.getByRole('heading', { name: 'נוכחות חוגים' }).waitFor();
        await page.getByRole('button', { name: '+ מפגש חדש' }).click();
        await page.getByLabel('שעת התחלה').fill('10:00');
        await page.getByLabel('שעת סיום').fill('11:00');
        await page.getByRole('button', { name: 'יצירת מפגש', exact: true }).click();
        await page.getByText('המפגש נוצר.').waitFor();
        await page.getByRole('button', { name: /פתיחת מפגש/ }).first().click();
        await Promise.all([
          page.waitForResponse(response => response.url().includes('/rpc/mark_club_attendance')),
          page.getByRole('button', { name: 'נוכח/ת' }).click(),
        ]);
        assert(calls.some(value => value.includes('/rpc/mark_club_attendance')));
        await page.goto(`${base}/pelecard-transactions`);
        await page.getByRole('heading', { name: 'עסקאות פלאקארד' }).waitFor();
        assert.equal(calls.filter(value => value.includes('/api/pelecard-transactions')).length, 0);
        await page.getByRole('button', { name: 'טעינת עסקאות' }).click();
        await page.getByText(/מוצגות 0 מתוך 0/).waitFor();
        assert.deepEqual(calls.filter(value => value.includes('/api/pelecard-transactions')), ['POST /api/pelecard-transactions range']);
        results.push('admin: customers create/edit/search/archive, manual club session, attendance, read-only Pelecard retrieval');
      } else if (role === 'cashier') {
        await page.goto(`${base}/customers`);
        await page.getByRole('heading', { name: 'לקוחות' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'העברה לארכיון' }).count(), 0);
        await page.goto(`${base}/club-attendance`);
        await page.getByRole('heading', { name: 'לוח זמנים' }).waitFor();
        await page.goto(`${base}/pelecard-transactions`);
        await page.getByRole('heading', { name: 'לוח זמנים' }).waitFor();
        assert.equal(calls.filter(value => value.includes('/api/pelecard-transactions')).length, 0);
        results.push('cashier: customer screen allowed; archive and admin attendance denied');
      } else {
        await page.goto(`${base}/instructor-attendance`);
        await page.getByRole('heading', { name: 'נוכחות בחוגים' }).waitFor();
        await page.getByRole('button', { name: 'פתיחת נוכחות' }).click();
        await page.getByText('משתתף בדיקה').first().waitFor();
        await Promise.all([
          page.waitForResponse(response => response.url().includes('/rpc/mark_club_attendance')),
          page.getByRole('button', { name: 'נוכח', exact: true }).click(),
        ]);
        assert(calls.some(value => value.includes('/rpc/mark_club_attendance')));
        await page.goto(`${base}/customers`);
        await page.getByRole('heading', { name: 'לוח זמנים' }).waitFor();
        results.push('instructor: linked roster and attendance action; customer route denied');
      }
      const unexpected = calls.filter(value => value.startsWith('BLOCKED') && !/fonts.googleapis.com|media.base44.com|www.hebcal.com/.test(value));
      assert.deepEqual(unexpected, [], `unexpected external request for ${role}`);
      await context.close();
    }
    console.log(JSON.stringify({ result: 'PASS', checks: results }, null, 2));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
