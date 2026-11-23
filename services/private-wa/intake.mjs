const clean = (v, n=200) => String(v || '').trim().slice(0,n);
const norm = v => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const brandsDefault = {
 Honda:['Wave 110','GLH 150','XR 150','XR 250'],
 Motomel:['B110','S2 150','Skua 150','Skua 250'],
 Gilera:['Smash 110','VC 150','Sahel 150'],
 Zanella:['ZB 110','ZR 150','RX 150'],
 Corven:['Energy 110','Triax 150','Hunter 150'],
 Keller:['KN110-8','Stratus 150'],
 Mondial:['LD 110 Max','RD 150']
};
const defaultWelcome='¡Bienvenido/a a Valle Automotores! Estamos en General Roca, Río Negro. ¿Qué estás buscando?';
const defaultTransfer='¡Gracias! Registramos tu consulta y la derivamos a tu asesor de Valle Automotores.';
const lines = arr => arr.map((v,i) => (i+1)+'. '+v).join('\n');
function selected(input, arr) {
 const v=norm(input), number=Number(v);
 if (/^\d+$/.test(v) && number>=1 && number<=arr.length) return arr[number-1];
 return arr.find(x => norm(x)===v) || null;
}
function config(s) {
 const raw=s.config||{};
 const brands=raw.brands && typeof raw.brands==='object' && !Array.isArray(raw.brands) ? raw.brands : brandsDefault;
 return { brands, brandNames:Object.keys(brands).slice(0,9), prompts: raw.prompts && typeof raw.prompts==='object' && !Array.isArray(raw.prompts) ? raw.prompts : {},
  welcome:clean(raw.welcome||defaultWelcome,400),
  transfer:clean(raw.transfer||defaultTransfer,400) };
}
function builtInQuestion(s, b) {
 const c=config(s);
 switch(b.step) {
  case 'vehicle':return c.welcome+'\n'+lines(['MOTO','AUTO','CAMIONETA'])+'\nRespondé únicamente 1, 2 o 3.';
  case 'brand':return b.vehicle==='MOTO' ? '¿Qué marca de moto buscás?\n'+lines([...c.brandNames,'OTRA']) :
    '¿Qué marca de '+b.vehicle.toLowerCase()+' buscás? Escribí la marca o OTRA.';
  case 'brand_other':return '¿Qué otra marca buscás?';
  case 'model':return b.vehicle==='MOTO' && c.brands[b.brand] ?
    '¿Qué modelo de '+b.brand+' buscás?\n'+lines([...c.brands[b.brand].slice(0,9),'OTRA']) :
    '¿Qué modelo de '+b.brand+' te interesa?';
  case 'model_other':return '¿Qué otro modelo te interesa?';
  case 'cc':return b.vehicle==='MOTO' ? '¿Qué cilindrada preferís?\n'+lines(['110 cc','125 cc','150 cc','200 cc','250 cc','300 cc o más','OTRA']) :
    '¿Qué cilindrada o motorización buscás? Si no sabés, respondé Indistinto.';
  case 'cc_other':return 'Indicá la cilindrada que estás buscando.';
  case 'capital':return '¿Tenés capital para una entrega?\n'+lines(['SÍ','NO']);
  case 'capital_amount':return '¿Con cuánto dinero contás para la entrega? Escribí el importe aproximado.';
  case 'operation':return '¿Buscás financiación o compra directa?\n'+lines(['FINANCIACIÓN','COMPRA DIRECTA']);
  case 'quota':return b.vehicle==='MOTO' ? '¿Qué cuota mensual te gustaría pagar?\n'+lines(['$300.000','$500.000','MÁS']) :
    '¿Qué cuota mensual te gustaría pagar? Indicá el importe, sin mínimo preestablecido.';
  case 'quota_other':return '¿Qué importe mensual te gustaría pagar?';
  case 'name':return '¿Cuál es tu nombre?';
  case 'locality':return '¿De qué localidad sos?';
 }
 return '';
}
function advance(s,b,value) {
 const c=config(s), v=clean(value,140);
 if(!v)return false;
 const pick=arr=>selected(v,arr);
 switch(b.step){
 case 'vehicle':{const x=pick(['MOTO','AUTO','CAMIONETA']);if(!x)return false;b.vehicle=x;b.step='brand';break;}
 case 'brand':{
   if(b.vehicle==='MOTO'){const x=pick([...c.brandNames,'OTRA']);if(!x)return false;if(x==='OTRA'){b.step='brand_other';break;}b.brand=x;}
   else b.brand=v;
   b.step='model';break;
 }
 case 'brand_other':b.brand=v;b.step='model_other';break;
 case 'model':{
  if(b.vehicle==='MOTO' && c.brands[b.brand]){const x=pick([...c.brands[b.brand].slice(0,9),'OTRA']);if(!x)return false;if(x==='OTRA'){b.step='model_other';break;}b.model=x;}
  else b.model=v;
  b.step='cc';break;
 }
 case 'model_other':b.model=v;b.step='cc';break;
 case 'cc':{
  if(b.vehicle==='MOTO'){const x=pick(['110 cc','125 cc','150 cc','200 cc','250 cc','300 cc o más','OTRA']);if(!x)return false;if(x==='OTRA'){b.step='cc_other';break;}b.cc=x;}
  else b.cc=v;
  b.step='capital';break;
 }
 case 'cc_other':b.cc=v;b.step='capital';break;
 case 'capital':{const x=pick(['SÍ','NO']);if(!x)return false;b.capital=x;b.step=x==='SÍ'?'capital_amount':'operation';break;}
 case 'capital_amount':b.capitalAmount=v;b.step='operation';break;
 case 'operation':{const x=pick(['FINANCIACIÓN','COMPRA DIRECTA']);if(!x)return false;b.operation=x;b.step=x==='FINANCIACIÓN'?'quota':'name';break;}
 case 'quota':{
  if(b.vehicle==='MOTO'){const x=pick(['$300.000','$500.000','MÁS']);if(!x)return false;if(x==='MÁS'){b.step='quota_other';break;}b.quota=x;}
  else b.quota=v;
  b.step='name';break;
 }
 case 'quota_other':b.quota=v;b.step='name';break;
 case 'name':b.name=v;b.step='locality';break;
 case 'locality':b.locality=v;b.step='completed';break;
 default:return false;
 }
 return true;
}

function question(s,b) {
  const base = builtInQuestion(s,b);
  const override = config(s).prompts?.[b.step];
  if (typeof override !== 'string' || !override.trim()) return base;
  const label = override.trim().slice(0,450);
  const menuAt = base.indexOf('\n1.');
  return menuAt >= 0 ? label + base.slice(menuAt) : label;
}
export { question, advance, config };
