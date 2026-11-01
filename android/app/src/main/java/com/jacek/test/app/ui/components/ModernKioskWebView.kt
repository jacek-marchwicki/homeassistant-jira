package com.jacek.test.app.ui.components

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.http.SslError
import android.os.Build
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.ViewCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private const val TAG = "ModernKioskWebView"

private fun Context.findActivity(): Activity? {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ModernKioskWebView(
    url: String,
    modifier: Modifier = Modifier,
    pageZoom: Int = 100,
    injectStatusBarPadding: Boolean = true,
    statusBarHeightDp: Int = 0,
    navBarHeightDp: Int = 0,
    cutoutLeftDp: Int = 0,
    cutoutRightDp: Int = 0,
    isDark: Boolean = false,
    isUrlAllowed: (String) -> Boolean = { true },
    onBlockedUrl: (String) -> Unit = {},
    onWebViewCreated: (WebView) -> Unit = {},
    onPageTitleChanged: (String?) -> Unit = {},
    onError: (String) -> Unit = {}
) {
    val context = LocalContext.current
    var progress by remember { mutableIntStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var lastAppliedZoom by remember { mutableIntStateOf(-1) }
    var lastAppliedDark by remember { mutableStateOf<Boolean?>(null) }

    var currentLoadFailedError by remember { mutableStateOf<WebErrorInfo?>(null) }
    var displayedError by remember { mutableStateOf<WebErrorInfo?>(null) }
    var countdownSeconds by remember { mutableIntStateOf(10) }
    var isRetrying by remember { mutableStateOf(false) }
    var retryTrigger by remember { mutableIntStateOf(0) }

    fun isNetworkConnected(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val activeNet = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(activeNet) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun retryLoad() {
        isRetrying = true
        currentLoadFailedError = null
        countdownSeconds = 10
        webViewRef?.let { wv ->
            wv.stopLoading()
            wv.loadUrl(url)
        }
    }

    // Auto-retry periodic countdown timer
    LaunchedEffect(displayedError, retryTrigger) {
        if (displayedError != null) {
            countdownSeconds = 10
            while (isActive && countdownSeconds > 0) {
                delay(1000L)
                countdownSeconds -= 1
            }
            if (isActive && countdownSeconds == 0) {
                retryLoad()
            }
        }
    }

    // Network availability listener: immediately trigger reload when internet reconnects
    DisposableEffect(context) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (displayedError != null) {
                    webViewRef?.post {
                        retryLoad()
                    }
                }
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        try {
            cm?.registerNetworkCallback(request, callback)
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to register network callback: ${t.message}")
        }
        onDispose {
            try {
                cm?.unregisterNetworkCallback(callback)
            } catch (t: Throwable) {
                Log.w(TAG, "Failed to unregister network callback: ${t.message}")
            }
        }
    }

    LaunchedEffect(url) {
        currentLoadFailedError = null
        displayedError = null
        if (!isNetworkConnected()) {
            val offlineError = WebErrorClassifier.classify(
                errorCode = WebErrorClassifier.ERROR_HOST_LOOKUP,
                description = "net::ERR_INTERNET_DISCONNECTED",
                failingUrl = url,
                isNetworkConnected = false
            )
            currentLoadFailedError = offlineError
            displayedError = offlineError
        }
    }

    fun dispatchInsetsToWebView(wv: WebView?) {
        if (wv == null) return
        val rawInsets = ViewCompat.getRootWindowInsets(wv)?.toWindowInsets()
            ?: wv.context.findActivity()?.window?.decorView?.rootWindowInsets
        if (rawInsets != null) {
            wv.dispatchApplyWindowInsets(rawInsets)
        }
    }

    fun applyPageZoom(view: WebView?, zoomPercent: Int) {
        if (view == null) return
        val zoomFactor = zoomPercent / 100.0
        val inverse = if (zoomFactor > 0) 1.0 / zoomFactor else 1.0
        val widthVw = inverse * 100.0
        val heightVh = inverse * 100.0
        val js = """
            (function() {
                try {
                    const zoomFactor = $zoomFactor;
                    let target = document.head || document.documentElement;
                    if (!target) return;
                    let zoomStyle = document.getElementById('kiosk-display-zoom-style');
                    if (!zoomStyle) {
                        zoomStyle = document.createElement('style');
                        zoomStyle.id = 'kiosk-display-zoom-style';
                        target.appendChild(zoomStyle);
                    }
                    if (Math.abs(zoomFactor - 1.0) < 0.01) {
                        zoomStyle.innerHTML = '';
                    } else {
                        zoomStyle.innerHTML = 'html { zoom: ' + zoomFactor + ' !important; width: ${widthVw}vw !important; min-height: ${heightVh}vh !important; height: ${heightVh}vh !important; } body { zoom: normal !important; width: 100% !important; min-height: 100% !important; height: 100% !important; }';
                    }
                    if (document.body) {
                        document.body.style.zoom = '';
                    }
                } catch(e) {}
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }

    fun injectStatusBarInsets(view: WebView?) {
        if (view == null) return
        if (!injectStatusBarPadding || statusBarHeightDp <= 0) {
            val clearJs = """
                (function() {
                    try {
                        if (window.__kioskSafeAreaObserver) {
                            window.__kioskSafeAreaObserver.disconnect();
                            window.__kioskSafeAreaObserver = null;
                        }
                        if (window.__kioskSafeAreaInterval) {
                            clearInterval(window.__kioskSafeAreaInterval);
                            window.__kioskSafeAreaInterval = null;
                        }
                        function cleanDoc(doc) {
                            if (!doc) return;
                            const s = doc.getElementById('kiosk-safe-area-style');
                            if (s) s.remove();
                            if (doc.documentElement) {
                                doc.documentElement.style.removeProperty('--safe-area-inset-top');
                                doc.documentElement.style.removeProperty('--safe-area-inset-bottom');
                                doc.documentElement.style.removeProperty('--safe-area-inset-left');
                                doc.documentElement.style.removeProperty('--safe-area-inset-right');
                                doc.documentElement.style.removeProperty('--app-safe-area-inset-top');
                                doc.documentElement.style.removeProperty('--app-safe-area-inset-bottom');
                                doc.documentElement.style.removeProperty('--app-safe-area-inset-left');
                                doc.documentElement.style.removeProperty('--app-safe-area-inset-right');
                                doc.documentElement.style.removeProperty('--status-bar-height');
                            }
                        }
                        cleanDoc(document);
                    } catch(e) {}
                })();
            """.trimIndent()
            view.evaluateJavascript(clearJs, null)
            return
        }

        val js = """
            (function() {
                try {
                    const top = $statusBarHeightDp;
                    const bottom = $navBarHeightDp;
                    const left = $cutoutLeftDp;
                    const right = $cutoutRightDp;
                    const topPx = top + 'px';
                    const bottomPx = bottom + 'px';
                    const leftPx = left + 'px';
                    const rightPx = right + 'px';

                    function applyToDoc(doc, isIframe) {
                        if (!doc || !doc.documentElement) return;
                        const root = doc.documentElement;
                        if (root.style.getPropertyValue('--safe-area-inset-top') !== topPx) {
                            root.style.setProperty('--safe-area-inset-top', topPx);
                            root.style.setProperty('--safe-area-inset-bottom', bottomPx);
                            root.style.setProperty('--safe-area-inset-left', leftPx);
                            root.style.setProperty('--safe-area-inset-right', rightPx);
                            root.style.setProperty('--app-safe-area-inset-top', topPx);
                            root.style.setProperty('--app-safe-area-inset-bottom', bottomPx);
                            root.style.setProperty('--app-safe-area-inset-left', leftPx);
                            root.style.setProperty('--app-safe-area-inset-right', rightPx);
                            root.style.setProperty('--status-bar-height', topPx);
                        }

                        let styleEl = doc.getElementById('kiosk-safe-area-style');
                        const isHomeAssistant = !!doc.querySelector('home-assistant');
                        let cssRules = ':root { ' +
                            '--safe-area-inset-top: ' + topPx + ' !important; ' +
                            '--safe-area-inset-bottom: ' + bottomPx + ' !important; ' +
                            '--safe-area-inset-left: ' + leftPx + ' !important; ' +
                            '--safe-area-inset-right: ' + rightPx + ' !important; ' +
                            '--app-safe-area-inset-top: ' + topPx + ' !important; ' +
                            '--app-safe-area-inset-bottom: ' + bottomPx + ' !important; ' +
                            '--app-safe-area-inset-left: ' + leftPx + ' !important; ' +
                            '--app-safe-area-inset-right: ' + rightPx + ' !important; ' +
                            '--status-bar-height: ' + topPx + ' !important; ' +
                            '}';

                        if (isIframe || !isHomeAssistant) {
                            cssRules += ' body { padding-top: ' + topPx + ' !important; }';
                        }

                        if (!styleEl) {
                            styleEl = doc.createElement('style');
                            styleEl.id = 'kiosk-safe-area-style';
                            styleEl.textContent = cssRules;
                            (doc.head || root).appendChild(styleEl);
                        } else if (styleEl.textContent !== cssRules) {
                            styleEl.textContent = cssRules;
                        }
                    }

                    function findIframes(node) {
                        let frames = [];
                        if (!node) return frames;
                        if (node.tagName === 'IFRAME') {
                            frames.push(node);
                        }
                        if (node.shadowRoot) {
                            frames = frames.concat(findIframes(node.shadowRoot));
                        }
                        const children = node.children || [];
                        for (let i = 0; i < children.length; i++) {
                            frames = frames.concat(findIframes(children[i]));
                        }
                        return frames;
                    }

                    function processAll() {
                        applyToDoc(document, false);
                        const frames = findIframes(document.body || document.documentElement);
                        for (let i = 0; i < frames.length; i++) {
                            try {
                                const fDoc = frames[i].contentDocument;
                                if (fDoc) {
                                    applyToDoc(fDoc, true);
                                }
                            } catch(e) {}
                        }
                    }

                    processAll();

                    if (!window.__kioskSafeAreaObserver) {
                        let debounceTimer = null;
                        window.__kioskSafeAreaObserver = new MutationObserver(function() {
                            if (debounceTimer) return;
                            debounceTimer = setTimeout(function() {
                                debounceTimer = null;
                                processAll();
                            }, 250);
                        });
                        window.__kioskSafeAreaObserver.observe(document.documentElement, {
                            childList: true,
                            subtree: true
                        });
                    }

                    if (!window.__kioskSafeAreaInterval) {
                        let runCount = 0;
                        window.__kioskSafeAreaInterval = setInterval(function() {
                            processAll();
                            runCount++;
                            if (runCount >= 10) {
                                clearInterval(window.__kioskSafeAreaInterval);
                                window.__kioskSafeAreaInterval = null;
                            }
                        }, 500);
                    }
                } catch(e) {}
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }

    fun injectThemeSupport(view: WebView?, dark: Boolean) {
        if (view == null) return
        val scheme = if (dark) "dark" else "light"
        val js = """
            (function() {
                try {
                    let meta = document.querySelector('meta[name="color-scheme"]');
                    if (!meta) {
                        meta = document.createElement('meta');
                        meta.name = 'color-scheme';
                        let target = document.head || document.documentElement;
                        if (target) target.appendChild(meta);
                    }
                    if (meta) {
                        meta.content = '$scheme';
                    }
                    if (document.documentElement) {
                        document.documentElement.style.colorScheme = '$scheme';
                    }
                } catch(e) {}
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }

    @Suppress("DEPRECATION")
    fun applyTheme(view: WebView?, dark: Boolean) {
        if (view == null) return
        val settings = view.settings

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)
        ) {
            try {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, dark)
            } catch (t: Throwable) {
                Log.w(TAG, "Algorithmic darkening not supported on this device: ${t.message}")
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            try {
                val forceDarkValue = if (dark) {
                    WebSettingsCompat.FORCE_DARK_ON
                } else {
                    WebSettingsCompat.FORCE_DARK_OFF
                }
                WebSettingsCompat.setForceDark(settings, forceDarkValue)

                if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
                    WebSettingsCompat.setForceDarkStrategy(
                        settings,
                        WebSettingsCompat.DARK_STRATEGY_PREFER_WEB_THEME_OVER_USER_AGENT_DARKENING
                    )
                }
            } catch (t: Throwable) {
                Log.w(TAG, "Force dark not supported: ${t.message}")
            }
        }

        injectThemeSupport(view, dark)
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .imePadding()
    ) {
        key(isDark) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    val nightModeFlag = if (isDark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
                    val themedConfig = Configuration(context.resources.configuration).apply {
                        uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or nightModeFlag
                    }
                    val configContext = context.createConfigurationContext(themedConfig)
                    val themeResId = if (isDark) {
                        com.jacek.test.app.R.style.Theme_TestAppIntegrator_Dark
                    } else {
                        com.jacek.test.app.R.style.Theme_TestAppIntegrator_Light
                    }
                    val themedContext = ContextThemeWrapper(configContext, themeResId)

                    WebView(themedContext).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )

                    if (com.jacek.test.app.BuildConfig.DEBUG) {
                        WebView.setWebContentsDebuggingEnabled(true)
                    }

                    // Modern WebSettings configuration
                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        mediaPlaybackRequiresUserGesture = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                        safeBrowsingEnabled = true
                        useWideViewPort = true
                        loadWithOverviewMode = true
                        builtInZoomControls = true
                        displayZoomControls = false
                        cacheMode = WebSettings.LOAD_DEFAULT
                        allowFileAccess = false
                        allowContentAccess = false
                        textZoom = 100 // Keep font scale proportional with display zoom
                    }

                    setInitialScale(pageZoom)

                    // AndroidX WebKit modern feature support
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
                        WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
                    }

                    addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                        override fun onViewAttachedToWindow(v: View) {
                            dispatchInsetsToWebView(this@apply)
                        }
                        override fun onViewDetachedFromWindow(v: View) {}
                    })

                    applyTheme(this, isDark)
                    lastAppliedDark = isDark

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): Boolean {
                            val targetUri = request?.url ?: return false
                            val targetUrl = targetUri.toString()
                            val scheme = targetUri.scheme?.lowercase()
                            return if (scheme == "http" || scheme == "https") {
                                if (!isUrlAllowed(targetUrl)) {
                                    Log.w(TAG, "Navigation blocked: $targetUrl not in allowed list")
                                    onBlockedUrl(targetUrl)
                                    true
                                } else {
                                    false // Open inside WebView
                                }
                            } else {
                                Log.i(TAG, "Custom URI requested: $targetUri")
                                false
                            }
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                            isLoading = true
                            currentLoadFailedError = null
                            dispatchInsetsToWebView(view)
                            injectStatusBarInsets(view)
                            applyPageZoom(view, pageZoom)
                            injectThemeSupport(view, isDark)
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            isLoading = false
                            isRetrying = false
                            if (currentLoadFailedError == null) {
                                displayedError = null
                                onPageTitleChanged(view?.title)
                            } else {
                                displayedError = currentLoadFailedError
                                countdownSeconds = 10
                            }
                            dispatchInsetsToWebView(view)
                            injectStatusBarInsets(view)
                            applyPageZoom(view, pageZoom)
                            injectThemeSupport(view, isDark)
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: WebResourceError?
                        ) {
                            super.onReceivedError(view, request, error)
                            if (request?.isForMainFrame == true) {
                                val description = error?.description?.toString() ?: "Unknown error"
                                Log.e(TAG, "WebView error loading main frame: $description")
                                val errorInfo = WebErrorClassifier.classify(
                                    errorCode = error?.errorCode,
                                    description = description,
                                    failingUrl = request.url?.toString() ?: url,
                                    isNetworkConnected = isNetworkConnected()
                                )
                                currentLoadFailedError = errorInfo
                                displayedError = errorInfo
                                countdownSeconds = 10
                                onError(description)
                            }
                        }

                        override fun onReceivedHttpError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            errorResponse: WebResourceResponse?
                        ) {
                            super.onReceivedHttpError(view, request, errorResponse)
                            if (request?.isForMainFrame == true) {
                                val statusCode = errorResponse?.statusCode ?: 0
                                if (statusCode >= 400 && statusCode != 401 && statusCode != 403) {
                                    val errorInfo = WebErrorClassifier.classifyHttpError(
                                        statusCode = statusCode,
                                        failingUrl = request.url?.toString() ?: url
                                    )
                                    currentLoadFailedError = errorInfo
                                    displayedError = errorInfo
                                    countdownSeconds = 10
                                    onError("HTTP $statusCode: ${errorResponse?.reasonPhrase}")
                                }
                            }
                        }

                        override fun onReceivedSslError(
                            view: WebView?,
                            handler: SslErrorHandler?,
                            error: SslError?
                        ) {
                            super.onReceivedSslError(view, handler, error)
                            val errorInfo = WebErrorInfo(
                                errorType = WebErrorType.SslError(error?.toString()),
                                failingUrl = error?.url ?: url,
                                rawDescription = error?.toString()
                            )
                            currentLoadFailedError = errorInfo
                            displayedError = errorInfo
                            countdownSeconds = 10
                            handler?.cancel()
                            onError("SSL error: $error")
                        }

                        override fun onRenderProcessGone(
                            view: WebView?,
                            detail: RenderProcessGoneDetail?
                        ): Boolean {
                            Log.e(TAG, "WebView render process gone. Did crash: ${detail?.didCrash()}")
                            view?.destroy()
                            return true
                        }
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView?, newProgress: Int) {
                            super.onProgressChanged(view, newProgress)
                            progress = newProgress
                            isLoading = newProgress < 100
                            if (newProgress > 50) {
                                dispatchInsetsToWebView(view)
                                injectStatusBarInsets(view)
                                applyPageZoom(view, pageZoom)
                                injectThemeSupport(view, isDark)
                            }
                        }

                        override fun onReceivedTitle(view: WebView?, title: String?) {
                            super.onReceivedTitle(view, title)
                            onPageTitleChanged(title)
                        }

                        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                            Log.d(TAG, "JS [${consoleMessage?.messageLevel()}]: ${consoleMessage?.message()} (line ${consoleMessage?.lineNumber()})")
                            return true
                        }
                    }

                    loadUrl(url)
                    webViewRef = this
                    onWebViewCreated(this)
                }
            },
            update = { webView ->
                if (webView.url != url && url.isNotBlank()) {
                    currentLoadFailedError = null
                    displayedError = null
                    webView.loadUrl(url)
                }
                if (lastAppliedZoom != pageZoom) {
                    lastAppliedZoom = pageZoom
                    webView.setInitialScale(pageZoom)
                    applyPageZoom(webView, pageZoom)
                }
                if (lastAppliedDark != isDark) {
                    lastAppliedDark = isDark
                    applyTheme(webView, isDark)
                }
                dispatchInsetsToWebView(webView)
                injectStatusBarInsets(webView)
            }
        )
    }

        AnimatedVisibility(
            visible = isLoading,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
        ) {
            LinearProgressIndicator(
                progress = { progress / 100f },
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.primary
            )
        }

        AnimatedVisibility(
            visible = displayedError != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize()
        ) {
            displayedError?.let { err ->
                KioskErrorOverlay(
                    errorInfo = err,
                    countdownSeconds = countdownSeconds,
                    isRetrying = isRetrying,
                    onRetry = {
                        retryTrigger++
                        retryLoad()
                    }
                )
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webViewRef?.let { wv ->
                wv.stopLoading()
                wv.clearHistory()
                wv.removeAllViews()
                wv.destroy()
            }
        }
    }
}
