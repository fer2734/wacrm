"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, FileCheck2, FileSignature, RefreshCw, Shield, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

type Request={id:string;status:"pendiente"|"firmado"|"revocado";issued_at:string;expires_at:string;signed_at:string|null;signer_name:string|null;snapshot_sha256:string};
type Settings={company_name:string;company_cuit:string;company_address:string;representative:string};
const blank:Settings={company_name:"VALLE AUTOMOTORES S.A.S.",company_cuit:"",company_address:"",representative:""};
const input="min-h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
const control="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const primary="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-extrabold text-primary-foreground disabled:opacity-50";
export function ContractManager({saleId,accountId,userId,admin}:{saleId:string;accountId:string;userId:string;admin:boolean}){
 const [requests,setRequests]=useState<Request[]>([]);
 const [settings,setSettings]=useState<Settings>(blank);
 const [saving,setSaving]=useState(false);
 const [issuing,setIssuing]=useState(false);
 const [issuedLink,setIssuedLink]=useState("");
 const [showConfig,setShowConfig]=useState(false);
 const load=useCallback(async()=>{
  const db=createClient();
  const [r,c]=await Promise.all([
   db.from("erp_signing_requests").select("id,status,issued_at,expires_at,signed_at,signer_name,snapshot_sha256").eq("sale_id",saleId).order("issued_at",{ascending:false}).limit(25),
   db.from("erp_contract_settings").select("company_name,company_cuit,company_address,representative").eq("account_id",accountId).maybeSingle()
  ]);
  if(r.error)throw r.error;if(c.error)throw c.error;
  setRequests((r.data||[]) as Request[]);
  if(c.data)setSettings(c.data as Settings);
 },[saleId,accountId]);
 useEffect(()=>{setIssuedLink("");void load().catch(e=>toast.error(e.message));},[load]);
 async function saveSettings(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(saving||!admin)return;setSaving(true);
  try{
   const {error}=await createClient().from("erp_contract_settings").upsert({
    account_id:accountId,...settings,updated_by:userId,updated_at:new Date().toISOString()
   },{onConflict:"account_id"});
   if(error)throw error;
   toast.success("Datos de la empresa guardados");setShowConfig(false);await load();
  }catch(e){toast.error(e instanceof Error?e.message:"Error al guardar")}
  finally{setSaving(false)}
 }
 async function issue(){
  if(issuing)return;setIssuing(true);setIssuedLink("");
  try{
   const res=await fetch("/api/erp/signatures",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sale_id:saleId})});
   const data=await res.json();if(!res.ok)throw new Error(data.error||"No se pudo emitir el contrato");
   setIssuedLink(data.link);await load();
   toast.success("Enlace único generado. Copialo y envialo al cliente.");
  }catch(e){toast.error(e instanceof Error?e.message:"Error al generar enlace")}
  finally{setIssuing(false)}
 }
 const signed=requests.find(r=>r.status==="firmado");
 const pending=requests.find(r=>r.status==="pendiente"&&new Date(r.expires_at).getTime()>Date.now());
 const validCompany=!!settings.company_name.trim()&&!!settings.company_cuit.trim()&&!!settings.company_address.trim();
 return <div className="space-y-4">
  <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
   <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-extrabold"><FileSignature size={18} className="text-primary"/> Contrato y firma electrónica</h2>
   <button onClick={()=>void load().catch(e=>toast.error(e.message))} className={control}><RefreshCw size={15}/> Actualizar</button></div>
   <p className="mb-3 text-xs text-muted-foreground">El contrato se genera automáticamente a partir de la solicitud de adhesión, conservando las condiciones generales completas. El cliente recibe un enlace de un solo uso para aceptar, firmar y adjuntar una selfie.</p>
   {signed?<div className="space-y-3 rounded-xl border border-emerald-300/50 bg-emerald-500/10 p-4">
    <p className="flex items-center gap-2 font-extrabold"><CheckCircle2 size={18} className="text-emerald-600"/> Contrato firmado</p>
    <p className="text-xs">Titular: {signed.signer_name} · {signed.signed_at?new Date(signed.signed_at).toLocaleString("es-AR"):""}</p>
    <a className={primary} href={"/api/erp/signatures/print?request_id="+encodeURIComponent(signed.id)} target="_blank" rel="noopener noreferrer"><FileCheck2 size={17}/> Ver contrato y evidencias</a>
   </div>:<div className="space-y-3">
    {!validCompany&&<p className="rounded-xl border border-amber-300/60 bg-amber-500/10 p-3 text-xs">Antes de emitir enlaces, Administración debe completar la razón social, CUIT y domicilio legal.</p>}
    {pending&&<p className="text-xs text-muted-foreground">Existe un enlace pendiente que vence el {new Date(pending.expires_at).toLocaleString("es-AR")}. Generar otro revocará el anterior.</p>}
    <button className={primary} disabled={issuing||!validCompany} onClick={()=>void issue()}><FileSignature size={17}/>{issuing?"Preparando contrato…":pending?"Generar nuevo enlace (revoca el anterior)":"Emitir contrato y enlace de firma"}</button>
    {issuedLink&&<div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
     <p className="text-xs font-bold">Enlace privado, válido por 72 horas y un solo uso:</p>
     <input readOnly value={issuedLink} className={input} aria-label="Enlace de firma"/>
     <button className={control} onClick={()=>void navigator.clipboard.writeText(issuedLink).then(()=>toast.success("Enlace copiado"),()=>toast.error("Seleccioná y copiá el enlace manualmente"))}><Copy size={15}/> Copiar enlace para WhatsApp</button>
     <p className="text-[11px] text-muted-foreground">Una vez que el cliente lo firma, la URL ya no sirve para volver a firmar. La selfie y la firma quedan almacenadas de forma privada.</p>
    </div>}
   </div>}
  </section>
  {admin&&<section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
   <button className="flex w-full items-center justify-between text-left text-sm font-extrabold" onClick={()=>setShowConfig(v=>!v)}><span className="flex items-center gap-2"><Settings2 size={17}/> Datos legales de la empresa</span><span className="text-xs text-primary">{showConfig?"Ocultar":"Configurar"}</span></button>
   {showConfig&&<form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveSettings}>
    {([["company_name","Razón social"],["company_cuit","CUIT de la empresa"],["company_address","Domicilio legal"],["representative","Representante de la empresa"]] as const).map(([key,title])=><label key={key} className="space-y-1 text-xs font-bold text-muted-foreground">{title}<input required={key!=="representative"} className={input} value={settings[key]} onChange={e=>setSettings(s=>({...s,[key]:e.target.value}))}/></label>)}
    <p className="text-xs text-muted-foreground sm:col-span-2">Estos datos deben coincidir con la documentación societaria y fiscal. El contrato ya firmado no se modifica al cambiar esta configuración.</p>
    <div className="sm:col-span-2"><button disabled={saving} className={primary} type="submit"><Shield size={15}/>{saving?"Guardando…":"Guardar datos de la empresa"}</button></div>
   </form>}
  </section>}
  <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
   <h2 className="mb-3 text-sm font-extrabold">Historial de enlaces y firmas</h2>
   <div className="space-y-2">{requests.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-xs"><div><p className="font-bold">{r.status==="firmado"?"Firmado":r.status==="revocado"?"Revocado":new Date(r.expires_at)<new Date()?"Vencido":"Pendiente"}</p><p className="text-muted-foreground">{new Date(r.issued_at).toLocaleString("es-AR")}</p></div>{r.status==="firmado"&&<a className={control} href={"/api/erp/signatures/print?request_id="+encodeURIComponent(r.id)} target="_blank" rel="noopener noreferrer">Ver constancia</a>}</div>)}
    {!requests.length&&<p className="text-xs text-muted-foreground">No se emitió ningún enlace de firma para esta operación.</p>}
   </div>
  </section>
  <p className="text-[11px] text-muted-foreground">Firma electrónica: trazo, selfie y constancia de aceptación. No equivale a firma digital con certificado bajo la Ley 25.506. La selfie no realiza verificación biométrica automática.</p>
 </div>;
}
