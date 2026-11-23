import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pino from 'pino';
import QRCode from 'qrcode';
import { question, advance, config } from './intake.mjs';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';

const dir = process.env.DATA_DIR || '/data';
const secret = process.env.GATEWAY_TOKEN || '';
const callbackSecret = process.env.LEAD_CALLBACK_SECRET || '';
const callbackURL = process.env.LEAD_CALLBACK_URL || '';
if (secret.length < 32 || callbackSecret.length < 32 || !callbackURL) throw Error('Missing gateway secrets');
const log = pino({ level: 'warn' });
const sessions = new Map();
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const folder = user => path.join(dir,user);
const stateFile = user => path.join(folder(user),'intake.json');
async function persist(s){
 await fs.mkdir(folder(s.userId),{recursive:true,mode:0o700});
 const name=stateFile(s.userId), tmp=name+'.tmp';
 await fs.writeFile(tmp,JSON.stringify({accountId:s.accountId,config:s.config,bots:Object.fromEntries(s.bots),done:[...s.done].slice(-2500)}),{mode:0o600});
 await fs.rename(tmp,name);
}
async function load(userId,accountId,configuration){
 await fs.mkdir(folder(userId),{recursive:true,mode:0o700});
 let obj={};
 try{obj=JSON.parse(await fs.readFile(stateFile(userId),'utf8'));}catch{}
 if(obj.accountId && obj.accountId!==accountId)throw Error('Account mismatch');
 return {userId,accountId,config:configuration||obj.config||{},bots:new Map(Object.entries(obj.bots||{})),
   done:new Set(obj.done||[]),status:'starting',qr:null,socket:null,pairingReady:false,starting:false,timer:null};
}
async function callback(s,jid,b){
 const body=JSON.stringify({accountId:s.accountId,userId:s.userId,chatId:jid,
 phone:jid.split('@')[0],name:b.name||'',locality:b.locality||'',
 summary:{vehicle:b.vehicle,brand:b.brand,model:b.model,cc:b.cc,capital:b.capital,
 capitalAmount:b.capitalAmount||null,operation:b.operation,quota:b.quota||null}});
 const hash=crypto.createHmac('sha256',callbackSecret).update(body).digest('hex');
 const res=await fetch(callbackURL,{method:'POST',headers:{'content-type':'application/json','x-valle-signature':hash},
 body,signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('Lead callback failed: '+res.status);
}
async function inbound(s,msg,type){
 if(type!=='notify'||!msg.message||msg.key?.fromMe)return; // No old message sync.
 const jid=msg.key?.remoteJid||'';
 if(!jid.endsWith('@s.whatsapp.net')||s.done.has(jid))return;
 const m=msg.message;
 const incoming=m.conversation||m.extendedTextMessage?.text||m.ephemeralMessage?.message?.extendedTextMessage?.text||'';
 if(!incoming)return;
 let bot=s.bots.get(jid);
 if(!bot){bot={step:'vehicle',seen:[]};s.bots.set(jid,bot);await persist(s);
 await s.socket.sendMessage(jid,{text:question(s,bot)});return;}
 if(msg.key.id && bot.seen?.includes(msg.key.id))return;
 bot.seen=[...(bot.seen||[]).slice(-20),msg.key.id].filter(Boolean);
 const accepted=advance(s,bot,incoming);
 await persist(s);
 if(!accepted){await s.socket.sendMessage(jid,{text:'Elegí una opción válida, por favor.\n\n'+question(s,bot)});return;}
 if(bot.step==='completed'){
   await s.socket.sendMessage(jid,{text:config(s).transfer});
   try{await callback(s,jid,bot);s.done.add(jid);s.bots.delete(jid);await persist(s);}
   catch{bot.pendingDelivery=true;await persist(s);}
 } else await s.socket.sendMessage(jid,{text:question(s,bot)});
}
async function connect(s){
 if(s.starting||s.socket)return;
 s.starting=true;
 const {state,saveCreds}=await useMultiFileAuthState(path.join(folder(s.userId),'auth'));
 const socket=makeWASocket({auth:state,logger:log,syncFullHistory:false,
   shouldSyncHistoryMessage:()=>false,markOnlineOnConnect:false,browser:['Valle Automotores','Chrome','1.0']});
 s.socket=socket;s.status='pairing';
 socket.ev.on('creds.update',saveCreds);
 socket.ev.on('messages.upsert',({messages,type})=>{
   for(const msg of messages)void inbound(s,msg,type).catch(()=>{});
 });
 socket.ev.on('connection.update',async({connection,qr,lastDisconnect})=>{
  if(qr){s.qr=await QRCode.toDataURL(qr,{width:320,margin:2});s.pairingReady=true;}
  if(connection==='open'){s.status='connected';s.qr=null;s.starting=false;}
  if(connection==='close'){
   s.status='disconnected';s.socket=null;s.qr=null;s.starting=false;
   if(lastDisconnect?.error?.output?.statusCode!==DisconnectReason.loggedOut){
    clearTimeout(s.timer);s.timer=setTimeout(()=>connect(s).catch(()=>{}),4000);
   }
  }
 });
}
function reply(res,status,payload){const value=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(value);}
function auth(req){const got=Buffer.from((req.headers.authorization||'').replace(/^Bearer\s+/i,'')),expected=Buffer.from(secret);return got.length===expected.length&&crypto.timingSafeEqual(got,expected);}
async function read(req){let value='';for await(const chunk of req){value+=chunk;if(value.length>40000)throw Error('Payload too large');}return value?JSON.parse(value):{};}
http.createServer(async(req,res)=>{
 if(req.url==='/health')return reply(res,200,{ok:true});
 if(!auth(req))return reply(res,401,{error:'Unauthorized'});
 try{
  const url=new URL(req.url,'http://localhost'),m=url.pathname.match(/^\/session\/([a-f0-9-]{36})\/(start|status|pair|logout)$/i);
  if(!m||!uuid.test(m[1]))return reply(res,404,{error:'Not found'});
  const [userId,action]=m.slice(1),body=req.method==='POST'?await read(req):{};
  let s=sessions.get(userId);
  if(action==='start'&&req.method==='POST'){
   if(!uuid.test(body.accountId||''))return reply(res,400,{error:'Invalid account'});
   if(!s){s=await load(userId,body.accountId,body.config);sessions.set(userId,s);}
   if(s.accountId!==body.accountId)return reply(res,403,{error:'Wrong account'});
   if(body.config)s.config=body.config;
   await persist(s);if(!s.socket)await connect(s);
  }else if(!s)return reply(res,404,{error:'No session'});
  if(action==='pair'&&req.method==='POST'){
   const phone=String(body.phone||'').replace(/\D/g,'');
   if(!s.socket||!s.pairingReady||s.status==='connected')return reply(res,409,{error:'Primero generá el QR y esperá a que esté listo'});
   if(!/^\d{10,15}$/.test(phone))return reply(res,400,{error:'Número internacional inválido'});
   const code=await s.socket.requestPairingCode(phone);
   return reply(res,200,{code,status:s.status});
  }
  if(action==='logout'&&req.method==='POST'){
   clearTimeout(s.timer);await s.socket?.logout().catch(()=>{});
   sessions.delete(userId);await fs.rm(folder(userId),{recursive:true,force:true});
   return reply(res,200,{status:'disconnected'});
  }
  if(action==='status'&&req.method==='GET'||action==='start'&&req.method==='POST')
   return reply(res,200,{status:s.status,qr:s.qr,userId});
  return reply(res,405,{error:'Method not allowed'});
 }catch(e){log.warn({error:e.message},'Gateway request');return reply(res,500,{error:'Gateway operation failed'});}
}).listen(Number(process.env.PORT||3001),'0.0.0.0');
await fs.mkdir(dir,{recursive:true});
for(const name of await fs.readdir(dir)){
 if(!uuid.test(name))continue;
 try{
  const obj=JSON.parse(await fs.readFile(stateFile(name),'utf8'));
  if(!uuid.test(obj.accountId||''))continue;
  const s=await load(name,obj.accountId);sessions.set(name,s);await connect(s);
 }catch(e){log.warn({error:e.message},'Could not restore session');}
}
setInterval(async()=>{
 for(const s of sessions.values())for(const [jid,b] of s.bots)
  if(b.pendingDelivery){try{await callback(s,jid,b);s.done.add(jid);s.bots.delete(jid);await persist(s);}catch{}}
},60000).unref();
