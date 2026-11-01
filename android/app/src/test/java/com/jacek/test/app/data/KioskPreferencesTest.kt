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

    @Test
    fun isUrlAllowed_whenRestrictionDisabled_allowsAll() {
        val allowed = KioskPreferences.isUrlAllowed(
            targetUrl = "https://malicious-site.com",
            kioskUrl = "http://homeassistant.local:8123",
            restrictUrls = false,
            allowedDomains = emptySet()
        )
        assertEquals(true, allowed)
    }

    @Test
    fun isUrlAllowed_whenRestrictionEnabled_allowsKioskHostAndSubdomains() {
        val kiosk = "http://homeassistant.local:8123/lovelace"
        assertEquals(
            true,
            KioskPreferences.isUrlAllowed("http://homeassistant.local:8123/settings", kiosk, true, emptySet())
        )
        assertEquals(
            true,
            KioskPreferences.isUrlAllowed("http://sub.homeassistant.local/api", kiosk, true, emptySet())
        )
        assertEquals(
            false,
            KioskPreferences.isUrlAllowed("https://google.com", kiosk, true, emptySet())
        )
    }

    @Test
    fun isUrlAllowed_allowsExplicitlyAllowedDomains() {
        val kiosk = "http://homeassistant.local:8123"
        val customAllowed = setOf("auth.company.com", "weather.com")

        assertEquals(
            true,
            KioskPreferences.isUrlAllowed("https://auth.company.com/login", kiosk, true, customAllowed)
        )
        assertEquals(
            true,
            KioskPreferences.isUrlAllowed("https://api.weather.com/v1", kiosk, true, customAllowed)
        )
        assertEquals(
            false,
            KioskPreferences.isUrlAllowed("https://facebook.com", kiosk, true, customAllowed)
        )
    }

    @Test
    fun themeMode_fromValue_parsesCorrectly() {
        assertEquals(ThemeMode.SYSTEM, ThemeMode.fromValue("system"))
        assertEquals(ThemeMode.LIGHT, ThemeMode.fromValue("light"))
        assertEquals(ThemeMode.DARK, ThemeMode.fromValue("dark"))
        assertEquals(ThemeMode.SYSTEM, ThemeMode.fromValue("invalid"))
        assertEquals(ThemeMode.SYSTEM, ThemeMode.fromValue(""))
    }

    @Test
    fun themeMode_isDark_resolvesCorrectly() {
        assertEquals(true, ThemeMode.DARK.isDark(systemDark = false))
        assertEquals(true, ThemeMode.DARK.isDark(systemDark = true))
        assertEquals(false, ThemeMode.LIGHT.isDark(systemDark = false))
        assertEquals(false, ThemeMode.LIGHT.isDark(systemDark = true))
        assertEquals(false, ThemeMode.SYSTEM.isDark(systemDark = false))
        assertEquals(true, ThemeMode.SYSTEM.isDark(systemDark = true))
    }
}
