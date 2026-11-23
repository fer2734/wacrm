"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type SummaryFields = Record<string, unknown>;
const labels: Array<[string, string]> = [
  ["nombre", "Nombre"],
  ["localidad", "Localidad"],
  ["tipo_vehiculo", "Vehículo"],
  ["vehiculo", "Vehículo solicitado"],
  ["marca", "Marca"],
  ["modelo", "Modelo"],
  ["anios", "Años aproximados"],
  ["year", "Años aproximados"],
  ["cilindrada", "Cilindrada"],
  ["tiene_capital", "Tiene entrega"],
  ["capital", "Capital disponible"],
  ["tipo_operacion", "Operación"],
  ["operacion", "Operación"],
  ["cuota", "Cuota mensual"],
  ["usado", "Usado para entregar"],
  ["initial_message", "Mensaje inicial"],
];

export function BotIntakeSummary({ conversationId }: { conversationId: string }) {
  const [vars, setVars] = useState<SummaryFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(false);
      const { data, error: fetchError } = await createClient()
        .rpc("get_conversation_intake_summary", { p_conversation_id: conversationId });
      if (!active) return;
      setError(!!fetchError);
      setVars(data && typeof data === "object" && !Array.isArray(data) ? data as SummaryFields : {});
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [conversationId]);

  const rows = labels
    .filter(([key]) => typeof vars?.[key] === "string" && String(vars[key]).trim().length > 0)
    .map(([key, label]) => ({ key, label, value: String(vars?.[key]).slice(0, 600) }));

  return (
    <section aria-label="Resumen del filtro del bot" className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <ClipboardList className="size-4 text-primary" /> Resumen inicial del cliente
      </h3>
      {loading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando filtro...</p>
        : error ? <p className="text-xs text-destructive">No se pudo consultar el resumen del bot.</p>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">Este chat todavía no tiene un filtro inicial registrado.</p>
        : <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-border bg-background p-3 text-sm sm:grid-cols-2">
            {rows.map(row => <div key={row.key} className="min-w-0">
              <dt className="text-xs font-semibold text-muted-foreground">{row.label}</dt>
              <dd className="break-words font-medium text-foreground">{row.value}</dd>
            </div>)}
          </dl>}
    </section>
  );
}
