import {expect,test} from "vitest";
import {advance,createSession} from "../../../supabase/functions/_shared/chatbot/state-machine.js";
import {approvedContent as content,resolveResponse} from "../../../supabase/functions/_shared/chatbot/content.js";

const ordinary=["שלום","היי","הי","בוקר טוב","ערב טוב","אפשר פרטים?","אני רוצה מידע","🙂","סתם טקסט אחר","99"];
test.each(["start","menu.main",null])("ordinary input enters main menu from %s without handoff",currentState=>{
 for(const text of ordinary){
  const result=advance({content,session:{...createSession(),currentState},input:{text}});
  expect(result.session).toMatchObject({status:"automated",currentState:"menu.main"});
  expect(result.actions).toEqual([{type:"send",responseId:"policy.welcome"},{type:"send",responseId:"menu.main"}]);
 }
});
test.each(content.menus.menus.filter(m=>m.id!=="main").map(m=>m.id))("invalid input preserves %s and redisplays its options",menuId=>{
 const session={...createSession(),currentState:`menu.${menuId}`,parentState:"menu.main",selectedSite:"berko_360_tiberias",selectedActivity:"berko_treasure",collectedFields:{requested_activity:"berko_treasure",group_size_bucket:"small"}};
 for(const input of [{text:"99"},{text:"הי"},{text:"🙂"},{text:"בחירה לא מובנת"},{optionId:"invalid-option"}]){
  const result=advance({content,session,input});expect(result.session).toEqual(session);
  expect(result.actions).toEqual([{type:"send",responseId:"policy.invalid_selection"},{type:"send",responseId:`menu.${menuId}`}]);
  expect(resolveResponse(content,result.actions[0].responseId)).toContain("לא הצלחתי להבין את הבחירה");
 }
});
test.each(["נציג","נציג אנושי","דברו איתי"])("explicit human request remains intentional: %s",text=>{
 expect(advance({content,session:{...createSession(),currentState:"menu.corporate_topics"},input:{text}}).actions).toContainEqual(expect.objectContaining({type:"handoff",reason:"explicit_human_request"}));
});
test.each(["awaiting_human","human_active"])("fallback never bypasses %s",status=>{
 const session={...createSession(),currentState:"menu.main",status};
 expect(advance({content,session,input:{text:"הי"}})).toEqual({session,actions:[]});
});
