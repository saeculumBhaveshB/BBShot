const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const os = require("os");

// Determine if we're running in Electron
let isElectron = false;
try {
  isElectron = !!process.versions.electron;
} catch (e) {
  isElectron = false;
}

// Check if another instance is already running
const lockFile = path.join(os.tmpdir(), "bbshots-watchdog.lock");
try {
  // Try to read the lock file
  if (fs.existsSync(lockFile)) {
    const pid = fs.readFileSync(lockFile, "utf8");
    let isRunning = false;

    // Check if the process with that PID is still running
    try {
      if (process.platform === "win32") {
        execSync(`tasklist /FI "PID eq ${pid}" /NH`, { windowsHide: true });
        isRunning = true;
      } else {
        process.kill(parseInt(pid), 0);
        isRunning = true;
      }
    } catch (e) {
      // Process not running, we can continue
      isRunning = false;
    }

    if (isRunning) {
      console.log(
        `Another watchdog is already running with PID ${pid}. Exiting.`
      );
      process.exit(0);
    }
  }

  // Write our PID to the lock file
  fs.writeFileSync(lockFile, process.pid.toString());
} catch (err) {
  console.error("Error checking for other watchdog instances:", err);
}

// Allow proper termination
process.on("SIGINT", () => {
  console.log("Received SIGINT - shutting down watchdog");
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM - shutting down watchdog");
  cleanup();
  process.exit(0);
});

process.on("SIGHUP", () => {
  console.log("Received SIGHUP - shutting down watchdog");
  cleanup();
  process.exit(0);
});

// Cleanup function to remove lock file on exit
function cleanup() {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (err) {
    console.error("Error cleaning up lock file:", err);
  }
}

// Make sure we clean up on exit
process.on("exit", cleanup);

// Set process name to something generic to make it harder to identify and kill
try {
  if (process.platform === "linux") {
    // On Linux, we can try to set the process title
    process.title = "system-service";
  }
} catch (err) {
  console.error("Failed to set process title:", err);
}

// Try to set process priority to high
try {
  if (process.platform === "win32") {
    // Windows
    execSync(
      `wmic process where processid=${process.pid} CALL setpriority "high priority"`,
      { windowsHide: true }
    );
  } else if (process.platform === "darwin" || process.platform === "linux") {
    // Unix-like systems
    try {
      execSync(`renice -n -10 -p ${process.pid}`);
    } catch (e) {
      // Ignore errors
    }
  }
} catch (err) {
  // Ignore errors
}

// Get app data path based on platform
function getAppDataPath() {
  const platform = process.platform;
  const homedir = os.homedir();

  if (platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(homedir, "AppData", "Roaming"),
      "BBShots"
    );
  } else if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", "BBShots");
  } else {
    return path.join(homedir, ".config", "BBShots");
  }
}

// Path to the main app executable
let appPath, appArgs;

// Determine the correct path based on platform and environment
if (process.platform === "darwin") {
  // macOS
  if (process.argv[2]) {
    // Use provided path if available
    appPath = process.argv[2];
  } else if (process.execPath.includes("MacOS")) {
    // If we're inside a .app bundle
    appPath = process.execPath;
  } else {
    // Development environment
    appPath = path.join(__dirname, "node_modules", ".bin", "electron");
  }
} else if (process.platform === "win32") {
  // Windows
  if (process.argv[2]) {
    appPath = process.argv[2];
  } else {
    // Check if we're in development or production
    const electronPath = path.join(
      __dirname,
      "node_modules",
      ".bin",
      "electron.cmd"
    );
    if (fs.existsSync(electronPath)) {
      appPath = electronPath;
    } else {
      // Assume we're in a packaged app
      appPath = path.join(process.cwd(), "BBShots.exe");
    }
  }
} else {
  // Linux or other platforms
  appPath =
    process.argv[2] || path.join(__dirname, "node_modules", ".bin", "electron");
}

// Default arguments
appArgs = ["."];

// Path to the watchdog file
const userDataPath = getAppDataPath();
const watchdogFile = path.join(userDataPath, "watchdog.txt");

// Ensure the directory exists
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

