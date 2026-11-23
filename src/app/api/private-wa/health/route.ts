import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { privateWASecrets } from "@/lib/private-wa/secrets";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await getCurrentAccount();
    const { gatewayUrl } = privateWASecrets();
    if (!gatewayUrl) return NextResponse.json({ connected: false, error: "Servicio no configurado" }, { status: 503 });
    try {
      const response = await fetch(new URL("/health", gatewayUrl), { cache: "no-store", signal: AbortSignal.timeout(4000) });
      return NextResponse.json({ online: response.ok, updatedAt: new Date().toISOString() }, { status: response.ok ? 200 : 503 });
    } catch { return NextResponse.json({ online: false, error: "No se puede conectar con el gateway" }, { status: 503 }); }
  } catch (error) { return toErrorResponse(error); }
}
