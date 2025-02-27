const { app } = require("electron");
const AutoLaunch = require("auto-launch");

const autoLauncher = new AutoLaunch({
  name: "BBShots",
  path: app.getPath("exe"),
});

autoLauncher
  .isEnabled()
  .then((isEnabled) => {
    if (!isEnabled) autoLauncher.enable();
  })
  .catch((err) => {
    console.error("Error enabling auto-launch:", err);
  });
