import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Resolve saved WhatsApp privacy IDs using mappings that WhatsApp has
// actually provided to this user's linked device. Never guess phone numbers.
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });

  const base = process.env.PRIVATE_WA_BRIDGE_URL;
  const key = process.env.PRIVATE_WA_BRIDGE_KEY;
  if (!base || !key) return NextResponse.json({ error: "Conector privado no configurado" }, { status: 503 });

  try {
    const { data: inbox, error: inboxError } = await supabase
      .from("private_whatsapp_inboxes")
      .select("id").eq("owner_user_id", user.id).maybeSingle();
    if (inboxError || !inbox)
      return NextResponse.json({ error: "Bandeja privada no encontrada" }, { status: 404 });

    const { data: rows, error: listError } = await supabase
      .from("private_whatsapp_chats")
      .select("remote_jid").eq("inbox_id", inbox.id)
      .eq("owner_user_id", user.id)
      .like("remote_jid", "%@lid")
      .is("phone_jid", null)
      .order("created_at", { ascending: false })
      .limit(2500);
    if (listError) throw listError;
    const jids = [...new Set((rows || []).map(row => row.remote_jid))];
    let checked = 0;
    let resolved = 0;
    for (let at = 0; at < jids.length; at += 150) {
      const response = await fetch(base.replace(/\/$/, "") + "/v1/resolve-contacts", {
        method: "POST",
        headers: { "x-bridge-key": key, "content-type": "application/json" },
        body: JSON.stringify({ ownerId: user.id, jids: jids.slice(at, at + 150) }),
        signal: AbortSignal.timeout(25000),
        cache: "no-store"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "WhatsApp no respondió a la consulta de contactos");
      checked += Number(data.checked || 0);
      resolved += Number(data.resolved || 0);
    }
    return NextResponse.json({ checked, resolved, note: "Solo se usan los números y nombres que WhatsApp permite consultar." });
  } catch (error) {
    console.error("[private-whatsapp/contacts]", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "No se pudo consultar los nombres de WhatsApp" }, { status: 503 });
  }
}
