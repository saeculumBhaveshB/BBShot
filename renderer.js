const { ipcRenderer } = require("electron");
const os = require("os");
const fs = require("fs");
const path = require("path");

document.getElementById("save").addEventListener("click", () => {
  const interval = document.getElementById("interval").value;
  ipcRenderer.send("set-interval", parseInt(interval, 10));
});

// Activity Monitoring UI Elements
const activityToggle = document.getElementById("activity-toggle");
const activityStatus = document.getElementById("activity-status");
const activityInterval = document.getElementById("activity-interval");
const setActivityIntervalBtn = document.getElementById("set-activity-interval");
const lastLogTime = document.getElementById("last-log-time");
const keysPressed = document.getElementById("keys-pressed");
const logFilePath = document.getElementById("log-file-path");

// Initialize variables to track app usage
let currentApp = null;
let appStartTime = null;
let idleStartTime = null;
const idleThreshold = 300000; // 5 minutes

// Function to log app usage
function logAppUsage(appName, duration) {
  console.log(`App: ${appName}, Duration: ${duration}ms`);
  // Add code to store this data in a database or file
}

// Function to handle app focus change
function onAppFocusChange(newApp) {
  const now = Date.now();
  if (currentApp) {
    const duration = now - appStartTime;
    logAppUsage(currentApp, duration);
  }
  currentApp = newApp;
  appStartTime = now;
}

// Function to detect idle time
function checkIdleTime() {
  const now = Date.now();
  if (currentApp && now - appStartTime > idleThreshold) {
    logAppUsage("Idle", now - appStartTime);
    currentApp = null;
  }
}

// Function to log detailed activity context
function logActivityContext(appName, context) {
  console.log(`App: ${appName}, Context: ${JSON.stringify(context)}`);
  // Add code to store this data in a database or file
}

// Example usage
window.addEventListener("focus", (event) => {
  const newApp = event.target.title; // Simplified example
  onAppFocusChange(newApp);
});

setInterval(checkIdleTime, 60000); // Check idle time every minute

// Add event listeners for specific actions like file open, tab switch, etc.
// Example: document.addEventListener('fileOpen', (event) => logActivityContext('VSCode', { file: event.fileName }));

// Initialize activity monitoring UI
document.addEventListener("DOMContentLoaded", async () => {
  // Get current activity monitoring state
  const isEnabled = await ipcRenderer.invoke("get-activity-monitoring-state");
  activityToggle.checked = isEnabled;
  activityStatus.textContent = isEnabled ? "ON" : "OFF";

  // Get log file path
  const path = await ipcRenderer.invoke("get-activity-log-path");
  if (path) {
    logFilePath.textContent = path;
  }
});

// Toggle activity monitoring
activityToggle.addEventListener("change", () => {
  const isEnabled = activityToggle.checked;
  ipcRenderer.send("toggle-activity-monitoring", isEnabled);
  activityStatus.textContent = isEnabled ? "ON" : "OFF";
});

// Set activity interval
setActivityIntervalBtn.addEventListener("click", () => {
  const interval = parseInt(activityInterval.value);
  if (interval >= 1000) {
    ipcRenderer.send("set-activity-interval", interval);
    showNotification(
      "Activity interval updated",
      `New interval: ${interval}ms`
    );
  } else {
    showNotification(
      "Invalid interval",
      "Interval must be at least 1000ms",
      "error"
    );
  }
});

// Listen for activity log updates
ipcRenderer.on("activity-logged", (event, data) => {
  lastLogTime.textContent = new Date(data.timestamp).toLocaleString();
  keysPressed.textContent = data.keyPressCount;
});

// Listen for activity monitoring state changes
ipcRenderer.on("activity-monitor-state-changed", (event, { enabled }) => {
  activityToggle.checked = enabled;
  activityStatus.textContent = enabled ? "ON" : "OFF";
  showNotification(
    "Activity Monitoring",
    `Activity monitoring has been turned ${enabled ? "ON" : "OFF"}`
  );
});

// Listen for activity log errors
ipcRenderer.on("activity-log-error", (event, { message }) => {
  showNotification("Activity Log Error", message, "error");
});

// Helper function to show notifications
function showNotification(title, message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <h4>${title}</h4>
    <p>${message}</p>
  `;

  document.body.appendChild(notification);

  // Remove notification after 3 seconds
  setTimeout(() => {
    notification.classList.add("fade-out");
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, 3000);
}

// Function to get system information
function getSystemInfo() {
  const platform = os.platform();
  const architecture = os.arch();
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const uptime = os.uptime();

  return {
    platform,
    architecture,
    cpuCount: cpus.length,
    totalMemory: (totalMemory / 1024 ** 3).toFixed(2) + " GB",
    freeMemory: (freeMemory / 1024 ** 3).toFixed(2) + " GB",
    uptime: (uptime / 3600).toFixed(2) + " hours",
  };
}

// Function to write system information to a JSON file
function writeSystemInfoToFile() {
  const systemInfo = getSystemInfo();
  const filePath = path.join(
    "/Users/saeculummac_1/Documents/BBShorts/ActivityLogs",
    "system-info.json"
  );

  fs.writeFile(filePath, JSON.stringify(systemInfo, null, 2), (err) => {
    if (err) {
      console.error("Error writing system information to file:", err);
    } else {
      console.log("System information written to", filePath);
      console.log("File path:", filePath);
    }
  });
}

// Call the function to write system information when the app launches
writeSystemInfoToFile();
