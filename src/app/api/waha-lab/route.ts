import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

type UserContext = { userId: string; session: string };
const validChat = (id: string) =>
  /^[a-zA-Z0-9_+.-]{3,80}@(c\.us|g\.us|lid)$/.test(id);
const range = (value: string | null, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};
async function context(): Promise<UserContext | null> {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return { userId: user.id, session: "lab_" + user.id.replace(/-/g, "") };
}
function config() {
  const base = process.env.WAHA_LAB_URL;
  const key = process.env.WAHA_LAB_API_KEY;
  if (!base || !key) return null;
  return { base: base.replace(/\/$/, ""), key };
}
async function waha(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const service = config();
  if (!service) return { ok: false, status: 503, data: { error: "WAHA de pruebas no está configurado" } };
  try {
    const response = await fetch(service.base + path, {
      method, cache: "no-store",
      signal: AbortSignal.timeout(24000),
      headers: { "X-Api-Key": service.key, "Accept": "application/json",
        "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {})
    });
    const data: unknown = await response.json().catch(() => ({
      error: "WAHA no devolvió una respuesta JSON válida"
    }));
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    console.error("[WAHA Lab] Request failed", e instanceof Error ? e.message : String(e));
    return { ok: false, status: 503, data: { error: "WAHA no responde en la red interna de EasyPanel" } };
  }
}
function reply(result: { ok: boolean; status: number; data: unknown }) {
  return NextResponse.json(result.data, {
    status: result.ok ? 200 : result.status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const action = params.get("action") || "status";
  const session = encodeURIComponent(ctx.session);

  if (action === "status") {
    const r = await waha("/api/sessions/" + session);
    if (r.status === 404) return NextResponse.json({ status: "NOT_CREATED", engine: "WEBJS" });
    return reply(r);
  }
  if (action === "chats") {
    const limit = range(params.get("limit"), 60, 200);
    const offset = range(params.get("offset"), 0, 10000);
    return reply(await waha("/api/" + session + "/chats/overview?limit=" +
      limit + "&offset=" + offset));
  }
  if (action === "contacts") {
    const limit = range(params.get("limit"), 250, 500);
    const offset = range(params.get("offset"), 0, 10000);
    return reply(await waha("/api/contacts/all?session=" + session +
      "&limit=" + limit + "&offset=" + offset));
  }
  if (action === "lids") {
    const limit = range(params.get("limit"), 200, 500);
    const offset = range(params.get("offset"), 0, 20000);
    return reply(await waha("/api/" + session + "/lids?limit=" + limit +
      "&offset=" + offset));
  }
  if (action === "contact" || action === "lid" || action === "messages") {
    const chatId = params.get("chatId") || "";
    if (!validChat(chatId)) return NextResponse.json({ error: "Chat inválido" }, { status: 400 });
    const encoded = encodeURIComponent(chatId);
    if (action === "contact")
      return reply(await waha("/api/contacts?session=" + session + "&contactId=" + encoded));
    if (action === "lid") {
      if (!chatId.endsWith("@lid"))
        return NextResponse.json({ error: "No es un identificador LID" }, { status: 400 });
      return reply(await waha("/api/" + session + "/lids/" + encoded));
    }
    const limit = range(params.get("limit"), 100, 200);
    const offset = range(params.get("offset"), 0, 100000);
    return reply(await waha("/api/" + session + "/chats/" + encoded +
      "/messages?limit=" + limit + "&offset=" + offset + "&downloadMedia=false"));
  }
  return NextResponse.json({ error: "Consulta no admitida" }, { status: 400 });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  if (request.headers.get("origin") !==
      (process.env.NEXT_PUBLIC_SITE_URL || "https://crm.valleautomotores.tech"))
    return NextResponse.json({ error: "Origen no autorizado" }, { status: 403 });
  let body: { action?: string; chatId?: string; text?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 }); }
  const session = encodeURIComponent(ctx.session);

  if (body.action === "connect") {
    const client = await createClient();
    const { data, error } = await client.from("waha_lab_inboxes").select("id")
      .eq("owner_user_id", ctx.userId).maybeSingle();
    if (error) return NextResponse.json({ error: "No se pudo comprobar la bandeja WAHA" }, { status: 500 });
    if (!data) {
      const created = await client.from("waha_lab_inboxes").insert({
        owner_user_id: ctx.userId, display_name: "WAHA · Pruebas"
      });
      if (created.error && created.error.code !== "23505")
        return NextResponse.json({ error: "No se pudo crear la bandeja de pruebas" }, { status: 500 });
    }
    const current = await waha("/api/sessions/" + session);
    if (current.status === 404) {
      return reply(await waha("/api/sessions", "POST", {
        name: ctx.session, start: true, config: { webhooks: [] }
      }));
    }
    if (!current.ok) return reply(current);
    const status = (current.data as { status?: string })?.status;
    if (status === "WORKING" || status === "SCAN_QR" || status === "STARTING")
      return NextResponse.json(current.data);
    return reply(await waha("/api/sessions/" + session + "/start", "POST"));
  }
  if (body.action === "restart")
    return reply(await waha("/api/sessions/" + session + "/restart", "POST"));
  if (body.action === "logout")
    return reply(await waha("/api/sessions/" + session + "/logout", "POST"));
  if (body.action === "stop")
    return reply(await waha("/api/sessions/" + session + "/stop", "POST"));
  if (body.action === "send") {
    const chatId = body.chatId || "";
    const text = body.text?.trim() || "";
    if (!validChat(chatId) || !text || text.length > 4000)
      return NextResponse.json({ error: "Mensaje o destinatario inválido" }, { status: 400 });
    return reply(await waha("/api/sendText", "POST", {
      session: ctx.session, chatId, text
    }));
  }
  return NextResponse.json({ error: "Acción no admitida" }, { status: 400 });
}
