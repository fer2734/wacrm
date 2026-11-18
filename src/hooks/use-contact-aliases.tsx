"use client";
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {createClient} from '@/lib/supabase/client';import {useAuth} from '@/hooks/use-auth';
const Context=createContext<{aliases:Record<string,string>;save:(id:string,name:string)=>Promise<boolean>}>({aliases:{},save:async()=>false});
export function ContactAliasesProvider({children}:{children:ReactNode}){const {user,accountId}=useAuth();const [aliases,setAliases]=useState<Record<string,string>>({});
 useEffect(()=>{if(!user||!accountId)return;let cancelled=false;void createClient().from('contact_aliases').select('contact_id,alias').eq('user_id',user.id).eq('account_id',accountId).then(({data})=>{if(!cancelled)setAliases(Object.fromEntries((data??[]).map(r=>[r.contact_id,r.alias])))});return()=>{cancelled=true}},[user,accountId]);
 const save=useCallback(async(id:string,name:string)=>{if(!user||!accountId)return false;const alias=name.trim().slice(0,180);const {error}=await createClient().from('contact_aliases').upsert({user_id:user.id,account_id:accountId,contact_id:id,alias},{onConflict:'user_id,contact_id'});if(error)return false;setAliases(prev=>({...prev,[id]:alias}));return true},[user,accountId]);return <Context.Provider value={{aliases,save}}>{children}</Context.Provider>}
export function useContactAliases(){return useContext(Context)}
