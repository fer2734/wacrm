"use client";
import {useContactAliases} from "@/hooks/use-contact-aliases";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { applyInboxFilter, type InboxFilter } from "@/lib/inbox/inbox-filters";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, Archive, ArchiveRestore } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  initialFilter?: InboxFilter;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};


interface SalesStageLabel {
  name: string;
  color: string;
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  initialFilter = "all",
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const {aliases}=useContactAliases();
  const {user, accountId} = useAuth();
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [showArchives, setShowArchives] = useState(false);
  const [menuConversation, setMenuConversation] = useState<Conversation | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  useEffect(() => {
    if (!user?.id || !accountId) return;
    let cancelled = false;
    setArchivesLoaded(false);
    void createClient().from("conversation_archives").select("conversation_id")
      .eq("user_id", user.id).eq("account_id",accountId).then(({data,error}) => {
        if(cancelled) return;
        if(error) toast.error("No se pudieron cargar los chats archivados");
        else setArchivedIds(new Set((data ?? []).map(row => row.conversation_id)));
        setArchivesLoaded(true);
      });
    return () => { cancelled = true; };
  }, [user?.id, accountId]);

  const changeArchived = useCallback(async (conv: Conversation, archive: boolean) => {
    if (!user?.id || !accountId || archiveBusy) return;
    setArchiveBusy(true);
    const supabase = createClient();
    const result = archive
      ? await supabase.from("conversation_archives").insert({ account_id:accountId, user_id:user.id, conversation_id:conv.id })
      : await supabase.from("conversation_archives").delete().eq("user_id",user.id).eq("conversation_id",conv.id);
    setArchiveBusy(false);
    if(result.error && !(archive && result.error.code === "23505")){ console.error("[conversation-archives]", result.error.code, result.error.message); toast.error(archive ? "No se pudo archivar" : "No se pudo desarchivar");return; }
    setArchivedIds(prev => {const next=new Set(prev);if(archive) next.add(conv.id);else next.delete(conv.id);return next;});
    setMenuConversation(null);
    toast.success(archive ? "Chat archivado" : "Chat recuperado");
  }, [user?.id,accountId,archiveBusy]);

  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterWaiting"), value: "waiting" },
    { label: t("filterUnassigned"), value: "unassigned" },
    { label: t("filterExpiring"), value: "expiring" },
  ], [t]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [loading, setLoading] = useState(true);

  // Sales stages are persisted on the opportunity (deals.stage_id), not
  // on a device. Fetch them in bulk so every visible chat has one label.
  const [salesStages, setSalesStages] = useState<Record<string, SalesStageLabel>>({});
  const conversationIdsKey = useMemo(
    () => conversations.map((conversation) => conversation.id).sort().join(","),
    [conversations]
  );

  useEffect(() => {
    if (!conversationIdsKey) return;
    const supabase = createClient();
    const conversationIds = conversationIdsKey.split(",");
    let cancelled = false;

    const refreshSalesStages = async () => {
      const [dealsResult, stagesResult] = await Promise.all([
        supabase
          .from("deals")
          .select("conversation_id,stage_id,created_at")
          .in("conversation_id", conversationIds)
          .order("created_at"),
        supabase.from("pipeline_stages").select("id,name,color"),
      ]);
      if (cancelled) return;
      if (dealsResult.error || stagesResult.error) {
        console.error("Failed to load conversation sales stages:", {
          deals: dealsResult.error?.message,
          stages: stagesResult.error?.message,
        });
        return;
      }
      const stagesById = new Map<string, SalesStageLabel>(
        (stagesResult.data ?? []).map((item) => [
          item.id,
          { name: item.name, color: item.color },
        ])
      );
      const next: Record<string, SalesStageLabel> = {};
      for (const deal of dealsResult.data ?? []) {
        if (!deal.conversation_id || next[deal.conversation_id]) continue;
        const selectedStage = stagesById.get(deal.stage_id);
        if (selectedStage) next[deal.conversation_id] = selectedStage;
      }
      setSalesStages(next);
    };

    const refresh = () => { void refreshSalesStages(); };
    refresh();
    // The active conversation stage dispatches this event after a save.
    window.addEventListener("wacrm:sales-stage-changed", refresh);
    const channel = supabase
      .channel(`inbox-sales-stages-${conversationIdsKey.slice(0, 20)}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "deals",
      }, refresh)
      .subscribe();
    // Also reconcile when the browser misses a realtime event.
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("wacrm:sales-stage-changed", refresh);
      void supabase.removeChannel(channel);
    };
  }, [conversationIdsKey]);

  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = applyInboxFilter(conversations, filter, now);

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = ((c.contact?.id && aliases[c.contact.id]) || c.contact?.name || "").toLowerCase();
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result.filter(conv => showArchives ? archivedIds.has(conv.id) : !archivedIds.has(conv.id));
  }, [conversations, filter, now, search, selectedTagIds, selectedCompany, aliases, archivedIds, showArchives]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setShowArchives(x => !x)}
            aria-pressed={showArchives}
            className={cn("inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold",showArchives ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted")}>
            {showArchives ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            {showArchives ? "Volver a chats" : "Archivados"}
            {!showArchives && archivedIds.size > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px]">{archivedIds.size}</span>}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading || !archivesLoaded ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{showArchives ? "No hay chats archivados" : t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                salesStage={salesStages[conv.id]}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                onLongPress={setMenuConversation}
                isArchived={archivedIds.has(conv.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <Dialog open={!!menuConversation} onOpenChange={open => {if(!open) setMenuConversation(null);}}>
        <DialogContent className="max-w-xs p-4">
          <DialogHeader><DialogTitle>Opciones del chat</DialogTitle></DialogHeader>
          <p className="truncate text-sm font-medium text-foreground">{menuConversation?.contact?.name || menuConversation?.contact?.phone || "Cliente"}</p>
          <button type="button" disabled={archiveBusy}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            onClick={() => {if(menuConversation) void changeArchived(menuConversation,!archivedIds.has(menuConversation.id));}}>
            {menuConversation && archivedIds.has(menuConversation.id) ? <ArchiveRestore className="size-5 text-primary"/> : <Archive className="size-5 text-primary"/>}
            {menuConversation && archivedIds.has(menuConversation.id) ? "Desarchivar conversación" : "Archivar conversación"}
          </button>
          <p className="text-xs text-muted-foreground">Los mensajes no se eliminan; solo se oculta este chat de tu lista.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  salesStage?: SalesStageLabel;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onLongPress: (conversation: Conversation) => void;
  isArchived: boolean;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  salesStage,
  isActive,
  onSelect,
  onLongPress,
  isArchived,
  t,
}: ConversationItemProps) {
  const {aliases}=useContactAliases();
  const contact = conversation.contact;
  const displayName = (contact?.id && aliases[contact.id]) || contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedRef = useRef(false);
  const clearPress = useCallback(() => {if(timerRef.current) clearTimeout(timerRef.current);timerRef.current=null;},[]);
  useEffect(() => () => clearPress(),[clearPress]);
  const startPress = useCallback(() => {
    clearPress();
    consumedRef.current=false;
    timerRef.current=setTimeout(() => {consumedRef.current=true;onLongPress(conversation);},550);
  },[clearPress,onLongPress,conversation]);
  const handleClick = useCallback(() => {
    if(consumedRef.current){consumedRef.current=false;return;}
    onSelect(conversation);
  }, [onSelect, conversation]);

  const validLastMessageDate = !!conversation.last_message_at &&
    !Number.isNaN(Date.parse(conversation.last_message_at));
  const timeAgo = validLastMessageDate
    ? formatDistanceToNow(new Date(conversation.last_message_at!), {
        addSuffix: true,
        locale: es,
      })
    : "";
  const lastMessageDate = validLastMessageDate
    ? format(new Date(conversation.last_message_at!), "dd/MM/yy HH:mm", { locale: es })
    : null;

  return (
    <button
      onClick={handleClick}
      onPointerDown={e => {if(e.pointerType === "touch" || e.pointerType === "pen") startPress();}}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onContextMenu={e => {e.preventDefault();clearPress();consumedRef.current=true;onLongPress(conversation);}}
      aria-label={`Chat de ${displayName}; mantené presionado para ${isArchived ? "desarchivar" : "archivar"}`}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          Último mensaje: {lastMessageDate ?? "Sin mensajes"}
        </p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground" title={salesStage?.name ?? "Sin estado de venta"}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: salesStage?.color ?? "var(--muted-foreground)" }} />
            <span className="truncate">{salesStage?.name ?? "Sin estado de venta"}</span>
          </span>
        </div>
        {!conversation.assigned_agent_id && conversation.status !== 'closed' && <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">{t('filterUnassigned')}</p>}
      </div>
    </button>
  );
}
