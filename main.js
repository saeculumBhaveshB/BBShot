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

  // Initialize activity monitor with default interval (5 seconds)
  activityMonitor = new ActivityMonitor(5000).start();
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
    this.keyboardListener = new GlobalKeyboardListener();
    this.logFilePath = path.join(app.getPath("userData"), "activity-logs.json");

    // Initialize log file if it doesn't exist
    if (!fs.existsSync(this.logFilePath)) {
      fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2));
    }
  }

  start() {
    console.log(
      `Starting keyboard activity monitoring with ${this.logInterval}ms interval`
    );

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
    this.keyboardListener.kill();
    console.log("Keyboard activity monitoring stopped");
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
      };

      // Reset counter after logging
      const countToLog = this.keyPressCount;
      this.keyPressCount = 0;

      // Read existing logs
      const logs = JSON.parse(fs.readFileSync(this.logFilePath, "utf8"));

      // Add new log entry
      logs.push(logEntry);

      // Write updated logs back to file
      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));

      console.log(`Logged ${countToLog} key presses at ${timestamp}`);

      // Notify renderer if window exists
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activity-logged", logEntry);
      }
    } catch (error) {
      console.error("Error logging activity:", error);

      // Notify renderer of error
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activity-log-error", error.message);
      }
    }
  }
}

// Add IPC handler for setting activity log interval
ipcMain.on("set-activity-interval", (event, interval) => {
  if (activityMonitor) {
    activityMonitor.setLogInterval(interval);
  }
});
