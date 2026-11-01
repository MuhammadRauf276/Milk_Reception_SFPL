package com.shakarganj.milkreception.mot.gps

import kotlin.math.*

data class TrackingConfig(
    val maxAccuracyM: Float = 50.0f,
    val maxFixAgeMs: Long = 30_000L,
    val minDistanceM: Double = 25.0,
    val heartbeatMs: Long = 120_000L
)

data class FilterDecision(
    val shouldRecord: Boolean,
    val reason: String
)

object GpsFilter {

    private const val EARTH_RADIUS_METERS = 6371000.0

    /**
     * Exact Haversine formula calculating distance in meters between two lat/lon coordinates.
     */
    fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val rLat1 = Math.toRadians(lat1)
        val rLat2 = Math.toRadians(lat2)

        val a = sin(dLat / 2).pow(2.0) +
                cos(rLat1) * cos(rLat2) * sin(dLon / 2).pow(2.0)
        val c = 2 * asin(min(1.0, sqrt(a)))
        return EARTH_RADIUS_METERS * c
    }

    /**
     * Determines whether an incoming GPS location fix should be recorded locally.
     * Prevents battery drain and stationary point duplication while guaranteeing continuous tracking.
     */
    fun evaluate(
        previousPoint: GpsPoint?,
        currentLat: Double,
        currentLon: Double,
        accuracy: Float?,
        fixTimestampMs: Long,
        nowMs: Long = System.currentTimeMillis(),
        config: TrackingConfig = TrackingConfig()
    ): FilterDecision {
        // 1. Accuracy Check: discard coarse network/cell tower fixes
        if (accuracy == null || !accuracy.isFinite() || accuracy > config.maxAccuracyM) {
            return FilterDecision(false, "low-accuracy")
        }

        // 2. Fix Age Check: discard stale cached locations
        if (nowMs - fixTimestampMs > config.maxFixAgeMs) {
            return FilterDecision(false, "stale-cached-fix")
        }

        // 3. First fix in journey: always record
        if (previousPoint == null) {
            return FilterDecision(true, "first-point")
        }

        // 4. Movement Check: record if moved >= minDistanceM
        val distance = haversineMeters(previousPoint.latitude, previousPoint.longitude, currentLat, currentLon)
        if (distance >= config.minDistanceM) {
            return FilterDecision(true, "moved")
        }

        // 5. Heartbeat Check: record every heartbeatMs even if stationary
        val timeSinceLastPoint = fixTimestampMs - parseIsoTimestamp(previousPoint.deviceRecordedAt)
        if (timeSinceLastPoint >= config.heartbeatMs) {
            return FilterDecision(true, "heartbeat")
        }

        return FilterDecision(false, "stationary-no-change")
    }

    private fun parseIsoTimestamp(isoString: String): Long {
        return try {
            java.time.Instant.parse(isoString).toEpochMilli()
        } catch (e: Exception) {
            System.currentTimeMillis()
        }
    }
}
