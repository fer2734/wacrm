package tech.valleautomotores.crm;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_PICKER_REQUEST = 301;
    private static final int NOTIFY_PERMISSION_REQUEST = 302;
    private static final int AUDIO_PERMISSION_REQUEST = 303;
    private static final String HOME = "https://crm.valleautomotores.tech";
    private static final String CRM_HOST = "crm.valleautomotores.tech";

    private WebView browser;
    private ProgressBar loadingBar;
    private TextView offlineMessage;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;
    private PermissionRequest pendingMicrophone;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Runnable foregroundNotifications = new Runnable() {
        @Override public void run() {
            executor.execute(() -> NotificationSync.poll(MainActivity.this));
            handler.postDelayed(this, 60_000L);
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(32, 42, 53));
        getWindow().setNavigationBarColor(Color.rgb(32, 42, 53));
        NotificationSync.createChannels(this);
        NotificationWorker.schedule(this);

        FrameLayout frame = new FrameLayout(this);
        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(245, 246, 248));
        frame.addView(browser, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        loadingBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        loadingBar.setMax(100);
        FrameLayout.LayoutParams bar = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 5);
        frame.addView(loadingBar, bar);

        offlineMessage = new TextView(this);
        offlineMessage.setText("Sin conexión con Valle Automotores. Tocá para reintentar.");
        offlineMessage.setTextColor(Color.WHITE);
        offlineMessage.setBackgroundColor(Color.rgb(48, 57, 67));
        offlineMessage.setPadding(28, 20, 28, 20);
        offlineMessage.setVisibility(View.GONE);
        offlineMessage.setOnClickListener(v -> {
            offlineMessage.setVisibility(View.GONE);
            browser.reload();
        });
        FrameLayout.LayoutParams err = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        frame.addView(offlineMessage, err);
        setContentView(frame);

        android.webkit.WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ValleAutomotoresAndroid/1.0");
        WebView.setWebContentsDebuggingEnabled(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                if ("https".equalsIgnoreCase(url.getScheme()) &&
                        CRM_HOST.equalsIgnoreCase(url.getHost())) return false;
                openExternal(url);
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) {
                loadingBar.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadingBar.setVisibility(View.GONE);
                    offlineMessage.setVisibility(View.VISIBLE);
                }
            }
            @Override public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError error) {
                handler.cancel(); // Never bypass TLS errors.
                offlineMessage.setText("No se pudo verificar la conexión segura. Revisá la red.");
                offlineMessage.setVisibility(View.VISIBLE);
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                loadingBar.setProgress(progress);
                loadingBar.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }
            @Override public boolean onShowFileChooser(
                    WebView webView,
                    android.webkit.ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                chooseFile();
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> {
                    boolean trusted = req.getOrigin() != null &&
                            "https".equalsIgnoreCase(req.getOrigin().getScheme()) &&
                            CRM_HOST.equalsIgnoreCase(req.getOrigin().getHost());
                    boolean microphoneOnly = true;
                    for (String resource : req.getResources()) {
                        if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) microphoneOnly = false;
                    }
                    if (!trusted || !microphoneOnly || req.getResources().length == 0) {
                        req.deny();
                        return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingMicrophone = req;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
                    }
                });
            }
        });

        browser.setDownloadListener((url, agent, disposition, mime, len) -> download(url, agent, disposition, mime));
        browser.loadUrl(destination(getIntent()));
        requestNotificationPermission();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFY_PERMISSION_REQUEST);
        }
    }

    private String destination(Intent intent) {
        String path = intent == null ? null : intent.getStringExtra("path");
        if (path == null || !path.startsWith("/") || path.startsWith("//")
                || path.indexOf('\\') >= 0 || path.indexOf('#') >= 0) return HOME + "/inbox";
        Uri full = Uri.parse(HOME + path);
        if (!CRM_HOST.equalsIgnoreCase(full.getHost())) return HOME + "/inbox";
        return full.toString();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (browser != null) browser.loadUrl(destination(intent));
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)
                && !"mailto".equalsIgnoreCase(scheme) && !"tel".equalsIgnoreCase(scheme)
                && !"whatsapp".equalsIgnoreCase(scheme)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay una aplicación para abrir el enlace.", Toast.LENGTH_SHORT).show();
        }
    }

    private void chooseFile() {
        Intent select = new Intent(Intent.ACTION_GET_CONTENT);
        select.addCategory(Intent.CATEGORY_OPENABLE);
        select.setType("*/*");
        select.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "image/jpeg", "image/png", "image/webp", "application/pdf", "audio/*", "video/*"
        });
        Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        Intent chooser = Intent.createChooser(select, "Adjuntar archivo o comprobante");
        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            if (dir != null) {
                cameraFile = File.createTempFile("valle_comprobante_", ".jpg", dir);
                cameraUri = FileProvider.getUriForFile(this,
                        getPackageName() + ".fileprovider", cameraFile);
                capture.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                capture.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{capture});
            }
        } catch (IOException e) {
            cameraUri = null;
            cameraFile = null;
        }
        try { startActivityForResult(chooser, FILE_PICKER_REQUEST); }
        catch (ActivityNotFoundException e) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_PICKER_REQUEST || fileCallback == null) return;
        Uri[] selected = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                selected = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < selected.length; i++)
                    selected[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                selected = new Uri[]{data.getData()};
            } else if (cameraUri != null && cameraFile != null && cameraFile.length() > 0) {
                selected = new Uri[]{cameraUri};
            }
        }
        fileCallback.onReceiveValue(selected);
        fileCallback = null;
        cameraUri = null;
        cameraFile = null;
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        Uri uri = Uri.parse(url);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return;
        try {
            String filename = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle(filename);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (mimeType != null) request.setMimeType(mimeType);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(uri.toString());
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, filename);
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            manager.enqueue(request);
            Toast.makeText(this, "Descargando archivo…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo descargar el archivo.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == AUDIO_PERMISSION_REQUEST && pendingMicrophone != null) {
            PermissionRequest req = pendingMicrophone;
            pendingMicrophone = null;
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else req.deny();
        }
    }

    @Override protected void onStart() {
        super.onStart();
        handler.removeCallbacks(foregroundNotifications);
        handler.postDelayed(foregroundNotifications, 5000L);
    }

    @Override protected void onStop() {
        handler.removeCallbacks(foregroundNotifications);
        super.onStop();
    }

    @Override public void onBackPressed() {
        if (browser != null && browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
    }

    @Override protected void onDestroy() {
        handler.removeCallbacks(foregroundNotifications);
        executor.shutdownNow();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (browser != null) {
            ((ViewGroup) browser.getParent()).removeView(browser);
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }
}
