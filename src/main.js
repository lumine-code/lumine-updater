const { CompositeDisposable, Disposable } = require("lumine");

let findInstallMethod;
let findNewestRelease;

class LumineUpdater {
  provideBackgroundTips() {
    return {
      packageName: "lumine-updater",
      tips: [
        "{% if keys['lumine-updater:check-for-update'] %}You can check for a newer Lumine release with {{ 'lumine-updater:check-for-update' | keystroke }}{% else %}You can check for a newer Lumine release with Lumine Updater from the command palette.{% endif %}",
      ],
    };
  }

  activate() {
    this.disposables = new CompositeDisposable();
    this.cache = require("./cache.js");
    this.currentCheck = null;
    this.notification = null;

    this.disposables.add(
      lumine.commands.add("lumine-workspace", {
        "lumine-updater:check-for-update": {
          description: "Ask now whether a newer release of the editor exists.",
          didDispatch: () => {
            this.checkForUpdates({ manual: true }).catch((error) =>
              console.warn("Lumine update check failed:", error),
            );
          },
        },
        "lumine-updater:clear-cache": {
          description: "Discard what the last update check remembered.",
          didDispatch: () => {
            this.cache.empty("last-update-check");
            this.cache.empty(`installMethod.${lumine.application.getVersion()}`);
          },
        },
      }),
    );

    if (lumine.config.get("lumine-updater.checkForUpdatesOnLaunch")) {
      // An update check isn't urgent and makes a network request. Defer it off
      // the activation path so it runs once the window is idle instead of
      // blocking startup.
      const handle = window.requestIdleCallback(
        () => {
          this.checkForUpdates().catch((error) =>
            console.warn("Lumine update check failed:", error),
          );
        },
        { timeout: 5000 },
      );
      this.disposables.add(new Disposable(() => window.cancelIdleCallback(handle)));
    }
  }

  deactivate() {
    const owner = this.disposables;
    this.disposables = null;
    this.currentCheck?.controller.abort();
    this.currentCheck = null;
    owner?.dispose();
    this.notification = null;
    this.cache = null;
  }

  async findNewestRelease(options) {
    findNewestRelease ??= require("./find-newest-release.js");
    return findNewestRelease(options);
  }

  async findInstallMethod() {
    findInstallMethod ??= require("./find-install-method.js");
    return findInstallMethod();
  }

  beginCheck(manual = false) {
    this.currentCheck?.controller.abort();
    return (this.currentCheck = {
      owner: this.disposables,
      cache: this.cache,
      controller: new AbortController(),
      manual,
    });
  }

  isCurrentCheck(check) {
    return (
      this.disposables != null &&
      this.disposables === check.owner &&
      this.currentCheck === check &&
      !check.controller.signal.aborted
    );
  }

  async checkForUpdates({ manual = false } = {}) {
    if (!this.disposables) return;
    const check = this.beginCheck(manual);
    try {
      const latestVersion = await this.findNewestRelease({ signal: check.controller.signal });
      if (!this.isCurrentCheck(check)) return;
      // A dismissal can happen while the network request is pending.
      const cachedUpdateCheck = check.cache.getCacheItem("last-update-check");
      const shouldUpdate = !lumine.application.versionSatisfies(`>= ${latestVersion}`);

      if (cachedUpdateCheck?.latestVersion === latestVersion && !cachedUpdateCheck?.shouldUpdate) {
        if (manual) await this.notifyAboutUpdate(latestVersion);
        return;
      }

      if (shouldUpdate) await this.notifyAboutUpdate(latestVersion);
      else await this.notifyAboutCurrent(latestVersion, manual);
    } catch (error) {
      if (!this.isCurrentCheck(check)) return;
      if (manual) {
        lumine.notifications.addWarning("Unable to check for Lumine updates.", {
          detail: error.message,
          dismissable: true,
        });
      }
      throw error;
    }
  }

  notifyAboutCurrent(latestVersion, manual) {
    if (!manual) return;
    lumine.notifications.addInfo("Lumine is already up to date.", { dismissable: true });
  }

