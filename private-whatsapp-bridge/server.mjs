import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, useMultiFileAuthState as loadWhatsAppAuthState } from "@whiskeysockets/baileys";
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
const pairingAttempts = new Map();
const erasedOwners = new Set();
const MAX_PAIRED_RETRIES = 4;
const QR_WAIT_MS = 30000;
const explainCode = code => {
  if (code === 401) return "WhatsApp cerró la sesión (401). Generá un nuevo QR.";
  if (code === 405) return "WhatsApp rechazó la versión del cliente (405). Revisá la versión de WhatsApp Web.";
  if (code === 428) return "WhatsApp interrumpió la conexión antes del QR (428). Generá un nuevo QR.";
  if (code === 515) return "WhatsApp solicitó reiniciar la conexión después de vincular el dispositivo.";
  if (code === 403) return "WhatsApp rechazó la vinculación (403). Revisá los dispositivos vinculados.";
  if (code === 408) return "La conexión expiró antes de vincular el dispositivo (408).";
  return code ? "WhatsApp cerró la conexión (código " + code + "). Probá generar un QR nuevo." :
    "WhatsApp cerró la conexión antes de completar la vinculación.";
};
// Keep WhatsApp events in a durable per-user journal; the authenticated
// CRM pulls and commits them. Failed callbacks cannot discard messages.
const appendInFlight = new Map();
const allowedJid = jid => typeof jid === "string" &&
  /^(?:[0-9]{6,20}@(s\.whatsapp\.net|lid)|[0-9]{5,20}-[0-9]{4,20}@g\.us)$/.test(jid);
