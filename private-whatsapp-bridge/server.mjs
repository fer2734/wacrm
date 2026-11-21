import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState as loadWhatsAppAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT || 3081);
const BASE = process.env.SESSION_DIR || "/data/wa-sessions";
const secret = process.env.PRIVATE_WA_BRIDGE_KEY;
const callbackUrl = process.env.CRM_CALLBACK_URL;
if (!secret || secret.length < 32 || !callbackUrl || !(/^(https:\/\/[^/]+|http:\/\/wacrm_wacrm:3000)\/api\/private-whatsapp\/internal$/.test(callbackUrl))) {
  throw new Error("Missing private WhatsApp key or authenticated CRM callback URL.");
}
const sessions = new Map();
// Keep WhatsApp events in a durable per-user journal; the authenticated
// CRM pulls and commits them. Failed callbacks cannot discard messages.
const appendInFlight = new Map();
const allowedJid = jid => typeof jid === "string" &&
  /^(?:[0-9]{6,20}@(s\.whatsapp\.net|lid)|[0-9]{5,20}-[0-9]{4,20}@g\.us)$/.test(jid);
async function appendEvents(ownerId, events) {
  if (!events.length) return;
  const folder = path.join(BASE, ownerId);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const output = events.map(event => JSON.stringify(event)).join("\n") + "\n";
  const previous = appendInFlight.get(ownerId) || Promise.resolve();
  const current = previous.catch(() => {}).then(() =>
    fs.appendFile(path.join(folder, "events.jsonl"), output, { mode: 0o600 })
  );
  appendInFlight.set(ownerId, current);
  try { await current; }
  finally { if (appendInFlight.get(ownerId) === current) appendInFlight.delete(ownerId); }
}
async function readEvents(ownerId, offset) {
  const filename = path.join(BASE, ownerId, "events.jsonl");
  let size;
  try { size = (await fs.stat(filename)).size; }
  catch (err) {
    if (err?.code === "ENOENT") return { events: [], nextOffset: 0, hasMore: false };
    throw err;
  }
  // An unexpected journal replacement is safe to replay: the CRM uses
  // ON CONFLICT DO NOTHING and only acknowledges fully committed batches.
  const startOffset = Number.isSafeInteger(offset) && offset >= 0 && offset <= size ? offset : 0;
  if (startOffset === size) return { events: [], nextOffset: size, hasMore: false };
  const handle = await fs.open(filename, "r");
  let used = 0, events = [];
  try {
    const bytes = Math.min(512 * 1024, size - startOffset);
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, startOffset);
    const newline = buf.subarray(0, bytesRead).lastIndexOf(10);
    if (newline < 0) throw new Error("Private WhatsApp journal record exceeds 512 KB");
    const complete = buf.subarray(0, newline + 1).toString("utf8").split("\n");
    for (const line of complete) {
      if (!line) continue;
      const n = Buffer.byteLength(line + "\n");
      if (events.length >= 200) break;
      events.push(JSON.parse(line));
      used += n;
    }
  } finally { await handle.close(); }
  return { events, nextOffset: startOffset + used, hasMore: startOffset + used < size };
}

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
async function crm(action, payload) {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: { "x-bridge-key": secret, "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "CRM private callback failed: " + response.status);
  return data;
}
async function setStatus(ownerId, status, phone) {
  try { await crm("status", { ownerId, status, ...(phone !== undefined ? { phone } : {}) }); }
  catch (err) { logger.warn({ error: String(err) }, "Could not sync WhatsApp status"); }
}
async function inbox(ownerId) {
  const result = await crm("inbox", { ownerId });
  return result.inbox || null;
}
function extractText(message) {
  const m = message?.ephemeralMessage?.message || message?.viewOnceMessage?.message || message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || (m.imageMessage ? "📷 Imagen" : "") ||
    (m.audioMessage ? "🎤 Audio" : "") || (m.documentMessage ? "📄 Documento" : "") ||
    (m.stickerMessage ? "Sticker" : "") || "";
}
function normalizeWhatsAppMessage(msg, isHistory = false, names = null) {
  const jid = msg?.key?.remoteJid;
  if (!allowedJid(jid) || typeof msg?.key?.id !== "string" || !msg.message) return null;
  const ts = Number(msg.messageTimestamp?.toString?.() || msg.messageTimestamp || 0);
  const sentAt = ts > 0 && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const senderName = (names?.get(jid) || msg.pushName || "").slice(0, 180);
  const text = String(extractText(msg.message)).slice(0, 10000);
  return { kind: "message", remoteJid: jid, whatsappMessageId: msg.key.id,
    fromMe: !!msg.key.fromMe, text, senderName, sentAt, isHistory };
}
async function saveMessages(ownerId, messages, isHistory = false, names = null) {
  const normalized = (messages || [])
    .map(msg => normalizeWhatsAppMessage(msg, isHistory, names))
    .filter(Boolean);
  await appendEvents(ownerId, normalized);
  const session = sessions.get(ownerId);
  if (session) {
    session.messageEvents = (session.messageEvents || 0) + normalized.length;
    session.lastEventAt = new Date().toISOString();
  }
}
async function start(ownerId) {
  const prev = sessions.get(ownerId);
  if (prev && ["connecting", "qr", "connected"].includes(prev.status)) return prev;
  const folder = path.join(BASE, ownerId);
  try {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger.error({ error: String(err) }, "Cannot create WhatsApp session folder");
    throw Object.assign(new Error("No se puede escribir el almacenamiento privado de sesiones"), { code: "SESSION_STORAGE" });
  }
  let state, saveCreds;
  try {
    ({ state, saveCreds } = await loadWhatsAppAuthState(folder));
  } catch (err) {
    logger.error({ error: String(err) }, "Cannot read WhatsApp session authentication");
    throw Object.assign(new Error("No se pudo abrir la sesión de WhatsApp"), { code: "SESSION_AUTH" });
  }
  const session = { sock: null, status: "connecting", qr: null, phone: null, restarting: false };
  sessions.set(ownerId, session);
  let sock;
  try {
    sock = makeWASocket({
      auth: state, logger, printQRInTerminal: false,
      browser: Browsers.macOS("Desktop"),
      syncFullHistory: true,
      markOnlineOnConnect: false
    });
  } catch (err) {
    sessions.delete(ownerId);
    logger.error({ error: String(err) }, "WhatsApp Web socket failed to initialize");
    throw Object.assign(new Error("No se pudo iniciar el cliente WhatsApp Web"), { code: "WA_SOCKET_INIT" });
  }
  session.sock = sock;
  const names = new Map();
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("contacts.upsert", contacts => {
    const headers = [];
    for (const c of contacts || []) {
      if (c.id && (c.name || c.notify)) {
        const display = String(c.name || c.notify).slice(0, 180);
        names.set(c.id, display);
        if (allowedJid(c.id)) headers.push({ kind: "chat", remoteJid: c.id, senderName: display });
      }
    }
    void appendEvents(ownerId, headers).catch(err => {
      session.lastError = "No se pudieron guardar nombres de contactos";
      logger.warn({ error: String(err) }, "Private WhatsApp contacts journal failed");
    });
  });
  sock.ev.on("chats.upsert", chats => {
    const headers = (chats || []).filter(c => allowedJid(c.id)).map(c => ({
      kind: "chat", remoteJid: c.id,
      senderName: String(names.get(c.id) || c.name || c.id.split("@")[0]).slice(0, 180)
    }));
    void appendEvents(ownerId, headers).catch(err => {
      session.lastError = "No se pudo guardar el listado de chats";
      logger.warn({ error: String(err) }, "Private WhatsApp chat headers journal failed");
    });
  });
  sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest, progress }) => {
    try {
      for (const c of contacts || []) {
        if (c.id && (c.name || c.notify)) names.set(c.id, String(c.name || c.notify));
      }
      const chatEvents = (chats || []).filter(c => allowedJid(c.id)).map(c => ({
        kind: "chat", remoteJid: c.id, senderName:
          String(names.get(c.id) || c.name || c.id.split("@")[0]).slice(0, 180)
      }));
      await appendEvents(ownerId, chatEvents);
      await saveMessages(ownerId, messages, true, names);
      session.historyEvents = (session.historyEvents || 0) + (messages?.length || 0);
      session.historyProgress = progress ?? null;
      session.historyFinished = !!isLatest;
    } catch (err) {
      session.lastError = "No se pudo guardar un bloque del historial";
      logger.error({ error: String(err) }, "WhatsApp history persistence failed");
    }
  });
  sock.ev.on("messages.upsert", async payload => {
    try { await saveMessages(ownerId, payload.messages || [], payload.type !== "notify", names); }
    catch (err) {
      session.lastError = "No se pudieron guardar mensajes recibidos";
      logger.error({ error: String(err) }, "Private message journal failed");
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
      return send(res, 200, {
        status: instance?.status || "not_connected",
        qr: instance?.qr || null, phone: instance?.phone || null,
        ready: !!instance && instance.status === "connected",
        historyEvents: instance?.historyEvents || 0,
        messageEvents: instance?.messageEvents || 0,
        historyProgress: instance?.historyProgress ?? null,
        historyFinished: !!instance?.historyFinished,
        lastError: instance?.lastError || null
      });
    }
    // The CRM already authenticates the user, ensures this inbox exists,
    // and forwards the request with a server-to-server secret. A reverse
    // database callback is NOT needed to initiate or poll a QR session.
    if (rawPath.pathname === "/v1/events" && req.method === "GET") {
      const offset = Number(rawPath.searchParams.get("offset") || "0");
      if (!Number.isSafeInteger(offset) || offset < 0) return send(res, 400, { error: "Invalid cursor" });
      return send(res, 200, await readEvents(ownerId, offset));
    }
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
          !allowedJid(body.remoteJid))
        return send(res, 400, { error: "Mensaje o número inválido" });
      const msg = await instance.sock.sendMessage(body.remoteJid, { text: body.text.trim() });
      if (msg) await saveMessages(ownerId, [msg], false);
      return send(res, 200, { sent: true });
    }
    return send(res, 404, { error: "Not found" });
  } catch (err) {
    logger.error({ error: String(err) }, "Private WhatsApp bridge request error");
    const code = typeof err?.code === "string" && ["SESSION_STORAGE", "SESSION_AUTH", "WA_SOCKET_INIT"].includes(err.code)
      ? err.code : "PRIVATE_WA_REQUEST_FAILED";
    const error = code === "PRIVATE_WA_REQUEST_FAILED" ? "No se pudo procesar la conexión privada" : String(err.message);
    return send(res, 500, { error, code });
  }
}).listen(PORT, "0.0.0.0", () => logger.info("Private WhatsApp bridge listening"));
for (const item of await fs.readdir(BASE, { withFileTypes: true })) {
  if (item.isDirectory() && uuid(item.name)) {
    // Only user-UUID directories persisted by the CRM can be resumed.
    // Do not depend on a reverse CRM callback to resume WhatsApp on reboot.
    void start(item.name).catch(err => logger.warn({ error: String(err) }, "Session resume failed"));
  }
}
