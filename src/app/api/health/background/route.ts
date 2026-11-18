import {workerState} from '@/lib/background/worker';
export async function GET(){const state=workerState();return Response.json({running:state.started,lastSuccess:state.lastSuccess,intervalSeconds:15},{headers:{'Cache-Control':'no-store'}})}
