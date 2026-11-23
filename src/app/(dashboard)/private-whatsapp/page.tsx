"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Bell, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Smartphone, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { PrivateBotSimulator } from "@/components/private-wa/bot-simulator";

type Lead = { id: string; name: string; phone: string; locality: string; summary: Record<string, string | null>; created_at: string; read_at: string | null };
type Status = { status?: string; qr?: string | null; code?: string; error?: string; configured?: boolean };
type BotConfig = { welcome: string; transfer: string; brands: Record<string, string[]>; prompts: Record<string, string> };
const initial: BotConfig = {
  welcome: "¡Bienvenido/a a Valle Automotores! 📍 Estamos en General Roca, Río Negro. ¿Qué vehículo estás buscando?",
  transfer: "¡Muchas gracias! Ya registramos tu consulta. Te derivamos a un asesor de Valle Automotores.",
  prompts: {},
  brands: {
    Honda: ["Wave 110", "GLH 150", "XR 150", "XR 250"],
    Motomel: ["B110", "S2 150", "Skua 150", "Skua 250"],
    Gilera: ["Smash 110", "VC 150", "Sahel 150"],
    Zanella: ["ZB 110", "ZR 150", "RX 150"],
    Corven: ["Energy 110", "Triax 150", "Hunter 150"],
    Keller: ["KN110-8", "Stratus 150"],
    Mondial: ["LD 110 Max", "RD 150"],
  },
};
const row = "rounded-xl border border-border bg-card p-4";
const button = "min-h-11 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50";
function readableStatus(s?: string) {
  if (s === "connected") return "Conectado";
  if (s === "pairing" || s === "starting") return "Esperando vinculación";
  if (s === "disconnected") return "Desconectado";
  return "Sin conectar";
}
export default function PrivateWhatsappPage() {
  const { accountId, accountRole, user } = useAuth();
  const admin = accountRole === "owner" || accountRole === "admin";
  const [leads, setLeads] = useState<Lead[]>([]);
  const [status, setStatus] = useState<Status>({});
  const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [config, setConfig] = useState<BotConfig>(initial);
  const [brandsText, setBrandsText] = useState(JSON.stringify(initial.brands, null, 2));
  const [promptsText, setPromptsText] = useState(JSON.stringify(initial.prompts, null, 2));
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!accountId || !user?.id) return;
    const db = createClient();
    const { data, error } = await db.from("private_wa_leads").select("*")
      .eq("account_id", accountId).eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(100);
    if (!error) setLeads((data || []) as Lead[]);
  }, [accountId, user?.id]);

  const checkStatus = useCallback(async () => {
    try { const res = await fetch("/api/private-wa/health", { cache: "no-store" });
      const data = await res.json() as { online?: boolean };
      setGatewayOnline(res.ok && data.online === true); }
    catch { setGatewayOnline(false); }
    try {
      const response = await fetch("/api/private-wa/session", { cache: "no-store" });
      const data = await response.json() as Status;
      if (response.ok) setStatus(data);
      else if (response.status === 404 || response.status === 503) setStatus({ status: "not_connected", error: data.error, configured: data.configured });
    } catch { setStatus({ status: "disconnected" }); }
  }, []);

  useEffect(() => {
    void reload();
    void checkStatus();
    const timer = window.setInterval(() => { void reload(); void checkStatus(); }, 7000);
    return () => clearInterval(timer);
  }, [reload, checkStatus]);

  useEffect(() => {
    if (!admin || !accountId) return;
    const db = createClient();
    void db.from("private_wa_bot_configs").select("config").eq("account_id", accountId).maybeSingle()
      .then(({ data }) => {
        if (!data?.config) return;
        const stored = data.config as Partial<BotConfig>;
        const next = { ...initial, ...stored, brands: stored.brands || initial.brands };
        setConfig(next);
        setBrandsText(JSON.stringify(next.brands, null, 2));
        setPromptsText(JSON.stringify(next.prompts || {}, null, 2));
      });
  }, [admin, accountId]);

  async function sessionAction(action: "start" | "pair" | "logout") {
    setWorking(true);
    try {
      const response = await fetch("/api/private-wa/session", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, phone: phone.replace(/\D/g, "") }) });
      const result = await response.json() as Status;
      if (!response.ok) throw new Error(result.error || "No se pudo completar la operación");
      setStatus(result);
      if (result.code) setPairCode(result.code);
      if (action === "logout") { setPairCode(""); toast.success("Sesión privada desvinculada"); }
      else if (action === "start") toast.success("Iniciando la conexión privada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de conexión");
    } finally { setWorking(false); }
  }
  async function saveConfig() {
    if (!admin || !accountId) return;
    setSaving(true);
    try {
      const brands = JSON.parse(brandsText) as Record<string, string[]>;
      if (!brands || Array.isArray(brands) || Object.keys(brands).length > 9 ||
          Object.values(brands).some(v => !Array.isArray(v) || v.length > 9 || v.some(x => typeof x !== "string")))
        throw new Error("Usá hasta 9 marcas y hasta 9 modelos por marca.");
      const prompts = JSON.parse(promptsText) as Record<string,string>;
      if (!prompts || Array.isArray(prompts) || Object.keys(prompts).length > 20 ||
        Object.values(prompts).some(x => typeof x !== "string" || x.length > 450))
        throw new Error("Las preguntas deben ser textos de hasta 450 caracteres.");
      const next = { ...config, brands, prompts };
      const { error } = await createClient().from("private_wa_bot_configs").upsert({
        account_id: accountId, config: next, updated_at: new Date().toISOString(),
      }, { onConflict: "account_id" });
      if (error) throw error;
      setConfig(next);
      // Reenvía las preferencias a una sesión ya vinculada, sin reiniciar WhatsApp.
      void fetch("/api/private-wa/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }).catch(() => {});
      toast.success("Configuración guardada para nuevas consultas.");
    } catch (err) { toast.error(err instanceof Error ? err.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  }
  async function markRead(lead: Lead) {
    if (lead.read_at) return;
    const when = new Date().toISOString();
    setLeads(x => x.map(y => y.id === lead.id ? { ...y, read_at: when } : y));
    await createClient().from("private_wa_leads").update({ read_at: when }).eq("id", lead.id);
  }

  return <div className="mx-auto max-w-5xl space-y-5 pb-16">
    <div><h1 className="text-2xl font-bold text-foreground">📲 Mi WhatsApp privado</h1>
      <p className="mt-1 text-sm text-muted-foreground">Segunda bandeja independiente del número principal. Solo se incorporan consultas nuevas y filtradas por el bot.</p></div>
    <PrivateBotSimulator config={config}/>
    <div className={row}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold"><Smartphone className="size-5" /> Mi conexión</div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {status.status === "connected" ? <Wifi className="size-4 text-emerald-500"/> : <WifiOff className="size-4"/>}
          {readableStatus(status.status)}
        </span>
      </div>
      <p className={"mt-2 text-xs " + (gatewayOnline ? "text-emerald-600" : "text-amber-600")}>
        Servicio privado: {gatewayOnline === null ? "verificando..." : gatewayOnline ? "en línea" : "sin conexión"}
      </p>
      {status.error && <p className="mt-3 text-xs text-amber-600">{status.error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Vinculá una vez desde Dispositivos vinculados de WhatsApp Business. El servicio evita importar el historial y los chats anteriores.</p>
      {status.qr && <div className="mt-4 flex justify-center"><img src={status.qr} alt="Código QR para vincular WhatsApp Business" className="w-60 rounded-xl bg-white p-3" /></div>}
      {pairCode && <div className="my-3 rounded-xl border border-primary p-3 text-center"><p className="text-xs">Código de vinculación</p><p className="text-2xl font-bold tracking-widest">{pairCode}</p></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={button} disabled={working || status.status === "connected"} onClick={() => void sessionAction("start")}> {working ? "Procesando..." : "Generar QR"}</button>
        <button className={button} onClick={() => void checkStatus()}><RefreshCw className="inline size-4" /> Actualizar</button>
        {status.status === "connected" && <button className={button} disabled={working} onClick={() => void sessionAction("logout")}>Desvincular</button>}
      </div>
      {status.status !== "connected" && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input className="min-h-11 flex-1 rounded-lg border border-input bg-background px-3 text-sm" inputMode="tel"
          placeholder="Número con país, ej. 549..." value={phone} onChange={e => setPhone(e.target.value)} />
        <button className={button} disabled={working || !phone} onClick={() => void sessionAction("pair")}>Vincular con código</button>
      </div>}
    </div>
    <section className={row}>
      <div className="flex items-center justify-between"><h2 className="font-semibold"><Bell className="mr-2 inline size-4"/>Nuevos clientes</h2>
        <span className="text-xs text-muted-foreground">{leads.filter(x => !x.read_at).length} sin leer</span>
      </div>
      <div className="mt-3 space-y-2">
        {leads.length === 0 && <p className="rounded-lg bg-muted/40 p-5 text-center text-sm text-muted-foreground">Todavía no hay clientes filtrados. Los nuevos aparecerán aquí al completar el bot.</p>}
        {leads.map(lead => {
          const s = lead.summary || {};
          return <button key={lead.id} type="button" onClick={() => void markRead(lead)}
            className={`w-full rounded-lg border p-3 text-left ${lead.read_at ? "border-border bg-background" : "border-primary/40 bg-primary/5"}`}>
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm">{lead.name || lead.phone}</strong>
              {lead.read_at ? <CheckCircle2 className="size-4 text-muted-foreground" /> : <span className="size-2 rounded-full bg-primary"/>}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{lead.phone} · {lead.locality} · {new Date(lead.created_at).toLocaleString("es-AR")}</div>
            <p className="mt-2 text-sm">{[s.vehicle, s.brand, s.model, s.cc].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 text-xs">Entrega: {s.capital === "SÍ" ? s.capitalAmount || "Sí" : "Sin capital"} · {s.operation || "A definir"} · Cuota: {s.quota || "No indicó"}</p>
          </button>;
        })}
      </div>
    </section>
    {admin && <section className={row}>
      <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5"/>Configuración del bot (solo administradores)</h2>
      <p className="mt-1 text-xs text-muted-foreground">Las preguntas de vehículo, entrega, financiación, nombre y localidad son comunes. Podés editar la bienvenida, la despedida y las marcas/modelos.</p>
      <label className="mt-4 block text-sm font-medium">Mensaje de bienvenida</label>
      <textarea className="mt-1 w-full rounded-lg border border-input bg-background p-3 text-sm" rows={3} value={config.welcome} onChange={e=>setConfig(x=>({...x,welcome:e.target.value}))}/>
      <label className="mt-3 block text-sm font-medium">Mensaje de derivación</label>
      <textarea className="mt-1 w-full rounded-lg border border-input bg-background p-3 text-sm" rows={3} value={config.transfer} onChange={e=>setConfig(x=>({...x,transfer:e.target.value}))}/>
      <label className="mt-3 block text-sm font-medium">Preguntas personalizadas (JSON)</label>
      <p className="mt-1 text-xs text-muted-foreground">Podés modificar las preguntas sin alterar las opciones del menú. Claves disponibles: vehicle, brand, brand_other, model, model_other, cc, cc_other, capital, capital_amount, operation, quota, quota_other, name, locality. Dejá vacío para mantener los textos predeterminados.</p>
      <textarea spellCheck={false} className="mt-1 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" rows={6} value={promptsText} onChange={e=>setPromptsText(e.target.value)}/>
      <label className="mt-3 block text-sm font-medium">Marcas y modelos de motos (JSON)</label>
      <textarea spellCheck={false} className="mt-1 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" rows={12} value={brandsText} onChange={e=>setBrandsText(e.target.value)}/>
      <button disabled={saving} className={button + " mt-3"} onClick={() => void saveConfig()}>{saving ? <Loader2 className="inline size-4 animate-spin"/> : null} Guardar configuración</button>
    </section>}
  </div>;
}
