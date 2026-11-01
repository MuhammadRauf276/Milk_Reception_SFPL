# Phase 4 — Native Android MOT Architecture & Offline Reliability

**Project:** Milk Reception System  
**Organization:** Shakarganj Food Products Ltd. (SFPL)  
**Author:** Antigravity Engineering Pair  
**Branch:** `feature/phase-4-native-android-offline`  
**Date:** November 1, 2026  
**Status:** Approved Architecture Decision Record (ADR)  

---

## 1. Executive Summary & Objective

In rural milk procurement (ZMCCs, collection routes, villages across Punjab), Mobile Milk Operators (MOTs) embark on daily collection journeys visiting 10 to 40 private collection centers and local dairy farmers. 

The physical reality of field procurement:
- Cellular towers are sparse; 2G/EDGE or complete zero-connectivity dead zones are normal for hours during travel.
- Screen timeout and pocket stowage: The driver starts a route, puts the phone in a pocket or vehicle mount, and drives for 45 minutes between stops. Screen turns off.
- The operating system (Android 10 through 14+) aggressively terminates background processes, throttles CPU cycles, and freezes Web Geolocation timers to conserve battery.
- Milk collections must be recorded immediately at the shop with 15+ physical & chemical laboratory tests, Richmond formula evaluation, photo capture of lactometer/stem readings, and receipt issuance.
- When the MOT returns to a connected area (or plant gate), all data must reliably synchronize to the central SFPL server without duplicates, missing points, or data loss.

### The Mandate
A responsive website or standard installed PWA **cannot** provide continuous GPS tracking when the screen is locked or the browser is minimized. Android explicitly suspends non-foreground JavaScript execution and cuts background GPS access unless an active **Android Foreground Service** with a persistent user notification (`FOREGROUND_SERVICE_TYPE_LOCATION`) and CPU WakeLock is maintained.

Therefore, Phase 4 delivers a **Native Android Application** (`com.shakarganj.milkreception.mot`) purpose-built for MOT field operations.

---

## 2. Architecture Comparison & Technology Selection (ADR)

We evaluated three potential technical paths for Phase 4:

| Evaluation Criteria | Option A: Full React Native / Expo Rewrite | Option B: Full Pure Native Kotlin Rewrite | Option C: Native Android Shell + Foreground Location Engine + Durable SQLite + Native Bridge (Selected) |
| :--- | :--- | :--- | :--- |
| **Existing Code Reuse** | Very Low (< 10%). Requires rewriting all 175+ pages, forms, Richmond tables, UI components in React Native JSX. | Very Low (< 5%). Requires rewriting all UI, forms, and business logic from scratch in Kotlin & Jetpack Compose. | **Very High (> 85%)**. Reuses tested Next.js UI, Richmond calculation engine, responsive forms, drawer navigation, and SOP rules. |
| **Business Logic Parity** | High risk of divergence between Web and Mobile calculation rules (e.g. Richmond SNF formula, 3-zone temp/density limits). | High risk of calculation discrepancies and maintenance overhead maintaining two separate rule engines. | **Exact 100% Parity**. Runs the identical tested domain logic, preventing calculation discrepancies. |
| **Background GPS Reliability** | Moderate. Requires ejecting from Expo managed workflow to write native Kotlin service. | **Maximum**. Full control over Android Foreground Service, LocationManager, and WakeLocks. | **Maximum**. Full native Kotlin Foreground Service with `FOREGROUND_SERVICE_TYPE_LOCATION`, FusedLocationProviderClient, and WakeLocks. |
| **Offline Data Durability** | Async/MMKV storage. | Room / SQLite DB. | **Dual-Shield Durability**: Native SQLite database (`mot_offline.db`) paired with client IndexedDB sync queues. |
| **Native Camera & Storage** | Camera libraries. | CameraX / MediaStore. | **Native Android CameraX / Intent** with SHA-256 checksums, lossless compression, and direct file persistence. |
| **Maintenance Burden** | Two full frontend codebases to maintain for SFPL engineers. | Two completely independent codebases in different languages. | **Unified Frontend**: Web app serves desktop/tablets, Android shell powers MOT handhelds. |
| **Implementation Risk** | High (delays, regression risk). | Extreme (months of rewrite). | **Low & Controlled** (additive native module with zero web regressions). |

