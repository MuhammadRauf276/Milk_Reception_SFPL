# Phase 4 — Native Android Background GPS Service & Locked-Screen Tracking

**Project:** Milk Reception System  
**Organization:** Shakarganj Food Products Ltd. (SFPL)  
**Author:** Antigravity Engineering Pair  
**Branch:** `feature/phase-4-native-android-offline`  
**Date:** November 1, 2026  
**Status:** Architecture & Engineering Specification  

---

## 1. The Core Problem: Why Web Geolocation Fails in the Field

In browser and PWA environments, `navigator.geolocation.watchPosition` relies on the browser tab remaining active and in the foreground.

When an MOT driver:
1. Starts an assigned journey at 06:00 AM from the ZMCC base.
2. Places the mobile device in a vehicle dashboard mount or pocket.
3. The screen turns off (lock screen activated) or another app (phone dialer, WhatsApp) takes focus.

Modern Android OS versions (Android 10 through 14+) immediately trigger **Doze Mode** and **App Standby**:
- WebWorker timers and JavaScript execution loops are suspended within 15–30 seconds.
- Background location access is severely throttled to at most a few coarse updates per hour.
- Cellular and Wi-Fi radio power is clamped.
- The route between collection centers is completely lost, creating massive multi-hour gaps in the journey map.

Phase 4 eliminates this failure mode by implementing a true **Native Android Foreground Service** backed by Google Play Services `FusedLocationProviderClient` and continuous hardware CPU WakeLocks.

---

## 2. Android Permission & Security Hierarchy

To adhere strictly to Google Android platform policies without attempting to bypass security boundaries, the app implements the standard two-step permission progression:

```
[ Step 1: In-App Dialog ]
   │
   ├─► Request ACCESS_FINE_LOCATION & ACCESS_COARSE_LOCATION
   │     - Explains why precise GPS is essential for milk route auditing.
   │     - User chooses: "While using the app" / "Only this time" / "Deny".
   │
   ├─► Request POST_NOTIFICATIONS (Android 13+ / API 33+)
   │     - Required to show the ongoing Foreground Service tracking notification.
   │
[ Step 2: Background Location Promotion (Android 10+ / API 29+) ]
   │
   └─► Request ACCESS_BACKGROUND_LOCATION
         - Presents the Android OS System Settings dialog.
         - Prompts the operator to select "Allow all the time" so location continues when screen is locked.
```

### Manifest Declarations:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

---

## 3. Native Foreground Service Architecture (`GpsLocationService`)

### 3.1 Service Lifecycle & Sticky State
The service is implemented as a sticky service (`START_STICKY`) in Android:
- **Foreground Binding:** On starting, `startForeground(NOTIFICATION_ID, notification)` is invoked immediately with `FOREGROUND_SERVICE_TYPE_LOCATION`.
- **Persistent Notification:** A non-dismissible notification is displayed in the system status bar:
  - Title: `"SFPL Milk Tracking Active"`
  - Content: `"Journey #J-20261101-01 • 14 stops remaining • Accuracy: 8m"`
  - Action Button: `"View Journey"` (opens `MainActivity`).
- **CPU WakeLock:** A `PowerManager.PARTIAL_WAKE_LOCK` is held with `setReferenceCounted(false)`. This guarantees that when the screen turns off, the mobile CPU does not enter deep sleep, allowing GPS satellite callbacks to be processed and written to SQLite without delay.
- **Battery Optimization Exemption:** The app checks `PowerManager.isIgnoringBatteryOptimizations()`. If not exempt, the user is guided to grant unrestricted battery usage to avoid OEM task killers (e.g. Xiaomi MIUI, Samsung OneUI memory managers).

### 3.2 Location Provider Configuration
`FusedLocationProviderClient` is initialized with high-precision parameters:
- `Priority: PRIORITY_HIGH_ACCURACY` (prioritizes GPS satellites over cell towers).
- `Interval: 10,000 ms` (10 seconds base polling).
- `FastestInterval: 5,000 ms` (5 seconds when movement is detected).
- `SmallestDisplacement: 10 meters`.

---

## 4. GPS Filtering & Adaptive Sampling Algorithm (`GpsFilter`)

