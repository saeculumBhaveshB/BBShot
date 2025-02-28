const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Set process name to something generic to make it harder to identify and kill
try {
  if (process.platform === "linux") {
    // On Linux, we can try to set the process title
    process.title = "system-service-manager";
  }
} catch (err) {
  console.error("Failed to set process title:", err);
}

// Handle termination signals - prevent the startup script from being killed
process.on("SIGINT", () => {
  console.log("Ignoring SIGINT - startup must complete");
  return false;
});

process.on("SIGTERM", () => {
  console.log("Ignoring SIGTERM - startup must complete");
  return false;
});

process.on("SIGHUP", () => {
  console.log("Ignoring SIGHUP - startup must complete");
  return false;
});

// Get the app directory - handle both development and production environments
const isPackaged = !process.execPath.includes("node_modules");
const appDir = isPackaged ? path.dirname(process.execPath) : __dirname;

console.log(`Running in ${isPackaged ? "production" : "development"} mode`);
console.log(`App directory: ${appDir}`);

// Create a log directory for debugging
const logsDir = path.join(isPackaged ? appDir : os.homedir(), "BBShots_Logs");
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (err) {
    console.error(`Error creating logs directory: ${err.message}`);
  }
}

// Setup logging
const logFile = path.join(
  logsDir,
  `startup-${new Date().toISOString().replace(/:/g, "-")}.log`
);
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (err) {
    // Ignore errors
  }
}

// Determine paths based on platform and environment
let watchdogPath, nodePath;

if (process.platform === "darwin") {
  // macOS paths
  if (isPackaged) {
    // Production - inside .app bundle
    watchdogPath = path.join(appDir, "Resources", "app", "watchdog.js");
    nodePath = "/usr/local/bin/node"; // Use system Node on macOS

    // Fallback to bundled node if available
    if (fs.existsSync(path.join(appDir, "Resources", "app", "node"))) {
      nodePath = path.join(appDir, "Resources", "app", "node");
    }
  } else {
    // Development
    watchdogPath = path.join(appDir, "watchdog.js");
    nodePath = process.execPath;
  }
} else if (process.platform === "win32") {
  // Windows paths
  if (isPackaged) {
    // Production
    watchdogPath = path.join(appDir, "resources", "app", "watchdog.js");
    nodePath = path.join(appDir, "resources", "app", "node.exe");

    // Fallback to system Node if bundled node doesn't exist
    if (!fs.existsSync(nodePath)) {
      nodePath = "node";
    }
  } else {
    // Development
    watchdogPath = path.join(appDir, "watchdog.js");
    nodePath = process.execPath;
  }
} else {
  // Linux or other platforms
  watchdogPath = path.join(appDir, "watchdog.js");
  nodePath = process.execPath;
}