### The Selected Decision: Option C (Native Android Hybrid Architecture)
We adopt a **Native Android Container Architecture** consisting of:
1. **Native Core (Kotlin):**
   - `GpsLocationService`: Persistent Android Foreground Service with sticky notification, `FusedLocationProviderClient`, high-accuracy satellite tracking, and CPU `WakeLock` to survive locked-screen pocket stowage.
   - `GpsFilter`: Real-time motion detection, Haversine displacement calculation, accuracy filtering (drops fixes > 50m), and heartbeat buffering (every 120s).
   - `MotOfflineDatabase`: Robust native SQLite database (`mot_offline.db`) storing journeys, stops, collection drafts, completed collections, GPS breadcrumbs, photos, and sync queues with full ACID transaction guarantees.
   - `NativeCameraActivity`: Native Android Camera Intent / CameraX capturing photos with hardware acceleration, generating SHA-256 checksums, and storing original images in app-private external storage (`Context.getExternalFilesDir`).
   - `NativeSyncEngine`: Background synchronization engine communicating directly with `/api/sync/batch` using device keys, session cookies, exponential backoff, and idempotent deduplication.
   - `AndroidBridgeInterface`: Bidirectional `@JavascriptInterface` binding the web layer to native capabilities.
2. **Web / UI Layer (Embedded Modern WebView):**
   - Renders the hardened SFPL MOT interface with responsive layout, virtual keyboard avoidance, and touch controls.
   - Communicates with `window.AndroidBridge` when running in the native app.
   - Falls back gracefully to standard browser APIs when accessed via desktop browser or standard PWA.

---

## 3. System Architecture Blueprint

```
+---------------------------------------------------------------------------------+
|                         SFPL MOT ANDROID HANDHELD                               |
|                                                                                 |
|  +---------------------------------------------------------------------------+  |
|  |                     PRESENTATION LAYER (WEBVIEW)                          |  |
|  |  - MOT Operations Workspace & Assigned Journey UI                         |  |
|  |  - Offline Collection Entry & 15+ Lab Tests (Richmond SNF / SOP)          |  |
|  |  - Reactive Status Bar (GPS Accuracy, Fix Age, Queue Counts, Battery)   |  |
|  |  - Responsive Mobile Forms with Touch Controls                            |  |
|  +---------------------------------------------------------------------------+  |
|                                     │                                           |
|                     Javascript Interface (window.AndroidBridge)                 |
|                                     │                                           |
|  +---------------------------------------------------------------------------+  |
|  |                       NATIVE ANDROID MODULES (KOTLIN)                     |  |
|  |                                                                           |  |
|  |  +---------------------------+       +---------------------------------+  |  |
|  |  |   GpsLocationService      |       |      NativeCameraActivity       |  |  |
|  |  |  - Foreground Service     |       |  - CameraX / Image Capture      |  |  |
|  |  |  - FusedLocationProvider  |       |  - SHA-256 Checksum             |  |  |
|  |  |  - NotificationManager    |       |  - JPEG 85% Optimization        |  |  |
|  |  |  - CPU Partial WakeLock   |       |  - Private App Storage          |  |  |
|  |  +-------------┬-------------+       +----------------┬----------------+  |  |
|  |                │                                      │                   |  |
|  |                ▼                                      ▼                   |  |
|  |  +---------------------------------------------------------------------+  |  |
|  |  |                   MotOfflineDatabase (SQLite)                       |  |  |
|  |  |  - active_journey / journey_stops       - collection_drafts         |  |  |
|  |  |  - completed_collections (ACID)         - gps_points (FIFO)         |  |  |
|  |  |  - captured_photos_meta                 - sync_queue & errors       |  |  |
|  |  +---------------------------------┬-----------------------------------+  |  |
|  |                                    │                                      |  |
|  |                                    ▼                                      |  |
|  |  +---------------------------------------------------------------------+  |  |
|  |  |                       NativeSyncEngine                              |  |  |
|  |  |  - Network Connectivity Monitor (Cellular / WiFi / Offline)         |  |  |
|  |  |  - Batch Payload Formatter (SyncBatchRequest, max 50 items)        |  |  |
|  |  |  - Device Header Authentication (x-device-uid, x-device-key)        |  |  |
|  |  |  - Exponential Backoff & Retry (5s, 10s, 20s... max 15m)           |  |  |
|  |  +---------------------------------┬-----------------------------------+  |  |
|  +------------------------------------┼--------------------------------------+  |
+---------------------------------------┼-----------------------------------------+
                                        │ (HTTPS / TLS 1.3)
                                        ▼
+---------------------------------------------------------------------------------+
|                       SFPL BACKEND SERVICES & APIS                              |
|                                                                                 |
|  - POST /api/sync/batch (Batch Sync Engine, Client UUID Idempotency)            |
|  - POST /api/photos (Multipart Photo Upload with Capture ID & Checksum)         |
|  - POST /api/zmcc/mot/journeys/current/locations/batch (GPS Stream Ingestion)   |
|  - POST /api/zmcc/mot/journeys/current/collections (Collection Write & Verify)  |
|  - PostgreSQL Database: DeviceActivityEvent, MotShopCollection, MotGpsLocation |
+---------------------------------------------------------------------------------+
```

