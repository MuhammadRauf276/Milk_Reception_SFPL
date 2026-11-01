package com.shakarganj.milkreception.mot

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.shakarganj.milkreception.mot.bridge.AndroidBridgeInterface
import com.shakarganj.milkreception.mot.camera.NativeCameraActivity
import com.shakarganj.milkreception.mot.gps.GpsLocationService
import com.shakarganj.milkreception.mot.offline.MotOfflineDatabase

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingSpinner: ProgressBar
    private lateinit var nativeStatusBar: View
    private lateinit var tvNativeGpsStatus: TextView
    private lateinit var tvOfflineQueueCount: TextView

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineLocation = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        if (fineLocation) {
            checkBackgroundLocationPermission()
        }
    }

    private val requestBackgroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (!isGranted) {
            Toast.makeText(
                this,
                "Background location is recommended to record routes while phone is locked.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        loadingSpinner = findViewById(R.id.loadingSpinner)
        nativeStatusBar = findViewById(R.id.nativeStatusBar)
        tvNativeGpsStatus = findViewById(R.id.tvNativeGpsStatus)
        tvOfflineQueueCount = findViewById(R.id.tvOfflineQueueCount)

        setupWebView()
        checkLocationPermissions()
        refreshSyncStatusUI()

        // Load the target web app URL
        val targetUrl = BuildConfig.API_BASE_URL.trimEnd('/') + "/mot"
        webView.loadUrl(targetUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        // Inject Native Bridge Interface
        webView.addJavascriptInterface(AndroidBridgeInterface(this), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                loadingSpinner.visibility = View.GONE
                // Notify web application that Android native bridge is ready
                webView.evaluateJavascript("window.isNativeAndroidApp = true; window.dispatchEvent(new Event('sfpl-android-ready'));", null)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    loadingSpinner.visibility = View.GONE
                    // When offline, WebView displays offline cached shell or local notification
                    nativeStatusBar.visibility = View.VISIBLE
                    tvNativeGpsStatus.text = "Offline Mode • Stored work is safe on device"
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                callback?.invoke(origin, true, false)
            }
        }
    }

    private fun checkLocationPermissions() {
        val permissionsToRequest = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissionsToRequest.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            requestPermissionsLauncher.launch(missing.toTypedArray())
        } else {
            checkBackgroundLocationPermission()
        }
    }

    private fun checkBackgroundLocationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestBackgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
        }
    }

    fun startGpsForegroundService(journeyId: String, userId: String) {
        val serviceIntent = Intent(this, GpsLocationService::class.java).apply {
            action = GpsLocationService.ACTION_START_TRACKING
            putExtra(GpsLocationService.EXTRA_JOURNEY_ID, journeyId)
            putExtra(GpsLocationService.EXTRA_USER_ID, userId)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        nativeStatusBar.visibility = View.VISIBLE
        tvNativeGpsStatus.text = "GPS Tracking Active • Journey #$journeyId"
    }

    fun stopGpsForegroundService() {
        val serviceIntent = Intent(this, GpsLocationService::class.java).apply {
            action = GpsLocationService.ACTION_STOP_TRACKING
        }
        startService(serviceIntent)
        nativeStatusBar.visibility = View.GONE
    }

    fun refreshSyncStatusUI() {
        val summary = MotApplication.instance.database.getQueueSummary()
        val unsent = (summary["unsyncedCollections"] ?: 0) + (summary["unsyncedGps"] ?: 0)
        if (unsent > 0) {
            tvOfflineQueueCount.visibility = View.VISIBLE
            tvOfflineQueueCount.text = "$unsent Unsent"
        } else {
            tvOfflineQueueCount.visibility = View.GONE
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CAMERA_CAPTURE && resultCode == Activity.RESULT_OK && data != null) {
            val captureId = data.getStringExtra(NativeCameraActivity.EXTRA_CAPTURE_ID) ?: ""
            val labTestId = data.getStringExtra(NativeCameraActivity.EXTRA_LAB_TEST_ID) ?: ""
            val filePath = data.getStringExtra(NativeCameraActivity.EXTRA_FILE_PATH) ?: ""
            val sha256 = data.getStringExtra(NativeCameraActivity.EXTRA_SHA256) ?: ""

            // Notify WebView via JavaScript callback
            val js = "if (window.onNativePhotoCaptured) { window.onNativePhotoCaptured('$labTestId', '$captureId', '$filePath', '$sha256'); }"
            webView.evaluateJavascript(js, null)
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    companion object {
        const val REQUEST_CAMERA_CAPTURE = 8002
    }
}
