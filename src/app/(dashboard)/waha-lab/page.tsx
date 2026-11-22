"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArchiveRestore, ArrowLeft, Check, ChevronDown, Copy, Edit3, GitBranch, LoaderCircle,
  LockKeyhole, MessageCircle, RefreshCw, Search, Send, Settings2, Smartphone,
  Unplug, Wifi, WifiOff, X
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type WaStatus = { status?: string; engine?: { engine?: string } | string; me?: { id?: string };
  error?: string; message?: string };
type WaMessage = { id: string; timestamp: number; fromMe?: boolean;
  body?: string; type?: string; hasMedia?: boolean };
type WaChat = { id: string; name?: string; picture?: string | null;
  lastMessage?: WaMessage | null; unreadCount?: number;
  archived?: boolean; isArchived?: boolean; isFavorite?: boolean;
  _chat?: { unreadCount?: number; archived?: boolean; isArchived?: boolean; isFavorite?: boolean } };
type WaLabel = { id: string; name: string; type?: number; isActive?: boolean; colorHex?: string };
type WaContact = { id: string; number?: string; name?: string; pushname?: string;
  shortName?: string; isMyContact?: boolean };
type WaLid = { lid: string; pn: string | null };
type Stage = { id: string; name: string; color: string; position: number };
type Setting = { chat_id: string; alias: string | null; stage_id: string | null };
type Inbox = { id: string; display_name: string };

// WAHA WEBJS exposes archived state on full chats; overview may include
// it inside _chat. Preserve only explicit boolean values.
function archivedFlag(chat: WaChat): boolean {
  if (typeof chat.archived === "boolean") return chat.archived;
  if (typeof chat.isArchived === "boolean") return chat.isArchived;
  return chat._chat?.archived === true || chat._chat?.isArchived === true;
}
function normalizeChat(value: unknown): WaChat | null {
  if (typeof value === "string")
    return /@(c\.us|g\.us|lid)$/.test(value) ? { id: value } : null;
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawId = item.id || item.chatId;
  const id = typeof rawId === "string" ? rawId :
    rawId && typeof rawId === "object"
      ? (rawId as Record<string, unknown>)._serialized : null;
  if (typeof id !== "string" || !/@(c\.us|g\.us|lid)$/.test(id)) return null;
  const rawInner = item._chat && typeof item._chat === "object"
    ? item._chat as Record<string, unknown> : null;
  const archived = typeof item.archived === "boolean" ? item.archived :
    typeof item.isArchived === "boolean" ? item.isArchived :
    typeof rawInner?.archived === "boolean" ? rawInner.archived :
    typeof rawInner?.isArchived === "boolean" ? rawInner.isArchived : undefined;
  const rawLast = item.lastMessage && typeof item.lastMessage === "object"
    ? item.lastMessage as WaMessage : null;
  return { id,
    name: typeof item.name === "string" ? item.name : undefined,
    lastMessage: rawLast,
    unreadCount: typeof item.unreadCount === "number" ? item.unreadCount :
      typeof rawInner?.unreadCount === "number" ? rawInner.unreadCount : 0,
    archived, isFavorite: item.isFavorite === true || rawInner?.isFavorite === true
  };
}
function normalizedList(value: unknown): WaChat[] {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown> : {};
  const array: unknown[] = Array.isArray(value) ? value :
    Array.isArray(record.chats) ? record.chats :
    Array.isArray(record.data) ? record.data :
    Array.isArray(record.items) ? record.items : [];
  return array.map(normalizeChat).filter((c): c is WaChat => c !== null);
}
function ts(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "Sin mensajes";
  const n = value > 100000000000 ? value : value * 1000;
  return new Date(n).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}
