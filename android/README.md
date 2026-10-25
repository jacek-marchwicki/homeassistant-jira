# TestApp Integrator

Sample "Hello World" Android application built with Kotlin and Jetpack Compose.

## App Specifications

- **Application Name**: TestApp Integrator
- **Package Name (Application ID)**: `com.jacek.test.app`
- **Version Name**: `0.0.6`
- **Version Code**: `6`
- **Min SDK**: API 26 (Android 8.0)
- **Target SDK**: API 36 (Android 16)
- **Compile SDK**: API 36

## Release Build Artifacts

- **Google Play Store App Bundle (.aab)**:
  `app/build/outputs/bundle/release/app-release.aab`
- **Direct Install Release APK (.apk)**:
  `app/build/outputs/apk/release/app-release.apk`
- **Google Play 512x512 Store Icon**:
  `app/src/main/ic_launcher-web.png`

## Keystore Details

The release bundle is pre-configured and signed with the generated release keystore:
- **Keystore Path**: `app/release.jks`
- **Key Alias**: `testapp`
- **Keystore Password**: `testapp123`
- **Key Password**: `testapp123`

## How to Build

### Build Google Play App Bundle (AAB)
```bash
./gradlew bundleRelease
```

### Build Release APK
```bash
./gradlew assembleRelease
```

### Run Unit Tests
```bash
./gradlew test
```
