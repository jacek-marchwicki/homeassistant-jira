package com.jacek.test.app.ui.components

import androidx.annotation.StringRes
import com.jacek.test.app.R

sealed class WebErrorType {
    object NoInternet : WebErrorType()
    object HostUnreachable : WebErrorType()
    object ConnectionTimeout : WebErrorType()
    data class SslError(val message: String?) : WebErrorType()
    data class HttpError(val statusCode: Int) : WebErrorType()
    data class Generic(val description: String?) : WebErrorType()
}

data class WebErrorInfo(
    val errorType: WebErrorType,
    val failingUrl: String,
    val rawDescription: String? = null,
    val errorCode: Int? = null,
    val httpStatusCode: Int? = null
) {
    @get:StringRes
    val titleRes: Int
        get() = when (errorType) {
            is WebErrorType.NoInternet -> R.string.error_no_internet_title
            is WebErrorType.HostUnreachable -> R.string.error_host_unreachable_title
            is WebErrorType.ConnectionTimeout -> R.string.error_timeout_title
            is WebErrorType.SslError -> R.string.error_ssl_title
            is WebErrorType.HttpError -> R.string.error_server_title
            is WebErrorType.Generic -> R.string.error_generic_title
        }

    @get:StringRes
    val descriptionRes: Int
        get() = when (errorType) {
            is WebErrorType.NoInternet -> R.string.error_no_internet_desc
            is WebErrorType.HostUnreachable -> R.string.error_host_unreachable_desc
            is WebErrorType.ConnectionTimeout -> R.string.error_timeout_desc
            is WebErrorType.SslError -> R.string.error_ssl_desc
            is WebErrorType.HttpError -> R.string.error_server_desc
            is WebErrorType.Generic -> R.string.error_generic_desc
        }
}

object WebErrorClassifier {
    // Standard WebViewClient error codes
    const val ERROR_UNKNOWN = -1
    const val ERROR_HOST_LOOKUP = -2
    const val ERROR_UNSUPPORTED_AUTH_SCHEME = -3
    const val ERROR_AUTHENTICATION = -4
    const val ERROR_PROXY_AUTHENTICATION = -5
    const val ERROR_CONNECT = -6
    const val ERROR_IO = -7
    const val ERROR_TIMEOUT = -8
    const val ERROR_REDIRECT_LOOP = -9
    const val ERROR_UNSUPPORTED_SCHEME = -10
    const val ERROR_FAILED_SSL_HANDSHAKE = -11
    const val ERROR_BAD_URL = -12
    const val ERROR_FILE = -13
    const val ERROR_FILE_NOT_FOUND = -14
    const val ERROR_TOO_MANY_REQUESTS = -15

    fun classify(
        errorCode: Int?,
        description: String?,
        failingUrl: String,
        isNetworkConnected: Boolean
    ): WebErrorInfo {
        val descLower = description?.lowercase().orEmpty()
        val errorType = when {
            !isNetworkConnected ||
            descLower.contains("net::err_internet_disconnected") ||
            descLower.contains("err_network_changed") ||
            (errorCode == ERROR_HOST_LOOKUP && !isNetworkConnected) -> {
                WebErrorType.NoInternet
            }
            errorCode == ERROR_TIMEOUT ||
            descLower.contains("net::err_timed_out") ||
            descLower.contains("err_connection_timed_out") -> {
                WebErrorType.ConnectionTimeout
            }
            errorCode == ERROR_HOST_LOOKUP ||
            errorCode == ERROR_CONNECT ||
            descLower.contains("net::err_name_not_resolved") ||
            descLower.contains("net::err_connection_refused") ||
            descLower.contains("net::err_address_unreachable") ||
            descLower.contains("net::err_connection_reset") -> {
                WebErrorType.HostUnreachable
            }
            errorCode == ERROR_FAILED_SSL_HANDSHAKE ||
            descLower.contains("ssl") ||
            descLower.contains("cert") -> {
                WebErrorType.SslError(description)
            }
            else -> {
                WebErrorType.Generic(description)
            }
        }
        return WebErrorInfo(
            errorType = errorType,
            failingUrl = failingUrl,
            rawDescription = description,
            errorCode = errorCode
        )
    }

    fun classifyHttpError(
        statusCode: Int,
        failingUrl: String
    ): WebErrorInfo {
        return WebErrorInfo(
            errorType = WebErrorType.HttpError(statusCode),
            failingUrl = failingUrl,
            httpStatusCode = statusCode
        )
    }
}
