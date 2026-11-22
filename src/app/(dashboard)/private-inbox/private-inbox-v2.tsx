"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Check, ChevronDown, Copy, Edit3, EllipsisVertical, GitBranch,
  LockKeyhole, MessageCircle, RefreshCw, Search, Send, Settings2,
  Smartphone, Unplug, UserRound, Wifi, WifiOff, X
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Chat = {
  id: string; remote_jid: string; contact_name: string | null;
  display_name_override: string | null; profile_name: string | null;
  manual_phone: string | null; phone_jid: string | null;
  stage_id: string | null; last_message_text: string | null;
  last_message_at: string | null; unread_count: number;
};
type Note = { id: string; message_text: string; from_me: boolean; sent_at: string; message_type: string };
type Stage = { id: string; name: string; color: string; position: number };
type Inbox = { id: string; display_name: string; connected_phone: string | null };
type Connection = {
  status: string; ready?: boolean; qr?: string | null; phone?: string | null;
  lastError?: string | null; error?: string | null; lastCode?: number | string | null
};

const isHumanName = (value: string | null | undefined) =>
  !!value && !!value.trim() && !/^[0-9]+$/.test(value.trim());
const digits = (jid: string) => jid.split("@")[0];
const phoneNumber = (chat: Chat) => chat.manual_phone ||
  (chat.phone_jid ? "+" + digits(chat.phone_jid) :
    chat.remote_jid.endsWith("@s.whatsapp.net") ? "+" + digits(chat.remote_jid) : "");
const titleOf = (chat: Chat) => chat.display_name_override?.trim() ||
  (isHumanName(chat.contact_name) ? chat.contact_name!.trim() : "") ||
  (isHumanName(chat.profile_name) ? chat.profile_name!.trim() : "") ||
  phoneNumber(chat) || "Contacto sin identificar";
