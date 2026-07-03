## Panasonic Projectors

This module connects to Panasonic projectors using the NTCONTROL protocol. test

### Connection settings

The module exposes a `Protocol Mode` setting:
- `Auto`: start in persistent mode and fall back to single-command mode if queries do not get replies
- `Persistent`: always use persistent NTCONTROL commands
- `Single command`: always use one-shot `00`/`01` commands

### Supported projectors

The module works with projectors that are supported by the Panasonic "Geometry Manager Pro" tool.

Known supported models:
- PT-DZ870
- PT-DZ13
- PT-DZ21
- PT-VZ580

### Available commands

* Power (on/off/toggle)
* Shutter (on/off/toggle)
* Freeze (on/off/toggle)
* Input Select
* Test Pattern
* Display Grid Lines
* Color Matching (3 and 7 Colors mode)
* Brightness Control
* Picture Mode
* Operating Mode