function jidPhone(jid: string | undefined): string {
  if (!jid?.endsWith("@c.us")) return "";
  return "+" + jid.split("@")[0];
}
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(s => s.slice(0, 1).toUpperCase()).join("") || "?";
}
async function json(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || ("Error HTTP " + response.status));
  return data;
}
async function action(name: string, data?: Record<string, unknown>) {
  return json("/api/waha-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, ...(data || {}) })
  });
}
export default function WahaLab() {
  const { user, accountId, loading, accountStatus } = useAuth();
  const [status, setStatus] = useState<WaStatus>({ status: "NOT_CREATED" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrEpoch, setQrEpoch] = useState(0);
  const [qrError, setQrError] = useState("");
  const [pairingMethod, setPairingMethod] = useState<"qr" | "code">("qr");
  const [pairPhone, setPairPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingError, setPairingError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [chats, setChats] = useState<WaChat[]>([]);
  const [indexedChats, setIndexedChats] = useState<WaChat[]>([]);
  const indexInFlight = useRef(false);
  const [indexedCount, setIndexedCount] = useState(0);
  const [indexComplete, setIndexComplete] = useState(false);
  const [lastIndexAt, setLastIndexAt] = useState<string | null>(null);
  const [indexPageSize, setIndexPageSize] = useState(200);
  const [indexError, setIndexError] = useState("");
  const [lists, setLists] = useState<WaLabel[]>([]);
  const [labelChats, setLabelChats] = useState<Record<string, WaChat[]>>({});
  const [view, setView] = useState("all");
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState("");
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [lids, setLids] = useState<WaLid[]>([]);
  const [limit, setLimit] = useState(80);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<WaChat | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [messageLimit, setMessageLimit] = useState(80);
  const [draft, setDraft] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [rename, setRename] = useState(false);
  const [nameDraft, setNameDraft] = useState("WAHA · Pruebas");
  const [aliasEdit, setAliasEdit] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const [namesLoading, setNamesLoading] = useState(false);
  const connected = status.status === "WORKING";
  const qrReady = status.status === "SCAN_QR_CODE" || status.status === "SCAN_QR";

  const getStatus = useCallback(async () => {
    if (!user) return;
    try {
      const incoming = await json("/api/waha-lab?action=status");
      setStatus(incoming);
      setError("");
      if (incoming.status === "SCAN_QR" || incoming.status === "SCAN_QR_CODE")
        setQrEpoch(Math.floor(Date.now() / 12000));
      if (incoming.status === "WORKING") {
        setPairingCode("");
        setPairingError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "WAHA no responde");
    }
  }, [user]);
  const loadChats = useCallback(async () => {
    if (!user || !connected) return;
    try {
      const result = await json("/api/waha-lab?action=chats&limit=200&offset=0");
      const items: WaChat[] = normalizedList(result);
      setChats(items);
      setActive(prev => prev ? items.find(x => x.id === prev.id) || prev : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron consultar los chats");
    }
  }, [user, connected]);
  // Fetch every page of the *overview* endpoint. The previous full-chat
  // endpoint failed, leaving only the first 80 results (29 active + 51 archived).
  // Progressive updates keep the UI responsive while recovering older chats.
  const loadIndex = useCallback(async () => {
    if (!user || !connected || indexInFlight.current) return;
    indexInFlight.current = true;
    setListsLoading(true);
    setIndexError("");
    const collected = new Map<string, WaChat>();
    let complete = false;
    try {
      let pageLimit = 200;
      for (let offset = 0; offset < 10000;) {
        let result: unknown;
        try {
          result = await json("/api/waha-lab?action=chats&limit=" + pageLimit + "&offset=" + offset);
        } catch (error) {
          // WEBJS can time out while building a large overview page. Retry
          // the same offset in smaller pages rather than abandoning import.
          if (pageLimit > 25) {
            pageLimit = Math.max(25, Math.floor(pageLimit / 2));
            setIndexPageSize(pageLimit);
            continue;
          }
          throw error;
        }
        const page = normalizedList(result);
        const packet = result && typeof result === "object"
          ? result as Record<string, unknown> : {};
        const rawRows: unknown[] = Array.isArray(result) ? result :
          Array.isArray(packet.chats) ? packet.chats :
          Array.isArray(packet.data) ? packet.data : [];
        const previousSize = collected.size;
        for (const chat of page) collected.set(chat.id, chat);
        // Preserve previously recovered chats while another scan is running.
        // Partial/failed scans should never clear older results.
        setIndexedChats(previous => {
          const combined = new Map(previous.map(chat => [chat.id, chat]));
          for (const chat of collected.values()) combined.set(chat.id, chat);
          return [...combined.values()];
        });
        setIndexedCount(collected.size);
        if (rawRows.length < pageLimit) {
          complete = true;
          break;
        }
        if (offset > 0 && collected.size === previousSize) {
          setIndexError("WAHA repitió la misma página. Podés reintentar la sincronización.");
          break;
        }
        offset += pageLimit;
      }
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : "No se pudieron recuperar los chats anteriores");
    } finally {
      if (complete) {
        setIndexComplete(true);
        setLastIndexAt(new Date().toISOString());
        setIndexError("");
      } else {
        setIndexComplete(false);
      }
      indexInFlight.current = false;
      setListsLoading(false);
    }
  }, [user, connected]);

  const loadLists = useCallback(async () => {
    if (!user || !connected) return;
    try {
      const result = await json("/api/waha-lab?action=labels");
      const raw: unknown[] = Array.isArray(result) ? result : [];
      setLists(raw.filter((v): v is WaLabel => !!v && typeof v === "object" &&
        typeof (v as WaLabel).id === "string" && typeof (v as WaLabel).name === "string"));
      setListsError("");
    } catch (err) {
      setListsError(err instanceof Error ? err.message : "No se pudieron sincronizar las listas");
    }
  }, [user, connected]);

  const loadLabelChats = useCallback(async (id: string) => {
    if (!user || !connected) return;
    try {
      const result = await json("/api/waha-lab?action=label-chats&labelId=" + encodeURIComponent(id));
      setLabelChats(current => ({ ...current, [id]: normalizedList(result) }));
      setListsError("");
    } catch (err) {
      setListsError(err instanceof Error ? err.message : "No se pudo sincronizar esta lista");
    }
  }, [user, connected]);

  const loadMessages = useCallback(async () => {
    if (!active || !connected) return;
    try {
      const result = await json("/api/waha-lab?action=messages&chatId=" +
        encodeURIComponent(active.id) + "&limit=" + messageLimit);
      const rows: WaMessage[] = Array.isArray(result) ? result : result.messages || [];
      setMessages(rows.slice().sort((a,b) => (a.timestamp || 0)-(b.timestamp || 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los mensajes");
    }
  }, [active?.id, connected, messageLimit]);

  const loadNames = useCallback(async () => {
    if (!user || !connected) return;
    setNamesLoading(true);
    try {
      const allContacts: WaContact[] = [];
      const allLids: WaLid[] = [];
      for (let offset = 0; offset < 2000; offset += 400) {
        const page = await json("/api/waha-lab?action=contacts&limit=400&offset=" + offset);
        const batch = Array.isArray(page) ? page as WaContact[] : [];
        allContacts.push(...batch);
        if (batch.length < 400) break;
      }
      for (let offset = 0; offset < 2000; offset += 400) {
        try {
          const page = await json("/api/waha-lab?action=lids&limit=400&offset=" + offset);
          const batch = Array.isArray(page) ? page as WaLid[] : [];
          allLids.push(...batch);
          if (batch.length < 400) break;
        } catch { break; }
      }
      setContacts(allContacts);
      setLids(allLids);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar los contactos WAHA");
    } finally { setNamesLoading(false); }
  }, [user, connected]);

  useEffect(() => { if (user) void getStatus(); }, [user, getStatus]);
  useEffect(() => {
    if (!user) return;
    const handle = window.setInterval(() => void getStatus(), 6500);
    return () => window.clearInterval(handle);
  }, [user, getStatus]);
  useEffect(() => {
    if (!connected) return;
    void loadChats();
    const handle = window.setInterval(() => void loadChats(), 8000);
    return () => window.clearInterval(handle);
  }, [connected, loadChats]);
  useEffect(() => {
    if (!connected || !active) return;
    void loadMessages();
    const handle = window.setInterval(() => void loadMessages(), 4500);
    return () => window.clearInterval(handle);
  }, [connected, loadMessages, active?.id]);
  useEffect(() => {
    if (!connected) { setIndexedChats([]); setLists([]); return; }
    void loadIndex();
    void loadLists();
    const handle = window.setInterval(() => {
      void loadIndex();
      void loadLists();
    }, 60000);
    return () => window.clearInterval(handle);
  }, [connected, loadIndex, loadLists]);
  const selectedLabelId = view === "favorites" ?
    lists.find(item => item.type === 3 && item.isActive !== false)?.id :
    view.startsWith("label:") ? view.slice(6) : undefined;
  useEffect(() => {
    if (!connected || !selectedLabelId) return;
    void loadLabelChats(selectedLabelId);
    const handle = window.setInterval(() => void loadLabelChats(selectedLabelId), 60000);
    return () => window.clearInterval(handle);
  }, [connected, selectedLabelId, loadLabelChats]);
  useEffect(() => { if (connected) void loadNames(); }, [connected, loadNames]);
  useEffect(() => {
    if (!user) return;
    const db = createClient();
    void db.from("waha_lab_inboxes").select("id,display_name")
      .eq("owner_user_id", user.id).maybeSingle()
      .then(({ data }) => {
        setInbox(data as Inbox | null);
        if (data) setNameDraft(data.display_name);
      });
    void db.from("waha_lab_chat_settings")
      .select("chat_id,alias,stage_id").eq("owner_user_id", user.id)
      .limit(5000).then(({ data }) => {
        const map: Record<string, Setting> = {};
        for (const item of data || []) map[item.chat_id] = item as Setting;
        setSettings(map);
      });
  }, [user]);
  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    void db.from("pipelines").select("id").eq("account_id", accountId)
      .then(async ({ data }) => {
        const ids = (data || []).map(p => p.id);
        if (!ids.length) return;
        const response = await db.from("pipeline_stages").select("id,name,color,position")
          .in("pipeline_id", ids).order("position");
        if (!response.error) setStages(response.data as Stage[] || []);
      });
  }, [accountId]);

  const byId = useMemo(() => {
    const map = new Map<string, WaContact>();
    for (const c of contacts) map.set(c.id, c);
    return map;
  }, [contacts]);
  const pnByLid = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of lids) if (m.pn) map.set(m.lid, m.pn);
    return map;
  }, [lids]);
  const contactOf = (chat: WaChat) =>
    byId.get(chat.id) || byId.get(pnByLid.get(chat.id) || "") || null;
  const phoneOf = (chat: WaChat): string => {
    const c = contactOf(chat);
    if (c?.number && /^[0-9]{7,20}$/.test(c.number)) return "+" + c.number;
    return jidPhone(pnByLid.get(chat.id) || chat.id);
  };
  const displayName = (chat: WaChat): string => {
    const c = contactOf(chat);
    const saved = settings[chat.id]?.alias?.trim();
    return saved || (c?.isMyContact ? c.name : "") ||
      (c?.name && !/^\d+$/.test(c.name) ? c.name : "") ||
      (chat.name && !/^\d+$/.test(chat.name) ? chat.name : "") ||
      c?.pushname || phoneOf(chat) || "Contacto sin nombre";
  };
  const stageOf = (chat: WaChat): Stage | undefined =>
    stages.find(s => s.id === settings[chat.id]?.stage_id) ||
    stages.find(s => s.name.toLocaleLowerCase("es-AR") === "nuevo contacto");
  const allChats = useMemo(() => {
    const map = new Map<string, WaChat>();
    for (const row of indexedChats) map.set(row.id, row);
    for (const row of chats) {
      const stored = map.get(row.id);
      map.set(row.id, {
        ...stored, ...row,
        archived: typeof stored?.archived === "boolean" ? stored.archived :
          typeof row.archived === "boolean" ? row.archived :
          row._chat?.archived
      });
    }
    if (selectedLabelId) {
      for (const row of labelChats[selectedLabelId] || []) {
        const stored = map.get(row.id);
        map.set(row.id, { ...row, ...stored,
          lastMessage: stored?.lastMessage || row.lastMessage,
          archived: stored?.archived ?? row.archived
        });
      }
    }
    return [...map.values()].sort((a,b) =>
      (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
  }, [chats, indexedChats, labelChats, selectedLabelId]);

  const archivedCount = allChats.filter(archivedFlag).length;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-AR");
    const memberIds = selectedLabelId
      ? new Set((labelChats[selectedLabelId] || []).map(c => c.id)) : null;
    return allChats.filter(chat => {
      const archived = archivedFlag(chat);
      if (view === "archived" ? !archived : archived) return false;
      if (view === "unread" && (chat.unreadCount || chat._chat?.unreadCount || 0) <= 0) return false;
      if (view === "groups" && !chat.id.endsWith("@g.us")) return false;
      if (view === "favorites" && !selectedLabelId && !chat.isFavorite && !chat._chat?.isFavorite) return false;
      if ((view === "favorites" || view.startsWith("label:")) && memberIds &&
          !memberIds.has(chat.id)) return false;
      if (view.startsWith("label:") && !memberIds) return false;
      return !term || (displayName(chat) + " " + phoneOf(chat) + " " +
        chat.id).toLocaleLowerCase("es-AR").includes(term);
    });
  }, [allChats, view, query, contacts, lids, settings, selectedLabelId, labelChats]);
  async function requestPairingCode() {
    if (busy || connected) return;
    const phone = pairPhone.replace(/[^0-9]/g, "");
    if (!/^[0-9]{8,16}$/.test(phone)) {
      setPairingError("Ingresá tu número completo con código de país, sin el signo +.");
      return;
    }
    setBusy(true);
    setPairingError("");
    setPairingCode("");
    try {
      const result = await action("request-code", { phoneNumber: phone });
      if (typeof result.code !== "string" || !/^[a-zA-Z0-9-]{4,16}$/.test(result.code))
        throw new Error("WAHA no devolvió un código de vinculación válido.");
      setPairingCode(result.code);
      toast.success("Código generado. Ingresalo en WhatsApp desde tu celular.");
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : "No se pudo solicitar el código.");
    } finally { setBusy(false); }
  }

  async function command(op: "connect"|"restart"|"stop"|"logout") {
    if (busy) return;
    if (op === "logout" && !window.confirm(
      "¿Desvincular este WhatsApp de WAHA? No se borran los chats de la app del celular."
    )) return;
    setBusy(true);
    try {
      const result = await action(op);
      setStatus(result);
      setError("");
      setQrEpoch(Date.now());
      setQrError("");
      setPairingError("");
      setPairingCode("");
      if (op === "connect" || op === "restart") setShowSettings(true);
      if (op === "connect" && user) {
        const { data } = await createClient().from("waha_lab_inboxes")
          .select("id,display_name").eq("owner_user_id", user.id).maybeSingle();
        if (data) setInbox(data);
      }
      await getStatus();
    } catch (e) { toast.error(e instanceof Error ? e.message : "WAHA no responde"); }
    finally { setBusy(false); }
  }
  async function saveSetting(chatId: string, updates: Partial<Setting>) {
    if (!user) return;
    const previous = settings[chatId] || { chat_id: chatId, alias: null, stage_id: null };
    const merged: Setting = { ...previous, ...updates };
    const { error } = await createClient().from("waha_lab_chat_settings")
      .upsert({ owner_user_id: user.id, ...merged }, { onConflict: "owner_user_id,chat_id" });
    if (error) { toast.error("No se pudo guardar la etiqueta o el nombre"); return; }
    setSettings(current => ({...current, [chatId]: merged}));
    setAliasEdit(false);
  }
  async function saveName() {
    if (!inbox || !nameDraft.trim()) return;
    const name = nameDraft.trim().slice(0,60);
    const { error } = await createClient().from("waha_lab_inboxes")
      .update({ display_name: name }).eq("id", inbox.id);
    if (error) { toast.error("No se pudo renombrar la bandeja"); return; }
    setInbox({ ...inbox, display_name: name }); setRename(false);
  }
  async function toggleArchive(chat: WaChat) {
    if (!connected || archivingId) return;
    const archive = !archivedFlag(chat);
    setArchivingId(chat.id);
    try {
      await action(archive ? "archive" : "unarchive", { chatId: chat.id });
      const update = (row: WaChat) => row.id === chat.id
        ? { ...row, archived: archive, isArchived: archive,
            _chat: { ...row._chat, archived: archive } } : row;
      setIndexedChats(rows => rows.map(update));
      setChats(rows => rows.map(update));
      setActive(previous => previous?.id === chat.id ? update(previous) : previous);
      toast.success(archive ? "Chat movido a Archivados" : "Chat devuelto a conversaciones");
      void loadIndex();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar Archivados");
    } finally { setArchivingId(null); }
  }

  async function sendMessage() {
    if (!active || !connected || busy || !draft.trim()) return;
    setBusy(true);
    try {
      await action("send", { chatId: active.id, text: draft.trim() });
      setDraft("");
      await loadMessages();
      await loadChats();
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se envió el mensaje"); }
    finally { setBusy(false); }
  }
  const chooseView = (next: string) => {
    setView(next);
    setLimit(80);
  };
  const customLists = lists.filter(label =>
    label.isActive !== false && label.type !== 1 && label.type !== 2 &&
    label.type !== 3 && label.id && label.name);
  const isMobileChat = !!active;
  if (loading || accountStatus === "loading")
    return <div className="p-4 text-sm text-muted-foreground">Abriendo prueba WAHA...</div>;
  if (!user) return <div className="p-4 text-sm">Iniciá sesión para continuar.</div>;

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-h-[320px] flex-col overflow-hidden bg-background sm:-m-6">
      <div className={(isMobileChat ? "hidden sm:flex " : "flex ") +
        "shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5"}>
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="size-5 shrink-0 text-primary"/>
          <div className="min-w-0">
            {rename ? <div className="flex items-center gap-1">
              <input value={nameDraft} maxLength={60} onChange={e=>setNameDraft(e.target.value)}
                className="h-8 min-w-0 rounded-lg border border-border bg-background px-2 text-sm"/>
              <button type="button" aria-label="Guardar nombre" onClick={()=>void saveName()}
                className="rounded-lg bg-primary p-2 text-primary-foreground"><Check className="size-4"/></button>
            </div> : <button type="button" onClick={()=>setRename(true)} disabled={!inbox}
              className="flex items-center gap-1 text-sm font-semibold">
              <span className="truncate">{inbox?.display_name || "WAHA · Pruebas"}</span>
              {inbox && <Edit3 className="size-3.5 text-muted-foreground"/>}
            </button>}
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {connected ? <Wifi className="size-3 text-emerald-500"/> :
                <WifiOff className="size-3"/>}
              {connected ? "Conectado" : (status.status || "Sin conexión")} · WEBJS ·
              <LockKeyhole className="size-3"/> Solo yo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title="Actualizar" onClick={()=>{void getStatus();void loadChats();void loadMessages();void loadIndex();void loadLists();if(selectedLabelId)void loadLabelChats(selectedLabelId);}}
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground">
            <RefreshCw className="size-4"/></button>
          <button type="button" title="Administrar conexión WAHA"
            onClick={()=>setShowSettings(x=>!x)}
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground">
            <Settings2 className="size-4"/></button>
        </div>
      </div>
      {(showSettings || !connected) && !isMobileChat && (
        <div className="shrink-0 border-b border-border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">Conexión WAHA · Laboratorio</p>
            {connected && <button type="button" onClick={()=>setShowSettings(false)}
              aria-label="Cerrar panel"><X className="size-4"/></button>}
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          {!connected && (
            <div className="mt-3 space-y-3">
              <div className="flex w-full gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Método de vinculación">
                <button type="button" role="tab" aria-selected={pairingMethod === "qr"}
                  onClick={() => setPairingMethod("qr")}
                  className={"flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors " +
                    (pairingMethod === "qr" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                  Vincular con QR
                </button>
                <button type="button" role="tab" aria-selected={pairingMethod === "code"}
                  onClick={() => setPairingMethod("code")}
                  className={"flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors " +
                    (pairingMethod === "code" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                  Vincular con código
                </button>
              </div>
              {pairingMethod === "qr" ? (
                <div className="flex flex-col items-center gap-2">
                  {qrReady ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img key={qrEpoch}
                        src={"/api/waha-lab/qr?v=" + qrEpoch}
                        alt="Código QR para vincular WhatsApp con WAHA"
                        onLoad={() => setQrError("")}
                        onError={() => setQrError("No se pudo obtener la imagen QR del servidor. Probá Reiniciar o Vincular con código.")}
                        className="size-48 rounded-xl border border-border bg-white p-2" />
                      <p className="text-center text-[11px] text-muted-foreground">
                        Abrí WhatsApp en el celular → Dispositivos vinculados → Vincular dispositivo
                      </p>
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin"/>
                      {status.status === "STARTING" ? "WAHA está iniciando el navegador..." :
                        status.status === "FAILED" ? "La sesión falló. Tocá Reiniciar para generar otro QR." :
                        status.status === "STOPPED" ? "La sesión está detenida. Tocá Vincular WAHA." :
                        "Iniciá WAHA para generar el QR."}
                    </p>
                  )}
                  {qrError && <p role="alert" className="text-center text-xs text-red-500">{qrError}</p>}
                  {qrReady && <button type="button" onClick={() => setQrEpoch(Date.now())}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium">
                    <RefreshCw className="size-3.5"/> Actualizar QR
                  </button>}
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-border bg-background/50 p-3">
                  <label className="block text-xs font-semibold" htmlFor="waha-pair-phone">
                    Número de WhatsApp con código de país
                  </label>
                  <input id="waha-pair-phone" type="tel" inputMode="tel" autoComplete="tel"
                    value={pairPhone} onChange={e => setPairPhone(e.target.value)}
                    placeholder="Ej. 5492984123456"
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" />
                  <p className="text-[11px] text-muted-foreground">
                    Para Argentina: 54 + 9 + código de área + número, sin espacios ni signo +.
                  </p>
                  <button type="button" onClick={() => void requestPairingCode()}
                    disabled={busy || (status.status !== "SCAN_QR_CODE" &&
                      status.status !== "SCAN_QR" && status.status !== "STARTING")}
                    className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                    {busy && <LoaderCircle className="size-4 animate-spin" />}
                    Generar código de vinculación
                  </button>
                  {pairingError && <p role="alert" className="text-xs text-red-500">{pairingError}</p>}
                  {pairingCode && (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">Tu código de vinculación</p>
                      <p className="select-all text-2xl font-bold tracking-[0.15em] text-foreground">{pairingCode}</p>
                      <button type="button" onClick={() => void navigator.clipboard.writeText(pairingCode).then(() => toast.success("Código copiado"))}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs">
                        <Copy className="size-3.5"/> Copiar código
                      </button>
                      <p className="text-center text-xs text-muted-foreground">
                        En WhatsApp → Dispositivos vinculados → Vincular dispositivo →
                        Vincular con número de teléfono, ingresá este código en tu celular.
                      </p>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    La vinculación por código puede no estar disponible temporalmente. En ese caso usá el QR.
                  </p>
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {connected ? "Sesión conectada. WAHA consulta mensajes y contactos." :
              qrReady ? "WAHA está esperando la vinculación." :
              status.status === "STARTING" ? "WAHA está preparando la sesión." :
              "Esta bandeja es independiente de Baileys y del CRM comercial."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!connected && <button type="button" disabled={busy}
              onClick={()=>void command("connect")}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              <Smartphone className="size-4"/> Vincular WAHA
            </button>}
            {status.status !== "NOT_CREATED" && <button type="button" disabled={busy}
              onClick={()=>void command("restart")}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs disabled:opacity-50">
              <RefreshCw className="size-3.5"/> Reiniciar
            </button>}
            {connected && <button type="button" disabled={busy} onClick={()=>void loadNames()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs disabled:opacity-50">
              {namesLoading ? <LoaderCircle className="size-3.5 animate-spin"/> :
                <RefreshCw className="size-3.5"/>} Actualizar contactos
            </button>}
            {status.status !== "NOT_CREATED" && <button type="button" disabled={busy}
              onClick={()=>void command("logout")}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs disabled:opacity-50">
              <Unplug className="size-3.5"/> Desvincular
            </button>}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            WAHA utiliza WhatsApp Web de forma no oficial. Los nombres y teléfonos dependen de los
            datos que WhatsApp sincronice y los IDs privados pueden no tener teléfono disponible.
          </p>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className={(isMobileChat ? "hidden sm:flex " : "flex ") +
          "min-h-0 w-full shrink-0 flex-col border-r border-border bg-card sm:w-[325px] lg:w-[360px]"}>
          <div className="shrink-0 space-y-2.5 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                {view === "archived" ? "Archivados" : "Conversaciones"}
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {filtered.length.toLocaleString("es-AR")}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2">
              <Search className="size-4 shrink-0 text-muted-foreground"/>
              <input value={query} onChange={e=>setQuery(e.target.value)}
                placeholder={view === "archived" ? "Buscar en Archivados..." : "Buscar contactos..."}
                type="search" aria-label="Buscar chats en la lista seleccionada"
                className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"/>
            </div>
            {view === "archived" ? (
              <button type="button" onClick={() => chooseView("all")}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-primary hover:bg-primary/10">
                <ArrowLeft className="size-4"/> Volver a conversaciones
              </button>
            ) : (
              <button type="button" onClick={() => chooseView("archived")}
                className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5 text-left text-xs font-semibold text-foreground hover:bg-muted/70">
                <Archive className="size-4 text-primary"/>
                <span className="flex-1">Archivados</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {archivedCount.toLocaleString("es-AR")}
                </span>
                <ChevronDown className="-rotate-90 size-4 text-muted-foreground"/>
              </button>
            )}
            <div className="private-wa-scroll flex items-center gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Listas de WhatsApp">
              {[
                { id:"all", name:"Todos" },
                { id:"unread", name:"No leídos" },
                { id:"favorites", name:"Favoritos" },
                { id:"groups", name:"Grupos" },
                ...customLists.map(label => ({ id:"label:"+label.id, name:label.name }))
              ].map(item => (
                <button key={item.id} type="button" onClick={() => chooseView(item.id)}
                  aria-pressed={view === item.id}
                  className={"shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors " +
                    (view === item.id ? "border-primary bg-primary/10 text-primary" :
                      "border-border bg-card text-muted-foreground hover:bg-muted")}>
                  {item.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {listsLoading && <LoaderCircle className="size-3 animate-spin"/>}
                {listsLoading
                  ? "Sincronizando: " + indexedCount.toLocaleString("es-AR") + " chats · lotes de " + indexPageSize
                  : indexComplete
                    ? "Chats recuperados: " + allChats.length.toLocaleString("es-AR")
                    : "Chats recuperados hasta ahora: " + allChats.length.toLocaleString("es-AR")}
              </span>
              <button type="button" disabled={listsLoading || !connected}
                onClick={() => void loadIndex()}
                className="flex items-center gap-1 font-semibold text-primary disabled:opacity-40">
                <RefreshCw className="size-3"/> Sincronizar todo
              </button>
            </div>
            {!!lastIndexAt && !listsLoading && (
              <p className="text-[10px] text-muted-foreground">
                Última revisión completa: {new Date(lastIndexAt).toLocaleString("es-AR")}
              </p>
            )}
            {!!indexError && (
              <button type="button" onClick={() => void loadIndex()}
                className="flex items-center gap-1 text-left text-[11px] text-amber-600 dark:text-amber-400">
                <RefreshCw className="size-3"/> Chats: {indexError} · Reintentar
              </button>
            )}
            {!!listsError && (
              <button type="button" onClick={() => void loadLists()}
                className="flex items-center gap-1 text-left text-[11px] text-amber-600 dark:text-amber-400">
                <RefreshCw className="size-3"/> Listas: {listsError} · Reintentar
              </button>
            )}
          </div>
          <div className="private-wa-scroll min-h-0 flex-1 overflow-y-auto">
            {filtered.slice(0, limit).map(chat => {
              const title = displayName(chat);
              const phone = phoneOf(chat);
              const stage = stageOf(chat);
              return <button type="button" key={chat.id}
                onClick={()=>{setActive(chat);setMessages([]);setMessageLimit(80);setAliasEdit(false);}}
                className={"block w-full border-b border-border/60 px-3 py-3 text-left hover:bg-muted/50 " +
                  (active?.id===chat.id ? "bg-primary/10":"")}>
                <div className="flex items-start gap-2.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initials(title)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold">{title}</p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {ts(chat.lastMessage?.timestamp)}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {phone || "Teléfono no informado"}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {chat.lastMessage?.body || "Sin vista previa"}
                      </span>
                      {stage && <span className="max-w-28 shrink-0 truncate rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ borderColor: (stage.color||"#64748b")+"66",
                          backgroundColor:(stage.color||"#64748b")+"18" }}>
                        {stage.name}
                      </span>}
                    </div>
                  </div>
                </div>
              </button>;
            })}
            {connected && filtered.length > limit &&
              <button type="button" onClick={()=>setLimit(x=>x+80)}
                className="flex w-full items-center justify-center gap-1 p-3 text-xs font-semibold text-primary hover:bg-primary/10">
                <ChevronDown className="size-4"/> Cargar más ({filtered.length-limit})
              </button>}
            {!filtered.length && <p className="p-5 text-center text-xs text-muted-foreground">
              {!connected ? "Conectá WAHA para ver tus conversaciones." :
                listsLoading ? "Sincronizando listas de WhatsApp..." :
                view === "archived" ? "No hay conversaciones archivadas en esta lista." :
                view === "favorites" ? "No se encontraron chats favoritos sincronizados." :
                view.startsWith("label:") ? "No hay chats en esta lista o WhatsApp no los sincronizó." :
                query ? "No hay coincidencias en este filtro." :
                "Todavía no hay conversaciones en este filtro."}
            </p>}
          </div>
        </aside>
        <section className={(isMobileChat ? "flex " : "hidden sm:flex ") +
          "min-h-0 min-w-0 flex-1 flex-col bg-background"}>
          {!active ? <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <MessageCircle className="size-9 opacity-40"/> Seleccioná un chat de WAHA
          </div> : <>
            <div className="shrink-0 border-b border-border bg-card px-3 py-2">
              <div className="flex items-center gap-2">
                <button type="button" title="Volver" aria-label="Volver"
                  onClick={()=>setActive(null)} className="grid size-9 place-items-center sm:hidden">
                  <ArrowLeft className="size-5"/>
                </button>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {initials(displayName(active))}
                </span>
                <div className="min-w-0 flex-1">
                  {aliasEdit ? <div className="flex items-center gap-1">
                    <input value={aliasDraft} onChange={e=>setAliasDraft(e.target.value)}
                      maxLength={120} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"/>
                    <button type="button" title="Guardar nombre" onClick={()=>void saveSetting(active.id,{alias:aliasDraft.trim()||null})}
                      className="rounded-lg bg-primary p-2 text-primary-foreground"><Check className="size-3.5"/></button>
                  </div> : <button type="button" title="Cambiar nombre local"
                    onClick={()=>{setAliasEdit(true);setAliasDraft(settings[active.id]?.alias||"");}}
                    className="flex max-w-full items-center gap-1 text-left text-sm font-semibold">
                    <span className="truncate">{displayName(active)}</span>
                    <Edit3 className="size-3.5 shrink-0 text-muted-foreground"/>
                  </button>}
                  <p className="truncate text-[11px] text-muted-foreground">
                    {phoneOf(active) || "WAHA no proporciona el teléfono para este ID"}
                  </p>
                </div>
                {phoneOf(active) && <button type="button" title="Copiar teléfono"
                  onClick={()=>void navigator.clipboard.writeText(phoneOf(active)).then(()=>toast.success("Número copiado"))}
                  className="grid size-9 place-items-center rounded-lg border border-border">
                  <Copy className="size-4"/>
                </button>}
                {connected && <button type="button"
                  disabled={!!archivingId} onClick={()=>void toggleArchive(active)}
                  title={archivedFlag(active) ? "Sacar de Archivados" : "Archivar conversación"}
                  aria-label={archivedFlag(active) ? "Desarchivar conversación" : "Archivar conversación"}
                  className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-50">
                  {archivingId === active.id ? <LoaderCircle className="size-4 animate-spin"/> :
                    archivedFlag(active) ? <ArchiveRestore className="size-4"/> :
                    <Archive className="size-4"/>}
                </button>}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <GitBranch className="size-3.5"/>
                  <select aria-label="Etapa de venta WAHA"
                    value={settings[active.id]?.stage_id || stageOf(active)?.id || ""}
                    onChange={e=>void saveSetting(active.id,{stage_id:e.target.value||null})}
                    className="h-8 max-w-40 rounded-lg border border-input bg-background px-2 text-xs font-semibold">
                    {!stages.length && <option value="">Sin etapas</option>}
                    {stages.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <span className="text-[11px] text-muted-foreground">
                  Último: {ts(active.lastMessage?.timestamp)}
                </span>
              </div>
            </div>
            <div className="private-wa-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
              {messages.length >= messageLimit &&
                <button type="button" onClick={()=>setMessageLimit(x=>x+80)}
                  className="mx-auto mb-3 rounded-full border border-border px-3 py-1.5 text-xs text-primary">
                  Ver anteriores
                </button>}
              <div className="mt-auto space-y-2">
                {messages.map(message =>
                  <div className={"flex "+(message.fromMe?"justify-end":"justify-start")}
                    key={message.id}>
                    <div className={"max-w-[86%] rounded-2xl px-3 py-2 text-[13px] sm:max-w-[70%] "+
                      (message.fromMe?"rounded-br-sm bg-primary text-primary-foreground":
                        "rounded-bl-sm border border-border bg-card text-foreground")}>
                      <p className="whitespace-pre-wrap break-words">
                        {message.body || (message.hasMedia ? "Archivo multimedia" : "Mensaje no textual")}
                      </p>
                      <p className="mt-1 text-right text-[10px] opacity-70">{ts(message.timestamp)}</p>
                    </div>
                  </div>)}
              </div>
            </div>
            <form onSubmit={e=>{e.preventDefault();void sendMessage();}}
              className="flex shrink-0 items-end gap-2 border-t border-border bg-card p-2.5">
              <textarea rows={1} maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)}
                disabled={!connected}
                placeholder={connected?"Escribí desde WAHA...":"Conectá WAHA para responder"}
                className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"/>
              <button type="submit" title="Enviar" disabled={!connected||busy||!draft.trim()}
                className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40">
                <Send className="size-4"/></button>
            </form>
          </>}
        </section>
      </div>
    </div>
  );
}