To prevent battery exhaustion and database bloat while capturing accurate route geometry, incoming GPS fixes pass through the `GpsFilter`:

```
Incoming Location Fix (lat, lon, accuracy, timestamp)
                   │
                   ▼
     [ Is Accuracy <= 50 meters? ] ──No──► DROP ("low-accuracy")
                   │
                  Yes
                   ▼
       [ Is Fix Age <= 30 seconds? ] ──No──► DROP ("stale-cached-fix")
                   │
                  Yes
                   ▼
       [ Is this the First Fix? ] ────Yes──► ACCEPT ("first-point")
                   │
                   No
                   ▼
   [ Haversine Distance to Prev >= 25m? ] ─Yes─► ACCEPT ("moved")
                   │
                   No
                   ▼
   [ Time Elapsed Since Prev >= 120s? ] ──Yes──► ACCEPT ("heartbeat")
                   │
                   No
                   ▼
         DROP ("stationary-no-change")
```

### Mathematical Haversine Formula:
$$\Delta\sigma = 2 \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)} \right)$$
$$\text{Distance} = R \times \Delta\sigma \quad (R = 6,371,000\text{ m})$$

### Rationale for Parameters:
- **`maxAccuracyM = 50.0m`:** Drops cellular tower triangulation fixes that could falsely jump several kilometers.
- **`maxFixAgeMs = 30,000ms`:** Prevents re-recording cached locations when exiting tunnels or metal buildings.
- **`minDistanceM = 25.0m`:** When the vehicle is parked at a shop, prevents recording 200 identical points.
- **`heartbeatMs = 120,000ms`:** If the vehicle is stuck in traffic or stopped at a shop for 20 minutes, records 1 point every 2 minutes to prove continuous tracking and time spent at the location.

---

## 5. Native GPS Data Model

Each point recorded in `mot_offline.db` table `gps_points`:

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER PRIMARY KEY` | Auto-incrementing local ID |
| `client_location_id` | `TEXT UNIQUE` | Client UUID (e.g. `gps-uuid-v4`) |
| `journey_id` | `TEXT NOT NULL` | Assigned journey ID |
| `user_id` | `TEXT NOT NULL` | ID of the signed-in MOT driver |
| `latitude` | `REAL NOT NULL` | Latitude in decimal degrees |
| `longitude` | `REAL NOT NULL` | Longitude in decimal degrees |
| `gps_accuracy` | `REAL` | Accuracy in meters (from Android Location API) |
| `altitude` | `REAL` | Altitude in meters above sea level |
| `speed` | `REAL` | Speed in m/s |
| `heading` | `REAL` | Bearing in degrees (0–360) |
| `device_recorded_at`| `TEXT NOT NULL` | ISO 8601 UTC timestamp of GPS satellite fix |
| `synced` | `INTEGER` | `0` = pending upload, `1` = server acknowledged |
| `sync_status` | `TEXT` | `QUEUED`, `SYNCING`, `SYNCED`, `FAILED_RETRYABLE` |

> **Critical Rule:** Points are strictly ordered on the server by `device_recorded_at` (satellite time), never by the upload time.

---

## 6. Journey State Lifecycle Integration

1. **Journey Start:**
   - MOT opens assigned journey and taps **"Start Journey"**.
   - App calls `window.AndroidBridge.startGpsTracking(journeyId, userId)`.
   - Native `GpsLocationService` starts, activates ongoing notification, acquires WakeLock, and begins recording.
2. **Rural Travel & Locked Screen:**
   - Screen turns off. Native Foreground Service continues recording points into SQLite every 25m / 120s.
3. **Shop Collections:**
   - At each shop, the latest GPS fix is automatically attached to the milk collection record.
4. **Journey Completion:**
   - On arrival at ZMCC/PHE, operator finalizes the journey.
   - App calls `window.AndroidBridge.stopGpsTracking()`.
   - Foreground Service cleanly releases WakeLock, posts final sync batch, removes notification, and terminates.
5. **Reboot Recovery:**
   - If the device restarts while a journey was active, `BootReceiver` detects `ACTION_BOOT_COMPLETED`, inspects `mot_offline.db` for an active uncompleted journey, and automatically resumes `GpsLocationService`.
