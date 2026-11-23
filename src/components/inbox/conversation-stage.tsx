"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PipelineStage } from "@/types";

export function ConversationStage({ conversationId }: { conversationId: string }) {
  const t = useTranslations("SalesFunnel");
  const supabase = createClient();
  const [stages, setStages] = useState<(PipelineStage & { pipeline: { name: string } })[]>([]);
  const [stageId, setStageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [stageResult, dealResult] = await Promise.all([
      supabase.from("pipeline_stages").select("*, pipeline:pipelines!inner(name)").order("position"),
      supabase.from("deals").select("stage_id,pipeline_id").eq("conversation_id", conversationId).order("created_at").limit(1),
    ]);
    return { stageResult, dealResult };
  }, [supabase, conversationId]);

  useEffect(() => {
    let cancelled = false;
    void load().then(({ stageResult, dealResult }) => {
      if (cancelled) return;
      setStages((stageResult.data ?? []).filter(stage => stage.pipeline_id === dealResult.data?.[0]?.pipeline_id));
      setStageId(dealResult.data?.[0]?.stage_id ?? "");
      setFailed(!!stageResult.error || !!dealResult.error);
      setLoading(false);
    });
    const channel = supabase.channel(`chat-stage-${conversationId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "deals", filter: `conversation_id=eq.${conversationId}`,
    }, () => { void load().then(({ dealResult }) => {
      if (!cancelled && !dealResult.error) setStageId(dealResult.data?.[0]?.stage_id ?? "");
    }); }).subscribe();
    return () => { cancelled = true; void supabase.removeChannel(channel); };
  }, [load, supabase, conversationId]);

  async function changeStage(next: string) {
    if (!next || saving) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_conversation_stage", {
      p_conversation_id: conversationId, p_stage_id: next,
    });
    setSaving(false);
    if (error) { toast.error(t("saveFailed")); return; }
    setStageId(next);
    window.dispatchEvent(new Event("wacrm:sales-stage-changed"));
    toast.success(t("saved"));
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1.5 sm:flex-wrap sm:justify-center sm:px-3 sm:py-2.5">
      <label htmlFor={`sales-stage-${conversationId}`} className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-foreground sm:gap-2 sm:text-sm">
        <GitBranch className="size-3.5 text-primary sm:size-4" /><span className="sm:hidden">Etapa</span><span className="hidden sm:inline">{t("stage")}</span>
      </label>
      {(loading || saving) && <Loader2 className="size-4 animate-spin" aria-label={t("saving")} />}
      <select
        id={`sales-stage-${conversationId}`}
        value={stageId}
        disabled={loading || saving || failed || stages.length === 0}
        onChange={(event) => void changeStage(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:h-9 sm:w-64 sm:flex-none sm:px-3 sm:text-sm"
      >
        {!stageId && <option value="" disabled>{loading ? t("loading") : t("chooseStage")}</option>}
        {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
      </select>
      {failed && <p role="alert" className="w-full text-center text-xs">{t("loadFailed")}</p>}
    </div>
  );
}