const initials = (name: string) => {
  if (name === "Contacto sin identificar") return "?";
  return name.split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase();
};
const timestamp = (value: string | null, complete = false) => {
  if (!value) return "Sin mensajes";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("es-AR", complete ?
    { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" } :
    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const tone = (stage?: Stage) => stage?.color && /^#[0-9a-fA-F]{6}$/.test(stage.color)
  ? stage.color : "#64748b";

export default function PrivateInboxV2() {
  const { user, accountId, loading: authLoading, accountStatus } = useAuth();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [connection, setConnection] = useState<Connection>({ status: "not_connected" });
  const [busy, setBusy] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [renameInbox, setRenameInbox] = useState(false);
  const [inboxDraft, setInboxDraft] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(120);
  const [active, setActive] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Note[]>([]);
  const [messageLimit, setMessageLimit] = useState(120);
  const [stages, setStages] = useState<Stage[]>([]);
  const [draft, setDraft] = useState("");
  const [editContact, setEditContact] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [refreshingContacts, setRefreshingContacts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastChatRef = useRef<string | null>(null);

  const loadInbox = useCallback(async () => {
    if (!user) return;
    const { data, error } = await createClient().from("private_whatsapp_inboxes")
      .select("id,display_name,connected_phone").eq("owner_user_id", user.id).maybeSingle();
    if (error) return;
    setInbox(data as Inbox | null);
    if (data) setInboxDraft(current => current || data.display_name);
  }, [user]);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch("/api/private-whatsapp", { cache: "no-store" });
      const result = await response.json();
      setConnection(response.ok ? result : { status: "unavailable", error: result.error });
    } catch {
      setConnection({ status: "unavailable", error: "No responde el conector privado" });
    }
  }, [user]);

  const loadChats = useCallback(async () => {
    if (!inbox) return;
    let query = createClient().from("private_whatsapp_chats")
      .select("id,remote_jid,contact_name,display_name_override,profile_name,manual_phone,phone_jid,stage_id,last_message_text,last_message_at,unread_count", { count: "exact" })
      .eq("inbox_id", inbox.id);
    const term = search.trim().replace(/[^\p{L}\p{N} +@._-]/gu, "").slice(0, 60);
    if (term) {
      query = query.or([
        "contact_name.ilike.%" + term + "%",
        "profile_name.ilike.%" + term + "%",
        "display_name_override.ilike.%" + term + "%",
        "manual_phone.ilike.%" + term + "%",
        "phone_jid.ilike.%" + term + "%"
      ].join(","));
    }
    const { data, error, count } = await query
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(0, limit - 1);
    if (error) return;
    const incoming = data as Chat[] || [];
    setChats(incoming);
    setTotal(count || 0);
    setActive(previous => {
      if (!previous) return null;
      return incoming.find(item => item.id === previous.id) || previous;
    });
  }, [inbox, limit, search]);

  const loadMessages = useCallback(async () => {
    if (!inbox || !active) return;
    const { data, error } = await createClient().from("private_whatsapp_messages")
      .select("id,message_text,from_me,sent_at,message_type")
      .eq("inbox_id", inbox.id).eq("chat_id", active.id)
      .order("sent_at", { ascending: false }).limit(messageLimit);
    if (!error) setMessages(((data || []) as Note[]).reverse());
    setLoadingHistory(false);
  }, [inbox, active?.id, messageLimit]);

  const loadStages = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const { data: pipelines } = await db.from("pipelines").select("id").eq("account_id", accountId);
    if (!pipelines?.length) return;
    const { data } = await db.from("pipeline_stages")
      .select("id,name,color,position").in("pipeline_id", pipelines.map(p => p.id))
      .order("position");
    setStages((data || []) as Stage[]);
  }, [accountId]);

  useEffect(() => {
    if (user && accountStatus === "ready") {
      void loadInbox();
      void loadStatus();
      void loadStages();
    }
  }, [user, accountStatus, loadInbox, loadStatus, loadStages]);
  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => void loadStatus(), 9000);
    return () => window.clearInterval(interval);
  }, [loadStatus, user]);
  useEffect(() => {
    void loadChats();
    const interval = window.setInterval(() => void loadChats(), 4500);
    return () => window.clearInterval(interval);
  }, [loadChats]);
  useEffect(() => {
    void loadMessages();
    const interval = window.setInterval(() => void loadMessages(), 3500);
    return () => window.clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !active) return;
    const switched = lastChatRef.current !== active.id;
    if (switched) {
      lastChatRef.current = active.id;
      requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    } else if (node.scrollHeight - node.scrollTop - node.clientHeight < 210) {
      requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    }
  }, [messages.length, active?.id]);

  const linked = !!connection.ready;
  const stageFor = (chat: Chat) => stages.find(s => s.id === chat.stage_id);
  const effectiveStage = (chat: Chat) => stageFor(chat) ||
    stages.find(s => s.name.toLowerCase() === "nuevo contacto");

  async function connectionAction(action: "connect" | "reset" | "disconnect") {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/private-whatsapp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cambiar la conexión");
      if (action === "disconnect") toast.success("Dispositivo desvinculado del CRM");
      if (action === "connect" || action === "reset") setShowConnection(true);
      await loadStatus();
      await loadInbox();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo conectar a WhatsApp");
    } finally { setBusy(false); }
  }

  async function refreshAll() {
    await Promise.all([loadStatus(), loadChats(), loadMessages()]);
    toast.success("Bandeja actualizada");
  }

  async function refreshNames() {
    if (refreshingContacts || !linked) return;
    setRefreshingContacts(true);
    try {
      const response = await fetch("/api/private-whatsapp/contacts", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron consultar perfiles");
      toast.message(body.resolved ? "Datos disponibles de WhatsApp recuperados" :
        "No hay nuevos datos de perfil disponibles en WhatsApp");
      await loadChats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron actualizar los nombres");
    } finally { setRefreshingContacts(false); }
  }

  async function changeStage(chat: Chat, stage: string) {
    if (!user) return;
    const { error } = await createClient().from("private_whatsapp_chats")
      .update({ stage_id: stage || null }).eq("id", chat.id).eq("owner_user_id", user.id);
    if (error) { toast.error("No se pudo guardar la etapa"); return; }
    setChats(old => old.map(x => x.id === chat.id ? { ...x, stage_id: stage || null } : x));
    setActive(old => old?.id === chat.id ? { ...old, stage_id: stage || null } : old);
    toast.success("Etapa actualizada");
  }

  async function saveContact(event: React.FormEvent) {
    event.preventDefault();
    if (!active || !user || saving) return;
    const phone = phoneDraft.replace(/[\s()-]/g, "").trim();
    if (phone && !/^\+?[0-9]{7,20}$/.test(phone)) {
      toast.error("Ingresá un teléfono con código de país, solo números");
      return;
    }
    const alias = aliasDraft.trim().slice(0, 120);
    if (!alias && !active.profile_name && !phone) {
      toast.error("Escribí un nombre o teléfono para identificar el contacto");
      return;
    }
    setSaving(true);
    const patch = { display_name_override: alias || null, manual_phone: phone || null };
    const { error } = await createClient().from("private_whatsapp_chats")
      .update(patch).eq("id", active.id).eq("owner_user_id", user.id);
    setSaving(false);
    if (error) { toast.error("No se pudo guardar el contacto"); return; }
    const next = { ...active, ...patch };
    setActive(next);
    setChats(rows => rows.map(c => c.id === next.id ? next : c));
    setEditContact(false);
    toast.success("Contacto guardado en tu bandeja privada");
  }

  async function renamePrivateInbox() {
    if (!inbox || !inboxDraft.trim()) return;
    const name = inboxDraft.trim().slice(0, 60);
    const { error } = await createClient().from("private_whatsapp_inboxes")
      .update({ display_name: name }).eq("id", inbox.id);
    if (error) { toast.error("No se pudo guardar el nombre"); return; }
    setInbox({ ...inbox, display_name: name });
    setRenameInbox(false);
    window.dispatchEvent(new Event("wacrm:private-inbox-name-changed"));
  }

  function openChat(chat: Chat) {
    lastChatRef.current = null;
    setActive(chat);
    setMessageLimit(120);
    setMessages([]);
    setDraft("");
    setEditContact(false);
    if (chat.unread_count && inbox) {
      void createClient().from("private_whatsapp_chats")
        .update({ unread_count: 0 }).eq("id", chat.id).eq("inbox_id", inbox.id).then(() => void loadChats());
    }
  }

  async function sendMessage() {
    if (!active || !linked || busy || !draft.trim()) return;
    setBusy(true);
    const text = draft.trim();
    try {
      const response = await fetch("/api/private-whatsapp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", remoteJid: active.remote_jid, text })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo enviar el mensaje");
      setDraft("");
      await loadMessages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar");
    } finally { setBusy(false); }
  }

  const mobileChat = !!active;
  const selectedName = active ? titleOf(active) : "";
  const number = active ? phoneNumber(active) : "";
  const selectedStage = active ? effectiveStage(active) : undefined;
  if (authLoading) return <p className="p-4 text-sm text-muted-foreground">Cargando...</p>;
  if (!user) return <p className="p-4 text-sm">Iniciá sesión para acceder a tu WhatsApp privado.</p>;

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-h-[320px] flex-col overflow-hidden bg-background sm:-m-6">
      {/* The global page header stays compact, and disappears on mobile inside a chat. */}
      <div className={(mobileChat ? "hidden sm:flex " : "flex ") +
        "shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 sm:px-4"}>
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            {renameInbox ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <input className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                  value={inboxDraft} maxLength={60} aria-label="Nombre de la bandeja"
                  onChange={e => setInboxDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void renamePrivateInbox(); }} />
                <button type="button" onClick={() => void renamePrivateInbox()}
                  className="rounded-md bg-primary p-1.5 text-primary-foreground" aria-label="Guardar nombre">
                  <Check className="size-4" />
                </button>
              </div>
            ) : (
              <button type="button" className="flex max-w-full items-center gap-1 text-left font-semibold text-foreground"
                onClick={() => setRenameInbox(true)} title="Cambiar nombre de la bandeja">
                <span className="truncate text-sm">{inbox?.display_name || "Mi WhatsApp"}</span>
                <Edit3 className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            )}
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {linked ? <Wifi className="size-3 text-emerald-500" /> : <WifiOff className="size-3" />}
              {linked ? "Conectado" : "Sin conexión"} · <LockKeyhole className="size-3" /> Solo yo
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" title="Actualizar mensajes" onClick={() => void refreshAll()}
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted">
            <RefreshCw className="size-4" />
          </button>
          <button type="button" title="Configuración de WhatsApp" onClick={() => setShowConnection(x => !x)}
            className={"grid size-9 place-items-center rounded-lg border border-border hover:bg-muted " +
              (showConnection ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Settings2 className="size-4" />
          </button>
        </div>
      </div>

      {showConnection && !mobileChat && (
        <div className="shrink-0 space-y-2 border-b border-border bg-card-2 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Conexión de WhatsApp</p>
            <button type="button" onClick={() => setShowConnection(false)} title="Cerrar"
              className="rounded-lg p-1 text-muted-foreground"><X className="size-4" /></button>
          </div>
          <p className="text-xs text-muted-foreground">
            {linked ? "Número conectado: +" + (connection.phone || inbox?.connected_phone || "") :
              connection.lastError || connection.error || "Vinculá el número desde Dispositivos vinculados."}
          </p>
          {!linked && connection.qr && (
            <div className="flex flex-col items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={connection.qr} alt="Código QR para vincular WhatsApp"
                className="size-40 rounded-lg border border-border bg-white p-1.5" />
              <p className="text-center text-[11px] text-muted-foreground">
                Escaneá desde WhatsApp → Dispositivos vinculados
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!linked ? (
              <>
                <button type="button" disabled={busy} onClick={() => void connectionAction("connect")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  <Smartphone className="size-4" /> Vincular
                </button>
                <button type="button" disabled={busy} onClick={() => void connectionAction("reset")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs disabled:opacity-50">
                  <RefreshCw className="size-3.5" /> Nuevo QR
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={refreshingContacts} onClick={() => void refreshNames()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs disabled:opacity-50">
                  <UserRound className="size-4" /> Actualizar perfiles
                </button>
                <button type="button" disabled={busy} onClick={() => {
                  if (window.confirm("¿Desvincular este dispositivo del CRM? No se borrarán los chats importados."))
                    void connectionAction("disconnect");
                }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs">
                  <Unplug className="size-4" /> Desvincular
                </button>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            La conexión mediante dispositivo vinculado no es una integración oficial de WhatsApp.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className={(mobileChat ? "hidden sm:flex " : "flex ") +
          "min-h-0 w-full shrink-0 flex-col border-r border-border bg-card sm:w-[318px] lg:w-[350px]"}>
          <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Conversaciones</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {total.toLocaleString("es-AR")}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input value={search} type="search" placeholder="Buscar nombre o número..."
                aria-label="Buscar conversaciones privadas"
                onChange={e => { setSearch(e.target.value); setLimit(120); }}
                className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
            </div>
          </div>
          <div className="private-wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {chats.map(chat => {
              const stage = effectiveStage(chat);
              const title = titleOf(chat);
              const chosen = active?.id === chat.id;
              return (
                <button key={chat.id} type="button" onClick={() => openChat(chat)}
                  className={"block w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 " +
                    (chosen ? "bg-primary/10" : "")}>
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-primary/10 text-xs font-bold text-primary">
                      {initials(title)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
                        {chat.unread_count > 0 &&
                          <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{chat.unread_count}</span>}
                      </div>
                      {!!chat.profile_name && chat.profile_name !== title &&
                        <p className="truncate text-[11px] text-muted-foreground">Perfil: {chat.profile_name}</p>}
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Último: {timestamp(chat.last_message_at)}
                      </p>
                      <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{chat.last_message_text || "Sin mensajes"}</span>
                        {!!stage && <span className="max-w-[46%] shrink-0 truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ borderColor: tone(stage) + "70", backgroundColor: tone(stage) + "1a", color: tone(stage) }}>
                          {stage.name}
                        </span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {chats.length < total && (
              <button type="button" onClick={() => setLimit(l => l + 120)}
                className="flex w-full items-center justify-center gap-1 px-3 py-3 text-xs font-semibold text-primary hover:bg-muted">
                <ChevronDown className="size-4" /> Mostrar más ({total - chats.length})
              </button>
            )}
            {!chats.length && <p className="p-5 text-center text-sm text-muted-foreground">
              {search ? "No hay coincidencias" : "Aún no hay conversaciones importadas"}
            </p>}
          </div>
        </aside>

        <section className={(mobileChat ? "flex " : "hidden sm:flex ") +
          "min-h-0 min-w-0 flex-1 flex-col bg-background"}>
          {!active ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <MessageCircle className="size-9 opacity-40" />
              Seleccioná una conversación
            </div>
          ) : (
            <>
              <header className="shrink-0 border-b border-border bg-card px-2.5 py-2 sm:px-4">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setActive(null)} aria-label="Volver a conversaciones"
                    className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-muted sm:hidden">
                    <ArrowLeft className="size-5" />
                  </button>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {initials(selectedName)}
                  </span>
                  <button type="button" onClick={() => {
                    setAliasDraft(active.display_name_override || (isHumanName(active.contact_name) ? active.contact_name! : ""));
                    setPhoneDraft(active.manual_phone || phoneNumber(active));
                    setEditContact(true);
                  }} title="Ver o editar contacto"
                    className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-1 truncate text-[14px] font-semibold">
                      <span className="truncate">{selectedName}</span>
                      <Edit3 className="size-3.5 shrink-0 text-muted-foreground" />
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {active.profile_name ? "Perfil WhatsApp: " + active.profile_name :
                        number ? number : "Perfil de WhatsApp no disponible · Editar contacto"}
                    </span>
                  </button>
                  {number && <button type="button" onClick={() => {
                    void navigator.clipboard.writeText(number).then(() => toast.success("Teléfono copiado"));
                  }} aria-label="Copiar teléfono" title="Copiar teléfono"
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted">
                    <Copy className="size-4" />
                  </button>}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                  <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <GitBranch className="size-3.5 text-primary" />
                    <span className="hidden sm:inline">Etapa</span>
                    <select value={active.stage_id || selectedStage?.id || ""}
                      onChange={e => void changeStage(active, e.target.value)}
                      disabled={!stages.length} aria-label="Etapa de venta"
                      className="h-8 max-w-[174px] rounded-lg border border-input bg-background px-2 text-xs font-semibold text-foreground outline-none">
                      {!stages.length && <option value="">Sin etapas</option>}
                      {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                    </select>
                  </label>
                  <span className="truncate text-right text-[11px] text-muted-foreground">
                    Último: {timestamp(active.last_message_at)}
                  </span>
                </div>
              </header>
              <div ref={scrollRef} className="private-wa-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
                {messages.length >= messageLimit && (
                  <button type="button" onClick={() => { setLoadingHistory(true); setMessageLimit(x => x + 120); }}
                    className="mx-auto block rounded-full border border-border bg-card px-4 py-1.5 text-xs text-primary">
                    {loadingHistory ? "Cargando..." : "Ver mensajes anteriores"}
                  </button>
                )}
                {messages.map(msg =>
                  <div key={msg.id} className={"flex " + (msg.from_me ? "justify-end" : "justify-start")}>
                    <div className={"max-w-[84%] rounded-2xl px-3 py-2 text-[13px] shadow-sm sm:max-w-[70%] " +
                      (msg.from_me ? "rounded-br-md bg-primary text-primary-foreground" :
                        "rounded-bl-md border border-border bg-card text-foreground")}>
                      <p className="whitespace-pre-wrap break-words">{msg.message_text || "Mensaje multimedia"}</p>
                      <p className={"mt-1 text-right text-[10px] " +
                        (msg.from_me ? "text-primary-foreground/75" : "text-muted-foreground")}>
                        {timestamp(msg.sent_at, true)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <form onSubmit={e => { e.preventDefault(); void sendMessage(); }}
                className="flex shrink-0 items-end gap-2 border-t border-border bg-card px-2.5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-4">
                <textarea rows={1} value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                  maxLength={4000} disabled={!linked}
                  placeholder={linked ? "Escribí un mensaje..." : "Conectá WhatsApp para responder"}
                  className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/60 disabled:opacity-60" />
                <button type="submit" aria-label="Enviar mensaje" title="Enviar mensaje"
                  disabled={!linked || !draft.trim() || busy}
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40">
                  <Send className="size-4" />
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {active && editContact && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button type="button" aria-label="Cerrar edición" onClick={() => setEditContact(false)}
            className="absolute inset-0 bg-black/65" />
          <form onSubmit={e => void saveContact(e)}
            className="relative z-10 w-full max-w-md space-y-4 rounded-t-2xl border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">Datos del contacto</h3>
                <p className="text-xs text-muted-foreground">Solo vos podés ver estos cambios.</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setEditContact(false)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Nombre de perfil de WhatsApp</p>
              <p className="mt-1 text-sm font-medium">{active.profile_name || "WhatsApp no proporcionó el nombre de perfil"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Este dato viene de WhatsApp y no puede modificarse desde el CRM.</p>
            </div>
            <label className="block space-y-1 text-xs font-semibold text-foreground">
              Nombre personalizado
              <input value={aliasDraft} maxLength={120} onChange={e => setAliasDraft(e.target.value)}
                placeholder="Ej. Pablo - interesado en Hilux"
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus:border-primary" />
            </label>
            <label className="block space-y-1 text-xs font-semibold text-foreground">
              Teléfono del contacto
              <input value={phoneDraft} inputMode="tel" onChange={e => setPhoneDraft(e.target.value)}
                placeholder="Ej. +5492984123456"
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus:border-primary" />
              <span className="block text-[11px] font-normal text-muted-foreground">
                Si WhatsApp no informa el número, podés ingresarlo manualmente sin modificar la cuenta del cliente.
              </span>
            </label>
            <button type="submit" disabled={saving}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
              <Check className="size-4" /> Guardar contacto
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
