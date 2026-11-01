package com.shakarganj.milkreception.mot.bridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import com.shakarganj.milkreception.mot.MainActivity
import com.shakarganj.milkreception.mot.MotApplication
import com.shakarganj.milkreception.mot.camera.NativeCameraActivity
import com.shakarganj.milkreception.mot.gps.GpsLocationService
import com.shakarganj.milkreception.mot.offline.OfflineCollectionRecord
import com.shakarganj.milkreception.mot.security.SecureTokenStorage
import com.shakarganj.milkreception.mot.sync.NativeSyncEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

class AndroidBridgeInterface(private val activity: MainActivity) {

    private val db get() = MotApplication.instance.database
    private val scope = CoroutineScope(Dispatchers.Main)

    @JavascriptInterface
    fun isNativeAndroid(): Boolean = true

    @JavascriptInterface
    fun startGpsTracking(journeyId: String, userId: String): Boolean {
        activity.startGpsForegroundService(journeyId, userId)
        return true
    }

    @JavascriptInterface
    fun stopGpsTracking(): Boolean {
        activity.stopGpsForegroundService()
        return true
    }

    @JavascriptInterface
    fun getGpsTrackingStatus(): String {
        val location = GpsLocationService.latestLocation
        val json = JSONObject().apply {
            put("isTracking", GpsLocationService.isTracking)
            put("currentJourneyId", GpsLocationService.currentJourneyId)
            put("lastFixTimestamp", GpsLocationService.lastFixTimestamp)
            if (location != null) {
                put("latitude", location.latitude)
                put("longitude", location.longitude)
                put("accuracy", location.accuracy)
                put("speed", location.speed)
                put("heading", location.bearing)
            }
        }
        return json.toString()
    }

    @JavascriptInterface
    fun saveOfflineCollection(collectionJson: String): String {
        return try {
            val json = JSONObject(collectionJson)
            val clientEventId = json.optString("client_event_id", "col-" + java.util.UUID.randomUUID().toString())
            val journeyId = json.getString("journey_id")
            val stopId = json.getString("stop_id")
            val milkSourceId = json.getString("milk_source_id")
            val quantity = json.getDouble("quantity")
            val unit = json.getString("unit")
            val lr = json.getDouble("lr")
            val fat = json.getDouble("fat")
            val snf = json.optDouble("snf", 0.0)
            val latitude = if (json.has("recorded_latitude")) json.getDouble("recorded_latitude") else null
            val longitude = if (json.has("recorded_longitude")) json.getDouble("recorded_longitude") else null
            val accuracy = if (json.has("recorded_gps_accuracy")) json.getDouble("recorded_gps_accuracy").toFloat() else null
            val personDecision = json.optString("person_decision", "ACCEPTED")
            val remarks = if (json.has("decision_remarks") && !json.isNull("decision_remarks")) json.getString("decision_remarks") else null
            val testResults = json.optJSONArray("test_results")?.toString()
            val photosMeta = json.optJSONArray("photos")?.toString()
            val offlineCreatedAt = json.optString("offline_created_at", java.time.Instant.now().toString())
            val ownerUserId = json.optString("owner_user_id", SecureTokenStorage.getActiveUserId(activity) ?: "")

            val record = OfflineCollectionRecord(
                clientEventId = clientEventId,
                journeyId = journeyId,
                stopId = stopId,
                milkSourceId = milkSourceId,
                quantity = quantity,
                unit = unit,
                lr = lr,
                fat = fat,
                snf = snf,
                latitude = latitude,
                longitude = longitude,
                gpsAccuracy = accuracy,
                personDecision = personDecision,
                decisionRemarks = remarks,
                testResultsJson = testResults,
                photosMetaJson = photosMeta,
                offlineCreatedAt = offlineCreatedAt,
                ownerUserId = ownerUserId,
                syncStatus = "QUEUED"
            )

            db.insertOfflineCollection(record)
            JSONObject().apply {
                put("success", true)
                put("clientEventId", clientEventId)
            }.toString()
        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", e.message)
            }.toString()
        }
    }

    @JavascriptInterface
    fun capturePhoto(labTestId: String, clientEventId: String) {
        val intent = Intent(activity, NativeCameraActivity::class.java).apply {
            putExtra(NativeCameraActivity.EXTRA_LAB_TEST_ID, labTestId)
            putExtra(NativeCameraActivity.EXTRA_CLIENT_EVENT_ID, clientEventId)
        }
        activity.startActivityForResult(intent, MainActivity.REQUEST_CAMERA_CAPTURE)
    }

    @JavascriptInterface
    fun getOfflineSummary(ownerUserId: String?): String {
        val summary = db.getQueueSummary(ownerUserId.takeIf { !it.isNullOrBlank() })
        val json = JSONObject().apply {
            put("unsyncedCollections", summary["unsyncedCollections"] ?: 0)
            put("unsyncedGps", summary["unsyncedGps"] ?: 0)
            put("pendingPhotos", summary["pendingPhotos"] ?: 0)
        }
        return json.toString()
    }

    @JavascriptInterface
    fun triggerSyncNow() {
        scope.launch {
            NativeSyncEngine.runSyncCycle(activity)
            activity.refreshSyncStatusUI()
        }
    }

    @JavascriptInterface
    fun checkBatteryOptimization(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
            return pm.isIgnoringBatteryOptimizations(activity.packageName)
        }
        return true
    }

    @JavascriptInterface
    fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(activity.packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:" + activity.packageName)
                }
                activity.startActivity(intent)
            }
        }
    }

    @JavascriptInterface
    fun getDeviceIdentity(): String {
        val identity = SecureTokenStorage.getDeviceIdentity(activity)
        return JSONObject().apply {
            put("deviceUid", identity.deviceUid)
            put("hasKey", !identity.deviceKey.isNullOrBlank())
        }.toString()
    }

    @JavascriptInterface
    fun saveDeviceIdentity(uid: String, key: String) {
        SecureTokenStorage.saveDeviceIdentity(activity, uid, key)
    }

    @JavascriptInterface
    fun saveActiveSession(userId: String, cookie: String) {
        SecureTokenStorage.saveActiveUserId(activity, userId)
        SecureTokenStorage.saveSessionCookie(activity, cookie)
    }
}
