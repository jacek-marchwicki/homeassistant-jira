package com.jacek.test.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.jacek.test.app.data.KioskPreferences
import com.jacek.test.app.data.WebDataManager
import com.jacek.test.app.service.ScreenStateService
import com.jacek.test.app.ui.KioskActivity
import com.jacek.test.app.ui.MainConfigScreen
import com.jacek.test.app.ui.WebPreviewScreen

class MainActivity : ComponentActivity() {

    private lateinit var preferences: KioskPreferences

    private var hasOverlayPermission by mutableStateOf(false)
    private var hasNotificationPermission by mutableStateOf(false)
    private var isServiceRunning by mutableStateOf(false)
    private var currentUrl by mutableStateOf("")
    private var pageZoom by mutableIntStateOf(100)
    private var injectStatusBarPadding by mutableStateOf(true)
    private var restrictUrls by mutableStateOf(false)
    private var allowedDomains by mutableStateOf<Set<String>>(emptySet())
    private var keepScreenOn by mutableStateOf(false)
    private var showFloatingExit by mutableStateOf(true)

    private var currentScreen by mutableStateOf<Screen>(Screen.Config)

    sealed interface Screen {
        object Config : Screen
        object Preview : Screen
    }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            hasNotificationPermission = isGranted
            if (isGranted && preferences.isServiceEnabled) {
                startKioskService()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferences = KioskPreferences(this)
        loadPreferencesState()

        enableEdgeToEdge()

        setContent {
            val statusBarHeightDp = WindowInsets.statusBars.asPaddingValues().calculateTopPadding().value.toInt()

            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    when (currentScreen) {
                        Screen.Config -> {
                            MainConfigScreen(
                                currentUrl = currentUrl,
                                pageZoom = pageZoom,
                                injectStatusBarPadding = injectStatusBarPadding,
                                restrictUrls = restrictUrls,
                                allowedDomains = allowedDomains,
                                hasOverlayPermission = hasOverlayPermission,
                                hasNotificationPermission = hasNotificationPermission,
                                isServiceRunning = isServiceRunning,
                                keepScreenOn = keepScreenOn,
                                showFloatingExit = showFloatingExit,
                                onSaveUrl = { newUrl ->
                                    preferences.kioskUrl = newUrl
                                    currentUrl = preferences.kioskUrl
                                    Toast.makeText(this, "URL Saved", Toast.LENGTH_SHORT).show()
                                },
                                onChangeZoom = { newZoom ->
                                    preferences.pageZoom = newZoom
                                    pageZoom = newZoom
                                },
                                onToggleStatusBarPadding = { enabled ->
                                    preferences.injectStatusBarPadding = enabled
                                    injectStatusBarPadding = enabled
                                },
                                onToggleRestrictUrls = { enabled ->
                                    preferences.restrictUrls = enabled
                                    restrictUrls = enabled
                                },
                                onAddAllowedDomain = { domain ->
                                    val updated = allowedDomains + domain
                                    preferences.allowedDomains = updated
                                    allowedDomains = updated
                                },
                                onRemoveAllowedDomain = { domain ->
                                    val updated = allowedDomains - domain
                                    preferences.allowedDomains = updated
                                    allowedDomains = updated
                                },
                                onRequestOverlayPermission = { requestOverlayPermission() },
                                onRequestNotificationPermission = { requestNotificationPermission() },
                                onToggleService = { enabled ->
                                    preferences.isServiceEnabled = enabled
                                    if (enabled) {
                                        if (!Settings.canDrawOverlays(this)) {
                                            requestOverlayPermission()
                                        } else {
                                            startKioskService()
                                        }
                                    } else {
                                        stopKioskService()
                                    }
                                },
                                onToggleKeepScreenOn = { enabled ->
                                    preferences.keepScreenOn = enabled
                                    keepScreenOn = enabled
                                },
                                onToggleShowFloatingExit = { enabled ->
                                    preferences.showFloatingExit = enabled
                                    showFloatingExit = enabled
                                },
                                onOpenWebpage = { currentScreen = Screen.Preview },
                                onLaunchKioskDirectly = { launchKioskDirectly() },
                                onClearWebCache = {
                                    WebDataManager.clearWebCache(this@MainActivity) {
                                        Toast.makeText(this@MainActivity, "Web cache cleared", Toast.LENGTH_SHORT).show()
                                    }
                                },
                                onClearWebAppData = {
                                    WebDataManager.clearWebAppData(this@MainActivity) {
                                        Toast.makeText(this@MainActivity, "Web app data (cookies & storage) cleared", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            )
                        }
                        Screen.Preview -> {
                            WebPreviewScreen(
                                url = currentUrl,
                                pageZoom = pageZoom,
                                injectStatusBarPadding = injectStatusBarPadding,
                                statusBarHeightDp = statusBarHeightDp,
                                isUrlAllowed = { targetUrl -> preferences.isUrlAllowed(targetUrl) },
                                onBack = { currentScreen = Screen.Config }
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        checkPermissions()
        loadPreferencesState()
        if (preferences.isServiceEnabled && hasOverlayPermission && hasNotificationPermission) {
            startKioskService()
        }
    }

    private fun loadPreferencesState() {
        currentUrl = preferences.kioskUrl
        pageZoom = preferences.pageZoom
        injectStatusBarPadding = preferences.injectStatusBarPadding
        restrictUrls = preferences.restrictUrls
        allowedDomains = preferences.allowedDomains
        keepScreenOn = preferences.keepScreenOn
        showFloatingExit = preferences.showFloatingExit
        isServiceRunning = preferences.isServiceEnabled
    }

    private fun checkPermissions() {
        hasOverlayPermission = Settings.canDrawOverlays(this)
        hasNotificationPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun requestOverlayPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun startKioskService() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Overlay permission required", Toast.LENGTH_SHORT).show()
            return
        }
        val intent = Intent(this, ScreenStateService::class.java)
        ContextCompat.startForegroundService(this, intent)
        isServiceRunning = true
    }

    private fun stopKioskService() {
        val intent = Intent(this, ScreenStateService::class.java)
        stopService(intent)
        isServiceRunning = false
    }

    private fun launchKioskDirectly() {
        val intent = Intent(this, KioskActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        startActivity(intent)
    }
}
