"use client";
import {Suspense} from 'react';
import {useSearchParams} from 'next/navigation';
import {AdvisorAgenda} from '@/components/agenda/advisor-agenda';
function AgendaInner(){const params=useSearchParams();return <div className="mx-auto w-full min-w-0 max-w-6xl"><AdvisorAgenda contactId={params.get('contact')}/></div>}
export default function AgendaPage(){return <Suspense fallback={<p>Cargando agenda…</p>}><AgendaInner/></Suspense>}
