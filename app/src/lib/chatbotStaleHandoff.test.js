import { expect, test, vi } from "vitest";
import { processVerifiedEvent } from "../../../supabase/functions/_shared/chatbot/process-event.js";
import { createChatbotRepository } from "../../../supabase/functions/_shared/chatbot/repository.js";
import { approvedContent } from "../../../supabase/functions/_shared/chatbot/content.js";
function harness(released = true, status = "awaiting_human") {
  let fresh = true;
  const repository = {
    claimEvent: vi.fn(async () => { const claimed = fresh; fresh = false; return {claimed,eventId:"e"}; }),
    upsertVerifiedContact: vi.fn(async()=>({id:"c"})),
    getOrCreateConversation: vi.fn(async()=>({id:"v",status,currentState:"menu.corporate_topics",selectedActivity:"berko_treasure"})),
    insertInboundMessage: vi.fn(),
    releaseStaleHandoff: vi.fn(async()=>released ? {id:"reset",body:"reset menu",messageKind:"text"}:null),
    updateOutboundDelivery: vi.fn(),completeEvent:vi.fn(),failEvent:vi.fn(),
    updateConversation:vi.fn(),insertOutboundMessage:vi.fn(),
  };
  return {repository,sender:{sendText:vi.fn(async()=>({providerMessageId:"meta"})),sendAttachment:vi.fn()},event:{eventKind:"message",channel:"whatsapp",input:{text:"8"},externalContactId:"synthetic"}};
}
test("stale handoff sends persisted reset only; stale package choice and replay send no attachment",async()=>{
  const h=harness();await processVerifiedEvent(h);await processVerifiedEvent(h);
  expect(h.repository.releaseStaleHandoff).toHaveBeenCalledOnce();
  expect(h.sender.sendText).toHaveBeenCalledExactlyOnceWith({channel:"whatsapp",to:"synthetic",text:"reset menu"});
  expect(h.sender.sendAttachment).not.toHaveBeenCalled();
  expect(h.repository.updateConversation).not.toHaveBeenCalled();
  expect(h.repository.insertOutboundMessage).not.toHaveBeenCalled();
});
test.each(["awaiting_human","human_active"])("RPC denial keeps %s suppressed",async status=>{
 const h=harness(false,status);await processVerifiedEvent(h);expect(h.sender.sendText).not.toHaveBeenCalled();expect(h.repository.completeEvent).toHaveBeenCalledWith("e");
});
test("reset send uncertainty is terminal for replay",async()=>{
 const h=harness();h.sender.sendText.mockRejectedValue(new Error("provider timeout"));
 await expect(processVerifiedEvent(h)).rejects.toThrow();
 expect(h.repository.failEvent).toHaveBeenCalledWith("e","handoff_reset_uncertain");
 await processVerifiedEvent(h);expect(h.sender.sendText).toHaveBeenCalledOnce();
});
test("repository delegates expiry and reset persistence to service RPC",async()=>{
 const rpc=vi.fn(async()=>({data:[{id:"m",body:"reset",message_kind:"text"}],error:null}));
 const repo=createChatbotRepository({rpc});expect(await repo.releaseStaleHandoff("c","e","reset")).toMatchObject({id:"m",body:"reset",messageKind:"text"});
 expect(rpc).toHaveBeenCalledWith("release_stale_bot_handoff",{p_conversation_id:"c",p_event_id:"e",p_reset_body:"reset"});
});
test("after reset, a fresh corporate/package selection still delivers D9",async()=>{
 const h=harness();let sequence=0;
 let session={id:"v",status:"awaiting_human",currentState:"menu.corporate_topics",selectedActivity:"carmel"};
 h.repository.claimEvent.mockImplementation(async()=>({claimed:true,eventId:`e${sequence++}`}));
 h.repository.getOrCreateConversation.mockImplementation(async()=>session);
 h.repository.releaseStaleHandoff.mockImplementation(async()=>{session={id:"v",status:"automated",currentState:"menu.main",collectedFields:{}};return {id:"reset",body:"reset menu"};});
 h.repository.updateConversation.mockImplementation(async(id,next)=>{session={id,...next};});
 h.repository.insertOutboundMessage.mockImplementation(async m=>({...m,id:`m${sequence}`}));
 h.repository.claimAttachment=vi.fn(async()=>"claimed");h.repository.recordAction=vi.fn();
 h.sender.sendAttachment.mockResolvedValue({providerMessageId:"media"});
 await processVerifiedEvent(h);expect(h.sender.sendAttachment).not.toHaveBeenCalled();
 h.event.input.text="2";await processVerifiedEvent(h);expect(h.sender.sendAttachment).not.toHaveBeenCalled();
 h.event.input.text="8";await processVerifiedEvent(h);
 expect(h.sender.sendAttachment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({assetId:"berko_treasure"}));
 expect(session.currentState).toBe("menu.corporate_group_size");
});
test("handoff confirmation explicitly states transfer; reset copy is Hebrew",()=>{
 expect(approvedContent.handoff.transfer_response).toContain("הבקשה שלך הועברה לנציג");
 expect(approvedContent.handoff.stale_reset_response).toContain("החזרתי אותך לתפריט הראשי");
 expect(approvedContent.handoff.stale_reset_response).not.toContain("?");
});
