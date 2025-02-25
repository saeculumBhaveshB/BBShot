const { ipcRenderer } = require("electron");

document.getElementById("save").addEventListener("click", () => {
  const interval = document.getElementById("interval").value;
  ipcRenderer.send("set-interval", parseInt(interval, 10));
});
