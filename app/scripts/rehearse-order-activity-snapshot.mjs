import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
const sql=async (query,params=[])=> (await db.query(query,params)).rows;
const migration=new URL('../../supabase/migrations/202611210001_order_confirmation_activity_snapshot.sql',import.meta.url);
const orderId='10000000-0000-4000-8000-000000000001';
const activityId='20000000-0000-4000-8000-000000000001';
try {
 await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('app.test_uid',true),'')::uuid$$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('app.test_role',true)$$;
  CREATE FUNCTION public.get_my_instructor_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;
  CREATE TABLE public.profiles(id uuid,role text);
  CREATE TABLE public.activities(id uuid PRIMARY KEY,name text,description text,duration_hours numeric,created_at timestamptz,updated_at timestamptz);
  CREATE TABLE public.customer_snapshots(id uuid,order_id uuid,data jsonb);
  CREATE TABLE public.orders(id uuid PRIMARY KEY,order_number text,activity_id uuid REFERENCES public.activities(id) ON DELETE SET NULL,
   instructor_id uuid,created_at timestamptz,updated_at timestamptz,customer_snapshot_id uuid,
   client_name text,client_phone text,client_email text,organization text,activity_date date,start_time time,end_time time,
   site text,num_participants integer,price_per_person numeric,total_price numeric,notes text,status text,payment_status text,
   vat_applicable boolean,quotation_snapshot jsonb,customer_record_version integer,
   billing_institution_name text,billing_company_id text,billing_accounting_email text,billing_address_line text,
   billing_city text,billing_postal_code text,billing_country_code text);
  INSERT INTO public.activities VALUES ('${activityId}','Original activity','Saved description',2,
   '2026-01-01','2026-01-01');
  INSERT INTO public.orders(id,order_number,activity_id,created_at,num_participants,total_price)
   VALUES ('${orderId}','ORD-TEST','${activityId}','2026-11-19',1,0);
  SELECT set_config('app.test_role','service_role',false);
 `);
 await db.exec(await readFile(migration,'utf8'));
 let row=(await sql('SELECT public.order_confirmation_data($1) AS doc',[orderId]))[0].doc;
 assert.equal(row.activity_snapshot.name,'Original activity','verified legacy activity should appear');
 await sql("SELECT set_config('app.test_role','authenticated',false)");
 await assert.rejects(()=>sql('SELECT public.order_confirmation_data($1)',[orderId]),/order_delivery_forbidden/);
 await sql("INSERT INTO public.profiles VALUES ('30000000-0000-4000-8000-000000000001','cashier')");
 await sql("SELECT set_config('app.test_uid','30000000-0000-4000-8000-000000000001',false)");
 assert.equal((await sql('SELECT public.order_confirmation_data($1) AS doc',[orderId]))[0].doc.activity_snapshot.name,'Original activity');
 await sql("SELECT set_config('app.test_role','service_role',false)");
 await sql("UPDATE public.activities SET name='Later catalog name',updated_at='2026-11-20' WHERE id=$1",[activityId]);
 row=(await sql('SELECT public.order_confirmation_data($1) AS doc',[orderId]))[0].doc;
 assert.equal(row.activity_snapshot,undefined,'modified legacy activity must not be invented');
 await sql("UPDATE public.activities SET name='Original activity',updated_at='2026-01-01' WHERE id=$1",[activityId]);
 const newOrder='10000000-0000-4000-8000-000000000002';
 await sql("INSERT INTO public.orders(id,order_number,activity_id,created_at,num_participants,total_price) VALUES($1,'ORD-NEW',$2,'2026-11-19',1,0)",[newOrder,activityId]);
 row=(await sql('SELECT public.order_confirmation_data($1) AS doc',[newOrder]))[0].doc;
 assert.equal(row.activity_snapshot.name,'Original activity');
 await sql("UPDATE public.activities SET name='Changed after order',updated_at='2026-11-20' WHERE id=$1",[activityId]);
 row=(await sql('SELECT public.order_confirmation_data($1) AS doc',[newOrder]))[0].doc;
 assert.equal(row.activity_snapshot.name,'Original activity','new order keeps frozen name');
 await sql('DELETE FROM public.activities WHERE id=$1',[activityId]);
 row=(await sql('SELECT public.order_confirmation_data($1) AS doc',[newOrder]))[0].doc;
 assert.equal(row.activity_snapshot.name,'Original activity','deletion keeps frozen name');
 assert.equal(row.customer_snapshot,null);
 console.log('order activity snapshot migration rehearsal passed');
} finally {await db.close();}
