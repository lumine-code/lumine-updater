// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-gfm"],
  viewport: { width: 1100, height: 450 },
  async before() {},
  async prepare(context) {
    const { state, open } = context;
    state.editor = await open("updater/README.md");
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Check the published Lumine releases and read the current update status.",
      timeout: 60000,
      allowNotifications: true,
      async run(context) {
        const { lumine } = context;
        {
          await lumine.packages
            .getActivePackage("lumine-updater")
            .mainModule.checkForUpdates({ manual: true });
        }
      },
      ready() {
        return Boolean(
          document.querySelector("lumine-notification")?.innerText.includes("up to date"),
        );
      },
    },
  ],
  async cleanup() {},
};
