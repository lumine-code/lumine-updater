const findInstallChannel = require("../src/find-install-channel.js");
const childProcess = require("child_process");
const fs = require("fs");

const COMMAND_CHANNELS = [
  {
    name: "Windows Chocolatey",
    check: findInstallChannel.windows_chocoInstalled,
    command: "choco",
    args: ["list", "--local-only"],
    output: "lumine 1.0.0",
  },
  {
    name: "Windows winget",
    check: findInstallChannel.windows_wingetInstalled,
    command: "winget",
    args: ["show", "Lumine"],
    output: "Lumine 1.0.0",
  },
  {
    name: "Linux/macOS Homebrew",
    check: findInstallChannel.linux_macos_homebrewInstalled,
    command: "brew",
    args: ["list", "lumine"],
    output: "/opt/homebrew/Caskroom/lumine/1.0.0",
  },
  {
    name: "Linux Deb-Get",
    check: findInstallChannel.linux_debGetInstalled,
    command: "deb-get",
    args: ["list", "--installed"],
    output: "lumine 1.0.0",
  },
];

describe("lumine-updater findInstallChannel", () => {
  for (const channel of COMMAND_CHANNELS) {
    describe(`${channel.name} install`, () => {
      let execFile;

      beforeEach(() => {
        execFile = spyOn(childProcess, "execFile");
      });

      it("runs the package manager with separate arguments and a timeout", async () => {
        execFile.and.callFake((_command, _args, _options, callback) => {
          callback(null, channel.output);
        });

        expect(await channel.check()).toBe(true);
        expect(execFile.calls.count()).toBe(1);
        const [command, args, options, callback] = execFile.calls.mostRecent().args;
        expect(command).toBe(channel.command);
        expect(args).toEqual(channel.args);
        expect(options).toEqual({ shell: false, windowsHide: true, timeout: 10_000 });
        expect(typeof callback).toBe("function");
      });

      it("waits for the package manager to finish", async () => {
        let finish;
        let settled = false;
        execFile.and.callFake((_command, _args, _options, callback) => {
          finish = callback;
        });

        const result = channel.check().then((installed) => {
          settled = true;
          return installed;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        finish(null, channel.output);
        expect(await result).toBe(true);
      });

      for (const output of ["", "not-installed"]) {
        it(`returns false for ${output ? "unrelated" : "empty"} output`, async () => {
          execFile.and.callFake((_command, _args, _options, callback) => {
            callback(null, output);
          });

          expect(await channel.check()).toBe(false);
        });
      }

      const failures = [
        { name: "a missing executable", details: { code: "ENOENT" } },
        { name: "a nonzero exit code", details: { code: 1 } },
        { name: "a timeout", details: { killed: true, signal: "SIGTERM" } },
      ];
      for (const failure of failures) {
        it(`returns false for ${failure.name}, even with matching output`, async () => {
          execFile.and.callFake((_command, _args, _options, callback) => {
            const error = Object.assign(new Error(failure.name), failure.details);
            callback(error, channel.output);
          });

          expect(await channel.check()).toBe(false);
        });
      }
    });
  }

  describe("Linux Nix install", () => {
    let readdir;
    let chdir;
    let execFile;
    let originalCwd;
    let storeEntries;
    let storeError;

    beforeEach(() => {
      const originalReaddir = fs.promises.readdir;
      storeEntries = [];
      storeError = null;
      readdir = spyOn(fs.promises, "readdir").and.callFake((directory, ...args) => {
        if (directory !== "/nix/store") return originalReaddir(directory, ...args);
        return storeError ? Promise.reject(storeError) : Promise.resolve(storeEntries);
      });
      chdir = spyOn(process, "chdir");
      execFile = spyOn(childProcess, "execFile").and.callThrough();
      originalCwd = process.cwd();
    });

    it("finds the action by its filename without changing cwd or spawning find", async () => {
      storeEntries = ["unrelated", "hash-lumine.nemo_action"];

      expect(await findInstallChannel.linux_nixInstalled()).toBe(true);
      const storeCalls = readdir.calls
        .allArgs()
        .filter(([directory]) => directory === "/nix/store");
      expect(storeCalls).toEqual([["/nix/store"]]);
      expect(chdir).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
      expect(process.cwd()).toBe(originalCwd);
    });

    it("does not accept a name with characters after the action suffix", async () => {
      storeEntries = ["hash-lumine.nemo_action.backup"];

      expect(await findInstallChannel.linux_nixInstalled()).toBe(false);
    });

    it("returns false when the store contains no matching action", async () => {
      storeEntries = ["hash-unrelated", "hash-lumine-1.0.0"];

      expect(await findInstallChannel.linux_nixInstalled()).toBe(false);
    });

    for (const code of ["ENOENT", "EACCES"]) {
      it(`returns false when reading the store fails with ${code}`, async () => {
        storeError = Object.assign(new Error(code), { code });

        expect(await findInstallChannel.linux_nixInstalled()).toBe(false);
        expect(chdir).not.toHaveBeenCalled();
      });
    }
  });

  describe("Linux Flatpak install", () => {
    let originalFlatpakId;

    beforeEach(() => {
      originalFlatpakId = process.env.FLATPAK_ID;
    });

    afterEach(() => {
      if (originalFlatpakId === undefined) {
        delete process.env.FLATPAK_ID;
      } else {
        process.env.FLATPAK_ID = originalFlatpakId;
      }
    });

    it("returns false when FLATPAK_ID is absent", () => {
      delete process.env.FLATPAK_ID;
      expect(findInstallChannel.linux_flatpakInstalled()).toBe(false);
    });

    it("returns false when FLATPAK_ID names another application", () => {
      process.env.FLATPAK_ID = "not-lumine";
      expect(findInstallChannel.linux_flatpakInstalled()).toBe(false);
    });

    it("returns true when FLATPAK_ID names Lumine", () => {
      process.env.FLATPAK_ID = "io.github.lumine-code.lumine";
      expect(findInstallChannel.linux_flatpakInstalled()).toBe(true);
    });
  });
});
