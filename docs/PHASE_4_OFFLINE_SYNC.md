# Phase 4 — Offline Synchronization Engine & Local Data Durability

**Project:** Milk Reception System  
**Organization:** Shakarganj Food Products Ltd. (SFPL)  
**Author:** Antigravity Engineering Pair  
**Branch:** `feature/phase-4-native-android-offline`  
**Date:** November 1, 2026  
**Status:** Architecture & Engineering Specification  

---

## 1. Overview & Operational Mandate

Rural milk collection requires absolute data durability. When an MOT operator collects milk at a remote village shop:
1. No internet connectivity exists.
2. The collection transaction (quantity, LR, FAT, Richmond SNF, 15+ test results, acceptance decision, and photographic evidence) must be persisted immediately on the physical device.
3. The operator must receive an immediate offline confirmation receipt (`TEMP-REC-...`).
4. When cellular coverage returns, the data must upload automatically without duplicate submissions, data corruption, or operator intervention.

---

## 2. Local Database Schema & Storage Layers

The Android application implements a robust dual-storage persistence layer:

### 2.1 Native SQLite Database (`mot_offline.db`)
Located in protected application storage (`/data/user/0/com.shakarganj.milkreception.mot/databases/mot_offline.db`).

```sql
-- Active Journey & Assigned Route
CREATE TABLE active_journey (
    id TEXT PRIMARY KEY,
    journey_number TEXT NOT NULL,
    operational_date TEXT NOT NULL,
    status TEXT NOT NULL,
    zmcc_id TEXT,
    route_id TEXT,
    cached_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

-- Assigned Journey Stops
CREATE TABLE journey_stops (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    planned_sequence INTEGER NOT NULL,
    shop_code TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    owner_name TEXT,
    phone_number TEXT,
    planned_latitude REAL,
    planned_longitude REAL,
    geofence_radius_m REAL DEFAULT 100,
    status TEXT NOT NULL, -- PENDING, VISITED, SKIPPED
    collection_json TEXT,
    skip_reason TEXT,
    FOREIGN KEY(journey_id) REFERENCES active_journey(id)
);

-- Offline Collections Queue
CREATE TABLE offline_collections (
    client_event_id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    stop_id TEXT NOT NULL,
    shop_rmr_number TEXT,
    milk_source_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    lr REAL NOT NULL,
    fat REAL NOT NULL,
    snf REAL NOT NULL,
    recorded_latitude REAL,
    recorded_longitude REAL,
    recorded_gps_accuracy REAL,
    person_decision TEXT NOT NULL,
    decision_remarks TEXT,
    test_results_json TEXT,
    photos_meta_json TEXT,
    offline_created_at TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    sync_status TEXT NOT NULL, -- QUEUED, SYNCING, SYNCED, NEEDS_ATTENTION, FAILED_RETRYABLE
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    synced_at TEXT
);

-- Native GPS Points Queue
CREATE TABLE gps_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_location_id TEXT UNIQUE NOT NULL,
    journey_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    gps_accuracy REAL,
    altitude REAL,
    speed REAL,
    heading REAL,
    device_recorded_at TEXT NOT NULL,
    synced INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'QUEUED',
    attempts INTEGER DEFAULT 0,
    last_error TEXT
);

-- Captured Photos Metadata & Storage Reference
CREATE TABLE captured_photos (
    capture_id TEXT PRIMARY KEY,
    client_event_id TEXT,
    lab_test_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    sha256_checksum TEXT NOT NULL,
    mime_type TEXT DEFAULT 'image/jpeg',
    file_size_bytes INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    upload_status TEXT NOT NULL, -- PENDING, UPLOADING, UPLOADED, FAILED
    server_photo_id TEXT,
    attempts INTEGER DEFAULT 0,
    last_error TEXT
);

-- Unified Synchronization Ledger
CREATE TABLE sync_queue (
    client_uuid TEXT PRIMARY KEY,
    kind TEXT NOT NULL, -- MOT_COLLECTION, MOT_GPS_BATCH, MOT_STOP_SKIP, etc.
    owner_user_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL, -- PENDING, PHOTOS_PENDING, NEEDS_ATTENTION, DONE
    enqueued_at INTEGER NOT NULL,
    attempts INTEGER DEFAULT 0,
    next_attempt_at INTEGER DEFAULT 0,
    last_error TEXT,
    receipt TEXT
);
```

---

## 3. The Synchronization Protocol (`/api/sync/batch`)

The native sync engine reuses the Phase 3 backend contract:

### 3.1 Request Payload (`SyncBatchRequest`)
```json
{
  "deviceUid": "SFPL-MOT-042",
  "appVersion": "1.0.0-p4",
  "deviceSentAt": "2026-11-01T17:15:30.123Z",
  "items": [
    {
      "clientUuid": "c4b12345-6789-4abc-def0-123456789abc",
      "kind": "MOT_COLLECTION",
      "ownerUserId": "104",
      "capturedAt": "2026-11-01T17:05:00.000Z",
      "payload": {
        "client_event_id": "c4b12345-6789-4abc-def0-123456789abc",
        "journey_id": "42",
        "stop_id": "189",
        "milk_source_id": "12",
        "quantity": 350.5,
        "unit": "LITER",
        "lr": 29.5,
        "fat": 6.8,
        "person_decision": "ACCEPTED",
        "recorded_latitude": 29.6974,
        "recorded_longitude": 72.5539,
        "recorded_gps_accuracy": 12.4
      }
    }
  ]
}
```

### 3.2 Response Processing & State Transitions
The server responds with itemized status outcomes:

| Server Item Status | Client Action | Local DB State |
| :--- | :--- | :--- |
| **`SAVED`** | Collection persisted on server. If photos attached, transition to photo upload. Otherwise delete from queue. | `SYNCED` / `PHOTOS_PENDING` |
| **`DUPLICATE`** | Exact replay recognized. Safe to mark complete and delete from queue. | `SYNCED` |
| **`REJECTED`** | Validation or business rule rejected. **Never deleted automatically**. Marked as `NEEDS_ATTENTION` for manual supervisor review. | `NEEDS_ATTENTION` |
| **`RETRY`** | Transient DB/network error. Backoff exponentially: 5s, 10s, 20s, 40s... max 15 min. | `FAILED_RETRYABLE` |

---

## 4. Two-Phase Photo Storage & Independent Upload

Photographs provide critical legal audit evidence of lactometer readings (LR) and butyrometer fat columns (FAT).

### Phase 1: Local Capture & Integrity Hashing
1. Native camera takes image at native sensor resolution.
2. Image is compressed to high-quality JPEG (85% quality, max 1600px edge, typically ~250 KB).
3. SHA-256 checksum is computed over the compressed bytes.
4. File is saved to `Context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)/captured_photos/{capture_id}.jpg`.
5. Row is inserted into `captured_photos` with `upload_status = 'PENDING'`.

### Phase 2: Decoupled Upload Pipeline
1. The collection record is submitted first via `/api/sync/batch`.
2. When the server ACKs with `SAVED` or `DUPLICATE` and provides the server `entityId`, the photo record is updated with `entityId`.
3. `PhotoUploadWorker` uploads the JPEG file as `multipart/form-data` to `POST /api/photos`:
   - Form fields: `captureId`, `entityType: 'mot_shop_collection'`, `entityId`, `checksum: sha256`, `testType`.
4. Only when `/api/photos` returns `HTTP 200/201` is the local JPEG file safely deleted from disk.
5. If photo upload fails (e.g. network drops mid-upload), the collection itself is already secure on the server, and the photo automatically retries on the next sync cycle.
