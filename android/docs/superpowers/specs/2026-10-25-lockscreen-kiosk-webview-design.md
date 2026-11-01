# Architecture Design Spec: Lockscreen Kiosk with Modern WebView (Android 16+)

## 1. Overview
This project implements an Android lockscreen kiosk web application targeting Android 16+ (API 36+), adhering to the architecture described in `conversation.pdf`. The application allows displaying a configurable web page on top of the lockscreen without requiring a device unlock or device owner provisioning, while allowing authorized users to dismiss the kiosk to the normal launcher by verifying standard device security (PIN, pattern, or biometric) via the system Bouncer.

## 2. Architecture & Components

```
+-------------------------------------------------------------+
|                        MainActivity                         |
|  - Kiosk URL input & persistence (KioskPreferences)         |
|  - Kiosk service toggle (start / stop ScreenStateService)   |
|  - Permission status & triggers:                            |
|      * Overlay (Settings.ACTION_MANAGE_OVERLAY_PERMISSION)  |
|      * POST_NOTIFICATIONS                                   |
|  - "Open Webpage" preview screen (modern WebView)           |
|  - "Launch Kiosk Directly" test action                      |
+-------------------------------------------------------------+
                              | (configures / controls)
                              v
+-------------------------------------------------------------+
|                     ScreenStateService                      |
|  - Foreground Service (type: specialUse)                    |
|  - Dynamic BroadcastReceiver:                               |
|      * ACTION_SCREEN_OFF -> launch KioskActivity            |
|      * ACTION_SCREEN_ON  -> check isKeyguardLocked          |
|                             -> launch KioskActivity         |
|  - Persistent foreground notification with Action:          |
|      "Open Kiosk" -> sends Broadcast to RelaunchReceiver    |
+-------------------------------------------------------------+
                              | (launches on screen off / on)
                              v
+-------------------------------------------------------------+
|                       KioskActivity                         |
|  - android:showWhenLocked="true"                            |
|  - android:launchMode="singleInstance"                      |
|  - android:excludeFromRecents="true"                        |
|  - Calls setShowWhenLocked(true)                            |
|  - NO turnScreenOn (avoids waking screen on screen-off)     |
|  - Fullscreen Modern WebView (AndroidX WebKit)              |
|  - Exit & Unlock flow:                                      |
|      * KeyguardManager.requestDismissKeyguard               |
|      * Handles OnBackPressedDispatcher & on-screen button   |
|      * On success: finish() -> reveals Launcher             |
|      * On cancel: remains in Kiosk                          |
+-------------------------------------------------------------+
```

## 3. Detailed Component Specifications

### 3.1. Target SDK & Platform Configuration
- `compileSdk = 36` (Android 16)
- `targetSdk = 36` (Android 16)
- `minSdk = 26` (Android 8.0)
- Dependencies:
  - `androidx.webkit:webkit:1.12.1` for modern WebViewCompat and WebSettingsCompat APIs.
  - Jetpack Compose (BOM 2025.02.00) & Material 3.
  - Core KTX & Lifecycle Runtime KTX.

### 3.2. Manifest Configuration & Permissions
Permissions required:
- `android.permission.INTERNET`
- `android.permission.ACCESS_NETWORK_STATE`
- `android.permission.SYSTEM_ALERT_WINDOW` (Required to start activity from background on `ACTION_SCREEN_OFF` / `ACTION_SCREEN_ON`)
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_SPECIAL_USE` (For Android 14+ FGS requirements)
- `android.permission.POST_NOTIFICATIONS`

Service Manifest declaration:
```xml
<service
    android:name=".service.ScreenStateService"
    android:foregroundServiceType="specialUse"
    android:exported="false">
    <property
        android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        android:value="kiosk_lockscreen_monitor" />
</service>
<receiver
    android:name=".receiver.RelaunchReceiver"
    android:exported="false" />
