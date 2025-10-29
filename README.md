Signal K APRS Plugin
====================

This plugin integrates [Signal K](https://signalk.org) with the [Automatic Packet Reporting System](https://www.aprs.org) (APRS), a packet radio system for Radio Amateurs. The plugin connects to various APRS-capable radio systems using the KISS TNC protocol.

You need to be a licensed radio amateur to use APRS. For everybody else, [Signal K Meshtastic Plugin](https://github.com/meri-imperiumi/signalk-meshtastic) is the way to go.

APRS is a registered trademark Bob Bruninga, WB4APR.

## Status

Very early stages, being tested with the [LoRa APRS iGate](https://github.com/richonguzman/LoRa_APRS_iGate) firmware.

## Features

* Support for connecting to multiple KISS TNCs
  - This allows connecting to both LoRa APRS and VHF APRS for instance
  - TX can be enabled separately for each TNC, allowing listen-only connections
  - The plugin will keep trying to reconnect to TNCs that are offline
* Periodically sending vessel position as a beacon to TX-enabled TNCs
* Populating received WX stations into Signal K data structure

## Planned features

* Transmit WX data from boat sensors (wind, temperature, etc)
* Send telemetry (battery status, water depth, anchor distance) over APRS
* Show other APRS beacons as vessels in Freeboard etc
* Send alerts to crew over APRS
* Get a [dedicated TOCALL for this plugin](https://github.com/aprsorg/aprs-deviceid/issues/244)
* Figure out how to handle APRS messaging from/to boat

## Changes

* 0.1.0 (2025-10-29)
  - Initial release, can beacon vessel position