  async notifyAboutUpdate(latestVersion) {
    if (!this.disposables) return;
    const check = this.currentCheck ?? this.beginCheck();
    const installKey = `installMethod.${lumine.application.getVersion()}`;
    const installMethod = check.cache.getCacheItem(installKey) ?? (await this.findInstallMethod());
    if (!this.isCurrentCheck(check)) return;
    const dismissal = check.cache.getCacheItem("last-update-check");
    if (!check.manual && dismissal?.latestVersion === latestVersion && !dismissal.shouldUpdate)
      return;
    check.cache.setCacheItem("last-update-check", { latestVersion, shouldUpdate: true });
    check.cache.setCacheItem(installKey, installMethod);

    let objButtonForInstallMethod = this.getObjButtonForInstallMethod(installMethod, latestVersion);
    let notificationDetailText = this.getNotificationText(installMethod, latestVersion);

    // Notification text of `null` means that we shouldn't show a notification
    // after all.
    if (notificationDetailText === null) {
      return;
    }

    const notification = lumine.notifications.addInfo("An update for Lumine is available.", {
      description: notificationDetailText,
      dismissable: true,
      buttons: [
        {
          text: "Dismiss this Version",
          onDidClick: () => {
            if (this.notification !== notification) return;
            this.ignoreForThisVersion(latestVersion);
            notification.dismiss();
          },
        },
        {
          text: "Dismiss until next launch",
          onDidClick: () => {
            if (this.notification !== notification) return;
            this.ignoreUntilNextLaunch();
            notification.dismiss();
          },
        },
        // Below we optionally add a button for the install method. That may
        // open to a Lumine download URL, if available for installation method
        typeof objButtonForInstallMethod === "object" && objButtonForInstallMethod,
      ],
    });
    if (!this.isCurrentCheck(check)) {
      notification.dismiss();
      return;
    }
    this.ownNotification(notification, check);
  }

  ownNotification(notification, check) {
    const owner = this.disposables;
    this.notification?.dismiss();
    if (!owner || this.disposables !== owner || (check && !this.isCurrentCheck(check))) {
      notification.dismiss();
      return;
    }
    this.notification = notification;
    const cleanup = new CompositeDisposable();
    cleanup.add(
      notification.onDidDismiss(() => {
        if (this.notification === notification) this.notification = null;
        owner.remove(cleanup);
        cleanup.dispose();
      }),
      new Disposable(() => notification.dismiss()),
    );
    owner.add(cleanup);
  }

  ignoreForThisVersion(version) {
    this.cache?.setCacheItem("last-update-check", {
      latestVersion: version,
      shouldUpdate: false,
    });
  }

  ignoreUntilNextLaunch() {
    // emptying the cache, will cause the next check to succeed
    this.cache?.empty("last-update-check");
  }

  getNotificationText(installMethod, latestVersion) {
    let returnText = `Lumine ${latestVersion} is available.\n`;

    switch (installMethod.installMethod) {
      case "Developer Mode":
        returnText += "Since you're in developer mode, Lumine trusts you know how to update.";
        break;
      case "Safe Mode":
        return null;
      case "Spec Mode":
        return null;
      case "Custom Release Channel":
        return null;
      case "Flatpak Installation":
        returnText += "Install the latest version by running `flatpak update`.";
        break;
      case "Deb-Get Installation":
        returnText +=
          "Install the latest version by running `deb-get update && deb-get install lumine`.";
        break;
      case "Nix Installation":
        // TODO find nix update command
        returnText += "Install the latest version via Nix.";
        break;
      case "Homebrew Installation":
        returnText += "Install the latest version by running `brew upgrade lumine`.";
        break;
      case "winget Installation":
        returnText += "Install the latest version by running `winget upgrade lumine`.";
        break;
      case "Chocolatey Installation":
        returnText += "Install the latest version by running `choco upgrade lumine`.";
        break;
      case "User Installation":
      case "Machine Installation":
      case "Portable Installation":
      case "Manual Installation":
      default:
        returnText += "Download the latest version from the Lumine website or GitHub.";
        break;
    }

    return returnText;
  }

  getObjButtonForInstallMethod(
    installMethod,
    latestVersion = this.cache?.getCacheItem("last-update-check")?.latestVersion,
  ) {
    const owner = this.disposables;
    const openWebGitHub = (e) => {
      e.preventDefault();
      if (!owner || this.disposables !== owner) return;
      let tagSegment = latestVersion ? `tag/${latestVersion}` : "";
      lumine.shell.openExternal(`https://github.com/lumine-code/lumine/releases/${tagSegment}`);
    };

    switch (installMethod.installMethod) {
      case "User Installation":
      case "Machine Installation":
      default:
        return {
          text: "Download from GitHub",
          onDidClick: openWebGitHub,
        };
    }
  }
}

module.exports = new LumineUpdater();
