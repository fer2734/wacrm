import type { FlowTemplate, FlowTemplateNode } from "./templates";

type Option = { id: string; title: string; next: string };
const nodes: FlowTemplateNode[] = [];
const add = (node_key: string, node_type: FlowTemplateNode["node_type"], config: Record<string, unknown>) =>
  nodes.push({ node_key, node_type, config });
const text = (key: string, prompt: string, varKey: string, next: string) =>
  add(key, "collect_input", { prompt_text: prompt, var_key: varKey, next_node_key: next });
const buttons = (key: string, prompt: string, options: Option[], save?: string) =>
  add(key, "send_buttons", { text: prompt, ...(save ? { save_var_key: save } : {}), buttons: options.map(o => ({ reply_id: o.id, title: o.title, next_node_key: o.next })) });
const list = (key: string, prompt: string, options: Option[], save?: string) =>
  add(key, "send_list", { text: prompt, button_label: "Elegir opción", ...(save ? { save_var_key: save } : {}), sections: [{ title: "Seleccioná una opción", rows: options.map(o => ({ reply_id: o.id, title: o.title, next_node_key: o.next })) }] });

add("start", "start", { next_node_key: "vehiculo" });
buttons("vehiculo", "¡Bienvenido/a a Valle Automotores! Estamos en General Roca, Río Negro. 🚗🏍️ ¿Qué estás buscando?", [
  { id: "moto", title: "MOTO", next: "marcas_moto" },
  { id: "auto", title: "AUTO", next: "auto_marca" },
  { id: "camioneta", title: "CAMIONETA", next: "camioneta_marca" },
], "tipo_vehiculo");

const motoMarcas = ["Honda","Motomel","Gilera","Zanella","Corven","Keller","Mondial","Yamaha","Bajaj","Suzuki","Kawasaki","KTM","Benelli","Hero","Royal Enfield","CFMoto","TVS","Beta","Voge"];
// Un menú de texto admite más marcas que la lista interactiva de WhatsApp (máximo 10 filas).
text("marcas_moto", "¿Qué marca de moto buscás? Respondé con el nombre o el número:\\n" + [...motoMarcas, "OTRA"].map((b, i) => `${i + 1}. ${b}`).join("\\n"), "marca", "cilindrada_moto");
list("cilindrada_moto", "¿Qué cilindrada preferís?", [
  { id: "110", title: "110 cc", next: "capital" },
  { id: "125", title: "125 cc", next: "capital" },
  { id: "150", title: "150 cc", next: "capital" },
  { id: "200", title: "200 cc", next: "capital" },
  { id: "250", title: "250 cc", next: "capital" },
  { id: "300", title: "300 cc o más", next: "capital" },
  { id: "otra", title: "OTRA", next: "cilindrada_moto_otra" },
], "cilindrada");
text("cilindrada_moto_otra", "Indicá la cilindrada que estás buscando.", "cilindrada", "capital");

text("auto_marca", "¿Qué marca de auto buscás? Podés escribir OTRA.", "marca", "auto_modelo");
text("auto_modelo", "¿Qué modelo de auto te interesa?", "modelo", "auto_anios");
text("auto_anios", "¿De qué años aproximadamente lo buscás?", "anios", "capital");
text("camioneta_marca", "¿Qué marca de camioneta buscás? Podés escribir OTRA.", "marca", "camioneta_modelo");
text("camioneta_modelo", "¿Qué modelo de camioneta te interesa?", "modelo", "camioneta_anios");
text("camioneta_anios", "¿De qué años aproximadamente lo buscás?", "anios", "capital");

buttons("capital", "¿Tenés capital para la entrega?", [
  { id: "si", title: "SÍ", next: "capital_monto" },
  { id: "no", title: "NO", next: "forma_compra" },
], "tiene_capital");
text("capital_monto", "¿Con cuánto dinero contás para la entrega? Indicá un importe aproximado en pesos.", "capital", "forma_compra");
buttons("forma_compra", "¿Buscás financiación o compra directa?", [
  { id: "financiacion", title: "FINANCIACIÓN", next: "cuota_vehiculo" },
  { id: "directa", title: "COMPRA DIRECTA", next: "nombre" },
], "operacion");
text("cuota_vehiculo", "¿Qué cuota mensual podrías pagar por mes?", "cuota", "nombre");
text("nombre", "¿Cuál es tu nombre?", "nombre", "localidad");
text("localidad", "¿De qué localidad sos?", "localidad", "despedida");
add("despedida", "send_message", {
  text: "¡Gracias, {{vars.nombre}}! Ya registramos tu consulta. Te vamos a derivar a un asesor de Valle Automotores para continuar la atención.",
  next_node_key: "derivar",
});
add("derivar", "handoff", {
  round_robin: true,
  note: "Nuevo interesado de Valle Automotores\nNombre: {{vars.nombre}}\nLocalidad: {{vars.localidad}}\nVehículo: {{vars.tipo_vehiculo}}\nMarca: {{vars.marca}}\nModelo (autos/camionetas): {{vars.modelo}}\nAños aproximados: {{vars.anios}}\nCilindrada (motos): {{vars.cilindrada}}\nCapital disponible: {{vars.tiene_capital}} {{vars.capital}}\nOperación: {{vars.operacion}}\nCuota deseada: {{vars.cuota}}\nDerivado al asesor para atención personalizada.",
});

export const VALLE_CATALOG_INTAKE: FlowTemplate = {
  slug: "valle_catalog_intake",
  name: "Valle Automotores · Calificación de clientes",
  description: "Menú de MOTO, AUTO o CAMIONETA, marca y cilindrada de motos; modelo y años para autos, entrega, financiación y derivación. Sin IA, con respuestas guiadas y datos resumidos.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: { catalog_intake: true },
  entry_node_id: "start",
  nodes,
};
