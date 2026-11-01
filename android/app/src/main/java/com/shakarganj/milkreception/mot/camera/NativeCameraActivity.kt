package com.shakarganj.milkreception.mot.camera

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.shakarganj.milkreception.mot.R
import java.io.File

class NativeCameraActivity : AppCompatActivity() {

    private var currentTempFile: File? = null
    private var labTestId: String = ""
    private var clientEventId: String? = null

    private val takePictureLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (success && currentTempFile != null && currentTempFile!!.exists()) {
            val record = CameraHelper.processAndSavePhoto(
                this,
                currentTempFile!!,
                labTestId,
                clientEventId
            )

            val resultIntent = Intent().apply {
                putExtra(EXTRA_CAPTURE_ID, record.captureId)
                putExtra(EXTRA_FILE_PATH, record.filePath)
                putExtra(EXTRA_SHA256, record.sha256Checksum)
                putExtra(EXTRA_LAB_TEST_ID, record.labTestId)
            }
            setResult(Activity.RESULT_OK, resultIntent)
            finish()
        } else {
            Toast.makeText(this, "Photo capture cancelled", Toast.LENGTH_SHORT).show()
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            launchCamera()
        } else {
            Toast.makeText(this, "Camera permission is required to capture test evidence", Toast.LENGTH_LONG).show()
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        labTestId = intent.getStringExtra(EXTRA_LAB_TEST_ID) ?: ""
        clientEventId = intent.getStringExtra(EXTRA_CLIENT_EVENT_ID)

        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            launchCamera()
        } else {
            requestPermissionLauncher.launch(android.Manifest.permission.CAMERA)
        }
    }

    private fun launchCamera() {
        try {
            val tempFile = CameraHelper.createTempImageFile(this)
            currentTempFile = tempFile
            val photoUri = FileProvider.getUriForFile(
                this,
                "${applicationContext.packageName}.fileprovider",
                tempFile
            )
            takePictureLauncher.launch(photoUri)
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to initialize camera: ${e.message}", Toast.LENGTH_LONG).show()
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    companion object {
        const val EXTRA_LAB_TEST_ID = "EXTRA_LAB_TEST_ID"
        const val EXTRA_CLIENT_EVENT_ID = "EXTRA_CLIENT_EVENT_ID"
        const val EXTRA_CAPTURE_ID = "EXTRA_CAPTURE_ID"
        const val EXTRA_FILE_PATH = "EXTRA_FILE_PATH"
        const val EXTRA_SHA256 = "EXTRA_SHA256"
    }
}
