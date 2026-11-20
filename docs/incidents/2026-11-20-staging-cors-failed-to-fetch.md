# WaCRM pruebas — corrección de “Failed to fetch” (20-11-2026)

**Ambiente:** EasyPanel `wacrm-pruebas` / servicio Compose `datos` / contenedor `gateway` (nginx:1.28-alpine).
**Sitio:** https://pruebas.valleautomotores.tech
**API:** https://api-pruebas.valleautomotores.tech

## Causa confirmada

La instancia Supabase autohospedada usaba un gateway Nginx mínimo que no agregaba encabezados CORS para `/auth/v1/` ni `/storage/v1/`. El navegador desde el sitio de pruebas enviaba solicitudes preflight `OPTIONS`, y Nginx/GoTrue respondían 204 sin `Access-Control-Allow-Origin`. Esto provocaba `TypeError: Failed to fetch` en el inicio de sesión, aunque GoTrue y Next.js estuvieran activos.

La API REST `/rest/v1/` ya devolvía CORS (`Access-Control-Allow-Origin: *`) y se conservó sin cambios.

## Cambio realizado

Se actualizó **únicamente** `services.gateway.build.dockerfile_inline` en el Compose `datos` de EasyPanel. El archivo `nginx.conf` se vuelve a codificar en base64 dentro del Dockerfile inline, siguiendo el mecanismo anterior de la instalación. Se agregaron a los bloques `location /auth/v1/` y `location /storage/v1/`:

- `Access-Control-Allow-Origin: https://pruebas.valleautomotores.tech` (`always`, origen exacto)
- `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-upsert, x-supabase-storage-api-version, prefer, range, accept-profile, content-profile, accept`
- `Access-Control-Max-Age: 86400`, `Vary: Origin`
- Respuesta inmediata HTTP 204 a preflight `OPTIONS`.
- `proxy_hide_header` para encabezados CORS ascendentes, evitando valores duplicados en respuestas proxied.

No se alteraron la base de datos, las claves de acceso, las rutas REST ni los servicios productivos.

## Validaciones reales desde contenedor Docker del VPS

**Antes:**
- `OPTIONS /auth/v1/token?grant_type=password`: HTTP 204, *sin* `Access-Control-Allow-Origin`.
- `OPTIONS /storage/v1/bucket`: HTTP 404, *sin* encabezados CORS.
- `OPTIONS /rest/v1/contacts`: respuesta CORS válida.

**Después del rebuild y despliegue:**
- `OPTIONS /auth/v1/token?grant_type=password`: HTTP 204, `Allow-Origin` correcto, métodos y encabezados permitidos.
- `OPTIONS /auth/v1/user`: HTTP 204, CORS correcto.
- `OPTIONS /storage/v1/bucket`: HTTP 204, CORS correcto.
- `POST /auth/v1/token?grant_type=password` con credenciales inválidas (control negativo): HTTP 400 `invalid_credentials`, **con** `Allow-Origin` correcto (el error ya llega al navegador en lugar de un fallo de red).
- `GET /auth/v1/health`: HTTP 200, CORS correcto.
- `GET /login`: HTTP 200.

Hubo respuestas HTTP 404 transitorias mientras Traefik actualizaba sus rutas; en la siguiente verificación, ambas direcciones propias y las originales de EasyPanel volvieron a responder HTTP 200.

La comprobación de credenciales existentes con GoTrue se realizó en el incidente anterior. No se realizaron pruebas manuales desde el celular del usuario.

## Mantenimiento

Esta configuración vive en el Compose de EasyPanel, no en el repositorio GitHub. Si se reinstala desde cero el Compose de Supabase, **volver a aplicar los cambios de CORS al gateway**. No fusionar este cambio en producción sin validación. No almacenar credenciales en el repositorio.
