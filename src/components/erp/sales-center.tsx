"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, CreditCard, FileSignature, FileText, FolderOpen, Plus, RefreshCw, Search, UserRound, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { sections } from "@/lib/erp/application-fields";
import { CompleteSaleEditor } from "@/components/erp/complete-sale-editor";
import { ContractManager } from "@/components/erp/contract-manager";

type Role = "propietario" | "administracion" | "vendedor" | "consulta";
type Customer = { id:string; agent_id:string; full_name:string; document_number:string|null; phone:string; email:string|null; address:string|null; city:string|null; province:string|null; notes:string|null; crm_contact_id:string|null; created_at:string };
type Sale = { id:string; customer_id:string; agent_id:string; vehicle_description:string; vehicle_type:string; operation_type:string; price:number; initial_amount:number; admin_fee:number; installment_amount:number; installment_count:number; delivery_target_installment:number; entry_date:string|null; second_due_date:string|null; first_due:string|null; stage:string; credit_status:string; notes:string|null; crm_conversation_id:string|null; created_at:string };
type Installment = { id:string; sale_id:string; installment_number:number; due_date:string; amount:number };
type Payment = { id:string; sale_id:string; installment_id:string; amount:number; status:string; method:string; paid_at:string; reference:string|null; created_at:string };
type Document = { id:string; sale_id:string; payment_id:string|null; kind:string; file_name:string; object_path:string; created_at:string };
type Followup = { id:string; sale_id:string; outcome:string; notes:string; next_contact_at:string|null; created_at:string };
type Application = { sale_id:string; data:Record<string,string>; updated_at:string };
type Person = { user_id:string; full_name:string|null; email:string };
type DB = { customers:Customer[]; sales:Sale[]; installments:Installment[]; payments:Payment[]; documents:Document[]; followups:Followup[]; applications:Application[]; people:Person[] };
const empty:DB={customers:[],sales:[],installments:[],payments:[],documents:[],followups:[],applications:[],people:[]};
type Section = "resumen"|"solicitud"|"contrato"|"pagos"|"seguimiento";
const input="min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";
const label="block min-w-0 space-y-1.5 text-xs font-semibold text-muted-foreground";
const button="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity disabled:opacity-50";
const ghost="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50";
const money=(x:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(x||0));
const val=(x:FormDataEntryValue|null)=>String(x??"").trim();
const num=(x:FormDataEntryValue|null)=>Number(val(x).replace(",","."))||0;
const localDate=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const addMonth=(d:string)=>{const [y,m,day]=d.split("-").map(Number);const max=new Date(Date.UTC(y,m+1,0)).getUTCDate();return [y+(m===12?1:0),String(m===12?1:m+1).padStart(2,"0"),String(Math.min(day,max)).padStart(2,"0")].join("-")};
const fmtDate=(d:string|null)=>d?new Date(d.slice(0,10)+"T12:00:00").toLocaleDateString("es-AR"):"Sin definir";
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
async function rows<T>(name:string,accountId:string,limit=2500):Promise<T[]>{
 const {data,error}=await createClient().from(name).select("*").eq("account_id",accountId).limit(limit);
 if(error)throw new Error(name+": "+error.message);
 return (data??[]) as T[];
}
function Panel({title,icon,children,aside}:{title:string;icon?:ReactNode;children:ReactNode;aside?:ReactNode}){
 return <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-extrabold sm:text-base">{icon}{title}</h2>{aside}</div>{children}
 </section>;
}
function Submit({busy,children}:{busy:boolean;children:ReactNode}){return <button className={button} type="submit" disabled={busy}>{busy?"Guardando…":children}</button>}
function printApplication(fields:Record<string,string>,customer:Customer,sale:Sale){
 const popup=window.open("","_blank");
 if(!popup){toast.error("Permití las ventanas emergentes para imprimir");return}
 const doc=popup.document;
 const style=doc.createElement("style");
 style.textContent="body{font:12px Arial,sans-serif;color:#171717;max-width:850px;margin:25px auto;padding:0 15px}header{display:flex;align-items:baseline;gap:18px;border:2px solid #222;padding:20px;margin-bottom:18px}header strong{font-size:28px;letter-spacing:2px}header span{font-size:14px}h1{text-align:center;font-size:16px}h2{font-size:13px;text-align:center;text-decoration:underline;margin:22px 0 12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:11px 20px}.item{min-height:24px;border-bottom:1px dotted #999}.item b{font-size:11px;margin-right:6px}.wide{grid-column:span 2}.signatures{display:flex;justify-content:space-between;gap:30px;margin-top:65px}.signatures div{flex:1;border-top:1px solid #222;padding-top:10px;text-align:center}@media print{body{margin:0;max-width:none}}";
 doc.head.appendChild(style);
 doc.title="Solicitud de adhesión - Valle Automotores";
 const head=doc.createElement("header");const title=doc.createElement("strong");title.textContent="VALLE";const subtitle=doc.createElement("span");subtitle.textContent="AUTOMOTORES · SOLICITUD DE ADHESIÓN";head.append(title,subtitle);doc.body.appendChild(head);
 const h1=doc.createElement("h1");h1.textContent="SOLICITUD DE ADHESIÓN";doc.body.appendChild(h1);
 const mapping:Record<string,string>={...fields,full_name:fields.full_name||customer.full_name,dni:fields.dni||customer.document_number||"",phone:fields.phone||customer.phone,brand:fields.brand||sale.vehicle_description};
 for(const group of sections){
  const h=doc.createElement("h2");h.textContent=group.title.toUpperCase();doc.body.appendChild(h);
  const grid=doc.createElement("div");grid.className="grid";
  for(const f of group.fields){const item=doc.createElement("div");item.className="item"+(f.wide?" wide":"");const b=doc.createElement("b");b.textContent=f.label+": ";item.appendChild(b);item.appendChild(doc.createTextNode(mapping[f.key]||"________________"));grid.appendChild(item)}
  doc.body.appendChild(grid);
 }
 const numbers=doc.createElement("p");numbers.style.marginTop="24px";numbers.textContent="Cuota elegida: "+money(sale.installment_amount)+" · Gastos administrativos: "+money(sale.admin_fee)+" · Primera cuota total: "+money(sale.installment_amount+sale.admin_fee)+" · Ingreso: "+fmtDate(sale.entry_date)+" · Cuota 2: "+fmtDate(sale.second_due_date);doc.body.appendChild(numbers);
 const signature=doc.createElement("div");signature.className="signatures";for(const name of ["Firma del titular","Nombre y firma del vendedor"]){const d=doc.createElement("div");d.textContent=name;signature.appendChild(d)}doc.body.appendChild(signature);popup.focus();popup.print();
}
export function SalesCenter(){
 const {user,accountId,profileLoading}=useAuth();
 const [role,setRole]=useState<Role|null>(null);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [data,setData]=useState<DB>(empty);
 const [customerId,setCustomerId]=useState("");
 const [saleId,setSaleId]=useState("");
 const [section,setSection]=useState<Section>("resumen");
 const [search,setSearch]=useState("");
 const [creatingCustomer,setCreatingCustomer]=useState(false);
 const [newSale,setNewSale]=useState(false);
 const [newSaleCustomerId,setNewSaleCustomerId]=useState<string|null>(null);
 const [editingSale,setEditingSale]=useState(false);
 const [dniFile,setDniFile]=useState<File|null>(null);
 const [entryDate,setEntryDate]=useState(localDate());
 const [secondDue,setSecondDue]=useState(addMonth(localDate()));
 const [paymentInstallment,setPaymentInstallment]=useState("");
 const [paymentFile,setPaymentFile]=useState<File|null>(null);
 const [contractFile,setContractFile]=useState<File|null>(null);
 const [proofFile,setProofFile]=useState<File|null>(null);
 const [proofPayment,setProofPayment]=useState("");
 const admin=role==="propietario"||role==="administracion";
 const load=useCallback(async(account:string)=>{
  const db=createClient();
  const [customers,sales,installments,payments,documents,followups,applications,people]=await Promise.all([
   rows<Customer>("erp_customers",account),rows<Sale>("erp_sales",account),rows<Installment>("erp_installments",account),
   rows<Payment>("erp_payments",account),rows<Document>("erp_documents",account),rows<Followup>("erp_followups",account),
   rows<Application>("erp_sale_applications",account),
   db.from("profiles").select("user_id,full_name,email").eq("account_id",account).then(r=>{if(r.error)throw r.error;return (r.data??[]) as Person[]})
  ]);
  setData({customers,sales,installments,payments,documents,followups,applications,people});
  return {customers,sales};
 },[]);
 useEffect(()=>{
  if(!user||!accountId||profileLoading)return;
  let active=true;
  void (async()=>{try{
   const {data:r,error}=await createClient().from("erp_memberships").select("erp_role").eq("account_id",accountId).eq("user_id",user.id).maybeSingle();
   if(error)throw error;
   if(active){setRole((r?.erp_role as Role)||null);if(r?.erp_role)await load(accountId)}
  }catch(e){if(active)toast.error(errorText(e))}finally{if(active)setReady(true)}})();
  return()=>{active=false};
 },[user,accountId,profileLoading,load]);
 const filtered=useMemo(()=>data.customers.filter(c=>(c.full_name+" "+c.phone+" "+(c.document_number||"")+" "+(c.city||"")).toLocaleLowerCase("es-AR").includes(search.toLocaleLowerCase("es-AR"))).sort((a,b)=>b.created_at.localeCompare(a.created_at)),[data.customers,search]);
 const customer=data.customers.find(c=>c.id===(customerId||data.customers[0]?.id))||null;
 const clientSales=data.sales.filter(s=>s.customer_id===customer?.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const sale=clientSales.find(s=>s.id===saleId)||clientSales[0]||null;
 const installments=data.installments.filter(i=>i.sale_id===sale?.id).sort((a,b)=>a.installment_number-b.installment_number);
 const payments=data.payments.filter(p=>p.sale_id===sale?.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const documents=data.documents.filter(x=>x.sale_id===sale?.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const followups=data.followups.filter(x=>x.sale_id===sale?.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const application=data.applications.find(x=>x.sale_id===sale?.id)?.data||{};
 useEffect(()=>{setContractFile(null);setPaymentFile(null);setProofFile(null);setDniFile(null);setPaymentInstallment("");setProofPayment("");},[sale?.id]);
 const person=(id:string)=>data.people.find(x=>x.user_id===id)?.full_name||"Asesor";
 const paid=(id:string)=>payments.filter(p=>p.installment_id===id&&p.status==="confirmado").reduce((a,p)=>a+Number(p.amount),0);
 const documentsFor=(kind:string)=>documents.filter(x=>x.kind===kind);
 const refresh=async()=>{if(!accountId)return;await load(accountId)};
 async function transact(fn:()=>Promise<void>,success:string){
  if(busy||!accountId||!user)return;
  setBusy(true);
  try{await fn();toast.success(success);await refresh()}catch(e){toast.error(errorText(e))}finally{setBusy(false)}
 }
 async function createCustomer(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget;const f=new FormData(form);
  await transact(async()=>{
   const {data:r,error}=await createClient().from("erp_customers").insert({
    account_id:accountId,created_by:user!.id,agent_id:admin?(val(f.get("agent_id"))||user!.id):user!.id,
    full_name:val(f.get("full_name")),phone:val(f.get("phone")),document_number:val(f.get("document_number"))||null,
    email:val(f.get("email"))||null,city:val(f.get("city"))||null,province:"Río Negro"
   }).select("id").single();
   if(error)throw error;setCustomerId(r.id);setSaleId("");setCreatingCustomer(false);setNewSale(true);form.reset();
  },"Cliente incorporado a la cartera");
 }
 async function upload(file:File,kind:string,paymentId:string|null=null){
  if(!sale)throw new Error("Primero seleccioná una operación");
  const body=new FormData();
  body.set("sale_id",sale.id);body.set("kind",kind);body.set("file",file);
  if(paymentId)body.set("payment_id",paymentId);
  const response=await fetch("/api/erp/files",{method:"POST",body});
  const result=await response.json().catch(()=>({error:"No se pudo leer la respuesta del servidor"}));
  if(!response.ok||!result.ok)throw new Error(result.error||"No se pudo subir el archivo");
 }
 async function addDni(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!dniFile)return toast.error("Seleccioná una imagen o PDF del DNI");
  const form=e.currentTarget;
  await transact(async()=>{await upload(dniFile,"dni");setDniFile(null);form.reset()},"DNI adjuntado al legajo");
 }
 async function addContract(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!contractFile)return toast.error("Seleccioná un contrato firmado");
  await transact(async()=>{await upload(contractFile,"contrato");setContractFile(null);(e.target as HTMLFormElement).reset()},"Contrato firmado archivado de forma privada");
 }
 async function addPayment(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!sale||!installments.length)return;const f=new FormData(e.currentTarget);
  const id=paymentInstallment||val(f.get("installment_id"));
  const installment=installments.find(x=>x.id===id);
  if(!installment)return toast.error("Seleccioná una cuota");
  await transact(async()=>{
   const {data:r,error}=await createClient().from("erp_payments").insert({
    account_id:accountId,sale_id:sale.id,installment_id:installment.id,amount:num(f.get("amount")),paid_at:val(f.get("paid_at"))||localDate(),
    method:val(f.get("method")),reference:val(f.get("reference"))||null,status:"pendiente",created_by:user!.id
   }).select("id").single();
   if(error)throw error;
   if(paymentFile){try{await upload(paymentFile,"comprobante",r.id)}catch(e){throw new Error("Se guardó el pago pero falló el archivo: "+errorText(e))}}
   setPaymentFile(null);setPaymentInstallment("");(e.target as HTMLFormElement).reset();
  },"Pago registrado; queda pendiente de validación por administración");
 }
 async function attachReceipt(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const f=e.currentTarget;
  const target=payments.find(p=>p.id===(proofPayment||payments[0]?.id));
  if(!target||!proofFile)return toast.error("Elegí un pago y su comprobante");
  await transact(async()=>{await upload(proofFile,"comprobante",target.id);setProofFile(null);setProofPayment("");f.reset()},"Comprobante agregado al historial del pago");
 }
 async function appendInstallment(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!sale)return;const form=e.currentTarget;const f=new FormData(form);
  await transact(async()=>{
   const {error}=await createClient().rpc("erp_append_installment",{p_sale:sale.id,p_due_date:val(f.get("due_date")),p_amount:num(f.get("amount"))});
   if(error)throw error;form.reset();
  },"Siguiente cuota agregada sin límite de cuatro");
 }
 async function addFollowup(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!sale)return;const form=e.currentTarget;const f=new FormData(form);
  await transact(async()=>{
   const {error}=await createClient().from("erp_followups").insert({account_id:accountId,sale_id:sale.id,created_by:user!.id,
    outcome:val(f.get("outcome")),notes:val(f.get("notes")),next_contact_at:val(f.get("next_contact_at"))?new Date(val(f.get("next_contact_at"))).toISOString():null});
   if(error)throw error;form.reset();
  },"Seguimiento registrado");
 }
 async function openDocument(doc:Document){
  const popup=window.open("","_blank");
  try{const {data:r,error}=await createClient().storage.from("erp-comprobantes").createSignedUrl(doc.object_path,120);
   if(error||!r?.signedUrl)throw error||new Error("No se pudo abrir");
   if(popup)popup.location.href=r.signedUrl;else window.location.href=r.signedUrl;
  }catch(e){popup?.close();toast.error(errorText(e))}
 }
 if(!ready)return <div className="p-6 text-sm text-muted-foreground">Preparando la cartera de ventas…</div>;
 if(!role||role==="consulta")return <Panel title="Ventas">Tu usuario no tiene permisos para el sistema de ventas.</Panel>;
 const sectionItems:{id:Section;name:string;icon:ReactNode}[]=[
  {id:"resumen",name:"Resumen",icon:<ClipboardList size={16}/>},{id:"solicitud",name:"Solicitud de adhesión",icon:<FileText size={16}/>},
  {id:"contrato",name:"Contrato firmado",icon:<FileSignature size={16}/>},{id:"pagos",name:"Cuotas y comprobantes",icon:<CreditCard size={16}/>},
  {id:"seguimiento",name:"Seguimiento",icon:<CalendarClock size={16}/>}
 ];
 return <div className="mx-auto w-full max-w-[1500px] space-y-4 pb-12">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div><p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-primary">Valle Automotores · Comercial</p>
    <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Ventas y cartera de clientes</h1>
    <p className="mt-1 text-xs text-muted-foreground">Todo el legajo de cada cliente, sus contratos, cuotas y seguimiento en un solo lugar.</p>
   </div>
   <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>{setNewSaleCustomerId(null);setNewSale(true);setEditingSale(false)}}><Plus size={16}/> Registrar venta</button><button className={ghost} onClick={()=>void refresh().catch(e=>toast.error(errorText(e)))}><RefreshCw size={14}/> Actualizar</button>
    {admin&&<Link href="/erp/administracion" className={ghost}>Administración</Link>}</div>
  </header>
  {(newSale||editingSale)&&accountId&&user?
   <CompleteSaleEditor key={editingSale?"edit-"+sale?.id:"new-"+(newSaleCustomerId||"none")}
    accountId={accountId} userId={user.id} admin={admin} customers={data.customers}
    selectedCustomer={editingSale?customer:(data.customers.find(c=>c.id===newSaleCustomerId)||null)} sale={editingSale?sale:null} application={editingSale?application:{}}
    people={data.people} onCancel={()=>{setNewSale(false);setEditingSale(false)}}
    onSaved={async(id)=>{const updated=await load(accountId);const added=updated.sales.find(x=>x.id===id);
     if(added){setCustomerId(added.customer_id);setSaleId(added.id)}
     setNewSale(false);setEditingSale(false);setSection("contrato");}}
   />:
  <div className="grid min-w-0 gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
   <aside className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-sm lg:sticky lg:top-3 lg:h-[calc(100vh-7rem)]">
    <div className="mb-3 flex items-center justify-between gap-2 px-1">
     <div><p className="text-sm font-extrabold">Clientes</p><p className="text-[11px] text-muted-foreground">{data.customers.length} en la cartera</p></div>
     <button className={ghost} title="Registrar venta" onClick={()=>{setNewSaleCustomerId(null);setNewSale(true);setEditingSale(false)}}><Plus size={15}/> Venta</button>
    </div>
    <div className="relative mb-3"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><input className={input+" pl-9"} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar nombre, DNI, teléfono…" aria-label="Buscar clientes"/></div>
    {creatingCustomer&&<form className="mb-3 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3" onSubmit={createCustomer}>
     <p className="text-sm font-bold">Nuevo cliente</p>
     <input className={input} name="full_name" minLength={2} placeholder="Nombre y apellido *" required/>
     <input className={input} name="phone" placeholder="Teléfono *" inputMode="tel" required/>
     <input className={input} name="document_number" placeholder="DNI / CUIT"/>
     <input className={input} name="email" type="email" placeholder="Correo electrónico"/>
     <input className={input} name="city" placeholder="Localidad"/>
     {admin&&<label className={label}>Asesor<select className={input} name="agent_id" defaultValue={user?.id}>{data.people.map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.email}</option>)}</select></label>}
     <Submit busy={busy}>Guardar cliente</Submit>
    </form>}
    <div className="crm-scrollbar max-h-[45vh] space-y-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-18rem)]">
     {filtered.map(c=>{const count=data.sales.filter(s=>s.customer_id===c.id).length;const active=customer?.id===c.id;
      return <button key={c.id} className={"w-full rounded-xl border px-3 py-3 text-left transition-colors "+(active?"border-primary/50 bg-primary/10":"border-transparent bg-muted/25 hover:border-border hover:bg-muted/60")} onClick={()=>{setCustomerId(c.id);setSaleId("");setSection("resumen");setNewSale(false);setEditingSale(false)}}>
       <div className="flex items-center gap-2"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound size={17}/></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{c.full_name}</p><p className="truncate text-[11px] text-muted-foreground">{c.phone}{c.city?" · "+c.city:""}</p></div>
        {count>0&&<span className="rounded-md bg-background px-1.5 py-1 text-[10px] font-bold">{count}</span>}
       </div>
      </button>})}
     {!filtered.length&&<p className="p-3 text-center text-xs text-muted-foreground">No hay clientes. Cargá el primero desde «Nuevo».</p>}
    </div>
   </aside>
   <main className="min-w-0 space-y-4">
    {!customer?<Panel title="Comenzá con un cliente" icon={<UserRound size={18} className="text-primary"/>}>Cargá un cliente para crear su solicitud, contrato y plan de pagos.</Panel>:<>
     <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
       <p className="text-xs font-bold uppercase tracking-wider text-primary">Legajo comercial</p><h2 className="mt-1 text-xl font-black">{customer.full_name}</h2>
       <p className="mt-1 text-xs text-muted-foreground">{customer.phone} · {customer.document_number||"DNI sin cargar"} · Asesor: {person(customer.agent_id)}</p>
      </div><button className={ghost} onClick={()=>{setNewSaleCustomerId(customer.id);setNewSale(true);setEditingSale(false);setSection("resumen")}}><Plus size={14}/> Nueva operación</button></div>
      {clientSales.length>0&&<div className="mt-3 flex flex-wrap gap-2">{clientSales.map(s=><button key={s.id} onClick={()=>{setSaleId(s.id);setSection("resumen");setNewSale(false)}} className={"rounded-lg border px-3 py-2 text-xs font-semibold "+(sale?.id===s.id?"border-primary bg-primary/10 text-primary":"border-border hover:bg-muted")}>{s.vehicle_description}</button>)}</div>}
     </div>
     {!sale&&<Panel title="Sin ventas registradas">Seleccioná «Registrar venta» para completar la solicitud de adhesión y crear la operación de una sola vez.</Panel>}
     {sale&&!newSale&&<>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
       {[["Cuota elegida",money(sale.installment_amount)],["Gastos administrativos",money(sale.admin_fee)],["Cuota 1 total",money(Number(sale.installment_amount)+Number(sale.admin_fee))],["Próximo vencimiento",fmtDate(installments.find(i=>paid(i.id)<Number(i.amount))?.due_date||null)]].map(([k,v])=><div key={k} className="rounded-xl border border-border bg-card p-3"><p className="text-[11px] text-muted-foreground">{k}</p><p className="mt-1 break-words text-sm font-black">{v}</p></div>)}
      </div>
      <nav aria-label="Secciones del legajo" className="crm-scrollbar flex gap-2 overflow-x-auto rounded-2xl border border-border bg-card p-2">
       {sectionItems.map(x=><button type="button" key={x.id} onClick={()=>setSection(x.id)} className={"flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-colors "+(section===x.id?"bg-primary text-primary-foreground":"text-muted-foreground hover:bg-muted hover:text-foreground")}>{x.icon}{x.name}</button>)}
      </nav>
      {section==="resumen"&&<div className="grid gap-4 md:grid-cols-2">
       <Panel title="Datos de la operación" icon={<ClipboardList size={17} className="text-primary"/>}>
        <dl className="grid grid-cols-2 gap-4 text-sm">{[
         ["Vehículo",sale.vehicle_description],["Modalidad",sale.operation_type],["Fecha de ingreso",fmtDate(sale.entry_date||sale.first_due)],["Cuota 2",fmtDate(sale.second_due_date||installments[1]?.due_date||null)],
         ["Cuotas registradas",String(installments.length)],["Entrega de referencia","Desde cuota "+sale.delivery_target_installment+" (sujeta a condiciones)"]
        ].map(([k,v])=><div key={k}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl>
        {admin&&<button className={ghost+" mt-4"} type="button" onClick={()=>{setEditingSale(true);setNewSale(false)}}>Modificar venta y solicitud</button>}
        {sale.crm_conversation_id&&<Link className="mt-3 inline-block text-xs font-bold text-primary" href={"/inbox?conversation="+encodeURIComponent(sale.crm_conversation_id)}>Abrir chat del CRM</Link>}
       </Panel>
       <Panel title="Accesos rápidos" icon={<FolderOpen size={17} className="text-primary"/>}>
        <div className="grid gap-2">{sectionItems.slice(1).map(x=><button key={x.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-left text-sm font-bold hover:bg-muted" onClick={()=>setSection(x.id)}><span className="flex items-center gap-2">{x.icon}{x.name}</span><span className="text-primary">Abrir</span></button>)}</div>
       </Panel>
      </div>}
      {section==="solicitud"&&<Panel title="Solicitud de adhesión" icon={<FileText size={17} className="text-primary"/>} aside={<button className={ghost} type="button" onClick={()=>printApplication(application,customer,sale)}>Imprimir solicitud</button>}>
       <p className="mb-4 text-xs text-muted-foreground">La solicitud se guarda junto con la venta. Los datos se muestran para consulta y para emitir el contrato. Administración puede modificar las condiciones antes de registrar la firma.</p>
       {Object.keys(application).length?sections.map(group=><div key={group.title} className="mb-5">
        <h3 className="mb-3 border-b border-border pb-2 text-sm font-extrabold">{group.title}</h3>
        <dl className="grid gap-3 sm:grid-cols-2">{group.fields.map(f=><div key={f.key} className={f.wide?"sm:col-span-2":""}>
         <dt className="text-xs font-semibold text-muted-foreground">{f.label}</dt><dd className="mt-1 break-words text-sm font-medium">{application[f.key]||"—"}</dd>
        </div>)}</dl>
       </div>):<p className="text-xs text-muted-foreground">Este legajo es anterior al nuevo formulario. Completá la solicitud antes de enviar un contrato.</p>}
       <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs"><b>Cuota 1:</b> {money(Number(sale.installment_amount)+Number(sale.admin_fee))} · <b>Cuota 2:</b> {fmtDate(sale.second_due_date||installments[1]?.due_date||null)}</div>
       {admin&&<button type="button" className={ghost+" mt-3"} onClick={()=>setEditingSale(true)}>Modificar solicitud y condiciones</button>}
      </Panel>}
      {section==="contrato"&&<div className="space-y-4">
       <ContractManager key={sale.id} saleId={sale.id} accountId={accountId!} userId={user!.id} admin={admin}/>
       <div className="grid gap-4 md:grid-cols-2">
       <Panel title="Contrato firmado" icon={<FileSignature size={18} className="text-primary"/>}>
        <p className="mb-3 text-xs text-muted-foreground">Adjuntá una copia firmada en PDF o imagen. Los archivos quedan privados en el legajo de esta venta.</p>
        <form onSubmit={addContract} className="space-y-3"><label className={label}>Seleccionar contrato firmado<input key={sale.id+"-contract"} className={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required onChange={e=>setContractFile(e.target.files?.[0]||null)}/></label><Submit busy={busy}>Subir contrato</Submit></form>
       </Panel>
       <Panel title="Contratos archivados" icon={<FolderOpen size={18} className="text-primary"/>}>
        {documentsFor("contrato").map(x=><button key={x.id} onClick={()=>void openDocument(x)} className="mb-2 flex w-full items-center gap-2 rounded-xl border border-border p-3 text-left text-xs hover:bg-muted"><FileText size={17}/><span className="min-w-0 flex-1 truncate">{x.file_name}</span><span className="text-primary">Ver</span></button>)}
        {!documentsFor("contrato").length&&<p className="text-xs text-muted-foreground">Todavía no se adjuntó un contrato firmado.</p>}
       </Panel>
      </div>
       <Panel title="DNI del cliente y documentación adjunta" icon={<FolderOpen size={18} className="text-primary"/>}>
        <p className="mb-3 text-xs text-muted-foreground">El asesor puede adjuntar frente y dorso del DNI como imágenes o PDF. Los archivos se almacenan de manera privada.</p>
        <form onSubmit={addDni} className="flex flex-wrap items-end gap-3"><label className={label+" flex-1"}>Imagen o PDF del DNI<input className={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required onChange={e=>setDniFile(e.target.files?.[0]||null)}/></label><Submit busy={busy}>Adjuntar DNI</Submit></form>
        <div className="mt-3 flex flex-wrap gap-2">{documentsFor("dni").map(d=><button type="button" className={ghost} key={d.id} onClick={()=>void openDocument(d)}><FileText size={15}/>{d.file_name}</button>)}</div>
       </Panel>
      </div>}
      {section==="pagos"&&<div className="space-y-4">
       <Panel title="Cuotas del cliente" icon={<Wallet size={18} className="text-primary"/>}>
        <div className="crm-scrollbar max-h-[420px] space-y-2 overflow-y-auto pr-1">{installments.map(i=>{
         const confirmed=paid(i.id),pending=payments.filter(p=>p.installment_id===i.id&&p.status==="pendiente").reduce((a,p)=>a+Number(p.amount),0);
         const status=confirmed>=i.amount?"Pagada":confirmed>0?"Parcial":i.due_date<localDate()?"Vencida":"Pendiente";
         return <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs">
          <div><p className="font-extrabold">Cuota {i.installment_number} {i.installment_number===1?"· incluye gastos administrativos":""} · {money(i.amount)}</p>
           {i.installment_number===1&&<p className="mt-0.5 text-muted-foreground">Cuota {money(sale.installment_amount)} + gastos {money(sale.admin_fee)}</p>}
           <p className="mt-0.5 text-muted-foreground">Vence {fmtDate(i.due_date)} · {status} · Validado {money(confirmed)}{pending>0?" · A validar "+money(pending):""}</p>
          </div><button className={ghost} onClick={()=>setPaymentInstallment(i.id)}>Registrar pago</button>
         </div>})}</div>
       </Panel>
       <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Registrar pago y comprobante" icon={<CreditCard size={17} className="text-primary"/>}>
         <p className="mb-3 text-xs text-muted-foreground">Cada comprobante se asocia a una cuota. Administración confirma o rechaza el pago.</p>
         <form onSubmit={addPayment} className="space-y-3">
          <label className={label}>Cuota<select className={input} name="installment_id" value={paymentInstallment||installments[0]?.id||""} onChange={e=>setPaymentInstallment(e.target.value)} required>{installments.map(i=><option key={i.id} value={i.id}>Cuota {i.installment_number} · {money(i.amount)}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className={label}>Importe pagado ($)<input className={input} name="amount" type="number" min="0.01" step="0.01" required/></label><label className={label}>Fecha de pago<input className={input} name="paid_at" type="date" defaultValue={localDate()}/></label></div>
          <div className="grid grid-cols-2 gap-3"><label className={label}>Medio<select className={input} name="method"><option value="transferencia">Transferencia</option><option value="deposito">Depósito</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select></label><label className={label}>Referencia<input className={input} name="reference" placeholder="N.º operación"/></label></div>
          <label className={label}>Comprobante del cliente<input key={sale.id+"-proof"} className={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e=>setPaymentFile(e.target.files?.[0]||null)}/></label>
          <Submit busy={busy}>Guardar pago y comprobante</Submit>
         </form>
        </Panel>
        <Panel title="Continuar el plan de cuotas" icon={<Plus size={17} className="text-primary"/>}>
         <p className="mb-3 text-xs text-muted-foreground">La cuarta cuota no detiene el plan. Podés agregar tantas cuotas posteriores como requiera la operación.</p>
         <form key={sale.id+"-"+installments.length} className="space-y-3" onSubmit={appendInstallment}>
          <div className="rounded-xl bg-muted/40 p-3 text-sm font-bold">Próxima cuota: {installments.length?Math.max(...installments.map(i=>i.installment_number))+1:1}</div>
          <label className={label}>Fecha de vencimiento<input className={input} type="date" name="due_date" required defaultValue={addMonth(installments.at(-1)?.due_date||sale.second_due_date||localDate())}/></label>
          <label className={label}>Importe de la cuota ($)<input className={input} type="number" min="0.01" step="0.01" name="amount" required defaultValue={sale.installment_amount}/></label>
          <Submit busy={busy}>Agregar siguiente cuota</Submit>
         </form>
        </Panel>
       </div>
       <Panel title="Historial de pagos y comprobantes" icon={<FolderOpen size={18} className="text-primary"/>}>
        <div className="space-y-2">{payments.map(p=>{const number=installments.find(i=>i.id===p.installment_id)?.installment_number;const proofs=documents.filter(d=>d.payment_id===p.id);
         return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-xs">
          <div><p className="font-bold">Cuota {number||"—"} · {money(p.amount)} · {p.status}</p><p className="mt-1 text-muted-foreground">{fmtDate(p.paid_at)} · {p.method}{p.reference?" · Ref. "+p.reference:""}</p></div>
          <div className="flex flex-wrap gap-2">{proofs.map(d=><button key={d.id} className={ghost} onClick={()=>void openDocument(d)}><FileText size={14}/> {d.file_name}</button>)}{!proofs.length&&<span className="text-muted-foreground">Sin comprobante</span>}</div>
         </div>})}{!payments.length&&<p className="text-xs text-muted-foreground">Todavía no hay pagos informados.</p>}</div>
       </Panel>
       <Panel title="Adjuntar comprobante a un pago ya cargado" icon={<Plus size={17} className="text-primary"/>}>
        <p className="mb-3 text-xs text-muted-foreground">Podés agregar un comprobante recibido después de registrar el pago, sin duplicar el movimiento.</p>
        <form onSubmit={attachReceipt} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
         <label className={label}>Pago registrado<select className={input} value={proofPayment||payments[0]?.id||""} onChange={e=>setProofPayment(e.target.value)} required>{payments.map(p=><option key={p.id} value={p.id}>Cuota {installments.find(i=>i.id===p.installment_id)?.installment_number||"—"} · {money(p.amount)} · {fmtDate(p.paid_at)}</option>)}</select></label>
         <label className={label}>Archivo<input className={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e=>setProofFile(e.target.files?.[0]||null)} required/></label>
         <Submit busy={busy}>Adjuntar</Submit>
        </form>
       </Panel>
      </div>}
      {section==="seguimiento"&&<div className="grid gap-4 md:grid-cols-2">
       <Panel title="Nueva gestión" icon={<CalendarClock size={18} className="text-primary"/>}>
        <form onSubmit={addFollowup} className="space-y-3">
         <label className={label}>Resultado<select className={input} name="outcome">{["contactado","sin_respuesta","interesado","documentacion","cobranza","nota","otro"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>
         <label className={label}>Detalle de la gestión<textarea className={input} name="notes" rows={4} required/></label>
         <label className={label}>Próximo contacto<input className={input} type="datetime-local" name="next_contact_at"/></label>
         <Submit busy={busy}>Guardar seguimiento</Submit>
        </form>
       </Panel>
       <Panel title="Historial de gestiones" icon={<CheckCircle2 size={18} className="text-primary"/>}>
        <div className="crm-scrollbar max-h-[400px] space-y-2 overflow-y-auto">{followups.map(x=><div key={x.id} className="rounded-xl border border-border p-3 text-xs"><p className="font-extrabold">{x.outcome.replaceAll("_"," ")} · {new Date(x.created_at).toLocaleString("es-AR")}</p><p className="mt-1 whitespace-pre-wrap text-foreground">{x.notes}</p>{x.next_contact_at&&<p className="mt-2 text-primary">Recordatorio: {new Date(x.next_contact_at).toLocaleString("es-AR")}</p>}</div>)}{!followups.length&&<p className="text-xs text-muted-foreground">Sin seguimientos cargados.</p>}</div>
       </Panel>
      </div>}
     </>}
    </>}
   </main>
  </div>}
 </div>;
}
