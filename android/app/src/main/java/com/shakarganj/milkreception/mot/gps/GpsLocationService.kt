package com.shakarganj.milkreception.mot.gps

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.google.android.gms.location.*
import com.shakarganj.milkreception.mot.MotApplication
import java.time.Instant
import java.util.UUID

class GpsLocationService : Service() {

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private var activeJourneyId: String? = null
    private var activeUserId: String? = null
    private var lastRecordedPoint: GpsPoint? = null
    private val trackingConfig = TrackingConfig()

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START_TRACKING

        when (action) {
            ACTION_STOP_TRACKING -> {
                stopTracking()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START_TRACKING -> {
                val journeyId = intent?.getStringExtra(EXTRA_JOURNEY_ID)
                val userId = intent?.getStringExtra(EXTRA_USER_ID)

                if (journeyId.isNullOrBlank() || userId.isNullOrBlank()) {
                    Log.w(TAG, "Cannot start tracking: journeyId or userId missing")
                    stopSelf()
                    return START_NOT_STICKY
                }

                activeJourneyId = journeyId
                activeUserId = userId

                startForegroundTracking(journeyId)
                requestLocationUpdates()
            }
        }

        return START_STICKY
    }

    private fun startForegroundTracking(journeyId: String) {
        val notification = LocationNotificationHelper.buildTrackingNotification(
            this,
            journeyId,
            "Acquiring initial satellite fix..."
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                LocationNotificationHelper.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(LocationNotificationHelper.NOTIFICATION_ID, notification)
        }

        isTracking = true
        currentJourneyId = journeyId
    }

    @SuppressLint("MissingPermission")
    private fun requestLocationUpdates() {
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L).apply {
            setMinUpdateIntervalMillis(5_000L)
            setMinUpdateDistanceMeters(10.0f)
            setWaitForAccurateLocation(false)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                for (location in locationResult.locations) {
                    processIncomingLocation(location)
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback!!,
            Looper.getMainLooper()
        )
    }

    private fun processIncomingLocation(location: Location) {
        val journeyId = activeJourneyId ?: return
        val userId = activeUserId ?: return

        latestLocation = location
        lastFixTimestamp = location.time

        val decision = GpsFilter.evaluate(
            previousPoint = lastRecordedPoint,
            currentLat = location.latitude,
            currentLon = location.longitude,
            accuracy = location.accuracy,
            fixTimestampMs = location.time,
            nowMs = System.currentTimeMillis(),
            config = trackingConfig
        )

        if (!decision.shouldRecord) {
            Log.d(TAG, "GPS point dropped: ${decision.reason} (accuracy: ${location.accuracy}m)")
            return
        }

        val clientLocId = "gps-" + UUID.randomUUID().toString()
        val isoTimestamp = Instant.ofEpochMilli(location.time).toString()

        val point = GpsPoint(
            clientLocationId = clientLocId,
            journeyId = journeyId,
            userId = userId,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = location.accuracy,
            altitude = if (location.hasAltitude()) location.altitude else null,
            speed = if (location.hasSpeed()) location.speed else null,
            heading = if (location.hasBearing()) location.bearing else null,
            deviceRecordedAt = isoTimestamp,
            synced = 0,
            syncStatus = "QUEUED"
        )

        // Persist to SQLite offline database
        MotApplication.instance.database.insertGpsPoint(point)
        lastRecordedPoint = point

        // Update ongoing notification with latest fix info
        val notification = LocationNotificationHelper.buildTrackingNotification(
            this,
            journeyId,
            "Latest fix: Acc ${location.accuracy.toInt()}m • ${formatTime(location.time)}"
        )
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(LocationNotificationHelper.NOTIFICATION_ID, notification)

        // Notify in-process listeners (WebView bridge)
        onLocationRecordedListener?.invoke(point)
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "SFPL:MotGpsTrackingWakeLock"
            ).apply {
                setReferenceCounted(false)
                acquire(12 * 60 * 60 * 1000L) // 12 hours max safety limit
            }
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
        }
        wakeLock = null
    }

    private fun stopTracking() {
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
        }
        releaseWakeLock()
        isTracking = false
        currentJourneyId = null
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        stopTracking()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun formatTime(millis: Long): String {
        return java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date(millis))
    }

    companion object {
        const val TAG = "GpsLocationService"
        const val ACTION_START_TRACKING = "com.shakarganj.mot.ACTION_START_TRACKING"
        const val ACTION_STOP_TRACKING = "com.shakarganj.mot.ACTION_STOP_TRACKING"
        const val EXTRA_JOURNEY_ID = "EXTRA_JOURNEY_ID"
        const val EXTRA_USER_ID = "EXTRA_USER_ID"

        @Volatile
        var isTracking: Boolean = false
            private set

        @Volatile
        var currentJourneyId: String? = null
            private set

        @Volatile
        var latestLocation: Location? = null
            private set

        @Volatile
        var lastFixTimestamp: Long = 0L
            private set

        var onLocationRecordedListener: ((GpsPoint) -> Unit)? = null
    }
}
