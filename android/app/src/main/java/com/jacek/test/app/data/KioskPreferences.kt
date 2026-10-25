package com.jacek.test.app.data

import android.content.Context
import android.content.SharedPreferences
import java.net.URI

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

    var pageZoom: Int
        get() = prefs.getInt(KEY_PAGE_ZOOM, DEFAULT_PAGE_ZOOM).coerceIn(MIN_ZOOM, MAX_ZOOM)
        set(value) {
            val clamped = value.coerceIn(MIN_ZOOM, MAX_ZOOM)
            prefs.edit().putInt(KEY_PAGE_ZOOM, clamped).apply()
        }

    var injectStatusBarPadding: Boolean
        get() = prefs.getBoolean(KEY_INJECT_STATUS_BAR_PADDING, true)
        set(value) {
            prefs.edit().putBoolean(KEY_INJECT_STATUS_BAR_PADDING, value).apply()
        }

    var restrictUrls: Boolean
        get() = prefs.getBoolean(KEY_RESTRICT_URLS, false)
        set(value) {
            prefs.edit().putBoolean(KEY_RESTRICT_URLS, value).apply()
        }

    var allowedDomains: Set<String>
        get() = prefs.getStringSet(KEY_ALLOWED_DOMAINS, emptySet()) ?: emptySet()
        set(value) {
            prefs.edit().putStringSet(KEY_ALLOWED_DOMAINS, value).apply()
        }

    fun isUrlAllowed(targetUrl: String): Boolean {
        return isUrlAllowed(
            targetUrl = targetUrl,
            kioskUrl = kioskUrl,
            restrictUrls = restrictUrls,
            allowedDomains = allowedDomains
        )
    }

    companion object {
        const val PREFS_NAME = "kiosk_preferences"
        const val KEY_KIOSK_URL = "kiosk_url"
        const val KEY_SERVICE_ENABLED = "service_enabled"
        const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
        const val KEY_SHOW_FLOATING_EXIT = "show_floating_exit"
        const val KEY_PAGE_ZOOM = "page_zoom"
        const val KEY_INJECT_STATUS_BAR_PADDING = "inject_status_bar_padding"
        const val KEY_RESTRICT_URLS = "restrict_urls"
        const val KEY_ALLOWED_DOMAINS = "allowed_domains"

        const val DEFAULT_URL = "https://www.google.com"
        const val DEFAULT_PAGE_ZOOM = 100
        const val MIN_ZOOM = 50
        const val MAX_ZOOM = 250

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

        fun extractHost(url: String): String {
            val clean = url.trim()
            return try {
                val uri = URI(clean)
                val host = uri.host
                if (!host.isNullOrEmpty()) {
                    host.lowercase()
                } else {
                    fallbackHostExtraction(clean)
                }
            } catch (e: Exception) {
                fallbackHostExtraction(clean)
            }
        }

        private fun fallbackHostExtraction(url: String): String {
            return url.substringAfter("://")
                .substringBefore("/")
                .substringBefore(":")
                .trim()
                .lowercase()
        }

        fun isUrlAllowed(
            targetUrl: String,
            kioskUrl: String,
            restrictUrls: Boolean,
            allowedDomains: Set<String>
        ): Boolean {
            if (!restrictUrls) return true

            val targetHost = extractHost(targetUrl)
            if (targetHost.isEmpty()) return false

            // Configured Kiosk URL host is always allowed
            val kioskHost = extractHost(kioskUrl)
            if (kioskHost.isNotEmpty() && matchesDomain(targetHost, kioskHost)) {
                return true
            }

            // Check custom allowed domains
            for (domain in allowedDomains) {
                val cleanDomain = domain.trim()
                    .removePrefix("http://")
                    .removePrefix("https://")
                    .substringBefore("/")
                    .substringBefore(":")
                    .lowercase()
                if (cleanDomain.isNotEmpty() && matchesDomain(targetHost, cleanDomain)) {
                    return true
                }
            }

            return false
        }

        private fun matchesDomain(targetHost: String, allowedDomain: String): Boolean {
            return targetHost == allowedDomain || targetHost.endsWith(".$allowedDomain")
        }
    }
}
