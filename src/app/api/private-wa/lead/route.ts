import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export const dynamic = "force-dynamic";
const isUuid = (s: unknown) => typeof s === "string" && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s);
const safe = (s: unknown, n = 150) => typeof s === "string" ? s.trim().slice(0, n) : "";

export async function POST(request: Request) {
  const secret = process.env.PRIVATE_WA_CALLBACK_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 12_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const provided = request.headers.get("x-valle-signature") || "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isUuid(body.accountId) || !isUuid(body.userId)) return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  const chatId = safe(body.chatId, 120);
  const phone = safe(body.phone, 35).replace(/[^0-9+]/g, "");
  if (!chatId.endsWith("@s.whatsapp.net") || phone.length < 8) return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
  const summary = body.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return NextResponse.json({ error: "Invalid summary" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: profile } = await db.from("profiles").select("account_id").eq("user_id", body.userId).maybeSingle();
  if (!profile || profile.account_id !== body.accountId) return NextResponse.json({ error: "Unknown agent" }, { status: 403 });
  const record = { account_id: body.accountId, user_id: body.userId, chat_id: chatId,
    phone, name: safe(body.name, 100), locality: safe(body.locality, 100), summary };
  const { error: inserted } = await db.from("private_wa_leads").insert(record);
  if (inserted?.code === "23505") {
    // An already handed-off customer is not a fresh lead; do not notify twice.
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (inserted) return NextResponse.json({ error: "Failed to record lead" }, { status: 500 });
  const vehicle = safe((summary as Record<string, unknown>).vehicle);
  const brand = safe((summary as Record<string, unknown>).brand);
  const model = safe((summary as Record<string, unknown>).model);
  const quota = safe((summary as Record<string, unknown>).quota);
  const description = [vehicle, brand, model].filter(Boolean).join(" ");
  const title = "Nuevo cliente en tu WhatsApp privado";
  const text = [record.name || phone, record.locality, description, quota ? "Cuota deseada: " + quota : ""].filter(Boolean).join(" · ");
  const { error: noticeError } = await db.from("notifications").insert({
    account_id: body.accountId, user_id: body.userId, type: "private_lead", title, body: text,
  });
  if (noticeError) console.error("[private-wa] Could not create notification", noticeError.code);

  // Email is optional: use an explicitly configured and verified Brevo sender.
  if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) {
    try {
      const { data: owner } = await db.auth.admin.getUserById(String(body.userId));
      const recipient = owner?.user?.email;
      if (recipient) {
        const email = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST", headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: { email: process.env.BREVO_SENDER_EMAIL, name: "Valle Automotores" },
            to: [{ email: recipient }],
            subject: "Nuevo cliente en tu WhatsApp privado",
            textContent: "Recibiste un cliente nuevo. " + text + "\nAbrí tu bandeja privada en el CRM para ver el resumen.",
          }),
        });
        if (!email.ok) console.error("[private-wa] Brevo delivery rejected", email.status);
      }
    } catch { console.error("[private-wa] Email delivery unavailable"); }
  }
  return NextResponse.json({ ok: true });
}
