# Incidente: primer acceso a WaCRM de pruebas (20-11-2026)

**Entorno afectado:** EasyPanel `wacrm-pruebas` / Compose `datos` (Supabase autohospedado), app `wacrm-app`. La producción `wacrm` y Supabase Cloud `wacrm-valle` no se modificaron.

## Causa

La base tenía cero usuarios en `auth.users`. El trigger `public.require_signup_invitation` exige `invitation_token` antes de insertar un usuario. La API de administración de GoTrue devolvía HTTP 500 `Database error creating new user` al crear el primer administrador sin token.

## Resolución aplicada

1. Se verificaron los triggers de `auth.users`: `require_signup_invitation` (BEFORE INSERT) y `on_auth_user_created` (AFTER INSERT).
2. Se agregó **temporalmente** un bypass acotado al primer registro únicamente para el correo de administración de pruebas cuando `auth.users` estuviese vacío.
3. La API Admin de GoTrue creó el usuario de pruebas. Se comprobó autenticación con contraseña y lectura de su perfil vía PostgREST.
4. Se restauró el contenido original de `public.require_signup_invitation`, sin bypass. Validación SQL: `INVITE_PROTECTION_RESTORED=true`, `AUTH_USERS_COUNT=1`, `OWNER_PROFILE_COUNT=1`.
5. Se eliminaron rutas de diagnóstico y servicios auxiliares del Compose; se neutralizaron los contenedores temporales para que dejaran de ejecutarse. Estado final: servicios `datos` y `wacrm-app`; contenedores PostgreSQL, GoTrue y PostgREST saludables.

## Verificaciones

- `/login` respondió HTTP 200 y la interfaz cargó en español.
- El bundle cliente utilizó la URL separada `api-pruebas.valleautomotores.tech`.
- `/auth/v1/health` y `/rest/v1/` respondieron HTTP 200.
- Creación vía GoTrue Admin API: satisfactoria.
- Inicio de sesión con contraseña: satisfactorio.
- Perfil de propietario vinculado: existente, recuento 1.

## Seguridad

La contraseña del administrador **no se almacena en este repositorio**. El acceso requiere invitación para el resto de las altas. No fusionar cambios de esta rama en producción sin revisión.
