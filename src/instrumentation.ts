export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NODE_ENV==='production'&&process.env.SUPABASE_SERVICE_ROLE_KEY){
  const {startFollowupWorker}=await import('./lib/background/worker');startFollowupWorker();
 }
}
