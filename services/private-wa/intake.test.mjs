import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, question } from './intake.mjs';
const session = { config: {} };
function play(answers) {
  const b={step:'vehicle'};
  for(const input of answers) assert.equal(advance(session,b,input),true,`Se rechazó ${input} en ${b.step}`);
  return b;
}
test('bienvenida exige elegir entre tres vehículos',()=>{
  const b={step:'vehicle'};
  assert.match(question(session,b),/General Roca/);
  assert.match(question(session,b),/1\. MOTO/);
  assert.match(question(session,b),/2\. AUTO/);
  assert.match(question(session,b),/3\. CAMIONETA/);
  assert.equal(advance(session,b,'barco'),false);
  assert.equal(b.step,'vehicle');
});
test('moto Honda, capital, financiación, cuota fija, nombre y localidad',()=>{
  const b=play(['1','1','1','1','1','400000','1','1','Laura','General Roca']);
  assert.equal(b.step,'completed');
  assert.deepEqual([b.vehicle,b.brand,b.model,b.cc,b.capital,b.capitalAmount,b.operation,b.quota,b.name,b.locality],
    ['MOTO','Honda','Wave 110','110 cc','SÍ','400000','FINANCIACIÓN','$300.000','Laura','General Roca']);
});
test('moto con marca, modelo y cilindrada OTRA, compra directa',()=>{
  const b=play(['MOTO','OTRA','Benelli','TNT 300','OTRA','302 cc','NO','COMPRA DIRECTA','Sol','Allen']);
  assert.equal(b.step,'completed');
  assert.deepEqual([b.brand,b.model,b.cc,b.operation],['Benelli','TNT 300','302 cc','COMPRA DIRECTA']);
});
test('auto con cuota sin mínimo y sin entrega inicial',()=>{
  const b=play(['2','Toyota','Corolla','1.8','NO','FINANCIACIÓN','100000','Nico','Neuquén']);
  assert.equal(b.step,'completed');
  assert.equal(b.vehicle,'AUTO');assert.equal(b.quota,'100000');assert.equal(b.capital,'NO');
});
test('camioneta con capital y compra directa',()=>{
  const b=play(['3','Ford','Ranger','2.0','SÍ','12000000','COMPRA DIRECTA','Ana','Cipolletti']);
  assert.equal(b.step,'completed');
  assert.equal(b.vehicle,'CAMIONETA');assert.equal(b.capitalAmount,'12000000');
});
test('configuración del administrador modifica bienvenida y catálogo',()=>{
  const s={config:{welcome:'Bienvenidos al concesionario de Roca',brands:{Kawasaki:['Ninja 400']}}};
  const b={step:'vehicle'};
  assert.match(question(s,b),/Bienvenidos al concesionario/);
  advance(s,b,'MOTO');
  assert.match(question(s,b),/Kawasaki/);
  advance(s,b,'Kawasaki');
  assert.match(question(s,b),/Ninja 400/);
});
