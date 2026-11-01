# Home Assistant Jira Dashboard – Android Kiosk Companion

The Android companion application provides a dedicated lockscreen kiosk WebView for wall-mounted Android tablets or mobile devices displaying the Home Assistant Jira Dashboard.

## Key Features

- **Lockscreen & Wake Monitoring**: Starts directly on lock/wake (`showWhenLocked`) and keeps the screen awake while interacting.
- **Display Scaling & Viewport Compensation**: Custom zoom handling with CSS viewport adjustment to eliminate whitespace gaps on high-DPI tablets.
- **Theme Bridge**: Automatic light/dark mode selection with WebView `color-scheme` support matching Home Assistant styles.
- **Error Handling & Offline Recovery**: Fullscreen friendly error overlay with countdown timer and automatic reconnection retries when WiFi or Home Assistant is temporarily unreachable.
- **Data & Cache Management**: Built-in settings screen with quick-action buttons to clear WebView cache, cookies, local storage, and databases.
- **Domain Whitelisting**: Strict security whitelisting restricting navigation to Home Assistant and Jira domains.

## App Specifications

- **Application Name**: Jira Dashboard Kiosk (TestApp Integrator)
- **Package Name (Application ID)**: `com.jacek.test.app`
- **Version Name**: `0.0.7`
- **Version Code**: `7`
- **Min SDK**: API 26 (Android 8.0 Oreo)
- **Target SDK**: API 36 (Android 16)
- **Compile SDK**: API 36

## Release Signing & Keystore

Signing configuration can be provided via `keystore.properties` (ignored by Git) or environment variables:
- **`keystore.properties`**:
  ```properties
  storeFile=release.jks
  storePassword=YOUR_STORE_PASSWORD
  keyAlias=YOUR_KEY_ALIAS
  keyPassword=YOUR_KEY_PASSWORD
  ```
- **Environment variables**:
  - `ANDROID_KEYSTORE_PATH`
  - `ANDROID_KEYSTORE_PASSWORD`
  - `ANDROID_KEY_ALIAS`
  - `ANDROID_KEY_PASSWORD`

> [!NOTE]
> `keystore.properties` and `*.jks` are strictly excluded from source control via `.gitignore`.

## How to Build

From within the `android/` directory:

### Build Debug APK (for local development/testing)
```bash
./gradlew assembleDebug
```
Output: `app/build/outputs/apk/debug/app-debug.apk`

### Run Unit Tests
```bash
./gradlew test
```

### Build Google Play App Bundle (AAB)
```bash
./gradlew bundleRelease
```
Output: `app/build/outputs/bundle/release/app-release.aab`

### Build Release APK
```bash
./gradlew assembleRelease
```
Output: `app/build/outputs/apk/release/app-release.apk`

