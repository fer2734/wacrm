import type { FlowTemplate } from './templates';

/** Deterministic intake: no model calls and no financial promises. */
export const VALLE_SALES_FLOW: FlowTemplate = {
  slug: 'valle_sales', name: 'Valle · Indagación y reparto',
  description: 'Preguntas guiadas sin IA y reparto por turnos únicamente entre agentes. Al asignar, el bot se detiene.',
  icon: 'UserPlus', trigger_type: 'first_inbound_message',
  trigger_config: { sales_intake: true }, entry_node_id: 'start',
  nodes: [
    { node_key: 'start', node_type: 'start', config: { next_node_key: 'vehicle' } },
    { node_key: 'vehicle', node_type: 'collect_input', config: { prompt_text: '¡Hola! Soy el asistente de Valle Automotores. Para orientar tu consulta, ¿qué vehículo estás buscando? Podés escribir «asesor» en cualquier momento para hablar con una persona.', var_key: 'vehiculo', next_node_key: 'resources' } },
    { node_key: 'resources', node_type: 'send_buttons', config: { text: '¡Gracias por consultar a Valle Automotores! ¿Con qué pensabas comenzar la compra?', buttons: [
      { reply_id: 'capital', title: 'Dinero', next_node_key: 'capital' },
      { reply_id: 'used', title: 'Un usado', next_node_key: 'used' },
      { reply_id: 'options', title: 'Consultar opciones', next_node_key: 'name' },
    ] } },
    { node_key: 'capital', node_type: 'collect_input', config: { prompt_text: '¿Con cuánto dinero pensabas comenzar? Si todavía no lo definiste, podés responder «a consultar».', var_key: 'capital', next_node_key: 'name' } },
    { node_key: 'used', node_type: 'collect_input', config: { prompt_text: 'Contame la marca, modelo, año y kilometraje del usado que entregarías. Si además sumarías dinero, podés indicarlo acá.', var_key: 'usado', next_node_key: 'name' } },
    { node_key: 'name', node_type: 'collect_input', config: { prompt_text: '¿Cómo te llamás?', var_key: 'nombre', next_node_key: 'city' } },
    { node_key: 'city', node_type: 'collect_input', config: { prompt_text: '¿De qué localidad sos?', var_key: 'localidad', next_node_key: 'thanks' } },
    { node_key: 'thanks', node_type: 'send_message', config: { text: 'Gracias. Voy a pasarle tu consulta a un asesor de Valle Automotores, que continuará la atención desde su propio WhatsApp.', next_node_key: 'handoff' } },
    { node_key: 'handoff', node_type: 'handoff', config: { round_robin: true, note: 'Consulta de Valle Automotores\nNombre: {{vars.nombre}}\nLocalidad: {{vars.localidad}}\nVehículo: {{vars.vehiculo}}\nCapital: {{vars.capital}}\nUsado: {{vars.usado}}\nMensaje inicial: {{vars.initial_message}}\nEl bot quedó detenido al asignar la conversación.' } },
  ],
};

/** Keep obvious vehicle information from the opening message without an LLM. */
export function openingVehicle(text: string): string | null {
  return /\b(hilux|corolla|etios|yaris|cronos|argo|toro|strada|gol|polo|vento|golf|up|amarok|saveiro|nivus|t.cross|focus|fiesta|ranger|ecosport|ka|onix|prisma|cruze|tracker|s10|duster|sandero|logan|kangoo|oroch|208|207|308|2008|compass|renegade)\b/i.test(text) ? text.trim().slice(0,2000) : null;
}
