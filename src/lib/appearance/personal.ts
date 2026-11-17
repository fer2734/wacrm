export const PERSONAL_STYLE_KEY='wacrm.personal-style';
export interface PersonalStyle {fontSize:number;accent:string|null;background:string|null}
export const DEFAULT_PERSONAL_STYLE:PersonalStyle={fontSize:16,accent:null,background:null};
export function color(value:unknown):string|null{return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:null}
export function normalizePersonalStyle(value:unknown):PersonalStyle{const row=value&&typeof value==='object'?value as Partial<PersonalStyle>:{};return {fontSize:[16,18,20,22].includes(Number(row.fontSize))?Number(row.fontSize):16,accent:color(row.accent),background:color(row.background)}}
export function foreground(hex:string):string{
 const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4));
 const light=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
 return (light+.05)/.05 >= 1.05/(light+.05)?'#000000':'#ffffff';
}
export function applyPersonalStyle(value:PersonalStyle){const d=document.documentElement;d.style.fontSize=`${value.fontSize}px`;
 if(value.accent){d.style.setProperty('--primary',value.accent);d.style.setProperty('--primary-foreground',foreground(value.accent));d.style.setProperty('--ring',value.accent)}else for(const key of ['--primary','--primary-foreground','--ring'])d.style.removeProperty(key);
 const surfaces=['--background','--card','--card-2','--popover','--secondary','--muted','--accent','--sidebar'];
 const texts=['--foreground','--card-foreground','--popover-foreground','--secondary-foreground','--muted-foreground','--accent-foreground','--sidebar-foreground','--sidebar-accent-foreground'];
 if(value.background){for(const key of surfaces)d.style.setProperty(key,value.background);for(const key of texts)d.style.setProperty(key,foreground(value.background));for(const key of ['--border','--input','--sidebar-border'])d.style.setProperty(key,`color-mix(in srgb, ${foreground(value.background)} 25%, ${value.background})`)}
 else for(const key of [...surfaces,...texts,'--border','--input','--sidebar-border'])d.style.removeProperty(key);
}

export function resetPersonalColors(backgroundOnly=false){
 try{const current=normalizePersonalStyle(JSON.parse(localStorage.getItem(PERSONAL_STYLE_KEY)??'{}'));const next={...current,background:null,...(backgroundOnly?{}:{accent:null})};applyPersonalStyle(next);localStorage.setItem(PERSONAL_STYLE_KEY,JSON.stringify(next));window.dispatchEvent(new Event('wacrm-personal-style'))}catch{}
}
