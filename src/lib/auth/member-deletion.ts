import {supabaseAdmin} from '@/lib/flows/admin-client';

/** Only the authorization-checked database RPC can create deletion jobs. */
export async function finishMemberDeletion(userId:string):Promise<boolean>{
 const db=supabaseAdmin();
 const {data:job,error:jobError}=await db.from('member_deletion_jobs').select('user_id,finished_at').eq('user_id',userId).maybeSingle();
 if(jobError)throw new Error('No se pudo consultar la baja');
 if(!job)return false;
 if(job.finished_at)return true;
 const {data:profile,error:profileError}=await db.from('profiles').select('id').eq('user_id',userId).maybeSingle();
 if(profileError||profile)throw new Error('La baja aún no está autorizada');
 // Ban first: even if the identity deletion must be retried, sign-in stops.
 const {error:banError}=await db.auth.admin.updateUserById(userId,{ban_duration:'876000h'});
 if(banError&&banError.code!=='user_not_found'){
  await db.from('member_deletion_jobs').update({last_error:banError.message}).eq('user_id',userId);
  return false;
 }
 const {error}=await db.auth.admin.deleteUser(userId,false);
 if(error&&error.code!=='user_not_found'){
  await db.from('member_deletion_jobs').update({last_error:error.message}).eq('user_id',userId);
  return false;
 }
 const {error:saveError}=await db.from('member_deletion_jobs').update({finished_at:new Date().toISOString(),last_error:null}).eq('user_id',userId);
 if(saveError)throw new Error('No se pudo registrar la baja finalizada');
 return true;
}

export async function processMemberDeletions(){
 const {data,error}=await supabaseAdmin().from('member_deletion_jobs').select('user_id').is('finished_at',null).order('created_at').limit(10);
 if(error)throw new Error('No se pudo consultar la cola de bajas');
 for(const job of data??[]){try{await finishMemberDeletion(job.user_id)}catch{console.error('[member-deletion] No se pudo finalizar una baja; se reintentará')}}
}
