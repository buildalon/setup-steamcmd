# Buildalon Setup SteamCmd

A GitHub Action to setup the [`steamcmd`](https://developer.valvesoftware.com/wiki/SteamCMD) command alias.

## Exported Env Vars

- `STEAM_CMD` the `steamcmd` directory location.
- `STEAM_DIR` the steam install directory location.
- `STEAM_TEMP` the temp steam directory location.

## How to use

```yaml
jobs:
  validate:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ macos-latest, windows-latest, ubuntu-latest ]

    steps:
      # download and setup the steamcmd
      - uses: buildalon/setup-steamcmd@v1
      # run commands
      - run: |
          which steamcmd
          steamcmd +help +quit
```

For a full list of `steamcmd` commands see [this list](https://github.com/dgibbs64/SteamCMD-Commands-List/blob/main/steamcmd_commands.txt).
