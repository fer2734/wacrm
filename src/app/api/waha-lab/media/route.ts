import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const isChat = (s: string) => /^[a-zA-Z0-9_+.-]{3,80}@(c\.us|g\.us|lid)$/.test(s);
const isMessage = (s: string) => /^[a-zA-Z0-9_@.+:-]{10,350}$/.test(s);

/**
 * Private per-agent media streaming proxy. WAHA is never exposed to clients.
 * Each request resolves the message through this agent's own WhatsApp session
 * and only follows WAHA's local /api/files/... reference, never arbitrary URLs.
 */
export async function GET(request: Request) {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user)
    return NextResponse.json({ error: "Iniciá sesión para ver este archivo" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const chatId = params.get("chatId") || "";
  const messageId = params.get("messageId") || "";
  if (!isChat(chatId) || !isMessage(messageId))
    return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });

  const base = process.env.WAHA_LAB_URL?.replace(/\/$/, "");
  const key = process.env.WAHA_LAB_API_KEY;
  if (!base || !key)
    return NextResponse.json({ error: "WAHA no configurado" }, { status: 503 });
  const session = "lab_" + user.id.replace(/-/g, "");
  try {
    const metadata = await fetch(
      base + "/api/" + encodeURIComponent(session) + "/chats/" +
        encodeURIComponent(chatId) + "/messages/" + encodeURIComponent(messageId) +
        "?downloadMedia=true",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
        headers: { "X-Api-Key": key, "Accept": "application/json" },
        redirect: "manual"
      }
    );
    if (!metadata.ok)
      return NextResponse.json({ error: "WhatsApp no devolvió este archivo" }, { status: 404 });
    const msg: unknown = await metadata.json().catch(() => null);
    const record = msg && typeof msg === "object"
      ? msg as Record<string, unknown> : {};
    const media = record.media && typeof record.media === "object"
      ? record.media as Record<string, unknown> : {};
    const mediaUrl = typeof media.url === "string" ? media.url : null;
    if (!mediaUrl)
      return NextResponse.json({
        error: "Este archivo todavía no está disponible en el dispositivo vinculado"
      }, { status: 404 });

    // Never request the URL's host. WAHA may return localhost or its own
    // internal Docker hostname; only the path is forwarded to our pinned host.
    const mediaPath = new URL(mediaUrl, base).pathname;
    if (!/^\/api\/files\/[^/?#]+$/.test(mediaPath) ||
        mediaPath.includes("..") || /%2f|%5c|%2e%2e/i.test(mediaPath))
      return NextResponse.json({ error: "Ruta de archivo inválida" }, { status: 502 });

    const headers: Record<string, string> = { "X-Api-Key": key };
    const range = request.headers.get("range");
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    const file = await fetch(base + mediaPath, {
      headers, cache: "no-store", redirect: "manual",
      signal: AbortSignal.timeout(60000)
    });
    if (!file.ok || !file.body)
      return NextResponse.json({ error: "WAHA no pudo descargar el archivo" }, {
        status: file.status === 404 ? 404 : 502
      });
    const rawMime = typeof media.mimetype === "string" ? media.mimetype :
      file.headers.get("content-type") || "application/octet-stream";
    // Opus voice notes can report "audio/ogg; codecs=opus".
    const mime = rawMime.split(";")[0].trim().toLowerCase();
    const supported = /^(image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf)$/i.test(mime);
    const out = new Headers({
      "Content-Type": supported ? mime : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=1800",
      "Content-Disposition": supported ? "inline" : "attachment"
    });
    for (const header of ["content-length", "content-range", "accept-ranges"]) {
      const value = file.headers.get(header);
      if (value) out.set(header, value);
    }
    return new NextResponse(file.body, {
      status: file.status === 206 ? 206 : 200, headers: out
    });
  } catch (err) {
    console.warn("Private WAHA media request failed:",
      err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      error: "No se pudo cargar el archivo. Puede que ya no esté disponible en WhatsApp."
    }, { status: 502 });
  }
}
