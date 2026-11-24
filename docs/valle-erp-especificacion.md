# ERP Valle Automotores — implementación independiente del CRM

## Alcance y criterio
- El CRM (bandeja, contactos, embudos y mensajes) debe permanecer operativo y sin cambios disruptivos.
- Nueva navegación **ERP / Administración** visible como sección independiente; acceso con la misma autenticación, pero autorización separada.
- Cada legajo ERP podrá asociarse a un contacto y a una conversación del CRM mediante sus identificadores; no se duplicarán mensajes.
- No usar datos reales ni comprobantes en repositorios GitHub. El repositorio actual es público.
- Módulo en español, responsive (móvil/computadora), textos legibles y contrastes correctos.

## Modelo funcional previsto
1. **Cliente**: nombres y apellidos, DNI/CUIT, teléfono, correo, domicilio, localidad, provincia, asesor responsable, observaciones, consentimientos y contacto CRM.
2. **Solicitud / contrato**: número único, fecha, tipo de operación, producto, condiciones pactadas, documentación y versión contractual. Una persona puede tener varias operaciones.
3. **Interés de vehículo**: marca, modelo, versión, año, tipo de unidad, valor de referencia, permuta y observaciones.
4. **Plan de cuotas**: número, moneda ARS, vencimiento, importe, estado (pendiente, parcial, pagada, vencida, anulada), saldo y plan contractual. Separar cuota inicial y gastos administrativos.
5. **Pago**: fecha de recepción, importe, medio, referencia, usuario registrador, estado (pendiente de validación, validado, rechazado, revertido), distribución a cuotas y auditoría. Permitir pagos parciales, pagos múltiples y reversos sin borrar registros.
6. **Comprobante**: uno o más PDF/JPG/PNG por pago, almacenamiento privado con URL firmada y metadatos. Control de tamaño, tipo y permisos.
7. **Seguimiento**: notas fechadas, tareas, responsable, fecha de próximo contacto, resultado de gestión, recordatorios y timeline.
8. **Conversación**: asociación opcional a contact_id y conversation_id existentes; enlace al chat CRM autorizado, sin transferir automáticamente texto ni credenciales.
9. **Entrega**: hito tras cuota 4, revisión de documentación, evaluación de crédito (pendiente/en gestión/aprobada/rechazada), disponibilidad del vehículo, aprobación y entrega, cada una con fecha/usuario.
10. **Administración**: dashboard de cartera, cobranza mensual, mora por antigüedad, proyección, cobranzas por asesor, exportaciones autorizadas y bitácora.

## Reglas críticas
- Registrar cuatro cuotas pagadas NO equivale a aprobación crediticia ni derecho automático a entrega; cada estado es distinto.
- Se debe preservar el historial: no eliminar pagos validados; hacer reversos y asientos de ajuste trazables.
- RLS y validación del lado servidor obligatorias en todas las operaciones. Perfiles: administrador general, cobranzas, entregas, asesor, consulta; el asesor solo accede a los legajos asignados si la política así lo determina.
- Aislar las tablas ERP con prefijo erp_ o esquema propio y políticas que no alteren las tablas del CRM.
- Almacenar archivos privados, nunca en bucket público; no subir comprobantes con datos personales al código fuente.
- Auditar altas, cambios, validaciones, anulaciones y accesos sensibles.
- Backups externos cifrados y pruebas de restauración previas a la puesta en producción.

## Implementación por etapas
**E1**: migraciones y políticas RLS; perfiles; legajos; solicitudes; vinculación CRM; interfaz ERP y listado de clientes.
**E2**: calendario de cuotas; pagos parciales y reversos; carga privada de comprobantes; conciliación y auditoría.
**E3**: tareas, recordatorios, vistas por asesor, proceso de entregas y reportes.
**E4**: contrato PDF, importaciones/exportaciones, integraciones n8n y pruebas de producción.

## Criterios mínimos de aceptación
- CRM y conversaciones existentes no se ven afectados.
- Usuarios no autorizados no pueden leer ni descargar información ERP, tampoco por API.
- Un pago puede acompañarse de comprobantes, y un comprobante se recupera únicamente con acceso autorizado.
- Todos los movimientos monetarios tienen responsable, fecha y registro de auditoría.
- Cliente puede enlazarse a un chat existente y acceder a él solo cuando tiene permiso en CRM.
- El ERP funciona en pantallas móviles sin desplazamiento horizontal de formularios.
- Las operaciones críticas se prueban con datos sintéticos antes de desplegar.

> Estado: especificación inicial en rama separada. Ningún cambio aplicado a la rama main ni a producción.
