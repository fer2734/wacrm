import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user)
    return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const url = process.env.WAHA_LAB_URL;
  const key = process.env.WAHA_LAB_API_KEY;
  if (!url || !key)
    return NextResponse.json({ error: "WAHA no configurado" }, { status: 503 });
  const session = "lab_" + user.id.replace(/-/g, "");
  try {
    const response = await fetch(url.replace(/\/$/, "") + "/api/" + session + "/auth/qr", {
      method: "GET",
      headers: { "X-Api-Key": key, "Accept": "image/png" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return NextResponse.json(
      { error: "QR no disponible todavía" },
      { status: response.status, headers: { "Cache-Control": "no-store" } }
    );
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("image/"))
      return NextResponse.json({ error: "WAHA no devolvió una imagen QR" }, { status: 502 });
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 100 || buffer.byteLength > 2_000_000)
      return NextResponse.json({ error: "Tamaño de QR inesperado" }, { status: 502 });
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": contentType.startsWith("image/") ? contentType : "image/png",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "WAHA no responde al solicitar QR" }, { status: 503 });
  }
}
