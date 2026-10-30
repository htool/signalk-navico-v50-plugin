# signalk-navico-v50-plugin

Emulate a **B&G V60** (or V50) on NMEA 2000 so a Zeus/MFDApp **Call** button can enable, and demonstrate the DSC call flow in a webapp.

## What it does

1. Claims as Simrad/B&G **V60** (`60928` + `126996` Model ID `V60`, class Communication / function Radiotelephone).
2. Listens for NDP2k **Init DSC Call** (event id **3**) and replies with a status byte (0 = OK).
3. Webapp: simulate Call, tweak MMSI/DSC/status, watch bus log.

## Signal K

```bash
cd ~/.signalk
npm i /path/to/signalk-navico-v50-plugin
# enable plugin in Admin → Plugin Config
# needs canbus provider on can0 + socketcan native module
```

Webapp: `/plugins/signalk-navico-v50-plugin/` (or Admin webapps).

## Standalone (lab Zeus / homepi without full SK UI)

```bash
cd signalk-navico-v50-plugin
npm i
sudo CAN_DEVICE=can0 PORT=3099 npm run standalone
# open http://<pi>:3099/
```

## Status bytes (MFDApp)

| Byte | UI |
|------|-----|
| 0 | OK |
| 1 | DSC function is disabled |
| 2 | Radio is busy |
| 3 | Call in progress |
| 4 | Own MMSI is not set |
| 5 | Invalid MMSI |
| 6 | Invalid channel |

Event wire layout is heuristic (`126720`); refine after a live Call capture.
