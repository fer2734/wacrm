import type { FlowTemplate } from "./templates";

/** Intake unificado para bandeja principal; reparto rotativo entre asesores. */
export const VALLE_SALES_FLOW: FlowTemplate = {
  slug: "valle_sales",
  name: "Valle · Indagación y reparto",
  description: "Calificación por MOTO/AUTO/CAMIONETA, con NO LO SÉ para marca de autos/camionetas y derivación rotativa.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: { sales_intake: true },
  entry_node_id: "start",
  nodes: [
  {
    "node_key": "start",
    "node_type": "start",
    "config": {
      "next_node_key": "vehicle"
    }
  },
  {
    "node_key": "vehicle",
    "node_type": "send_buttons",
    "config": {
      "text": "¡Bienvenido/a a Valle Automotores! Estamos en General Roca, Río Negro. ¿Qué estás buscando?",
      "save_var_key": "tipo_vehiculo",
      "buttons": [
        {
          "reply_id": "moto",
          "title": "MOTO",
          "next_node_key": "moto_marca"
        },
        {
          "reply_id": "auto",
          "title": "AUTO",
          "next_node_key": "auto_marca"
        },
        {
          "reply_id": "camioneta",
          "title": "CAMIONETA",
          "next_node_key": "camioneta_marca"
        }
      ]
    }
  },
  {
    "node_key": "moto_marca",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué marca de moto buscás? Podés indicar una de estas: Honda, Motomel, Gilera, Zanella, Corven, Keller, Mondial, Yamaha, Bajaj, Suzuki, Kawasaki, KTM, Benelli, Hero, Royal Enfield, CFMoto, TVS, Beta, Voge, u OTRA.",
      "var_key": "marca",
      "next_node_key": "moto_cc"
    }
  },
  {
    "node_key": "moto_cc",
    "node_type": "send_list",
    "config": {
      "text": "¿Qué cilindrada preferís?",
      "button_label": "Elegir opción",
      "save_var_key": "cilindrada",
      "sections": [
        {
          "title": "Elegí una alternativa",
          "rows": [
            {
              "reply_id": "cc110",
              "title": "110 cc",
              "next_node_key": "capital"
            },
            {
              "reply_id": "cc125",
              "title": "125 cc",
              "next_node_key": "capital"
            },
            {
              "reply_id": "cc150",
              "title": "150 cc",
              "next_node_key": "capital"
            },
            {
              "reply_id": "cc200",
              "title": "200 cc",
              "next_node_key": "capital"
            },
            {
              "reply_id": "cc250",
              "title": "250 cc",
              "next_node_key": "capital"
            },
            {
              "reply_id": "cc300",
              "title": "300 cc o más",
              "next_node_key": "capital"
            },
            {
              "reply_id": "otra",
              "title": "OTRA",
              "next_node_key": "moto_cc_otra"
            }
          ]
        }
      ]
    }
  },
  {
    "node_key": "moto_cc_otra",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué otra cilindrada buscás?",
      "var_key": "cilindrada",
      "next_node_key": "capital"
    }
  },
  {
    "node_key": "auto_marca",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué marca de auto buscás? Si todavía no lo decidiste, respondé NO LO SÉ.",
      "var_key": "marca",
      "next_node_key": "auto_modelo"
    }
  },
  {
    "node_key": "auto_modelo",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué modelo de auto buscás? Si todavía no lo sabés, respondé NO LO SÉ.",
      "var_key": "modelo",
      "next_node_key": "auto_anios"
    }
  },
  {
    "node_key": "auto_anios",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿De qué años aproximadamente lo buscás?",
      "var_key": "anios",
      "next_node_key": "capital"
    }
  },
  {
    "node_key": "camioneta_marca",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué marca de camioneta buscás? Si todavía no lo decidiste, respondé NO LO SÉ.",
      "var_key": "marca",
      "next_node_key": "camioneta_modelo"
    }
  },
  {
    "node_key": "camioneta_modelo",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué modelo de camioneta buscás? Si todavía no lo sabés, respondé NO LO SÉ.",
      "var_key": "modelo",
      "next_node_key": "camioneta_anios"
    }
  },
  {
    "node_key": "camioneta_anios",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿De qué años aproximadamente lo buscás?",
      "var_key": "anios",
      "next_node_key": "capital"
    }
  },
  {
    "node_key": "capital",
    "node_type": "send_buttons",
    "config": {
      "text": "¿Tenés capital para una entrega?",
      "save_var_key": "tiene_capital",
      "buttons": [
        {
          "reply_id": "si",
          "title": "SÍ",
          "next_node_key": "capital_monto"
        },
        {
          "reply_id": "no",
          "title": "NO",
          "next_node_key": "operacion"
        }
      ]
    }
  },
  {
    "node_key": "capital_monto",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Con cuánto dinero contás para la entrega? Indicá el importe aproximado.",
      "var_key": "capital",
      "next_node_key": "operacion"
    }
  },
  {
    "node_key": "operacion",
    "node_type": "send_buttons",
    "config": {
      "text": "¿Buscás financiación o compra directa?",
      "save_var_key": "tipo_operacion",
      "buttons": [
        {
          "reply_id": "financiacion",
          "title": "FINANCIACIÓN",
          "next_node_key": "cuota"
        },
        {
          "reply_id": "directa",
          "title": "COMPRA DIRECTA",
          "next_node_key": "nombre"
        }
      ]
    }
  },
  {
    "node_key": "cuota",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Qué cuota mensual podrías pagar por mes?",
      "var_key": "cuota",
      "next_node_key": "nombre"
    }
  },
  {
    "node_key": "nombre",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿Cuál es tu nombre?",
      "var_key": "nombre",
      "next_node_key": "localidad"
    }
  },
  {
    "node_key": "localidad",
    "node_type": "collect_input",
    "config": {
      "prompt_text": "¿De qué localidad sos?",
      "var_key": "localidad",
      "next_node_key": "despedida"
    }
  },
  {
    "node_key": "despedida",
    "node_type": "send_message",
    "config": {
      "text": "¡Gracias, {{vars.nombre}}! Ya registramos tu consulta y la vamos a derivar a un asesor de Valle Automotores para continuar la atención.",
      "next_node_key": "handoff"
    }
  },
  {
    "node_key": "handoff",
    "node_type": "handoff",
    "config": {
      "round_robin": true,
      "note": "Nuevo cliente Valle Automotores\nNombre: {{vars.nombre}}\nLocalidad: {{vars.localidad}}\nVehículo: {{vars.tipo_vehiculo}}\nMarca: {{vars.marca}}\nModelo (auto/camioneta): {{vars.modelo}}\nAños aproximados (auto/camioneta): {{vars.anios}}\nCilindrada (moto): {{vars.cilindrada}}\nTiene capital: {{vars.tiene_capital}}\nCapital disponible: {{vars.capital}}\nOperación: {{vars.tipo_operacion}}\nCuota mensual deseada: {{vars.cuota}}\nMensaje inicial: {{vars.initial_message}}\nDerivación rotativa; bot detenido al asignar."
    }
  }
],
};

/** Detecta vehículos mencionados sin cambiar el inicio del menú principal. */
export function openingVehicle(text: string): string | null {
  return /\b(hilux|corolla|etios|yaris|cronos|argo|toro|strada|gol|polo|vento|golf|up|amarok|saveiro|nivus|t.cross|focus|fiesta|ranger|ecosport|ka|onix|prisma|cruze|tracker|s10|duster|sandero|logan|kangoo|oroch|208|207|308|2008|compass|renegade)\b/i.test(text) ? text.trim().slice(0,2000) : null;
}
