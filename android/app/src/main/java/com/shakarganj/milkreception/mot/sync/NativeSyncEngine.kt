package com.shakarganj.milkreception.mot.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.shakarganj.milkreception.mot.BuildConfig
import com.shakarganj.milkreception.mot.MotApplication
import com.shakarganj.milkreception.mot.gps.GpsPoint
import com.shakarganj.milkreception.mot.offline.OfflineCollectionRecord
import com.shakarganj.milkreception.mot.security.SecureTokenStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

object NativeSyncEngine {

    private const val TAG = "NativeSyncEngine"
    private const val MAX_ITEMS_PER_BATCH = 50
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    suspend fun runSyncCycle(context: Context): SyncCycleResult = withContext(Dispatchers.IO) {
        if (!isOnline(context)) {
            Log.d(TAG, "Sync skipped: device is currently offline")
            return@withContext SyncCycleResult(false, 0, 0, "Device is offline")
        }

        val db = MotApplication.instance.database
        val deviceIdentity = SecureTokenStorage.getDeviceIdentity(context)
        val sessionCookie = SecureTokenStorage.getSessionCookie(context)

        // 1. Gather pending collections
        val pendingCollections = db.getPendingCollections(limit = 20)

        // 2. Gather unsynced GPS points
        val unsyncedGpsPoints = db.getUnsyncedGpsPoints(limit = 30)

        if (pendingCollections.isEmpty() && unsyncedGpsPoints.isEmpty()) {
            Log.d(TAG, "Sync complete: no pending items")
            return@withContext SyncCycleResult(true, 0, 0, "No pending items")
        }

        val itemsArray = JSONArray()

        // Add collections to sync batch
        for (col in pendingCollections) {
            val itemJson = JSONObject().apply {
                put("clientUuid", col.clientEventId)
                put("kind", "MOT_COLLECTION")
                put("ownerUserId", col.ownerUserId)
                put("capturedAt", col.offlineCreatedAt)

                val payload = JSONObject().apply {
                    put("client_event_id", col.clientEventId)
                    put("journey_id", col.journeyId)
                    put("stop_id", col.stopId)
                    put("milk_source_id", col.milkSourceId)
                    put("quantity", col.quantity)
                    put("unit", col.unit)
                    put("lr", col.lr)
                    put("fat", col.fat)
                    put("snf", col.snf)
                    if (col.latitude != null) put("recorded_latitude", col.latitude)
                    if (col.longitude != null) put("recorded_longitude", col.longitude)
                    if (col.gpsAccuracy != null) put("recorded_gps_accuracy", col.gpsAccuracy)
                    put("person_decision", col.personDecision)
                    if (!col.decisionRemarks.isNullOrBlank()) put("decision_remarks", col.decisionRemarks)
                    if (!col.testResultsJson.isNullOrBlank()) put("test_results", JSONArray(col.testResultsJson))
                    if (!col.photosMetaJson.isNullOrBlank()) put("photos", JSONArray(col.photosMetaJson))
                }
                put("payload", payload)
            }
            itemsArray.put(itemJson)
        }

        // Add GPS batch if present
        if (unsyncedGpsPoints.isNotEmpty()) {
            val gpsBatchItem = JSONObject().apply {
                val firstPoint = unsyncedGpsPoints.first()
                put("clientUuid", "gps-batch-" + java.util.UUID.randomUUID().toString())
                put("kind", "MOT_GPS_BATCH")
                put("ownerUserId", firstPoint.userId)
                put("capturedAt", firstPoint.deviceRecordedAt)

                val payload = JSONObject().apply {
                    put("journey_id", firstPoint.journeyId)
                    val locations = JSONArray()
                    for (pt in unsyncedGpsPoints) {
                        val loc = JSONObject().apply {
                            put("client_location_id", pt.clientLocationId)
                            put("journey_id", pt.journeyId)
                            put("latitude", pt.latitude)
                            put("longitude", pt.longitude)
                            if (pt.accuracy != null) put("gps_accuracy", pt.accuracy)
                            put("device_recorded_at", pt.deviceRecordedAt)
                        }
                        locations.put(loc)
                    }
                    put("locations", locations)
                }
                put("payload", payload)
            }
            itemsArray.put(gpsBatchItem)
        }

        val requestPayload = JSONObject().apply {
            put("deviceUid", deviceIdentity.deviceUid ?: "SFPL-MOT-DEV")
            put("appVersion", BuildConfig.VERSION_NAME)
            put("deviceSentAt", Instant.now().toString())
            put("items", itemsArray)
        }

        val apiUrl = BuildConfig.API_BASE_URL.trimEnd('/') + "/api/sync/batch"
        val requestBuilder = Request.Builder()
            .url(apiUrl)
            .post(requestPayload.toString().toRequestBody(JSON_MEDIA_TYPE))

        // Inject Device Auth Headers and Session Cookie
        if (!deviceIdentity.deviceUid.isNullOrBlank() && !deviceIdentity.deviceKey.isNullOrBlank()) {
            requestBuilder.addHeader("x-device-uid", deviceIdentity.deviceUid)
            requestBuilder.addHeader("x-device-key", deviceIdentity.deviceKey)
        }
        if (!sessionCookie.isNullOrBlank()) {
            requestBuilder.addHeader("Cookie", sessionCookie)
        }

        try {
            val response = httpClient.newCall(requestBuilder.build()).execute()
            val responseBody = response.body?.string().orEmpty()

            if (!response.isSuccessful) {
                Log.w(TAG, "Sync batch HTTP ${response.code}: $responseBody")
                return@withContext SyncCycleResult(false, 0, 0, "Server returned HTTP ${response.code}")
            }

            val respJson = JSONObject(responseBody)
            val resultsArray = respJson.optJSONArray("results") ?: JSONArray()

            var syncedCount = 0
            val syncedGpsIds = mutableListOf<String>()

            for (i in 0 until resultsArray.length()) {
                val res = resultsArray.getJSONObject(i)
                val clientUuid = res.getString("clientUuid")
                val status = res.getString("status") // SAVED, DUPLICATE, REJECTED, RETRY

                when (status) {
                    "SAVED", "DUPLICATE" -> {
                        if (clientUuid.startsWith("gps-batch-")) {
                            // Mark all included GPS points as synced
                            for (pt in unsyncedGpsPoints) {
                                syncedGpsIds.add(pt.clientLocationId)
                            }
                        } else {
                            db.updateCollectionSyncStatus(clientUuid, "SYNCED")
                            syncedCount++
                        }
                    }
                    "REJECTED" -> {
                        val message = res.optString("message", "Validation failed")
                        db.updateCollectionSyncStatus(clientUuid, "NEEDS_ATTENTION", message)
                    }
                    "RETRY" -> {
                        val message = res.optString("message", "Transient server error")
                        db.updateCollectionSyncStatus(clientUuid, "FAILED_RETRYABLE", message)
                    }
                }
            }

            if (syncedGpsIds.isNotEmpty()) {
                db.markGpsPointsSynced(syncedGpsIds)
            }

            // 3. Trigger Photo Uploads for any pending photos
            PhotoUploadWorker.uploadPendingPhotos(context)

            Log.i(TAG, "Sync cycle success: $syncedCount collections synced, ${syncedGpsIds.size} GPS points synced")
            return@withContext SyncCycleResult(true, syncedCount, syncedGpsIds.size, null)

        } catch (e: Exception) {
            Log.e(TAG, "Sync batch network error: ${e.message}", e)
            return@withContext SyncCycleResult(false, 0, 0, e.message)
        }
    }
}

data class SyncCycleResult(
    val success: Boolean,
    val syncedCollections: Int,
    val syncedGpsPoints: Int,
    val errorMessage: String?
)
