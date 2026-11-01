package com.shakarganj.milkreception.mot.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Environment
import com.shakarganj.milkreception.mot.MotApplication
import com.shakarganj.milkreception.mot.offline.PhotoMetaRecord
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

object CameraHelper {

    private const val MAX_DIMENSION = 1600
    private const val JPEG_QUALITY = 85

    fun createTempImageFile(context: Context): File {
        val storageDir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
            ?: context.filesDir
        val imagesDir = File(storageDir, "captured_photos").apply { if (!exists()) mkdirs() }
        val filename = "temp_capture_" + System.currentTimeMillis() + ".jpg"
        return File(imagesDir, filename)
    }

    /**
     * Processes captured camera photo:
     * 1. Rotates according to EXIF orientation.
     * 2. Scales down if exceeding MAX_DIMENSION to preserve memory and network bandwidth.
     * 3. Compresses to JPEG 85% maintaining lactometer scale readability.
     * 4. Computes SHA-256 integrity checksum.
     * 5. Saves to permanent app storage and logs to MotOfflineDatabase.
     */
    fun processAndSavePhoto(
        context: Context,
        rawPhotoFile: File,
        labTestId: String,
        clientEventId: String?
    ): PhotoMetaRecord {
        val captureId = "cap-" + UUID.randomUUID().toString()

        // 1. Read EXIF orientation
        val exif = ExifInterface(rawPhotoFile.absolutePath)
        val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)

        // 2. Decode bitmap with bounds check
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(rawPhotoFile.absolutePath, options)

        var sampleSize = 1
        while (options.outWidth / sampleSize > MAX_DIMENSION * 2 || options.outHeight / sampleSize > MAX_DIMENSION * 2) {
            sampleSize *= 2
        }

        val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val rawBitmap = BitmapFactory.decodeFile(rawPhotoFile.absolutePath, decodeOptions)

        // 3. Rotate bitmap if required
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        }

        val rotatedBitmap = if (!matrix.isIdentity) {
            Bitmap.createBitmap(rawBitmap, 0, 0, rawBitmap.width, rawBitmap.height, matrix, true)
        } else {
            rawBitmap
        }

        // 4. Compress to JPEG 85%
        val baos = ByteArrayOutputStream()
        rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos)
        val imageBytes = baos.toByteArray()

        // 5. Calculate SHA-256 Checksum
        val md = MessageDigest.getInstance("SHA-256")
        val digestBytes = md.digest(imageBytes)
        val sha256Hex = digestBytes.joinToString("") { "%02x".format(it) }

        // 6. Save permanent file
        val storageDir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: context.filesDir
        val photosDir = File(storageDir, "captured_photos").apply { if (!exists()) mkdirs() }
        val destFile = File(photosDir, "$captureId.jpg")

        FileOutputStream(destFile).use { it.write(imageBytes) }

        // Clean up temporary capture file
        if (rawPhotoFile.exists()) {
            rawPhotoFile.delete()
        }

        val record = PhotoMetaRecord(
            captureId = captureId,
            clientEventId = clientEventId,
            labTestId = labTestId,
            filePath = destFile.absolutePath,
            sha256Checksum = sha256Hex,
            mimeType = "image/jpeg",
            fileSizeBytes = destFile.length(),
            capturedAt = Instant.now().toString(),
            uploadStatus = "PENDING"
        )

        MotApplication.instance.database.insertPhotoMeta(record)
        return record
    }
}
