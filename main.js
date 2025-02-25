const { app, BrowserWindow, ipcMain, Tray } = require("electron");
const path = require("path");
const screenshot = require("screenshot-desktop");
const fs = require("fs");
const { execSync } = require("child_process");
const { GlobalKeyboardListener } = require("node-global-key-listener");

let mainWindow;
let tray;
let screenshotInterval = 10000; // Default to 10 seconds
let intervalId = null;
let activityMonitor = null;

function createWindow() {
  console.log("Creating window...");
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, "icon.png"),
    show: true,
  });

  console.log("Loading index.html...");
  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", () => {
  createWindow();
  setupTray();
  startScreenshotInterval();

  // Initialize activity monitor with default interval (5 seconds) and enabled
  activityMonitor = new ActivityMonitor(5000);
  activityMonitor.setEnabled(true); // Explicitly enable it
});

function setupTray() {
  try {
    tray = new Tray(path.join(__dirname, "assets", "icon.png"));
    tray.setToolTip("BBShorts");
    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (error) {
    console.error("Error setting up tray:", error);
  }
}

function startScreenshotInterval() {
  console.log(`Starting screenshot interval: ${screenshotInterval}ms`);

  if (intervalId) {
    clearInterval(intervalId);
  }

  takeScreenshot();
  intervalId = setInterval(takeScreenshot, screenshotInterval);
}

async function takeScreenshot() {
  console.log(`Taking screenshots at ${new Date().toLocaleString()}`);
  try {
    // Get all displays
    const displays = await screenshot.all();
    console.log(`Found ${displays.length} displays`);

    if (displays.length === 0) {
      throw new Error("No displays found");
    }

    // Create output directory if it doesn't exist
    const outputDir = path.join(app.getPath("pictures"), "BBShots");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create timestamp for this batch
    const timestamp = Date.now();

    // Save individual screenshots
    const screenshotPaths = [];
    for (let i = 0; i < displays.length; i++) {
      const filePath = path.join(
        outputDir,
        `screenshot-display-${i}-${timestamp}.png`
      );
      fs.writeFileSync(filePath, displays[i]);
      screenshotPaths.push(filePath);
      console.log(`Saved screenshot for display ${i} to ${filePath}`);
    }

    // For multiple displays, notify about individual screenshots
    if (screenshotPaths.length > 0) {
      console.log(
        `Saved ${screenshotPaths.length} screenshots to ${outputDir}`
      );

      // Notify renderer if window exists
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshots-taken", screenshotPaths);
      }
    }
  } catch (err) {
    console.error("Screenshot failed:", err);
  }
}

ipcMain.on("set-interval", (event, interval) => {
  screenshotInterval = interval;
  startScreenshotInterval();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  if (intervalId) {
    clearInterval(intervalId);
  }

  // Stop activity monitor
  if (activityMonitor) {
    activityMonitor.stop();
  }
});

