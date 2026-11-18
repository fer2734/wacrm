import {processIdleSalesRuns} from './sales-followup';
type State={started:boolean;busy:boolean;lastTick:string|null;lastSuccess:string|null};
const host=globalThis as typeof globalThis&{valleFollowupWorker?:State};
export function workerState(){return host.valleFollowupWorker??{started:false,busy:false,lastTick:null,lastSuccess:null}}
export function startFollowupWorker(){if(host.valleFollowupWorker?.started)return;const state:State={started:true,busy:false,lastTick:null,lastSuccess:null};host.valleFollowupWorker=state;
 const tick=async()=>{if(state.busy)return;state.busy=true;state.lastTick=new Date().toISOString();try{await processIdleSalesRuns();state.lastSuccess=new Date().toISOString()}catch(error){console.error('[sales-followup]',error instanceof Error?error.message:'worker error')}finally{state.busy=false}};
 const timer=setInterval(()=>void tick(),15000);timer.unref();void tick();
}
