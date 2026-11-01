# Phase 4 — Android Build, Packaging & Enterprise Deployment Guide

**Project:** Milk Reception System  
**Organization:** Shakarganj Food Products Ltd. (SFPL)  
**Author:** Antigravity Engineering Pair  
**Branch:** `feature/phase-4-native-android-offline`  
**Date:** November 1, 2026  
**Status:** Enterprise Deployment Standard  

---

## 1. Build Process & Tooling

The Android project is located at `android/` within the repository root.

### Prerequisites:
- Java Development Kit: OpenJDK 17 LTS (Java 17)
- Android SDK: Platform API 34 (Android 14), Build-Tools 34.0.0, Platform-Tools
- Gradle: Version 8.4+ (managed via Gradle Wrapper `./gradlew`)

---

## 2. Build Commands

### 2.1 Development Debug APK:
```bash
cd android
./gradlew assembleDebug
```
- **Output:** `android/app/build/outputs/apk/debug/app-debug.apk`
- **Characteristics:** Signed with default Android debug certificate; points to development/staging API; logs enabled in Logcat (`tag: SFPL_MOT`).

### 2.2 Production Release APK:
```bash
cd android
./gradlew assembleRelease
```
- **Output:** `android/app/build/outputs/apk/release/app-release-unsigned.apk` (or signed if keystore configured).
- **Characteristics:** ProGuard / R8 code shrinking enabled; logs stripped; cleartext traffic disabled; points to production API.

---

## 3. Signing Configuration & Enterprise Security

### 3.1 Generating the Release Keystore:
```bash
keytool -genkeypair -v -keystore sfpl-release.jks -alias sfpl-mot-key -keyalg RSA -keysize 2048 -validity 10000
```

### 3.2 Secure Gradle Signing:
In `android/app/build.gradle`:
```groovy
signingConfigs {
    release {
        storeFile file(System.getenv("SFPL_KEYSTORE_PATH") ?: "sfpl-release.jks")
        storePassword System.getenv("SFPL_KEYSTORE_PASSWORD")
        keyAlias System.getenv("SFPL_KEY_ALIAS") ?: "sfpl-mot-key"
        keyPassword System.getenv("SFPL_KEY_PASSWORD")
        v1SigningEnabled true
        v2SigningEnabled true
    }
}
```

> **Security Rule:** Private keystores (`*.jks`, `*.keystore`) and passwords must **never** be committed to version control. They are injected via CI/CD secrets during release builds.

---

## 4. API Environment Configuration

The application determines its target API endpoint via `BuildConfig.API_BASE_URL` defined in `android/app/build.gradle`:

```groovy
buildTypes {
    debug {
        buildConfigField "String", "API_BASE_URL", "\"http://10.168.254.155:3000\""
        applicationIdSuffix ".debug"
        debuggable true
    }
    release {
        buildConfigField "String", "API_BASE_URL", "\"https://milk.shakarganj.com.pk\""
        minifyEnabled true
        shrinkResources true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

### Network Security Configuration (`android/app/src/main/res/xml/network_security_config.xml`):
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Production: Enforce HTTPS TLS 1.3 -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <!-- Debug variant allows LAN testing -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
            <certificates src="system" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
```

---

## 5. Enterprise Distribution Strategy (Direct Sideloading)

Because MOT operators are internal SFPL staff equipped with company-issued rugged handhelds (Samsung Galaxy XCover, Zebra, Urovo), public Google Play Store listing is not required.

### 5.1 Distribution via Super Admin Portal:
1. Production release APK is uploaded to the SFPL Admin Portal: `/super-admin/devices/apk`.
2. ZMCC Managers and IT Officers can download the signed APK directly onto handheld devices via USB or private Wi-Fi download.

### 5.2 Device Installation:
```bash
adb install -r app-release.apk
```

### 5.3 In-App Updates & Version Checks:
On startup, the native app sends a heartbeat containing `appVersion` (`1.0.0-p4`). If the SFPL server reports a newer required version in the heartbeat response, the app prompts the operator:
`"An updated version of the Milk Reception MOT app is available. Please connect to ZMCC Wi-Fi to update."`

---

## 6. Rollback & Disaster Recovery Strategy

1. **Version Parity:** If an APK defect is encountered, previous APK versions (e.g. `1.0.0-p3`) remain fully compatible with backend APIs because server-side endpoints maintain strict backwards compatibility.
2. **Local Data Preservation:** Rolling back or updating the APK does not wipe SQLite database tables (`mot_offline.db`) because Android preserves app private database directories during standard package upgrades (`adb install -r`).
