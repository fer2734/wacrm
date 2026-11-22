import { NextRequest, NextResponse } from "next/server";
import { isUuid, checkedUpload, safeText, serviceClient, sha256, validToken } from "@/lib/erp/signing";
import { randomUUID } from "node:crypto";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}})}
function cleanDni(s:unknown){return String(s??"").replace(/[^0-9]/g,"")}
type SigningRow={id:string;account_id:string;sale_id:string;status:string;expires_at:string;snapshot_text:string;snapshot_sha256:string;snapshot_data:{application?:Record<string,unknown>};};
async function locate(token:string):Promise<SigningRow|null>{
 const db=serviceClient();
 const {data,error}=await db.from("erp_signing_requests")
  .select("id,account_id,sale_id,status,expires_at,snapshot_text,snapshot_sha256,snapshot_data")
  .eq("token_hash",sha256(token)).maybeSingle();
 if(error)throw error;
 return (data??null) as SigningRow|null;
}
function active(r:SigningRow|null){return !!r&&r.status==="pendiente"&&Date.parse(r.expires_at)>Date.now()}
export async function GET(req:NextRequest){
 try{
  const token=req.nextUrl.searchParams.get("token");
  if(!validToken(token))return reply({error:"Enlace inválido"},404);
  const row=await locate(token);
  if(!active(row))return reply({error:"Este enlace ya fue utilizado, revocado o venció. Solicitá uno nuevo a tu asesor."},410);
  const applicant=row!.snapshot_data.application||{};
  return reply({
   contract:row!.snapshot_text,
   hash:row!.snapshot_sha256,
   signer_name:safeText(applicant.full_name,180),
   expires_at:row!.expires_at
  });
 }catch{return reply({error:"No se pudo abrir el contrato"},500)}
}
export async function POST(req:NextRequest){
 let paths:string[]=[];
 try{
  const form=await req.formData();
  const token=form.get("token"),name=safeText(form.get("name"),180),dni=cleanDni(form.get("dni"));
  if(!validToken(token))return reply({error:"Enlace inválido"},404);
  if(form.get("consent_data")!=="true"||form.get("consent_contract")!=="true")
   return reply({error:"Confirmá el consentimiento y la aceptación del contrato"},400);
  const marketing=form.get("consent_marketing")==="true";
  const row=await locate(token);
  if(!active(row))return reply({error:"Enlace vencido o ya utilizado"},410);
  const applicant=row!.snapshot_data.application||{};
  if(cleanDni(applicant.dni)!==dni||dni.length<7)return reply({error:"El DNI no coincide con la solicitud de adhesión"},400);
  if(name.length<3||name.toLocaleLowerCase("es-AR")!==safeText(applicant.full_name,180).toLocaleLowerCase("es-AR"))
   return reply({error:"Ingresá el nombre y apellido tal como figura en el contrato"},400);
  const signatureFile=form.get("signature"),selfieFile=form.get("selfie");
  if(!(signatureFile instanceof File)||!(selfieFile instanceof File))return reply({error:"Falta firma manuscrita o selfie"},400);
  if(signatureFile.type!=="image/png")return reply({error:"La firma debe ser una imagen PNG"},400);
  const [sign,selfie]=await Promise.all([
   checkedUpload(signatureFile,true,1_500_000),checkedUpload(selfieFile,true,6_000_000)
  ]);
  // Evita firmas vacías o pequeñas aunque el cliente haya presionado el botón.
  if(sign.bytes.byteLength<3000)return reply({error:"Dibujá tu firma dentro del recuadro"},400);
  if(selfie.bytes.byteLength<5000)return reply({error:"Tomá una selfie nítida"},400);
  const db=serviceClient();
  const dir=row!.account_id+"/"+row!.sale_id+"/"+row!.id+"/";
  const pSign=dir+randomUUID()+".png";
  const ext=selfie.mime==="image/png"?"png":selfie.mime==="image/webp"?"webp":"jpg";
  const pSelfie=dir+randomUUID()+"."+ext;
  const storage=db.storage.from("erp-firmas");
  for(const [path,buffer,mime] of [[pSign,sign.bytes,sign.mime],[pSelfie,selfie.bytes,selfie.mime]] as const){
   const {error}=await storage.upload(path,buffer,{contentType:mime,upsert:false,cacheControl:"0"});
   if(error)throw new Error("No se pudieron guardar las evidencias: "+error.message);
   paths.push(path);
  }
  const signedAt=new Date().toISOString();
  const signHash=sha256(sign.bytes),selfieHash=sha256(selfie.bytes);
  const auditHash=sha256([row!.snapshot_sha256,signHash,selfieHash,name,dni,signedAt,marketing?"si":"no"].join("|"));
  const rawIp=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"";
  const safeIp=/^[0-9a-f.:]{3,50}$/i.test(rawIp)?rawIp:null;
  const {data:saved,error}=await db.from("erp_signing_requests").update({
   status:"firmado",signed_at:signedAt,signer_name:name,signer_document:dni,
   signature_path:pSign,selfie_path:pSelfie,signature_sha256:signHash,selfie_sha256:selfieHash,
   evidence_sha256:auditHash,signer_ip:safeIp,
   signer_user_agent:safeText(req.headers.get("user-agent"),300),
   consent_data:true,consent_contract:true,consent_marketing:marketing
  }).eq("id",row!.id).eq("status","pendiente")
   .gt("expires_at",signedAt).select("id").maybeSingle();
  if(error)throw error;
  if(!saved){await storage.remove(paths);paths=[];return reply({error:"Este enlace ya se utilizó"},410)}
  return reply({ok:true,receipt_id:row!.id,hash:auditHash,signed_at:signedAt});
 }catch(e){
  if(paths.length){try{await serviceClient().storage.from("erp-firmas").remove(paths)}catch{}}
  return reply({error:e instanceof Error?e.message:"No se pudo completar la firma"},500);
 }
}
