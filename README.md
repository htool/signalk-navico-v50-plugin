# signalk-navico-v50-plugin

Emulate a **B&G V60B** on NMEA 2000 so a Zeus/MFDApp **Call** button can enable, and demonstrate the DSC call flow in a webapp.

## What it does

1. Claims as B&G **V60B** (`60928` + `126996` Model ID `V60B`, product 30041, class Communication / function Radiotelephone, 15-bit serial).
2. Publishes live VHF traffic: `129799` radio status, Simnet `130845` parameter handles (firmware layout), and answers **Init DSC Call** on `130850` with `130851` (event id **3**, status 0 = OK).
3. Webapp: simulate Call, tweak MMSI/DSC/status, show the **last received DSC call packet** (decoded + raw hex), watch bus log.

Lab default Own MMSI: **`244999001`** (made-up test, NL MID). Set the same in MFD `Settings.ini` `MMSI=`.

## DSC Call on the wire (lab)

### Command (MFD → radio)

| Item | Value |
|------|--------|
| PGN | **130850** (Simnet Event Command) |
| Addressing | PDU2 **broadcast** (`dst = 255`); payload byte 2 is the radio N2K address (`0xff` = any / broadcast) |
| Manufacturer bytes | Simrad **`41 9f`** (1857 + industry packing) — even when ISO NAME / `126996` are B&G |
| Event id | **3** = Init DSC Call (at payload byte **5** in the Simnet layout) |
| Reply PGN | **130851** (Event Reply), same event id, status byte 0–6 |

Simnet layout (CERTAIN — canboat `navico_alarms_and_commands` + lab RX):

```
[0..1] manufacturer | industry   (41 9f)
[2]    address                   (radio SA, or 0xff)
[3]    reserved
[4]    display group
[5]    event id / command type   (3 = Init DSC Call)
[6]    command
…
```

Do **not** confuse with other `130850` Simrad traffic (e.g. AIS-family type `0x24`) — those share the PGN/manufacturer prefix but are not event id 3.

The Zeus UI confirm dialog shows **target vessel name / MMSI** and **working channel** before send. The short event-command frame the plugin matches is the Init DSC Call **event**; it does not itself carry a 9-digit MMSI in the 8-byte form above.

### Reply (radio → MFD)

```
41 9f | eventId=3 | status | ff ff ff ff
```

Status bytes the MFDApp maps to UI strings:

| Byte | UI |
|------|-----|
| 0 | OK (silent success) |
| 1 | DSC function is disabled |
| 2 | Radio is busy |
| 3 | Call in progress |
| 4 | Own MMSI is not set |
| 5 | Invalid MMSI |
| 6 | Invalid channel |

### Call button enablement (lab Zeus)

Observed needed together:

- Live V60B-class identity on the bus (`60928` / `126996` product match).
- `Settings.ini` `[Vessels] MMSI=` set (lab: `244999001`).
- VHF selected as the Simnet/Devices radio (`SelectedDevice*` NAME matches the emulator).
- AIS target within range with a usable MMSI (lab: `LAB CALL TARGET` / `244123456`).

Then AIS vessel details shows **Call** enabled → confirm dialog (“initiate a call to … on channel N?”) → Init DSC Call on `130850`.

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
sudo CAN_DEVICE=can0 PORT=3099 V50_MMSI=244999001 npm run standalone
# open http://<pi>:3099/
```

`GET /status` includes `lastReceivedPacket` (decoded Init DSC Call) and `lastCall` / `calls` / `busLog`.

### Lab inject (verify RX without MFD)

```bash
# addr 25, event id 3 at byte 5 — PGN 130850 PDU2 from src 7
cansend can0 19FF2207#419F19FFFF0300FF
# webapp /status → lastReceivedPacket + 130851 reply
```

## Firmware notes (V60B 4.60)

CERTAIN from the official `.swup` (Ghidra on NV621 image):

- No `126720` in the radio; DSC event command/reply is `130850` / `130851`.
- `130845` TX uses **Simrad** manufacturer bytes `41 9f` (not B&G), 14-byte key/value with a **1-byte** value. Keys `0x12` and `0x26` are live in firmware. Own MMSI is **not** a `130845` u32 in this image.
- ISO NAME / `126996` stay B&G for DeviceMatcher; proprietary Simnet frames follow the Simrad packing above.
