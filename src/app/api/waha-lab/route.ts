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
  if (action === "chat-index") {
    const limit = range(params.get("limit"), 200, 200);
    const offset = range(params.get("offset"), 0, 50000);
    return reply(await waha("/api/" + session + "/chats?limit=" + limit +
      "&offset=" + offset + "&sortBy=messageTimestamp&sortOrder=desc"));
  }
  if (action === "labels") {
    return reply(await waha("/api/" + session + "/labels"));
  }
  if (action === "label-chats") {
    const labelId = params.get("labelId") || "";
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(labelId))
      return NextResponse.json({ error: "Lista de WhatsApp inválida" }, { status: 400 });
    return reply(await waha("/api/" + session + "/labels/" + encodeURIComponent(labelId) + "/chats"));
  }
  if (action === "overview-ids") {
    const ids = (params.get("ids") || "").split(",").filter(Boolean);
    if (!ids.length || ids.length > 100 || ids.some(id => !validChat(id)))
      return NextResponse.json({ error: "Listado de chats inválido" }, { status: 400 });
    return reply(await waha("/api/" + session + "/chats/overview", "POST", {
      pagination: { limit: ids.length, offset: 0 },
      filter: { ids }
    }));
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
  let body: { action?: string; chatId?: string; chatIds?: string[]; text?: string; phoneNumber?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 }); }
  const session = encodeURIComponent(ctx.session);

  if (body.action === "latest-previews") {
    const chatIds = body.chatIds;
    if (!Array.isArray(chatIds) || chatIds.length < 1 || chatIds.length > 6 ||
        chatIds.some(id => typeof id !== "string" || !validChat(id)) ||
        new Set(chatIds).size !== chatIds.length)
      return NextResponse.json({ error: "Lote de conversaciones inválido" }, { status: 400 });
    // The overview may carry an old placeholder lastMessage. Read the real,
    // latest available message from WhatsApp Web, not the overview timestamp.
    const entries = await Promise.all(chatIds.map(async chatId => {
      const response = await waha("/api/" + session + "/chats/" +
        encodeURIComponent(chatId) +
        "/messages?limit=3&offset=0&sortBy=timestamp&sortOrder=desc&downloadMedia=false");
      if (!response.ok)
        return { chatId, status: "failed" };
      const payload = response.data;
      const record = payload && typeof payload === "object"
        ? payload as Record<string, unknown> : {};
      const messages: unknown[] = Array.isArray(payload) ? payload :
        Array.isArray(record.messages) ? record.messages :
        Array.isArray(record.data) ? record.data : [];
      const valid = messages.filter(item => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        const stamp = Number(row.timestamp);
        const seconds = stamp > 1e12 ? stamp / 1000 : stamp;
        return Number.isFinite(seconds) &&
          seconds > 1577836800 && seconds < Date.now() / 1000 + 300;
      }).sort((a,b) => {
        const left = Number((a as Record<string, unknown>).timestamp);
        const right = Number((b as Record<string, unknown>).timestamp);
        return right - left;
      });
      if (!valid.length) return { chatId, status: "unavailable" };
      const msg = valid[0] as Record<string, unknown>;
      const type = typeof msg.type === "string" ? msg.type : "chat";
      const body = typeof msg.body === "string" ? msg.body :
        typeof msg.caption === "string" ? msg.caption : "";
      const id = typeof msg.id === "string" ? msg.id :
        msg.id && typeof msg.id === "object" && typeof (msg.id as Record<string,unknown>)._serialized === "string"
          ? (msg.id as Record<string,string>)._serialized : "";
      return { chatId, status: "verified",
        message: {
          id, timestamp: Number(msg.timestamp), body: body.slice(0, 700),
          type, hasMedia: msg.hasMedia === true, fromMe: msg.fromMe === true
        }
      };
    }));
    return NextResponse.json({ entries }, {
      headers: { "Cache-Control": "no-store" }
    });
  }

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
    if (status === "WORKING" || status === "SCAN_QR_CODE" || status === "SCAN_QR" || status === "STARTING" || status === "PASSKEY_REQUIRED")
      return NextResponse.json(current.data);
    return reply(await waha("/api/sessions/" + session + "/start", "POST"));
  }
  if (body.action === "request-code") {
    const phone = (body.phoneNumber || "").replace(/[ +()\-]/g, "");
    if (!/^[0-9]{8,16}$/.test(phone))
      return NextResponse.json({ error: "Ingresá el número completo con código de país, sin el signo +." }, { status: 400 });

    const current = await waha("/api/sessions/" + session);
    if (current.status === 404)
      return NextResponse.json({ error: "Primero iniciá WAHA con «Vincular WAHA»." }, { status: 409 });
    if (!current.ok) return reply(current);
    const status = (current.data as {status?:string}).status;
    if (status === "WORKING")
      return NextResponse.json({ error: "Este dispositivo ya figura conectado." }, { status: 409 });
    if (status !== "SCAN_QR_CODE" && status !== "SCAN_QR" && status !== "STARTING")
      return NextResponse.json({
        error: "La sesión está en estado " + (status || "desconocido") +
          ". Reiniciá WAHA e intentá solicitar un código."
      }, { status: 409 });
    return reply(await waha("/api/" + session + "/auth/request-code", "POST", { phoneNumber: phone }));
  }
  if (body.action === "restart")
    return reply(await waha("/api/sessions/" + session + "/restart", "POST"));
  if (body.action === "logout")
    return reply(await waha("/api/sessions/" + session + "/logout", "POST"));
  if (body.action === "stop")
    return reply(await waha("/api/sessions/" + session + "/stop", "POST"));
  if (body.action === "archive" || body.action === "unarchive") {
    const chatId = body.chatId || "";
    if (!validChat(chatId))
      return NextResponse.json({ error: "Conversación inválida" }, { status: 400 });
    return reply(await waha("/api/" + session + "/chats/" +
      encodeURIComponent(chatId) + "/" + body.action, "POST"));
  }
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
