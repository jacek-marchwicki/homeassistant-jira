# Lockscreen Kiosk with Modern WebView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install an Android 16+ lockscreen kiosk application with modern WebView support, configurable URL, keyguard dismissal to system bouncer, and background screen-off/screen-on handling via a foreground service.

**Architecture:** A foreground service (`ScreenStateService`) with `specialUse` type listens for `ACTION_SCREEN_OFF` and `ACTION_SCREEN_ON` (when locked) to automatically start `KioskActivity` (`showWhenLocked="true"`) using `SYSTEM_ALERT_WINDOW`. `KioskActivity` renders a modern AndroidX WebView and exits back to launcher by calling `KeyguardManager.requestDismissKeyguard` when back or exit is pressed. `MainActivity` provides kiosk settings (URL, toggles), permission launchers, in-app web preview, and direct kiosk launch.

**Tech Stack:** Kotlin 2.1, Jetpack Compose (BOM 2025.02.00) & Material 3, AndroidX WebKit (`androidx.webkit:webkit:1.12.1`), Android 16 (API 36).

**Spec:** `docs/superpowers/specs/2026-10-25-lockscreen-kiosk-webview-design.md`

## Global Constraints
- Target SDK: 36 (Android 16)
- Compile SDK: 36 (Android 16)
- Min SDK: 26 (Android 8.0)
- `KioskActivity` must have `android:showWhenLocked="true"`, `launchMode="singleInstance"`, `excludeFromRecents="true"`.
- Do NOT use `android:turnScreenOn="true"` or `setTurnScreenOn(true)` in `KioskActivity` to avoid turning the screen back on when power button turns it off.
- The app must be deployed and verified on attached tablet `HA2BXNQC` (Lenovo Tab TB361FU, Android 16 / API 36).

## Review Focus
1. Invalid or missing URL scheme: entering `example.com` without `https://` should auto-prefix `https://`.
2. Overlay permission missing: attempting to start the background service or kiosk from background when `SYSTEM_ALERT_WINDOW` is not granted should guide the user to system settings instead of crashing.
3. Rapid screen power toggle: `launchLockScreenActivity` must use `FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_SINGLE_TOP or FLAG_ACTIVITY_CLEAR_TOP` to prevent multiple activity instances.
4. WebView navigation history: Back press inside `KioskActivity` must navigate back in web history if `canGoBack()` is true before prompting system PIN bouncer.
5. Keyguard cancel: If user cancels the system PIN prompt (Bouncer), the app must remain in `KioskActivity` without finishing.

---

### Task 1: Project & Dependency Setup (Android 16 & AndroidX WebKit)

**Files:**
- Modify: `app/build.gradle.kts`
- Modify: `gradle/libs.versions.toml`
- Modify: `app/src/main/AndroidManifest.xml`

- [ ] **Step 1.1: Add WebKit dependency and configure SDK 36**
  Update `gradle/libs.versions.toml` to add `androidx-webkit = { group = "androidx.webkit", name = "webkit", version = "1.12.1" }`.
  Update `app/build.gradle.kts` to set `compileSdk = 36`, `targetSdk = 36`, and add `implementation(libs.androidx.webkit)`.
- [ ] **Step 1.2: Add permissions and components to `AndroidManifest.xml`**
  Declare:
  - `INTERNET`
  - `ACCESS_NETWORK_STATE`
  - `SYSTEM_ALERT_WINDOW`
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_SPECIAL_USE`
  - `POST_NOTIFICATIONS`
  Declare `KioskActivity`, `ScreenStateService` with `foregroundServiceType="specialUse"` and property `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE`, and `RelaunchReceiver`.
- [ ] **Step 1.3: Verify Gradle builds successfully**
  Run `./gradlew assembleDebug` to confirm build succeeds with API 36 and WebKit library.
- [ ] **Step 1.4: Commit changes**
  Commit Task 1 changes with git.

---

### Task 2: Preferences & State Management (`KioskPreferences`)

**Files:**
- Create: `app/src/main/java/com/jacek/test/app/data/KioskPreferences.kt`
- Create: `app/src/test/java/com/jacek/test/app/data/KioskPreferencesTest.kt`

- [ ] **Step 2.1: Write unit test for URL formatting and preferences logic**
  Create test verifying URL normalization (e.g. prepending `https://` if scheme is missing) and default values.
