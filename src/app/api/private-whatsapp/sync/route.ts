import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The bridge stores events durably. The owner-authenticated CRM calls a
// service-only SQL function that commits messages and the journal cursor
// atomically, avoiding dozens of PostgREST round-trips per batch.
export async function POST() {
  const userClient = await createClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const bridgeUrl = process.env.PRIVATE_WA_BRIDGE_URL;
  const bridgeKey = process.env.PRIVATE_WA_BRIDGE_KEY;
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!bridgeUrl || !bridgeKey || !dbUrl || !serviceKey)
    return NextResponse.json({ error: "Servicio de sincronización sin configurar" }, { status: 503 });
  const db = createAdminClient(dbUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: inbox, error: inboxError } = await db.from("private_whatsapp_inboxes")
      .select("id,sync_offset").eq("owner_user_id", user.id).maybeSingle();
    if (inboxError) throw inboxError;
    if (!inbox) return NextResponse.json({ error: "Bandeja privada no encontrada" }, { status: 404 });

    let offset = Number(inbox.sync_offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid journal cursor");

    let imported = 0;
    let processed = 0;
    let batches = 0;
    let hasMore = false;
    let journalBytes = offset;
    const started = Date.now();

    for (let n = 0; n < 12 && Date.now() - started < 25000; n++) {
      const url = new URL("/v1/events", bridgeUrl);
      url.searchParams.set("ownerId", user.id);
      url.searchParams.set("offset", String(offset));
      const response = await fetch(url, {
        headers: { "x-bridge-key": bridgeKey },
        cache: "no-store",
        signal: AbortSignal.timeout(12000)
      });
      const batch = await response.json().catch(() => null);
      if (!response.ok || !batch || !Array.isArray(batch.events))
        throw new Error(typeof batch?.error === "string"
          ? batch.error : "El conector no pudo entregar mensajes");

      const nextOffset = Number(batch.nextOffset);
      if (!Number.isSafeInteger(nextOffset) || nextOffset < offset)
        throw new Error("Invalid journal offset received");
      journalBytes = Number(batch.journalBytes || nextOffset);
      hasMore = !!batch.hasMore;

      if (nextOffset === offset) break;
      const { data, error } = await db.rpc("ingest_private_whatsapp_batch", {
        p_owner: user.id,
        p_expected_offset: offset,
        p_next_offset: nextOffset,
        p_events: batch.events
      });
      if (error) throw new Error(error.message);
      if (data?.conflict) {
        const newOffset = Number(data.offset);
        if (!Number.isSafeInteger(newOffset) || newOffset < 0)
          throw new Error("Invalid concurrent cursor");
        offset = newOffset;
        continue;
      }
      const enrich = await db.rpc("apply_private_whatsapp_profiles", {
        p_owner: user.id, p_events: batch.events
      });
      if (enrich.error) console.warn("[private-whatsapp/sync] profile enrichment:", enrich.error.message);
      imported += Number(data?.imported || 0);
      processed += Number(data?.processed || 0);
      batches++;
      offset = nextOffset;
      if (!hasMore) break;
    }

    return NextResponse.json({
      imported, processed, batches, hasMore,
      advanced: batches > 0, offset, journalBytes
    });
  } catch (error) {
    console.error("[private-whatsapp/sync]", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "No se pudo importar la bandeja privada. Reintentando." }, { status: 500 });
  }
}
