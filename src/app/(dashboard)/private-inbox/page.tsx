"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Check, Copy, Edit2, LockKeyhole, MessageCircle, RefreshCw, Send, Smartphone, Unplug, Search, ChevronDown, GitBranch } from "lucide-react";

type PrivateInbox = { id: string; display_name: string; connection_status: string; connected_phone: string | null };
type PrivateChat = { id: string; remote_jid: string; contact_name: string; display_name_override: string | null;
  phone_jid: string | null; stage_id: string | null; last_message_text: string; last_message_at: string | null; unread_count: number };
type SalesStage = { id: string; name: string; color: string; position: number };
type PrivateMessage = { id: string; message_text: string; from_me: boolean; sent_at: string; message_type: string };
type BridgeStatus = { status: string; qr?: string | null; phone?: string | null; ready?: boolean; error?: string;
  historyEvents?: number; messageEvents?: number; historyProgress?: number | null;
  historyFinished?: boolean; lastError?: string | null; lastCode?: string | number | null; version?: string | null; connectingSeconds?: number };

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const getPhone = (jid: string) => jid.split("@")[0];
const isPhoneJid = (jid: string) => jid.endsWith("@s.whatsapp.net");
const displayName = (chat: PrivateChat) => {
  if (chat.display_name_override?.trim()) return chat.display_name_override.trim();
  const name = chat.contact_name?.trim() || "";
  if (name && name !== getPhone(chat.remote_jid) && !/^[0-9]+$/.test(name)) return name;
  const knownNumber = chat.phone_jid || (isPhoneJid(chat.remote_jid) ? chat.remote_jid : null);
  if (knownNumber) return "+" + getPhone(knownNumber);
  return "Contacto sin nombre · ID " + getPhone(chat.remote_jid).slice(-6);
};
const contactPhone = (chat: PrivateChat) => chat.phone_jid ||
  (isPhoneJid(chat.remote_jid) ? chat.remote_jid : null);

