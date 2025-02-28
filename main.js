const { app, BrowserWindow, ipcMain, Tray, Menu } = require("electron");
const path = require("path");
const screenshot = require("screenshot-desktop");
const fs = require("fs");
const { execSync } = require("child_process");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const AutoLaunch = require("auto-launch");
const { globalShortcut } = require("electron");
const { spawn } = require("child_process");

let mainWindow;
let tray;
let screenshotInterval = 10000; // Default to 10 seconds
let intervalId = null;
let activityMonitor = null;
let watchdogProcess = null;

// Ensure app is single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // This is a second instance, quit immediately
  app.quit();
} else {
  // This is the main instance
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Setup auto-restart mechanism but don't create multiple instances
  setupAutoRestart();
}

// Function to setup auto-restart mechanism
function setupAutoRestart() {
  // Create a watchdog file to indicate the app is running
  const watchdogFile = path.join(app.getPath("userData"), "watchdog.txt");

  // Write current timestamp to watchdog file
  function updateWatchdog() {
    fs.writeFileSync(watchdogFile, Date.now().toString());
  }

  // Update watchdog file every minute
  setInterval(updateWatchdog, 60000);
  updateWatchdog(); // Initial update

  // Setup auto-launch with system - but only once
  let appPath;
  if (process.platform === "darwin") {
    // For macOS, we need the .app bundle path
    appPath = process.execPath.replace(/Contents\/MacOS\/Electron$/, "");
  } else if (process.platform === "win32") {
    // For Windows, use the exe path
    appPath = process.execPath;
  } else {
    // For Linux or other platforms
    appPath = process.execPath;
  }

  const bbshotsAutoLauncher = new AutoLaunch({
    name: "BBShots",
    path: appPath,
    isHidden: true,
  });

  bbshotsAutoLauncher
    .isEnabled()
    .then((isEnabled) => {
      if (!isEnabled) {
        bbshotsAutoLauncher
          .enable()
          .then(() => {
            console.log("Auto-launch enabled successfully");
          })
          .catch((err) => {
            console.error("Error enabling auto-launch:", err);
          });
      } else {
        console.log("Auto-launch is already enabled");
      }
    })
    .catch((err) => {
      console.error("Error checking auto-launch status:", err);
    });
}

