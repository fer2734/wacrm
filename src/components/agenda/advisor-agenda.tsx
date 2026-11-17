"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {DndContext,closestCenter,PointerSensor,TouchSensor,KeyboardSensor,useSensor,useSensors,useDraggable,useDroppable,type DragEndEvent} from '@dnd-kit/core';
import {useRouter} from 'next/navigation';
import {CalendarDays,ChevronLeft,ChevronRight,GripVertical,Plus,Pencil} from 'lucide-react';
import {toast} from 'sonner';
import {createClient} from '@/lib/supabase/client';
import {useAuth} from '@/hooks/use-auth';
import {dayKey,monthDays,moveToDay} from '@/lib/agenda/dates';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
interface Task {id:string; title:string;kind:string;starts_at:string;duration_minutes:number;client_name:string;client_phone:string;notes:string;completed:boolean;contact_id:string|null}
const kinds:Record<string,string>={task:'Tarea',interview:'Entrevista presencial',video:'Videollamada',call:'Llamada'};
const empty={title:'',kind:'task',date:dayKey(new Date()),time:'09:00',duration_minutes:30,client_name:'',client_phone:'',notes:'',contact_id:null as string|null};
export function AdvisorAgenda({compact=false,contactId}:{compact?:boolean;contactId?:string|null}) {
 const db=createClient();const {user,accountId}=useAuth();const router=useRouter();
 const [month,setMonth]=useState(()=>new Date());const [day,setDay]=useState(()=>dayKey(new Date()));const [tasks,setTasks]=useState<Task[]>([]);
 const [open,setOpen]=useState(false);const [editing,setEditing]=useState<string|null>(null);const [form,setForm]=useState(empty);const [saving,setSaving]=useState(false);const [loading,setLoading]=useState(true);
 const requestVersion=useRef(0);
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:8}}),useSensor(KeyboardSensor));
 const refresh=useCallback(async()=>{
  if(!user||!accountId)return;
  const version=++requestVersion.current;
  const days=monthDays(month);const until=new Date(days[41]);until.setDate(until.getDate()+1);
  const {data,error}=await db.from('advisor_tasks').select('*').eq('user_id',user.id).eq('account_id',accountId).gte('starts_at',days[0].toISOString()).lt('starts_at',until.toISOString()).order('starts_at');
  if(version!==requestVersion.current)return;
  if(error)toast.error('No se pudo cargar la agenda');else setTasks(data??[]);setLoading(false);
 },[db,user,accountId,month]);
 // The initial fetch only updates state after the database request resolves.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);window.addEventListener('wacrm-agenda-changed',focus);return()=>{requestVersion.current++;window.removeEventListener('focus',focus);window.removeEventListener('wacrm-agenda-changed',focus)}},[refresh]);
 useEffect(()=>{if(!contactId)return;let cancelled=false;void db.from('contacts').select('id,name,phone').eq('id',contactId).maybeSingle().then(({data})=>{if(!cancelled&&data){setForm({...empty,contact_id:data.id,client_name:data.name??'',client_phone:data.phone??'',date:dayKey(new Date())});setEditing(null);setOpen(true)}});return()=>{cancelled=true}},[db,contactId]);
 function edit(task?:Task){setEditing(task?.id??null);const when=task?new Date(task.starts_at):null;setForm(task?{title:task.title,kind:task.kind,date:dayKey(when!),time:`${String(when!.getHours()).padStart(2,'0')}:${String(when!.getMinutes()).padStart(2,'0')}`,duration_minutes:task.duration_minutes,client_name:task.client_name,client_phone:task.client_phone,notes:task.notes,contact_id:task.contact_id}:{...empty,date:day});setOpen(true)}
 async function save(){if(!user||!accountId||!form.title.trim()||saving)return;const starts=new Date(`${form.date}T${form.time}`);if(Number.isNaN(starts.getTime())){toast.error('Revisá fecha y hora');return}setSaving(true);
 const payload={title:form.title.trim(),kind:form.kind,starts_at:starts.toISOString(),duration_minutes:Number(form.duration_minutes),client_name:form.client_name.trim(),client_phone:form.client_phone.trim(),notes:form.notes.trim(),contact_id:form.contact_id};
 const {error}=editing?await db.from('advisor_tasks').update(payload).eq('id',editing).eq('user_id',user.id):await db.from('advisor_tasks').insert({...payload,user_id:user.id,account_id:accountId});setSaving(false);
 if(error){toast.error('No se pudo guardar la actividad');return}setOpen(false);setDay(form.date);setMonth(starts);toast.success('Actividad guardada');window.dispatchEvent(new Event('wacrm-agenda-changed'));void refresh();}
 async function updateTask(id:string,patch:Partial<Task>){const {error}=await db.from('advisor_tasks').update(patch).eq('id',id).eq('user_id',user!.id);if(error){toast.error('No se pudo actualizar la actividad');return}window.dispatchEvent(new Event('wacrm-agenda-changed'));await refresh()}
 async function drop(event:DragEndEvent){if(!event.over)return;const task=tasks.find(t=>t.id===String(event.active.id));const target=String(event.over.id);if(!task||!/^\d{4}-\d{2}-\d{2}$/.test(target))return;await updateTask(task.id,{starts_at:moveToDay(task.starts_at,target)});setDay(target)}
 const daily=tasks.filter(t=>dayKey(new Date(t.starts_at))===day);
 return <section className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
 <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="size-5 text-primary"/>Mi agenda</h2><Button size="sm" onClick={()=>edit()}><Plus/>Agendar</Button></div>
 <p className="mb-3 text-sm text-muted-foreground">Actividades privadas. Podés registrar clientes del CRM o externos.</p>
 <DndContext collisionDetection={closestCenter} sensors={sensors} onDragEnd={e=>void drop(e)}>
 <div className={compact?'space-y-4':'grid min-w-0 gap-5 lg:grid-cols-[minmax(260px,330px)_minmax(0,1fr)]'}>
 <div className="min-w-0"><div className="mb-2 flex items-center justify-between gap-1"><Button variant="ghost" size="icon-sm" aria-label="Mes anterior" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft/></Button><span className="min-w-0 text-center text-sm font-semibold capitalize">{month.toLocaleDateString('es-AR',{month:'long',year:'numeric'})}</span><Button variant="ghost" size="icon-sm" aria-label="Mes siguiente" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight/></Button></div>
 <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">{['L','M','M','J','V','S','D'].map((d,i)=><span key={i}>{d}</span>)}</div>
 <div className="mt-1 grid grid-cols-7 gap-1">{monthDays(month).map(date=><Day key={dayKey(date)} date={date} selected={day===dayKey(date)} muted={date.getMonth()!==month.getMonth()} count={tasks.filter(t=>dayKey(new Date(t.starts_at))===dayKey(date)&&!t.completed).length} onPick={()=>setDay(dayKey(date))}/>)}</div>
 <Button variant="outline" size="sm" className="mt-3 w-full" onClick={()=>{setMonth(new Date());setDay(dayKey(new Date()))}}>Hoy</Button>
 </div>
 <div className="min-w-0"><h3 className="mb-2 font-semibold">{new Date(`${day}T12:00`).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'})}</h3><p className="mb-3 text-xs text-muted-foreground">Arrastrá desde el asa hacia otro día. También podés cambiar fecha y hora con Editar.</p>
 {loading?<p>Cargando agenda…</p>:daily.length===0?<p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Sin actividades para este día.</p>:<div className="space-y-2">{daily.slice(0,compact?2:daily.length).map(task=><TaskCard compact={compact} key={task.id} task={task} onEdit={()=>edit(task)} onComplete={()=>void updateTask(task.id,{completed:!task.completed})}/>)}</div>}
 </div></div></DndContext>
 {compact&&<Button variant="outline" className="mt-4 w-full" onClick={()=>router.push('/agenda')}>Abrir agenda completa</Button>}
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing?'Editar actividad':'Nueva actividad'}</DialogTitle></DialogHeader>
 <div className="grid min-w-0 gap-3"><label className="grid gap-1 text-sm">Título<Input maxLength={180} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Ej.: llamar por consulta de Hilux"/></label>
 <label className="grid gap-1 text-sm">Tipo<select className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-center" value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}>{Object.entries(kinds).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
 <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-sm">Fecha<Input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label className="grid min-w-0 gap-1 text-sm">Hora<Input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></label></div>
 <label className="grid gap-1 text-sm">Duración en minutos<Input type="number" min={5} max={1440} value={form.duration_minutes} onChange={e=>setForm({...form,duration_minutes:Number(e.target.value)})}/></label>
 <label className="grid gap-1 text-sm">Cliente o contacto externo<Input value={form.client_name} onChange={e=>setForm({...form,client_name:e.target.value})}/></label><label className="grid gap-1 text-sm">Teléfono<Input type="tel" value={form.client_phone} onChange={e=>setForm({...form,client_phone:e.target.value})}/></label>
 <label className="grid gap-1 text-sm">Notas / enlace de videollamada<Textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
 <Button disabled={saving||!form.title.trim()||form.duration_minutes<5||form.duration_minutes>1440} onClick={()=>void save()}>{saving?'Guardando…':'Guardar actividad'}</Button></div></DialogContent></Dialog>
 </section>;
}
function Day({date,selected,muted,count,onPick}:{date:Date;selected:boolean;muted:boolean;count:number;onPick:()=>void}){const {setNodeRef,isOver}=useDroppable({id:dayKey(date)});return <button ref={setNodeRef} onClick={onPick} aria-label={`${date.toLocaleDateString('es-AR')}, ${count} actividades`} aria-pressed={selected} className={`relative flex min-h-10 min-w-0 flex-col items-center justify-center rounded-md text-sm ${selected?'bg-primary text-primary-foreground':isOver?'bg-primary/25 ring-2 ring-primary':muted?'text-muted-foreground':'hover:bg-muted'}`}><span>{date.getDate()}</span>{count>0&&<span className="text-[0.65rem] leading-none">{count>9?'9+':count} •</span>}</button>}
function TaskCard({task,onEdit,onComplete,compact=false}:{compact?:boolean;task:Task;onEdit:()=>void;onComplete:()=>void}){const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({id:task.id});return <article ref={setNodeRef} style={{transform:transform?`translate(${transform.x}px,${transform.y}px)`:undefined,zIndex:isDragging?50:undefined,position:'relative'}} className={`min-w-0 rounded-lg border border-border bg-background p-3 ${task.completed?'opacity-60':''}`}>
 <div className="flex min-w-0 items-start gap-2"><button {...listeners} {...attributes} aria-label={`Mover ${task.title}`} className="flex size-9 shrink-0 touch-none items-center justify-center rounded hover:bg-muted"><GripVertical className="size-4"/></button><div className="min-w-0 flex-1"><p className="text-xs font-medium text-primary">{new Date(task.starts_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})} · {task.duration_minutes} min · {kinds[task.kind]}</p><h4 className={`break-words font-semibold ${task.completed?'line-through':''}`}>{task.title}</h4>{task.client_name&&<p className="break-words text-sm">{task.client_name} {task.client_phone}</p>}{!compact&&task.notes&&<p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{task.notes}</p>}</div><Button variant="ghost" size="icon-sm" aria-label="Editar actividad" onClick={onEdit}><Pencil/></Button></div>
 <label className="mt-2 flex items-center justify-end gap-2 text-sm"><input type="checkbox" checked={task.completed} onChange={onComplete}/>Completada</label></article>}
