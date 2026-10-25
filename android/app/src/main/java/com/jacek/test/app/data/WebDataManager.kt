package com.jacek.test.app.data

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import java.io.File

object WebDataManager {
    private const val TAG = "WebDataManager"

    /**
     * Clears all WebView resource caches (in-memory and disk cache files).
     */
    fun clearWebCache(context: Context, onComplete: () -> Unit = {}) {
        val appContext = context.applicationContext
        try {
            val webView = WebView(appContext)
            webView.clearCache(true)
            webView.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing WebView cache", e)
        }

        try {
            val webViewCacheDir = File(appContext.cacheDir, "WebView")
            if (webViewCacheDir.exists()) {
                webViewCacheDir.deleteRecursively()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error deleting WebView disk cache directory", e)
        }

        onComplete()
    }

    /**
     * Clears all web application data including:
     * - Cookies (session & persistent)
     * - WebStorage (localStorage, sessionStorage, IndexedDB, Web SQL)
     * - Geolocation permissions
     * - Saved form data & HTTP auth credentials
     * - WebView history and cache
     */
    fun clearWebAppData(context: Context, onComplete: () -> Unit = {}) {
        val appContext = context.applicationContext

        // 1. Clear WebView cache & form data & history
        try {
            val webView = WebView(appContext)
            webView.clearCache(true)
            webView.clearFormData()
            webView.clearHistory()
            webView.clearSslPreferences()
            webView.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing WebView instances", e)
        }

        // 2. Clear all cookies
        try {
            val cookieManager = CookieManager.getInstance()
            cookieManager.removeAllCookies {
                cookieManager.flush()
            }
            cookieManager.removeSessionCookies(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing cookies", e)
        }

        // 3. Clear WebStorage (LocalStorage, SessionStorage, IndexedDB, Web SQL)
        try {
            WebStorage.getInstance().deleteAllData()
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing WebStorage", e)
        }

        // 4. Clear Geolocation permissions
        try {
            GeolocationPermissions.getInstance().clearAll()
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing Geolocation permissions", e)
        }

        // 5. Clear WebViewDatabase (passwords, form data)
        try {
            val db = WebViewDatabase.getInstance(appContext)
            db.clearFormData()
            db.clearHttpAuthUsernamePassword()
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing WebViewDatabase", e)
        }

        // 6. Clean disk cache directories
        try {
            val webViewCacheDir = File(appContext.cacheDir, "WebView")
            if (webViewCacheDir.exists()) {
                webViewCacheDir.deleteRecursively()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error deleting disk cache directory", e)
        }

        onComplete()
    }
}