// Create application menu
function createAppMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideothers" },
              { role: "unhide" },
              // No quit option
            ],
          },
        ]
      : []),
    // File menu
    {
      label: "File",
      submenu: [
        {
          label: "Hide Window",
          click: () => {
            if (mainWindow) {
              mainWindow.hide();
            }
          },
        },
        { type: "separator" },
        {
          label: "App runs persistently in background",
          enabled: false,
        },
      ],
    },
    // Edit menu
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
      ],
    },
    // View menu
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // Help menu
    {
      label: "Help",
      submenu: [
        {
          label: "About BBShots",
          click: async () => {
            const { shell } = require("electron");
            await shell.openExternal("https://github.com/seaculum/BBShot");
          },
        },
        { type: "separator" },
        {
          label: "BBShots runs continuously in background",
          enabled: false,
        },
        {
          label: "App can only be removed by uninstalling",
          enabled: false,
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

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

  mainWindow.on("close", (event) => {
    // Prevent the window from closing by default
    event.preventDefault();

    // Hide the window instead of closing it
    mainWindow.hide();

    // Notify the user that the app is still running in the background
    mainWindow.webContents.send("app-minimized-to-tray", {
      message:
        "BBShots is still running in the background. You can access it from the system tray.",
    });

    return false;
  });

  // Register global shortcut to show app window (Cmd+Shift+B or Ctrl+Shift+B)
  globalShortcut.register("CommandOrControl+Shift+B", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  setupTray();
}

function setupTray() {
  try {
    tray = new Tray(path.join(__dirname, "assets", "icon.png"));
    tray.setToolTip("BBShots - Always Running");

    const contextMenu = Menu.buildFromTemplate([
      { label: "Show App", click: () => mainWindow.show() },
      { type: "separator" },
      { label: "Status: Always Running", enabled: false },
      { label: "BBShots is running in the background", enabled: false },
      { type: "separator" },
      {
        label: "About BBShots",
        click: async () => {
          const { shell } = require("electron");
          await shell.openExternal("https://github.com/seaculum/BBShot");
        },
      },
      // Hidden developer option - only accessible if you know it's there
      { type: "separator" },
      {
        label: "DEVELOPER: Force Quit App",
        visible: process.env.NODE_ENV === "development",
        click: () => {
          // This is a special force quit that bypasses our prevention mechanisms
          // It should only be used during development
          app.exit(0); // Force quit with exit code 0
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (error) {
    console.error("Error setting up tray:", error);
  }
}

app.whenReady().then(() => {
  createWindow();
  startScreenshotInterval();
  createAppMenu();

  // Initialize activity monitor
  activityMonitor = new ActivityMonitor();
  activityMonitor.start(); // Start monitoring

  // Prevent the app from being terminated by intercepting quit signals
  process.on("SIGINT", () => {
    console.log("Received SIGINT - ignoring and continuing to run");
    // Prevent default quit behavior
    return false;
  });

  process.on("SIGTERM", () => {
    console.log("Received SIGTERM - ignoring and continuing to run");
    // Prevent default quit behavior
    return false;
  });

  process.on("SIGHUP", () => {
    console.log("Received SIGHUP - ignoring and continuing to run");
    // Prevent default quit behavior
    return false;
  });

  // Prevent the app from quitting
  app.on("before-quit", (event) => {
    console.log("Preventing app from quitting");
    event.preventDefault();

    // If the window exists, just hide it instead
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }

    return false;
  });
});

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

  // Update activity monitor interval to match
  if (activityMonitor) {
    activityMonitor.setLogInterval(interval);
  }
});

// Prevent app from quitting when all windows are closed
app.on("window-all-closed", () => {
  console.log("All windows closed, but keeping app running in the background");
  // Do not call app.quit() here to keep the app running
  return false;
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Add ActivityMonitor class
class ActivityMonitor {
  constructor(logInterval = 5000) {
    this.keyPressCount = 0;
    this.mouseClickCount = 0;
    this.logInterval = logInterval;
    this.intervalId = null;
    this.globalListener = null; // Single listener for both keyboard and mouse
    this.isEnabled = true; // Default to enabled
    this.activeApp = null;
    this.activeUrl = null;
    this.detailedContent = null;

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
      `Starting keyboard and mouse activity monitoring with ${this.logInterval}ms interval`
    );

    // Initialize global listener if not already created
    if (!this.globalListener) {
      this.globalListener = new GlobalKeyboardListener();
    }

    // Set up a single listener with clear conditions to differentiate events
    this.globalListener.addListener((e) => {
      if (e.state === "DOWN") {
        // Check if it's a mouse event based on the actual event structure
        if (e.name && e.name.includes("MOUSE")) {
          this.mouseClickCount++;
          console.log(
            `Mouse click detected: ${e.name}, count: ${this.mouseClickCount}`
          );
        }
        // Otherwise it's a keyboard event
        else {
          this.keyPressCount++;
          console.log(
            `Keyboard press detected: ${e.name}, count: ${this.keyPressCount}`
          );
        }
      }
    });

    // Clear any existing interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    // Log immediately and then at intervals
    this.updateActiveAppAndUrl();
    this.logActivity();
    this.intervalId = setInterval(() => {
      this.updateActiveAppAndUrl();
      this.logActivity();
    }, this.logInterval);

    return this;
  }

  // Get active application and URL
  updateActiveAppAndUrl() {
    try {
      this.getActiveApplication();
      this.getActiveUrl();
    } catch (error) {
      console.error("Error updating active app and URL:", error);
    }
  }

  // Get the currently active application with robust error handling
  getActiveApplication() {
    try {
      let activeApp = "Unknown";
      let detailedContent = "Unknown content";

      // Platform-specific implementations
      if (process.platform === "darwin") {
        // macOS implementation
        try {
          // Get the active application name
          const script =
            'tell application "System Events" to get name of first application process whose frontmost is true';
          activeApp = execSync(`osascript -e '${script}'`).toString().trim();

          // Get the window title for more details
          const titleScript = `
            tell application "System Events"
              tell process "${activeApp}"
                try
                  set windowTitle to name of window 1
                  return windowTitle
                on error
                  return "No window title available"
                end try
              end tell
            end tell
          `;

          const windowTitle = execSync(`osascript -e '${titleScript}'`)
            .toString()
            .trim();
          console.log(`Window title: ${windowTitle}`);

          // Process specific applications
          if (activeApp.toLowerCase().includes("code")) {
            // VSCode
            if (windowTitle.includes(" - ")) {
              const parts = windowTitle.split(" - ");
              if (parts.length >= 2) {
                const file = parts[0];
                const project =
                  parts.length >= 3 ? parts[1] : "Unknown project";
                const fileExt = path.extname(file).toLowerCase();
                detailedContent = `Project: ${project}, File: ${file}`;
              } else {
                detailedContent = windowTitle;
              }
            } else {
              detailedContent = windowTitle;
            }
          } else if (
            activeApp.toLowerCase().includes("chrome") ||
            activeApp.toLowerCase().includes("safari") ||
            activeApp.toLowerCase().includes("firefox")
          ) {
            // Browser - will get more details in getActiveUrl
            detailedContent = windowTitle;
          } else if (activeApp.toLowerCase().includes("slack")) {
            // Slack
            if (windowTitle.includes(" | Slack")) {
              const channel = windowTitle.replace(" | Slack", "");
              detailedContent = `Channel: ${channel}`;
            } else {
              detailedContent = windowTitle;
            }
          } else if (
            activeApp.toLowerCase().includes("terminal") ||
            activeApp.toLowerCase().includes("iterm")
          ) {
            // Terminal
            detailedContent = `Terminal: ${windowTitle}`;
          } else {
            // Other applications
            detailedContent = windowTitle;
          }
        } catch (macError) {
          console.error("Error getting macOS application details:", macError);
          activeApp = "Unknown macOS application";
          detailedContent = "Error getting details";
        }
      } else if (process.platform === "win32") {
        // Windows implementation
        try {
          // Use a simpler, more reliable PowerShell command
          const output = execSync(
            "powershell \"Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1 | Format-List Name, MainWindowTitle\""
          )
            .toString()
            .trim();

          const nameMatch = output.match(/Name\s*:\s*(.*)/);
          const titleMatch = output.match(/MainWindowTitle\s*:\s*(.*)/);

          const processName = nameMatch ? nameMatch[1].trim() : "Unknown";
          const windowTitle = titleMatch ? titleMatch[1].trim() : "";

          activeApp = processName;

          // Process specific applications
          if (processName.toLowerCase().includes("code")) {
            // VSCode
            if (windowTitle.includes(" - ")) {
              const parts = windowTitle.split(" - ");
              if (parts.length >= 2) {
                const file = parts[0];
                const project =
                  parts.length >= 3 ? parts[1] : "Unknown project";
                detailedContent = `Project: ${project}, File: ${file}`;
              } else {
                detailedContent = windowTitle;
              }
            } else {
              detailedContent = windowTitle;
            }
          } else if (
            processName.toLowerCase().includes("chrome") ||
            processName.toLowerCase().includes("firefox") ||
            processName.toLowerCase().includes("edge") ||
            processName.toLowerCase().includes("iexplore")
          ) {
            // Browser - will get more details in getActiveUrl
            detailedContent = windowTitle;
          } else if (processName.toLowerCase().includes("slack")) {
            // Slack
            if (windowTitle.includes(" | Slack")) {
              const channel = windowTitle.replace(" | Slack", "");
              detailedContent = `Channel: ${channel}`;
            } else {
              detailedContent = windowTitle;
            }
          } else {
            // Other applications
            detailedContent = windowTitle;
          }
        } catch (winError) {
          console.error("Error getting Windows application details:", winError);

          // Try an even simpler approach as fallback
          try {
            const simpleOutput = execSync(
              "powershell \"Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1 -ExpandProperty Name\""
            )
              .toString()
              .trim();

            activeApp = simpleOutput;
            detailedContent = "Window title unavailable";
          } catch (fallbackError) {
            console.error("Fallback also failed:", fallbackError);
            activeApp = "Unknown Windows application";
            detailedContent = "Error getting details";
          }
        }
      } else if (process.platform === "linux") {
        // Linux implementation
        try {
          // First try xdotool which is commonly available
          const windowId = execSync("xdotool getactivewindow")
            .toString()
            .trim();
          const windowName = execSync(`xdotool getwindowname ${windowId}`)
            .toString()
            .trim();
          const processName = execSync(
            `xdotool getwindowpid ${windowId} | xargs -I{} ps -p {} -o comm=`
          )
            .toString()
            .trim();

          activeApp = processName;

          // Process specific applications
          if (processName.toLowerCase().includes("code")) {
            // VSCode
            if (windowName.includes(" - ")) {
              const parts = windowName.split(" - ");
              if (parts.length >= 2) {
                const file = parts[0];
                const project =
                  parts.length >= 3 ? parts[1] : "Unknown project";
                detailedContent = `Project: ${project}, File: ${file}`;
              } else {
                detailedContent = windowName;
              }
            } else {
              detailedContent = windowName;
            }
          } else if (
            processName.toLowerCase().includes("chrome") ||
            processName.toLowerCase().includes("firefox") ||
            processName.toLowerCase().includes("chromium")
          ) {
            // Browser - will get more details in getActiveUrl
            detailedContent = windowName;
          } else if (processName.toLowerCase().includes("slack")) {
            // Slack
            if (windowName.includes(" | Slack")) {
              const channel = windowName.replace(" | Slack", "");
              detailedContent = `Channel: ${channel}`;
            } else {
              detailedContent = windowName;
            }
          } else {
            // Other applications
            detailedContent = windowName;
          }
        } catch (linuxError) {
          console.error(
            "Error getting Linux application details with xdotool:",
            linuxError
          );

          // Try wmctrl as fallback
          try {
            const windowInfo = execSync("wmctrl -a :ACTIVE: -v")
              .toString()
              .trim();
            const windowTitle = windowInfo.split("\n").pop() || "Unknown";

            activeApp = "Unknown Linux App";
            detailedContent = windowTitle;
          } catch (fallbackError) {
            console.error("Fallback with wmctrl also failed:", fallbackError);
            activeApp = "Unknown Linux application";
            detailedContent = "Error getting details";
          }
        }
      } else {
        activeApp = "Unknown (Unsupported OS)";
        detailedContent = "Unknown content";
      }

      this.activeApp = activeApp;
      this.detailedContent = detailedContent;
      console.log(`Active application: ${this.activeApp}`);
      console.log(`Detailed content: ${this.detailedContent}`);
      return activeApp;
    } catch (error) {
      console.error("Error getting active application:", error);
      this.activeApp = "Error detecting application";
      this.detailedContent = "Error detecting content";
      return this.activeApp;
    }
  }

  // Get the active URL from browsers with robust error handling
  getActiveUrl() {
    try {
      let activeUrl = null;
      let pageTitle = null;

      // Check if the active application is a known browser
      const browsers = [
        "chrome",
        "firefox",
        "safari",
        "edge",
        "brave",
        "opera",
        "chromium",
      ];
      const activeBrowser = browsers.find(
        (browser) =>
          this.activeApp && this.activeApp.toLowerCase().includes(browser)
      );

      if (activeBrowser) {
        if (process.platform === "darwin") {
          // macOS implementation
          let script = "";
          let titleScript = "";

          if (
            activeBrowser === "chrome" ||
            activeBrowser === "brave" ||
            activeBrowser === "chromium" ||
            activeBrowser === "edge"
          ) {
            script = `tell application "Google Chrome" to get URL of active tab of front window`;
            titleScript = `tell application "Google Chrome" to get title of active tab of front window`;
          } else if (activeBrowser === "safari") {
            script = `tell application "Safari" to get URL of current tab of front window`;
            titleScript = `tell application "Safari" to get name of current tab of front window`;
          } else if (activeBrowser === "firefox") {
            // Firefox is more complex and may require a browser extension
            activeUrl = "Firefox URL detection requires extension";

            // Try to get the page title from window title
            try {
              const firefoxTitleScript =
                'tell application "System Events" to get name of window 1 of process "Firefox"';
              const windowTitle = execSync(
                `osascript -e '${firefoxTitleScript}'`
              )
                .toString()
                .trim();
              // Firefox window title format: "Page Title - Mozilla Firefox"
              pageTitle = windowTitle.replace(" - Mozilla Firefox", "");
            } catch (err) {
              console.error("Error getting Firefox title:", err);
              pageTitle = "Unknown page";
            }
          }

          if (script) {
            try {
              activeUrl = execSync(`osascript -e '${script}'`)
                .toString()
                .trim();
              // Also get the page title for more context
              if (titleScript) {
                pageTitle = execSync(`osascript -e '${titleScript}'`)
                  .toString()
                  .trim();
              }
            } catch (error) {
              console.error(`Error getting URL from ${activeBrowser}:`, error);
              activeUrl = `Error getting URL from ${activeBrowser}`;
              pageTitle = "Unknown page";
            }
          }
        } else if (process.platform === "win32") {
          // For Windows, we can try to get the browser tab title which often includes the page title
          // This is a partial solution - full URL detection would need browser extensions
          if (this.detailedContent) {
            // The window title often contains the page title
            pageTitle = this.detailedContent;

            // For Chrome-based browsers, we can try to extract more info
            if (
              activeBrowser === "chrome" ||
              activeBrowser === "edge" ||
              activeBrowser === "brave"
            ) {
              // Try to use Chrome DevTools Protocol (requires Chrome to be started with remote debugging)
              try {
                // This is a placeholder - actual implementation would require setting up CDP
                activeUrl =
                  "URL detection on Windows requires extension or remote debugging";
              } catch (err) {
                console.error("Error using CDP for URL detection:", err);
                activeUrl = "URL detection failed";
              }
            } else {
              activeUrl = "URL detection on Windows requires extension";
            }
          }
        } else if (process.platform === "linux") {
          // For Linux, we can try to get the browser tab title from window title
          if (this.detailedContent) {
            pageTitle = this.detailedContent;

            // For Firefox on Linux, we might extract from window title
            if (
              activeBrowser === "firefox" &&
              pageTitle.includes(" - Mozilla Firefox")
            ) {
              pageTitle = pageTitle.replace(" - Mozilla Firefox", "");
            }
            // For Chrome on Linux
            else if (
              (activeBrowser === "chrome" || activeBrowser === "chromium") &&
              pageTitle.includes(" - Google Chrome")
            ) {
              pageTitle = pageTitle.replace(" - Google Chrome", "");
            }

            activeUrl = "URL detection on Linux requires extension";
          }
        } else {
          activeUrl = "URL detection not implemented for this OS";
          pageTitle = "Unknown page";
        }

        // Update detailed content for browsers
        this.detailedContent = `Page: ${pageTitle || "Unknown"}, URL: ${
          activeUrl || "Unknown"
        }`;
      }

      this.activeUrl = activeUrl;
      console.log(`Active URL: ${this.activeUrl}`);
      console.log(`Page Title: ${pageTitle || "Unknown"}`);
      return activeUrl;
    } catch (error) {
      console.error("Error getting active URL:", error);
      this.activeUrl = "Error detecting URL";
      return this.activeUrl;
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Remove global listener
    if (this.globalListener) {
      this.globalListener.kill();
      this.globalListener = null;
    }

    console.log("Keyboard and mouse activity monitoring stopped");
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

      // Log the current counts before resetting
      console.log(
        `Current counts - Keyboard: ${this.keyPressCount}, Mouse: ${this.mouseClickCount}`
      );

      const logEntry = {
        timestamp,
        keyPressCount: this.keyPressCount,
        mouseClickCount: this.mouseClickCount,
        interval: this.logInterval,
        appRuntime: process.uptime(),
        activeApplication: this.activeApp,
        activeUrl: this.activeUrl,
        detailedContent: this.detailedContent || "No content details available",
      };

      // Reset counters after logging
      const keysToLog = this.keyPressCount;
      const clicksToLog = this.mouseClickCount;
      this.keyPressCount = 0;
      this.mouseClickCount = 0;

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
        `Logged ${keysToLog} key presses and ${clicksToLog} mouse clicks at ${timestamp} to ${this.logFilePath}`
      );
      console.log(`Active app: ${this.activeApp}, URL: ${this.activeUrl}`);

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

  // Get current active application and URL
  getCurrentActiveInfo() {
    return {
      activeApplication: this.activeApp,
      activeUrl: this.activeUrl,
      detailedContent: this.detailedContent || "No content details available",
    };
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

// Add IPC handler to get current active application and URL
ipcMain.handle("get-active-app-info", () => {
  if (activityMonitor) {
    return activityMonitor.getCurrentActiveInfo();
  }
  return { activeApplication: null, activeUrl: null, detailedContent: null };
});

const autoLauncher = new AutoLaunch({
  name: "ActivityMonitor",
});

autoLauncher
  .isEnabled()
  .then((isEnabled) => {
    if (!isEnabled) autoLauncher.enable();
  })
  .catch((err) => {
    console.error("Auto-launch error:", err);
  });
