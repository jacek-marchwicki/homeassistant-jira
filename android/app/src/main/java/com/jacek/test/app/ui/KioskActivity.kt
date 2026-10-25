package com.jacek.test.app.ui

import android.app.KeyguardManager
import android.content.Context
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.jacek.test.app.data.KioskPreferences
import com.jacek.test.app.ui.components.ModernKioskWebView

private const val TAG = "KioskActivity"

class KioskActivity : ComponentActivity() {

    private lateinit var preferences: KioskPreferences
    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferences = KioskPreferences(this)

        // Show when locked (Android 8.1+ / Android 16+)
        setShowWhenLocked(true)

        // Do NOT call setTurnScreenOn(true) so that turning the screen off keeps the screen off.
        setTurnScreenOn(false)

        if (preferences.keepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        enableEdgeToEdge()

        // Handle physical back button / back gesture
        onBackPressedDispatcher.addCallback(this) {
            val wv = webView
            if (wv != null && wv.canGoBack()) {
                wv.goBack()
            } else {
                unlockAndExit()
            }
        }

        setContent {
            val statusBarHeightDp = WindowInsets.statusBars.asPaddingValues().calculateTopPadding().value.toInt()

            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    KioskScreen(
                        url = preferences.kioskUrl,
                        pageZoom = preferences.pageZoom,
                        injectStatusBarPadding = preferences.injectStatusBarPadding,
                        statusBarHeightDp = statusBarHeightDp,
                        showFloatingExit = preferences.showFloatingExit,
                        isUrlAllowed = { targetUrl -> preferences.isUrlAllowed(targetUrl) },
                        onBlockedUrl = { blockedUrl ->
                            Toast.makeText(
                                this,
                                "Navigation to $blockedUrl is blocked by kiosk policy",
                                Toast.LENGTH_SHORT
                            ).show()
                        },
                        onWebViewCreated = { wv -> webView = wv },
                        onUnlockClicked = { unlockAndExit() },
                        onReloadClicked = { webView?.reload() }
                    )
                }
            }
        }
    }

    private fun unlockAndExit() {
        Log.d(TAG, "Requesting keyguard dismissal (bouncer)")
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (keyguardManager == null || !keyguardManager.isKeyguardLocked) {
            Log.i(TAG, "Keyguard is not locked or manager unavailable. Finishing KioskActivity.")
            finish()
            return
        }

        keyguardManager.requestDismissKeyguard(
            this,
            object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    super.onDismissSucceeded()
                    Log.i(TAG, "Keyguard dismiss succeeded. Exiting KioskActivity.")
                    finish()
                }

                override fun onDismissCancelled() {
                    super.onDismissCancelled()
                    Log.i(TAG, "Keyguard dismiss cancelled by user. Staying in KioskActivity.")
                }

                override fun onDismissError() {
                    super.onDismissError()
                    Log.e(TAG, "Keyguard dismiss encountered an error. Finishing.")
                    finish()
                }
            }
        )
    }
}

@Composable
fun KioskScreen(
    url: String,
    pageZoom: Int,
    injectStatusBarPadding: Boolean,
    statusBarHeightDp: Int,
    showFloatingExit: Boolean,
    isUrlAllowed: (String) -> Boolean,
    onBlockedUrl: (String) -> Unit,
    onWebViewCreated: (WebView) -> Unit,
    onUnlockClicked: () -> Unit,
    onReloadClicked: () -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        ModernKioskWebView(
            url = url,
            pageZoom = pageZoom,
            injectStatusBarPadding = injectStatusBarPadding,
            statusBarHeightDp = statusBarHeightDp,
            isUrlAllowed = isUrlAllowed,
            onBlockedUrl = onBlockedUrl,
            modifier = Modifier.fillMaxSize(),
            onWebViewCreated = onWebViewCreated
        )

        AnimatedVisibility(
            visible = showFloatingExit,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .imePadding()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier
                    .background(
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                        shape = RoundedCornerShape(24.dp)
                    )
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                FilledTonalButton(
                    onClick = onReloadClicked,
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Reload"
                    )
                }

                ElevatedButton(
                    onClick = onUnlockClicked,
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.elevatedButtonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.LockOpen,
                        contentDescription = null
                    )
                    Text(
                        text = "Unlock",
                        modifier = Modifier.padding(start = 6.dp)
                    )
                }
            }
        }
    }
}