- [ ] **Step 2.2: Implement `KioskPreferences`**
  Implement `KioskPreferences` encapsulating `SharedPreferences` with:
  - `kioskUrl`: getter/setter with automatic `https://` normalization. Default: `https://www.google.com`.
  - `isServiceEnabled`: getter/setter for foreground service auto-start.
  - `keepScreenOn`: getter/setter.
  - `showFloatingExit`: getter/setter.
- [ ] **Step 2.3: Run unit tests**
  Execute `./gradlew testDebugUnitTest` and confirm passing.
- [ ] **Step 2.4: Commit changes**
  Commit Task 2 changes with git.

---

### Task 3: Modern WebView Component (`ModernKioskWebView`)

**Files:**
- Create: `app/src/main/java/com/jacek/test/app/ui/components/ModernKioskWebView.kt`

- [ ] **Step 3.1: Implement `ModernKioskWebView` composable**
  Create Compose wrapper around `WebView` configured with:
  - `javaScriptEnabled = true`
  - `domStorageEnabled = true`
  - `databaseEnabled = true`
  - `mediaPlaybackRequiresUserGesture = false`
  - `safeBrowsingEnabled = true`
  - AndroidX `WebViewFeature` checks (e.g., algorithmic darkening / safe browsing).
  - Modern `WebViewClient` handling page loading state and errors.
  - Modern `WebChromeClient` providing progress updates.
  - Expose callbacks for `onPageFinished`, `onProgressChanged`, and pass `webViewInstance` for back navigation checks.
- [ ] **Step 3.2: Verify compile**
  Execute `./gradlew compileDebugKotlin` to verify component compilation.
- [ ] **Step 3.3: Commit changes**
  Commit Task 3 changes with git.

---

### Task 4: Lockscreen Activity (`KioskActivity`)

**Files:**
- Create: `app/src/main/java/com/jacek/test/app/ui/KioskActivity.kt`

- [ ] **Step 4.1: Implement `KioskActivity` lifecycle and keyguard dismissal**
  - Call `setShowWhenLocked(true)`.
  - Apply `FLAG_KEEP_SCREEN_ON` if configured in `KioskPreferences`.
  - Implement `unlockAndExit()` invoking `KeyguardManager.requestDismissKeyguard` with callback:
    - `onDismissSucceeded`: call `finish()`.
    - `onDismissCancelled`: log and stay in activity.
    - `onDismissError`: log and stay in activity.
  - Intercept back button using `onBackPressedDispatcher.addCallback`:
    - If `webView.canGoBack()`, call `webView.goBack()`.
    - Else call `unlockAndExit()`.
- [ ] **Step 4.2: Implement Kiosk UI**
  - Fullscreen `ModernKioskWebView` loading `KioskPreferences.kioskUrl`.
  - Optional discreet floating action bar or floating button with "Unlock" and "Reload" (controlled by `KioskPreferences.showFloatingExit`).
- [ ] **Step 4.3: Verify compile**
  Execute `./gradlew assembleDebug` to verify compilation.
- [ ] **Step 4.4: Commit changes**
  Commit Task 4 changes with git.

---

### Task 5: Foreground Monitoring Service & Relaunch Receiver

**Files:**
- Create: `app/src/main/java/com/jacek/test/app/service/ScreenStateService.kt`
- Create: `app/src/main/java/com/jacek/test/app/receiver/RelaunchReceiver.kt`

- [ ] **Step 5.1: Implement `RelaunchReceiver`**
  `BroadcastReceiver` that triggers `launchLockScreenActivity` when broadcast intent is received (such as from notification action).
- [ ] **Step 5.2: Implement `ScreenStateService`**
  - Create notification channel `kiosk_service_channel` with high priority.
  - Build persistent foreground notification with action "Open Kiosk" sending broadcast to `RelaunchReceiver`.
  - Start foreground service with `ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE`.
  - Dynamically register `BroadcastReceiver` for `Intent.ACTION_SCREEN_OFF` and `Intent.ACTION_SCREEN_ON` with `ContextCompat.RECEIVER_NOT_EXPORTED`.
  - When `ACTION_SCREEN_OFF`: launch `KioskActivity` if `Settings.canDrawOverlays(this)`.
  - When `ACTION_SCREEN_ON`: check `keyguardManager.isKeyguardLocked`, and launch `KioskActivity` if locked.
  - `launchLockScreenActivity`: flags `FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_SINGLE_TOP or FLAG_ACTIVITY_CLEAR_TOP`.
