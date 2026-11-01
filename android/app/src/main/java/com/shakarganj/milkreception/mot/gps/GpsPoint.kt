package com.shakarganj.milkreception.mot.gps

data class GpsPoint(
    val clientLocationId: String,
    val journeyId: String,
    val userId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float?,
    val altitude: Double? = null,
    val speed: Float? = null,
    val heading: Float? = null,
    val deviceRecordedAt: String,
    val synced: Int = 0,
    val syncStatus: String = "QUEUED",
    val attempts: Int = 0,
    val lastError: String? = null
)
