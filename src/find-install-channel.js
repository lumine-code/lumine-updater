const Registry = require("./win-registry.js");
const childProcess = require("child_process");
const fs = require("fs");

function commandIncludes(command, args, text) {
  return new Promise((resolve) => {
    childProcess.execFile(
      command,
      args,
      { shell: false, windowsHide: true, timeout: 10_000 },
      (error, stdout) => resolve(!error && stdout.includes(text)),
    );
  });
}

function windows_isUserInstalled() {
  return new Promise((resolve, reject) => {
    let userInstallReg = new Registry({
      hive: "HKCU",
      key: "\\SOFTWARE\\0949b555-c22c-56b7-873a-a960bdefa81f",
    });

    userInstallReg.keyExists((err, exists) => {
      if (err) {
        reject(err);
      }

      resolve(exists);
    });
  });
}

function windows_isMachineInstalled() {
  return new Promise((resolve, reject) => {
    let machineInstallReg = new Registry({
      hive: "HKLM",
      key: "\\SOFTWARE\\0949b555-c22c-56b7-873a-a960bdefa81f",
    });

    machineInstallReg.keyExists((err, exists) => {
      if (err) {
        reject(err);
      }

      resolve(exists);
    });
  });
}

function windows_chocoInstalled() {
  return commandIncludes("choco", ["list", "--local-only"], "lumine");
}

function windows_wingetInstalled() {
  return commandIncludes("winget", ["show", "Lumine"], "Lumine");
}

function linux_macos_homebrewInstalled() {
  return commandIncludes("brew", ["list", "lumine"], "lumine");
}

async function linux_nixInstalled() {
  try {
    const entries = await fs.promises.readdir("/nix/store");
    return entries.some((entry) => entry.endsWith("lumine.nemo_action"));
  } catch {
    return false;
  }
}

function linux_debGetInstalled() {
  return commandIncludes("deb-get", ["list", "--installed"], "lumine");
}

function linux_flatpakInstalled() {
  return process.env.FLATPAK_ID === "io.github.lumine-code.lumine";
}

module.exports = {
  windows_isUserInstalled,
  windows_isMachineInstalled,
  windows_chocoInstalled,
  windows_wingetInstalled,
  linux_macos_homebrewInstalled,
  linux_nixInstalled,
  linux_debGetInstalled,
  linux_flatpakInstalled,
};