async function appendEvents(ownerId, events) {
  if (!events.length || erasedOwners.has(ownerId)) return;
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
    if (err?.code === "ENOENT") return { events: [], nextOffset: 0, hasMore: false, journalBytes: 0 };
    throw err;
  }
  // An unexpected journal replacement is safe to replay: the CRM uses
  // ON CONFLICT DO NOTHING and only acknowledges fully committed batches.
  const startOffset = Number.isSafeInteger(offset) && offset >= 0 && offset <= size ? offset : 0;
  if (startOffset === size) return { events: [], nextOffset: size, hasMore: false, journalBytes: size };
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
      if (events.length >= 800) break;
      events.push(JSON.parse(line));
      used += n;
    }
  } finally { await handle.close(); }
  return { events, nextOffset: startOffset + used, hasMore: startOffset + used < size, journalBytes: size };
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
function knownPhone(value) {
  return typeof value === "string" && /^[0-9]{6,20}@s\.whatsapp\.net$/.test(value)
    ? value : null;
}
function normalizedContact(contact, names) {
  if (!contact || typeof contact.id !== "string") return null;
  const lid = contact.id.endsWith("@lid") ? contact.id :
    typeof contact.lid === "string" ? contact.lid : contact.id;
  if (!allowedJid(lid)) return null;
  const name = String(contact.name || contact.verifiedName || contact.notify || "").trim().slice(0, 120);
  const profileName = String(contact.notify || contact.pushName || contact.verifiedName || "").trim().slice(0, 120);
  const phoneJid = knownPhone(contact.phoneNumber) ||
    knownPhone(contact.id) || knownPhone(contact.pnJid);
  if (name) names.set(lid, name);
  if (name && phoneJid) names.set(phoneJid, name);
  return { kind: "contact", remoteJid: lid, senderName: name, profileName, phoneJid };
}
function normalizeWhatsAppMessage(msg, isHistory = false, names = null) {
  const jid = msg?.key?.remoteJid;
  if (!allowedJid(jid) || typeof msg?.key?.id !== "string" || !msg.message) return null;
  const ts = Number(msg.messageTimestamp?.toString?.() || msg.messageTimestamp || 0);
  const sentAt = ts > 0 && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const profileName = !msg.key?.fromMe ? String(msg.pushName || "").trim().slice(0, 120) : "";
  const senderName = String(names?.get(jid) || profileName || "").slice(0, 120);
  const phoneJid = knownPhone(msg.key?.remoteJidAlt) || knownPhone(msg.key?.senderPn) || null;
  const text = String(extractText(msg.message)).slice(0, 10000);
  return { kind: "message", remoteJid: jid, whatsappMessageId: msg.key.id,
    fromMe: !!msg.key.fromMe, text, senderName, profileName, phoneJid, sentAt, isHistory };
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
// Re-pairing may delete Baileys credentials but MUST never delete the
// durable inbound events journal: the CRM might not have imported it yet.
async function clearPairingCredentials(ownerId) {
  const folder = path.join(BASE, ownerId);
  await appendInFlight.get(ownerId)?.catch(() => {});
  let files;
  try { files = await fs.readdir(folder, { withFileTypes: true }); }
  catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const file of files) {
    if (file.name === "events.jsonl") continue;
    await fs.rm(path.join(folder, file.name), { recursive: true, force: true });
  }
}
async function restartPairing(ownerId) {
  const current = sessions.get(ownerId);
  pairingAttempts.delete(ownerId);
  sessions.delete(ownerId);
  if (current?.sock) {
    try { current.sock.end(undefined); } catch {}
  }
  await clearPairingCredentials(ownerId);
  await setStatus(ownerId, "not_connected", null);
  return start(ownerId);
}
// Import from the VPS even when nobody has the CRM tab open.
const ownerSyncInFlight = new Set();
async function flushPrivateJournal(ownerId) {
  if (ownerSyncInFlight.has(ownerId)) return;
  ownerSyncInFlight.add(ownerId);
  try {
    const { offset: initialOffset } = await crm("cursor", { ownerId });
    let offset = Number(initialOffset);
    if (!Number.isSafeInteger(offset) || offset < 0) return;
    for (let n = 0; n < 8; n++) {
      const batch = await readEvents(ownerId, offset);
      if (batch.nextOffset === offset) break;
      const reply = await crm("batch", {
        ownerId, expectedOffset: offset, nextOffset: batch.nextOffset,
        events: batch.events
      });
      if (reply?.conflict) {
        offset = Number(reply.offset);
        if (!Number.isSafeInteger(offset)) break;
        continue;
      }
      offset = batch.nextOffset;
      if (!batch.hasMore) break;
    }
  } catch (err) {
    logger.warn({ error: String(err), ownerId }, "Private journal background import failed");
  } finally {
    ownerSyncInFlight.delete(ownerId);
  }
}
const profileBackfillActive = new Set();
async function backfillProfileNames(ownerId) {
  if (profileBackfillActive.has(ownerId)) return;
  profileBackfillActive.add(ownerId);
  let cursor = 0;
  let requests = 0;
  try {
    // Historic events were persisted before the profile_name field
    // existed. Replay only contact metadata, never duplicate messages.
    while (requests < 400) {
      const batch = await readEvents(ownerId, cursor);
      if (!batch.events.length || batch.nextOffset === cursor) break;
      const candidates = batch.events.filter(e => {
        if (!e || !allowedJid(e.remoteJid)) return false;
        if (e.kind !== "contact" && !(e.kind === "message" && !e.fromMe)) return false;
        const name = String(e.profileName || e.senderName || "").trim();
        return !!name && name.length < 121 && !/^[0-9]+$/.test(name);
      });
      if (candidates.length) await crm("profile-batch", { ownerId, events: candidates });
      cursor = batch.nextOffset;
      requests++;
      if (!batch.hasMore) break;
    }
    logger.info({ ownerId, requests }, "Historical profile names checked");
  } catch (err) {
    logger.warn({ error: String(err) }, "Private profile name backfill incomplete");
  } finally {
    profileBackfillActive.delete(ownerId);
  }
}
async function resolveContactsFromStore(session, jids) {
  if (!session || !session.sock || !Array.isArray(jids)) return 0;
  const events = [];
  for (const jid of jids) {
    if (!allowedJid(jid) || !jid.endsWith("@lid")) continue;
    let phoneJid = null;
    try {
      phoneJid = knownPhone(await session.sock.signalRepository?.lidMapping?.getPNForLID?.(jid));
    } catch { /* WhatsApp does not always expose a phone number for LIDs. */ }
    const name = String(session.names?.get(jid) ||
      (phoneJid ? session.names?.get(phoneJid) : "") || "").slice(0, 120);
    if (phoneJid || name)
      events.push({ kind: "contact", remoteJid: jid, phoneJid, senderName: name });
  }
  await appendEvents(session.ownerId, events);
  return events.length;
}
async function enrichKnownChats(ownerId, session) {
  try {
    const result = await crm("unresolved", { ownerId });
    const jids = Array.isArray(result?.jids) ? result.jids : [];
    for (let i = 0; i < jids.length && sessions.get(ownerId) === session; i += 150) {
      await resolveContactsFromStore(session, jids.slice(i, i + 150));
    }
  } catch (err) {
    logger.warn({ error: String(err) }, "Could not enrich private chat identifiers");
  }
}
async function start(ownerId) {
  if (erasedOwners.has(ownerId)) throw new Error("Private WhatsApp session was erased");
  const prev = sessions.get(ownerId);
  if (prev?.status === "connected" || (prev?.status === "qr" && prev.qr) ||
      (prev?.status === "connecting" && Date.now() - prev.startedAt < QR_WAIT_MS)) return prev;
  if (prev) {
    sessions.delete(ownerId);
    try { prev.sock?.end(undefined); } catch {}
  }
  // Fresh V2 WhatsApp auth state, isolated from previous failed attempts.
  // The event journal stays at BASE/ownerId/events.jsonl for recovery.
  const folder = path.join(BASE, ownerId, "auth-v2");
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
  const session = { ownerId, sock: null, status: "connecting", qr: null, phone: null, startedAt: Date.now(), lastError: null, lastCode: null, lastCloseAt: null, authReady: !!state.creds?.registered, version: null };
  sessions.set(ownerId, session);
  let sock;
  try {
    // Both the current WhatsApp Web version and WEB_BROWSER identity matter:
    // the legacy macOS Desktop identity is rejected before QR by WA (428).
    const latest = await fetchLatestWaWebVersion();
    if (!Array.isArray(latest?.version) || latest.version.length !== 3 ||
        !latest.version.every(Number.isSafeInteger)) {
      throw new Error("Invalid WhatsApp Web version response");
    }
    session.version = latest.version.join(".");
    sock = makeWASocket({
      auth: state,
      logger,
      version: latest.version,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: true,
      markOnlineOnConnect: false
    });
  } catch (err) {
    if (sessions.get(ownerId) === session) sessions.delete(ownerId);
    logger.error({ error: String(err) }, "WhatsApp Web socket failed to initialize");
    throw Object.assign(new Error("No se pudo iniciar WhatsApp Web: " + String(err instanceof Error ? err.message : err).slice(0, 120)), { code: "WA_SOCKET_INIT" });
  }
  session.sock = sock;
  const qrTimeout = setTimeout(() => {
    if (sessions.get(ownerId) !== session || session.status !== "connecting") return;
    session.status = "failed";
    session.lastCode = "QR_TIMEOUT";
    session.lastError = "No llegó un QR después de 30 segundos. Tocá Nuevo QR para reintentar.";
    try { sock.end(undefined); } catch {}
    void setStatus(ownerId, "disconnected");
  }, QR_WAIT_MS);
  const names = new Map();
  session.names = names;
  const persistContacts = async contacts => {
    const events = (contacts || [])
      .map(c => normalizedContact(c, names)).filter(Boolean);
    await appendEvents(ownerId, events);
  };
  sock.ev.on("creds.update", async () => {
    // A cancelled pairing must not re-create auth files after Nuevo QR
    // has removed them.
    if (sessions.get(ownerId) !== session) return;
    await saveCreds();
  });
  for (const eventName of ["contacts.upsert", "contacts.update"]) {
    sock.ev.on(eventName, contacts => {
      void persistContacts(contacts).catch(err => {
        session.lastError = "No se pudieron actualizar los nombres de contactos";
        logger.warn({ error: String(err) }, "WhatsApp contact mapping sync failed");
      });
    });
  }
  sock.ev.on("lid-mapping.update", mapping => {
    const mappings = Array.isArray(mapping) ? mapping : [mapping];
    const events = mappings.filter(m => allowedJid(m?.lid) && knownPhone(m?.pn))
      .map(m => ({ kind: "contact", remoteJid: m.lid,
        senderName: names.get(m.lid) || "", phoneJid: m.pn }));
    void appendEvents(ownerId, events).catch(err =>
      logger.warn({ error: String(err) }, "WhatsApp LID mapping journal failed"));
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
      await persistContacts(contacts);
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
      clearTimeout(qrTimeout);
      try {
        session.qr = await QRCode.toDataURL(update.qr, { width: 300, margin: 2 });
        if (sessions.get(ownerId) !== session) return;
        session.status = "qr";
        session.lastError = null;
        session.lastCode = null;
        await setStatus(ownerId, "qr");
      } catch (err) {
        session.qr = null;
        session.status = "failed";
        session.lastCode = "QR_RENDER";
        session.lastError = "No se pudo dibujar el código QR. Tocá Nuevo QR.";
        logger.error({ error: String(err) }, "Private QR render failed");
        await setStatus(ownerId, "disconnected");
      }
    }
    if (update.connection === "open") {
      clearTimeout(qrTimeout);
      session.status = "connected";
      session.qr = null;
      session.lastError = null;
      session.lastCode = null;
      session.authReady = true;
      pairingAttempts.delete(ownerId);
      session.phone = sock.user?.id?.split(":")[0]?.split("@")[0] || null;
      await setStatus(ownerId, "connected", session.phone);
      void enrichKnownChats(ownerId, session);
      void backfillProfileNames(ownerId);
      void flushPrivateJournal(ownerId);
    }
    if (update.connection === "close") {
      clearTimeout(qrTimeout);
      session.qr = null;
      session.status = "failed";
      session.lastCloseAt = new Date().toISOString();
      const reason = update.lastDisconnect?.error?.output?.statusCode || null;
      session.lastCode = reason;
      session.lastError = explainCode(reason);
      logger.warn({ reason, paired: !!state.creds?.registered }, "WhatsApp socket closed");
      await setStatus(ownerId, "disconnected");
      if (sessions.get(ownerId) !== session) return;
      if (reason === DisconnectReason.loggedOut) {
        sessions.delete(ownerId);
        await clearPairingCredentials(ownerId);
        session.status = "not_connected";
        session.lastError = explainCode(401);
        await setStatus(ownerId, "not_connected", null);
      } else if (reason === DisconnectReason.restartRequired ||
                 (state.creds?.registered && reason !== 403 && reason !== 405 && reason !== 428)) {
        // 515 is expected after QR is scanned. Reconnect with saved
        // credentials instead of demanding a second pairing.
        const count = (pairingAttempts.get(ownerId) || 0) + 1;
        pairingAttempts.set(ownerId, count);
        if (count <= MAX_PAIRED_RETRIES) {
          sessions.delete(ownerId);
          const delay = reason === DisconnectReason.restartRequired ? 300 : Math.min(7000, count * 1700);
          setTimeout(() => {
            void start(ownerId).catch(err => {
              logger.error({ error: String(err) }, "WhatsApp reconnect failure");
            });
          }, delay);
        } else {
          session.lastError = "No fue posible reconectar después de varios intentos. Usá Nuevo QR.";
        }
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
  await clearPairingCredentials(ownerId);
  pairingAttempts.delete(ownerId);
  await setStatus(ownerId, "not_connected", null);
}
// Full, owner-scoped erasure is separate from ordinary unlinking, which
// intentionally preserves the message journal. Never wipe another
// agent's volume or the commercial inbox.
async function eraseOwnerSession(ownerId) {
  erasedOwners.add(ownerId);
  const session = sessions.get(ownerId);
  sessions.delete(ownerId);
  pairingAttempts.delete(ownerId);
  if (session?.sock) {
    try { await session.sock.logout(); } catch (err) {
      logger.warn({ error: String(err) }, "WhatsApp logout did not complete before erasure");
    }
    try { session.sock.end(undefined); } catch {}
  }
  const inflight = appendInFlight.get(ownerId);
  if (inflight) await inflight.catch(() => {});
  await fs.rm(path.join(BASE, ownerId), { recursive: true, force: true });
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
        lastError: instance?.lastError || null,
        lastCode: instance?.lastCode || null,
        lastCloseAt: instance?.lastCloseAt || null,
        version: instance?.version || null,
        connectingSeconds: instance?.status === "connecting"
          ? Math.floor((Date.now() - instance.startedAt) / 1000) : 0
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
    if (rawPath.pathname === "/v1/resolve-contacts" && req.method === "POST") {
      const session = sessions.get(ownerId);
      if (!session || session.status !== "connected")
        return send(res, 409, { error: "WhatsApp todavía no está conectado" });
      const requested = Array.isArray(body.jids) ? body.jids.slice(0, 150) : [];
      const resolved = await resolveContactsFromStore(session, requested);
      return send(res, 200, { checked: requested.length, resolved });
    }
    if (rawPath.pathname === "/v1/connect" && req.method === "POST") {
      erasedOwners.delete(ownerId);
      const instance = await start(ownerId);
      return send(res, 200, { status: instance.status, qr: instance.qr, phone: instance.phone });
    }
    if (rawPath.pathname === "/v1/reset-pairing" && req.method === "POST") {
      const instance = await restartPairing(ownerId);
      return send(res, 200, { status: instance.status, qr: instance.qr, phone: instance.phone });
    }
    if (rawPath.pathname === "/v1/disconnect" && req.method === "POST") {
      await unlink(ownerId);
      return send(res, 200, { status: "not_connected" });
    }
    if (rawPath.pathname === "/v1/erase" && req.method === "POST") {
      if (body.confirm !== "BORRAR TODO")
        return send(res, 400, { error: "Confirmation required" });
      await eraseOwnerSession(ownerId);
      return send(res, 200, { erased: true });
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
const backgroundTimer = setInterval(() => {
  for (const ownerId of sessions.keys()) void flushPrivateJournal(ownerId);
}, 1200);
backgroundTimer.unref();
for (const item of await fs.readdir(BASE, { withFileTypes: true })) {
  if (item.isDirectory() && uuid(item.name)) {
    // Only user-UUID directories persisted by the CRM can be resumed.
    // Do not depend on a reverse CRM callback to resume WhatsApp on reboot.
    void start(item.name).catch(err => logger.warn({ error: String(err) }, "Session resume failed"));
  }
}
