package com.jacek.test.app.ui

import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import android.widget.Toast
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import com.jacek.test.app.data.ThemeMode
import com.jacek.test.app.ui.components.ModernKioskWebView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebPreviewScreen(
    url: String,
    pageZoom: Int = 100,
    injectStatusBarPadding: Boolean = false,
    statusBarHeightDp: Int = 0,
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    isUrlAllowed: (String) -> Boolean = { true },
    onBlockedUrl: (String) -> Unit = {},
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val isDark = themeMode.isDark(isSystemInDarkTheme())
    var pageTitle by remember { mutableStateOf<String?>("Preview") }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = pageTitle ?: url,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back to Config"
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { webViewRef?.reload() }) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Reload"
                        )
                    }
                    IconButton(
                        onClick = {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                            context.startActivity(intent)
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Default.OpenInBrowser,
                            contentDescription = "Open in External Browser"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .imePadding()
        ) {
            ModernKioskWebView(
                url = url,
                pageZoom = pageZoom,
                injectStatusBarPadding = injectStatusBarPadding,
                statusBarHeightDp = statusBarHeightDp,
                isDark = isDark,
                isUrlAllowed = isUrlAllowed,
                onBlockedUrl = { blocked ->
                    Toast.makeText(context, "Blocked navigation to: $blocked", Toast.LENGTH_SHORT).show()
                    onBlockedUrl(blocked)
                },
                modifier = Modifier.fillMaxSize(),
                onWebViewCreated = { webViewRef = it },
                onPageTitleChanged = { pageTitle = it }
            )
        }
    }
}
