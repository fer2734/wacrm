import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// User-initiated sync: pull the durable journal from the bridge, then
// acknowledge its byte offset ONLY after the database has committed.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type JournalEvent = {
  kind: "message" | "chat";
  remoteJid: string;
  whatsappMessageId?: string;
  fromMe?: boolean;
  text?: string;
  senderName?: string;
  sentAt?: string;
  isHistory?: boolean;
};
type ChatRow = {
  id: string;
  remote_jid: string;
  contact_name: string;
  last_message_at: string | null;
  unread_count: number;
};
const validJid = (jid: unknown): jid is string =>
  typeof jid === "string" &&
  /^(?:[0-9]{6,20}@(s\.whatsapp\.net|lid)|[0-9]{5,20}-[0-9]{4,20}@g\.us)$/.test(jid);

function serviceAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase configuration");
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

export async function POST() {
  const session = await createClient();
  const { data: { user }, error: authError } = await session.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });

  const bridgeUrl = process.env.PRIVATE_WA_BRIDGE_URL;
  const bridgeKey = process.env.PRIVATE_WA_BRIDGE_KEY;
  if (!bridgeUrl || !bridgeKey)
    return NextResponse.json({ error: "El servicio privado no está configurado" }, { status: 503 });

  try {
    const admin = serviceAdmin();
    const { data: inbox, error: inboxError } = await admin
      .from("private_whatsapp_inboxes")
      .select("id,owner_user_id,sync_offset")
      .eq("owner_user_id", user.id).maybeSingle();
    if (inboxError) throw inboxError;
    if (!inbox)
      return NextResponse.json({ error: "Vinculá tu WhatsApp antes de sincronizar" }, { status: 404 });

    const offset = Number(inbox.sync_offset);
    if (!Number.isSafeInteger(offset) || offset < 0)
      return NextResponse.json({ error: "La posición de sincronización es inválida" }, { status: 500 });

    const url = new URL("/v1/events", bridgeUrl);
    url.searchParams.set("ownerId", user.id);
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { "x-bridge-key": bridgeKey },
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });
    const batch = await response.json().catch(() => null);
    if (!response.ok || !batch || !Array.isArray(batch.events))
      return NextResponse.json({
        error: typeof batch?.error === "string" ? batch.error : "El conector no pudo entregar los mensajes"
      }, { status: 502 });

    const nextOffset = Number(batch.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0)
      throw new Error("Invalid bridge journal offset");

    const events: JournalEvent[] = batch.events.slice(0, 200)
      .filter((e: unknown): e is JournalEvent => {
        if (!e || typeof e !== "object") return false;
        const row = e as JournalEvent;
        return (row.kind === "message" || row.kind === "chat") && validJid(row.remoteJid);
      });
    const jids = [...new Set(events.map(e => e.remoteJid))];
    let imported = 0;

    if (jids.length) {
      // Enforce ownership in *every* lookup and write, including privileged
      // writes. No other agent's conversations can be imported or queried.
      const { data: known, error: lookupError } = await admin
        .from("private_whatsapp_chats")
        .select("id,remote_jid,contact_name,last_message_at,unread_count")
        .eq("inbox_id", inbox.id).eq("owner_user_id", user.id)
        .in("remote_jid", jids);
      if (lookupError) throw lookupError;
      const found = new Set((known || []).map(c => c.remote_jid));
      const create = jids.filter(jid => !found.has(jid)).map(jid => {
        const event = events.find(e => e.remoteJid === jid && e.senderName);
        return {
          inbox_id: inbox.id, owner_user_id: user.id, remote_jid: jid,
          contact_name: (event?.senderName || jid.split("@")[0]).slice(0, 180)
        };
      });
      if (create.length) {
        const { error } = await admin.from("private_whatsapp_chats")
          .upsert(create, { onConflict: "inbox_id,remote_jid", ignoreDuplicates: true });
        if (error) throw error;
      }
      const { data: chats, error: chatsError } = await admin
        .from("private_whatsapp_chats")
        .select("id,remote_jid,contact_name,last_message_at,unread_count")
        .eq("inbox_id", inbox.id).eq("owner_user_id", user.id)
        .in("remote_jid", jids);
      if (chatsError) throw chatsError;
      const byJid = new Map((chats as ChatRow[] || []).map(c => [c.remote_jid, c]));

      const messages = events
        .filter(e => e.kind === "message" &&
          typeof e.whatsappMessageId === "string" &&
          e.whatsappMessageId.length > 0 && e.whatsappMessageId.length <= 200 &&
          typeof e.fromMe === "boolean" &&
          typeof e.sentAt === "string" && !Number.isNaN(Date.parse(e.sentAt)) &&
          typeof e.text === "string" && e.text.length <= 10000 &&
          byJid.has(e.remoteJid))
        .map(e => ({
          chat_id: byJid.get(e.remoteJid)!.id,
          inbox_id: inbox.id,
          owner_user_id: user.id,
          whatsapp_message_id: e.whatsappMessageId!,
          from_me: e.fromMe!,
          message_text: e.text!,
          message_type: "text",
          sent_at: new Date(e.sentAt!).toISOString()
        }));
      if (messages.length) {
        const { data: inserted, error: insertError } = await admin
          .from("private_whatsapp_messages")
          .upsert(messages, { onConflict: "chat_id,whatsapp_message_id", ignoreDuplicates: true })
          .select("id,chat_id,whatsapp_message_id,from_me");
        if (insertError) throw insertError;
        imported = inserted?.length || 0;

        const recent = new Map<string, { date: string; text: string; name: string }>();
        for (const e of events) {
          if (e.kind !== "message" || !e.sentAt || !byJid.has(e.remoteJid)) continue;
          const last = recent.get(e.remoteJid);
          if (!last || Date.parse(e.sentAt) >= Date.parse(last.date))
            recent.set(e.remoteJid, {
              date: e.sentAt,
              text: String(e.text || "").slice(0, 10000),
              name: String(e.senderName || "").slice(0, 180)
            });
        }
        const insertedIds = new Set((inserted || []).map(row => row.whatsapp_message_id + ":" + row.chat_id));
        for (const jid of jids) {
          const chat = byJid.get(jid);
          if (!chat) continue;
          const latest = recent.get(jid);
          const name = events.find(e => e.remoteJid === jid && e.senderName)?.senderName;
          const update: Record<string, unknown> = {};
          if (latest && (!chat.last_message_at || Date.parse(latest.date) >= Date.parse(chat.last_message_at))) {
            update.last_message_at = latest.date;
            update.last_message_text = latest.text;
          }
          if (name && (!chat.contact_name || chat.contact_name === jid.split("@")[0]))
            update.contact_name = String(name).slice(0, 180);
          const newIncoming = events.filter(e =>
            e.kind === "message" && e.remoteJid === jid && !e.fromMe &&
            !e.isHistory &&
            insertedIds.has(e.whatsappMessageId + ":" + chat.id)).length;
          if (newIncoming) update.unread_count = chat.unread_count + newIncoming;
          if (Object.keys(update).length) {
            const { error: updateError } = await admin.from("private_whatsapp_chats")
              .update(update).eq("id", chat.id).eq("owner_user_id", user.id);
            if (updateError) throw updateError;
          }
        }
      } else {
        // Chat headers may be synchronized before WhatsApp delivers
        // their messages; preserve the contact names in that case.
        for (const jid of jids) {
          const chat = byJid.get(jid);
          const name = events.find(e => e.remoteJid === jid && e.senderName)?.senderName;
          if (chat && name && (!chat.contact_name || chat.contact_name === jid.split("@")[0])) {
            const { error: updateError } = await admin.from("private_whatsapp_chats")
              .update({ contact_name: String(name).slice(0, 180) })
              .eq("id", chat.id).eq("owner_user_id", user.id);
            if (updateError) throw updateError;
          }
        }
      }
    }

    const { error: offsetError } = await admin.from("private_whatsapp_inboxes")
      .update({ sync_offset: nextOffset, last_sync_at: new Date().toISOString() })
      .eq("id", inbox.id).eq("owner_user_id", user.id).eq("sync_offset", offset);
    if (offsetError) throw offsetError;
    return NextResponse.json({
      imported, processed: events.length, hasMore: !!batch.hasMore,
      advanced: nextOffset !== offset
    });
  } catch (error) {
    console.error("[private-whatsapp/sync]", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "No se pudo sincronizar la bandeja privada" }, { status: 500 });
  }
}
