import { beforeEach, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeTables } from './fake-db.test-helper';
import { VALLE_SALES_FLOW } from './valle-sales';
const h = vi.hoisted(() => ({ db: null as unknown, tables: {} as FakeTables, text: vi.fn(), buttons: vi.fn(), assignments: vi.fn() }));
vi.mock('./admin-client', () => ({ supabaseAdmin: () => h.db }));
vi.mock('./meta-send', () => ({ engineSendText: (...a: unknown[]) => h.text(...a), engineSendInteractiveButtons: (...a: unknown[]) => h.buttons(...a), engineSendInteractiveList: vi.fn(), engineSendMedia: vi.fn() }));
import { dispatchInboundToFlows } from './engine';
let sequence = 0;
const input = (text: string, first = false) => dispatchInboundToFlows({ accountId:'account', userId:'owner', contactId:'contact', conversationId:'chat', isFirstInboundMessage:first, message:{kind:'text',text,meta_message_id:`m${++sequence}`} });
beforeEach(() => {
 sequence=0; vi.clearAllMocks(); h.text.mockResolvedValue({whatsapp_message_id:'sent'}); h.buttons.mockResolvedValue({whatsapp_message_id:'buttons'});
 h.tables={ conversations:[{id:'chat',account_id:'account',assigned_agent_id:null,ai_autoreply_disabled:false}], flows:[{...VALLE_SALES_FLOW,id:'flow',account_id:'account',user_id:'owner',status:'active',fallback_policy:{on_unknown_reply:'handoff',max_reprompts:0,on_timeout_hours:24,on_exhaust:'handoff'}}], flow_nodes:VALLE_SALES_FLOW.nodes.map((n,i)=>({...n,id:`n${i}`,flow_id:'flow'})),flow_runs:[],flow_run_events:[],messages:[] };
 const db=createFakeDb(h.tables);
 h.db={...db,rpc:async (name: string,args: Record<string,unknown>)=>{
  if(name==='assign_next_sales_agent') { h.assignments(args); Object.assign(h.tables.conversations[0],{assigned_agent_id:'advisor',ai_autoreply_disabled:true}); }
  return {data:'advisor',error:null};
 }};
});
it('collects the intake, writes a summary and hands off once without AI',async()=>{
 await input('Hola',true); await input('Volkswagen Up');
 await dispatchInboundToFlows({accountId:'account',userId:'owner',contactId:'contact',conversationId:'chat',isFirstInboundMessage:false,message:{kind:'interactive_reply',reply_id:'capital',reply_title:'Dinero',meta_message_id:'button-reply'}});
 await input('4 millones'); await input('María'); await input('General Roca');
 expect(h.assignments).toHaveBeenCalledTimes(1);
 expect(h.assignments.mock.calls[0][0].p_summary).toContain('General Roca');
 expect(h.assignments.mock.calls[0][0].p_summary).toContain('4 millones');
 const sent=h.text.mock.calls.length;
 await input('Gracias'); expect(h.text).toHaveBeenCalledTimes(sent); expect(h.assignments).toHaveBeenCalledTimes(1);
});
it('hands off immediately when a customer requests a person',async()=>{
 await input('Hola',true); await input('Quiero un asesor'); expect(h.assignments).toHaveBeenCalledTimes(1);
});
it('does not restart a bot after assignment or after manual unassignment',async()=>{
 Object.assign(h.tables.conversations[0],{ai_autoreply_disabled:true}); await input('Hola',true);
 expect(h.text).not.toHaveBeenCalled(); expect(h.tables.flow_runs).toHaveLength(0);
});
it('routes an audio without text to an advisor instead of repeating questions',async()=>{
 await input('Hola',true); await input(''); expect(h.assignments).toHaveBeenCalledTimes(1);
});

it('keeps an obvious vehicle from the first message instead of asking again',async()=>{
 await input('Quisiera una Toyota Hilux',true); expect(h.buttons).toHaveBeenCalledTimes(1); expect(h.text).not.toHaveBeenCalled();
 expect(h.tables.flow_runs[0].vars).toMatchObject({vehiculo:'Quisiera una Toyota Hilux'});
});
