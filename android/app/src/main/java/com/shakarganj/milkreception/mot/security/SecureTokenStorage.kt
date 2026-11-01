package com.shakarganj.milkreception.mot.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class DeviceIdentity(
    val deviceUid: String?,
    val deviceKey: String?
)

object SecureTokenStorage {

    private const val PREFS_FILE = "sfpl_secure_prefs"
    private const val KEY_DEVICE_UID = "device_uid"
    private const val KEY_DEVICE_KEY = "device_key"
    private const val KEY_SESSION_COOKIE = "session_cookie"
    private const val KEY_ACTIVE_USER_ID = "active_user_id"

    private fun getPrefs(context: Context): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                context,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Fallback for older devices / test environments
            context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        }
    }

    fun saveDeviceIdentity(context: Context, uid: String, key: String) {
        getPrefs(context).edit()
            .putString(KEY_DEVICE_UID, uid)
            .putString(KEY_DEVICE_KEY, key)
            .apply()
    }

    fun getDeviceIdentity(context: Context): DeviceIdentity {
        val prefs = getPrefs(context)
        return DeviceIdentity(
            deviceUid = prefs.getString(KEY_DEVICE_UID, null),
            deviceKey = prefs.getString(KEY_DEVICE_KEY, null)
        )
    }

    fun saveSessionCookie(context: Context, cookie: String) {
        getPrefs(context).edit().putString(KEY_SESSION_COOKIE, cookie).apply()
    }

    fun getSessionCookie(context: Context): String? {
        return getPrefs(context).getString(KEY_SESSION_COOKIE, null)
    }

    fun saveActiveUserId(context: Context, userId: String) {
        getPrefs(context).edit().putString(KEY_ACTIVE_USER_ID, userId).apply()
    }

    fun getActiveUserId(context: Context): String? {
        return getPrefs(context).getString(KEY_ACTIVE_USER_ID, null)
    }

    fun clearSession(context: Context) {
        // Clears session credentials but explicitly preserves device registration and offline database!
        getPrefs(context).edit()
            .remove(KEY_SESSION_COOKIE)
            .remove(KEY_ACTIVE_USER_ID)
            .apply()
    }
}
