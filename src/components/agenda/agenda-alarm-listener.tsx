"use client";
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {createClient} from '@/lib/supabase/client';
import {useAuth} from '@/hooks/use-auth';
import {showBrowserNotification} from '@/lib/notifications/show-browser-notification';
export function AgendaAlarmListener(){const {user}=useAuth();const router=useRouter();
 useEffect(()=>{if(!user)return;let cancelled=false,busy=false;let audio:AudioContext|null=null;
 const unlock=()=>{try{if(!('AudioContext' in window))return;if(!audio)audio=new AudioContext();void audio.resume()}catch{}};window.addEventListener('pointerdown',unlock,{once:true});
 const poll=async()=>{if(busy||cancelled)return;busy=true;try{const {data,error}=await createClient().rpc('claim_my_task_alarms');if(error||cancelled)return;
 for(const task of data??[]){toast.warning(`⏰ ${task.title}`,{description:new Date(task.starts_at).toLocaleString('es-AR'),duration:Infinity,action:{label:'Abrir agenda',onClick:()=>router.push('/agenda')}});
 try{if(audio&&audio.state==='running'){const tone=audio.createOscillator();const gain=audio.createGain();gain.gain.value=.12;tone.frequency.value=880;tone.connect(gain);gain.connect(audio.destination);tone.start();tone.stop(audio.currentTime+.6)}}catch{}
 if('Notification' in window&&Notification.permission==='granted')void showBrowserNotification(`⏰ ${task.title}`,{body:'Tenés una actividad agendada',tag:`task-${task.id}`,icon:'/icon'},'/agenda').catch(()=>{});
 }window.dispatchEvent(new Event('wacrm-agenda-changed'));
 }finally{busy=false}};
 void poll();const interval=window.setInterval(()=>void poll(),15000);window.addEventListener('focus',poll);
 return()=>{cancelled=true;window.clearInterval(interval);window.removeEventListener('focus',poll);window.removeEventListener('pointerdown',unlock);void audio?.close()};
 },[user,router]);return null;}
