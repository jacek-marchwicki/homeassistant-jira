package com.jacek.test.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class KioskPreferencesTest {

    @Test
    fun normalizeUrl_addsHttpsWhenMissingScheme() {
        assertEquals("https://google.com", KioskPreferences.normalizeUrl("google.com"))
        assertEquals("https://example.org/dashboard", KioskPreferences.normalizeUrl("example.org/dashboard"))
    }

    @Test
    fun normalizeUrl_preservesExistingScheme() {
        assertEquals("http://192.168.1.50:8123", KioskPreferences.normalizeUrl("http://192.168.1.50:8123"))
        assertEquals("http://homeassistant.local:8123", KioskPreferences.normalizeUrl("http://homeassistant.local:8123"))
        assertEquals("https://www.google.com", KioskPreferences.normalizeUrl("https://www.google.com"))
    }

    @Test
    fun normalizeUrl_defaultsToHttpForLocalHostOrPort8123() {
        assertEquals("http://homeassistant.local:8123", KioskPreferences.normalizeUrl("homeassistant.local:8123"))
        assertEquals("http://192.168.1.100:8123", KioskPreferences.normalizeUrl("192.168.1.100:8123"))
        assertEquals("http://myserver.local", KioskPreferences.normalizeUrl("myserver.local"))
    }

    @Test
    fun normalizeUrl_handlesBlankOrSpaces() {
        assertEquals(KioskPreferences.DEFAULT_URL, KioskPreferences.normalizeUrl(""))
        assertEquals(KioskPreferences.DEFAULT_URL, KioskPreferences.normalizeUrl("   "))
    }

    @Test
    fun normalizeUrl_trimsWhitespace() {
        assertEquals("https://example.org", KioskPreferences.normalizeUrl("  example.org  "))
    }
}
