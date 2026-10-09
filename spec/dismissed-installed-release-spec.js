describe("Dismissed releases after installing an update", () => {
  let updater, cache, installKey, info;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    lumine.config.set("lumine-updater.checkForUpdatesOnLaunch", false);
    updater = (await lumine.packages.activatePackage("lumine-updater")).mainModule;
    cache = updater.cache;
    installKey = `installMethod.${lumine.application.getVersion()}`;
    cache.empty("last-update-check");
    cache.setCacheItem(installKey, { installMethod: "Manual Installation" });
    info = spyOn(lumine.notifications, "addInfo").and.callThrough();
  });

  afterEach(async () => {
    cache.empty("last-update-check");
    cache.empty(installKey);
    if (lumine.packages.isPackageLoaded("lumine-updater")) {
      await lumine.packages.deactivatePackage("lumine-updater");
      await lumine.packages.unloadPackage("lumine-updater");
    }
  });

  it("reports the installed release as current even if it was dismissed earlier", async () => {
    const installed = lumine.application.getVersion();
    updater.ignoreForThisVersion(installed);
    spyOn(updater, "findNewestRelease").and.resolveTo(installed);
    await updater.checkForUpdates({ manual: true });
    expect(info).toHaveBeenCalledOnceWith("Lumine is already up to date.", { dismissable: true });
    expect(updater.notification).toBeNull();
  });

  it("still lets a manual check show a dismissed release that is actually newer", async () => {
    updater.ignoreForThisVersion("999.0.0");
    spyOn(updater, "findNewestRelease").and.resolveTo("999.0.0");
    await updater.checkForUpdates({ manual: true });
    expect(info.calls.mostRecent().args[0]).toBe("An update for Lumine is available.");
    expect(updater.notification.getOptions().description).toContain("999.0.0");
  });

  it("keeps an automatic check quiet for a dismissed release that is newer", async () => {
    updater.ignoreForThisVersion("999.0.0");
    spyOn(updater, "findNewestRelease").and.resolveTo("999.0.0");
    await updater.checkForUpdates();
    expect(info).not.toHaveBeenCalled();
    expect(updater.notification).toBeNull();
  });
});
