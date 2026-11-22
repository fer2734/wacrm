"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ClipboardCheck, Save, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { sections } from "@/lib/erp/application-fields";
import { toast } from "sonner";

type Client = {id:string; full_name:string; phone:string; document_number:string|null; email:string|null; address:string|null; city:string|null; province:string|null; agent_id:string};
type Sale = {id:string; customer_id:string; agent_id:string; vehicle_description:string; vehicle_type:string; operation_type:string; price:number; installment_amount:number; admin_fee:number; installment_count:number; entry_date:string|null; first_due:string|null; second_due_date:string|null; delivery_target_installment:number; notes:string|null};
type Person = {user_id:string; full_name:string|null; email:string};
type Props = { accountId:string; userId:string; admin:boolean; customers:Client[]; selectedCustomer:Client|null; sale?:Sale|null; application?:Record<string,string>; people:Person[]; onSaved:(id:string)=>Promise<void>|void; onCancel:()=>void };
const input="min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const label="block min-w-0 space-y-1 text-xs font-bold text-muted-foreground";
const localDate=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
function nextMonth(s:string){if(!s)return "";const [y,m,d]=s.split("-").map(Number);const max=new Date(Date.UTC(y,m+1,0)).getUTCDate();return [y+(m===12?1:0),String(m===12?1:m+1).padStart(2,"0"),String(Math.min(d,max)).padStart(2,"0")].join("-")}
const text=(v:FormDataEntryValue|null)=>String(v??"").trim();
const numeric=(v:FormDataEntryValue|null)=>Number(text(v).replace(",","."))||0;
const money=(n:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(n);

export function CompleteSaleEditor({accountId,userId,admin,customers,selectedCustomer,sale,application={},people,onSaved,onCancel}:Props){
 const [clientId,setClientId]=useState(sale?.customer_id||selectedCustomer?.id||"new");
 const [agentId,setAgentId]=useState(sale?.agent_id||selectedCustomer?.agent_id||userId);
 const [entryDate,setEntryDate]=useState(sale?.entry_date||sale?.first_due||localDate());
 const [secondDue,setSecondDue]=useState(sale?.second_due_date||nextMonth(entryDate));
 const [monthly,setMonthly]=useState(Number(sale?.installment_amount||500000));
 const [fee,setFee]=useState(Number(sale?.admin_fee||0));
 const [busy,setBusy]=useState(false);
 const editing=!!sale;
 const chosen=customers.find(c=>c.id===clientId);
 const defaults=useMemo<Record<string,string>>(()=>({
  full_name:chosen?.full_name||"",dni:chosen?.document_number||"",phone:chosen?.phone||"",
  email:chosen?.email||"",address:chosen?.address||"",city:chosen?.city||"",province:chosen?.province||"Río Negro",
  salesperson:people.find(p=>p.user_id===agentId)?.full_name||"",
  brand:sale?.vehicle_description||""
 }),[chosen,people,agentId,sale?.vehicle_description]);
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  const f=new FormData(e.currentTarget);const app:Record<string,string>={};
  for(const group of sections)for(const field of group.fields)app[field.key]=text(f.get(field.key));
  const mandatory=[["full_name","nombre del cliente"],["dni","DNI del cliente"],["phone","teléfono del cliente"],["address","domicilio"],["city","localidad"],["brand","marca"],["model","modelo"],["vehicle_category","tipo de vehículo"]];
  for(const [key,title] of mandatory)if(!app[key])return toast.error("Falta completar "+title);
  if(!/^\d{7,11}$/.test(app.dni.replace(/\D/g,"")))return toast.error("Ingresá un DNI válido");
  if(secondDue<entryDate)return toast.error("La cuota 2 no puede vencer antes de la cuota 1");
  if(monthly<=0||fee<0)return toast.error("La cuota y los gastos deben ser válidos");
  const category=app.vehicle_category.toLowerCase();
  const vehicleType=category.includes("moto")?"moto":category.includes("camioneta")?"camioneta":"auto";
  const descriptor=[app.brand,app.model,app.model_year].filter(Boolean).join(" ");
  const values={
   agent_id:admin?agentId:userId,vehicle_description:descriptor,vehicle_type:vehicleType,
   operation_type:text(f.get("operation_type"))||"financiacion",price:numeric(f.get("price")),
   installment_amount:monthly,admin_fee:fee,
   installment_count:numeric(f.get("installment_count"))||15,
   entry_date:entryDate,first_due:entryDate,second_due_date:secondDue,
   delivery_target_installment:numeric(f.get("delivery_target_installment"))||4,
   notes:text(f.get("notes"))
  };
  setBusy(true);
  try{
   const db=createClient();
   if(editing){
    const {error}=await db.rpc("erp_admin_update_complete_sale",{p_sale:sale.id,p_values:values,p_application:app});
    if(error)throw error;
    toast.success("Venta y solicitud actualizadas");
    await onSaved(sale.id);
   }else{
    const {data,error}=await db.rpc("erp_create_complete_sale",{
     p_account:accountId,p_customer:clientId==="new"?null:clientId,p_values:values,p_application:app
    });
    if(error)throw error;
    toast.success("Venta registrada: solicitud, cuotas y contrato listo para emitir");
    await onSaved(String(data));
   }
  }catch(e){toast.error(e instanceof Error?e.message:"No se pudo guardar la venta")}
  finally{setBusy(false)}
 }
 return <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div>
   <p className="text-xs font-extrabold uppercase tracking-widest text-primary">Valle Automotores · Solicitud de adhesión</p>
   <h2 className="mt-1 text-xl font-black">{editing?"Modificar venta":"Registrar venta directamente"}</h2>
   <p className="mt-1 text-xs text-muted-foreground">Un único formulario crea el cliente (si no existe), la solicitud, la operación y sus cuotas. Después emitís el enlace de firma.</p>
  </div><button type="button" className="rounded-xl border border-border p-2" onClick={onCancel} aria-label="Cancelar"><X size={18}/></button></div>
  <form key={(editing?"edit":"new")+"-"+clientId+"-"+sale?.id} onSubmit={save} className="space-y-5">
   <div className="grid gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:grid-cols-2">
    <label className={label}>Cliente<select className={input} value={clientId} disabled={editing} onChange={e=>{setClientId(e.target.value);const c=customers.find(x=>x.id===e.target.value);if(c)setAgentId(c.agent_id);else setAgentId(userId)}}>
     <option value="new">+ Cliente nuevo (cargar en este formulario)</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.phone}</option>)}
    </select></label>
    {admin?<label className={label}>Asesor responsable<select className={input} value={agentId} onChange={e=>setAgentId(e.target.value)} disabled={editing}>
     {people.map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.email}</option>)}
    </select></label>:<p className="self-end text-xs text-muted-foreground">La venta queda asignada a tu usuario.</p>}
   </div>
   {sections.map(group=><fieldset key={group.title}><legend className="mb-3 w-full border-b border-border pb-2 text-sm font-black">{group.title}</legend>
    <div className="grid gap-3 sm:grid-cols-2">{group.fields.map(field=>{
     const value=application[field.key]??defaults[field.key]??"";
     const required=["full_name","dni","phone","address","city","brand","model","vehicle_category"].includes(field.key);
     return <label className={label+(field.wide?" sm:col-span-2":"")} key={field.key}>{field.label}{required?" *":""}
      {field.options?<select className={input} name={field.key} defaultValue={value} required={required}>
       {!field.options.includes("")&&<option value="">Seleccionar</option>}{field.options.map(o=><option key={o} value={o}>{o||"Seleccionar"}</option>)}
      </select>:<input className={input} name={field.key} type={field.type||"text"} defaultValue={value}
       inputMode={field.key==="dni"?"numeric":undefined} min={field.type==="number"?"0":undefined}
       step={field.type==="number"?"any":undefined} required={required}/>}
     </label>})}</div>
   </fieldset>)}
   <fieldset><legend className="mb-3 w-full border-b border-border pb-2 text-sm font-black">Condiciones económicas y fechas de la venta</legend>
    <div className="grid gap-3 sm:grid-cols-2">
     <label className={label}>Modalidad<select name="operation_type" className={input} defaultValue={sale?.operation_type||"financiacion"}><option value="financiacion">Financiación</option><option value="directa">Directa</option></select></label>
     <label className={label}>Valor del vehículo ($)<input className={input} type="number" name="price" min="0" step="0.01" defaultValue={sale?.price||0}/></label>
     <label className={label}>Cuota mensual elegida ($) *<input className={input} type="number" min="1" step="0.01" value={monthly} onChange={e=>setMonthly(Number(e.target.value))} required/></label>
     <label className={label}>Gastos administrativos ($)<input className={input} type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(Number(e.target.value))}/></label>
     {!editing&&<label className={label}>Cuotas iniciales a registrar<input className={input} type="number" min="1" max="240" name="installment_count" defaultValue="15"/></label>}
     <label className={label}>Entrega de referencia desde cuota<input className={input} type="number" min="1" name="delivery_target_installment" defaultValue={sale?.delivery_target_installment||4}/></label>
     <label className={label}>Fecha de ingreso / cuota 1 *<input className={input} type="date" value={entryDate} onChange={e=>{setEntryDate(e.target.value);setSecondDue(nextMonth(e.target.value))}} required/></label>
     <label className={label}>Vencimiento de la cuota 2 *<input className={input} type="date" min={entryDate} value={secondDue} onChange={e=>setSecondDue(e.target.value)} required/></label>
     <label className={label+" sm:col-span-2"}>Notas de la operación<textarea className={input} name="notes" rows={2} defaultValue={sale?.notes||""}/></label>
    </div>
   </fieldset>
   <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
    <div><p className="text-xs text-muted-foreground">Primera cuota, con gastos administrativos</p><p className="text-xl font-black">{money(monthly+fee)}</p></div>
    <p className="text-xs text-muted-foreground">Cuota mensual: {money(monthly)} · Gastos: {money(fee)}</p>
   </div>
   <div className="flex flex-wrap justify-end gap-2">
    <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-3 text-sm font-semibold">Cancelar</button>
    <button disabled={busy} type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground disabled:opacity-60">{editing?<Save size={18}/>:<ClipboardCheck size={18}/>}
     {busy?"Guardando…":editing?"Guardar cambios de administración":"Registrar venta y generar solicitud"}
    </button>
   </div>
  </form>
 </section>;
}
