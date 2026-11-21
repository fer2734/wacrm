import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.PORT || 3081);
const BASE = process.env.SESSION_DIR || "/data/wa-sessions";
const secret = process.env.PRIVATE_WA_BRIDGE_KEY;
const dbUrl = process.env.SUPABASE_URL;
const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!secret || secret.length < 32 || !dbUrl || !dbKey) {
  throw new Error("Missing bridge secret or database configuration.");
}
const db = createClient(dbUrl, dbKey, { auth: { persistSession: false } });
const sessions = new Map();
const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
async function setStatus(ownerId, state, phone) {
  const patch = { connection_status: state, updated_at: new Date().toISOString() };
  if (phone !== undefined) patch.connected_phone = phone;
  const { error } = await db.from("private_whatsapp_inboxes").update(patch).eq("owner_user_id", ownerId);
  if (error) logger.warn({ message: error.message }, "Could not update private WhatsApp status");
}
async function inbox(ownerId) {
  const { data, error } = await db.from("private_whatsapp_inboxes")
    .select("id,owner_user_id,connection_status,connected_phone").eq("owner_user_id", ownerId).maybeSingle();
  if (error) throw error;
  return data;
}
function extractText(message) {
  const m = message?.ephemeralMessage?.message || message?.viewOnceMessage?.message || message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || (m.imageMessage ? "📷 Imagen" : "") ||
    (m.audioMessage ? "🎤 Audio" : "") || (m.documentMessage ? "📄 Documento" : "") ||
    (m.stickerMessage ? "Sticker" : "") || "";
}
async function saveMessage(ownerId, msg) {
  const jid = msg.key?.remoteJid;
  if (!jid || !/^\d{6,18}@s\.whatsapp\.net$/.test(jid) || !msg.key?.id || !msg.message) return;
  const box = await inbox(ownerId);
  if (!box) return;
  const text = String(extractText(msg.message)).slice(0, 10000);
  const senderName = typeof msg.pushName === "string" ? msg.pushName.slice(0, 180) : "";
  const ts = Number(msg.messageTimestamp?.toString?.() || msg.messageTimestamp || 0);
  const sentAt = ts > 0 && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const { data: previous } = await db.from("private_whatsapp_chats")
    .select("id,contact_name,unread_count,last_message_at").eq("inbox_id", box.id)
    .eq("remote_jid", jid).maybeSingle();
  let chatId = previous?.id;
  if (!chatId) {
    const { data, error } = await db.from("private_whatsapp_chats").upsert({
      inbox_id: box.id, owner_user_id: ownerId, remote_jid: jid,
      contact_name: senderName || jid.split("@")[0], last_message_text: text,
      last_message_at: sentAt
    }, { onConflict: "inbox_id,remote_jid", ignoreDuplicates: true }).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: resolved } = await db.from("private_whatsapp_chats").select("id")
        .eq("inbox_id", box.id).eq("remote_jid", jid).single();
      chatId = resolved?.id;
    } else chatId = data.id;
  }
  if (!chatId) return;
  const { data: inserted, error } = await db.from("private_whatsapp_messages").upsert({
    chat_id: chatId, inbox_id: box.id, owner_user_id: ownerId,
    whatsapp_message_id: msg.key.id, from_me: !!msg.key.fromMe,
    message_text: text, message_type: "text", sent_at: sentAt
  }, { onConflict: "chat_id,whatsapp_message_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) throw error;
  if (inserted) {
    const newer = !previous?.last_message_at || new Date(sentAt) >= new Date(previous.last_message_at);
    await db.from("private_whatsapp_chats").update({
      ...(newer ? { last_message_text: text, last_message_at: sentAt } : {}),
      ...(senderName && !previous?.contact_name ? { contact_name: senderName } : {}),
      unread_count: (previous?.unread_count || 0) + (msg.key.fromMe ? 0 : 1)
    }).eq("id", chatId).eq("owner_user_id", ownerId);
  }
}
async function start(ownerId) {
  const prev = sessions.get(ownerId);
  if (prev && ["connecting", "qr", "connected"].includes(prev.status)) return prev;
  const folder = path.join(BASE, ownerId);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(folder);
  const session = { sock: null, status: "connecting", qr: null, phone: null, restarting: false };
  sessions.set(ownerId, session);
  const sock = makeWASocket({
    auth: state, logger, printQRInTerminal: false,
    browser: ["Valle Automotores", "Chrome", "1.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false
  });
  session.sock = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", async payload => {
    for (const msg of payload.messages || []) {
      try { await saveMessage(ownerId, msg); }
      catch (err) { logger.error({ error: String(err) }, "Private message save error"); }
    }
  });
  sock.ev.on("connection.update", async update => {
    if (sessions.get(ownerId) !== session) return;
    if (update.qr) {
      try { session.qr = await QRCode.toDataURL(update.qr, { width: 300, margin: 2 }); }
      catch { session.qr = null; }
      session.status = "qr";
      await setStatus(ownerId, "qr");
    }
    if (update.connection === "open") {
      session.status = "connected";
      session.qr = null;
      session.phone = sock.user?.id?.split(":")[0]?.split("@")[0] || null;
      await setStatus(ownerId, "connected", session.phone);
    }
    if (update.connection === "close") {
      session.qr = null;
      session.status = "disconnected";
      await setStatus(ownerId, "disconnected");
      const reason = update.lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        sessions.delete(ownerId);
        await fs.rm(folder, { recursive: true, force: true });
        await setStatus(ownerId, "not_connected", null);
      } else if (!session.restarting) {
        session.restarting = true;
        sessions.delete(ownerId);
        setTimeout(() => { void start(ownerId).catch(err => logger.error(String(err))); }, 4000);
      }
    }
  });
  return session;
}
async function unlink(ownerId) {
  const session = sessions.get(ownerId);
  sessions.delete(ownerId);
  if (session?.sock) {
    try { await session.sock.logout(); } catch {}
    try { session.sock.end(undefined); } catch {}
  }
  await fs.rm(path.join(BASE, ownerId), { recursive: true, force: true });
  await setStatus(ownerId, "not_connected", null);
}
async function readJson(req) {
  const parts = [];
  let size = 0;
  for await (const p of req) {
    size += p.length;
    if (size > 12000) throw new Error("Request too large");
    parts.push(p);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
await fs.mkdir(BASE, { recursive: true, mode: 0o700 });
http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      return send(res, 200, { status: "ok" });
    }
    if (req.headers["x-bridge-key"] !== secret) return send(res, 401, { error: "Unauthorized" });
    const rawPath = new URL(req.url, "http://internal");
    if (!rawPath.pathname.startsWith("/v1/")) return send(res, 404, { error: "Not found" });
    const body = req.method === "POST" ? await readJson(req) : {};
    const ownerId = req.method === "POST" ? body.ownerId : rawPath.searchParams.get("ownerId");
    if (!uuid(ownerId)) return send(res, 400, { error: "Invalid session identity" });
    if (rawPath.pathname === "/v1/status" && req.method === "GET") {
      const instance = sessions.get(ownerId);
      const box = await inbox(ownerId);
      return send(res, 200, {
        status: instance?.status || box?.connection_status || "not_connected",
        qr: instance?.qr || null, phone: instance?.phone || box?.connected_phone || null,
        ready: !!instance && instance.status === "connected"
      });
    }
    if (!(await inbox(ownerId))) return send(res, 404, { error: "Private inbox not found" });
    if (rawPath.pathname === "/v1/connect" && req.method === "POST") {
      const instance = await start(ownerId);
      return send(res, 200, { status: instance.status, qr: instance.qr, phone: instance.phone });
    }
    if (rawPath.pathname === "/v1/disconnect" && req.method === "POST") {
      await unlink(ownerId);
      return send(res, 200, { status: "not_connected" });
    }
    if (rawPath.pathname === "/v1/send" && req.method === "POST") {
      const instance = sessions.get(ownerId);
      if (!instance || instance.status !== "connected" || !instance.sock)
        return send(res, 409, { error: "WhatsApp no está conectado" });
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000 ||
          typeof body.remoteJid !== "string" || !/^\d{6,18}@s\.whatsapp\.net$/.test(body.remoteJid))
        return send(res, 400, { error: "Mensaje o número inválido" });
      const msg = await instance.sock.sendMessage(body.remoteJid, { text: body.text.trim() });
      if (msg) await saveMessage(ownerId, msg);
      return send(res, 200, { sent: true });
    }
    return send(res, 404, { error: "Not found" });
  } catch (err) {
    logger.error({ error: String(err) }, "Private WhatsApp bridge request error");
    return send(res, 500, { error: "Error de conexión privada" });
  }
}).listen(PORT, "0.0.0.0", () => logger.info("Private WhatsApp bridge listening"));
for (const item of await fs.readdir(BASE, { withFileTypes: true })) {
  if (item.isDirectory() && uuid(item.name)) {
    void inbox(item.name).then(box => { if (box) return start(item.name); })
      .catch(err => logger.warn({ error: String(err) }, "Session resume failed"));
  }
}
