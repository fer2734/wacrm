import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const file = (await request.formData()).get('photo');
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024 || !['image/jpeg','image/png'].includes(file.type)) {
      return NextResponse.json({error:'Seleccioná una imagen JPG o PNG de hasta 5 MB.'},{status:400});
    }
    const bytes = await file.arrayBuffer();
    const signature = new Uint8Array(bytes);
    const valid = file.type === 'image/jpeg' ? signature[0]===255 && signature[1]===216 : signature[0]===137 && signature[1]===80 && signature[2]===78 && signature[3]===71;
    if (!valid) return NextResponse.json({error:'Imagen inválida.'},{status:400});
    const { data: config } = await supabaseAdmin().from('whatsapp_config').select('access_token,phone_number_id').eq('account_id',accountId).single();
    const appId = process.env.META_APP_ID;
    if (!config || !appId || !/^\d+$/.test(appId) || !/^\d+$/.test(config.phone_number_id)) return NextResponse.json({error:'Falta configurar WhatsApp o el ID de aplicación Meta.'},{status:400});
    const token = decrypt(config.access_token);
    const base = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v26.0') + '/';
    const auth = {Authorization:'Bearer '+token};
    const params = new URLSearchParams({file_length:String(file.size),file_type:file.type,file_name:file.type==='image/jpeg'?'profile.jpg':'profile.png'});
    const session = await fetch(base+appId+'/uploads?'+params,{method:'POST',headers:auth,signal:AbortSignal.timeout(30000)});
    const first = await session.json();
    if (!session.ok || typeof first.id !== 'string' || !first.id.startsWith('upload:')) return NextResponse.json({error:'Meta rechazó la creación de la sesión de carga (código '+(first.error?.code ?? session.status)+').'},{status:502});
    const upload = await fetch(base+encodeURIComponent(first.id),{method:'POST',headers:{Authorization:'OAuth '+token,file_offset:'0','Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30000)});
    const second = await upload.json();
    if (!upload.ok || typeof second.h !== 'string') return NextResponse.json({error:'Meta rechazó la imagen (código '+(second.error?.code ?? upload.status)+').'},{status:502});
    const update = await fetch(base+config.phone_number_id+'/whatsapp_business_profile',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',profile_picture_handle:second.h}),signal:AbortSignal.timeout(30000)});
    const result = await update.json();
    if (!update.ok || result.success !== true) return NextResponse.json({error:'Meta no actualizó el perfil (código '+(result.error?.code ?? update.status)+'). Revisá los permisos del token.'},{status:502});
    return NextResponse.json({success:true});
  } catch (error) { return toErrorResponse(error); }
}
