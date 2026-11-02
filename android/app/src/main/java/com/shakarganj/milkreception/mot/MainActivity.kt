package com.shakarganj.milkreception.mot

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.shakarganj.milkreception.mot.bridge.AndroidBridgeInterface
import com.shakarganj.milkreception.mot.camera.NativeCameraActivity
import com.shakarganj.milkreception.mot.gps.GpsLocationService
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingSpinner: ProgressBar
    private lateinit var pageProgressBar: ProgressBar
    private lateinit var nativeStatusBar: LinearLayout
    private lateinit var tvNativeGpsStatus: TextView
    private lateinit var tvOfflineQueueCount: TextView
    private lateinit var layoutOfflineError: LinearLayout
    private lateinit var btnRetryConnection: Button

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var tempCameraUri: Uri? = null

    // File Chooser Launcher for <input type="file">
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            val uris = when {
                data?.data != null -> arrayOf(data.data!!)
                data?.clipData != null -> {
                    val count = data.clipData!!.itemCount
                    Array(count) { i -> data.clipData!!.getItemAt(i).uri }
                }
                tempCameraUri != null -> arrayOf(tempCameraUri!!)
                else -> null
            }
            fileUploadCallback?.onReceiveValue(uris)
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
        tempCameraUri = null
    }

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        // Permissions evaluated; MOT tracking will explicitly request background location if needed
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
        pageProgressBar = findViewById(R.id.pageProgressBar)
        nativeStatusBar = findViewById(R.id.nativeStatusBar)
        tvNativeGpsStatus = findViewById(R.id.tvNativeGpsStatus)
        tvOfflineQueueCount = findViewById(R.id.tvOfflineQueueCount)
        layoutOfflineError = findViewById(R.id.layoutOfflineError)
        btnRetryConnection = findViewById(R.id.btnRetryConnection)

        btnRetryConnection.setOnClickListener {
            layoutOfflineError.visibility = View.GONE
            loadingSpinner.visibility = View.VISIBLE
            webView.reload()
        }

        setupWebView()
        setupBackNavigation()
        checkBasicPermissions()
        refreshSyncStatusUI()

        // Load the complete web application root (redirects to /login or user's role dashboard)
        val targetUrl = BuildConfig.API_BASE_URL.trimEnd('/') + "/"
        webView.loadUrl(targetUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        // Configure cookie persistence across sessions
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

            // Append MPDSFPL identifier to User Agent
            val defaultUa = userAgentString
            userAgentString = "$defaultUa MPDSFPL/1.0 (Android)"
        }

        // Inject Native Bridge Interface for MOT and offline tasks
        webView.addJavascriptInterface(AndroidBridgeInterface(this), "AndroidBridge")

        // Handle file downloads (tickets, receipts, CSV reports)
        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            handleFileDownload(url, userAgent, contentDisposition, mimetype)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val scheme = url.scheme?.lowercase() ?: ""
                if (scheme == "tel" || scheme == "mailto" || scheme == "sms" || scheme == "geo" || scheme == "whatsapp") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                        return true
                    } catch (_: Exception) {
                        Toast.makeText(this@MainActivity, "No application available to open link", Toast.LENGTH_SHORT).show()
                        return true
                    }
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                loadingSpinner.visibility = View.GONE
                pageProgressBar.visibility = View.GONE
                layoutOfflineError.visibility = View.GONE
                CookieManager.getInstance().flush()

                // Notify web application that Android native bridge is ready
                webView.evaluateJavascript(
                    "window.isNativeAndroidApp = true; window.dispatchEvent(new Event('sfpl-android-ready'));",
                    null
                )
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    loadingSpinner.visibility = View.GONE
                    pageProgressBar.visibility = View.GONE
                    layoutOfflineError.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    pageProgressBar.visibility = View.VISIBLE
                    pageProgressBar.progress = newProgress
                } else {
                    pageProgressBar.visibility = View.GONE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.fileUploadCallback?.onReceiveValue(null)
                this@MainActivity.fileUploadCallback = filePathCallback
                openFileChooser(fileChooserParams)
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("MPDSFPL")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("MPDSFPL Confirmation")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }
        }
    }

    private fun openFileChooser(params: WebChromeClient.FileChooserParams?) {
        try {
            // 1. Camera capture option
            val photoFile = File.createTempFile(
                "MPDSFPL_IMG_${System.currentTimeMillis()}",
                ".jpg",
                getExternalFilesDir(Environment.DIRECTORY_PICTURES)
            )
            val photoUri = FileProvider.getUriForFile(
                this,
                "${applicationContext.packageName}.fileprovider",
                photoFile
            )
            tempCameraUri = photoUri

            val takePictureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }

            // 2. File / Gallery option
            val contentIntent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }

            // 3. Combined Chooser
            val chooserIntent = Intent(Intent.ACTION_CHOOSER).apply {
                putExtra(Intent.EXTRA_INTENT, contentIntent)
                putExtra(Intent.EXTRA_TITLE, "Select Photo or Document")
                putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(takePictureIntent))
            }

            fileChooserLauncher.launch(chooserIntent)
        } catch (_: Exception) {
            val fallbackIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }
            fileChooserLauncher.launch(Intent.createChooser(fallbackIntent, "Select File"))
        }
    }

    private fun handleFileDownload(url: String, userAgent: String, contentDisposition: String, mimetype: String) {
        try {
            val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimetype)
                val cookie = CookieManager.getInstance().getCookie(url)
                if (!cookie.isNullOrBlank()) {
                    addRequestHeader("Cookie", cookie)
                }
                addRequestHeader("User-Agent", userAgent)
                setDescription("Downloading $filename")
                setTitle(filename)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            Toast.makeText(this, "Downloading $filename...", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (_: Exception) {
                Toast.makeText(this, "Unable to download file", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            private var lastBackPressedTime = 0L

            override fun handleOnBackPressed() {
                if (layoutOfflineError.visibility == View.VISIBLE && webView.canGoBack()) {
                    layoutOfflineError.visibility = View.GONE
                    webView.goBack()
                    return
                }

                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    val now = System.currentTimeMillis()
                    if (now - lastBackPressedTime < 2000L) {
                        finish()
                    } else {
                        lastBackPressedTime = now
                        Toast.makeText(this@MainActivity, "Press back again to exit MPDSFPL", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun checkBasicPermissions() {
        val permissionsToRequest = mutableListOf(
            Manifest.permission.CAMERA,
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
        checkBackgroundLocationPermission()

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
            nativeStatusBar.visibility = View.VISIBLE
            tvOfflineQueueCount.visibility = View.VISIBLE
            tvOfflineQueueCount.text = "$unsent Unsent"
        } else if (!GpsLocationService.isTracking) {
            nativeStatusBar.visibility = View.GONE
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

    companion object {
        const val REQUEST_CAMERA_CAPTURE = 8002
    }
}
