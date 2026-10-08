# lumine-updater

Detect new Lumine releases on launch and notify when an update is available.

Fork of [pulsar-edit/pulsar](https://github.com/pulsar-edit/pulsar) (`packages/pulsar-updater`).

## Features

- **Launch check**: checks GitHub for new Lumine releases when the editor starts.
- **Update notification**: shows a non-invasive notification when a newer version exists.
- **Install detection**: recognizes the installation method and tailors update guidance accordingly.
- **Manual checks**: trigger an update check on demand from the command palette.

## Installation

To install `lumine-updater` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/lumine-updater`.

## Commands

Commands available in `lumine-workspace`:

- `lumine-updater:check-for-update`: check for updates and notify if a newer version is available,
- `lumine-updater:clear-cache`: clear the cached update state and re-enable suppressed checks.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
