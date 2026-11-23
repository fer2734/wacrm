import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { privateWASecrets } from "@/lib/private-wa/secrets";

export const dynamic = "force-dynamic";
type Command = { action?: "start" | "pair" | "logout"; phone?: string };
const noCache = { "Cache-Control": "private, no-store, max-age=0" };
async function proxy(action: "start" | "pair" | "logout" | "status", input: Command = {}) {
  const ctx = await getCurrentAccount();
  const { gatewayUrl: host, gatewayToken: token } = privateWASecrets();
  if (!host || !token) return NextResponse.json({ error: "La conexión privada todavía no está habilitada en el servidor.", configured: false }, { status: 503, headers: noCache });
  const path = `/session/${ctx.userId}/${action}`;
  const requestBody = action === "start" ? await (async () => {
    const { data } = await ctx.supabase.from("private_wa_bot_configs").select("config").eq("account_id", ctx.accountId).maybeSingle();
    return { accountId: ctx.accountId, config: data?.config || {} };
  })() : action === "pair" ? { phone: input.phone } : {};
  let response: Response;
  try {
    response = await fetch(new URL(path, host), {
      method: action === "status" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(action !== "status" ? { body: JSON.stringify(requestBody) } : {}),
      signal: AbortSignal.timeout(12000), cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "El servicio privado no está disponible." }, { status: 503, headers: noCache });
  }
  const data = (await response.json().catch(() => ({ error: "Respuesta inválida" }))) as Record<string, unknown>;
  if (response.ok && action !== "status") {
    const status = action === "logout" ? "disconnected" : action === "start" ? "pairing" : "pairing";
    const db = supabaseAdmin();
    await db.from("private_wa_connections").upsert({
      account_id: ctx.accountId, user_id: ctx.userId, state: status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id,user_id" });
  }
  return NextResponse.json(data, { status: response.status, headers: noCache });
}
export async function GET() {
  try { return await proxy("status"); } catch (err) { return toErrorResponse(err); }
}
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Command | null;
    if (!body || !["start", "pair", "logout"].includes(String(body.action))) return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    if (body.action === "pair" && !/^\d{10,15}$/.test(String(body.phone || "").replace(/\D/g, "")))
      return NextResponse.json({ error: "Ingresá el número con código de país" }, { status: 400 });
    return await proxy(body.action!, body);
  } catch (err) { return toErrorResponse(err); }
}