- [ ] **Step 5.3: Verify compile**
  Execute `./gradlew assembleDebug` to ensure all components compile cleanly.
- [ ] **Step 5.4: Commit changes**
  Commit Task 5 changes with git.

---

### Task 6: Configuration UI in `MainActivity`

**Files:**
- Modify: `app/src/main/java/com/jacek/test/app/MainActivity.kt`
- Create: `app/src/main/java/com/jacek/test/app/ui/MainConfigScreen.kt`
- Create: `app/src/main/java/com/jacek/test/app/ui/WebPreviewScreen.kt`

- [ ] **Step 6.1: Implement `MainConfigScreen` composable**
  - Permissions card:
    - Overlay permission state with action to launch `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`.
    - Notification permission state (Android 13+) with request launcher.
  - Kiosk Control card:
    - Switch to enable/disable `ScreenStateService`.
    - Automatically start/stop service based on toggle.
  - URL Configuration card:
    - OutlinedTextField for kiosk URL with validation and Save button.
    - Quick preset chips (e.g. "Google", "Home Assistant", "Wikipedia").
    - Toggles for "Keep screen on" and "Show floating exit button".
  - Actions card:
    - "Open Webpage" button (navigates to in-app preview).
    - "Launch Kiosk Directly" button (launches `KioskActivity` for direct testing).
- [ ] **Step 6.2: Implement `WebPreviewScreen` composable**
  - Top app bar with current URL, Refresh button, "Open in External Browser" button, and Back button to config screen.
  - `ModernKioskWebView` showing the configured URL.
- [ ] **Step 6.3: Integrate into `MainActivity`**
  - Support switching between `MainConfigScreen` and `WebPreviewScreen`.
  - Refresh permission states on `onResume`.
- [ ] **Step 6.4: Verify compile and unit tests**
  Execute `./gradlew testDebugUnitTest assembleDebug`.
- [ ] **Step 6.5: Commit changes**
  Commit Task 6 changes with git.

---

### Task 7: Build, Install on Tablet (`HA2BXNQC`), Grant Permissions & Verify

**Files:** None (build, deploy, runtime verification)

- [ ] **Step 7.1: Build APK**
  Run `./gradlew assembleDebug`.
- [ ] **Step 7.2: Install on tablet `HA2BXNQC`**
  Run `adb -s HA2BXNQC install -r app/build/outputs/apk/debug/app-debug.apk`.
  Also optionally install on `emulator-5554` for side-by-side verification.
- [ ] **Step 7.3: Grant permissions via ADB**
  Run:
  - `adb -s HA2BXNQC shell pm grant com.jacek.test.app.debug android.permission.POST_NOTIFICATIONS`
  - `adb -s HA2BXNQC shell appops set com.jacek.test.app.debug SYSTEM_ALERT_WINDOW allow`
- [ ] **Step 7.4: Launch app on tablet**
  Run `adb -s HA2BXNQC shell am start -n com.jacek.test.app.debug/com.jacek.test.app.MainActivity`.
- [ ] **Step 7.5: Verify Kiosk and Screen Off / Screen On Flow**
  - Verify configuration UI renders and URL can be previewed.
  - Enable service toggle.
  - Test lockscreen behavior: simulate screen off (`adb -s HA2BXNQC shell input keyevent 26`), wait 2 seconds, simulate screen on (`adb -s HA2BXNQC shell input keyevent 26`).
  - Verify `KioskActivity` is displayed over lockscreen.
  - Take screenshot from tablet (`adb -s HA2BXNQC exec-out screencap -p > tablet_kiosk_screenshot.png`) to confirm visual output.
  - Verify Unlock button triggers keyguard bouncer.
- [ ] **Step 7.6: Final commit and summary**
  Clean up any test artifacts, commit final touches.