// Function to start the watchdog process
function startWatchdog() {
  log(`Starting BBShots watchdog using node: ${nodePath}`);
  log(`Watchdog script path: ${watchdogPath}`);

  // Verify files exist
  if (!fs.existsSync(watchdogPath)) {
    log(`ERROR: Watchdog script not found at ${watchdogPath}`);

    // Try to find the watchdog script
    const possibleLocations = [
      path.join(appDir, "watchdog.js"),
      path.join(appDir, "resources", "app", "watchdog.js"),
      path.join(appDir, "Resources", "app", "watchdog.js"),
      path.join(appDir, "..", "watchdog.js"),
      // Add more possible locations
      path.join(appDir, "app", "watchdog.js"),
      path.join(appDir, "app.asar", "watchdog.js"),
      path.join(appDir, "resources", "app.asar", "watchdog.js"),
      path.join(appDir, "Resources", "app.asar", "watchdog.js"),
    ];

    for (const location of possibleLocations) {
      if (fs.existsSync(location)) {
        log(`Found watchdog script at ${location}`);
        watchdogPath = location;
        break;
      }
    }

    if (!fs.existsSync(watchdogPath)) {
      // If still not found, try to create a basic watchdog script
      log("Could not find watchdog script. Creating a basic one.");

      const basicWatchdogPath = path.join(os.tmpdir(), "bbshots-watchdog.js");
      const basicWatchdogContent = `
        const { spawn, execSync } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // Get app path
        const appPath = ${JSON.stringify(
          process.platform === "darwin"
            ? path.join(appDir, "MacOS", "BBShots")
            : path.join(appDir, "BBShots.exe")
        )};
        
        // Start the app
        function startApp() {
          console.log('Starting BBShots app');
          const child = spawn(appPath, [], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
        }
        
        // Start initially
        startApp();
        
        // Check and restart every 5 minutes
        setInterval(() => {
          try {
            // Check if app is running by name
            let isRunning = false;
            if (process.platform === 'win32') {
              const output = execSync('tasklist /FI "IMAGENAME eq BBShots.exe" /NH').toString();
              isRunning = output.includes('BBShots.exe');
            } else {
              const output = execSync('ps -ef | grep BBShots | grep -v grep').toString();
              isRunning = output.length > 0;
            }
            
            if (!isRunning) {
              console.log('BBShots not running, restarting...');
              startApp();
            }
          } catch (err) {
            console.error('Error checking app status:', err);
            startApp();
          }
        }, 5 * 60 * 1000);
        
        // Keep running
        setInterval(() => {}, 1000);
      `;

      try {
        fs.writeFileSync(basicWatchdogPath, basicWatchdogContent);
        watchdogPath = basicWatchdogPath;
        log(`Created basic watchdog at ${watchdogPath}`);
      } catch (err) {
        log(`Error creating basic watchdog: ${err.message}`);
        return;
      }
    }
  }

  // Options for spawn
  const options = {
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(watchdogPath),
  };

  // On Windows, we need shell: true for cmd files
  if (process.platform === "win32" && nodePath.endsWith(".cmd")) {
    options.shell = true;
  }

  // Try multiple methods to start the watchdog
  const startMethods = [
    // Method 1: Direct spawn
    () => {
      log("Trying method 1: Direct spawn");
      try {
        const child = spawn(nodePath, [watchdogPath], options);
        child.on("error", (err) => {
          log(`Method 1 error: ${err.message}`);
          // Try next method on error
          startWithNextMethod(1);
        });
        child.unref();
        return true;
      } catch (err) {
        log(`Method 1 failed: ${err.message}`);
        return false;
      }
    },

    // Method 2: Platform-specific approach
    () => {
      log("Trying method 2: Platform-specific approach");
      try {
        if (process.platform === "win32") {
          const child = spawn(
            "cmd.exe",
            ["/c", "start", "/b", nodePath, watchdogPath],
            {
              detached: true,
              stdio: "ignore",
              shell: true,
              windowsHide: true,
            }
          );
          child.unref();
        } else if (process.platform === "darwin") {
          const child = spawn(
            "/bin/bash",
            ["-c", `${nodePath} ${watchdogPath} > /dev/null 2>&1 &`],
            {
              detached: true,
              stdio: "ignore",
            }
          );
          child.unref();
        } else {
          // Linux
          const child = spawn(
            "/bin/bash",
            ["-c", `nohup ${nodePath} ${watchdogPath} > /dev/null 2>&1 &`],
            {
              detached: true,
              stdio: "ignore",
            }
          );
          child.unref();
        }
        return true;
      } catch (err) {
        log(`Method 2 failed: ${err.message}`);
        return false;
      }
    },

    // Method 3: Write and execute a script
    () => {
      log("Trying method 3: Script execution");
      try {
        const scriptExt = process.platform === "win32" ? "bat" : "sh";
        const scriptPath = path.join(os.tmpdir(), `bbshots-start.${scriptExt}`);

        if (process.platform === "win32") {
          fs.writeFileSync(
            scriptPath,
            `@echo off\r\nstart /b "" "${nodePath}" "${watchdogPath}"\r\nexit`
          );
          execSync(`cmd.exe /c "${scriptPath}"`, { windowsHide: true });
        } else {
          fs.writeFileSync(
            scriptPath,
            `#!/bin/bash\n"${nodePath}" "${watchdogPath}" > /dev/null 2>&1 &`
          );
          fs.chmodSync(scriptPath, 0o755);
          execSync(`"${scriptPath}"`, { stdio: "ignore" });
        }
        return true;
      } catch (err) {
        log(`Method 3 failed: ${err.message}`);
        return false;
      }
    },
  ];

  // Try methods in sequence
  function startWithNextMethod(currentIndex) {
    if (currentIndex >= startMethods.length) {
      log("All methods failed. Watchdog may not be running.");
      return;
    }

    if (startMethods[currentIndex]()) {
      log(`Watchdog started successfully with method ${currentIndex + 1}`);
    } else {
      startWithNextMethod(currentIndex + 1);
    }
  }

  // Start with the first method
  startWithNextMethod(0);
}

