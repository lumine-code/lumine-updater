function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, true));
}

describe("LumineUpdater", () => {
  let pack, workspaceElement;
  beforeEach(async () => {
    lumine.config.set("lumine-updater.checkForUpdatesOnLaunch", false);
    workspaceElement = lumine.views.getView(lumine.workspace);
    pack = await lumine.packages.activatePackage("lumine-updater");
    pack.mainModule.cache?.empty("last-update-check");
  });

  afterEach(async () => {
    pack.mainModule.cache?.empty("last-update-check");
    await lumine.packages.deactivatePackage("lumine-updater");
  });

  describe("when lumine-updater:check-for-updates is triggered", () => {
    beforeEach(async () => {
      spyOn(pack.mainModule, "checkForUpdates").and.returnValue(Promise.resolve());
    });
    it("triggers an update check", () => {
      lumine.commands.dispatch(workspaceElement, "lumine-updater:check-for-update");
      expect(pack.mainModule.checkForUpdates).toHaveBeenCalled();
    });
  });

  describe("when the remote version is greater than ours", () => {
    beforeEach(() => {
      spyOn(lumine.application, "getVersion").and.returnValue("1.0.0");
      spyOn(pack.mainModule, "findNewestRelease").and.callFake(() => {
        return "2.0.0";
      });
      spyOn(pack.mainModule, "notifyAboutUpdate").and.callThrough();
      spyOn(pack.mainModule, "notifyAboutCurrent").and.callThrough();
    });

    afterEach(() => {
      pack.mainModule.notifyAboutUpdate.calls.reset();
      pack.mainModule.notifyAboutCurrent.calls.reset();
    });

    it("signals that the user should update", async () => {
      jasmine.useRealClock();
      lumine.commands.dispatch(workspaceElement, "lumine-updater:check-for-update");
      await wait(200);
      expect(pack.mainModule.notifyAboutUpdate).toHaveBeenCalledWith("2.0.0");
      expect(pack.mainModule.notifyAboutCurrent).not.toHaveBeenCalled();
    });
  });

  describe("when the remote version is equal to ours", () => {
    beforeEach(() => {
      spyOn(lumine.application, "getVersion").and.returnValue("1.0.5");
      spyOn(pack.mainModule, "findNewestRelease").and.callFake(() => {
        return "1.0.5";
      });
      spyOn(pack.mainModule, "notifyAboutUpdate");
      spyOn(pack.mainModule, "notifyAboutCurrent");
    });

    it("takes no action", async () => {
      jasmine.useRealClock();
      lumine.commands.dispatch(workspaceElement, "lumine-updater:check-for-update");
      await wait(200);
      expect(pack.mainModule.notifyAboutUpdate).not.toHaveBeenCalled();
      expect(pack.mainModule.notifyAboutCurrent).toHaveBeenCalledWith("1.0.5", true);
    });
  });

  describe("when no full release has been published", () => {
    let updater, info, warning;

    beforeEach(() => {
      updater = pack.mainModule;
      spyOn(updater, "findNewestRelease").and.resolveTo("0.0.0");
      info = spyOn(lumine.notifications, "addInfo");
      warning = spyOn(lumine.notifications, "addWarning");
    });

    it("keeps an automatic check quiet", async () => {
      await expectAsync(updater.checkForUpdates()).toBeResolved();
      expect(updater.findNewestRelease).toHaveBeenCalledTimes(1);
      expect(info).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
      expect(updater.notification).toBeNull();
    });

    it("reports a manual check as current without a warning", async () => {
      await expectAsync(updater.checkForUpdates({ manual: true })).toBeResolved();
      expect(updater.findNewestRelease).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledOnceWith("Lumine is already up to date.", {
        dismissable: true,
      });
      expect(warning).not.toHaveBeenCalled();
      expect(updater.notification).toBeNull();
    });
  });

  describe("when the release lookup fails", () => {
    let updater, info, warning, log;

    beforeEach(() => {
      updater = pack.mainModule;
      spyOn(updater, "findNewestRelease").and.rejectWith(new Error("Offline"));
      info = spyOn(lumine.notifications, "addInfo");
      warning = spyOn(lumine.notifications, "addWarning");
      log = spyOn(console, "warn");
    });

    it("silently completes an automatic check without changing the cached release", async () => {
      const write = spyOn(updater.cache, "setCacheItem");
      await expectAsync(updater.checkForUpdates()).toBeResolved();
      expect(info).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it("reports a failed manual command once without logging or claiming the editor is current", async () => {
      const check = spyOn(updater, "checkForUpdates").and.callThrough();
      lumine.commands.dispatch(workspaceElement, "lumine-updater:check-for-update");
      await expectAsync(check.calls.mostRecent().returnValue).toBeResolved();
      expect(info).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledOnceWith("Unable to check for Lumine updates.", {
        detail: "Offline",
        dismissable: true,
      });
      expect(log).not.toHaveBeenCalled();
    });
  });

  it("silently completes a failed launch check scheduled while the window is idle", async () => {
    await lumine.packages.deactivatePackage("lumine-updater");
    const idle = spyOn(window, "requestIdleCallback").and.returnValue(0);
    spyOn(window, "cancelIdleCallback");
    lumine.config.set("lumine-updater.checkForUpdatesOnLaunch", true);
    pack = await lumine.packages.activatePackage("lumine-updater");
    const updater = pack.mainModule;
    spyOn(updater, "findNewestRelease").and.rejectWith(new Error("Connection timed out"));
    const warning = spyOn(lumine.notifications, "addWarning");
    const log = spyOn(console, "warn");
    await expectAsync(idle.calls.mostRecent().args[0]()).toBeResolved();
    expect(warning).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  describe("when the user tells us to ignore until the next version", () => {
    let latestVersion = "1.0.6";
    beforeEach(() => {
      spyOn(lumine.application, "getVersion").and.returnValue("1.0.5");
      spyOn(pack.mainModule, "findNewestRelease").and.callFake(() => {
        return latestVersion;
      });
      spyOn(pack.mainModule, "notifyAboutUpdate").and.callThrough();
      spyOn(pack.mainModule, "notifyAboutCurrent").and.callThrough();
    });

    it("subsequent checks do not result in notifications", async () => {
      jasmine.useRealClock();
      lumine.commands.dispatch(workspaceElement, "lumine-updater:check-for-update");
      await wait(200);

      expect(pack.mainModule.notifyAboutUpdate).toHaveBeenCalledWith("1.0.6");
      expect(pack.mainModule.notifyAboutCurrent).not.toHaveBeenCalled();

      pack.mainModule.ignoreForThisVersion("1.0.6");
      // Calling the method directly here because eventually we'll want a
      // user-initiated check for updates to ignore this cache.
      pack.mainModule.checkForUpdates();
      await wait(200);

      expect(pack.mainModule.notifyAboutUpdate.calls.count()).toBe(1);
      expect(pack.mainModule.notifyAboutCurrent).not.toHaveBeenCalled();

      latestVersion = "1.0.7";

      pack.mainModule.checkForUpdates();
      await wait(200);
      expect(pack.mainModule.notifyAboutUpdate).toHaveBeenCalledWith("1.0.7");
      expect(pack.mainModule.notifyAboutCurrent).not.toHaveBeenCalled();
    });
  });

  describe("pending checks and notifications", () => {
    let updater, cache;

    function deferred() {
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    beforeEach(() => {
      updater = pack.mainModule;
      cache = updater.cache;
      cache.empty(`installMethod.${lumine.application.getVersion()}`);
    });

    afterEach(() => cache.empty(`installMethod.${lumine.application.getVersion()}`));

    it("ignores a release response from a deactivated package", async () => {
      const response = deferred();
      spyOn(updater, "findNewestRelease").and.returnValue(response.promise);
      const notify = spyOn(updater, "notifyAboutUpdate").and.callThrough();
      const pending = updater.checkForUpdates();
      await lumine.packages.deactivatePackage("lumine-updater");
      response.resolve("2.0.0");
      await expectAsync(pending).toBeResolved();
      expect(notify).not.toHaveBeenCalled();
    });

    it("keeps the newer check when release responses arrive out of order", async () => {
      const response = deferred();
      spyOn(updater, "findNewestRelease").and.returnValues(
        response.promise,
        Promise.resolve("3.0.0"),
      );
      const notify = spyOn(updater, "notifyAboutUpdate").and.resolveTo();
      const first = updater.checkForUpdates();
      await updater.checkForUpdates();
      response.resolve("2.0.0");
      await first;
      expect(notify).toHaveBeenCalledOnceWith("3.0.0");
    });

    it("honors a version dismissal made while its release request is pending", async () => {
      const response = deferred();
      spyOn(updater, "findNewestRelease").and.returnValue(response.promise);
      const notify = spyOn(updater, "notifyAboutUpdate").and.resolveTo();
      const pending = updater.checkForUpdates();
      updater.ignoreForThisVersion("2.0.0");
      response.resolve("2.0.0");
      await pending;
      expect(notify).not.toHaveBeenCalled();
    });

    it("does not cache or notify after installation discovery outlives deactivation", async () => {
      const response = deferred();
      spyOn(updater, "findInstallMethod").and.returnValue(response.promise);
      const write = spyOn(cache, "setCacheItem").and.callThrough();
      const info = spyOn(lumine.notifications, "addInfo");
      const pending = updater.notifyAboutUpdate("2.0.0");
      await lumine.packages.deactivatePackage("lumine-updater");
      response.resolve({ installMethod: "Manual Installation" });
      await expectAsync(pending).toBeResolved();
      expect(write).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });

    it("honors a dismissal while installation discovery is pending", async () => {
      const response = deferred();
      spyOn(updater, "findInstallMethod").and.returnValue(response.promise);
      const info = spyOn(lumine.notifications, "addInfo");
      const pending = updater.notifyAboutUpdate("2.0.0");
      updater.ignoreForThisVersion("2.0.0");
      response.resolve({ installMethod: "Manual Installation" });
      await pending;
      expect(info).not.toHaveBeenCalled();
      expect(cache.getCacheItem("last-update-check").shouldUpdate).toBe(false);
    });

    it("aborts a running network request when the package deactivates", async () => {
      let signal;
      spyOn(updater, "findNewestRelease").and.callFake((options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      });
      const warning = spyOn(lumine.notifications, "addWarning");
      const pending = updater.checkForUpdates({ manual: true });
      await lumine.packages.deactivatePackage("lumine-updater");
      expect(signal.aborted).toBe(true);
      await expectAsync(pending).toBeResolved();
      expect(warning).not.toHaveBeenCalled();
    });

    async function showUpdate(version) {
      cache.setCacheItem(`installMethod.${lumine.application.getVersion()}`, {
        installMethod: "Manual Installation",
      });
      spyOn(updater, "getNotificationText").and.returnValue("A release is available.");
      const info = spyOn(lumine.notifications, "addInfo").and.callThrough();
      await updater.notifyAboutUpdate(version);
      return info.calls.mostRecent().returnValue;
    }

    it("removes its notification and safely retires its buttons on deactivation", async () => {
      const notification = await showUpdate("2.0.0");
      const click = { preventDefault() {} };
      const open = spyOn(lumine.shell, "openExternal").and.resolveTo();
      await lumine.packages.deactivatePackage("lumine-updater");
      expect(notification.isDismissed()).toBe(true);
      for (const button of notification.getOptions().buttons) {
        if (button) expect(() => button.onDidClick(click)).not.toThrow();
      }
      expect(open).not.toHaveBeenCalled();
    });

    it("keeps the download URL bound to the release its notification describes", async () => {
      const notification = await showUpdate("2.0.0");
      cache.setCacheItem("last-update-check", { latestVersion: "3.0.0", shouldUpdate: true });
      const open = spyOn(lumine.shell, "openExternal").and.resolveTo();
      notification
        .getOptions()
        .buttons.at(-1)
        .onDidClick({ preventDefault() {} });
      expect(open).toHaveBeenCalledOnceWith(
        "https://github.com/lumine-code/lumine/releases/tag/2.0.0",
      );
    });

    it("retires a new notification when dismissing its predecessor deactivates the package", async () => {
      const first = await showUpdate("2.0.0");
      first.onDidDismiss(() => updater.deactivate());
      await expectAsync(updater.notifyAboutUpdate("3.0.0")).toBeResolved();
      const newest = lumine.notifications.addInfo.calls.mostRecent().returnValue;
      expect(first.isDismissed()).toBe(true);
      expect(newest.isDismissed()).toBe(true);
      expect(updater.notification).toBeNull();
    });

    it("removes owned notification cleanup after each dismissal", async () => {
      cache.setCacheItem(`installMethod.${lumine.application.getVersion()}`, {
        installMethod: "Manual Installation",
      });
      spyOn(updater, "getNotificationText").and.returnValue("A release is available.");
      const count = updater.disposables.disposables.size;
      await updater.notifyAboutUpdate("2.0.0");
      const first = updater.notification;
      await updater.notifyAboutUpdate("3.0.0");
      expect(first.isDismissed()).toBe(true);
      expect(updater.disposables.disposables.size).toBe(count + 1);
      updater.notification.dismiss();
      expect(updater.notification).toBeNull();
      expect(updater.disposables.disposables.size).toBe(count);
    });
  });
});
