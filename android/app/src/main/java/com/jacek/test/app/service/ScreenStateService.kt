package com.jacek.test.app.service

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.jacek.test.app.R
import com.jacek.test.app.data.KioskPreferences
import com.jacek.test.app.receiver.RelaunchReceiver
import com.jacek.test.app.ui.KioskActivity

private const val TAG = "ScreenStateService"
private const val CHANNEL_ID = "kiosk_monitoring_channel"
private const val NOTIFICATION_ID = 1001

class ScreenStateService : Service() {

    private var screenReceiver: BroadcastReceiver? = null
    private lateinit var preferences: KioskPreferences

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "ScreenStateService created")
        preferences = KioskPreferences(this)

        createNotificationChannel()
        val notification = createNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            }
            startForeground(NOTIFICATION_ID, notification, fgsType)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        registerScreenReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "ScreenStateService onStartCommand")
        return START_STICKY
    }

    private fun registerScreenReceiver() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        }

        screenReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent?) {
                when (intent?.action) {
                    Intent.ACTION_SCREEN_OFF -> {
                        Log.d(TAG, "Broadcast ACTION_SCREEN_OFF received -> launchLockScreenActivity")
                        launchLockScreenActivity()
                    }
                    Intent.ACTION_SCREEN_ON -> {
                        Log.d(TAG, "Broadcast ACTION_SCREEN_ON received")
                        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                        if (keyguardManager?.isKeyguardLocked == true) {
                            Log.d(TAG, "Screen ON and keyguard is locked -> launchLockScreenActivity")
                            launchLockScreenActivity()
                        } else {
                            Log.d(TAG, "Screen ON but keyguard is NOT locked -> no action")
                        }
                    }
                }
            }
        }

        ContextCompat.registerReceiver(
            this,
            screenReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        Log.i(TAG, "Dynamic ScreenReceiver registered for SCREEN_OFF and SCREEN_ON")
    }

    private fun launchLockScreenActivity() {
        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Cannot launch KioskActivity: SYSTEM_ALERT_WINDOW permission missing")
            return
        }

        val intent = Intent(this, KioskActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(intent)
        Log.i(TAG, "KioskActivity launched from ScreenStateService")
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Kiosk Monitor Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Maintains lockscreen monitoring for the kiosk web view"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        val relaunchIntent = Intent(this, RelaunchReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            relaunchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Kiosk Lockscreen Monitor")
            .setContentText("Kiosk active: ${preferences.kioskUrl}")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .addAction(
                android.R.drawable.ic_menu_view,
                "Open Kiosk",
                pendingIntent
            )
            .build()
    }

    override fun onDestroy() {
        Log.i(TAG, "ScreenStateService onDestroy")
        screenReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (e: Exception) {
                Log.w(TAG, "Error unregistering receiver: ${e.message}")
            }
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
