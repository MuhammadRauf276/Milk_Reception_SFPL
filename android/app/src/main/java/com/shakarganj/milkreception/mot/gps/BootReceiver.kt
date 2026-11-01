package com.shakarganj.milkreception.mot.gps

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.shakarganj.milkreception.mot.MotApplication

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Log.i(TAG, "Device boot or app update detected: $action")

            // Check if there was an active journey in progress
            val activeJourney = MotApplication.instance.database.getActiveJourney()
            if (activeJourney != null && (activeJourney.status == "IN_PROGRESS" || activeJourney.status == "ASSIGNED")) {
                Log.i(TAG, "Resuming GPS tracking for active journey #${activeJourney.id}")

                val serviceIntent = Intent(context, GpsLocationService::class.java).apply {
                    this.action = GpsLocationService.ACTION_START_TRACKING
                    putExtra(GpsLocationService.EXTRA_JOURNEY_ID, activeJourney.id)
                    putExtra(GpsLocationService.EXTRA_USER_ID, activeJourney.userId)
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
