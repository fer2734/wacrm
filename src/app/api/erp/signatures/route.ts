import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildContract, isUuid, newToken, serviceClient, sha256 } from "@/lib/erp/signing";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}})}
export async function POST(req:NextRequest){
 try{
  const db=await createClient();const {data:{user}}=await db.auth.getUser();
  if(!user)return json({error:"Iniciá sesión para preparar el contrato"},401);
  const body=await req.json().catch(()=>null);
  const saleId=body?.sale_id;
  if(!isUuid(saleId))return json({error:"Venta inválida"},400);
  const {data:access,error:accessError}=await db.rpc("erp_can_access_sale",{p_sale:saleId});
  if(accessError||access!==true)return json({error:"No tenés permiso sobre esta venta"},403);
  const {data:sale,error:saleError}=await db.from("erp_sales")
   .select("id,account_id,customer_id,vehicle_description,vehicle_type,operation_type,price,installment_amount,admin_fee,entry_date,second_due_date,delivery_target_installment")
   .eq("id",saleId).single();
  if(saleError||!sale)return json({error:"No se encontró la venta"},404);
  const [appResult,settingsResult]=await Promise.all([
   db.from("erp_sale_applications").select("data").eq("sale_id",saleId).single(),
   db.from("erp_contract_settings").select("company_name,company_cuit,company_address,representative").eq("account_id",sale.account_id).maybeSingle()
  ]);
  if(appResult.error||!appResult.data)return json({error:"Primero completá y guardá la solicitud de adhesión"},400);
  if(settingsResult.error||!settingsResult.data)return json({error:"Administración debe configurar los datos de la empresa"},400);
  const {text,sha256:documentHash,version}=buildContract(sale,appResult.data.data as Record<string,unknown>,settingsResult.data);
  const admin=serviceClient();
  const {data:already}=await admin.from("erp_signing_requests").select("id").eq("sale_id",saleId).eq("status","firmado").limit(1);
  if(already?.length)return json({error:"Este contrato ya fue firmado. Para cambiar las condiciones hace falta un nuevo documento de modificación"},409);
  const {error:revokeError}=await admin.from("erp_signing_requests").update({status:"revocado"}).eq("sale_id",saleId).eq("status","pendiente");
  if(revokeError)throw revokeError;
  const token=newToken();
  const {data:created,error}=await admin.from("erp_signing_requests").insert({
   sale_id:saleId,account_id:sale.account_id,token_hash:sha256(token),status:"pendiente",
   expires_at:new Date(Date.now()+72*60*60*1000).toISOString(),
   snapshot_text:text,snapshot_sha256:documentHash,
   snapshot_data:{application:appResult.data.data,sale,company:settingsResult.data,version},
   issued_by:user.id
  }).select("id,expires_at").single();
  if(error)throw error;
  const configured=process.env.NEXT_PUBLIC_SITE_URL;
  if(!configured||!/^https:\/\//.test(configured))throw new Error("Configurá NEXT_PUBLIC_SITE_URL con el dominio HTTPS oficial");
  const base=new URL(configured);
  const link=new URL("/firma/"+token,base).toString();
  return json({link,request_id:created.id,expires_at:created.expires_at});
 }catch(e){
  return json({error:e instanceof Error?e.message:"No se pudo emitir el contrato"},500);
 }
}
