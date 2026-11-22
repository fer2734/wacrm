"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Camera, CheckCircle2, Eraser, FileSignature, ShieldCheck } from "lucide-react";

type DocumentView={contract:string;hash:string;signer_name:string;expires_at:string};
type Receipt={receipt_id:string;hash:string;signed_at:string};
export function SignatureExperience({token}:{token:string}){
 const [document,setDocument]=useState<DocumentView|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [sending,setSending]=useState(false);
 const [name,setName]=useState("");
 const [dni,setDni]=useState("");
 const [selfie,setSelfie]=useState<File|null>(null);
 const [drawn,setDrawn]=useState(false);
 const [accept,setAccept]=useState(false);
 const [personal,setPersonal]=useState(false);
 const [marketing,setMarketing]=useState("no");
 const [receipt,setReceipt]=useState<Receipt|null>(null);
 const canvas=useRef<HTMLCanvasElement|null>(null);
 const pen=useRef(false);
 useEffect(()=>{
  let alive=true;
  void fetch("/api/erp/signatures/public?token="+encodeURIComponent(token),{cache:"no-store"})
   .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||"Enlace inválido");return j as DocumentView})
   .then(j=>{if(alive){setDocument(j);setName(j.signer_name)}})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:"No se pudo consultar el contrato")})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[token]);
 useEffect(()=>{
  const c=canvas.current;if(!c)return;
  const ctx=c.getContext("2d");if(!ctx)return;
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,c.width,c.height);
  ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=3.5;ctx.strokeStyle="#182b52";
 },[document]);
 const pos=(e:PointerEvent<HTMLCanvasElement>)=>{
  const c=canvas.current!;const b=c.getBoundingClientRect();
  return {x:(e.clientX-b.left)*c.width/b.width,y:(e.clientY-b.top)*c.height/b.height};
 };
 const begin=(e:PointerEvent<HTMLCanvasElement>)=>{
  if(sending)return;
  e.preventDefault();const c=canvas.current!;c.setPointerCapture(e.pointerId);pen.current=true;
  const p=pos(e);const ctx=c.getContext("2d")!;ctx.beginPath();ctx.moveTo(p.x,p.y);
 };
 const move=(e:PointerEvent<HTMLCanvasElement>)=>{
  if(!pen.current)return;e.preventDefault();const p=pos(e);const ctx=canvas.current!.getContext("2d")!;
  ctx.lineTo(p.x,p.y);ctx.stroke();setDrawn(true);
 };
 const stop=()=>{pen.current=false};
 const clear=()=>{const c=canvas.current;if(!c)return;const ctx=c.getContext("2d");if(!ctx)return;ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle="#182b52";setDrawn(false)};
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(sending)return;setError("");
  if(!drawn||!selfie||!accept||!personal){setError("Completá la firma, la selfie y las dos aceptaciones obligatorias");return}
  const c=canvas.current;if(!c)return;
  setSending(true);
  try{
   const png=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error("No se pudo procesar la firma")),"image/png"));
   const fd=new FormData();
   fd.set("token",token);fd.set("name",name.trim());fd.set("dni",dni);
   fd.set("consent_data",String(personal));fd.set("consent_contract",String(accept));
   fd.set("consent_marketing",String(marketing==="si"));
   fd.set("signature",new File([png],"firma.png",{type:"image/png"}));
   fd.set("selfie",selfie);
   const res=await fetch("/api/erp/signatures/public",{method:"POST",body:fd,cache:"no-store"});
   const json=await res.json();
   if(!res.ok)throw new Error(json.error||"No se pudo firmar");
   setReceipt({receipt_id:json.receipt_id,hash:json.hash,signed_at:json.signed_at});
   setDocument(null);setSelfie(null);
  }catch(e){setError(e instanceof Error?e.message:"Error al registrar la aceptación")}
  finally{setSending(false)}
 }
 if(loading)return <main className="mx-auto max-w-4xl p-6 text-sm text-slate-600">Verificando el enlace privado de firma…</main>;
 if(receipt)return <main className="mx-auto mt-12 max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-center text-slate-900 shadow-lg">
  <CheckCircle2 className="mx-auto mb-4 size-14 text-emerald-600"/>
  <h1 className="text-2xl font-extrabold">Contrato aceptado</h1>
  <p className="mt-3 text-sm text-slate-700">Tu firma electrónica y la selfie fueron recibidas. El enlace ya no puede utilizarse nuevamente. La empresa conserva la constancia y las evidencias.</p>
  <p className="mt-5 break-all rounded-xl bg-slate-100 p-3 text-left text-xs"><b>Constancia:</b> {receipt.receipt_id}<br/><b>Fecha:</b> {new Date(receipt.signed_at).toLocaleString("es-AR")}<br/><b>SHA-256 de evidencia:</b> {receipt.hash}</p>
 </main>;
 if(!document)return <main className="mx-auto mt-10 max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-slate-900"><h1 className="text-xl font-bold">Enlace no disponible</h1><p className="mt-2 text-sm">{error||"Solicitá un nuevo enlace al asesor."}</p></main>;
 return <main className="mx-auto max-w-4xl space-y-4 px-3 py-6 text-slate-900 sm:px-6">
  <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg"><div className="flex items-center gap-3"><div className="rounded-xl bg-yellow-400 p-2 text-slate-950"><FileSignature size={25}/></div>
   <div><p className="text-xs font-bold uppercase tracking-wider text-yellow-300">Valle Automotores</p><h1 className="text-xl font-black sm:text-2xl">Firma electrónica de adhesión</h1></div></div>
   <p className="mt-3 text-sm text-slate-200">Revisá las condiciones de contratación completas y confirmá tu aceptación mediante tu firma y una selfie.</p>
  </header>
  <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
   <div className="mb-3 flex flex-wrap justify-between gap-2"><h2 className="text-lg font-extrabold">Documento para firmar</h2><span className="text-xs text-slate-500">Vence: {new Date(document.expires_at).toLocaleString("es-AR")}</span></div>
   <p className="mb-3 text-xs text-slate-600">El contenido que estás viendo queda congelado al generar este enlace. Contiene las condiciones particulares y el contrato completo.</p>
   <div className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-300 bg-slate-50 p-4 font-mono text-[12px] leading-relaxed">{document.contract}</div>
   <p className="mt-2 break-all text-[10px] text-slate-500">Huella digital SHA-256 del documento: {document.hash}</p>
  </section>
  <form onSubmit={submit} className="space-y-4">
   <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <h2 className="mb-3 text-lg font-extrabold">1. Confirmá tus datos</h2>
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-semibold">Nombre y apellido<input className="w-full rounded-xl border border-slate-300 p-3 text-base" required minLength={3} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="space-y-1 text-sm font-semibold">DNI del titular<input className="w-full rounded-xl border border-slate-300 p-3 text-base" required inputMode="numeric" pattern="[0-9 .-]{7,16}" value={dni} onChange={e=>setDni(e.target.value)} placeholder="Ingresá tu DNI"/></label></div>
   </section>
   <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-extrabold">2. Dibujá tu firma</h2><button type="button" onClick={clear} className="flex items-center gap-1 text-xs font-semibold text-blue-700"><Eraser size={15}/> Borrar</button></div>
    <p className="mb-2 text-sm text-slate-600">Firmá dentro del recuadro usando el dedo o el mouse.</p>
    <canvas ref={canvas} width={900} height={260} aria-label="Área para dibujar tu firma" className="h-[190px] w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white" onPointerDown={begin} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}/>
   </section>
   <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <h2 className="mb-2 flex items-center gap-2 text-lg font-extrabold"><Camera size={19}/> 3. Sacate una selfie</h2>
    <p className="mb-3 text-sm text-slate-600">Tomá una foto frontal donde se vea claramente tu rostro. Se guarda de forma privada como evidencia de la aceptación; <b>no realiza reconocimiento facial ni verificación biométrica automática</b>.</p>
    <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" required className="block w-full rounded-xl border border-slate-300 p-3 text-sm" onChange={e=>setSelfie(e.target.files?.[0]||null)}/>
    {selfie&&<p className="mt-2 text-xs text-slate-600">Seleccionada: {selfie.name}</p>}
   </section>
   <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-6">
    <h2 className="text-lg font-extrabold">4. Aceptaciones</h2>
    <label className="flex items-start gap-3"><input type="checkbox" checked={accept} onChange={e=>setAccept(e.target.checked)} className="mt-1 size-5" required/><span>Leí el contrato y la solicitud de adhesión y acepto sus términos mediante firma electrónica.</span></label>
    <label className="flex items-start gap-3"><input type="checkbox" checked={personal} onChange={e=>setPersonal(e.target.checked)} className="mt-1 size-5" required/><span>Consiento la captura y conservación privada de mi selfie, firma y datos de la operación con la finalidad de documentar esta aceptación.</span></label>
    <fieldset><legend className="mb-2 font-semibold">Autorización de imagen y voz para publicidad (opcional, independiente):</legend>
     <div className="flex gap-4"><label className="flex gap-2"><input type="radio" checked={marketing==="si"} onChange={()=>setMarketing("si")}/> Sí autorizo</label><label className="flex gap-2"><input type="radio" checked={marketing==="no"} onChange={()=>setMarketing("no")}/> No autorizo</label></div>
    </fieldset>
   </section>
   {error&&<p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
   <button type="submit" disabled={sending} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 p-4 text-base font-extrabold text-white disabled:opacity-60"><ShieldCheck size={19}/>{sending?"Registrando aceptación…":"Firmar y enviar mi contrato"}</button>
   <p className="pb-8 text-center text-xs text-slate-600">El enlace queda inutilizado luego de registrar la firma. Esta modalidad es una firma electrónica; no equivale a una firma digital certificada bajo la Ley 25.506.</p>
  </form>
 </main>;
}
