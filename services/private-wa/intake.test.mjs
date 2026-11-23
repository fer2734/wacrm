import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, question } from './intake.mjs';
const session = { config: {} };
function play(answers, custom=session) {
 const b={step:'vehicle'};
 for(const input of answers) assert.equal(advance(custom,b,input),true,`Se rechazó ${input} en ${b.step}`);
 return b;
}
test('solo tres opciones iniciales',()=>{
 const b={step:'vehicle'};
 assert.match(question(session,b),/General Roca/);
 assert.match(question(session,b),/1\. MOTO/);
 assert.equal(advance(session,b,'barco'),false);
});
test('moto: marca, cilindrada, capital, cuota abierta y datos; sin modelo',()=>{
 const b=play(['MOTO','Honda','110 cc','SÍ','400000','FINANCIACIÓN','250000','Laura','General Roca']);
 assert.equal(b.step,'completed');
 assert.equal(b.model,undefined);
 assert.deepEqual([b.vehicle,b.brand,b.cc,b.capitalAmount,b.quota],['MOTO','Honda','110 cc','400000','250000']);
});
test('moto marca OTRA y cilindrada OTRA',()=>{
 const b=play(['1','OTRA','Benelli','OTRA','302 cc','NO','COMPRA DIRECTA','Sol','Allen']);
 assert.equal(b.step,'completed');
 assert.deepEqual([b.brand,b.cc,b.model],['Benelli','302 cc',undefined]);
});
test('auto pregunta año, no cilindrada ni motorización',()=>{
 const b=play(['AUTO','Toyota','Corolla','2018 a 2022','NO','FINANCIACIÓN','100000','Nico','Neuquén']);
 assert.equal(b.step,'completed');assert.equal(b.year,'2018 a 2022');assert.equal(b.cc,undefined);
 assert.equal(b.quota,'100000');
});
test('camioneta pregunta años y compra directa',()=>{
 const b=play(['CAMIONETA','Ford','Ranger','2020 o más','SÍ','12000000','COMPRA DIRECTA','Ana','Cipolletti']);
 assert.equal(b.step,'completed');assert.equal(b.year,'2020 o más');assert.equal(b.cc,undefined);
});
test('marcas ampliadas y sin pregunta por modelo de moto',()=>{
 const b={step:'vehicle'};advance(session,b,'MOTO');
 const text=question(session,b);
 for(const brand of ['Yamaha','Bajaj','Kawasaki','Benelli','Royal Enfield','Voge'])assert.match(text,new RegExp(brand));
 advance(session,b,'Yamaha');assert.equal(b.step,'cc');
 assert.match(question(session,b),/cilindrada/i);
});
test('cuota libre y personalización administrativa',()=>{
 const custom={config:{welcome:'Bienvenidos a Roca',prompts:{vehicle:'Elegí un vehículo:',year:'¿Qué años te gustan?'}}};
 const b={step:'vehicle'};assert.match(question(custom,b),/Elegí un vehículo/);
 for(const reply of ['AUTO','Toyota','Corolla'])assert.equal(advance(custom,b,reply),true);
 assert.match(question(custom,b),/¿Qué años te gustan/);
 assert.equal(advance(custom,b,'2021'),true);
 assert.equal(advance(custom,b,'NO'),true);
 assert.equal(advance(custom,b,'FINANCIACIÓN'),true);
 assert.equal(question(custom,b),'¿Qué cuota mensual podrías pagar por mes?');
});

test('NO LO SÉ permite avanzar en marca y modelo de auto o camioneta',()=>{
  for(const vehicle of ['AUTO','CAMIONETA']){
    const b={step:'vehicle'};
    assert.equal(advance(session,b,vehicle),true);
    assert.match(question(session,b),/NO LO SÉ/);
    assert.equal(advance(session,b,'no lo se'),true);
    assert.equal(b.brand,'NO LO SÉ');
    assert.equal(b.step,'model');
    assert.match(question(session,b),/NO LO SÉ/);
    assert.equal(advance(session,b,'NO LO SÉ'),true);
    assert.equal(b.model,'NO LO SÉ');
    assert.equal(b.step,'year');
    assert.equal(advance(session,b,'2020'),true);
    assert.equal(b.step,'capital');
  }
});
