import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Permanently erase ONLY the authenticated user's private WhatsApp inbox.
// A disconnected WhatsApp Web device is not sufficient to erase the saved
// chats, address book, message journal or encrypted pairing credentials.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== "https://crm.valleautomotores.tech")
    return NextResponse.json({ error: "Origen no autorizado" }, { status: 403 });

  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: "Iniciá sesión nuevamente" }, { status: 401 });

  let body: { confirm?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 }); }
  if (body.confirm !== "BORRAR TODO")
    return NextResponse.json({ error: "Confirmación incorrecta" }, { status: 400 });

  const bridgeBase = process.env.PRIVATE_WA_BRIDGE_URL;
  const bridgeKey = process.env.PRIVATE_WA_BRIDGE_KEY;
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!bridgeBase || !bridgeKey || !dbUrl || !serviceRole)
    return NextResponse.json({ error: "El servicio de borrado no está configurado" }, { status: 503 });

  try {
    // First stop WhatsApp from writing new events and securely remove this
    // user's on-disk pairing credentials and message journal.
    const bridgeResponse = await fetch(
      (bridgeBase.endsWith("/") ? bridgeBase.slice(0, -1) : bridgeBase) + "/v1/erase",
      {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
        headers: { "x-bridge-key": bridgeKey, "content-type": "application/json" },
        body: JSON.stringify({ ownerId: user.id, confirm: "BORRAR TODO" })
      }
    );
    const result = await bridgeResponse.json().catch(() => ({}));
    if (!bridgeResponse.ok || result.erased !== true)
      return NextResponse.json({
        error: "El conector no confirmó la eliminación. No se borró la base de datos."
      }, { status: 502 });

    // One database transaction deletes the private inbox, all its child
    // chats and messages (foreign key cascade), and its owner's addressbook.
    // It never touches commercial conversations, contacts or shared CRM.
    const admin = createAdminClient(dbUrl, serviceRole, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc("erase_private_whatsapp_data", { p_owner: user.id });
    if (error) throw error;
    return NextResponse.json({ erased: true, counts: data });
  } catch (error) {
    console.error("Private WhatsApp erase failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({
      error: "No se pudo completar el borrado. Revisá el estado y volvé a intentarlo."
    }, { status: 500 });
  }
}
