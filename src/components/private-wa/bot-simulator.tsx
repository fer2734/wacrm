"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Send, FlaskConical } from "lucide-react";

type BotConfig = {
  welcome?: string;
  transfer?: string;
  prompts?: Record<string, string>;
  brands?: Record<string, string[]>;
};
type Step =
  | "vehicle" | "brand" | "brand_other" | "model" | "model_other"
  | "cc" | "cc_other" | "year" | "capital" | "capital_amount" | "operation"
  | "quota" | "quota_other" | "name" | "locality" | "completed";
type Fields = {
  vehicle?: string; brand?: string; model?: string; year?: string; cc?: string;
  capital?: string; capitalAmount?: string; operation?: string;
  quota?: string; name?: string; locality?: string;
};
type Entry = { role: "bot" | "customer"; text: string };
type Session = { step: Step; fields: Fields; history: Entry[]; error?: string };

const defaults: Record<string, string[]> = {
  Honda: ["Wave 110", "GLH 150", "XR 150", "XR 250"],
  Motomel: ["B110", "S2 150", "Skua 150", "Skua 250"],
  Gilera: ["Smash 110", "VC 150", "Sahel 150"],
  Zanella: ["ZB 110", "ZR 150", "RX 150"],
  Corven: ["Energy 110", "Triax 150", "Hunter 150"],
  Keller: ["KN110-8", "Stratus 150"],
  Mondial: ["LD 110 Max", "RD 150"],
  Yamaha: [], Bajaj: [], Suzuki: [], Kawasaki: [], KTM: [], Benelli: [], Hero: [], "Royal Enfield": [], CFMoto: [], TVS: [], Beta: [], Voge: [],
};
const motorcycles = ["110 cc", "125 cc", "150 cc", "200 cc", "250 cc", "300 cc o más", "OTRA"];
const choose = (value: string, options: string[]) => {
  const simplified = (s: string) => s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const num = Number(value.trim());
  if (/^\d+$/.test(value.trim()) && num > 0 && num <= options.length) return options[num - 1];
  return options.find(option => simplified(option) === simplified(value)) || null;
};
function optionsFor(step: Step, fields: Fields, cfg: BotConfig): string[] {
  const brands = cfg.brands || defaults;
  switch (step) {
    case "vehicle": return ["MOTO", "AUTO", "CAMIONETA"];
    case "brand": return fields.vehicle === "MOTO" ? [...Object.keys(brands).slice(0, 22), "OTRA"] : [];

    case "cc": return fields.vehicle === "MOTO" ? motorcycles : [];
    case "capital": return ["SÍ", "NO"];
    case "operation": return ["FINANCIACIÓN", "COMPRA DIRECTA"];

    default: return [];
  }
}
function question(step: Step, fields: Fields, cfg: BotConfig): string {
  const known: Record<Step, string> = {
    vehicle: cfg.welcome || "¡Bienvenido/a a Valle Automotores! Estamos en General Roca, Río Negro. ¿Qué estás buscando?",
    brand: fields.vehicle === "MOTO" ? "¿Qué marca de moto buscás?" : "¿Qué marca buscás? Si todavía no lo decidiste, respondé NO LO SÉ.",
    brand_other: "¿Qué otra marca buscás?",
    model: "¿Qué modelo buscás? Si todavía no lo sabés, respondé NO LO SÉ.",
    year: "¿De qué años aproximadamente lo buscás?",
    model_other: "¿Qué otro modelo te interesa?",
    cc: "¿Qué cilindrada preferís?",
    cc_other: "Indicá la cilindrada que estás buscando.",
    capital: "¿Tenés capital para una entrega?",
    capital_amount: "¿Con cuánto dinero contás para la entrega? Escribí el importe aproximado.",
    operation: "¿Buscás financiación o compra directa?",
    quota: "¿Qué cuota mensual podrías pagar por mes?",
    quota_other: "¿Qué importe mensual te gustaría pagar?",
    name: "¿Cuál es tu nombre?",
    locality: "¿De qué localidad sos?",
    completed: cfg.transfer || "¡Gracias! Registramos tu consulta y la derivamos al asesor.",
  };
  return cfg.prompts?.[step]?.trim() || known[step];
}
function next(step: Step, fields: Fields, value: string, cfg: BotConfig): { step: Step; fields: Fields } | null {
  const answer = value.trim().slice(0, 140);
  if (!answer) return null;
  const f = { ...fields };
  const select = optionsFor(step, f, cfg);
  const picked = select.length ? choose(answer, select) : answer;
  if (!picked) return null;
  switch (step) {
    case "vehicle": f.vehicle = picked; return { step: "brand", fields: f };
    case "brand":
      if (picked === "OTRA" && f.vehicle === "MOTO") return { step: "brand_other", fields: f };
      f.brand = f.vehicle !== "MOTO" && /^(no lo se|no se)$/i.test(picked.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")) ? "NO LO SÉ" : picked; return { step: f.vehicle === "MOTO" ? "cc" : "model", fields: f };
    case "brand_other": f.brand = picked; return { step: "cc", fields: f };
    case "model": f.model = /^(no lo se|no se)$/i.test(picked.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")) ? "NO LO SÉ" : picked; return { step: "year", fields: f };
    case "year": f.year = picked; return { step: "capital", fields: f };
    case "model_other": f.model = picked; return { step: "cc", fields: f };
    case "cc":
      if (picked === "OTRA" && f.vehicle === "MOTO") return { step: "cc_other", fields: f };
      f.cc = picked; return { step: "capital", fields: f };
    case "cc_other": f.cc = picked; return { step: "capital", fields: f };
    case "capital": f.capital = picked; return { step: picked === "SÍ" ? "capital_amount" : "operation", fields: f };
    case "capital_amount": f.capitalAmount = picked; return { step: "operation", fields: f };
    case "operation": f.operation = picked; return { step: picked === "FINANCIACIÓN" ? "quota" : "name", fields: f };
    case "quota": f.quota = picked; return { step: "name", fields: f };
    case "quota_other": f.quota = picked; return { step: "name", fields: f };
    case "name": f.name = picked; return { step: "locality", fields: f };
    case "locality": f.locality = picked; return { step: "completed", fields: f };
    default: return null;
  }
}
export function PrivateBotSimulator({ config }: { config: BotConfig }) {
  const start = (): Session => ({ step: "vehicle", fields: {}, history: [{ role: "bot", text: question("vehicle", {}, config) }] });
  const [session, setSession] = useState<Session>(start);
  const [input, setInput] = useState("");
  const opts = useMemo(() => optionsFor(session.step, session.fields, config), [session.step, session.fields, config]);
  function submit(value: string) {
    const outcome = next(session.step, session.fields, value, config);
    if (!outcome) {
      setSession(current => ({ ...current, error: "Elegí una de las opciones indicadas." }));
      return;
    }
    setSession(current => ({
      ...outcome,
      history: [...current.history, { role: "customer", text: value }, { role: "bot", text: question(outcome.step, outcome.fields, config) }],
    }));
    setInput("");
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div><h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-5"/> Simulador del bot</h2>
          <p className="mt-1 text-xs text-muted-foreground">Prueba interna, sin WhatsApp, sin datos reales y sin enviar notificaciones.</p></div>
        <button type="button" onClick={() => { setSession(start()); setInput(""); }}
          className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium">
          <RotateCcw className="size-4"/> Reiniciar
        </button>
      </div>
      <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto rounded-xl bg-muted/40 p-3">
        {session.history.map((entry, index) =>
          <div key={index} className={`flex ${entry.role === "customer" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl p-3 text-sm ${entry.role === "customer" ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground"}`}>
              {entry.text}
            </div>
          </div>
        )}
      </div>
      {session.step !== "completed" ? <>
        {(session.step === "brand" || session.step === "model") && session.fields.vehicle !== "MOTO" && <button type="button" className="mt-3 min-h-11 rounded-lg border border-border bg-background px-4 text-sm font-semibold" onClick={() => submit("NO LO SÉ")}>NO LO SÉ</button>}
        {opts.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {opts.map(option => <button type="button" key={option} onClick={() => submit(option)}
            className="min-h-11 rounded-lg border border-border bg-background px-2 text-sm font-medium hover:bg-muted">
            {option}
          </button>)}
        </div> : <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); submit(input); }}>
          <input value={input} onChange={event => setInput(event.target.value)} required
            placeholder="Escribí como cliente..." className="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"/>
          <button type="submit" className="rounded-lg bg-primary px-4 text-primary-foreground" aria-label="Enviar respuesta"><Send className="size-4"/></button>
        </form>}
        {session.error && <p role="alert" className="mt-2 text-xs text-amber-600">{session.error}</p>}
      </> : <div className="mt-4 rounded-lg border border-border p-3">
        <h3 className="font-semibold">Resumen que recibiría el asesor</h3>
        <div className="mt-2 space-y-1 text-sm">
          {Object.entries({
            "Nombre": session.fields.name, "Localidad": session.fields.locality,
            "Vehículo": session.fields.vehicle, "Marca": session.fields.brand,
            ...(session.fields.vehicle === "MOTO" ? { "Cilindrada": session.fields.cc } : { "Modelo": session.fields.model, "Años aproximados": session.fields.year }),
            "Tiene entrega": session.fields.capital, "Capital disponible": session.fields.capitalAmount,
            "Operación": session.fields.operation, "Cuota deseada": session.fields.quota,
          }).map(([label, value]) => <p key={label}><strong>{label}:</strong> {value || "No indicó"}</p>)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Simulación completada. No se creó ningún cliente real.</p>
      </div>}
    </section>
  );
}