// Setup auto-start with system
function setupAutoStart() {
  const platform = os.platform();

  if (platform === "win32") {
    // Windows: Create a shortcut in the startup folder
    const startupFolder = path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup"
    );

    if (!fs.existsSync(startupFolder)) {
      try {
        fs.mkdirSync(startupFolder, { recursive: true });
      } catch (err) {
        log(`Error creating startup folder: ${err.message}`);
      }
    }

    const startupScript = path.join(startupFolder, "BBShots.bat");

    // Get the correct path to the executable
    let exePath;
    if (isPackaged) {
      exePath = path.join(appDir, "BBShots.exe");
    } else {
      exePath = path.join(appDir, "node_modules", ".bin", "electron.cmd");
    }

    // Create a batch file to start the app
    const batchContent = `@echo off
start "" "${exePath}" --hidden
exit`;

    try {
      fs.writeFileSync(startupScript, batchContent);
      log(`Added BBShots to Windows startup folder: ${startupScript}`);

      // Also add to registry for redundancy
      try {
        execSync(
          `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "BBShots" /t REG_SZ /d "\\"${exePath}\\" --hidden" /f`
        );
        log("Added BBShots to Windows registry run key");
      } catch (regErr) {
        log(`Error adding to registry: ${regErr.message}`);
      }
    } catch (err) {
      log(`Error writing startup script: ${err.message}`);
    }
  } else if (platform === "darwin") {
    // macOS: Create a launch agent
    const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
    if (!fs.existsSync(launchAgentsDir)) {
      try {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      } catch (err) {
        log(`Error creating LaunchAgents directory: ${err.message}`);
      }
    }

    const plistFile = path.join(launchAgentsDir, "com.saeculum.bbshots.plist");

    // Get the correct path to the executable
    let exePath;
    if (isPackaged) {
      // If we're in a .app bundle
      if (appDir.includes(".app")) {
        exePath = appDir;
      } else {
        // Try to find the .app bundle
        exePath = path.join(appDir, "BBShots.app");
      }
    } else {
      exePath = path.join(appDir, "node_modules", ".bin", "electron");
    }

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.saeculum.bbshots</string>
    <key>ProgramArguments</key>
    <array>
        <string>open</string>
        <string>-a</string>
        <string>${exePath}</string>
        <string>--args</string>
        <string>--hidden</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${path.join(logsDir, "bbshots-launchd-error.log")}</string>
    <key>StandardOutPath</key>
    <string>${path.join(logsDir, "bbshots-launchd-output.log")}</string>
</dict>
</plist>`;

    try {
      fs.writeFileSync(plistFile, plistContent);
      log(`Added BBShots to macOS launch agents: ${plistFile}`);

      // Load the launch agent
      try {
        execSync(`launchctl load -w "${plistFile}"`);
        log("Loaded launch agent with launchctl");
      } catch (loadErr) {
        log(`Error loading launch agent: ${loadErr.message}`);
      }

      // Also add a login item for redundancy
      try {
        execSync(
          `osascript -e 'tell application "System Events" to make login item at end with properties {path:"${exePath}", hidden:true}'`
        );
        log("Added BBShots as a login item");
      } catch (loginErr) {
        log(`Error adding login item: ${loginErr.message}`);
      }
    } catch (err) {
      log(`Error writing plist file: ${err.message}`);
    }
  } else if (platform === "linux") {
    // Linux: Create a desktop entry in the autostart directory
    const autostartDir = path.join(os.homedir(), ".config", "autostart");
    if (!fs.existsSync(autostartDir)) {
      try {
        fs.mkdirSync(autostartDir, { recursive: true });
      } catch (err) {
        log(`Error creating autostart directory: ${err.message}`);
      }
    }

    const desktopFile = path.join(autostartDir, "bbshots.desktop");

    // Get the correct path to the executable
    let exePath;
    if (isPackaged) {
      exePath = path.join(appDir, "BBShots");
    } else {
      exePath = path.join(appDir, "node_modules", ".bin", "electron");
    }

    const desktopContent = `[Desktop Entry]
Type=Application
Name=BBShots
Exec=${exePath} --hidden
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
StartupNotify=false
Terminal=false`;

    try {
      fs.writeFileSync(desktopFile, desktopContent);
      log(`Added BBShots to Linux autostart: ${desktopFile}`);

      // Also add to systemd user service for redundancy
      const systemdDir = path.join(os.homedir(), ".config", "systemd", "user");
      try {
        if (!fs.existsSync(systemdDir)) {
          fs.mkdirSync(systemdDir, { recursive: true });
        }

        const serviceFile = path.join(systemdDir, "bbshots.service");
        const serviceContent = `[Unit]
Description=BBShots Background Service
After=graphical-session.target

[Service]
ExecStart=${exePath} --hidden
Restart=always
RestartSec=10

[Install]
WantedBy=default.target`;

        fs.writeFileSync(serviceFile, serviceContent);
        execSync("systemctl --user daemon-reload");
        execSync("systemctl --user enable bbshots.service");
        execSync("systemctl --user start bbshots.service");
        log("Added and started BBShots systemd user service");
      } catch (systemdErr) {
        log(`Error setting up systemd service: ${systemdErr.message}`);
      }
    } catch (err) {
      log(`Error writing desktop file: ${err.message}`);
    }
  }
}

// Start the watchdog process
startWatchdog();

// Setup auto-start with system
setupAutoStart();

log("BBShots persistent startup configuration complete.");

// Keep this process running for a while to ensure everything starts properly
setTimeout(() => {
  log("Startup script completed successfully.");
  process.exit(0);
}, 30000);