// Add ActivityMonitor class
class ActivityMonitor {
  constructor(logInterval = 5000) {
    this.keyPressCount = 0;
    this.logInterval = logInterval;
    this.intervalId = null;
    this.keyboardListener = null;
    this.isEnabled = true; // Default to enabled

    // Create a more user-friendly location for the log file
    const logsDir = path.join(
      app.getPath("documents"),
      "BBShorts",
      "ActivityLogs"
    );

    // Create directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Use a date-based filename for better organization
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
    this.logFilePath = path.join(logsDir, `activity-log-${today}.json`);

    // Initialize log file if it doesn't exist
    if (!fs.existsSync(this.logFilePath)) {
      fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2));
      console.log(`Created new activity log file at: ${this.logFilePath}`);
    } else {
      console.log(`Using existing activity log file at: ${this.logFilePath}`);
    }
  }

  start() {
    if (!this.isEnabled) {
      console.log("Activity monitoring is disabled");
      return this;
    }

    console.log(
      `Starting keyboard activity monitoring with ${this.logInterval}ms interval`
    );

    // Initialize keyboard listener if not already created
    if (!this.keyboardListener) {
      this.keyboardListener = new GlobalKeyboardListener();
    }

    // Set up keyboard listener
    this.keyboardListener.addListener((e) => {
      // Only count key down events
      if (e.state === "DOWN") {
        this.keyPressCount++;
      }
    });

    // Clear any existing interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    // Log immediately and then at intervals
    this.logActivity();
    this.intervalId = setInterval(() => this.logActivity(), this.logInterval);

    return this;
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Remove keyboard listener
    if (this.keyboardListener) {
      this.keyboardListener.kill();
      this.keyboardListener = null;
    }

    console.log("Keyboard activity monitoring stopped");
  }

  // Add method to enable/disable monitoring
  setEnabled(enabled) {
    if (this.isEnabled === enabled) {
      return; // No change needed
    }

    this.isEnabled = enabled;
    console.log(`Activity monitoring ${enabled ? "enabled" : "disabled"}`);

    if (enabled) {
      this.start(); // Start monitoring if enabled
    } else {
      this.stop(); // Stop monitoring if disabled
    }

    // Notify renderer of state change
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("activity-monitor-state-changed", {
        enabled: this.isEnabled,
      });
    }
  }

  // Add method to get current enabled state
  isMonitoringEnabled() {
    return this.isEnabled;
  }

  setLogInterval(interval) {
    this.logInterval = interval;

    // Restart with new interval if already running
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }

  logActivity() {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        keyPressCount: this.keyPressCount,
        interval: this.logInterval,
        appRuntime: process.uptime(), // Add app runtime for additional context
      };

      // Reset counter after logging
      const countToLog = this.keyPressCount;
      this.keyPressCount = 0;

      // Read existing logs
      let logs = [];
      try {
        const fileContent = fs.readFileSync(this.logFilePath, "utf8");
        logs = JSON.parse(fileContent);

        // Ensure logs is an array
        if (!Array.isArray(logs)) {
          logs = [];
          console.warn("Log file did not contain an array, creating new array");
        }
      } catch (readError) {
        console.warn(
          "Error reading log file, creating new file:",
          readError.message
        );
        // If file is corrupted or can't be read, start with empty array
        logs = [];
      }

      // Add new log entry
      logs.push(logEntry);

      // Write updated logs back to file
      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));

      console.log(
        `Logged ${countToLog} key presses at ${timestamp} to ${this.logFilePath}`
      );

      // Notify renderer if window exists
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activity-logged", {
          ...logEntry,
          filePath: this.logFilePath,
          totalEntries: logs.length,
        });
      }
    } catch (error) {
      console.error("Error logging activity:", error);

      // Notify renderer of error
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activity-log-error", {
          message: error.message,
          filePath: this.logFilePath,
        });
      }
    }
  }

  // Add method to get log file path
  getLogFilePath() {
    return this.logFilePath;
  }

  // Add method to get all logs
  getAllLogs() {
    try {
      const fileContent = fs.readFileSync(this.logFilePath, "utf8");
      return JSON.parse(fileContent);
    } catch (error) {
      console.error("Error reading logs:", error);
      return [];
    }
  }
}

// Add IPC handler for setting activity log interval
ipcMain.on("set-activity-interval", (event, interval) => {
  if (activityMonitor) {
    activityMonitor.setLogInterval(interval);
  }
});

// Add IPC handler to get log file path
ipcMain.handle("get-activity-log-path", () => {
  if (activityMonitor) {
    return activityMonitor.getLogFilePath();
  }
  return null;
});

// Add IPC handler to get all logs
ipcMain.handle("get-all-activity-logs", () => {
  if (activityMonitor) {
    return activityMonitor.getAllLogs();
  }
  return [];
});

// Add IPC handler for toggling activity monitoring
ipcMain.on("toggle-activity-monitoring", (event, enabled) => {
  if (activityMonitor) {
    activityMonitor.setEnabled(enabled);
  }
});

// Add IPC handler to get current monitoring state
ipcMain.handle("get-activity-monitoring-state", () => {
  if (activityMonitor) {
    return activityMonitor.isMonitoringEnabled();
  }
  return false;
});
