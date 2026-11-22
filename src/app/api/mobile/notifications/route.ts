import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MobileEvent = {
  id: string;
  kind: "assignment" | "message" | "task";
  title: string;
  body: string;
  href: string;
  time: string;
};

// The Android app shares the existing Supabase SSR web session through WebView
// cookies. No API key, service-role token or customer credentials are embedded
// in the APK. This endpoint NEVER accepts a target user/account from the client.
export async function GET(request: NextRequest) {
  const checkedAt = new Date();
  const sec = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
  try {
    const db = await createClient();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Iniciá sesión en el CRM." }, { status: 401, headers: sec });
    }

    const { data: profile, error: profileError } = await db
      .from("profiles").select("account_id").eq("user_id", user.id).maybeSingle();
    if (profileError || !profile?.account_id) {
      return NextResponse.json({ error: "Usuario sin cuenta activa." }, { status: 403, headers: sec });
    }

    // Allow at most a week of catch-up, and never a timestamp in the future.
    const requested = Number(request.nextUrl.searchParams.get("after"));
    const nowMs = checkedAt.getTime();
    const cutoffMs = Number.isFinite(requested) && requested > 0
      ? Math.min(nowMs, Math.max(nowMs - 7 * 86400000, requested))
      : nowMs - 2000;
    const after = new Date(cutoffMs).toISOString();
    const before = checkedAt.toISOString();
    const events: MobileEvent[] = [];

    const assignments = await db.from("notifications")
      .select("id,created_at,conversation_id")
      .eq("user_id", user.id).eq("account_id", profile.account_id)
      .gt("created_at", after).lte("created_at", before)
      .order("created_at", { ascending: true }).limit(40);
    if (assignments.error) throw assignments.error;
    for (const item of assignments.data || []) {
      events.push({
        id: "a:" + item.id, kind: "assignment",
        title: "Conversación asignada",
        body: "Tenés una conversación nueva para atender.",
        href: item.conversation_id ? "/inbox?c=" + encodeURIComponent(item.conversation_id) : "/notifications",
        time: item.created_at,
      });
    }

    // Explicitly require assignment to this agent. Some historical CRM
    // message RLS grants account-wide read access, which is broader than
    // the notification audience and must not be used as an authorization.
    const conversations = await db.from("conversations")
      .select("id").eq("account_id", profile.account_id)
      .eq("assigned_agent_id", user.id)
      .gt("last_message_at", after)
      .limit(150);
    if (conversations.error) throw conversations.error;
    const conversationIds = (conversations.data || []).map((c) => c.id);
    if (conversationIds.length) {
      const messages = await db.from("messages")
        .select("id,conversation_id,content_type,created_at")
        .in("conversation_id", conversationIds)
        .eq("sender_type", "customer")
        .gt("created_at", after).lte("created_at", before)
        .order("created_at", { ascending: true }).limit(60);
      if (messages.error) throw messages.error;
      for (const msg of messages.data || []) {
        events.push({
          id: "m:" + msg.id, kind: "message",
          title: msg.content_type === "audio" ? "Nuevo audio de cliente" : "Nuevo mensaje de cliente",
          body: "Abrí el CRM para responder.",
          href: "/inbox?c=" + encodeURIComponent(msg.conversation_id),
          time: msg.created_at,
        });
      }
    }

    // Reminders only for assigned salesperson; no other user's tasks appear.
    const tasks = await db.from("erp_tasks")
      .select("id,sale_id,title,due_at")
      .eq("account_id", profile.account_id).eq("assigned_to", user.id)
      .in("status", ["pendiente", "en_proceso"])
      .gt("due_at", after).lte("due_at", before)
      .order("due_at", { ascending: true }).limit(40);
    if (tasks.error) throw tasks.error;
    for (const item of tasks.data || []) {
      events.push({
        id: "t:" + item.id, kind: "task",
        title: "Seguimiento pendiente",
        body: item.title?.slice(0, 120) || "Tenés una gestión programada.",
        href: "/erp/avanzado",
        time: item.due_at,
      });
    }

    events.sort((a, b) => a.time.localeCompare(b.time));
    return NextResponse.json({
      userId: user.id,
      checkedAt: before,
      events: events.slice(-100),
    }, { status: 200, headers: sec });
  } catch (error) {
    console.error("[mobile-notifications] failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudieron consultar las notificaciones." },
      { status: 503, headers: sec });
  }
}
