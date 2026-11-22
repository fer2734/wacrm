import "server-only";
import { createClient as createSupabaseAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { VALLE_CONTRACT_TEXT, VALLE_CONTRACT_VERSION } from "@/lib/erp/contract-terms";

export const PRIVATE_PROOF_BUCKET = "erp-comprobantes";
export const PRIVATE_SIGNATURE_BUCKET = "erp-firmas";

export function serviceClient(): SupabaseClient {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Credenciales privadas de Supabase no configuradas");
  return createSupabaseAdmin(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function sha256(input:string|Buffer):string{
 return createHash("sha256").update(input).digest("hex");
}
export function newToken():string{return randomBytes(32).toString("base64url")}
export function validToken(value:unknown):value is string {
 return typeof value==="string"&&/^[a-zA-Z0-9_-]{43}$/.test(value);
}
export function isUuid(value:unknown):value is string{
 return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function validDoc(value:unknown):boolean{
 return typeof value==="string"&&/^[0-9]{7,11}$/.test(value.replace(/[^0-9]/g,""));
}
export const safeText=(v:unknown,max=300)=>String(v??"").trim().slice(0,max);
export const escapeHtml=(v:unknown)=>String(v??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]||x));

type ContractSettings={company_name:string;company_cuit:string;company_address:string;representative:string};
type ContractSale={id:string;vehicle_description:string;vehicle_type:string;operation_type:string;price:number;installment_amount:number;admin_fee:number;entry_date:string|null;second_due_date:string|null;delivery_target_installment:number};
export function buildContract(sale:ContractSale, application:Record<string,unknown>, settings:ContractSettings){
 const company=safeText(settings.company_name,150);
 const cuit=safeText(settings.company_cuit,25);
 const address=safeText(settings.company_address,240);
 if(!company||!cuit||!address)throw new Error("Administración debe completar razón social, CUIT y domicilio legal en Configuración del contrato");
 const name=safeText(application.full_name,180);
 const dni=safeText(application.dni,20);
 const phone=safeText(application.phone,40);
 if(name.length<3||!validDoc(dni)||phone.length<6)throw new Error("Completá nombre, DNI y teléfono en la solicitud de adhesión");
 const currency=(x:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(x||0));
 const specific=[
  "VALLE AUTOMOTORES — SOLICITUD DE ADHESIÓN Y CONDICIONES PARTICULARES",
  "Versión del contrato: "+VALLE_CONTRACT_VERSION,
  "EMPRESA: "+company+" — CUIT: "+cuit+" — DOMICILIO LEGAL: "+address,
  "REPRESENTANTE DE LA EMPRESA: "+safeText(settings.representative,180),
  "IDENTIFICADOR DE OPERACIÓN: "+sale.id,
  "SOLICITANTE: "+name+" — DNI: "+dni+" — TELÉFONO: "+phone,
  "DOMICILIO: "+safeText(application.address,240)+" — LOCALIDAD: "+safeText(application.city,120)+" — PROVINCIA: "+safeText(application.province,100),
  "VEHÍCULO: "+sale.vehicle_description+" — TIPO: "+sale.vehicle_type+" — MODALIDAD: "+sale.operation_type,
  "VALOR INFORMADO: "+currency(sale.price)+" — CUOTA ELEGIDA: "+currency(sale.installment_amount),
  "GASTOS ADMINISTRATIVOS: "+currency(sale.admin_fee)+" — TOTAL CUOTA 1: "+currency(Number(sale.installment_amount)+Number(sale.admin_fee)),
  "FECHA DE INGRESO / CUOTA 1: "+(sale.entry_date||"—")+" — VENCIMIENTO CUOTA 2: "+(sale.second_due_date||"—"),
  "ENTREGA PACTADA DESDE CUOTA: "+sale.delivery_target_installment+" (sujeta a las condiciones contractuales)",
  "DATOS DE LA SOLICITUD"
 ];
 for(const [key,value] of Object.entries(application).sort(([a],[b])=>a.localeCompare(b))){
  const clean=safeText(value,800);
  if(clean)specific.push(key+": "+clean);
 }
 // Se completa únicamente el campo 1.1, originalmente dejado en blanco en el PDF.
 const start=VALLE_CONTRACT_TEXT.indexOf("1.1.");
 const end=VALLE_CONTRACT_TEXT.indexOf("1.2. Solicitante:");
 if(start<0||end<0||end<start)throw new Error("La plantilla contractual no se pudo validar");
 const replacement="1.1. Empresa: "+company+", CUIT N.º "+cuit+", con domicilio legal en "+address+
  ", provincia de Río Negro, República Argentina, debidamente inscripta ante el Registro Público correspondiente,\n"+
  "en adelante denominada «LA EMPRESA», es la sociedad que ejerce los derechos y asume las obligaciones\n"+
  "establecidas en las presentes Condiciones Generales frente a cada Solicitante y Suscriptor, según corresponda.\n";
 const terms=VALLE_CONTRACT_TEXT.slice(0,start)+replacement+VALLE_CONTRACT_TEXT.slice(end);
 const full=specific.join("\n")+"\n\nCONDICIONES GENERALES DE CONTRATACIÓN — TEXTO ÍNTEGRO DEL INSTRUMENTO ADJUNTO\n\n"+terms;
 return {text:full,sha256:sha256(full),version:VALLE_CONTRACT_VERSION};
}

export function attachmentType(bytes:Buffer,type:string):boolean{
 if(type==="application/pdf")return bytes.subarray(0,5).toString("ascii")==="%PDF-";
 if(type==="image/jpeg")return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(type==="image/png")return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(type==="image/webp")return bytes.subarray(0,4).toString("ascii")==="RIFF"&&bytes.subarray(8,12).toString("ascii")==="WEBP";
 return false;
}
export async function checkedUpload(file:File,onlyImages=false,limit=10*1024*1024):Promise<{bytes:Buffer;mime:string}>{
 if(!(file instanceof File)||file.size<100||file.size>limit)throw new Error("Archivo vacío o demasiado grande");
 const mime=file.type.toLowerCase();
 if(!["image/jpeg","image/png","image/webp",...(onlyImages?[]:["application/pdf"])].includes(mime))throw new Error("Formato no permitido: usá JPG, PNG, WEBP"+(onlyImages?"":" o PDF"));
 const bytes=Buffer.from(await file.arrayBuffer());
 if(!attachmentType(bytes,mime))throw new Error("Contenido del archivo inválido");
 return {bytes,mime};
}
export function safePrintHtml(title:string,content:string,more:string,signatureUrl?:string,selfieUrl?:string):string{
 // Todas las entradas variables deben pasarse por escapeHtml.
 const im=(u?:string,caption?:string)=>u?'<div class="evidence"><img src="'+escapeHtml(u)+'" alt="'+escapeHtml(caption)+'"><small>'+escapeHtml(caption)+'</small></div>':"";
 return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta name="referrer" content="no-referrer"><title>'+escapeHtml(title)+'</title><style>body{max-width:860px;margin:25px auto;padding:20px;font:13px/1.55 Arial,sans-serif;color:#141414}h1{font-size:23px;border-bottom:2px solid #222;padding-bottom:12px}.terms{white-space:pre-wrap;overflow-wrap:anywhere}.audit{margin:22px 0;padding:16px;border:1px solid #999;background:#f4f4f4;white-space:pre-wrap}.photos{display:flex;gap:20px}.evidence{max-width:280px}.evidence img{max-width:100%;max-height:220px;object-fit:contain}.evidence small{display:block}@media print{body{padding:0;margin:0;max-width:none}.audit{break-inside:avoid}}</style></head><body><h1>'+escapeHtml(title)+'</h1><div class="terms">'+escapeHtml(content)+'</div><div class="audit">'+escapeHtml(more)+'</div><div class="photos">'+im(signatureUrl,"Firma electrónica")+" "+im(selfieUrl,"Selfie adjunta a la firma")+'</div></body></html>';
}
