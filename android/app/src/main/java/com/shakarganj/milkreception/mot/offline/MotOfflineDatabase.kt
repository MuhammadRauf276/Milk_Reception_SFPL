package com.shakarganj.milkreception.mot.offline

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.shakarganj.milkreception.mot.gps.GpsPoint

data class ActiveJourneyRecord(
    val id: String,
    val journeyNumber: String,
    val operationalDate: String,
    val status: String,
    val userId: String,
    val payloadJson: String
)

data class OfflineCollectionRecord(
    val clientEventId: String,
    val journeyId: String,
    val stopId: String,
    val milkSourceId: String,
    val quantity: Double,
    val unit: String,
    val lr: Double,
    val fat: Double,
    val snf: Double,
    val latitude: Double?,
    val longitude: Double?,
    val gpsAccuracy: Float?,
    val personDecision: String,
    val decisionRemarks: String?,
    val testResultsJson: String?,
    val photosMetaJson: String?,
    val offlineCreatedAt: String,
    val ownerUserId: String,
    val syncStatus: String,
    val attempts: Int = 0,
    val lastError: String? = null
)

data class PhotoMetaRecord(
    val captureId: String,
    val clientEventId: String?,
    val labTestId: String,
    val filePath: String,
    val sha256Checksum: String,
    val mimeType: String,
    val fileSizeBytes: Long,
    val capturedAt: String,
    val uploadStatus: String, // PENDING, UPLOADED, FAILED
    val serverPhotoId: String? = null
)

