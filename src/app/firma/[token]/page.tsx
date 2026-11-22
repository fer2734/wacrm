import { SignatureExperience } from "@/components/erp/signature-experience";
export const metadata={title:"Firma electrónica | Valle Automotores",robots:{index:false,follow:false}};
export default async function FirmaPage({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 return <SignatureExperience token={token}/>;
}