// Time threshold for considering the app as crashed (5 minutes)
const THRESHOLD_MS = 5 * 60 * 1000;

// Function to check if a process is running
function isProcessRunning(pid) {
  try {
    if (process.platform === "win32") {
      // Windows
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        windowsHide: true,
      }).toString();
      return output.includes(pid.toString());
    } else {
      // Unix-like systems
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return false;
      }
    }
  } catch (err) {
    return false;
  }
}

// Start the main app
function startApp() {
  console.log(`Starting BBShots app using: ${appPath}`);

  const options = {
    detached: true,
    stdio: "ignore",
  };

  // On Windows, we need to use shell: true for .cmd files
  if (process.platform === "win32" && appPath.endsWith(".cmd")) {
    options.shell = true;
  }

  try {
    const child = spawn(appPath, appArgs, options);

    // Store the PID for monitoring
    if (child && child.pid) {
      fs.writeFileSync(
        path.join(userDataPath, "app-pid.txt"),
        child.pid.toString()
      );
    }

    child.on("error", (err) => {
      console.error("Error starting app:", err);

      // Try alternative method if the first attempt fails
      if (process.platform === "win32") {
        console.log("Trying alternative method to start app on Windows...");
        const altChild = spawn("cmd.exe", ["/c", "start", appPath], {
          detached: true,
          stdio: "ignore",
          shell: true,
        });
        altChild.unref();

        // Try to get PID from the alternative method
        setTimeout(() => {
          try {
            // Look for the process by name
            const output = execSync(
              'tasklist /FI "IMAGENAME eq BBShots.exe" /NH',
              { windowsHide: true }
            ).toString();
            const match = output.match(/BBShots\.exe\s+(\d+)/);
            if (match && match[1]) {
              fs.writeFileSync(
                path.join(userDataPath, "app-pid.txt"),
                match[1]
              );
            }
          } catch (e) {
            // Ignore errors
          }
        }, 5000);
      } else if (process.platform === "darwin") {
        console.log("Trying alternative method to start app on macOS...");
        const altChild = spawn("open", [appPath], {
          detached: true,
          stdio: "ignore",
        });
        altChild.unref();

        // Try to get PID from the alternative method
        setTimeout(() => {
          try {
            // Look for the process by name
            const output = execSync("ps -ef | grep BBShots | grep -v grep", {
              windowsHide: true,
            }).toString();
            const match = output.match(/\s+(\d+)\s+/);
            if (match && match[1]) {
              fs.writeFileSync(
                path.join(userDataPath, "app-pid.txt"),
                match[1]
              );
            }
          } catch (e) {
            // Ignore errors
          }
        }, 5000);
      }
    });

    // Unref the child process so it can run independently
    child.unref();

    return child;
  } catch (error) {
    console.error("Failed to start app:", error);
    return null;
  }
}

// Check if the app is still running
function checkAppStatus() {
  try {
    // First check if we have a stored PID and if that process is running
    const pidFile = path.join(userDataPath, "app-pid.txt");
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, "utf8"));
      if (pid && isProcessRunning(pid)) {
        console.log(`App is running with PID ${pid}`);
        return;
      }
    }

    // If no PID or process not running, check the watchdog file
    if (!fs.existsSync(watchdogFile)) {
      console.log("Watchdog file not found, restarting app...");
      startApp();
      return;
    }

    // Read the last update time
    const lastUpdate = parseInt(fs.readFileSync(watchdogFile, "utf8"));
    const now = Date.now();

    // Check if the app has updated the file recently
    if (now - lastUpdate > THRESHOLD_MS) {
      console.log("App appears to be frozen or crashed, restarting...");
      startApp();
    } else {
      console.log("App is running normally based on watchdog file.");
    }
  } catch (error) {
    console.error("Error checking app status:", error);
    // If there's an error, try to restart the app
    startApp();
  }
}

// Start the app initially
let appProcess = startApp();

// Check the app status every 2 minutes
setInterval(checkAppStatus, 2 * 60 * 1000);

console.log(
  "BBShots watchdog started. The app will be monitored and restarted if needed."
);
