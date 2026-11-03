# signalk-navico-v50-plugin

Emulate a **B&G V60B** on NMEA 2000 so a Zeus/MFDApp **Call** button can enable, and demonstrate the DSC call flow in a webapp.

## What it does

1. Claims as B&G **V60B** (`60928` + `126996` Model ID `V60B`, product 30041, class Communication / function Radiotelephone, 15-bit serial).
2. Behaves like V60B firmware on Call:
   - **`130845`** Set key **`11/AD`** → stash working **channel**
   - **`130850`** key **`0x6F`** + MMSI → dial; reply **`130851`** dial ACK
   - Legacy **`130850` event id 3** Init DSC Call still accepted (lab / older path)
3. Also publishes `129799` radio status and (optional) Simnet `130845` parameter handles.
4. Reassembles Zeus **fast-packet** Call frames on the candump path (`lib/fast-packet.js`).
5. Webapp: banner shows **Call setup** (channel from `130845`) until the MFD Call button sends the dial; then **Calling** / **Called** with **MMSI + channel**. Packet dumps and bus log below.

Own MMSI defaults to **`vessels.self.mmsi`** from Signal K (leave plugin config blank). Override in plugin settings or set `V50_MMSI` / `V60_MMSI` for standalone lab use. Match the same value in MFD `Settings.ini` `MMSI=` when testing Call enablement.

## DSC Call on the wire (V60B firmware — CERTAIN)

Ghidra on `SW_VHF_V60B_V4.60` (`FUN_08051d28` / `FUN_08028c30` / `FUN_08028c44` / `FUN_0805215a`). Live Zeus confirm matched step 1.

### Step 1 — working channel (MFD → radio)

| Item | Value |
|------|--------|
| PGN | **130845** (Simnet Key Value) |
| Manufacturer | Simrad **`41 9f`** |
| Key | group **`0x11`**, param **`0xAD`** (bytes `11 ad 00`) |
| Operation | Set (`01`) |
| Value | **channel** (1 byte), e.g. `0x43` = 67 |

```
41 9f | ff ff ff ff | 11 ad 00 | 01 | ch | 00 ff ff
```

Radio only stores the channel. **Does not dial.**

### Step 2 — dial MMSI (MFD → radio)

| Item | Value |
|------|--------|
| PGN | **130850** |
| Manufacturer | Simrad **`41 9f`** |
| Family / key | byte5 **`0x24`**, bytes6–7 **`6f 00`** |
| MMSI | little-endian **u32** at bytes **8–11** |

```
41 9f | addr | ff ff | 24 6f 00 | mmsi_le_u32
```

Radio validates DSC/own MMSI/channel/target MMSI, then replies.

### Reply (radio → MFD)

Firmware dial ACK on **130851** (13 bytes):

```
41 9f | ownAddr | ff ff | 24 6f 00 | status | 00 00 00 | ff
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

### Legacy: event id 3 Init DSC Call

Still accepted for lab injects. Simnet event-command layout (event at byte **5** = **3**), reply is the short 8-byte event reply (`41 9f | 03 | status | ff…`). Do **not** confuse with dial frames that also use `130850` + `24 6f`.

### Call button enablement (lab Zeus)

Observed needed together:

- Live V60B-class identity on the bus (`60928` / `126996` product match).
- `Settings.ini` `[Vessels] MMSI=` set (lab: `244999001`).
- VHF selected as the Simnet/Devices radio (`SelectedDevice*` NAME matches the emulator).
- AIS target within range with a usable MMSI (lab: `LAB CALL TARGET` / `244123456`).

Then AIS vessel details shows **Call** → confirm dialog can already emit **130845 channel** (setup only) → pressing Call sends **130850 dial** with MMSI.

### Webapp banner

| Bus state | Banner |
|-----------|--------|
| `130845` channel only | **Call setup received · channel N** (waiting for dial) |
| `130850` dial, no reply yet | **Calling \<MMSI\> on channel N** |
| Dial + `130851` reply | **Called \<MMSI\> on channel N** + reply status |

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

`GET /status` includes:

- `pendingChannel` — last `130845` `11/AD` value (setup; not a dial yet)
- `lastCallRequest` — assembled request (`phase`, `channel`, `mmsi`, both packets, reply)
- `lastReceivedPacket` / `lastCall` / `calls` / `busLog`
- `lastDscForward` — result of PUT `communication.vhf.dsc.call` after an OK dial (when `forwardDscToSignalk` is on)

### Forward DSC dial to Signal K

On a successful dial (reply status 0), the plugin PUTs:

```
communication.vhf.dsc.call
{ "mmsi": "244123456", "channel": 8, "type": "individual", "category": "routine" }
```

Any plugin that handles that path can TX the call. Disable with **Forward DSC dial to Signal K** (`forwardDscToSignalk: false`) for lab-only installs.

`lastCallRequest.phase`: `channel` → `dial` → `complete` (or legacy `init-event`).

### Lab inject (verify RX without MFD)

Zeus sends both as **fast packets** (plugin reassembles). Single-frame injects also work if ≤8 bytes; for lab, use the live FP shapes:

```bash
# 1) working channel 67 (PGN 130845, 14 bytes FP)
cansend can0 0DFF1D07#000E419FFFFFFFFF
cansend can0 0DFF1D07#0111AD00014300FF
cansend can0 0DFF1D07#02FFFFFFFFFFFFFF
# 2) dial MMSI 244123456 (0x0E8D0740 LE → 40 07 8d 0e)
cansend can0 09FF2207#000C419FFFFFFF24
cansend can0 09FF2207#016F0040078D0EFF
# webapp /status → lastCallRequest complete + 130851 dial ACK
```


Legacy event-3 only:

```bash
cansend can0 19FF2207#419F19FFFF0300FF
```

## Firmware notes (V60B 4.60)

CERTAIN from the official `.swup` (Ghidra on NV621 image):

- No `126720` in the radio; Call uses `130845` + `130850` / `130851` as above.
- Radio **TX** `130845` builder uses keys **`0x12`** / **`0x26`** (settings). Own MMSI is **not** a `130845` u32.
- ISO NAME / `126996` stay B&G for DeviceMatcher; proprietary Simnet frames use Simrad `41 9f`.
- Detail write-up: Zeus lab `v60b-firmware/NOTES-130845.md`.
