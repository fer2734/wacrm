export type Field = { key:string; label:string; type?:string; wide?:boolean; options?:string[] };
export const sections: {title:string;fields:Field[]}[]=[
 {title:"Datos de la solicitud",fields:[
  {key:"contract_number",label:"Contrato N.º"},{key:"receipt_number",label:"Recibo o factura N.º"},
  {key:"administration_delivery",label:"Fecha de entrega a Administración",type:"date"},
  {key:"management_delivery",label:"Fecha de entrega a Gerencia",type:"date"}]},
 {title:"Características del plan",fields:[
  {key:"vehicle_category",label:"Unidad",options:["Auto 0 km","Auto usado","Camioneta 0 km","Camioneta usada","Moto 0 km","Moto usada"]},
  {key:"brand",label:"Marca"},{key:"model",label:"Modelo"},{key:"model_year",label:"Año",type:"number"},
  {key:"agreed_delivery",label:"Entrega pactada",wide:true},
  {key:"trade_in",label:"¿Entrega unidad usada?",options:["No","Sí"]},
  {key:"trade_brand",label:"Marca de la unidad entregada"},{key:"trade_model",label:"Modelo de la unidad entregada"},
  {key:"trade_year",label:"Año de la unidad entregada"},{key:"trade_km",label:"Kilómetros",type:"number"},
  {key:"observations",label:"Observaciones",wide:true}]},
 {title:"Persona física / jurídica",fields:[
  {key:"full_name",label:"Nombre y apellido / Razón social",wide:true},
  {key:"dni",label:"D.N.I."},{key:"cuil",label:"CUIL / CUIT"},
  {key:"birth_date",label:"Fecha de nacimiento",type:"date"},{key:"nationality",label:"Nacionalidad"},
  {key:"address",label:"Domicilio"},{key:"postal_code",label:"Código postal"},
  {key:"province",label:"Provincia"},{key:"city",label:"Localidad"},
  {key:"marital_status",label:"Estado civil",options:["","Soltero/a","Casado/a","Conviviente","Divorciado/a","Viudo/a"]},
  {key:"email",label:"Correo electrónico",type:"email"},
  {key:"phone",label:"Teléfono particular",type:"tel"},{key:"additional_phone",label:"Teléfono adicional",type:"tel"},
  {key:"spouse_name",label:"Nombre del cónyuge"},{key:"spouse_cuil",label:"CUIL del cónyuge"},
  {key:"spouse_birth",label:"Fecha de nacimiento del cónyuge",type:"date"},{key:"spouse_nationality",label:"Nacionalidad del cónyuge"}]},
 {title:"Datos laborales",fields:[
  {key:"occupation",label:"Actividad laboral",wide:true},
  {key:"employer",label:"Empresa / lugar de empleo",wide:true},
  {key:"net_income",label:"Ingresos netos ($)",type:"number"},{key:"seniority",label:"Antigüedad"},
  {key:"work_address",label:"Domicilio laboral",wide:true},
  {key:"salesperson",label:"Nombre del vendedor",wide:true}]}
];