```

Activity Manifest declarations:
- `MainActivity`: Standard exported launcher activity.
- `KioskActivity`:
  - `android:showWhenLocked="true"`
  - `android:launchMode="singleInstance"`
  - `android:excludeFromRecents="true"`
  - `android:exported="false"`
  - `android:configChanges="orientation|screenSize|screenLayout|keyboardHidden"`

### 3.3. Preferences & State (`KioskPreferences`)
Stores configuration in SharedPreferences:
- `kiosk_url`: String (default: `https://www.google.com` or custom web dashboard URL)
- `service_enabled`: Boolean (default: `false`)
- `keep_screen_on`: Boolean (default: `false`)
- `show_exit_button`: Boolean (default: `true`)

### 3.4. Background Service & Receiver Flow (`ScreenStateService`)
1. On start:
   - Posts persistent notification with channel `kiosk_service_channel`.
   - Notification contains action `Open Kiosk` hooked to `PendingIntent.getBroadcast(context, 0, Intent(context, RelaunchReceiver::class.java), ...)`.
   - Registers dynamic receiver for `Intent.ACTION_SCREEN_OFF` and `Intent.ACTION_SCREEN_ON` using `ContextCompat.registerReceiver(..., ContextCompat.RECEIVER_NOT_EXPORTED)`.
2. On `ACTION_SCREEN_OFF`:
   - Checks `Settings.canDrawOverlays(this)`.
   - Starts `KioskActivity` with flags `Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP`.
3. On `ACTION_SCREEN_ON`:
   - Checks `KeyguardManager.isKeyguardLocked`.
   - If locked, launches `KioskActivity` with the same flags, restoring the kiosk if dismissed without unlock.
4. On destroy:
   - Unregisters receiver.

### 3.5. Lockscreen Kiosk Activity (`KioskActivity`)
1. Lifecycle & Window setup:
   - `setShowWhenLocked(true)`.
   - Explicitly does NOT call `setTurnScreenOn(true)` (preserves screen sleep state).
   - Configures `FLAG_KEEP_SCREEN_ON` if enabled in preferences.
2. Web View Setup (Modern API):
   - `WebSettings`:
     - `javaScriptEnabled = true`
     - `domStorageEnabled = true`
     - `databaseEnabled = true`
     - `mediaPlaybackRequiresUserGesture = false`
     - `mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW`
     - `safeBrowsingEnabled = true`
   - AndroidX WebKit feature detection:
     - `WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)`
   - Back handling:
     - `OnBackPressedDispatcher`: If `webView.canGoBack()`, navigates back. Otherwise triggers `unlockAndExit()`.
3. Keyguard Dismissal:
   - On exit button click or Back press at root of history:
     ```kotlin
     keyguardManager.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
         override fun onDismissSucceeded() {
             super.onDismissSucceeded()
             finish()
         }
         override fun onDismissCancelled() {
             super.onDismissCancelled()
         }
     })
     ```

### 3.6. Configuration & Main App UI (`MainActivity`)
Compose UI with:
1. Status card:
   - Overlay permission granted / missing (with button to launch `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`).
   - Notification permission granted / missing (with permission request launcher).
   - Kiosk Service active / inactive switch.
2. Settings card:
   - Kiosk URL input with validation and "Save" button.
   - Quick presets (e.g. Google, Home Assistant demo, Wikipedia).
   - Toggles: "Keep screen on in kiosk", "Show floating unlock button".
3. Action buttons:
   - "Open Webpage" -> Displays in-app preview with the modern WebView, plus option to open in system browser.
   - "Launch Kiosk Directly" -> Immediately launches `KioskActivity`.

## 4. Verification & Testing Plan
1. Compile & assemble with Android 16 SDK (`compileSdk = 36`).
2. Install APK onto connected device (`emulator-5554` running Android 16/17 preview).
3. Grant permissions via ADB / UI:
   - `adb shell pm grant com.jacek.test.app android.permission.POST_NOTIFICATIONS`
   - `adb shell appops set com.jacek.test.app SYSTEM_ALERT_WINDOW allow`
4. Test scenarios:
   - Test 1: Configuration app updates URL and opens in-app preview.
   - Test 2: Launch Kiosk directly -> verify WebView loads URL and unlock button triggers keyguard dismiss.
   - Test 3: Turn screen off with `adb shell input keyevent 26` -> verify `KioskActivity` is launched on screen turn off / turn on while device is locked.
   - Test 4: Verify unlocking with standard PIN / gesture dismisses Kiosk to launcher.
