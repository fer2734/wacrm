"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

type Role = "propietario" | "administracion" | "vendedor" | "consulta";
type C = { id:string; account_id:string; agent_id:string; full_name:string; phone:string; document_number:string|null; address:string|null; city:string|null };
type S = { id:string; account_id:string; customer_id:string; agent_id:string; vehicle_description:string; operation_type:string; price:number; initial_amount:number; admin_fee:number; installment_count:number; installment_amount:number; delivery_target_installment:number; stage:string; credit_status:string; notes:string|null; created_at:string };
type I = { id:string; sale_id:string; installment_number:number; due_date:string; amount:number };
type P = { id:string; sale_id:string; installment_id:string; amount:number; status:string; paid_at:string; method:string; reference:string|null };
type T = { id:string; sale_id:string|null; installment_id:string|null; kind:string; title:string; details:string|null; due_at:string; status:string; assigned_to:string; auto_key:string|null };
type CashAccount = { id:string; name:string; kind:string; opening_balance:number; active:boolean; bank_name:string|null };
type Movement = { id:string; treasury_account_id:string; movement_date:string; direction:string; amount:number; description:string; source_type:string; reconciled_at:string|null; reversal_of:string|null };
type Supplier = { id:string; name:string; tax_id:string|null; phone:string|null; email:string|null };
type Vehicle = { id:string; brand:string; model:string; version:string|null; model_year:number|null; listed_price:number; cost:number; status:string };
type Purchase = { id:string; vehicle_id:string; supplier_id:string|null; price:number; purchase_date:string; status:string; notes:string|null };
type VehicleCost = { id:string; vehicle_id:string; category:string; cost:number; incurred_on:string; description:string };
type Commission = { id:string; sale_id:string; agent_id:string; concept:string; amount:number; status:string; due_date:string|null; paid_at:string|null; basis:string };
type Checklist = { id:string; sale_id:string; item_key:string; label:string; completed:boolean; completed_at:string|null };
type Credit = { id:string; sale_id:string; financial_institution:string; amount_requested:number; status:string; application_date:string; resolved_at:string|null };
type Revision = { id:string; installment_id:string; previous_due_date:string; revised_due_date:string; previous_amount:number; revised_amount:number; reason:string; created_at:string };
type Template = { id:string; name:string; title:string; body_text:string; active:boolean };
type Fiscal = { id:string; sale_id:string|null; customer_name:string; amount:number; status:string; external_reference:string|null; cae:string|null; issue_date:string };
type Expense = { id:string; description:string; amount:number; expense_date:string; paid:boolean };
type AdminDocument = { id:string; expense_id:string|null; kind:string; path:string; file_name:string; mime_type:string; file_size:number; created_at:string };
type Person = { user_id:string; full_name:string|null; email:string };
type DB = { customers:C[]; sales:S[]; installments:I[]; payments:P[]; tasks:T[]; accounts:CashAccount[]; movements:Movement[];
 suppliers:Supplier[]; vehicles:Vehicle[]; purchases:Purchase[]; costs:VehicleCost[]; commissions:Commission[];
 checklist:Checklist[]; credits:Credit[]; revisions:Revision[]; templates:Template[]; fiscal:Fiscal[]; expenses:Expense[]; people:Person[]; adminDocs:AdminDocument[] };
const empty:DB = {customers:[],sales:[],installments:[],payments:[],tasks:[],accounts:[],movements:[],suppliers:[],
 vehicles:[],purchases:[],costs:[],commissions:[],checklist:[],credits:[],revisions:[],templates:[],fiscal:[],expenses:[],people:[],adminDocs:[]};
const money=(value:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(value||0));
const n=(value:FormDataEntryValue|null)=>Number(String(value||"0").replace(",","."))||0;
const v=(value:FormDataEntryValue|null)=>String(value||"").trim();
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const input="min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
const label="block min-w-0 space-y-1 text-xs font-semibold text-muted-foreground";
const primary="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
const outline="min-h-10 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50";
const muted="text-xs text-muted-foreground";
const panel="rounded-xl border border-border bg-card p-3 sm:p-4";
const checklistItems=[["ficha","Ficha del cliente completa"],["identidad","Identidad verificada"],["contrato","Contrato firmado"],["pagos","Cuotas pactadas verificadas"],["credito","Evaluación crediticia aprobada"],["vehiculo","Vehículo y documentación verificados"],["acta","Acta de entrega preparada"]] as const;
const dateLabel=(date:string|null)=>date?new Date(date.includes("T")?date:date+"T12:00:00").toLocaleDateString("es-AR"):"—";
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function Panel({title,children,aside}:{title:string;children:ReactNode;aside?:ReactNode}){
 return <section className={panel}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold">{title}</h2>{aside}</div>{children}</section>;
}
function Submit({working,children}:{working:boolean;children:ReactNode}){
 return <button className={primary} type="submit" disabled={working}>{working?"Guardando…":children}</button>;
}
function Notice({children}:{children:ReactNode}){return <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{children}</p>}
async function getRows<R>(table:string,account:string,limit=1500):Promise<R[]>{
 const {data,error}=await createClient().from(table).select("*").eq("account_id",account).limit(limit);
 if(error)throw new Error("No se pudo cargar "+table+": "+error.message);
 return (data||[]) as R[];
}

