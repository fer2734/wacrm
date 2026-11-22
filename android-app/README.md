# Valle Automotores CRM — Android

Aplicación Android para `https://crm.valleautomotores.tech`.

## Funciones

- CRM y ERP con el **mismo usuario**. Sesión conservada en el almacén de cookies de Android WebView.
- Notificaciones de **conversaciones asignadas**, **mensajes de clientes en conversaciones asignadas** y **tareas del ERP**.
- Comprobación mientras la aplicación está abierta cada **60 segundos**; en segundo plano, Android WorkManager pide una ejecución de control aproximadamente cada **15 minutos**. El sistema operativo puede demorarlo por batería/conectividad. **Esto no es push instantáneo**.
- Avisos privados (sin mostrar el texto de mensajes de clientes en la pantalla bloqueada), con acceso directo a la conversación.
- Archivos adjuntos, fotos desde la cámara del teléfono, audios de WhatsApp y grabación de voz (solicita permiso).
- HTTPS obligatorio; nunca acepta errores TLS ni incorpora credenciales de Supabase en el APK.

## Instalación

1. Descargá el archivo APK del artefacto de GitHub Actions de la rama del proyecto.
2. En Android, habilitá temporalmente la instalación desde el origen de esa descarga.
3. Instalá y abrí **Valle Automotores**.
4. Iniciá sesión con tu cuenta del CRM.
5. Permití las notificaciones cuando Android lo solicite (Android 13 o posterior).
6. En Android: Ajustes > Apps > Valle Automotores > Notificaciones: asegurate de habilitarlas.

**No desinstales ni desvincules WhatsApp Business:** esta APK solo abre el CRM, no reemplaza WhatsApp.

## Compilación

El proyecto usa Android Gradle Plugin 8.8.2, Gradle 8.11.1 y Android SDK 35.

```bash
gradle -p android-app :app:assembleDebug
```

Resultado: `android-app/app/build/outputs/apk/debug/app-debug.apk`

El archivo de pruebas se firma con la clave Android de depuración del compilador. Para distribuir por Play Store o a gran escala será necesaria una firma de lanzamiento controlada por la empresa.

## Notificaciones en tiempo real (fase posterior)

Para alertas de segundos con el teléfono bloqueado se requiere **Firebase Cloud Messaging (FCM)**, registrar esta aplicación Android en un proyecto Firebase, configurar Google Services, la clave de servicio de envío del backend y un flujo de tokens por dispositivo asociado a un usuario autorizado. No se han inventado credenciales. La versión actual hace polling privado autenticado con cookies.

## Privacidad y alcance

- El servidor filtra por el usuario autenticado y las conversaciones asignadas a él, no por un ID de usuario recibido desde la aplicación.
- Los recordatorios se limitan a sus tareas; no hay lectura de chats privados WAHA de otros asesores.
- El teléfono guarda únicamente el identificador de usuario y el último instante de consulta, no tokens ni contenidos de mensajes.
- La app requiere internet; no incluye funcionamiento offline ni sincronización completa de chats.

## Diagnóstico

Si no hay notificaciones, verificá primero que hayas iniciado sesión y tengas conversaciones o tareas asignadas. Las primeras consultas establecen un punto de partida y evitan notificar mensajes antiguos. Con el ahorro extremo de batería de algunos equipos, la comprobación en segundo plano podría tardar más de 15 minutos. Las notificaciones llegan según los permisos y las restricciones de batería de Android.
