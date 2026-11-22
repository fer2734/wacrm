import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { checkedUpload, isUuid, PRIVATE_PROOF_BUCKET, serviceClient } from "@/lib/erp/signing";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}})}
export async function POST(req:NextRequest){
 let objectPath="";
 try{
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user)return reply({error:"Iniciá sesión"},401);
  const body=await req.formData();
  const saleId=body.get("sale_id");
  const kind=body.get("kind");
  const paymentId=body.get("payment_id");
  if(!isUuid(saleId))return reply({error:"Venta inválida"},400);
  if(!["comprobante","contrato","dni","ficha","otro"].includes(String(kind)))
   return reply({error:"Tipo de archivo inválido"},400);
  if(paymentId!==null&&paymentId!==""&&!isUuid(paymentId))return reply({error:"Pago inválido"},400);
  const {data:authorized,error:accessError}=await db.rpc("erp_can_access_sale",{p_sale:saleId});
  if(accessError||authorized!==true)return reply({error:"No autorizado para subir archivos a esta venta"},403);
  const {data:sale,error:saleError}=await db.from("erp_sales").select("account_id").eq("id",saleId).single();
  if(saleError||!sale)return reply({error:"Venta inexistente"},404);
  if(paymentId){
   const {data:payment}=await db.from("erp_payments").select("id").eq("id",paymentId).eq("sale_id",saleId).maybeSingle();
   if(!payment)return reply({error:"El pago no pertenece a la venta"},400);
  }
  const file=body.get("file");
  if(!(file instanceof File))return reply({error:"Elegí un archivo para adjuntar"},400);
  const {bytes,mime}=await checkedUpload(file);
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-90)||"archivo";
  objectPath=sale.account_id+"/"+saleId+"/"+randomUUID()+"-"+safeName;
  const admin=serviceClient();
  const {error:uploadError}=await admin.storage.from(PRIVATE_PROOF_BUCKET).upload(objectPath,bytes,{upsert:false,contentType:mime});
  if(uploadError)throw new Error("No se pudo adjuntar en almacenamiento: "+uploadError.message);
  const {data:created,error:insertError}=await admin.from("erp_documents").insert({
   account_id:sale.account_id,sale_id:saleId,payment_id:paymentId||null,
   kind,file_name:file.name,object_path:objectPath,mime_type:mime,file_size:bytes.length,created_by:user.id
  }).select("id").single();
  if(insertError){await admin.storage.from(PRIVATE_PROOF_BUCKET).remove([objectPath]);objectPath="";throw insertError}
  return reply({ok:true,document_id:created.id});
 }catch(e){
  return reply({error:e instanceof Error?e.message:"No se pudo adjuntar el archivo"},500);
 }
}
