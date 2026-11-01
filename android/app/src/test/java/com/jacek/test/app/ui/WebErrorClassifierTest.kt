package com.jacek.test.app.ui

import com.jacek.test.app.ui.components.WebErrorClassifier
import com.jacek.test.app.ui.components.WebErrorType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WebErrorClassifierTest {

    private val testUrl = "http://homeassistant.local:8123"

    @Test
    fun classify_whenNoNetworkConnected_returnsNoInternet() {
        val result = WebErrorClassifier.classify(
            errorCode = WebErrorClassifier.ERROR_HOST_LOOKUP,
            description = "net::ERR_NAME_NOT_RESOLVED",
            failingUrl = testUrl,
            isNetworkConnected = false
        )
        assertTrue(result.errorType is WebErrorType.NoInternet)
        assertEquals(testUrl, result.failingUrl)
    }

    @Test
    fun classify_whenErrInternetDisconnectedInDescription_returnsNoInternet() {
        val result = WebErrorClassifier.classify(
            errorCode = -2,
            description = "net::ERR_INTERNET_DISCONNECTED",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.NoInternet)
    }

    @Test
    fun classify_whenHostLookupFailsAndNetworkIsConnected_returnsHostUnreachable() {
        val result = WebErrorClassifier.classify(
            errorCode = WebErrorClassifier.ERROR_HOST_LOOKUP,
            description = "net::ERR_NAME_NOT_RESOLVED",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.HostUnreachable)
    }

    @Test
    fun classify_whenConnectionRefused_returnsHostUnreachable() {
        val result = WebErrorClassifier.classify(
            errorCode = WebErrorClassifier.ERROR_CONNECT,
            description = "net::ERR_CONNECTION_REFUSED",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.HostUnreachable)
    }

    @Test
    fun classify_whenAddressUnreachable_returnsHostUnreachable() {
        val result = WebErrorClassifier.classify(
            errorCode = -1,
            description = "net::ERR_ADDRESS_UNREACHABLE",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.HostUnreachable)
    }

    @Test
    fun classify_whenTimeout_returnsConnectionTimeout() {
        val result = WebErrorClassifier.classify(
            errorCode = WebErrorClassifier.ERROR_TIMEOUT,
            description = "net::ERR_TIMED_OUT",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.ConnectionTimeout)
    }

    @Test
    fun classify_whenSslHandshakeFails_returnsSslError() {
        val result = WebErrorClassifier.classify(
            errorCode = WebErrorClassifier.ERROR_FAILED_SSL_HANDSHAKE,
            description = "net::ERR_CERT_AUTHORITY_INVALID",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.SslError)
    }

    @Test
    fun classifyHttpError_returnsHttpErrorWithCode() {
        val result = WebErrorClassifier.classifyHttpError(
            statusCode = 502,
            failingUrl = testUrl
        )
        val errorType = result.errorType as WebErrorType.HttpError
        assertEquals(502, errorType.statusCode)
    }

    @Test
    fun classify_whenGenericUnknownError_returnsGeneric() {
        val result = WebErrorClassifier.classify(
            errorCode = WebErrorClassifier.ERROR_UNKNOWN,
            description = "Something went wrong",
            failingUrl = testUrl,
            isNetworkConnected = true
        )
        assertTrue(result.errorType is WebErrorType.Generic)
    }
}
