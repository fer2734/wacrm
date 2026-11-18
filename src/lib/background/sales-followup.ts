import {supabaseAdmin} from '@/lib/flows/admin-client';
import {engineSendText} from '@/lib/flows/meta-send';
interface IdleRun {id:string;account_id:string;user_id:string;contact_id:string;conversation_id:string;vars:Record<string,unknown>}
export async function processIdleSalesRuns(){const db=supabaseAdmin();const {data,error}=await db.rpc('claim_idle_sales_runs');if(error)throw new Error(error.message);
 for(const run of (data??[]) as IdleRun[]){
  const {data:prior}=await db.from('flow_run_events').select('id').eq('flow_run_id',run.id).eq('event_type','timeout').contains('payload',{reason:'idle_five_minutes',notice_sent:true}).limit(1);
  let sent=!!prior?.length;
  try{if(!sent)await engineSendText({accountId:run.account_id,userId:run.user_id,contactId:run.contact_id,conversationId:run.conversation_id,stopWhenAssigned:true,text:'Voy a derivar tu consulta a un asesor de Valle Automotores para que continúe la atención desde su propio WhatsApp. ¡Gracias por contactarnos!'});sent=true}catch(error){console.error('[sales-followup] notification failed',error instanceof Error?error.message:'send failed')}
  const summary=['Derivación automática: 5 minutos sin respuesta.',...Object.entries(run.vars??{}).map(([key,value])=>`${key}: ${String(value)}`)].join('\n');
  const {error:assignment}=await db.rpc('assign_next_sales_agent',{p_account_id:run.account_id,p_conversation_id:run.conversation_id,p_summary:summary});
  if(assignment){console.error('[sales-followup] assignment failed',assignment.message);await db.from('flow_runs').update({status:'active',ended_at:null,end_reason:'retry_idle_assignment'}).eq('id',run.id).eq('end_reason','idle_five_minutes');}
  await db.from('flow_run_events').insert({flow_run_id:run.id,event_type:'timeout',payload:{reason:'idle_five_minutes',notice_sent:sent,assigned:!assignment}});
 }
 return (data??[]).length;
}
