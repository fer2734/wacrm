import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function sameKey(received: string | null, expected: string | undefined) {
  if (!received || !expected || expected.length < 32) return false;
  const actual = Buffer.from(received);
  const intended = Buffer.from(expected);
  return actual.length === intended.length && timingSafeEqual(actual, intended);
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server database configuration missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  if (!sameKey(request.headers.get("x-bridge-key"), process.env.PRIVATE_WA_BRIDGE_KEY))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const ownerId = payload.ownerId;
  if (!uuid(ownerId)) return NextResponse.json({ error: "Invalid owner" }, { status: 400 });
  try {
    const db = admin();
    const { data: inbox, error: inboxError } = await db.from("private_whatsapp_inboxes")
      .select("id,owner_user_id,connection_status,connected_phone,sync_offset")
      .eq("owner_user_id", ownerId).maybeSingle();
    if (inboxError) throw inboxError;
    if (payload.action === "inbox")
      return NextResponse.json({ inbox: inbox || null });
    if (!inbox) return NextResponse.json({ error: "Private inbox not found" }, { status: 404 });

    if (payload.action === "cursor") {
      return NextResponse.json({ offset: Number(inbox.sync_offset) });
    }
    if (payload.action === "batch") {
      const expected = Number(payload.expectedOffset);
      const next = Number(payload.nextOffset);
      if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(next) ||
          expected < 0 || next < expected ||
          !Array.isArray(payload.events) || payload.events.length > 800)
        return NextResponse.json({ error: "Invalid journal batch" }, { status: 400 });
      const { data, error } = await db.rpc("ingest_private_whatsapp_batch", {
        p_owner: ownerId,
        p_expected_offset: expected,
        p_next_offset: next,
        p_events: payload.events
      });
      if (error) throw error;
      if (!data?.conflict) {
        const enriched = await db.rpc("apply_private_whatsapp_profiles", {
          p_owner: ownerId, p_events: payload.events
        });
        if (enriched.error) console.warn("Private WhatsApp profile enrichment:", enriched.error.message);
      }
      return NextResponse.json(data);
    }
    if (payload.action === "profile-batch") {
      if (!Array.isArray(payload.events) || payload.events.length > 800)
        return NextResponse.json({ error: "Invalid profile batch" }, { status: 400 });
      const { data, error } = await db.rpc("apply_private_whatsapp_profiles", {
        p_owner: ownerId, p_events: payload.events
      });
      if (error) throw error;
      return NextResponse.json({ enriched: Number(data || 0) });
    }
    if (payload.action === "unresolved") {
      const { data, error } = await db.from("private_whatsapp_chats")
        .select("remote_jid").eq("owner_user_id", ownerId).eq("inbox_id", inbox.id)
        .like("remote_jid", "%@lid").is("phone_jid", null).limit(2500);
      if (error) throw error;
      return NextResponse.json({ jids: (data || []).map(row => row.remote_jid) });
    }

    if (payload.action === "status") {
      const status = payload.status;
      if (!["not_connected", "connecting", "qr", "connected", "disconnected"].includes(String(status)))
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      const update: Record<string, unknown> = {
        connection_status: status, updated_at: new Date().toISOString()
      };
      if (payload.phone === null || typeof payload.phone === "string")
        update.connected_phone = payload.phone;
      const { error } = await db.from("private_whatsapp_inboxes")
        .update(update).eq("id", inbox.id).eq("owner_user_id", ownerId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (payload.action === "message") {
      const jid = payload.remoteJid;
      const messageId = payload.whatsappMessageId;
      const text = payload.text;
      if (typeof jid !== "string" || !/^\d{6,18}@s\.whatsapp\.net$/.test(jid) ||
          typeof messageId !== "string" || messageId.length > 200 ||
          typeof text !== "string" || text.length > 10000 ||
          typeof payload.fromMe !== "boolean")
        return NextResponse.json({ error: "Invalid message" }, { status: 400 });
      const displayName = typeof payload.senderName === "string" ? payload.senderName.slice(0, 180) : "";
      const date = typeof payload.sentAt === "string" && !Number.isNaN(Date.parse(payload.sentAt))
        ? new Date(payload.sentAt).toISOString() : new Date().toISOString();

      const { data: initialChat, error: chatError } = await db.from("private_whatsapp_chats")
        .select("id,contact_name,last_message_at,unread_count")
        .eq("owner_user_id", ownerId).eq("inbox_id", inbox.id).eq("remote_jid", jid).maybeSingle();
      if (chatError) throw chatError;
      let chat = initialChat;
      if (!chat) {
        const { error: createError } = await db.from("private_whatsapp_chats").upsert({
          inbox_id: inbox.id, owner_user_id: ownerId, remote_jid: jid,
          contact_name: displayName || jid.split("@")[0],
          last_message_text: text, last_message_at: date
        }, { onConflict: "inbox_id,remote_jid", ignoreDuplicates: true });
        if (createError) throw createError;
        const result = await db.from("private_whatsapp_chats")
          .select("id,contact_name,last_message_at,unread_count")
          .eq("owner_user_id", ownerId).eq("inbox_id", inbox.id).eq("remote_jid", jid).single();
        if (result.error) throw result.error;
        chat = result.data;
      }
      const { data: saved, error: messageError } = await db.from("private_whatsapp_messages").upsert({
        chat_id: chat.id, inbox_id: inbox.id, owner_user_id: ownerId,
        whatsapp_message_id: messageId, from_me: payload.fromMe,
        message_text: text, sent_at: date, message_type: "text"
      }, { onConflict: "chat_id,whatsapp_message_id", ignoreDuplicates: true })
        .select("id").maybeSingle();
      if (messageError) throw messageError;
      if (saved) {
        const isNewest = !chat.last_message_at || Date.parse(date) >= Date.parse(chat.last_message_at);
        const changes: Record<string, unknown> = {
          unread_count: chat.unread_count + (payload.fromMe ? 0 : 1)
        };
        if (isNewest) {
          changes.last_message_at = date;
          changes.last_message_text = text;
        }
        if (displayName && (!chat.contact_name || chat.contact_name === jid.split("@")[0]))
          changes.contact_name = displayName;
        const { error: updateError } = await db.from("private_whatsapp_chats").update(changes)
          .eq("id", chat.id).eq("owner_user_id", ownerId);
        if (updateError) throw updateError;
      }
      return NextResponse.json({ ok: true, inserted: !!saved });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Private WhatsApp internal callback failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Server could not process private WhatsApp update" }, { status: 500 });
  }
}
