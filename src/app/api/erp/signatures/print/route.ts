import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid, safePrintHtml, serviceClient } from "@/lib/erp/signing";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get("request_id");
 if(!isUuid(id))return NextResponse.json({error:"Solicitud inválida"},{status:400});
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:"Iniciá sesión"},{status:401});
 const {data:entry,error:readError}=await db.from("erp_signing_requests")
  .select("id,sale_id,status,snapshot_text,snapshot_sha256,signed_at,issued_at,signer_name,signer_document,signature_path,selfie_path,signature_sha256,selfie_sha256,evidence_sha256,consent_marketing,consent_data,signer_ip")
  .eq("id",id).maybeSingle();
 if(readError||!entry)return NextResponse.json({error:"No autorizado o registro inexistente"},{status:404});
 const {data:access}=await db.rpc("erp_can_access_sale",{p_sale:entry.sale_id});
 if(access!==true)return NextResponse.json({error:"No autorizado"},{status:403});
 if(entry.status!=="firmado")return NextResponse.json({error:"El cliente todavía no completó la firma"},{status:409});
 const store=serviceClient().storage.from("erp-firmas");
 const [sign,selfie]=await Promise.all([
  entry.signature_path?store.createSignedUrl(entry.signature_path,120):Promise.resolve({data:null,error:null}),
  entry.selfie_path?store.createSignedUrl(entry.selfie_path,120):Promise.resolve({data:null,error:null})
 ]);
 const audit=[
  "CONSTANCIA DE FIRMA ELECTRÓNICA Y EVIDENCIAS",
  "Titular: "+entry.signer_name+" — DNI: "+entry.signer_document,
  "Fecha de emisión: "+entry.issued_at,
  "Fecha de aceptación: "+entry.signed_at,
  "Hash SHA-256 del documento: "+entry.snapshot_sha256,
  "Hash SHA-256 de la firma: "+entry.signature_sha256,
  "Hash SHA-256 de la selfie: "+entry.selfie_sha256,
  "Hash SHA-256 de la evidencia: "+entry.evidence_sha256,
  "Aceptó tratamiento de selfie para evidencia contractual: "+(entry.consent_data?"Sí":"No"),
  "Autorizó uso comercial de imagen (independiente): "+(entry.consent_marketing?"Sí":"No"),
  "IP indicativa: "+(entry.signer_ip||"No registrada"),
  "La firma manuscrita digitalizada y la selfie constituyen evidencia de firma electrónica,",
  "NO una firma digital basada en certificado de certificador licenciado."
 ].join("\n");
 const html=safePrintHtml("Contrato de adhesión — Valle Automotores",entry.snapshot_text,audit,sign.data?.signedUrl,selfie.data?.signedUrl);
 return new NextResponse(html,{headers:{
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options":"nosniff"
 }});
}
