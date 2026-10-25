package com.jacek.test.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jacek.test.app.data.KioskPreferences
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MainConfigScreen(
    currentUrl: String,
    pageZoom: Int,
    injectStatusBarPadding: Boolean,
    restrictUrls: Boolean,
    allowedDomains: Set<String>,
    hasOverlayPermission: Boolean,
    hasNotificationPermission: Boolean,
    isServiceRunning: Boolean,
    keepScreenOn: Boolean,
    showFloatingExit: Boolean,
    onSaveUrl: (String) -> Unit,
    onChangeZoom: (Int) -> Unit,
    onToggleStatusBarPadding: (Boolean) -> Unit,
    onToggleRestrictUrls: (Boolean) -> Unit,
    onAddAllowedDomain: (String) -> Unit,
    onRemoveAllowedDomain: (String) -> Unit,
    onRequestOverlayPermission: () -> Unit,
    onRequestNotificationPermission: () -> Unit,
    onToggleService: (Boolean) -> Unit,
    onToggleKeepScreenOn: (Boolean) -> Unit,
    onToggleShowFloatingExit: (Boolean) -> Unit,
    onOpenWebpage: () -> Unit,
    onLaunchKioskDirectly: () -> Unit
) {
    var urlInput by remember(currentUrl) { mutableStateOf(currentUrl) }
    var zoomSliderValue by remember(pageZoom) { mutableFloatStateOf(pageZoom.toFloat()) }
    var newDomainInput by remember { mutableStateOf("") }

    val presets = listOf(
        "HA Local (http)" to "http://homeassistant.local:8123",
        "HA Demo (https)" to "https://demo.home-assistant.io",
        "Google" to "https://www.google.com",
        "Wikipedia" to "https://en.m.wikipedia.org"
    )

    val zoomPresets = listOf(75, 100, 125, 150)
    val kioskHost = KioskPreferences.extractHost(currentUrl)

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        text = "Kiosk Configuration",
                        fontWeight = FontWeight.Bold
                    )
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Permissions Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "System Permissions",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    // Overlay Permission Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Display Over Other Apps",
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                text = if (hasOverlayPermission) "Granted (Required for lockscreen trigger)" else "Missing (Required to launch from background)",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (hasOverlayPermission) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                            )
                        }
                        if (!hasOverlayPermission) {
                            Button(
                                onClick = onRequestOverlayPermission,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.error
                                )
                            ) {
                                Icon(Icons.Default.Settings, contentDescription = null)
                                Spacer(modifier = Modifier.padding(horizontal = 2.dp))
                                Text("Grant")
                            }
                        } else {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = "Granted",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    // Notification Permission Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Notifications",
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                text = if (hasNotificationPermission) "Granted" else "Missing (Required for Foreground Service)",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (hasNotificationPermission) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                            )
                        }
                        if (!hasNotificationPermission) {
                            Button(onClick = onRequestNotificationPermission) {
                                Icon(Icons.Default.Notifications, contentDescription = null)
                                Spacer(modifier = Modifier.padding(horizontal = 2.dp))
                                Text("Allow")
                            }
                        } else {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = "Granted",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }

            // Kiosk Monitoring Service Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Lockscreen Kiosk Service",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (isServiceRunning) "Running (triggers kiosk on screen off/on)" else "Stopped",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Switch(
                        checked = isServiceRunning,
                        onCheckedChange = onToggleService,
                        enabled = hasOverlayPermission
                    )
                }
            }

            // URL Configuration Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Kiosk URL Configuration",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    OutlinedTextField(
                        value = urlInput,
                        onValueChange = { urlInput = it },
                        label = { Text("Webpage URL") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        Button(
                            onClick = { onSaveUrl(urlInput) },
                            enabled = urlInput.isNotBlank()
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                            Text("Save URL")
                        }
                    }

                    Text(
                        text = "Quick Presets:",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium
                    )

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        presets.forEach { (name, presetUrl) ->
                            FilterChip(
                                selected = (urlInput.trim() == presetUrl),
                                onClick = {
                                    urlInput = presetUrl
                                    onSaveUrl(presetUrl)
                                },
                                label = { Text(name) }
                            )
                        }
                    }
                }
            }

            // Custom Page Zoom Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.ZoomIn, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                            Text(
                                text = "Webpage Zoom Level",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        Text(
                            text = "${zoomSliderValue.roundToInt()}%",
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    Slider(
                        value = zoomSliderValue,
                        onValueChange = { zoomSliderValue = it },
                        onValueChangeFinished = {
                            val rounded = zoomSliderValue.roundToInt()
                            onChangeZoom(rounded)
                        },
                        valueRange = 50f..200f,
                        steps = 29
                    )

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        zoomPresets.forEach { preset ->
                            FilterChip(
                                selected = (zoomSliderValue.roundToInt() == preset),
                                onClick = {
                                    zoomSliderValue = preset.toFloat()
                                    onChangeZoom(preset)
                                },
                                label = { Text("$preset%") }
                            )
                        }
                    }
                }
            }

            // Allowed Webpages / Whitelist Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Security, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                            Column {
                                Text(
                                    text = "Limit Allowed Webpages",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = if (restrictUrls) "Only allowed domains can be opened" else "All webpages permitted",
                                    style = MaterialTheme.typography.bodySmall
                                )
                            }
                        }
                        Switch(
                            checked = restrictUrls,
                            onCheckedChange = onToggleRestrictUrls
                        )
                    }

                    if (restrictUrls) {
                        Text(
                            text = "Default Kiosk host ($kioskHost) is always allowed.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedTextField(
                                value = newDomainInput,
                                onValueChange = { newDomainInput = it },
                                label = { Text("Add allowed domain (e.g. auth.local)") },
                                modifier = Modifier.weight(1f),
                                singleLine = true
                            )
                            Button(
                                onClick = {
                                    if (newDomainInput.isNotBlank()) {
                                        onAddAllowedDomain(newDomainInput.trim())
                                        newDomainInput = ""
                                    }
                                },
                                enabled = newDomainInput.isNotBlank()
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null)
                                Text("Add")
                            }
                        }

                        if (allowedDomains.isNotEmpty()) {
                            Text(
                                text = "Additional Allowed Domains:",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium
                            )

                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                allowedDomains.forEach { domain ->
                                    InputChip(
                                        selected = true,
                                        onClick = { onRemoveAllowedDomain(domain) },
                                        label = { Text(domain) },
                                        trailingIcon = {
                                            Icon(
                                                imageVector = Icons.Default.Close,
                                                contentDescription = "Remove",
                                                modifier = Modifier.height(16.dp)
                                            )
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Behavior Settings Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Kiosk Layout & Behavior",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Pass Status Bar Inset to Webpage", fontWeight = FontWeight.Medium)
                            Text(
                                "Injects safe-area padding so content is not behind status bar",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Switch(
                            checked = injectStatusBarPadding,
                            onCheckedChange = onToggleStatusBarPadding
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Keep Screen On in Kiosk", fontWeight = FontWeight.Medium)
                            Text(
                                "Prevents kiosk screen from sleeping while active",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Switch(
                            checked = keepScreenOn,
                            onCheckedChange = onToggleKeepScreenOn
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Show Floating Unlock Button", fontWeight = FontWeight.Medium)
                            Text(
                                "Displays an on-screen Unlock / Reload bar",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Switch(
                            checked = showFloatingExit,
                            onCheckedChange = onToggleShowFloatingExit
                        )
                    }
                }
            }

            // Action Buttons
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onOpenWebpage,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null)
                    Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                    Text("Open Webpage (Preview in App)")
                }

                OutlinedButton(
                    onClick = onLaunchKioskDirectly,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Lock, contentDescription = null)
                    Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                    Text("Launch Kiosk Directly")
                }
            }
        }
    }
}
