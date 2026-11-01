package com.shakarganj.milkreception.mot

import android.app.Application
import android.os.Build
import com.shakarganj.milkreception.mot.gps.LocationNotificationHelper
import com.shakarganj.milkreception.mot.offline.MotOfflineDatabase

class MotApplication : Application() {

    lateinit var database: MotOfflineDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Initialize persistent offline database
        database = MotOfflineDatabase(this)

        // Initialize notification channel for Foreground Service
        LocationNotificationHelper.createNotificationChannel(this)
    }

    companion object {
        lateinit var instance: MotApplication
            private set
    }
}
