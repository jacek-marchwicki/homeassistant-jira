package com.jacek.test.app.data

import android.content.Context
import android.content.SharedPreferences

class KioskPreferences(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var kioskUrl: String
        get() = prefs.getString(KEY_KIOSK_URL, DEFAULT_URL) ?: DEFAULT_URL
        set(value) {
            val normalized = normalizeUrl(value)
            prefs.edit().putString(KEY_KIOSK_URL, normalized).apply()
        }

    var isServiceEnabled: Boolean
        get() = prefs.getBoolean(KEY_SERVICE_ENABLED, false)
        set(value) {
            prefs.edit().putBoolean(KEY_SERVICE_ENABLED, value).apply()
        }

    var keepScreenOn: Boolean
        get() = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)
        set(value) {
            prefs.edit().putBoolean(KEY_KEEP_SCREEN_ON, value).apply()
        }

    var showFloatingExit: Boolean
        get() = prefs.getBoolean(KEY_SHOW_FLOATING_EXIT, true)
        set(value) {
            prefs.edit().putBoolean(KEY_SHOW_FLOATING_EXIT, value).apply()
        }

    companion object {
        const val PREFS_NAME = "kiosk_preferences"
        const val KEY_KIOSK_URL = "kiosk_url"
        const val KEY_SERVICE_ENABLED = "service_enabled"
        const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
        const val KEY_SHOW_FLOATING_EXIT = "show_floating_exit"

        const val DEFAULT_URL = "https://www.google.com"

        fun normalizeUrl(input: String): String {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) {
                return DEFAULT_URL
            }
            if (trimmed.startsWith("http://", ignoreCase = true) ||
                trimmed.startsWith("https://", ignoreCase = true)
            ) {
                return trimmed
            }
            // Check if it's a local address (.local, private IP, localhost, or port 8123)
            val isLocal = trimmed.endsWith(".local", ignoreCase = true) ||
                trimmed.contains(".local:", ignoreCase = true) ||
                trimmed.startsWith("localhost", ignoreCase = true) ||
                trimmed.startsWith("192.168.") ||
                trimmed.startsWith("10.") ||
                trimmed.startsWith("172.") ||
                trimmed.contains(":8123")

            return if (isLocal) {
                "http://$trimmed"
            } else {
                "https://$trimmed"
            }
        }
    }
}
