"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

type Role = "propietario" | "administracion" | "vendedor" | "consulta";
type Customer = { id: string; agent_id: string; full_name: string; document_number: string | null; phone: string; email: string | null; address: string | null; city: string | null; province: string | null; notes: string | null; crm_contact_id: string | null; created_at: string };
type Sale = { id: string; account_id: string; customer_id: string; agent_id: string; vehicle_description: string; vehicle_type: string; operation_type: string; price: number; initial_amount: number; admin_fee: number; installment_amount: number; installment_count: number; delivery_target_installment: number; stage: string; credit_status: string; crm_conversation_id: string | null; whatsapp_chat_id: string | null; notes: string | null; created_at: string };
type Installment = { id: string; sale_id: string; installment_number: number; due_date: string; amount: number };
type Payment = { id: string; sale_id: string; installment_id: string; amount: number; status: string; method: string; paid_at: string; reference: string | null; created_at: string };
type Document = { id: string; sale_id: string; payment_id: string | null; kind: string; file_name: string; object_path: string; created_at: string };
type Followup = { id: string; sale_id: string; outcome: string; notes: string; next_contact_at: string | null; created_at: string };
type Expense = { id: string; category: string; description: string; amount: number; expense_date: string; method: string; paid: boolean };
type Vehicle = { id: string; brand: string; model: string; version: string | null; model_year: number | null; cost: number; listed_price: number; status: string; plate: string | null };
type Delivery = { id: string; sale_id: string; status: string; planned_at: string | null; delivered_at: string | null; notes: string | null };
type Member = { user_id: string; erp_role: Role };
type Person = { user_id: string; full_name: string | null; email: string; account_role: string };
type Audit = { id: number; entity: string; action: string; actor_id: string | null; created_at: string };
type CrmContact = { id: string; name: string; phone: string };
type CrmConversation = { id: string; contact_id: string; assigned_agent_id: string | null };
type Collections = { customers: Customer[]; sales: Sale[]; installments: Installment[]; payments: Payment[]; documents: Document[]; followups: Followup[]; expenses: Expense[]; inventory: Vehicle[]; deliveries: Delivery[]; members: Member[]; people: Person[]; contacts: CrmContact[]; conversations: CrmConversation[]; audit: Audit[] };
const empty: Collections = { customers: [], sales: [], installments: [], payments: [], documents: [], followups: [], expenses: [], inventory: [], deliveries: [], members: [], people: [], contacts: [], conversations: [], audit: [] };
const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(n || 0));
const number = (n: FormDataEntryValue | null) => Number(String(n || "0").replace(",", ".")) || 0;
const d = (n: FormDataEntryValue | null) => String(n ?? "").trim();
const today = () => { const n=new Date(); return new Date(n.getTime()-n.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const input = "min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
const label = "block space-y-1 text-xs font-semibold text-muted-foreground";
const primary = "min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
const secondary = "min-h-9 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50";
const box = "rounded-xl border border-border bg-card p-3 sm:p-4";
const stageOptions = ["nuevo","contactado","interesado","documentacion","pactado","activo","no_interesado","caido"];
const paymentMethods = ["transferencia","efectivo","tarjeta","deposito","otro"];

function Block({title,children}: { title:string; children: ReactNode }) {
 return <section className={box}><h2 className="mb-3 text-base font-bold text-foreground">{title}</h2>{children}</section>;
}
function FormAction({busy,children}: {busy:boolean;children:ReactNode}) {
 return <button disabled={busy} className={primary} type="submit">{busy ? "Guardando…" : children}</button>;
}
async function fetchRows<T>(table:string, accountId:string, limit=2000): Promise<T[]> {
 const {data,error} = await createClient().from(table).select("*").eq("account_id",accountId).limit(limit);
 if(error) throw new Error(table+": "+error.message);
 return (data || []) as T[];
}
export function ErpWorkspace({administration=false}: {administration?:boolean}) {
 const {user,accountId,profileLoading} = useAuth();
 const [role,setRole] = useState<Role | null>(null);
 const [loaded,setLoaded] = useState(false);
 const [busy,setBusy] = useState(false);
 const [data,setData] = useState<Collections>(empty);
 const [selectedId,setSelectedId] = useState("");
 const [tab,setTab] = useState(administration?"resumen":"operaciones");
 const [search,setSearch] = useState("");
 const [editingCustomer,setEditingCustomer] = useState<Customer | null>(null);
 const [reportMonth,setReportMonth] = useState(today().slice(0,7));
 const [paymentInstallment,setPaymentInstallment] = useState<string | null>(null);
 const admin = role==="propietario" || role==="administracion";
 const selected = data.sales.find(s=>s.id===selectedId) || data.sales[0] || null;
 useEffect(()=>setPaymentInstallment(null),[selected?.id]);
 const customerName = (id:string) => data.customers.find(c=>c.id===id)?.full_name || "Cliente";
 const agentName = (id:string) => data.people.find(p=>p.user_id===id)?.full_name || "Asesor";
 const errors = (e:unknown) => e instanceof Error ? e.message : String(e);

 const reload = useCallback(async (actualRole:Role, account:string) => {
   const authorized = ["propietario","administracion","vendedor"].includes(actualRole);
   if(!authorized) return;
   const db=createClient();
   const [customers,sales,installments,payments,documents,followups,inventory,expenses,deliveries,members,people,contacts,conversations,audit]=await Promise.all([
     fetchRows<Customer>("erp_customers",account),
     fetchRows<Sale>("erp_sales",account),
     fetchRows<Installment>("erp_installments",account),
     fetchRows<Payment>("erp_payments",account),
     fetchRows<Document>("erp_documents",account),
     fetchRows<Followup>("erp_followups",account),
     fetchRows<Vehicle>("erp_inventory",account),
     actualRole==="vendedor"?Promise.resolve([]):fetchRows<Expense>("erp_expenses",account),
     fetchRows<Delivery>("erp_deliveries",account),
     db.from("erp_memberships").select("user_id,erp_role").eq("account_id",account).then(r=>{if(r.error)throw r.error;return r.data as Member[]}),
     db.from("profiles").select("user_id,full_name,email,account_role").eq("account_id",account).then(r=>{if(r.error)throw r.error;return r.data as Person[]}),
     db.from("contacts").select("id,name,phone").eq("account_id",account).limit(500).then(r=>r.data as CrmContact[]||[]),
     db.from("conversations").select("id,contact_id,assigned_agent_id").eq("account_id",account).limit(500).then(r=>r.data as CrmConversation[]||[]),
     actualRole==="vendedor"?Promise.resolve([]):db.from("erp_audit_log").select("id,entity,action,actor_id,created_at").eq("account_id",account).order("created_at",{ascending:false}).limit(300).then(r=>{if(r.error)throw r.error;return r.data as Audit[]})
   ]);
   setData({customers,sales,installments,payments,documents,followups,inventory,expenses,deliveries,members,people,contacts,conversations,audit});
 },[]);
 useEffect(()=>{
   if(!user || !accountId || profileLoading) return;
   let alive=true;
   const start=async()=>{
     try {
       const {data:membership,error}=await createClient().from("erp_memberships").select("erp_role").eq("account_id",accountId).eq("user_id",user.id).maybeSingle();
       if(error) throw error;
       const actualRole=(membership?.erp_role || null) as Role|null;
       if(!alive)return;
       setRole(actualRole);
       if(actualRole) await reload(actualRole,accountId);
     } catch(e){if(alive)toast.error("ERP: "+errors(e))}
     finally {if(alive)setLoaded(true)}
   };
   void start(); return()=>{alive=false};
 },[user?.id,accountId,profileLoading,reload]);

 async function transact(work:()=>Promise<void>, success:string){
   if(busy||!role||!accountId)return;
   setBusy(true);
   try {await work(); toast.success(success)}
   catch(e){toast.error(errors(e))}
   finally{try{await reload(role,accountId)}catch(e){toast.error("Error al actualizar: "+errors(e))}setBusy(false)}
 }
 async function addCustomer(e:FormEvent<HTMLFormElement>){
   e.preventDefault(); const f=e.currentTarget; const v=new FormData(f);
   await transact(async()=>{
     const payload={
       agent_id:admin?d(v.get("agent_id")):user!.id,
       full_name:d(v.get("full_name")),document_number:d(v.get("document_number"))||null,
       phone:d(v.get("phone")),email:d(v.get("email"))||null,address:d(v.get("address"))||null,
       city:d(v.get("city"))||null,province:d(v.get("province"))||null,notes:d(v.get("notes"))||null,
       crm_contact_id:d(v.get("crm_contact_id"))||null,updated_at:new Date().toISOString()
     };
     const query=editingCustomer
       ? createClient().from("erp_customers").update(payload).eq("id",editingCustomer.id)
       : createClient().from("erp_customers").insert({...payload,account_id:accountId,created_by:user!.id});
     const {error}=await query;
     if(error)throw error;
     f.reset();setEditingCustomer(null);
   },"Ficha de cliente guardada");
 }
 async function addSale(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const f=e.currentTarget;const v=new FormData(f);
   await transact(async()=>{
     const values={
       agent_id:admin?d(v.get("agent_id")):user!.id,
       vehicle_description:d(v.get("vehicle_description")),vehicle_type:d(v.get("vehicle_type")),
       operation_type:d(v.get("operation_type")),price:number(v.get("price")),
       initial_amount:number(v.get("initial_amount")),admin_fee:number(v.get("admin_fee")),
       installment_amount:number(v.get("installment_amount")),
       installment_count:number(v.get("installment_count")),first_due:d(v.get("first_due"))||null,
       delivery_target_installment:number(v.get("delivery_target_installment"))||4,
       crm_conversation_id:d(v.get("crm_conversation_id"))||null,
       whatsapp_chat_id:d(v.get("whatsapp_chat_id"))||null,notes:d(v.get("notes"))
     };
     const {data:created,error}=await createClient().rpc("erp_create_sale",{p_account:accountId,p_customer:d(v.get("customer_id")),p_values:values});
     if(error)throw error;
     setSelectedId(String(created));
     setTab("operaciones"); f.reset();
   },"Venta y plan de cuotas creados");
 }
 async function followUp(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(!selected)return; const f=e.currentTarget;const v=new FormData(f);
   await transact(async()=>{
     const {error}=await createClient().from("erp_followups").insert({
       account_id:accountId,sale_id:selected.id,created_by:user!.id,
       outcome:d(v.get("outcome")),notes:d(v.get("notes")),
       next_contact_at:d(v.get("next_contact_at"))?new Date(d(v.get("next_contact_at"))).toISOString():null
     });
     if(error)throw error;f.reset();
   },"Seguimiento registrado");
 }
 async function stageChange(stage:string){
   if(!selected)return;
   await transact(async()=>{const {error}=await createClient().rpc("erp_change_stage",{p_sale:selected.id,p_stage:stage});if(error)throw error;},"Etapa actualizada");
 }
 async function upload(file:File,saleId:string,kind:string,paymentId:string|null=null){
   if(!accountId||!user)throw new Error("Sesión no disponible");
   if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type)||file.size>10485760||file.size<1)
     throw new Error("Usá JPG, PNG, WEBP o PDF de hasta 10 MB");
   const name=file.name.replace(/[^\w.\-]/g,"_").slice(-100);
   const path=accountId+"/"+saleId+"/"+crypto.randomUUID()+"-"+name;
   const db=createClient();
   const {error:uploadError}=await db.storage.from("erp-comprobantes").upload(path,file,{contentType:file.type,upsert:false});
   if(uploadError)throw uploadError;
   const {error}=await db.from("erp_documents").insert({
     account_id:accountId,sale_id:saleId,payment_id:paymentId,
     kind,object_path:path,file_name:file.name,mime_type:file.type,file_size:file.size,created_by:user.id
   });
   if(error)throw new Error("Archivo guardado, pero falló su registro: "+error.message);
 }
 async function addDocument(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(!selected)return;const f=e.currentTarget;const v=new FormData(f);
   const file=v.get("file");
   if(!(file instanceof File)||!file.size)return toast.error("Elegí un archivo");
   await transact(async()=>{await upload(file,selected.id,d(v.get("kind")));f.reset()},"Documento guardado de forma privada");
 }
 async function addPayment(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(!selected)return;const f=e.currentTarget;const v=new FormData(f);
   const installmentId=paymentInstallment || d(v.get("installment_id"));
   const installment=data.installments.find(i=>i.id===installmentId&&i.sale_id===selected.id);
   if(!installment)return toast.error("Seleccioná una cuota");
   await transact(async()=>{
     const db=createClient();
     const {data:created,error}=await db.from("erp_payments").insert({
       account_id:accountId,sale_id:selected.id,installment_id:installment.id,
       amount:number(v.get("amount")),paid_at:d(v.get("paid_at"))||today(),
       method:d(v.get("method")),reference:d(v.get("reference"))||null,
       created_by:user!.id,status:"pendiente"
     }).select("id").single();
     if(error)throw error;
     f.reset();setPaymentInstallment(null);
     const file=v.get("file");
     if(file instanceof File && file.size) {
       try {await upload(file,selected.id,"comprobante",created.id)}
       catch(e) {throw new Error("Pago registrado y pendiente de validación, pero el comprobante no se adjuntó: "+errors(e))}
     }
   },"Comprobante informado. Administración debe validar el pago");
 }
 async function openDocument(document:Document){
   const popup=window.open("","_blank");
   try {
     const {data:res,error}=await createClient().storage.from("erp-comprobantes").createSignedUrl(document.object_path,120);
     if(error||!res?.signedUrl)throw error||new Error("Sin acceso al archivo");
     if(popup)popup.location.href=res.signedUrl;
     else window.location.href=res.signedUrl;
   } catch(e){popup?.close();toast.error(errors(e))}
 }
 async function reviewPayment(payment:Payment,status:"confirmado"|"rechazado"|"revertido"){
   await transact(async()=>{
     const {error}=await createClient().from("erp_payments")
       .update({status,reviewed_by:user!.id,reviewed_at:new Date().toISOString()}).eq("id",payment.id);
     if(error)throw error;
   },status==="confirmado"?"Pago validado":status==="rechazado"?"Pago rechazado":"Pago revertido");
 }
 async function addExpense(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const f=e.currentTarget;const v=new FormData(f);
   await transact(async()=>{const {error}=await createClient().from("erp_expenses").insert({
     account_id:accountId,category:d(v.get("category")),description:d(v.get("description")),
     amount:number(v.get("amount")),expense_date:d(v.get("expense_date"))||today(),method:d(v.get("method")),
     paid:v.get("paid")==="on",created_by:user!.id
   });if(error)throw error;f.reset()},"Gasto registrado");
 }
 async function addVehicle(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const f=e.currentTarget;const v=new FormData(f);
   await transact(async()=>{const {error}=await createClient().from("erp_inventory").insert({
     account_id:accountId,brand:d(v.get("brand")),model:d(v.get("model")),version:d(v.get("version"))||null,
     model_year:number(v.get("model_year"))||null,plate:d(v.get("plate"))||null,
     cost:number(v.get("cost")),listed_price:number(v.get("listed_price")),
     status:d(v.get("status")),created_by:user!.id
   });if(error)throw error;f.reset()},"Vehículo agregado al inventario");
 }
 async function saveDelivery(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(!selected)return;const f=e.currentTarget;const v=new FormData(f);
   await transact(async()=>{
     const {error}=await createClient().rpc("erp_save_delivery",{
       p_sale:selected.id,p_credit:d(v.get("credit_status")),p_status:d(v.get("status")),
       p_planned:d(v.get("planned_at"))||null,p_delivered:d(v.get("delivered_at"))||null,
       p_notes:d(v.get("notes"))
     });
     if(error)throw error;
   },"Entrega y evaluación actualizadas");
 }
 async function setMember(person:string,chosen:Role){
   await transact(async()=>{
     const {error}=await createClient().from("erp_memberships").upsert({
       account_id:accountId,user_id:person,erp_role:chosen
     },{onConflict:"account_id,user_id"});
     if(error)throw error;
   },"Permiso ERP actualizado");
 }
 const validated=(installmentId:string)=>data.payments.filter(p=>p.installment_id===installmentId&&p.status==="confirmado").reduce((a,p)=>a+Number(p.amount),0);
 const pendingTotal=data.payments.filter(p=>p.status==="pendiente").reduce((a,p)=>a+Number(p.amount),0);
 const confirmedTotal=data.payments.filter(p=>p.status==="confirmado").reduce((a,p)=>a+Number(p.amount),0);
 const expenseTotal=data.expenses.reduce((a,p)=>a+Number(p.amount),0);
 const monthlyConfirmed=data.payments.filter(p=>p.status==="confirmado"&&p.paid_at.startsWith(reportMonth)).reduce((a,p)=>a+Number(p.amount),0);
 const monthlyExpenses=data.expenses.filter(p=>p.expense_date.startsWith(reportMonth)).reduce((a,p)=>a+Number(p.amount),0);
 const monthlySales=data.sales.filter(s=>s.created_at.startsWith(reportMonth)).length;
 const outstanding=data.installments.reduce((a,i)=>a+Math.max(0,Number(i.amount)-validated(i.id)),0);
 const overdue=data.installments.filter(i=>i.due_date<today()).reduce((a,i)=>a+Math.max(0,Number(i.amount)-validated(i.id)),0);
 const selectedInstallments=useMemo(()=>data.installments.filter(i=>i.sale_id===selected?.id).sort((a,b)=>a.installment_number-b.installment_number),[data.installments,selected?.id]);
 const selectedDocuments=data.documents.filter(x=>x.sale_id===selected?.id);
 const selectedFollowups=data.followups.filter(x=>x.sale_id===selected?.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const dueFollowups=data.followups.filter(x=>x.next_contact_at&&new Date(x.next_contact_at).getTime()<=Date.now()+86400000).sort((a,b)=>String(a.next_contact_at).localeCompare(String(b.next_contact_at))).slice(0,12);
 const filtered=data.sales.filter(s=>(customerName(s.customer_id)+" "+s.vehicle_description).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.created_at.localeCompare(a.created_at));

 function exportCsv(kind:"ventas"|"gastos") {
   if(!admin)return;
   const csvCell=(value:unknown)=>{
     let text=String(value??"");
     if(/^[=+@-]/.test(text)) text="'"+text;
     return '"'+text.replaceAll('"','""')+'"';
   };
   const rows: unknown[][] = kind==="ventas"
     ? [["Cliente","Asesor","Vehículo","Tipo","Etapa","Crédito","Valor ARS","Cuotas","Importe cuota ARS","Cobrado ARS"],
       ...data.sales.map(s=>[customerName(s.customer_id),agentName(s.agent_id),s.vehicle_description,s.operation_type,s.stage,s.credit_status,s.price,s.installment_count,s.installment_amount,
         data.payments.filter(p=>p.sale_id===s.id&&p.status==="confirmado").reduce((sum,p)=>sum+Number(p.amount),0)])]
     : [["Fecha","Categoría","Descripción","Monto ARS","Medio","Pagado"],
       ...data.expenses.map(x=>[x.expense_date,x.category,x.description,x.amount,x.method,x.paid?"Sí":"No"])];
   const csv="\uFEFF"+rows.map(row=>row.map(csvCell).join(";")).join("\r\n");
   const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
   const link=document.createElement("a");
   link.href=url;link.download="valle-erp-"+kind+"-"+today()+".csv";link.click();
   window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const nav=administration?[
   ["resumen","📊 Reportes"],["cobros","💰 Cobranzas"],["gastos","🧾 Gastos"],
   ["inventario","🚗 Inventario"],["entregas","🔑 Entregas"],["permisos","🔐 Personal"],["auditoria","🕒 Auditoría"]
 ]:[["operaciones","🚘 Ventas"],["clientes","👤 Fichas"],["cuotas","💳 Cuotas"],["seguimiento","📞 Seguimiento"],["documentos","📎 Archivos"]];
 if(!loaded)return <div className="p-6 text-sm">Preparando el ERP…</div>;
 if(!role||role==="consulta"||(administration&&!admin))return <div className={box}><h1 className="text-lg font-bold">Acceso al ERP</h1><p className="mt-2 text-sm text-muted-foreground">Tu usuario no tiene permiso para este módulo. Solicitá acceso a la persona administradora.</p></div>;
 return <div className="mx-auto w-full max-w-7xl space-y-3 pb-10">
   <header className="flex flex-wrap items-start justify-between gap-3">
     <div><p className="text-[11px] font-bold uppercase tracking-widest text-primary">Valle Automotores · ERP</p>
       <h1 className="text-xl font-bold sm:text-2xl">{administration?"Administración":"Gestión de ventas"}</h1>
       <p className="text-xs text-muted-foreground">{administration?"Caja, cartera, cobranzas y control":"Fichas, operaciones y seguimiento comercial"} · {role}</p></div>
     <div className="flex gap-2">{admin&&<Link className={secondary} href={administration?"/erp":"/erp/administracion"}>{administration?"Ver ventas":"Administración"}</Link>}
       <button className={secondary} onClick={()=>accountId&&role&&void reload(role,accountId).then(()=>toast.success("Datos actualizados")).catch(e=>toast.error(errors(e)))}>↻ Actualizar</button></div>
   </header>
   <div className="flex gap-2 overflow-x-auto pb-1">{nav.map(([key,name])=>
     <button key={key} type="button" onClick={()=>setTab(key)}
       className={"shrink-0 rounded-full border px-3 py-2 text-xs font-semibold "+(tab===key?"border-primary bg-primary text-primary-foreground":"border-border bg-card text-foreground")}>{name}</button>)}</div>
   {!administration&&tab==="clientes"&&<div className="grid gap-3 lg:grid-cols-2">
     <Block title={editingCustomer?"Editar ficha de cliente":"Nueva ficha de cliente"}><form key={editingCustomer?.id||"new"} onSubmit={addCustomer} className="grid grid-cols-2 gap-2">
       <label className={label+" col-span-2"}>Nombre completo *<input className={input} name="full_name" defaultValue={editingCustomer?.full_name||""} required minLength={2}/></label>
       <label className={label}>DNI / CUIT<input className={input} name="document_number" defaultValue={editingCustomer?.document_number||""}/></label>
       <label className={label}>Teléfono *<input className={input} name="phone" defaultValue={editingCustomer?.phone||""} required inputMode="tel"/></label>
       <label className={label+" col-span-2"}>Correo<input className={input} name="email" type="email" defaultValue={editingCustomer?.email||""}/></label>
       <label className={label+" col-span-2"}>Domicilio<input className={input} name="address" defaultValue={editingCustomer?.address||""}/></label>
       <label className={label}>Localidad<input className={input} name="city" defaultValue={editingCustomer?.city||""}/></label>
       <label className={label}>Provincia<input className={input} name="province" defaultValue={editingCustomer?.province||"Río Negro"}/></label>
       {admin&&<label className={label+" col-span-2"}>Asesor<select className={input} name="agent_id" defaultValue={editingCustomer?.agent_id||user?.id}>{data.people.filter(p=>data.members.some(m=>m.user_id===p.user_id&&m.erp_role!=="consulta")).map(p=><option value={p.user_id} key={p.user_id}>{p.full_name||p.email}</option>)}</select></label>}
       <label className={label+" col-span-2"}>Vincular contacto del CRM<select className={input} name="crm_contact_id" defaultValue={editingCustomer?.crm_contact_id||""}><option value="">Sin vincular</option>{data.contacts.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>
       <label className={label+" col-span-2"}>Observaciones<textarea className={input} rows={2} name="notes" defaultValue={editingCustomer?.notes||""}/></label>
       <div className="col-span-2 flex gap-2"><FormAction busy={busy}>{editingCustomer?"Guardar cambios":"Guardar ficha"}</FormAction>{editingCustomer&&<button type="button" className={secondary} onClick={()=>setEditingCustomer(null)}>Cancelar</button>}</div>
     </form></Block>
     <Block title={"Clientes ("+data.customers.length+")"}><div className="max-h-[65vh] space-y-2 overflow-auto">{data.customers.map(c=><div key={c.id} className="rounded-lg border border-border p-3 text-sm"><b>{c.full_name}</b><p className="text-xs text-muted-foreground">{c.phone} · {c.city||"Sin localidad"}</p><p className="mt-1 text-xs">{c.document_number||"Sin documento"} · {agentName(c.agent_id)}</p>{c.notes&&<p className="text-xs">{c.notes}</p>}<button type="button" className="mt-2 text-xs font-bold text-primary" onClick={()=>{setEditingCustomer(c);window.scrollTo({top:0,behavior:"smooth"})}}>Editar ficha</button></div>)}{!data.customers.length&&<p className="text-sm text-muted-foreground">Cargá tu primer cliente.</p>}</div></Block>
   </div>}
   {!administration&&tab==="operaciones"&&<div className="grid gap-3 lg:grid-cols-5">
     <div className="space-y-3 lg:col-span-3">
       <Block title="Operaciones"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente o vehículo…" className={input+" mb-3"}/>
         {dueFollowups.length>0&&<div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs"><b>📅 Gestiones para revisar</b>{dueFollowups.slice(0,4).map(x=><button key={x.id} type="button" className="mt-1 block w-full text-left text-primary" onClick={()=>{setSelectedId(x.sale_id);setTab("seguimiento")}}>{customerName(data.sales.find(s=>s.id===x.sale_id)?.customer_id||"")} · {new Date(x.next_contact_at!).toLocaleString("es-AR")}</button>)}</div>}
         <div className="max-h-[65vh] space-y-2 overflow-auto">{filtered.map(s=><button key={s.id} onClick={()=>{setSelectedId(s.id)}} className={"w-full rounded-lg border p-3 text-left "+(selected?.id===s.id?"border-primary bg-primary/5":"border-border")}>
           <div className="flex items-start justify-between gap-2"><div><p className="font-bold">{customerName(s.customer_id)}</p><p className="text-xs">{s.vehicle_description}</p></div><span className="text-[11px] font-bold text-primary">{s.stage.replaceAll("_"," ")}</span></div>
           <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{agentName(s.agent_id)}</span><span>{money(s.price)}</span></div>
         </button>)}{!filtered.length&&<p className="text-sm text-muted-foreground">Todavía no hay operaciones.</p>}</div>
       </Block>
       {selected&&<Block title="Detalle de la operación"><div className="grid grid-cols-2 gap-2 text-sm">
         <div><p className="text-xs text-muted-foreground">Cliente</p><b>{customerName(selected.customer_id)}</b></div>
         <div><p className="text-xs text-muted-foreground">Modalidad</p><b>{selected.operation_type}</b></div>
         <div><p className="text-xs text-muted-foreground">Precio</p><b>{money(selected.price)}</b></div>
         <div><p className="text-xs text-muted-foreground">Cuota pactada</p><b>{money(selected.installment_amount)}</b></div>
         <div><p className="text-xs text-muted-foreground">Crédito</p><b>{selected.credit_status.replaceAll("_"," ")}</b></div>
         <div><p className="text-xs text-muted-foreground">Entrega prevista</p><b>Cuota {selected.delivery_target_installment} (sujeta a aprobación)</b></div>
       </div><label className={label+" mt-3"}>Etapa comercial<select className={input} value={stageOptions.includes(selected.stage)?selected.stage:""} onChange={e=>void stageChange(e.target.value)} disabled={busy}>
         {!stageOptions.includes(selected.stage)&&<option value="" disabled>{selected.stage}</option>}
         {stageOptions.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
         {selected.crm_conversation_id&&<Link className="mt-2 inline-flex text-sm font-semibold text-primary" href={"/inbox?conversation="+encodeURIComponent(selected.crm_conversation_id)}>Abrir conversación del CRM ↗</Link>}
         {selected.notes&&<p className="mt-2 text-xs text-muted-foreground">{selected.notes}</p>}
       </Block>}
     </div>
     <div className="lg:col-span-2"><Block title="Registrar nueva venta">
       {!data.customers.length?<p className="text-sm text-muted-foreground">Primero creá la ficha del cliente en la pestaña Fichas.</p>:
       <form onSubmit={addSale} className="grid grid-cols-2 gap-2">
         <label className={label+" col-span-2"}>Cliente *<select className={input} required name="customer_id">{data.customers.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.phone}</option>)}</select></label>
         {admin&&<label className={label+" col-span-2"}>Asesor<select className={input} name="agent_id" defaultValue={user?.id}>{data.people.filter(p=>data.members.some(m=>m.user_id===p.user_id&&m.erp_role!=="consulta")).map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.email}</option>)}</select></label>}
         <label className={label+" col-span-2"}>Vehículo de interés *<input className={input} name="vehicle_description" placeholder="Ej: Toyota Hilux SRX 2025" required minLength={2}/></label>
         <label className={label}>Tipo<select className={input} name="vehicle_type">{["auto","camioneta","moto","otro"].map(x=><option key={x}>{x}</option>)}</select></label>
         <label className={label}>Venta<select className={input} name="operation_type"><option value="financiacion">Financiación</option><option value="directa">Directa</option></select></label>
         <label className={label}>Valor acordado ($)<input className={input} type="number" min="0" step="0.01" name="price" defaultValue="0"/></label>
         <label className={label}>Entrega inicial ($)<input className={input} type="number" min="0" step="0.01" name="initial_amount" defaultValue="0"/></label>
         <label className={label}>Gastos de carpeta ($)<input className={input} type="number" min="0" step="0.01" name="admin_fee" defaultValue="0"/></label>
         <label className={label}>Cantidad de cuotas<input className={input} type="number" min="0" max="72" name="installment_count" defaultValue="4"/></label>
         <label className={label}>Importe de cuota ($)<input className={input} type="number" min="0" step="0.01" name="installment_amount" defaultValue="500000"/></label>
         <label className={label}>Primer vencimiento<input className={input} type="date" name="first_due" defaultValue={today()}/></label>
         <label className={label}>Entrega pactada en cuota<input className={input} type="number" min="1" max="72" name="delivery_target_installment" defaultValue="4"/></label>
         <label className={label+" col-span-2"}>Vincular chat del CRM<select className={input} name="crm_conversation_id"><option value="">Sin vincular</option>{data.conversations.map(c=><option key={c.id} value={c.id}>{data.contacts.find(x=>x.id===c.contact_id)?.name||c.id.slice(0,8)}</option>)}</select></label>
         <label className={label+" col-span-2"}>Observaciones<textarea name="notes" rows={2} className={input}/></label>
         <div className="col-span-2"><FormAction busy={busy}>Guardar venta y generar cuotas</FormAction></div>
       </form>}</Block>
     </div>
   </div>}
   {!administration&&tab==="cuotas"&&<div className="space-y-3">
     <Block title="Cuotas y comprobantes">{!selected?<p>Primero cargá una venta.</p>:<>
       <label className={label}>Operación<select className={input} value={selected.id} onChange={e=>setSelectedId(e.target.value)}>{data.sales.map(s=><option key={s.id} value={s.id}>{customerName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
       <p className="my-2 text-xs text-muted-foreground">Los pagos informados por vendedores quedan pendientes hasta que administración los valide. Cuatro cuotas pagas no implican aprobación del crédito ni entrega automática.</p>
       <div className="space-y-2">{selectedInstallments.map(i=>{const paid=validated(i.id);const pending=data.payments.filter(p=>p.installment_id===i.id&&p.status==="pendiente").reduce((a,p)=>a+Number(p.amount),0);
       const state=paid>=Number(i.amount)?"Pagada":paid>0?"Parcial":i.due_date<today()?"Vencida":"Pendiente";
       return <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
         <div><b>Cuota {i.installment_number} · {money(i.amount)}</b><p className="text-xs text-muted-foreground">Vence {i.due_date} · {state} · Validado {money(paid)}{pending>0?" · A validar "+money(pending):""}</p></div>
         <button className={secondary} onClick={()=>setPaymentInstallment(i.id)}>Informar pago</button>
       </div>})}{!selectedInstallments.length&&<p className="text-xs text-muted-foreground">Venta directa o sin plan de cuotas.</p>}</div>
     </>}</Block>
     {selected&&selectedInstallments.length>0&&<Block title="Cargar pago y comprobante"><form className="grid grid-cols-2 gap-2" onSubmit={addPayment}>
       <label className={label+" col-span-2"}>Cuota<select name="installment_id" className={input} value={paymentInstallment||selectedInstallments[0].id} onChange={e=>setPaymentInstallment(e.target.value)}>{selectedInstallments.map(i=><option key={i.id} value={i.id}>Cuota {i.installment_number} · {money(i.amount)}</option>)}</select></label>
       <label className={label}>Importe pagado ($)<input className={input} name="amount" type="number" min="0.01" step="0.01" required/></label>
       <label className={label}>Fecha de pago<input className={input} name="paid_at" type="date" defaultValue={today()}/></label>
       <label className={label}>Medio<select className={input} name="method">{paymentMethods.map(x=><option key={x}>{x}</option>)}</select></label>
       <label className={label}>Referencia<input className={input} name="reference" placeholder="N.º operación"/></label>
       <label className={label+" col-span-2"}>Comprobante (imagen o PDF)<input className={input} name="file" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf"/></label>
       <div className="col-span-2"><FormAction busy={busy}>Informar pago para validar</FormAction></div>
     </form></Block>}
     <Block title="Historial de pagos">{data.payments.filter(p=>p.sale_id===selected?.id).map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-xs"><span><b>{money(p.amount)}</b> · {p.paid_at} · {p.method}</span><span className="font-semibold">{p.status}</span></div>)}</Block>
   </div>}
   {!administration&&tab==="seguimiento"&&<div className="grid gap-3 lg:grid-cols-2"><Block title="Nuevo seguimiento">
     {!selected?<p className="text-sm">Primero elegí una operación.</p>:<>
       <select className={input+" mb-3"} value={selected.id} onChange={e=>setSelectedId(e.target.value)}>{data.sales.map(s=><option key={s.id} value={s.id}>{customerName(s.customer_id)} · {s.vehicle_description}</option>)}</select>
       <form onSubmit={followUp} className="space-y-3">
         <label className={label}>Resultado<select className={input} name="outcome">{["nota","contactado","sin_respuesta","interesado","documentacion","cobranza","otro"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>
         <label className={label}>Notas de la gestión<textarea className={input} name="notes" required rows={4}/></label>
         <label className={label}>Próximo contacto / recordatorio<input className={input} type="datetime-local" name="next_contact_at"/></label>
         <FormAction busy={busy}>Guardar gestión</FormAction>
       </form>
     </>}</Block>
     <Block title="Historial de gestiones"><div className="max-h-[65vh] space-y-2 overflow-auto">{selectedFollowups.map(x=><div key={x.id} className="rounded-lg border border-border p-3"><p className="text-xs font-bold">{x.outcome.replaceAll("_"," ")} · {new Date(x.created_at).toLocaleString("es-AR")}</p><p className="my-1 whitespace-pre-wrap text-sm">{x.notes}</p>{x.next_contact_at&&<p className="text-xs text-primary">Próximo contacto: {new Date(x.next_contact_at).toLocaleString("es-AR")}</p>}</div>)}{!selectedFollowups.length&&<p className="text-sm text-muted-foreground">No hay gestiones registradas.</p>}</div></Block>
   </div>}
   {!administration&&tab==="documentos"&&<div className="grid gap-3 lg:grid-cols-2"><Block title="Cargar ficha o documento">
     {!selected?<p>Elegí una operación primero.</p>:<>
       <select className={input+" mb-3"} value={selected.id} onChange={e=>setSelectedId(e.target.value)}>{data.sales.map(s=><option key={s.id} value={s.id}>{customerName(s.customer_id)} · {s.vehicle_description}</option>)}</select>
       <form onSubmit={addDocument} className="space-y-3">
         <label className={label}>Tipo de archivo<select className={input} name="kind"><option value="ficha">Ficha del cliente</option><option value="dni">DNI / identidad</option><option value="contrato">Contrato</option><option value="comprobante">Comprobante</option><option value="otro">Otro</option></select></label>
         <label className={label}>Archivo (privado, hasta 10 MB)<input className={input} type="file" name="file" accept=".jpg,.jpeg,.png,.webp,.pdf" required/></label>
         <FormAction busy={busy}>Subir archivo</FormAction>
       </form>
     </>}</Block>
     <Block title="Documentación adjunta"><div className="space-y-2">{selectedDocuments.map(x=><button key={x.id} onClick={()=>void openDocument(x)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border p-3 text-left text-xs"><span className="min-w-0"><b>{x.kind}</b><span className="block truncate">{x.file_name}</span></span><span className="shrink-0 text-primary">Ver ↗</span></button>)}{!selectedDocuments.length&&<p className="text-sm text-muted-foreground">Sin documentos cargados.</p>}</div></Block>
   </div>}
   {administration&&admin&&tab==="resumen"&&<>
     <Block title="Resumen mensual"><div className="grid gap-3 sm:grid-cols-4"><label className={label}>Mes<input className={input} type="month" value={reportMonth} onChange={e=>setReportMonth(e.target.value)}/></label><div><p className="text-xs text-muted-foreground">Ventas del mes</p><b>{monthlySales}</b></div><div><p className="text-xs text-muted-foreground">Cobros validados</p><b>{money(monthlyConfirmed)}</b></div><div><p className="text-xs text-muted-foreground">Gastos del mes</p><b>{money(monthlyExpenses)}</b></div></div></Block>
     <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[["Ventas",data.sales.length.toLocaleString("es-AR")],["Cobrado validado",money(confirmedTotal)],["Por validar",money(pendingTotal)],["Gastos",money(expenseTotal)],["Saldo de cuotas",money(outstanding)],["En mora",money(overdue)],["Clientes",data.customers.length.toLocaleString("es-AR")],["Vehículos",data.inventory.length.toLocaleString("es-AR")]].map(([title,value])=><div className={box} key={title}><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-base font-bold">{value}</p></div>)}</div>
     <Block title="Rendimiento por asesor"><div className="mb-3 flex flex-wrap gap-2"><button className={secondary} onClick={()=>exportCsv("ventas")}>⬇ Exportar ventas CSV</button><button className={secondary} onClick={()=>exportCsv("gastos")}>⬇ Exportar gastos CSV</button></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border">{["Asesor","Ventas","Monto pactado","Cobros validados"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>
       {data.people.map(person=>{const sales=data.sales.filter(s=>s.agent_id===person.user_id);const salesIds=new Set(sales.map(s=>s.id));const paid=data.payments.filter(p=>salesIds.has(p.sale_id)&&p.status==="confirmado").reduce((a,p)=>a+Number(p.amount),0);if(!sales.length)return null;
       return <tr className="border-b border-border" key={person.user_id}><td className="p-2">{person.full_name||person.email}</td><td className="p-2">{sales.length}</td><td className="p-2">{money(sales.reduce((a,s)=>a+Number(s.price),0))}</td><td className="p-2">{money(paid)}</td></tr>})}</tbody></table></div>
       <p className="mt-3 text-[11px] text-muted-foreground">Resumen de registros del ERP (no reemplaza la contabilidad ni la facturación fiscal). Las cuotas pendientes no implican deuda financiera definitiva.</p>
     </Block>
   </>}
   {administration&&admin&&tab==="cobros"&&<Block title="Validación de cobros"><div className="space-y-2">
     {data.payments.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(p=><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3" key={p.id}>
       <div className="text-xs"><b>{customerName(data.sales.find(s=>s.id===p.sale_id)?.customer_id||"")} · {money(p.amount)}</b><p className="text-muted-foreground">{p.paid_at} · {p.method} · {p.reference||"Sin referencia"} · {p.status}</p>
       {data.documents.filter(x=>x.payment_id===p.id).map(x=><button className="mt-1 mr-2 text-primary underline" key={x.id} onClick={()=>void openDocument(x)}>{x.file_name}</button>)}</div>
       <div className="flex gap-1">{p.status==="pendiente"&&<><button className={secondary} disabled={busy} onClick={()=>void reviewPayment(p,"confirmado")}>✓ Validar</button><button className={secondary} disabled={busy} onClick={()=>void reviewPayment(p,"rechazado")}>Rechazar</button></>}
       {p.status==="confirmado"&&<button className={secondary} disabled={busy} onClick={()=>{if(window.confirm("¿Revertir este pago validado? Quedará auditado."))void reviewPayment(p,"revertido")}}>Revertir</button>}</div></div>)}{!data.payments.length&&<p className="text-sm text-muted-foreground">Todavía no se informaron pagos.</p>}
   </div></Block>}
   {administration&&admin&&tab==="gastos"&&<div className="grid gap-3 lg:grid-cols-2"><Block title="Registrar gasto"><form onSubmit={addExpense} className="grid grid-cols-2 gap-2">
     <label className={label}>Categoría<select className={input} name="category">{["Publicidad","Alquiler","Servicios","Sueldos","Comisiones","Impuestos","Vehículos","Otros"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className={label}>Fecha<input type="date" name="expense_date" defaultValue={today()} className={input}/></label>
     <label className={label+" col-span-2"}>Descripción<input className={input} name="description" required/></label>
     <label className={label}>Monto ($)<input className={input} type="number" name="amount" min="0.01" step="0.01" required/></label>
     <label className={label}>Medio<select className={input} name="method">{paymentMethods.map(x=><option key={x}>{x}</option>)}</select></label>
     <label className={label+" col-span-2"}><input type="checkbox" name="paid" className="mr-2"/>Ya está pagado</label>
     <div className="col-span-2"><FormAction busy={busy}>Registrar gasto</FormAction></div>
   </form></Block><Block title={"Gastos · "+money(expenseTotal)}><div className="max-h-[70vh] space-y-2 overflow-auto">{data.expenses.slice().sort((a,b)=>b.expense_date.localeCompare(a.expense_date)).map(x=><div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-xs" key={x.id}><div><b>{x.description}</b><p>{x.category} · {x.expense_date} · {money(x.amount)}</p></div><button className={secondary} disabled={busy} onClick={()=>void transact(async()=>{const {error}=await createClient().from("erp_expenses").update({paid:!x.paid}).eq("id",x.id);if(error)throw error},"Estado del gasto actualizado")}>{x.paid?"✓ Pagado":"Pendiente"}</button></div>)}{!data.expenses.length&&<p className="text-sm">No hay gastos cargados.</p>}</div></Block></div>}
   {administration&&admin&&tab==="inventario"&&<div className="grid gap-3 lg:grid-cols-2"><Block title="Alta de vehículo"><form onSubmit={addVehicle} className="grid grid-cols-2 gap-2">
     <label className={label}>Marca<input className={input} name="brand" required/></label><label className={label}>Modelo<input className={input} name="model" required/></label>
     <label className={label}>Versión<input className={input} name="version"/></label><label className={label}>Año<input className={input} type="number" min="1950" max="2100" name="model_year"/></label>
     <label className={label}>Patente<input className={input} name="plate"/></label>
     <label className={label}>Estado<select className={input} name="status">{["disponible","reservado","vendido","consignacion"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className={label}>Costo ($)<input className={input} type="number" min="0" step="0.01" name="cost" defaultValue="0"/></label>
     <label className={label}>Precio venta ($)<input className={input} type="number" min="0" step="0.01" name="listed_price" defaultValue="0"/></label>
     <div className="col-span-2"><FormAction busy={busy}>Agregar vehículo</FormAction></div>
   </form></Block><Block title="Stock y unidades"><div className="max-h-[70vh] space-y-2 overflow-auto">{data.inventory.map(x=><div key={x.id} className="rounded-lg border border-border p-3 text-xs"><b>{x.brand} {x.model} {x.version} {x.model_year}</b><p>{money(x.listed_price)} · {x.plate||"Sin patente"}</p><select className={input+" mt-2"} value={x.status} disabled={busy} onChange={e=>void transact(async()=>{const {error}=await createClient().from("erp_inventory").update({status:e.target.value}).eq("id",x.id);if(error)throw error},"Stock actualizado")}>{["disponible","reservado","vendido","consignacion"].map(s=><option key={s}>{s}</option>)}</select></div>)}{!data.inventory.length&&<p className="text-sm">Inventario vacío.</p>}</div></Block></div>}
   {administration&&admin&&tab==="entregas"&&<Block title="Control administrativo de entrega">{!selected?<p>No hay operaciones.</p>:<form onSubmit={saveDelivery} className="grid grid-cols-2 gap-3">
     <label className={label+" col-span-2"}>Operación<select className={input} value={selected.id} onChange={e=>setSelectedId(e.target.value)}>{data.sales.map(s=><option key={s.id} value={s.id}>{customerName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
     <div className="col-span-2 rounded-lg bg-muted p-3 text-xs">Cuotas confirmadas: {data.installments.filter(i=>i.sale_id===selected.id&&validated(i.id)>=Number(i.amount)).length} de {selected.installment_count}. La aprobación crediticia y la entrega se autorizan separadamente.</div>
     <label className={label}>Crédito<select className={input} name="credit_status" key={"credit-"+selected.id} defaultValue={selected.credit_status}>{["pendiente","en_gestion","aprobado","rechazado"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
     <label className={label}>Estado entrega<select className={input} name="status" key={"delivery-"+selected.id} defaultValue={data.deliveries.find(x=>x.sale_id===selected.id)?.status||"pendiente"}>{["pendiente","documentacion","credito","vehiculo","programada","entregada","cancelada"].map(s=><option key={s}>{s}</option>)}</select></label>
     <label className={label}>Programada<input className={input} type="date" name="planned_at" key={"plan-"+selected.id} defaultValue={data.deliveries.find(x=>x.sale_id===selected.id)?.planned_at||""}/></label>
     <label className={label}>Fecha entrega<input className={input} type="date" name="delivered_at" key={"done-"+selected.id} defaultValue={data.deliveries.find(x=>x.sale_id===selected.id)?.delivered_at||""}/></label>
     <label className={label+" col-span-2"}>Observaciones<textarea className={input} rows={3} name="notes" key={"notes-"+selected.id} defaultValue={data.deliveries.find(x=>x.sale_id===selected.id)?.notes||""}/></label>
     <div className="col-span-2"><FormAction busy={busy}>Guardar control de entrega</FormAction></div>
   </form>}</Block>}
   {administration&&admin&&tab==="auditoria"&&<Block title="Bitácora de operaciones"><div className="max-h-[75vh] space-y-2 overflow-auto">{data.audit.map(entry=><div key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs"><div><b>{entry.action} · {entry.entity.replace("erp_","")}</b><p className="text-muted-foreground">{agentName(entry.actor_id||"")}</p></div><span className="text-muted-foreground">{new Date(entry.created_at).toLocaleString("es-AR")}</span></div>)}{!data.audit.length&&<p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>}</div></Block>}
   {administration&&admin&&tab==="permisos"&&<Block title="Permisos de cada persona">{role!=="propietario"&&<p className="mb-3 text-xs text-muted-foreground">Solo la cuenta propietaria puede modificar permisos.</p>}
     <div className="space-y-2">{data.people.map(person=>{const current=data.members.find(m=>m.user_id===person.user_id)?.erp_role||"consulta";const locked=person.user_id===user?.id&&current==="propietario";
       return <div key={person.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
         <span><b>{person.full_name||person.email}</b><small className="block text-muted-foreground">{person.email}</small></span>
         <select className={input+" max-w-48"} disabled={busy||role!=="propietario"||locked} value={current} onChange={e=>void setMember(person.user_id,e.target.value as Role)}>{["propietario","administracion","vendedor","consulta"].map(x=><option key={x}>{x}</option>)}</select>
       </div>})}</div><p className="mt-3 text-xs text-muted-foreground">Vendedor: solo su cartera; Administración: operaciones, cobranzas, gastos, vehículos y reportes; Propietario: administración y permisos.</p>
   </Block>}
 </div>;
}
