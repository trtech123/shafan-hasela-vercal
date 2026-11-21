import {describe,it,expect} from 'vitest';
import {orderConfirmationModel} from './orderConfirmation.js';

const order={order_number:'ORD-TEST',num_participants:1,price_per_person:0,total_price:0};

describe('historical order activity in confirmation documents',()=>{
 it('renders the immutable order activity snapshot when no quotation lines were saved',()=>{
  const model=orderConfirmationModel({...order,activity_snapshot:{id:'original-id',name:'פעילות מקורית',description:'תיאור בזמן ההזמנה',duration_hours:2}});
  expect(model.items).toEqual([expect.objectContaining({name:'פעילות מקורית',description:'תיאור בזמן ההזמנה',duration:2})]);
  expect(model.legacy).toBe(false);
 });
 it('keeps saved quotation lines ahead of a later activity selection',()=>{
  const model=orderConfirmationModel({...order,activity_snapshot:{name:'פעילות חדשה'},quotation_snapshot:{selected_activities:[{activity_name:'פעילות בהצעה המקורית',quantity:1,price_per_person:0,line_total:0}]}});
  expect(model.items.map(item=>item.name)).toEqual(['פעילות בהצעה המקורית']);
 });
 it('does not invent a name when an old activity was deleted or changed before it could be frozen',()=>{
  const model=orderConfirmationModel({...order,activity_id:'missing-id',activity_snapshot:null});
  expect(model.items[0].name).toBe('פירוט פעילות/מוצר היסטורי לא נשמר');
 });
});
