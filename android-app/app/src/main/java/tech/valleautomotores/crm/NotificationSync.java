package tech.valleautomotores.crm;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Cookie-authenticated notification polling. Uses the CRM session already
 * established in WebView, never stores a token in SharedPreferences and never
 * sends user or account identifiers chosen by the device to the server.
 *
 * Background mode: Android WorkManager's >=15min periodic polling, which can
 * be delayed by battery optimization. This is NOT real-time FCM push.
 */
public final class NotificationSync {
    private static final String BASE = "https://crm.valleautomotores.tech";
    private static final String API = BASE + "/api/mobile/notifications";
    private static final String PREFS = "valle_notifications_v1";
    private static final String CHANNEL_MESSAGES = "crm_messages";
    private static final String CHANNEL_ASSIGNMENTS = "crm_assignments";
    private static final String CHANNEL_TASKS = "crm_tasks";
    private static final AtomicBoolean IN_PROGRESS = new AtomicBoolean(false);

    private NotificationSync() {}

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        createChannel(manager, CHANNEL_MESSAGES, "Mensajes de clientes", NotificationManager.IMPORTANCE_HIGH);
        createChannel(manager, CHANNEL_ASSIGNMENTS, "Conversaciones asignadas", NotificationManager.IMPORTANCE_HIGH);
        createChannel(manager, CHANNEL_TASKS, "Recordatorios y seguimientos", NotificationManager.IMPORTANCE_DEFAULT);
    }

    private static void createChannel(NotificationManager manager, String id, String name, int importance) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription("Notificaciones del CRM Valle Automotores");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    /** @return true when the check finished (or no session), false for transient network failure. */
    public static boolean poll(Context context) {
        if (!IN_PROGRESS.compareAndSet(false, true)) return true;
        HttpURLConnection connection = null;
        try {
            String cookies = CookieManager.getInstance().getCookie(BASE + "/");
            if (cookies == null || cookies.trim().isEmpty()) return true;

            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String previousUser = prefs.getString("user_id", "");
            long lastChecked = previousUser.isEmpty() ? 0 : prefs.getLong("last_checked:" + previousUser, 0L);
            String link = API + (lastChecked > 0 ? "?after=" + lastChecked : "");
            connection = (HttpURLConnection) new URL(link).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(15000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Cookie", cookies);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "ValleAutomotoresAndroid/1.0");

            int status = connection.getResponseCode();
            if (status == 401 || status == 403) return true; // Log in again via the WebView.
            if (status != 200) return false;

            // The server may refresh a short-lived SSR cookie during a request.
            // Preserve each Set-Cookie only for our trusted HTTPS origin.
            Map<String, java.util.List<String>> headers = connection.getHeaderFields();
            for (Map.Entry<String, java.util.List<String>> entry : headers.entrySet()) {
                if (entry.getKey() == null || !"Set-Cookie".equalsIgnoreCase(entry.getKey())) continue;
                for (String cookie : entry.getValue()) {
                    CookieManager.getInstance().setCookie(BASE, cookie);
                }
            }
            CookieManager.getInstance().flush();

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = stream.read(buffer)) >= 0) {
                    if (out.size() + read > 300000) return false;
                    out.write(buffer, 0, read);
                }
            }
            JSONObject response = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            String userId = response.optString("userId", "");
            String checkedAt = response.optString("checkedAt", "");
            if (userId.isEmpty() || checkedAt.isEmpty()) return false;
            long checkedMs = Instant.parse(checkedAt).toEpochMilli();

            // First check after signing in establishes a baseline without
            // pushing a flood of old conversations and messages.
            if (!userId.equals(previousUser) || lastChecked <= 0) {
                prefs.edit().putString("user_id", userId)
                        .putLong("last_checked:" + userId, checkedMs).apply();
                return true;
            }

            JSONArray events = response.optJSONArray("events");
            if (events != null) {
                LinkedHashMap<String, JSONObject> grouped = new LinkedHashMap<>();
                for (int i = 0; i < events.length(); i++) {
                    JSONObject event = events.optJSONObject(i);
                    if (event == null) continue;
                    String id = event.optString("id", "");
                    String href = event.optString("href", "");
                    String kind = event.optString("kind", "");
                    if (id.isEmpty() || !validPath(href)) continue;
                    // Collapse multiple messages in the same conversation
                    // into a single most recent alert per polling cycle.
                    String groupKey = "message".equals(kind) ? "msg:" + href : id;
                    grouped.put(groupKey, event);
                }
                int sent = 0;
                for (JSONObject event : grouped.values()) {
                    if (sent >= 8) break; // No notification storm after a long offline period.
                    show(context, event);
                    sent++;
                }
            }
            prefs.edit().putLong("last_checked:" + userId, checkedMs).apply();
            return true;
        } catch (Exception e) {
            android.util.Log.w("ValleNotifications", "Notification sync unavailable: " + e.getClass().getSimpleName());
            return false;
        } finally {
            if (connection != null) connection.disconnect();
            IN_PROGRESS.set(false);
        }
    }

    private static boolean validPath(String path) {
        return path.startsWith("/") && !path.startsWith("//")
                && path.indexOf('\\') < 0 && path.indexOf('#') < 0;
    }

    private static void show(Context context, JSONObject event) {
        if (Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        String kind = event.optString("kind", "");
        String channel = "task".equals(kind) ? CHANNEL_TASKS :
                "assignment".equals(kind) ? CHANNEL_ASSIGNMENTS : CHANNEL_MESSAGES;
        String id = event.optString("id", "");
        String title = event.optString("title", "Valle Automotores");
        String body = event.optString("body", "Tenés una notificación nueva.");
        String href = event.optString("href", "/inbox");

        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("path", href);
        PendingIntent tap = PendingIntent.getActivity(context, id.hashCode(),
                launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPriority("task".equals(kind) ?
                        NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(id, id.hashCode(), notification.build());
    }
}