class MotOfflineDatabase(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        // 1. Active Journey
        db.execSQL(
            """
            CREATE TABLE active_journey (
                id TEXT PRIMARY KEY,
                journey_number TEXT NOT NULL,
                operational_date TEXT NOT NULL,
                status TEXT NOT NULL,
                user_id TEXT NOT NULL,
                cached_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            """.trimIndent()
        )

        // 2. Journey Stops
        db.execSQL(
            """
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
                status TEXT NOT NULL,
                collection_json TEXT,
                skip_reason TEXT
            );
            """.trimIndent()
        )

        // 3. Collection Drafts
        db.execSQL(
            """
            CREATE TABLE collection_drafts (
                draft_key TEXT PRIMARY KEY, -- owner_user_id:stop_id
                owner_user_id TEXT NOT NULL,
                stop_id TEXT NOT NULL,
                draft_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """.trimIndent()
        )

        // 4. Completed Collections Queue
        db.execSQL(
            """
            CREATE TABLE offline_collections (
                client_event_id TEXT PRIMARY KEY,
                journey_id TEXT NOT NULL,
                stop_id TEXT NOT NULL,
                milk_source_id TEXT NOT NULL,
                quantity REAL NOT NULL,
                unit TEXT NOT NULL,
                lr REAL NOT NULL,
                fat REAL NOT NULL,
                snf REAL NOT NULL,
                latitude REAL,
                longitude REAL,
                gps_accuracy REAL,
                person_decision TEXT NOT NULL,
                decision_remarks TEXT,
                test_results_json TEXT,
                photos_meta_json TEXT,
                offline_created_at TEXT NOT NULL,
                owner_user_id TEXT NOT NULL,
                sync_status TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                last_error TEXT,
                synced_at TEXT
            );
            """.trimIndent()
        )

        // 5. GPS Points Queue
        db.execSQL(
            """
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
            """.trimIndent()
        )

        // 6. Captured Photos
        db.execSQL(
            """
            CREATE TABLE captured_photos (
                capture_id TEXT PRIMARY KEY,
                client_event_id TEXT,
                lab_test_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                sha256_checksum TEXT NOT NULL,
                mime_type TEXT DEFAULT 'image/jpeg',
                file_size_bytes INTEGER NOT NULL,
                captured_at TEXT NOT NULL,
                upload_status TEXT NOT NULL,
                server_photo_id TEXT,
                attempts INTEGER DEFAULT 0,
                last_error TEXT
            );
            """.trimIndent()
        )

        // 7. Cached Sources & Policies
        db.execSQL(
            """
            CREATE TABLE cached_master_data (
                data_key TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                cached_at TEXT NOT NULL
            );
            """.trimIndent()
        )

        // Indexes for fast lookup and FIFO queueing
        db.execSQL("CREATE INDEX idx_gps_sync ON gps_points (synced, device_recorded_at);")
        db.execSQL("CREATE INDEX idx_col_sync ON offline_collections (sync_status, offline_created_at);")
        db.execSQL("CREATE INDEX idx_col_owner ON offline_collections (owner_user_id);")
        db.execSQL("CREATE INDEX idx_photos_event ON captured_photos (client_event_id);")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Non-destructive upgrade migrations
    }

    // --- Active Journey Operations ---

    fun saveActiveJourney(journey: ActiveJourneyRecord) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("active_journey", null, null)
            val cv = ContentValues().apply {
                put("id", journey.id)
                put("journey_number", journey.journeyNumber)
                put("operational_date", journey.operationalDate)
                put("status", journey.status)
                put("user_id", journey.userId)
                put("cached_at", java.time.Instant.now().toString())
                put("payload_json", journey.payloadJson)
            }
            db.insertWithOnConflict("active_journey", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun getActiveJourney(): ActiveJourneyRecord? {
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT id, journey_number, operational_date, status, user_id, payload_json FROM active_journey LIMIT 1", null)
        return cursor.use {
            if (it.moveToFirst()) {
                ActiveJourneyRecord(
                    id = it.getString(0),
                    journeyNumber = it.getString(1),
                    operationalDate = it.getString(2),
                    status = it.getString(3),
                    userId = it.getString(4),
                    payloadJson = it.getString(5)
                )
            } else null
        }
    }

    // --- GPS Points Operations ---

    fun insertGpsPoint(point: GpsPoint) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("client_location_id", point.clientLocationId)
            put("journey_id", point.journeyId)
            put("user_id", point.userId)
            put("latitude", point.latitude)
            put("longitude", point.longitude)
            put("gps_accuracy", point.accuracy)
            put("altitude", point.altitude)
            put("speed", point.speed)
            put("heading", point.heading)
            put("device_recorded_at", point.deviceRecordedAt)
            put("synced", point.synced)
            put("sync_status", point.syncStatus)
        }
        db.insertWithOnConflict("gps_points", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun getUnsyncedGpsPoints(limit: Int = 50): List<GpsPoint> {
        val list = mutableListOf<GpsPoint>()
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT client_location_id, journey_id, user_id, latitude, longitude, gps_accuracy, altitude, speed, heading, device_recorded_at, synced, sync_status, attempts, last_error FROM gps_points WHERE synced = 0 ORDER BY id ASC LIMIT ?",
            arrayOf(limit.toString())
        )
        cursor.use {
            while (it.moveToNext()) {
                list.add(
                    GpsPoint(
                        clientLocationId = it.getString(0),
                        journeyId = it.getString(1),
                        userId = it.getString(2),
                        latitude = it.getDouble(3),
                        longitude = it.getDouble(4),
                        accuracy = if (it.isNull(5)) null else it.getFloat(5),
                        altitude = if (it.isNull(6)) null else it.getDouble(6),
                        speed = if (it.isNull(7)) null else it.getFloat(7),
                        heading = if (it.isNull(8)) null else it.getFloat(8),
                        deviceRecordedAt = it.getString(9),
                        synced = it.getInt(10),
                        syncStatus = it.getString(11),
                        attempts = it.getInt(12),
                        lastError = it.getString(13)
                    )
                )
            }
        }
        return list
    }

    fun markGpsPointsSynced(clientLocationIds: List<String>) {
        if (clientLocationIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in clientLocationIds) {
                val cv = ContentValues().apply {
                    put("synced", 1)
                    put("sync_status", "SYNCED")
                }
                db.update("gps_points", cv, "client_location_id = ?", arrayOf(id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // --- Offline Collections Operations ---

    fun insertOfflineCollection(record: OfflineCollectionRecord) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("client_event_id", record.clientEventId)
            put("journey_id", record.journeyId)
            put("stop_id", record.stopId)
            put("milk_source_id", record.milkSourceId)
            put("quantity", record.quantity)
            put("unit", record.unit)
            put("lr", record.lr)
            put("fat", record.fat)
            put("snf", record.snf)
            put("latitude", record.latitude)
            put("longitude", record.longitude)
            put("gps_accuracy", record.gpsAccuracy)
            put("person_decision", record.personDecision)
            put("decision_remarks", record.decisionRemarks)
            put("test_results_json", record.testResultsJson)
            put("photos_meta_json", record.photosMetaJson)
            put("offline_created_at", record.offlineCreatedAt)
            put("owner_user_id", record.ownerUserId)
            put("sync_status", record.syncStatus)
        }
        db.insertWithOnConflict("offline_collections", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getPendingCollections(ownerUserId: String? = null, limit: Int = 20): List<OfflineCollectionRecord> {
        val list = mutableListOf<OfflineCollectionRecord>()
        val db = readableDatabase
        val query = if (ownerUserId != null) {
            "SELECT client_event_id, journey_id, stop_id, milk_source_id, quantity, unit, lr, fat, snf, latitude, longitude, gps_accuracy, person_decision, decision_remarks, test_results_json, photos_meta_json, offline_created_at, owner_user_id, sync_status, attempts, last_error FROM offline_collections WHERE sync_status != 'SYNCED' AND owner_user_id = ? ORDER BY offline_created_at ASC LIMIT ?"
        } else {
            "SELECT client_event_id, journey_id, stop_id, milk_source_id, quantity, unit, lr, fat, snf, latitude, longitude, gps_accuracy, person_decision, decision_remarks, test_results_json, photos_meta_json, offline_created_at, owner_user_id, sync_status, attempts, last_error FROM offline_collections WHERE sync_status != 'SYNCED' ORDER BY offline_created_at ASC LIMIT ?"
        }
        val args = if (ownerUserId != null) arrayOf(ownerUserId, limit.toString()) else arrayOf(limit.toString())

        val cursor = db.rawQuery(query, args)
        cursor.use {
            while (it.moveToNext()) {
                list.add(
                    OfflineCollectionRecord(
                        clientEventId = it.getString(0),
                        journeyId = it.getString(1),
                        stopId = it.getString(2),
                        milkSourceId = it.getString(3),
                        quantity = it.getDouble(4),
                        unit = it.getString(5),
                        lr = it.getDouble(6),
                        fat = it.getDouble(7),
                        snf = it.getDouble(8),
                        latitude = if (it.isNull(9)) null else it.getDouble(9),
                        longitude = if (it.isNull(10)) null else it.getDouble(10),
                        gpsAccuracy = if (it.isNull(11)) null else it.getFloat(11),
                        personDecision = it.getString(12),
                        decisionRemarks = it.getString(13),
                        testResultsJson = it.getString(14),
                        photosMetaJson = it.getString(15),
                        offlineCreatedAt = it.getString(16),
                        ownerUserId = it.getString(17),
                        syncStatus = it.getString(18),
                        attempts = it.getInt(19),
                        lastError = it.getString(20)
                    )
                )
            }
        }
        return list
    }

    fun updateCollectionSyncStatus(clientEventId: String, status: String, error: String? = null) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("sync_status", status)
            if (error != null) put("last_error", error)
            if (status == "SYNCED") put("synced_at", java.time.Instant.now().toString())
        }
        db.update("offline_collections", cv, "client_event_id = ?", arrayOf(clientEventId))
    }

    // --- Photo Operations ---

    fun insertPhotoMeta(photo: PhotoMetaRecord) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("capture_id", photo.captureId)
            put("client_event_id", photo.clientEventId)
            put("lab_test_id", photo.labTestId)
            put("file_path", photo.filePath)
            put("sha256_checksum", photo.sha256Checksum)
            put("mime_type", photo.mimeType)
            put("file_size_bytes", photo.fileSizeBytes)
            put("captured_at", photo.capturedAt)
            put("upload_status", photo.uploadStatus)
            put("server_photo_id", photo.serverPhotoId)
        }
        db.insertWithOnConflict("captured_photos", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getPendingPhotos(limit: Int = 10): List<PhotoMetaRecord> {
        val list = mutableListOf<PhotoMetaRecord>()
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT capture_id, client_event_id, lab_test_id, file_path, sha256_checksum, mime_type, file_size_bytes, captured_at, upload_status, server_photo_id FROM captured_photos WHERE upload_status != 'UPLOADED' LIMIT ?",
            arrayOf(limit.toString())
        )
        cursor.use {
            while (it.moveToNext()) {
                list.add(
                    PhotoMetaRecord(
                        captureId = it.getString(0),
                        clientEventId = it.getString(1),
                        labTestId = it.getString(2),
                        filePath = it.getString(3),
                        sha256Checksum = it.getString(4),
                        mimeType = it.getString(5),
                        fileSizeBytes = it.getLong(6),
                        capturedAt = it.getString(7),
                        uploadStatus = it.getString(8),
                        serverPhotoId = it.getString(9)
                    )
                )
            }
        }
        return list
    }

    fun markPhotoUploaded(captureId: String, serverPhotoId: String) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("upload_status", "UPLOADED")
            put("server_photo_id", serverPhotoId)
        }
        db.update("captured_photos", cv, "capture_id = ?", arrayOf(captureId))
    }

    // --- Summary & Queue Counts ---

    fun getQueueSummary(ownerUserId: String? = null): Map<String, Int> {
        val db = readableDatabase
        var unsyncedCollections = 0
        var unsyncedGps = 0
        var pendingPhotos = 0

        val colQuery = if (ownerUserId != null) {
            "SELECT COUNT(*) FROM offline_collections WHERE sync_status != 'SYNCED' AND owner_user_id = ?"
        } else {
            "SELECT COUNT(*) FROM offline_collections WHERE sync_status != 'SYNCED'"
        }
        val colArgs = if (ownerUserId != null) arrayOf(ownerUserId) else null
        db.rawQuery(colQuery, colArgs).use { if (it.moveToFirst()) unsyncedCollections = it.getInt(0) }

        db.rawQuery("SELECT COUNT(*) FROM gps_points WHERE synced = 0", null).use {
            if (it.moveToFirst()) unsyncedGps = it.getInt(0)
        }

        db.rawQuery("SELECT COUNT(*) FROM captured_photos WHERE upload_status != 'UPLOADED'", null).use {
            if (it.moveToFirst()) pendingPhotos = it.getInt(0)
        }

        return mapOf(
            "unsyncedCollections" to unsyncedCollections,
            "unsyncedGps" to unsyncedGps,
            "pendingPhotos" to pendingPhotos
        )
    }

    companion object {
        const val DATABASE_NAME = "mot_offline.db"
        const val DATABASE_VERSION = 1
    }
}
