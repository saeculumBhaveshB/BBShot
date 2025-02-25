const { ipcRenderer } = require("electron");

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
