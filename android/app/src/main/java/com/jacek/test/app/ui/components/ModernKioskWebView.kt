package com.jacek.test.app.ui.components

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

private const val TAG = "ModernKioskWebView"

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ModernKioskWebView(
    url: String,
    modifier: Modifier = Modifier,
    pageZoom: Int = 100,
    injectStatusBarPadding: Boolean = true,
    statusBarHeightDp: Int = 0,
    isUrlAllowed: (String) -> Boolean = { true },
    onBlockedUrl: (String) -> Unit = {},
    onWebViewCreated: (WebView) -> Unit = {},
    onPageTitleChanged: (String?) -> Unit = {},
    onError: (String) -> Unit = {}
) {
    var progress by remember { mutableIntStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    fun injectStatusBarInsets(view: WebView?) {
        if (!injectStatusBarPadding || view == null || statusBarHeightDp <= 0) return
        val js = """
            (function() {
                try {
                    const top = $statusBarHeightDp;
                    document.documentElement.style.setProperty('--safe-area-inset-top', top + 'px');
                    document.documentElement.style.setProperty('--status-bar-height', top + 'px');
                    let injectedStyle = document.getElementById('kiosk-safe-area-style');
                    if (!injectedStyle) {
                        injectedStyle = document.createElement('style');
                        injectedStyle.id = 'kiosk-safe-area-style';
                        document.head.appendChild(injectedStyle);
                    }
                    const hasViewportFitCover = !!document.querySelector('meta[name="viewport"][content*="viewport-fit=cover"]');
                    if (!hasViewportFitCover) {
                        injectedStyle.innerHTML = 'body { padding-top: ' + top + 'px !important; }';
                    } else {
                        injectedStyle.innerHTML = '';
                    }
                } catch(e) {}
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .imePadding()
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )

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
                        textZoom = pageZoom
                    }

                    setInitialScale(pageZoom)

                    // AndroidX WebKit modern feature support
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
                        WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)
                    ) {
                        try {
                            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true)
                        } catch (t: Throwable) {
                            Log.w(TAG, "Algorithmic darkening not supported on this device: ${t.message}")
                        }
                    }

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
                            injectStatusBarInsets(view)
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            isLoading = false
                            onPageTitleChanged(view?.title)
                            injectStatusBarInsets(view)
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
                                onError(description)
                            }
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
                            if (newProgress > 60) {
                                injectStatusBarInsets(view)
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
                    webView.loadUrl(url)
                }
                if (webView.settings.textZoom != pageZoom) {
                    webView.settings.textZoom = pageZoom
                    webView.setInitialScale(pageZoom)
                }
                injectStatusBarInsets(webView)
            }
        )

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