function safePrint(title:string,sections:Array<[string,string]>){
 const popup=window.open("","_blank");
 if(!popup){toast.error("Permití las ventanas emergentes para imprimir");return}
 const html=popup.document;
 const css=html.createElement("style");
 css.textContent="body{font-family:Arial,sans-serif;color:#111;max-width:800px;margin:45px auto;line-height:1.5;padding:0 16px}h1{font-size:23px;border-bottom:2px solid #222;padding-bottom:10px}h2{font-size:14px;text-transform:uppercase;margin:25px 0 4px}pre{white-space:pre-wrap;word-break:break-word;font:14px Arial,sans-serif;margin:5px 0}@media print{body{margin:0;max-width:none}}";
 html.head.appendChild(css);html.title=title;
 const h=html.createElement("h1");h.textContent=title;html.body.appendChild(h);
 sections.forEach(([name,text])=>{const h2=html.createElement("h2");h2.textContent=name;const p=html.createElement("pre");p.textContent=text;html.body.append(h2,p)});
 const footer=html.createElement("p");footer.textContent="Documento generado desde Valle Automotores. Verificar y firmar según corresponda.";footer.style.marginTop="50px";html.body.appendChild(footer);
 popup.focus();popup.print();
}
function downloadCsv(fileName:string,rows:unknown[][]){
 const cell=(value:unknown)=>{
  let s=String(value??"");
  if(/^[=+@-]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
 };
 const raw="\uFEFF"+rows.map(r=>r.map(cell).join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([raw],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download=fileName;link.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ErpIntegral({administration=false}:{administration?:boolean}){
 const {user,accountId,profileLoading}=useAuth();
 const [role,setRole]=useState<Role|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [working,setWorking]=useState(false);
 const [data,setData]=useState<DB>(empty);
 const [tab,setTab]=useState(administration?"cobranzas":"cartera");
 const [selected,setSelected]=useState("");
 const [search,setSearch]=useState("");
 const [quotePrice,setQuotePrice]=useState(35000000);
 const [quoteDown,setQuoteDown]=useState(5000000);
 const [quoteFees,setQuoteFees]=useState(400000);
 const [quoteInstallments,setQuoteInstallments]=useState(48);
 const [chosenTemplate,setChosenTemplate]=useState("");
 const [month,setMonth]=useState(today().slice(0,7));
 const admin=role==="propietario"||role==="administracion";

 const reload=useCallback(async(currentRole:Role,account:string)=>{
  const management=currentRole==="propietario"||currentRole==="administracion";
  const agentData=await Promise.all([
   getRows<C>("erp_customers",account),getRows<S>("erp_sales",account),
   getRows<I>("erp_installments",account),getRows<P>("erp_payments",account),
   getRows<T>("erp_tasks",account),getRows<Vehicle>("erp_inventory",account),
   getRows<Checklist>("erp_delivery_checklist",account),getRows<Credit>("erp_credit_applications",account),
   getRows<Revision>("erp_installment_revisions",account),getRows<Template>("erp_contract_templates",account)
  ]);
  const managementData: [
   CashAccount[],Movement[],Supplier[],Purchase[],VehicleCost[],
   Commission[],Fiscal[],Expense[],Person[],AdminDocument[]
  ] = management?await Promise.all([
   getRows<CashAccount>("erp_treasury_accounts",account),getRows<Movement>("erp_treasury_movements",account),
   getRows<Supplier>("erp_suppliers",account),getRows<Purchase>("erp_vehicle_purchases",account),
   getRows<VehicleCost>("erp_vehicle_costs",account),getRows<Commission>("erp_commissions",account),
   getRows<Fiscal>("erp_fiscal_documents",account),getRows<Expense>("erp_expenses",account),
   createClient().from("profiles").select("user_id,full_name,email").eq("account_id",account).then(x=>{if(x.error)throw x.error;return x.data as Person[]}),
   getRows<AdminDocument>("erp_admin_documents",account)
  ]):[[],[],[],[],[],[],[],[],[],[]];
  setData({customers:agentData[0],sales:agentData[1],installments:agentData[2],payments:agentData[3],
   tasks:agentData[4],vehicles:agentData[5],checklist:agentData[6],credits:agentData[7],
   revisions:agentData[8],templates:agentData[9],accounts:managementData[0],movements:managementData[1],
   suppliers:managementData[2],purchases:managementData[3],costs:managementData[4],
   commissions:managementData[5],fiscal:managementData[6],expenses:managementData[7],people:managementData[8],adminDocs:managementData[9]});
 },[]);
 useEffect(()=>{
  if(profileLoading||!user||!accountId)return;
  let active=true;
  const load=async()=>{
   try{
    const result=await createClient().from("erp_memberships").select("erp_role").eq("account_id",accountId).eq("user_id",user.id).maybeSingle();
    if(result.error)throw result.error;
    const current=(result.data?.erp_role??null) as Role|null;
    if(!active)return;
    setRole(current);
    if(current&&current!=="consulta"){
     if(current==="propietario"||current==="administracion"){
      // Idempotent internal reminder generation. No WhatsApp message is sent.
      await createClient().rpc("erp_sync_overdue_tasks",{p_account:accountId}).then(({error})=>{
       if(error)console.warn("ERP task sync:",error.message)
      });
     }
     await reload(current,accountId);
    }
   }catch(e){if(active)toast.error(errorText(e))}
   finally{if(active)setLoaded(true)}
  };
  void load();return()=>{active=false};
 },[user?.id,accountId,profileLoading,reload]);

 const act=async(fn:()=>Promise<void>,message:string)=>{
  if(working||!role||!accountId)return;
  setWorking(true);
  try{await fn();toast.success(message)}
  catch(e){toast.error(errorText(e))}
  finally{try{await reload(role,accountId)}catch(e){toast.error(errorText(e))}setWorking(false)}
 };
 const insert=async(table:string,values:Record<string,unknown>)=>{
  const {error}=await createClient().from(table).insert(values);
  if(error)throw error;
 };
 const update=async(table:string,id:string,values:Record<string,unknown>)=>{
  const {error}=await createClient().from(table).update(values).eq("id",id);
  if(error)throw error;
 };
 const call=async(name:string,args:Record<string,unknown>)=>{
  const {error}=await createClient().rpc(name,args);
  if(error)throw error;
 };
 const byName=(id:string)=>data.customers.find(c=>c.id===id)?.full_name||"Cliente";
 const agentName=(id:string)=>data.people.find(p=>p.user_id===id)?.full_name||"Asesor";
 const currentSale=data.sales.find(s=>s.id===selected)||data.sales[0]||null;
 const currentCustomer=currentSale?data.customers.find(c=>c.id===currentSale.customer_id):null;
 const selectedInstallments=data.installments.filter(i=>i.sale_id===currentSale?.id).sort((a,b)=>a.installment_number-b.installment_number);
 const paid=(id:string)=>data.payments.filter(p=>p.installment_id===id&&p.status==="confirmado").reduce((sum,p)=>sum+Number(p.amount),0);
 const reported=(id:string)=>data.payments.filter(p=>p.installment_id===id&&p.status==="pendiente").reduce((sum,p)=>sum+Number(p.amount),0);
 const outstanding=(i:I)=>Math.max(0,Number(i.amount)-paid(i.id));
 const now=today();
 const age=(i:I)=>Math.max(0,Math.floor((new Date(now+"T12:00:00").getTime()-new Date(i.due_date+"T12:00:00").getTime())/86400000));
 const overdues=data.installments.filter(i=>i.due_date<now&&outstanding(i)>0);
 const totalOutstanding=data.installments.reduce((sum,i)=>sum+outstanding(i),0);
 const totalOverdue=overdues.reduce((sum,i)=>sum+outstanding(i),0);
 const totalConfirmed=data.payments.filter(p=>p.status==="confirmado").reduce((sum,p)=>sum+Number(p.amount),0);
 const paidQuotas=(saleId:string)=>data.installments.filter(i=>i.sale_id===saleId&&outstanding(i)<=0).length;
 const stages=["nuevo","contactado","interesado","documentacion","pactado","activo","entrega_en_gestion","entregado","no_interesado","caido"];
 const filteredSales=data.sales.filter(s=>(byName(s.customer_id)+" "+s.vehicle_description).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 const selectedTasks=data.tasks.filter(t=>t.status!=="cancelada").sort((a,b)=>a.due_at.localeCompare(b.due_at));
 const cashBalance=(id:string)=>{
  const a=data.accounts.find(x=>x.id===id);
  return Number(a?.opening_balance||0)+data.movements.filter(m=>m.treasury_account_id===id)
   .reduce((sum,m)=>sum+Number(m.amount)*(m.direction==="ingreso"?1:-1),0);
 };
 const purchaseTotal=(vehicleId:string)=>data.purchases.filter(p=>p.vehicle_id===vehicleId&&p.status==="confirmada").reduce((sum,p)=>sum+Number(p.price),0);
 const vehicleCost=(vehicleId:string)=>data.costs.filter(c=>c.vehicle_id===vehicleId).reduce((sum,c)=>sum+Number(c.cost),0);
 const totalCash=data.accounts.reduce((sum,a)=>sum+cashBalance(a.id),0);
 const menu=administration?[
  ["cobranzas","💳 Cartera"],["tareas","📆 Gestiones"],["tesoreria","🏦 Caja y bancos"],
  ["compras","🚘 Compras"],["comisiones","👥 Comisiones"],["entregas","🔑 Entregas"],
  ["ajustes","🧮 Planes"],["comprobantes","📎 Comprobantes"],["documentos","📄 Contratos / ARCA"],["reportes","📈 Reportes"]
 ]:[["cartera","💳 Mis clientes"],["tareas","📆 Tareas"],["cotizador","🧮 Cotizador"],["documentos","📄 Solicitudes"]];

 function handleForm(e:FormEvent<HTMLFormElement>, fn:(f:FormData)=>Promise<void>,message:string){
  e.preventDefault();const form=e.currentTarget;const values=new FormData(form);
  void act(async()=>{await fn(values);form.reset()},message);
 }
 function printClientRecord(){
  if(!currentSale||!currentCustomer)return;
  safePrint("Solicitud interna · Valle Automotores",[
   ["Fecha y asesor",dateLabel(now)+" · "+(agentName(currentSale.agent_id)||"")],
   ["Solicitante",currentCustomer.full_name+"\nDNI/CUIT: "+(currentCustomer.document_number||"Pendiente")+
    "\nTeléfono: "+currentCustomer.phone+"\nDomicilio: "+(currentCustomer.address||"Pendiente")+
    "\nLocalidad: "+(currentCustomer.city||"Pendiente")],
   ["Operación",currentSale.vehicle_description+"\nModalidad: "+currentSale.operation_type+
    "\nPrecio informado: "+money(currentSale.price)+"\nEntrega inicial: "+money(currentSale.initial_amount)+
    "\nGasto administrativo: "+money(currentSale.admin_fee)+"\nCuotas: "+currentSale.installment_count+
    " de "+money(currentSale.installment_amount)],
   ["Condiciones","Borrador interno sujeto a confirmación contractual, evaluación crediticia y disponibilidad de unidad. No constituye factura ni constancia de aprobación de entrega."],
   ["Firmas","Cliente: __________________________\n\nAsesor: __________________________"]
  ]);
 }
 function printTemplate(){
  if(!currentSale||!currentCustomer)return;
  const t=data.templates.find(x=>x.id===chosenTemplate)||data.templates[0];
  if(!t)return toast.error("Administración debe cargar una plantilla primero");
  const values:Record<string,string>={
   "{cliente}":currentCustomer.full_name,"{dni}":currentCustomer.document_number||"",
   "{telefono}":currentCustomer.phone,"{vehiculo}":currentSale.vehicle_description,
   "{precio}":money(currentSale.price),"{cuotas}":String(currentSale.installment_count),
   "{importe_cuota}":money(currentSale.installment_amount),"{fecha}":dateLabel(now)
  };
  let output=t.body_text;
  for(const [key,value] of Object.entries(values))output=output.split(key).join(value);
  safePrint(t.title,[["Contenido",output],["Importante","Revisar el texto contractual y las condiciones aplicables antes de firmar."]]);
 }
 function report(kind:"cartera"|"caja"|"comisiones"|"compras"){
  if(!admin)return;
  let rows:unknown[][]=[];
  if(kind==="cartera")rows=[["Cliente","Vehículo","Cuota","Vencimiento","Valor","Pagado","Saldo","Días atraso"],
   ...data.installments.map(i=>{const s=data.sales.find(s=>s.id===i.sale_id);return[byName(s?.customer_id||""),s?.vehicle_description||"",i.installment_number,i.due_date,i.amount,paid(i.id),outstanding(i),age(i)]})];
  else if(kind==="caja")rows=[["Fecha","Cuenta","Dirección","Concepto","Monto ARS","Conciliado"],
   ...data.movements.map(m=>[m.movement_date,data.accounts.find(a=>a.id===m.treasury_account_id)?.name,m.direction,m.description,m.amount,m.reconciled_at?"Sí":"No"])];
  else if(kind==="comisiones")rows=[["Asesor","Operación","Concepto","Monto ARS","Estado","Vencimiento"],
   ...data.commissions.map(c=>[agentName(c.agent_id),byName(data.sales.find(s=>s.id===c.sale_id)?.customer_id||""),c.concept,c.amount,c.status,c.due_date])];
  else rows=[["Vehículo","Proveedor","Fecha","Compra","Estado"],
   ...data.purchases.map(p=>{const unit=data.vehicles.find(x=>x.id===p.vehicle_id);return[(unit?.brand||"")+" "+(unit?.model||""),data.suppliers.find(x=>x.id===p.supplier_id)?.name||"",p.purchase_date,p.price,p.status]})];
  downloadCsv("valle-"+kind+"-"+today()+".csv",rows);
 }

 if(!loaded)return <p className="p-6 text-sm">Cargando módulos ERP…</p>;
 if(!role||role==="consulta"||(administration&&!admin))
  return <Notice>No tenés habilitado el acceso a este módulo. Solicitá permisos a administración.</Notice>;

 return <main className="mx-auto w-full max-w-7xl space-y-3 pb-14">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><p className="text-[11px] font-bold uppercase tracking-widest text-primary">Valle Automotores · ERP integral</p>
    <h1 className="text-xl font-bold sm:text-2xl">{administration?"Operaciones administrativas":"Cartera del vendedor"}</h1>
    <p className={muted}>{administration?"Cobros, bancos, compras, comisiones y entregas":"Vencimientos, gestiones, documentación y presupuestos"}</p></div>
   <div className="flex flex-wrap gap-2">
    <Link href={administration?"/erp/administracion":"/erp"} className={outline}>Volver al ERP</Link>
    <button type="button" disabled={working} className={outline} onClick={()=>accountId&&role&&void reload(role,accountId).then(()=>toast.success("Actualizado")).catch(e=>toast.error(errorText(e)))}>↻ Actualizar</button>
   </div>
  </div>
  <div className="flex gap-2 overflow-x-auto pb-2">{menu.map(([key,name])=><button type="button" key={key} onClick={()=>setTab(key)}
   className={"shrink-0 rounded-full border px-3 py-2 text-xs font-semibold "+(tab===key?"border-primary bg-primary text-primary-foreground":"border-border bg-card text-foreground")}>{name}</button>)}</div>

  {/* Seller and administrator accounts receivable */}
  {tab==="cartera"&&<div className="space-y-3">
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[
    ["Saldo de cuotas",money(totalOutstanding)],["Vencido",money(totalOverdue)],
    ["Cobros confirmados",money(totalConfirmed)],["Operaciones",String(data.sales.length)]
   ].map(([name,value])=><div key={name} className={panel}><p className={muted}>{name}</p><b className="text-base">{value}</b></div>)}</div>
   <div className="grid gap-3 lg:grid-cols-2">
    <Panel title={administration?"Estado de cuentas corrientes":"Mis operaciones"}>
     <input className={input+" mb-3"} placeholder="Buscar cliente o vehículo…" value={search} onChange={e=>setSearch(e.target.value)}/>
     <div className="max-h-[65vh] space-y-2 overflow-auto">{filteredSales.map(s=>{
      const due=data.installments.filter(i=>i.sale_id===s.id);
      const owed=due.reduce((sum,i)=>sum+outstanding(i),0);
      const overdue=due.filter(i=>i.due_date<now).reduce((sum,i)=>sum+outstanding(i),0);
      return <button key={s.id} type="button" onClick={()=>setSelected(s.id)}
       className={"block w-full rounded-lg border p-3 text-left text-xs "+(currentSale?.id===s.id?"border-primary bg-primary/5":"border-border")}>
       <div className="flex items-start justify-between gap-2"><div><b className="text-sm">{byName(s.customer_id)}</b><p>{s.vehicle_description}</p></div>
        <span className="font-bold text-primary">{money(owed)}</span></div>
       <p className="mt-1 text-muted-foreground">Etapa: {s.stage.replaceAll("_"," ")} · Cuotas pagas: {paidQuotas(s.id)} / {s.installment_count}
        {overdue>0?" · En mora: "+money(overdue):""}</p>
      </button>})}{!filteredSales.length&&<Notice>No hay operaciones registradas en esta cartera.</Notice>}</div>
    </Panel>
    <Panel title="Cuenta corriente · Detalle">
     {!currentSale?<Notice>Primero registrá una operación desde ERP · Ventas.</Notice>:<>
      <label className={label}>Operación<select className={input} value={currentSale.id} onChange={e=>setSelected(e.target.value)}>
       {data.sales.map(s=><option value={s.id} key={s.id}>{byName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
       <div><p className={muted}>Cuotas completamente pagas</p><b>{paidQuotas(currentSale.id)} / {currentSale.installment_count}</b></div>
       <div><p className={muted}>Crédito</p><b>{currentSale.credit_status.replaceAll("_"," ")}</b></div>
      </div>
      {paidQuotas(currentSale.id)>=currentSale.delivery_target_installment
       ?<Notice>Se completó el hito de cuota {currentSale.delivery_target_installment}. Derivar a Entregas para verificar documentación, evaluación crediticia y disponibilidad. No autoriza entrega automática.</Notice>
       :<Notice>Hito de entrega pactada: cuota {currentSale.delivery_target_installment}. Falta completar cuotas confirmadas y la evaluación correspondiente.</Notice>}
      <div className="mt-2 max-h-[54vh] space-y-2 overflow-auto">{selectedInstallments.map(i=>{
       const remaining=outstanding(i);
       return <div key={i.id} className="rounded-lg border border-border p-2.5 text-xs">
        <div className="flex justify-between gap-2"><b>Cuota {i.installment_number} · {money(i.amount)}</b><span>{dateLabel(i.due_date)}</span></div>
        <p className={muted}>Confirmado {money(paid(i.id))} · Por validar {money(reported(i.id))} · Saldo {money(remaining)}</p>
        {remaining>0&&i.due_date<now&&<p className="font-semibold text-orange-500">Vencida hace {age(i)} días</p>}
       </div>})}</div>
      <div className="mt-3 flex flex-wrap gap-2"><button className={outline} type="button" onClick={printClientRecord}>🖨️ Imprimir solicitud</button>
      <Link className={outline} href={administration?"/erp/administracion":"/erp"}>Ver comprobantes</Link></div>
     </>}
    </Panel>
   </div>
  </div>}

  {tab==="tareas"&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Nueva tarea o recordatorio">
    <form className="space-y-3" onSubmit={e=>handleForm(e,async f=>{
     if(!user||!accountId)throw Error("Sin sesión");
     const saleId=v(f.get("sale_id"));
     await insert("erp_tasks",{account_id:accountId,created_by:user.id,
      assigned_to:admin?v(f.get("assigned_to")):user.id,
      sale_id:saleId||null,kind:v(f.get("kind")),title:v(f.get("title")),
      details:v(f.get("details"))||null,due_at:new Date(v(f.get("due_at"))).toISOString()});
    },"Tarea guardada")}>
     <label className={label}>Tipo<select className={input} name="kind">
      {["seguimiento","cobranza","documentacion","entrega","administrativa"].map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>
     <label className={label}>Asunto<input className={input} name="title" required minLength={3} maxLength={240}/></label>
     <label className={label}>Operación<select className={input} name="sale_id"><option value="">Tarea general</option>{data.sales.map(s=><option key={s.id} value={s.id}>{byName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
     {admin&&<label className={label}>Responsable<select className={input} name="assigned_to" defaultValue={user?.id}>{data.people.map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.email}</option>)}</select></label>}
     <label className={label}>Fecha y hora<input type="datetime-local" className={input} name="due_at" required/></label>
     <label className={label}>Detalles<textarea className={input} rows={3} name="details"/></label>
     <Submit working={working}>Guardar tarea</Submit>
    </form>
    {admin&&<div className="mt-4 border-t border-border pt-3"><button className={outline} type="button" disabled={working} onClick={()=>void act(async()=>{
      await call("erp_sync_overdue_tasks",{p_account:accountId})
    },"Se revisaron cuotas vencidas y se generaron tareas faltantes")}>↻ Generar avisos de mora</button>
      <p className={"mt-2 "+muted}>Al abrir el ERP administrativo se verifican vencimientos. Los avisos son tareas internas; no se envían mensajes externos automáticamente.</p>
    </div>}
   </Panel>
   <Panel title={"Agenda pendiente · "+selectedTasks.length}>
    <div className="max-h-[75vh] space-y-2 overflow-auto">{selectedTasks.map(t=><div key={t.id} className="rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><b>{t.title}</b><span className={new Date(t.due_at).getTime()<Date.now()&&t.status!=="completada"?"font-bold text-orange-500":"text-muted-foreground"}>{new Date(t.due_at).toLocaleString("es-AR")}</span></div>
      <p className={muted}>{t.kind} · {t.status} {t.sale_id?"· "+byName(data.sales.find(s=>s.id===t.sale_id)?.customer_id||""):""}</p>
      {t.details&&<p className="mt-1">{t.details}</p>}
      {t.status!=="completada"&&<button type="button" disabled={working} className={outline+" mt-2"} onClick={()=>void act(async()=>update("erp_tasks",t.id,{status:"completada",completed_at:new Date().toISOString()}),"Tarea completada")}>✓ Completar</button>}
     </div>)}{!selectedTasks.length&&<Notice>Sin tareas pendientes.</Notice>}</div>
   </Panel>
  </div>}

  {tab==="cotizador"&&!administration&&<Panel title="Cotizador interno · simulación">
   <Notice>Es una estimación comercial, no una oferta bancaria ni una aprobación. Las condiciones y tasas deben confirmarse al retiro del vehículo.</Notice>
   <div className="mt-3 grid grid-cols-2 gap-3">
    <label className={label}>Valor vehículo<input className={input} type="number" min="0" value={quotePrice} onChange={e=>setQuotePrice(Number(e.target.value))}/></label>
    <label className={label}>Entrega inicial<input className={input} type="number" min="0" value={quoteDown} onChange={e=>setQuoteDown(Number(e.target.value))}/></label>
    <label className={label}>Gastos estimados<input className={input} type="number" min="0" value={quoteFees} onChange={e=>setQuoteFees(Number(e.target.value))}/></label>
    <label className={label}>Cuotas de referencia<input className={input} type="number" min="1" max="72" value={quoteInstallments} onChange={e=>setQuoteInstallments(Number(e.target.value))}/></label>
   </div>
   <div className="mt-3 grid grid-cols-2 gap-2">
    <div className={panel}><p className={muted}>Saldo de referencia</p><b>{money(Math.max(0,quotePrice-quoteDown+quoteFees))}</b></div>
    <div className={panel}><p className={muted}>División simple sin intereses</p><b>{money(Math.max(0,quotePrice-quoteDown+quoteFees)/Math.max(1,quoteInstallments))}</b></div>
   </div>
   <p className={"mt-3 "+muted}>No incluye intereses, impuestos, seguros ni costos financieros. No utilizar como cuota final prometida.</p>
  </Panel>}

  {tab==="tesoreria"&&admin&&<div className="space-y-3">
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className={panel}><p className={muted}>Saldo consolidado</p><b>{money(totalCash)}</b></div>
    <div className={panel}><p className={muted}>Cuentas</p><b>{data.accounts.length}</b></div>
    <div className={panel}><p className={muted}>Sin conciliar</p><b>{data.movements.filter(x=>!x.reconciled_at).length}</b></div>
    <div className={panel}><p className={muted}>Movimientos</p><b>{data.movements.length}</b></div></div>
   <div className="grid gap-3 lg:grid-cols-2">
    <Panel title="Crear caja, banco o billetera"><form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
      await insert("erp_treasury_accounts",{account_id:accountId,created_by:user!.id,
       name:v(f.get("name")),kind:v(f.get("kind")),bank_name:v(f.get("bank_name"))||null,
       opening_balance:n(f.get("opening_balance"))});
     },"Cuenta registrada")}>
     <label className={label+" col-span-2"}>Nombre<input className={input} name="name" required minLength={2} placeholder="Ej: Banco Galicia / Efectivo"/></label>
     <label className={label}>Tipo<select className={input} name="kind"><option value="efectivo">Efectivo</option><option value="banco">Banco</option><option value="billetera">Billetera</option></select></label>
     <label className={label}>Entidad<input className={input} name="bank_name" placeholder="Opcional"/></label>
     <label className={label}>Saldo inicial ($)<input className={input} type="number" step=".01" name="opening_balance" defaultValue={0}/></label>
     <div className="col-span-2"><Submit working={working}>Agregar cuenta</Submit></div>
    </form>
    <div className="mt-3 space-y-1">{data.accounts.map(a=><div key={a.id} className="flex justify-between border-b border-border py-2 text-xs"><span>{a.name} · {a.kind}</span><b>{money(cashBalance(a.id))}</b></div>)}</div></Panel>
    <Panel title="Registrar ingreso o egreso"><form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
     await call("erp_post_treasury",{p_account:accountId,p_cash_account:v(f.get("account")),p_date:v(f.get("date")),
      p_direction:v(f.get("direction")),p_amount:n(f.get("amount")),
      p_category:v(f.get("category")),p_description:v(f.get("description")),
      p_source_type:v(f.get("source_type")),p_source_id:v(f.get("source_id"))||null});
    },"Movimiento de caja registrado")}>
      <label className={label+" col-span-2"}>Cuenta<select className={input} name="account" required>{data.accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
      <label className={label}>Fecha<input type="date" name="date" defaultValue={today()} className={input}/></label>
      <label className={label}>Sentido<select name="direction" className={input}><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></label>
      <label className={label}>Monto<input className={input} name="amount" type="number" step=".01" min=".01" required/></label>
      <label className={label}>Categoría<input className={input} name="category" defaultValue="General"/></label>
      <label className={label+" col-span-2"}>Concepto<input className={input} name="description" minLength={2} required/></label>
      <label className={label}>Origen<select className={input} name="source_type"><option value="manual">Manual</option><option value="pago">Cobro confirmado</option><option value="gasto">Gasto pagado</option></select></label>
      <label className={label}>Registro asociado<select className={input} name="source_id"><option value="">Sin vincular</option>
       <optgroup label="Cobros confirmados">{data.payments.filter(p=>p.status==="confirmado").map(p=><option key={p.id} value={p.id}>{byName(data.sales.find(s=>s.id===p.sale_id)?.customer_id||"")} · {money(p.amount)} · {p.id.slice(0,6)}</option>)}</optgroup>
       <optgroup label="Gastos pagados">{data.expenses.filter(x=>x.paid).map(e=><option key={e.id} value={e.id}>{e.description} · {money(e.amount)}</option>)}</optgroup>
      </select></label>
      <div className="col-span-2"><Submit working={working}>Guardar movimiento</Submit></div>
     </form><p className={"mt-2 "+muted}>Cuando vinculás un cobro o gasto, el importe y sentido deben coincidir exactamente. Un mismo cobro no se registra dos veces.</p></Panel>
    <Panel title="Transferencia entre cuentas"><form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
      await call("erp_transfer_treasury",{p_account:accountId,p_from:v(f.get("from")),p_to:v(f.get("to")),
       p_date:v(f.get("date")),p_amount:n(f.get("amount")),p_note:v(f.get("notes"))});
     },"Transferencia registrada con dos movimientos")}>
      <label className={label}>Origen<select className={input} name="from">{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className={label}>Destino<select className={input} name="to">{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className={label}>Fecha<input className={input} type="date" name="date" defaultValue={today()}/></label>
      <label className={label}>Monto<input className={input} type="number" name="amount" min=".01" step=".01" required/></label>
      <label className={label+" col-span-2"}>Motivo<input className={input} name="notes" minLength={2} required/></label>
      <div className="col-span-2"><Submit working={working}>Transferir entre cuentas</Submit></div>
     </form></Panel>
    <Panel title="Libro de caja y conciliación" aside={<button className={outline} onClick={()=>report("caja")}>CSV</button>}>
     <div className="max-h-[75vh] space-y-2 overflow-auto">{data.movements.slice().sort((a,b)=>b.movement_date.localeCompare(a.movement_date)).map(m=><div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-xs">
      <div><b className={m.direction==="ingreso"?"text-emerald-500":"text-orange-500"}>{m.direction==="ingreso"?"+":"−"} {money(m.amount)}</b>
       <p>{m.description}</p><p className={muted}>{dateLabel(m.movement_date)} · {data.accounts.find(a=>a.id===m.treasury_account_id)?.name||"Caja"} · {m.reconciled_at?"Conciliado":"Pendiente"}</p></div>
      <div className="flex gap-1">{!m.reconciled_at&&<button disabled={working} className={outline} onClick={()=>void act(async()=>call("erp_reconcile_treasury",{p_movement:m.id}),"Conciliado")}>Conciliar</button>}
       {!m.reversal_of&&<button disabled={working} className={outline} onClick={()=>{
        const reason=window.prompt("Motivo de la reversión (mínimo 8 caracteres)");
        if(reason)void act(async()=>call("erp_reverse_treasury",{p_movement:m.id,p_reason:reason}),"Contramovimiento registrado");
       }}>Revertir</button>}</div>
     </div>)}{!data.movements.length&&<Notice>Sin movimientos de caja.</Notice>}</div>
    </Panel>
   </div>
  </div>}

  {tab==="compras"&&admin&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Proveedores"><form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
    await insert("erp_suppliers",{account_id:accountId,created_by:user!.id,name:v(f.get("name")),tax_id:v(f.get("tax_id"))||null,
     phone:v(f.get("phone"))||null,email:v(f.get("email"))||null});
   },"Proveedor guardado")}>
    <label className={label+" col-span-2"}>Nombre<input className={input} name="name" minLength={2} required/></label>
    <label className={label}>CUIT<input className={input} name="tax_id"/></label>
    <label className={label}>Teléfono<input className={input} name="phone"/></label>
    <label className={label+" col-span-2"}>Correo<input className={input} name="email" type="email"/></label>
    <div className="col-span-2"><Submit working={working}>Agregar proveedor</Submit></div>
   </form><div className="mt-3 space-y-1">{data.suppliers.map(x=><p className="border-b border-border py-1 text-xs" key={x.id}>{x.name} · {x.tax_id||"Sin CUIT"}</p>)}</div></Panel>
   <Panel title="Compra o ingreso de vehículo">
    <Notice>Primero cargá la unidad desde el Inventario del ERP. Aquí registrá el costo de adquisición y su proveedor.</Notice>
    <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
     await insert("erp_vehicle_purchases",{account_id:accountId,created_by:user!.id,vehicle_id:v(f.get("vehicle_id")),
      supplier_id:v(f.get("supplier_id"))||null,purchase_date:v(f.get("date")),
      price:n(f.get("price")),status:v(f.get("status")),notes:v(f.get("notes"))||null});
    },"Compra registrada")}>
     <label className={label+" col-span-2"}>Vehículo<select className={input} name="vehicle_id">{data.vehicles.map(x=><option key={x.id} value={x.id}>{x.brand} {x.model} {x.model_year}</option>)}</select></label>
     <label className={label}>Proveedor<select className={input} name="supplier_id"><option value="">Particular / sin asignar</option>{data.suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
     <label className={label}>Fecha<input type="date" className={input} defaultValue={today()} name="date"/></label>
     <label className={label}>Costo adquisición<input className={input} name="price" type="number" min="0" step=".01" required/></label>
     <label className={label}>Estado<select className={input} name="status"><option value="pendiente">Pendiente</option><option value="confirmada">Confirmada</option><option value="cancelada">Cancelada</option></select></label>
     <label className={label+" col-span-2"}>Observaciones<textarea className={input} name="notes" rows={2}/></label>
     <div className="col-span-2"><Submit working={working}>Registrar compra</Submit></div>
    </form></Panel>
   <Panel title="Gastos adicionales por vehículo"><form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
     await insert("erp_vehicle_costs",{account_id:accountId,created_by:user!.id,vehicle_id:v(f.get("vehicle_id")),
      category:v(f.get("category")),description:v(f.get("description")),cost:n(f.get("cost")),
      incurred_on:v(f.get("date"))});
    },"Costo de unidad registrado")}>
     <label className={label+" col-span-2"}>Vehículo<select className={input} name="vehicle_id">{data.vehicles.map(x=><option value={x.id} key={x.id}>{x.brand} {x.model}</option>)}</select></label>
     <label className={label}>Categoría<select className={input} name="category">{["Reparaciones","Transferencia","Lavado","Repuestos","Traslado","Patente","Otro"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className={label}>Fecha<input className={input} type="date" name="date" defaultValue={today()}/></label>
     <label className={label+" col-span-2"}>Detalle<input className={input} name="description" required/></label>
     <label className={label}>Monto<input type="number" min=".01" step=".01" name="cost" className={input} required/></label>
     <div className="col-span-2"><Submit working={working}>Agregar costo</Submit></div>
    </form></Panel>
   <Panel title="Stock, costos y margen estimado" aside={<button className={outline} onClick={()=>report("compras")}>CSV compras</button>}>
    <div className="space-y-2 overflow-auto">{data.vehicles.map(x=>{
     const confirmed=purchaseTotal(x.id);
     const acquisition=confirmed>0?confirmed:Number(x.cost);
     const expenses=vehicleCost(x.id);
     return <div key={x.id} className="rounded-lg border border-border p-3 text-xs"><b>{x.brand} {x.model} {x.version||""} {x.model_year||""}</b>
       <p className={muted}>Costo base {money(acquisition)} · Adicionales {money(expenses)} · Precio listado {money(x.listed_price)}</p>
       <p className="font-bold">Margen bruto estimado: {money(Number(x.listed_price)-acquisition-expenses)}</p>
       <p className={muted}>Sin impuestos, comisiones y costos financieros. {x.status}</p></div>
    })}{!data.vehicles.length&&<Notice>No se cargaron unidades en inventario.</Notice>}</div>
   </Panel>
  </div>}

  {tab==="comisiones"&&admin&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Crear liquidación / comisión"><form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
    const amount=n(f.get("amount"));
    await insert("erp_commissions",{account_id:accountId,created_by:user!.id,
     sale_id:v(f.get("sale_id")),agent_id:v(f.get("agent_id")),concept:v(f.get("concept")),
     basis:v(f.get("basis")),rate_percent:v(f.get("rate_percent"))?n(f.get("rate_percent")):null,
     base_amount:v(f.get("base_amount"))?n(f.get("base_amount")):null,
     amount,due_date:v(f.get("due_date"))||null,notes:v(f.get("notes"))||null,status:"calculada"});
   },"Comisión registrada para revisión")}>
    <label className={label+" col-span-2"}>Operación<select className={input} name="sale_id" required>{data.sales.map(s=><option key={s.id} value={s.id}>{byName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
    <label className={label+" col-span-2"}>Asesor<select className={input} name="agent_id">{data.people.map(p=><option value={p.user_id} key={p.user_id}>{p.full_name||p.email}</option>)}</select></label>
    <label className={label+" col-span-2"}>Concepto<input className={input} name="concept" placeholder="Ej: comisión de cuota 1" minLength={3} required/></label>
    <label className={label}>Base<select className={input} name="basis"><option value="manual">Manual</option><option value="cuota">Cuota</option><option value="venta">Venta</option><option value="gasto_carpeta">Gasto carpeta</option></select></label>
    <label className={label}>Fecha prevista<input className={input} name="due_date" type="date"/></label>
    <label className={label}>Base de cálculo ($)<input className={input} name="base_amount" type="number" min="0" step=".01"/></label>
    <label className={label}>Porcentaje (%)<input className={input} name="rate_percent" type="number" min="0" max="100" step=".001"/></label>
    <label className={label+" col-span-2"}>Importe aprobado a calcular ($)<input className={input} name="amount" type="number" min=".01" step=".01" required/></label>
    <label className={label+" col-span-2"}>Notas<textarea className={input} name="notes" rows={2}/></label>
    <div className="col-span-2"><Submit working={working}>Registrar comisión</Submit></div>
   </form><p className={"mt-2 "+muted}>Las reglas de reparto deben confirmarse con la administración; un porcentaje ingresado no constituye liquidación aprobada.</p></Panel>
   <Panel title={"Comisiones · "+money(data.commissions.reduce((sum,c)=>sum+(c.status==="anulada"?0:Number(c.amount)),0))} aside={<button className={outline} onClick={()=>report("comisiones")}>CSV</button>}>
    <div className="max-h-[75vh] space-y-2 overflow-auto">{data.commissions.map(c=><div key={c.id} className="rounded-lg border border-border p-3 text-xs">
     <div className="flex justify-between gap-2"><b>{agentName(c.agent_id)} · {money(c.amount)}</b><span>{c.status}</span></div>
     <p>{c.concept} · {byName(data.sales.find(s=>s.id===c.sale_id)?.customer_id||"")}</p>
     <div className="mt-2 flex flex-wrap gap-2">
      {c.status==="calculada"&&<><button disabled={working} className={outline} onClick={()=>void act(async()=>update("erp_commissions",c.id,{status:"aprobada"}),"Comisión aprobada")}>Aprobar</button>
       <button disabled={working} className={outline} onClick={()=>void act(async()=>update("erp_commissions",c.id,{status:"anulada"}),"Comisión anulada")}>Anular</button></>}
      {c.status==="aprobada"&&<button disabled={working} className={outline} onClick={()=>void act(async()=>update("erp_commissions",c.id,{status:"pagada",paid_at:today()}),"Comisión marcada como pagada")}>Marcar pagada</button>}
     </div></div>)}{!data.commissions.length&&<Notice>No hay comisiones registradas.</Notice>}</div>
   </Panel>
  </div>}

  {tab==="entregas"&&admin&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Legajo de entrega">
    {!currentSale?<Notice>Sin ventas cargadas.</Notice>:<>
     <label className={label}>Cliente y operación<select className={input} value={currentSale.id} onChange={e=>setSelected(e.target.value)}>
      {data.sales.map(s=><option key={s.id} value={s.id}>{byName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
     <div className="my-3 grid grid-cols-2 gap-2 text-xs"><div><p className={muted}>Cuotas confirmadas</p><b>{paidQuotas(currentSale.id)} / {currentSale.delivery_target_installment} para hito</b></div>
      <div><p className={muted}>Estado crédito</p><b>{currentSale.credit_status}</b></div></div>
     <button className={outline} type="button" disabled={working} onClick={()=>void act(async()=>{
      const rows=checklistItems.map(([item_key,label])=>({account_id:accountId,sale_id:currentSale.id,item_key,label}));
      const result=await createClient().from("erp_delivery_checklist").upsert(rows,{onConflict:"sale_id,item_key",ignoreDuplicates:true});
      if(result.error)throw result.error;
     },"Checklist habilitado")}>Crear checklist estándar</button>
     <div className="mt-3 space-y-2">{data.checklist.filter(x=>x.sale_id===currentSale.id).map(c=><div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-xs">
      <span>{c.completed?"✅":"⬜"} {c.label}</span>
      <button className={outline} disabled={working} onClick={()=>void act(async()=>update("erp_delivery_checklist",c.id,{completed:!c.completed,completed_at:!c.completed?new Date().toISOString():null,completed_by:!c.completed?user!.id:null}),"Requisito actualizado")}>{c.completed?"Reabrir":"Completar"}</button>
     </div>)}{!data.checklist.some(x=>x.sale_id===currentSale.id)&&<p className={muted}>Generá el checklist para empezar.</p>}</div>
     <Link href="/erp/administracion" className={outline+" mt-3 inline-flex"}>Controlar entrega y fecha</Link>
    </>}
   </Panel>
   <Panel title="Evaluación con bancos y financieras">
    {currentSale&&<form className="grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
      await insert("erp_credit_applications",{account_id:accountId,created_by:user!.id,
       sale_id:currentSale.id,financial_institution:v(f.get("financial_institution")),
       amount_requested:n(f.get("amount_requested")),status:"pendiente",
       application_date:v(f.get("date")),notes:v(f.get("notes"))||null});
     },"Solicitud interna de crédito registrada")}>
      <label className={label+" col-span-2"}>Banco o financiera<input className={input} name="financial_institution" required placeholder="Entidad"/></label>
      <label className={label}>Monto solicitado ($)<input className={input} type="number" min="0" step=".01" name="amount_requested" required/></label>
      <label className={label}>Fecha<input type="date" name="date" className={input} defaultValue={today()}/></label>
      <label className={label+" col-span-2"}>Notas<textarea className={input} name="notes" rows={2}/></label>
      <div className="col-span-2"><Submit working={working}>Registrar solicitud</Submit></div>
     </form>}
    <div className="mt-3 space-y-2">{data.credits.filter(c=>c.sale_id===currentSale?.id).map(c=><div key={c.id} className="rounded-lg border border-border p-3 text-xs">
      <b>{c.financial_institution} · {money(c.amount_requested)}</b><p className={muted}>Estado interno: {c.status}</p>
      <select className={input+" mt-2"} disabled={working} value={c.status} onChange={e=>void act(async()=>update("erp_credit_applications",c.id,{status:e.target.value,resolved_at:["aprobada","rechazada","desistida"].includes(e.target.value)?today():null}),"Solicitud actualizada")}>
       {["pendiente","en_analisis","aprobada","rechazada","desistida"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select>
     </div>)}</div>
    <Notice>Este registro no contacta automáticamente a un banco ni implica aprobación externa.</Notice>
   </Panel>
  </div>}

  {tab==="ajustes"&&admin&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Reprogramar cuota o refinanciar">
    <Notice>Los cambios conservan el historial y no alteran pagos confirmados. La revisión debe corresponder a condiciones formalmente acordadas con el cliente.</Notice>
    <form className="mt-3 space-y-3" onSubmit={e=>handleForm(e,async f=>{
     await call("erp_reschedule_installment",{p_installment:v(f.get("installment_id")),p_new_date:v(f.get("date")),
      p_new_amount:n(f.get("amount")),p_reason:v(f.get("reason"))});
    },"Cuota reprogramada y cambio auditado")}>
     <label className={label}>Cuota a modificar<select className={input} name="installment_id" required>
      {data.installments.map(i=>{const sale=data.sales.find(s=>s.id===i.sale_id);return <option key={i.id} value={i.id}>
        {byName(sale?.customer_id||"")} · Cuota {i.installment_number} · {money(i.amount)} · {dateLabel(i.due_date)}</option>})}</select></label>
     <label className={label}>Nuevo vencimiento<input className={input} name="date" type="date" required/></label>
     <label className={label}>Nuevo importe ($)<input className={input} name="amount" type="number" step=".01" min=".01" required/></label>
     <label className={label}>Motivo / aceptación contractual<textarea className={input} name="reason" minLength={8} rows={3} required/></label>
     <Submit working={working}>Guardar revisión</Submit>
    </form>
   </Panel>
   <Panel title="Historial de cambios"><div className="max-h-[75vh] space-y-2 overflow-auto">{data.revisions.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(r=><div className="rounded-lg border border-border p-3 text-xs" key={r.id}>
    <b>{money(r.previous_amount)} → {money(r.revised_amount)}</b>
    <p>Vencimiento: {dateLabel(r.previous_due_date)} → {dateLabel(r.revised_due_date)}</p><p className={muted}>{r.reason} · {dateLabel(r.created_at)}</p></div>)}
    {!data.revisions.length&&<Notice>Sin revisiones de cuota.</Notice>}</div></Panel>
  </div>}

  {tab==="comprobantes"&&admin&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Adjuntar comprobante de gasto o administración">
    <Notice>Los archivos se guardan en almacenamiento privado y solo pueden abrirlos personas con permiso administrativo. Formatos JPG, PNG, WEBP o PDF, hasta 10 MB.</Notice>
    <form className="mt-3 space-y-3" onSubmit={e=>handleForm(e,async f=>{
      const file=f.get("file");
      if(!(file instanceof File)||file.size<1||file.size>10485760 ||
        !["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type))
        throw new Error("Archivo inválido: imagen o PDF de hasta 10 MB");
      if(!accountId||!user)throw new Error("Sesión no disponible");
      const expenseId=v(f.get("expense_id"));
      const name=file.name.replace(/[^a-zA-Z0-9_.-]/g,"_").slice(-100);
      const path=accountId+"/"+crypto.randomUUID()+"-"+name;
      const db=createClient();
      const stored=await db.storage.from("erp-administracion").upload(path,file,{contentType:file.type,upsert:false});
      if(stored.error)throw stored.error;
      try{
       await insert("erp_admin_documents",{account_id:accountId,expense_id:expenseId||null,
        kind:v(f.get("kind")),path,file_name:file.name,mime_type:file.type,file_size:file.size,created_by:user.id});
      }catch(e){throw new Error("Archivo subido, pero no registrado en el índice. No vuelvas a subirlo sin consultar a administración: "+errorText(e))}
    },"Archivo administrativo guardado")}>
      <label className={label}>Concepto<select className={input} name="kind"><option value="gasto">Comprobante de gasto</option>
       <option value="factura_proveedor">Factura de proveedor</option><option value="banco">Documento bancario</option><option value="otro">Otro</option></select></label>
      <label className={label}>Gasto asociado<select className={input} name="expense_id"><option value="">Sin gasto específico</option>
       {data.expenses.map(x=><option value={x.id} key={x.id}>{dateLabel(x.expense_date)} · {x.description} · {money(x.amount)}</option>)}</select></label>
      <label className={label}>Archivo<input className={input} type="file" name="file" accept=".jpg,.jpeg,.png,.webp,.pdf" required/></label>
      <Submit working={working}>Guardar comprobante privado</Submit>
    </form><Link className={outline+" mt-3 inline-flex"} href="/erp/administracion">Cargar gastos</Link>
   </Panel>
   <Panel title={"Comprobantes almacenados · "+data.adminDocs.length}>
    <div className="max-h-[70vh] space-y-2 overflow-auto">{data.adminDocs.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(x=><div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-xs" key={x.id}>
      <div className="min-w-0"><b>{x.kind.replaceAll("_"," ")}</b><p className="truncate">{x.file_name}</p>
       <p className={muted}>{dateLabel(x.created_at)} · {x.expense_id?(data.expenses.find(e=>e.id===x.expense_id)?.description||"Gasto asociado"):"Documento general"}</p></div>
      <button type="button" className={outline} onClick={()=>{
       const popup=window.open("","_blank");
       void createClient().storage.from("erp-administracion").createSignedUrl(x.path,120)
        .then(({data,error})=>{if(error||!data?.signedUrl){popup?.close();toast.error(error?.message||"No se pudo abrir");return}if(popup)popup.location.href=data.signedUrl;else window.location.href=data.signedUrl});
      }}>Abrir</button></div>)}{!data.adminDocs.length&&<Notice>No hay comprobantes administrativos cargados.</Notice>}</div>
   </Panel>
  </div>}

  {tab==="documentos"&&<div className="grid gap-3 lg:grid-cols-2">
   <Panel title="Documentos de cliente">
    {!currentSale?<Notice>Registrá una operación para generar la solicitud.</Notice>:<>
     <label className={label}>Operación<select className={input} value={currentSale.id} onChange={e=>setSelected(e.target.value)}>
      {data.sales.map(s=><option key={s.id} value={s.id}>{byName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
     <div className="mt-3 flex flex-wrap gap-2"><button className={outline} onClick={printClientRecord}>🖨️ Solicitud PDF (imprimir)</button>
      <button className={outline} onClick={printTemplate} disabled={!data.templates.length}>🖨️ Documento de plantilla</button></div>
     <label className={label+" mt-3"}>Plantilla<select className={input} value={chosenTemplate} onChange={e=>setChosenTemplate(e.target.value)}>
      <option value="">Predeterminada</option>{data.templates.filter(x=>x.active).map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
     <p className={"mt-2 "+muted}>Se abre la impresión del navegador; seleccioná «Guardar como PDF». No reemplaza contratos firmados ni documentos fiscales.</p>
    </>}
   </Panel>
   {admin&&<Panel title="Plantillas editables">
    <form className="space-y-3" onSubmit={e=>handleForm(e,async f=>{
     await insert("erp_contract_templates",{account_id:accountId,created_by:user!.id,name:v(f.get("name")),
      title:v(f.get("title")),body_text:v(f.get("body_text"))});
    },"Plantilla guardada")}>
     <label className={label}>Nombre<input className={input} name="name" required/></label>
     <label className={label}>Título del documento<input className={input} name="title" required/></label>
     <label className={label}>Texto (marcadores: cliente, dni, telefono, vehiculo, precio, cuotas, importe_cuota, fecha)
      <textarea className={input} name="body_text" rows={6} required placeholder="Yo, {cliente}, DNI {dni}, solicito..."/></label>
     <Submit working={working}>Guardar plantilla</Submit>
    </form>
    <p className={"mt-2 "+muted}>Plantillas internas: deben revisarse legalmente antes de uso contractual.</p>
   </Panel>}
   {admin&&<Panel title="Comprobantes fiscales · registro externo">
    <Notice>Integración ARCA pendiente de certificado digital, CUIT habilitada y punto de venta. Este registro nunca genera CAE ni emite una factura por sí solo.</Notice>
    <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e=>handleForm(e,async f=>{
     await insert("erp_fiscal_documents",{account_id:accountId,created_by:user!.id,
      sale_id:v(f.get("sale_id"))||null,customer_name:v(f.get("customer_name")),
      amount:n(f.get("amount")),doc_kind:v(f.get("doc_kind")),issue_date:v(f.get("date")),
      status:"borrador",notes:v(f.get("notes"))||null});
    },"Borrador fiscal interno registrado")}>
     <label className={label+" col-span-2"}>Cliente<input className={input} name="customer_name" required/></label>
     <label className={label+" col-span-2"}>Operación<select className={input} name="sale_id"><option value="">No vinculada</option>{data.sales.map(s=><option key={s.id} value={s.id}>{byName(s.customer_id)} · {s.vehicle_description}</option>)}</select></label>
     <label className={label}>Tipo<select className={input} name="doc_kind">{["factura","nota_credito","nota_debito","recibo_interno"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className={label}>Fecha<input className={input} name="date" type="date" defaultValue={today()}/></label>
     <label className={label}>Monto ($)<input className={input} type="number" step=".01" min="0" name="amount" required/></label>
     <label className={label+" col-span-2"}>Notas<textarea className={input} name="notes" rows={2}/></label>
     <div className="col-span-2"><Submit working={working}>Guardar borrador</Submit></div>
    </form>
    <div className="mt-3 space-y-2">{data.fiscal.map(f=><div className="rounded-lg border border-border p-3 text-xs" key={f.id}>
     <b>{f.customer_name} · {money(f.amount)}</b><p>{f.doc_kind} · {f.status} · {f.external_reference||"Sin comprobante de ARCA"}</p>
     {f.status==="borrador"&&<button className={outline+" mt-2"} disabled={working} onClick={()=>{
       const reference=window.prompt("Ingresá el número real del comprobante emitido externamente");
       if(!reference?.trim())return;
       const cae=window.prompt("CAE autorizado por ARCA (opcional; no se verifica automáticamente)")||null;
       void act(async()=>update("erp_fiscal_documents",f.id,{status:"emitido_externamente",
        external_reference:reference.trim(),cae,authorized_at:cae?new Date().toISOString():null}),"Referencia fiscal externa registrada");
     }}>Registrar factura emitida fuera del ERP</button>}
    </div>)}</div>
   </Panel>}
  </div>}

  {tab==="reportes"&&admin&&<div className="space-y-3">
   <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
    {[["Cuotas pendientes",money(totalOutstanding)],["Mora",money(totalOverdue)],["Total en caja/bancos",money(totalCash)],
      ["Cobrado confirmado",money(totalConfirmed)],["Comisiones aprobadas",money(data.commissions.filter(x=>x.status==="aprobada").reduce((sum,x)=>sum+Number(x.amount),0))],
      ["Gastos registrados",money(data.expenses.reduce((sum,x)=>sum+Number(x.amount),0))],
      ["Vehículos en stock",String(data.vehicles.filter(x=>x.status==="disponible").length)],
      ["Entregas pendientes",String(data.sales.filter(s=>s.stage==="entrega_en_gestion").length)]
    ].map(([name,value])=><div key={name} className={panel}><p className={muted}>{name}</p><b className="text-base">{value}</b></div>)}
   </div>
   <Panel title="Reporte mensual">
    <label className={label+" max-w-60"}>Mes<input className={input} type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
     {[
      ["Ventas creadas",String(data.sales.filter(s=>s.created_at.startsWith(month)).length)],
      ["Cobros confirmados",money(data.payments.filter(p=>p.status==="confirmado"&&p.paid_at.startsWith(month)).reduce((a,p)=>a+Number(p.amount),0))],
      ["Gastos",money(data.expenses.filter(e=>e.expense_date.startsWith(month)).reduce((a,e)=>a+Number(e.amount),0))],
      ["Comisiones liquidadas",money(data.commissions.filter(c=>c.status==="pagada"&&c.paid_at?.startsWith(month)).reduce((a,c)=>a+Number(c.amount),0))]
     ].map(([name,value])=><div className={panel} key={name}><p className={muted}>{name}</p><b>{value}</b></div>)}
    </div>
   </Panel>
   <Panel title="Antigüedad de mora">
    <div className="grid grid-cols-3 gap-2">{[[1,30],[31,60],[61,99999]].map(([from,to])=><div className="rounded-lg border border-border p-3" key={from}>
     <p className={muted}>{from}-{to===99999?"+":to} días</p><b>{money(overdues.filter(i=>age(i)>=from&&age(i)<=to).reduce((a,i)=>a+outstanding(i),0))}</b></div>)}</div>
    <p className={"mt-2 "+muted}>Basado en vencimientos y pagos confirmados. No contempla intereses punitorios ni moratorias fuera del ERP.</p>
   </Panel>
   <Panel title="Exportar información"><div className="flex flex-wrap gap-2">
    <button className={outline} onClick={()=>report("cartera")}>⬇ Cuentas corrientes CSV</button>
    <button className={outline} onClick={()=>report("caja")}>⬇ Caja CSV</button>
    <button className={outline} onClick={()=>report("compras")}>⬇ Compras CSV</button>
    <button className={outline} onClick={()=>report("comisiones")}>⬇ Comisiones CSV</button>
   </div></Panel>
  </div>}
 </main>;
}