export default function PrivateInboxPage() {
  const { user, accountId, loading: authLoading, accountStatus } = useAuth();
  const [inbox, setInbox] = useState<PrivateInbox | null>(null);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [connection, setConnection] = useState<BridgeStatus>({ status: "not_connected" });
  const [chats, setChats] = useState<PrivateChat[]>([]);
  const [totalChats, setTotalChats] = useState(0);
  const [chatSearch, setChatSearch] = useState("");
  const [chatLimit, setChatLimit] = useState(200);
  const [stages, setStages] = useState<SalesStage[]>([]);
  const [editingContactName, setEditingContactName] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [updatingContact, setUpdatingContact] = useState(false);
  const [resolvingNames, setResolvingNames] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ offset: 0, total: 0, hasMore: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [importedCount, setImportedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const loadInbox = useCallback(async () => {
    if (!user) return;
    const { data, error } = await createClient().from("private_whatsapp_inboxes")
      .select("id,display_name,connection_status,connected_phone")
      .eq("owner_user_id", user.id).maybeSingle();
    if (error) { toast.error("No se pudo cargar la bandeja privada"); return; }
    setInbox(data as PrivateInbox | null);
    if (data) setName(current => current || data.display_name);
    setInitializing(false);
  }, [user]);

  const loadChats = useCallback(async () => {
    if (!inbox) { setChats([]); setTotalChats(0); return; }
    let query = createClient().from("private_whatsapp_chats")
      .select("id,remote_jid,contact_name,display_name_override,phone_jid,stage_id,last_message_text,last_message_at,unread_count", { count: "exact" })
      .eq("inbox_id", inbox.id);
    const search = chatSearch.trim().replace(/[^\p{L}\p{N} +@._-]/gu, "").slice(0, 50);
    if (search) {
      query = query.or([
        "contact_name.ilike.%" + search + "%",
        "display_name_override.ilike.%" + search + "%",
        "phone_jid.ilike.%" + search + "%",
        "remote_jid.ilike.%" + search + "%"
      ].join(","));
    }
    const { data, error, count } = await query
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(0, chatLimit - 1);
    if (error) { console.error(error.message); return; }
    setChats((data || []) as PrivateChat[]);
    setTotalChats(count || 0);
  }, [inbox, chatLimit, chatSearch]);

  const loadMessages = useCallback(async () => {
    if (!selected || !inbox) { setMessages([]); return; }
    const { data, error } = await createClient().from("private_whatsapp_messages")
      .select("id,message_text,from_me,sent_at,message_type")
      .eq("inbox_id", inbox.id).eq("chat_id", selected)
      .order("sent_at", { ascending: false }).limit(200);
    if (error) { console.error(error.message); return; }
    setMessages(((data || []) as PrivateMessage[]).reverse());
  }, [selected, inbox]);

  const loadStages = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const { data: pipelines } = await db.from("pipelines")
      .select("id").eq("account_id", accountId);
    const ids = (pipelines || []).map(p => p.id);
    if (!ids.length) return;
    const { data, error } = await db.from("pipeline_stages")
      .select("id,name,color,position").in("pipeline_id", ids).order("position");
    if (!error) setStages((data || []) as SalesStage[]);
  }, [accountId]);

  useEffect(() => { void loadStages(); }, [loadStages]);

  const pollStatus = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch("/api/private-whatsapp", { cache: "no-store" });
      const info = await response.json() as BridgeStatus;
      if (response.ok) setConnection(info);
      else setConnection({ status: "unavailable", error: info.error || "Servicio no disponible" });
    } catch { setConnection({ status: "unavailable", error: "No se pudo conectar al servicio" }); }
  }, [user]);

  useEffect(() => {
    if (user && accountStatus === "ready") void loadInbox();
  }, [user, accountStatus, loadInbox]);

  useEffect(() => {
    if (!user) return;
    void pollStatus();
    const timer = window.setInterval(() => void pollStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [pollStatus, user]);

  useEffect(() => {
    void loadChats();
    const timer = window.setInterval(() => void loadChats(), 5000);
    return () => window.clearInterval(timer);
  }, [loadChats]);

  useEffect(() => {
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(), 5000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  // Pull durable WhatsApp events through the agent's authenticated CRM
  // session. History may arrive in many batches; retry safely from the
  // last committed journal position. Polling works even after reconnect.
  useEffect(() => {
    if (!user || !inbox) return;
    let stopped = false;
    let inFlight = false;
    let consecutiveErrors = 0;
    const sync = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      setSyncing(true);
      try {
        let received = 0;
        for (let page = 0; page < 4 && !stopped; page++) {
          const response = await fetch("/api/private-whatsapp/sync", { method: "POST", cache: "no-store" });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Sincronización no disponible");
          received += Number(data.imported || 0);
          if (!stopped && Number.isFinite(Number(data.journalBytes))) {
            setSyncProgress({
              offset: Number(data.offset || 0),
              total: Number(data.journalBytes || 0),
              hasMore: !!data.hasMore
            });
          }
          if (!data.hasMore) break;
        }
        consecutiveErrors = 0;
        if (!stopped) {
          setSyncError("");
          if (received) {
            setImportedCount(n => n + received);
            void loadChats();
            void loadMessages();
          }
        }
      } catch (err) {
        consecutiveErrors++;
        if (!stopped && consecutiveErrors >= 2)
          setSyncError(err instanceof Error ? err.message : "Error al sincronizar mensajes");
      } finally {
        inFlight = false;
        if (!stopped) setSyncing(false);
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [user, inbox, loadChats, loadMessages]);

  async function saveName() {
    if (!inbox || !name.trim() || saving) return;
    setSaving(true);
    const next = name.trim().slice(0, 60);
    const { error } = await createClient().from("private_whatsapp_inboxes")
      .update({ display_name: next }).eq("id", inbox.id);
    setSaving(false);
    if (error) { toast.error("No se pudo guardar el nombre"); return; }
    setInbox(prev => prev ? { ...prev, display_name: next } : null);
    setEditingName(false);
    window.dispatchEvent(new Event("wacrm:private-inbox-name-changed"));
    toast.success("Nombre guardado");
  }

  async function command(action: "connect" | "reset" | "disconnect" | "send", payload?: Record<string, unknown>) {
    setBusy(true);
    if (action === "connect" || action === "reset")
      setConnection(previous => ({ ...previous, status: "connecting", qr: null, lastError: null, connectingSeconds: 0 }));
    try {
      const response = await fetch("/api/private-whatsapp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload })
      });
      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "No se pudo completar la acción");
        if (action === "connect" || action === "reset") await pollStatus();
        return false;
      }
      if (action === "connect" || action === "reset") {
        await loadInbox();
        await pollStatus();
        toast.message("Conexión iniciada. Escaneá el QR apenas aparezca.");
      }
      if (action === "disconnect") {
        setConnection({ status: "not_connected" });
        toast.success("WhatsApp desvinculado del CRM");
      }
      return true;
    } catch {
      toast.error("El servicio de WhatsApp privado no responde");
      return false;
    } finally { setBusy(false); }
  }

  async function refreshContactNames() {
    if (resolvingNames || !connection.ready) return;
    setResolvingNames(true);
    try {
      const response = await fetch("/api/private-whatsapp/contacts", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudieron actualizar contactos");
      if (result.resolved)
        toast.success("WhatsApp aportó datos de " + result.resolved + " contactos. Se actualizarán en la bandeja.");
      else
        toast.info("WhatsApp no aportó números nuevos. Podés editar el nombre desde cada conversación.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron consultar contactos");
    } finally { setResolvingNames(false); }
  }

  async function changeStage(chat: PrivateChat, stageId: string) {
    if (!user) return;
    const { error } = await createClient().from("private_whatsapp_chats")
      .update({ stage_id: stageId || null })
      .eq("id", chat.id).eq("owner_user_id", user.id);
    if (error) { toast.error("No se pudo guardar la etapa de venta"); return; }
    setChats(current => current.map(c => c.id === chat.id ? { ...c, stage_id: stageId || null } : c));
    toast.success("Etapa de venta guardada");
  }

  async function saveContactName() {
    const chat = chats.find(c => c.id === selected);
    if (!chat || !user || updatingContact) return;
    setUpdatingContact(true);
    const alias = contactNameDraft.trim().slice(0, 120);
    const { error } = await createClient().from("private_whatsapp_chats")
      .update({ display_name_override: alias || null })
      .eq("id", chat.id).eq("owner_user_id", user.id);
    setUpdatingContact(false);
    if (error) { toast.error("No se pudo guardar el nombre"); return; }
    setChats(current => current.map(c => c.id === chat.id
      ? { ...c, display_name_override: alias || null } : c));
    setEditingContactName(false);
    toast.success("Nombre actualizado");
  }

  async function sendMessage() {
    if (!selected || !draft.trim() || busy || !connection.ready) return;
    const chat = chats.find(c => c.id === selected);
    if (!chat) return;
    const text = draft.trim();
    const ok = await command("send", { remoteJid: chat.remote_jid, text });
    if (ok) { setDraft(""); await loadMessages(); await loadChats(); }
  }

  async function selectChat(chat: PrivateChat) {
    setSelected(chat.id);
    setMobileChat(true);
    setEditingContactName(false);
    setContactNameDraft(chat.display_name_override || (chat.contact_name && !/^[0-9]+$/.test(chat.contact_name) ? chat.contact_name : ""));
    if (chat.unread_count && inbox) {
      await createClient().from("private_whatsapp_chats")
        .update({ unread_count: 0 }).eq("id", chat.id).eq("inbox_id", inbox.id);
      void loadChats();
    }
  }

  const currentChat = chats.find(c => c.id === selected);
  const defaultStage = stages.find(stage => stage.name.toLocaleLowerCase("es-AR") === "nuevo contacto");
  const stageOf = (chat: PrivateChat) =>
    stages.find(stage => stage.id === chat.stage_id) || (!chat.stage_id ? defaultStage : undefined);
  const percent = syncProgress.total > 0
    ? Math.min(100, Math.floor(100 * syncProgress.offset / syncProgress.total)) : 0;
  const connected = !!connection.ready;
  if (authLoading || initializing && user && accountStatus === "ready")
    return <div className="p-5 text-sm text-muted-foreground">Cargando bandeja privada...</div>;
  if (!user) return <div className="p-5">Iniciá sesión para ver tu WhatsApp privado.</div>;

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background sm:-m-6">
      <div className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <LockKeyhole className="size-5 shrink-0 text-primary" />
          {editingName ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <input className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                value={name} maxLength={60} onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void saveName(); }} aria-label="Nombre de mi bandeja privada" />
              <button type="button" onClick={() => void saveName()} disabled={!name.trim() || saving}
                className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground" title="Guardar nombre">
                <Check className="size-4" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditingName(true)}
              className="inline-flex min-w-0 items-center gap-2 text-left text-base font-semibold text-foreground hover:text-primary"
              title="Cambiar el nombre de mi bandeja">
              <span className="truncate">{inbox?.display_name || "Mi WhatsApp privado"}</span>
              <Edit2 className="size-3.5 shrink-0" />
            </button>
          )}
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
            <LockKeyhole className="size-3" /> Solo yo
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {connected ? "Conectado: +" + (connection.phone || inbox?.connected_phone || "") :
             connection.status === "qr" || connection.status === "connecting" ? "Esperando vinculación..." :
             "WhatsApp individual independiente del CRM compartido"}
            {syncing ? " · Sincronizando..." : ""}
            {syncProgress.total > 0 ? " · Importación " + percent + "%" : ""}
            {importedCount ? " · Nuevos importados: " + importedCount : ""}
            {connection.historyEvents ? " · Historial detectado: " + connection.historyEvents : ""}
          </p>
          <div className="flex items-center gap-1">
            {connected && (
              <button type="button" disabled={resolvingNames}
                onClick={() => void refreshContactNames()}
                title="Buscar nombres y números disponibles en WhatsApp"
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50">
                <RefreshCw className={`size-3.5 ${resolvingNames ? "animate-spin" : ""}`} />
                <span className="hidden lg:inline">Actualizar contactos</span>
              </button>
            )}
            <button type="button" onClick={() => { void pollStatus(); void loadChats(); void loadMessages(); }}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted" title="Actualizar">
              <RefreshCw className="size-4" />
            </button>
            {!connected && connection.status !== "qr" && connection.status !== "connecting" && (
              <button type="button" disabled={busy} onClick={() => void command("connect")}
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60">
                <Smartphone className="size-4" /> Vincular WhatsApp
              </button>
            )}
            {!connected && (
              <button type="button" disabled={busy}
                onClick={() => {
                  if (window.confirm("¿Generar un QR nuevo? Se reiniciará únicamente la sesión de este dispositivo vinculado al CRM, sin borrar tus mensajes importados ni cerrar WhatsApp en el celular.")) {
                    void command("reset");
                  }
                }}
                className="inline-flex min-h-9 items-center gap-1 rounded-md border border-primary/50 px-2 text-xs font-semibold text-primary hover:bg-primary/10">
                <RefreshCw className="size-3.5" /> Nuevo QR
              </button>
            )}
            {connected && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm("¿Desvincular este WhatsApp de tu bandeja privada?")) void command("disconnect"); }}
                className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
                <Unplug className="size-3.5" /> Desvincular
              </button>
            )}
          </div>
        </div>
      </div>

      {(syncError || connection.lastError) && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {connection.lastError ? "Vinculación: " + connection.lastError : syncError}
          {connection.lastCode ? " (código " + connection.lastCode + ")" : ""}
          {!connected && <span className="ml-2 font-semibold">Podés reiniciar con «Nuevo QR».</span>}
        </div>
      )}
      {!connected && (
        <div className="shrink-0 border-b border-border bg-muted/20 p-3">
          {connection.qr ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-center text-xs font-medium">En tu teléfono: WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
              {/* QR generated only by the internal bridge and proxied through the authenticated session. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={connection.qr} alt="Código QR privado para vincular tu WhatsApp"
                className="size-44 rounded-md border border-border bg-white p-2" />
              <p className="text-xs text-muted-foreground">El QR cambia automáticamente cuando vence. No cierres sesión en el celular.</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {connection.status === "unavailable" ? (connection.error || "Servicio de conexión no disponible.") :
                connection.status === "connecting" || connection.status === "qr"
                  ? (connection.connectingSeconds && connection.connectingSeconds > 25
                      ? "WhatsApp no devolvió un QR. Tocá «Nuevo QR» para iniciar una sesión completamente nueva."
                      : "Conectando con WhatsApp Web para obtener un QR...")
                  : connection.status === "failed" || connection.lastError
                  ? "La vinculación falló. Tocá «Nuevo QR» para empezar nuevamente."
                  : "Vinculá tu número desde Dispositivos vinculados. Tu WhatsApp del celular permanece activo."}
            </p>
          )}
          {connection.version && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              WhatsApp Web {connection.version} · Estado: {connection.status}
            </p>
          )}
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
            Conexión por dispositivo vinculado no oficial: puede desconectarse y tiene riesgos de restricciones por WhatsApp.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className={`flex min-h-0 w-full shrink-0 flex-col border-r border-border bg-card sm:w-80 lg:w-88 ${mobileChat ? "hidden sm:flex" : ""}`}>
          <div className="shrink-0 space-y-2 border-b border-border bg-card-2/40 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">Conversaciones personales</p>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">{totalChats.toLocaleString("es-AR")}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input type="search" placeholder="Buscar nombre o teléfono"
                value={chatSearch}
                onChange={e => { setChatSearch(e.target.value); setChatLimit(200); }}
                aria-label="Buscar chats privados"
                className="h-9 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" />
            </div>
          </div>
          <div className="private-wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {chats.length === 0 && <p className="px-3 py-5 text-xs text-muted-foreground">
              {chatSearch ? "No se encontraron conversaciones." :
                connected ? "Importando los chats y el historial de tu WhatsApp..." :
                "Vinculá tu WhatsApp para ver tus chats privados."}
            </p>}
            {chats.map(chat => {
              const stage = stageOf(chat);
              return (
                <button type="button" key={chat.id} onClick={() => void selectChat(chat)}
                  className={`block w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${selected === chat.id ? "bg-primary/10" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{displayName(chat)}</p>
                    {chat.unread_count > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{chat.unread_count}</span>}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    <span className="font-medium">Último mensaje:</span> {formatDate(chat.last_message_at) || "Sin mensajes"}
                  </p>
                  <div className="mt-1 flex min-w-0 items-center justify-between gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{chat.last_message_text || "Sin vista previa"}</p>
                    {stage && <span className="inline-flex max-w-[44%] shrink-0 items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
                      style={{ borderColor: stage.color + "66", backgroundColor: stage.color + "1c" }}>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="truncate">{stage.name}</span>
                    </span>}
                  </div>
                </button>
              );
            })}
            {chats.length < totalChats && (
              <button type="button" onClick={() => setChatLimit(n => n + 200)}
                className="flex w-full items-center justify-center gap-1.5 border-b border-border px-3 py-3 text-xs font-semibold text-primary hover:bg-primary/10">
                <ChevronDown className="size-4" /> Mostrar más ({totalChats - chats.length})
              </button>
            )}
          </div>
        </aside>

        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${mobileChat ? "flex" : "hidden sm:flex"}`}>
          {!currentChat ? <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <MessageCircle className="size-8 opacity-50" /> Seleccioná un chat privado
          </div> : <>
            <div className="shrink-0 border-b border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2">
                <button type="button" className="min-h-9 rounded-md border border-border px-2 text-xs sm:hidden"
                  onClick={() => setMobileChat(false)}>Volver</button>
                <div className="min-w-0 flex-1">
                  {editingContactName ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <input value={contactNameDraft} maxLength={120}
                        onChange={e => setContactNameDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void saveContactName(); if (e.key === "Escape") setEditingContactName(false); }}
                        placeholder="Nombre personalizado del contacto"
                        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
                      <button type="button" onClick={() => void saveContactName()}
                        disabled={updatingContact} title="Guardar nombre"
                        className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50">
                        <Check className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="inline-flex max-w-full items-center gap-1.5 text-left text-sm font-semibold text-foreground hover:text-primary"
                      title="Modificar el nombre del contacto"
                      onClick={() => { setContactNameDraft(currentChat.display_name_override || (
                        currentChat.contact_name && !/^[0-9]+$/.test(currentChat.contact_name) ? currentChat.contact_name : ""
                      )); setEditingContactName(true); }}>
                      <span className="truncate">{displayName(currentChat)}</span>
                      <Edit2 className="size-3.5 shrink-0" />
                    </button>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {contactPhone(currentChat) ? "+" + getPhone(contactPhone(currentChat)!) : "ID privado de WhatsApp · número no disponible"}
                  </p>
                </div>
                {!!contactPhone(currentChat) && (
                  <button type="button" title="Copiar teléfono" aria-label="Copiar teléfono"
                    onClick={() => void navigator.clipboard.writeText(getPhone(contactPhone(currentChat)!)).then(() => toast.success("Número copiado"))}
                    className="flex size-9 items-center justify-center rounded-md border border-border hover:bg-muted">
                    <Copy className="size-4" />
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GitBranch className="size-4 text-primary" /> Etapa de venta
                  <select value={currentChat.stage_id || defaultStage?.id || ""}
                    onChange={e => void changeStage(currentChat, e.target.value)}
                    disabled={!stages.length}
                    aria-label="Seleccionar etapa de venta privada"
                    className="h-9 min-w-0 max-w-52 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                    {!stages.length && <option value="">Sin etapas disponibles</option>}
                    {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                  </select>
                </label>
                <span className="text-[11px] text-muted-foreground">Último mensaje: {formatDate(currentChat.last_message_at) || "Sin mensajes"}</span>
              </div>
            </div>
            <div className="private-wa-scroll flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-3 py-3">
              <div className="space-y-2">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.from_me ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${msg.from_me ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"}`}>
                      <p className="whitespace-pre-wrap break-words">{msg.message_text || "[Mensaje multimedia]"}</p>
                      <p className={`mt-1 text-right text-[10px] ${msg.from_me ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{formatDate(msg.sent_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-border bg-card p-3">
              <textarea value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                rows={1} maxLength={4000} disabled={!connected}
                placeholder={connected ? "Escribí un mensaje privado..." : "Conectá tu WhatsApp para responder"}
                className="max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60" />
              <button type="button" onClick={() => void sendMessage()} disabled={!connected || !draft.trim() || busy}
                className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50" title="Enviar desde mi WhatsApp">
                <Send className="size-4" />
              </button>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}