---

## 4. Reused vs Native Code Allocation

### Existing Code Reused 100% As-Is:
1. **Server Idempotency Contract (`src/backend/services/sync/syncBatchService.ts`):** Client UUID deduplication, `DeviceActivityEvent` idempotency ledger, transaction safety.
2. **Server GPS Batch Ingestion (`src/backend/services/mot/motCore.ts`):** `recordGpsBatch` accepting up to 500 points with individual `client_location_id` deduplication.
3. **Server Collection API (`src/backend/services/mot/motCore.ts`):** `submitShopCollection` with Stage 1 decisions, Richmond SNF calculations, and test validation.
4. **Photo Upload Service (`src/app/api/photos/route.ts`):** Multipart photo ingestion, storage link, and audit record creation.
5. **Testing & Validation Logic:** Richmond formula, SNF ratio, 3-zone temperature/density tolerance, and mandatory test policies.
6. **Authentication & Role Authorization:** Canonical 19-role security, JWT session token generation, device authorization via `x-device-uid` and `x-device-key`.

### New Native Implementations Added:
1. `GpsLocationService.kt`: Native Android Foreground Service for locked-screen tracking.
2. `GpsFilter.kt`: Native implementation of displacement filtering, accuracy thresholding, and heartbeat.
3. `MotOfflineDatabase.kt`: SQLite database with transactional ACID guarantees.
4. `NativeCameraActivity.kt`: Camera hardware integration with SHA-256 checksumming and file storage.
5. `NativeSyncEngine.kt`: Android WorkManager and connectivity-driven batch sync engine.
6. `AndroidBridgeInterface.kt`: JS-to-Native communication bridge.
7. `androidBridge.ts` (Frontend): Client-side adapter delegating to native bridge when running on Android.
8. `MotNativeStatusBadge.tsx`: MOT status indicator for GPS, background tracking, battery, and sync queue.

---

## 5. Security Architecture

1. **Hardware-Backed Device Identity:** Device UID and Device Key are stored using Android `EncryptedSharedPreferences` backed by the **Android Keystore System** (AES-256-GCM).
2. **Cleartext Traffic Disabled:** `android:usesCleartextTraffic="false"` enforced in `AndroidManifest.xml`. All API communication occurs over TLS 1.3.
3. **Session Cookie Isolation:** Session tokens are stored in the secure WebView cookie jar with `HttpOnly` and `SameSite=Lax` flags.
4. **User Isolation in SQLite:** Every record stored in `mot_offline.db` (drafts, collections, GPS points, photos) contains `owner_user_id`. When a different user signs in, the UI displays only the active user's work. Pending work from previous users remains safely in the queue awaiting upload under the originating user's identity.
5. **Scoped Storage Compliance:** Captured photos are stored in app-specific internal/external storage (`Android/data/com.shakarganj.milkreception.mot/files/Pictures/`), inaccessible to other third-party apps on the device.

---

## 6. Deployment & Distribution Strategy

1. **Build Variants:**
   - `debug`: Development environment targeting staging/local API with verbose logging.
   - `release`: Production environment targeting `https://milk.shakarganj.com.pk`, ProGuard code shrinking enabled, release keystore signing.
2. **Direct Enterprise Distribution (APK Sideloading):**
   - MOT operators use SFPL-provisioned Android rugged handhelds (Samsung Galaxy XCover, Urovo, Zebra, or standard Android smartphones).
   - APK is distributed directly via the SFPL Admin Portal (`/super-admin/devices`) or Mobile Device Management (MDM). Google Play Store is not required.
   - Built-in in-app update check compares `BuildConfig.VERSION_CODE` with server `appVersion` and prompts the operator to update when a newer build is available.
