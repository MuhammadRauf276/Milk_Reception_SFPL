package com.shakarganj.milkreception.mot.sync

import android.content.Context
import android.util.Log
import com.shakarganj.milkreception.mot.BuildConfig
import com.shakarganj.milkreception.mot.MotApplication
import com.shakarganj.milkreception.mot.offline.PhotoMetaRecord
import com.shakarganj.milkreception.mot.security.SecureTokenStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

object PhotoUploadWorker {

    private const val TAG = "PhotoUploadWorker"
    private val JPEG_MEDIA_TYPE = "image/jpeg".toMediaType()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    suspend fun uploadPendingPhotos(context: Context) = withContext(Dispatchers.IO) {
        val db = MotApplication.instance.database
        val pendingPhotos = db.getPendingPhotos(limit = 10)
        if (pendingPhotos.isEmpty()) return@withContext

        val apiUrl = BuildConfig.API_BASE_URL.trimEnd('/') + "/api/photos"
        val sessionCookie = SecureTokenStorage.getSessionCookie(context)
        val deviceIdentity = SecureTokenStorage.getDeviceIdentity(context)

        for (photo in pendingPhotos) {
            val file = File(photo.filePath)
            if (!file.exists()) {
                Log.w(TAG, "Photo file missing: ${photo.filePath}, skipping")
                continue
            }

            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("captureId", photo.captureId)
                .addFormDataPart("labTestId", photo.labTestId)
                .addFormDataPart("checksum", photo.sha256Checksum)
                .addFormDataPart("entityType", "mot_shop_collection")
                .apply {
                    if (!photo.clientEventId.isNullOrBlank()) {
                        addFormDataPart("clientEventId", photo.clientEventId)
                    }
                }
                .addFormDataPart(
                    "file",
                    file.name,
                    file.asRequestBody(JPEG_MEDIA_TYPE)
                )
                .build()

            val requestBuilder = Request.Builder()
                .url(apiUrl)
                .post(requestBody)

            if (!sessionCookie.isNullOrBlank()) {
                requestBuilder.addHeader("Cookie", sessionCookie)
            }
            if (!deviceIdentity.deviceUid.isNullOrBlank() && !deviceIdentity.deviceKey.isNullOrBlank()) {
                requestBuilder.addHeader("x-device-uid", deviceIdentity.deviceUid)
                requestBuilder.addHeader("x-device-key", deviceIdentity.deviceKey)
            }

            try {
                val response = httpClient.newCall(requestBuilder.build()).execute()
                if (response.isSuccessful) {
                    val respStr = response.body?.string().orEmpty()
                    val serverPhotoId = try {
                        org.json.JSONObject(respStr).optString("id", photo.captureId)
                    } catch (e: Exception) {
                        photo.captureId
                    }

                    // 1. Mark as uploaded in SQLite
                    db.markPhotoUploaded(photo.captureId, serverPhotoId)

                    // 2. Safely delete local file only after confirmed upload
                    if (file.exists()) {
                        file.delete()
                    }
                    Log.i(TAG, "Photo ${photo.captureId} uploaded and local file purged")
                } else {
                    Log.w(TAG, "Photo upload failed HTTP ${response.code} for ${photo.captureId}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Photo upload network error for ${photo.captureId}: ${e.message}")
            }
        }
    }
}
