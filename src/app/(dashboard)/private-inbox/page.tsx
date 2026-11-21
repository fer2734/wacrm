"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Check, Copy, Edit2, LockKeyhole, MessageCircle, RefreshCw, Send, Smartphone, Unplug } from "lucide-react";

type PrivateInbox = { id: string; display_name: string; connection_status: string; connected_phone: string | null };
type PrivateChat = { id: string; remote_jid: string; contact_name: string; last_message_text: string; last_message_at: string | null; unread_count: number };
type PrivateMessage = { id: string; message_text: string; from_me: boolean; sent_at: string; message_type: string };
type BridgeStatus = { status: string; qr?: string | null; phone?: string | null; ready?: boolean; error?: string;
  historyEvents?: number; messageEvents?: number; historyProgress?: number | null;
  historyFinished?: boolean; lastError?: string | null };

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const getPhone = (jid: string) => jid.split("@")[0];
const isPhoneJid = (jid: string) => jid.endsWith("@s.whatsapp.net");

export default function PrivateInboxPage() {
  const { user, loading: authLoading, accountStatus } = useAuth();
  const [inbox, setInbox] = useState<PrivateInbox | null>(null);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [connection, setConnection] = useState<BridgeStatus>({ status: "not_connected" });
  const [chats, setChats] = useState<PrivateChat[]>([]);
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
    if (!inbox) { setChats([]); return; }
    const { data, error } = await createClient().from("private_whatsapp_chats")
      .select("id,remote_jid,contact_name,last_message_text,last_message_at,unread_count")
      .eq("inbox_id", inbox.id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(250);
    if (error) { console.error(error.message); return; }
    setChats((data || []) as PrivateChat[]);
  }, [inbox]);

  const loadMessages = useCallback(async () => {
    if (!selected || !inbox) { setMessages([]); return; }
    const { data, error } = await createClient().from("private_whatsapp_messages")
      .select("id,message_text,from_me,sent_at,message_type")
      .eq("inbox_id", inbox.id).eq("chat_id", selected)
      .order("sent_at", { ascending: false }).limit(200);
    if (error) { console.error(error.message); return; }
    setMessages(((data || []) as PrivateMessage[]).reverse());
  }, [selected, inbox]);

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

  async function command(action: "connect" | "disconnect" | "send", payload?: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/private-whatsapp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload })
      });
      const result = await response.json();
      if (!response.ok) { toast.error(result.error || "No se pudo completar la acción"); return false; }
      if (action === "connect") {
        await loadInbox();
        await pollStatus();
        toast.success("Vinculación iniciada. Escaneá el código QR.");
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
    if (chat.unread_count && inbox) {
      await createClient().from("private_whatsapp_chats")
        .update({ unread_count: 0 }).eq("id", chat.id).eq("inbox_id", inbox.id);
      void loadChats();
    }
  }

  const currentChat = chats.find(c => c.id === selected);
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
            {syncing ? " · Importando mensajes..." : importedCount ? " · " + importedCount + " mensajes importados" : ""}
            {connection.historyEvents ? " · Historial recibido: " + connection.historyEvents : ""}
          </p>
          <div className="flex items-center gap-1">
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
            {(connected || connection.status === "qr" || connection.status === "connecting") && (
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
          {syncError || connection.lastError}
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
                connection.status === "connecting" || connection.status === "qr" ? "Preparando el código QR..." :
                "Conectá tu número mediante Dispositivos vinculados. El WhatsApp de tu celular permanece activo."}
            </p>
          )}
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
            Conexión por dispositivo vinculado no oficial: puede desconectarse y tiene riesgos de restricciones por WhatsApp.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className={`min-h-0 w-full shrink-0 overflow-y-auto border-r border-border bg-card sm:w-72 lg:w-80 ${mobileChat ? "hidden sm:block" : ""}`}>
          <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">Conversaciones personales ({chats.length})</div>
          {chats.length === 0 && <p className="px-3 py-5 text-xs text-muted-foreground">
            {connected ? "Sincronizando chats e historial. Puede tardar al importar un número con muchas conversaciones." : "Vinculá tu WhatsApp para ver tus chats privados."}
          </p>}
          {chats.map(chat => (
            <button type="button" key={chat.id} onClick={() => void selectChat(chat)}
              className={`w-full border-b border-border/60 px-3 py-3 text-left hover:bg-muted/50 ${selected === chat.id ? "bg-primary/10" : ""}`}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{chat.contact_name || (isPhoneJid(chat.remote_jid) ? "+" + getPhone(chat.remote_jid) : getPhone(chat.remote_jid))}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(chat.last_message_at)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="truncate text-xs text-muted-foreground">{chat.last_message_text}</p>
                {chat.unread_count > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{chat.unread_count}</span>}
              </div>
            </button>
          ))}
        </aside>

        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${mobileChat ? "flex" : "hidden sm:flex"}`}>
          {!currentChat ? <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <MessageCircle className="size-8 opacity-50" /> Seleccioná un chat privado
          </div> : <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
              <button type="button" className="min-h-9 rounded-md border border-border px-2 text-xs sm:hidden"
                onClick={() => setMobileChat(false)}>Volver</button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{currentChat.contact_name || (isPhoneJid(currentChat.remote_jid) ? "+" + getPhone(currentChat.remote_jid) : getPhone(currentChat.remote_jid))}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isPhoneJid(currentChat.remote_jid) ? "+" + getPhone(currentChat.remote_jid) : "Contacto de WhatsApp"}
                </p>
              </div>
              {isPhoneJid(currentChat.remote_jid) && (
                <button type="button" title="Copiar teléfono" aria-label="Copiar teléfono"
                  onClick={() => void navigator.clipboard.writeText(getPhone(currentChat.remote_jid)).then(() => toast.success("Número copiado"))}
                  className="flex size-9 items-center justify-center rounded-md border border-border">
                  <Copy className="size-4" />
                </button>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-3">
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
