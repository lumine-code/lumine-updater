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
});
