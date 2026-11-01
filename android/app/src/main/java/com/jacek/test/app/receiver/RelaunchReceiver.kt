package com.jacek.test.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import com.jacek.test.app.ui.KioskActivity

private const val TAG = "RelaunchReceiver"

class RelaunchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        Log.d(TAG, "Relaunch broadcast received")
        if (Settings.canDrawOverlays(context)) {
            val kioskIntent = Intent(context, KioskActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(kioskIntent)
        } else {
            Log.w(TAG, "Cannot launch kiosk from receiver: SYSTEM_ALERT_WINDOW permission not granted")
        }
    }
}
