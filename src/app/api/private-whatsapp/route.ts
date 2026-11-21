import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function context() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}

function backend() {
  const base = process.env.PRIVATE_WA_BRIDGE_URL;
  const key = process.env.PRIVATE_WA_BRIDGE_KEY;
  if (!base || !key) return null;
  return { base: base.endsWith("/") ? base.slice(0, -1) : base, key };
}
async function proxy(path: string, method: "GET" | "POST", userId: string, payload?: Record<string, unknown>) {
  const bridge = backend();
  if (!bridge) return NextResponse.json({ error: "El servicio de WhatsApp privado no está configurado." }, { status: 503 });
  try {
    const url = bridge.base + path + (method === "GET" ? "?ownerId=" + encodeURIComponent(userId) : "");
    const res = await fetch(url, {
      method, cache: "no-store", signal: AbortSignal.timeout(12000),
      headers: { "x-bridge-key": bridge.key, "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ ownerId: userId, ...payload }) } : {})
    });
    const body = await res.json().catch(() => ({ error: "Respuesta incorrecta del servicio de WhatsApp." }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: "El servicio privado no responde. Probá nuevamente." }, { status: 503 });
  }
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  return proxy("/v1/status", "GET", ctx.user.id);
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Solicitud incorrecta" }, { status: 400 });
  }
  const action = body.action;
  if (action === "connect") {
    const { data: existing, error: readError } = await ctx.supabase
      .from("private_whatsapp_inboxes").select("id")
      .eq("owner_user_id", ctx.user.id).maybeSingle();
    if (readError) return NextResponse.json({ error: "No se pudo leer tu bandeja" }, { status: 500 });
    if (!existing) {
      const { error: insertError } = await ctx.supabase.from("private_whatsapp_inboxes")
        .insert({ owner_user_id: ctx.user.id, display_name: "Mi WhatsApp" });
      if (insertError && insertError.code !== "23505")
        return NextResponse.json({ error: "No se pudo crear la bandeja privada" }, { status: 500 });
    }
    return proxy("/v1/connect", "POST", ctx.user.id);
  }
  if (action === "reset") {
    const { data: inbox, error } = await ctx.supabase
      .from("private_whatsapp_inboxes").select("id")
      .eq("owner_user_id", ctx.user.id).maybeSingle();
    if (error) return NextResponse.json({ error: "No se pudo verificar la bandeja privada" }, { status: 500 });
    if (!inbox) return NextResponse.json({ error: "Tu bandeja privada no está creada" }, { status: 404 });
    return proxy("/v1/reset-pairing", "POST", ctx.user.id);
  }
  if (action === "disconnect") return proxy("/v1/disconnect", "POST", ctx.user.id);
  if (action === "send") {
    const remoteJid = typeof body.remoteJid === "string" ? body.remoteJid : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!/^(?:[0-9]{6,20}@(s\.whatsapp\.net|lid)|[0-9]{5,20}-[0-9]{4,20}@g\.us)$/.test(remoteJid) || !text || text.length > 4000)
      return NextResponse.json({ error: "Destinatario o mensaje incorrecto" }, { status: 400 });
    const { data: inbox } = await ctx.supabase
      .from("private_whatsapp_inboxes").select("id")
      .eq("owner_user_id", ctx.user.id).maybeSingle();
    if (!inbox) return NextResponse.json({ error: "Bandeja no encontrada" }, { status: 404 });
    const { data: chat } = await ctx.supabase.from("private_whatsapp_chats")
      .select("id").eq("inbox_id", inbox.id).eq("remote_jid", remoteJid).maybeSingle();
    if (!chat) return NextResponse.json({ error: "Chat ajeno o inexistente" }, { status: 403 });
    return proxy("/v1/send", "POST", ctx.user.id, { remoteJid, text });
  }
  return NextResponse.json({ error: "Acción no admitida" }, { status: 400 });
}
