export function dayKey(date: Date): string {
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function monthDays(month: Date): Date[] {
 const first=new Date(month.getFullYear(),month.getMonth(),1);
 first.setDate(first.getDate()-((first.getDay()+6)%7));
 return Array.from({length:42},(_,index)=>new Date(first.getFullYear(),first.getMonth(),first.getDate()+index));
}
export function moveToDay(iso: string, day: string): string {
 const before=new Date(iso);
 const date=new Date(`${day}T${String(before.getHours()).padStart(2,'0')}:${String(before.getMinutes()).padStart(2,'0')}:00`);
 if(Number.isNaN(date.getTime())) throw new Error('Fecha inválida');
 return date.toISOString();
}
