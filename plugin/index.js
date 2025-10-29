const { Socket } = require('node:net');
const { KISSSender } = require('kiss-tnc');
const { APRSProcessor, newKISSFrame } = require('utils-for-aprs');
const { formatLatitude, formatLongitude, formatAddress } = require('./aprs');

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  let beacons = {};
  let connections = [];
  let publishInterval;
  let state = '';
  plugin.id = 'signalk-aprs';
  plugin.name = 'APRS';
  plugin.description = 'Connect Signal K with the Automatic Packet Reporting System for Radio Amateurs';

  function beaconsOnline() {
    // LoRa APRS iGate uses 30min
    const onlineSecs = 60 * 60 * 0.5;
    const now = new Date();
    return Object
      .keys(beacons)
      .filter((b) => {
        if (beacons[b] > now.getTime() - (onlineSecs * 1000)) {
          return true;
        }
        return false;
      })
      .length;
  }

  function setConnectionStatus() {
    const connected = connections.filter((c) => c.online);
    if (connected.length === 0) {
      app.setPluginStatus('No TNC connection');
    }
    const connectedStr = connected
      .map((c) => c.address).join(', ');
    app.setPluginStatus(`Connected to TNC ${connectedStr}. ${beaconsOnline()} beacons online.`);
  }

  plugin.start = (settings) => {
    if (!settings.connections || !settings.connections.length) {
      // Not much to do here
      app.setPluginStatus('No TNC connections configured');
      return;
    }
    const processor = new APRSProcessor();
    processor.on('aprsData', (data) => {
      app.setPluginStatus(`RX ${data.info}`);
      app.debug('RX', data);
      beacons[formatAddress(data.source)] = new Date();
      if (data.weather) {
        // WX station, populate to Signal K
        const values = [];
        if (data.position
          && data.position.coords
          && Number.isFinite(data.position.coords.latitude)) {
          values.push({
            path: 'navigation.position',
            value: {
              latitude: data.position.coords.latitude,
              longitude: data.position.coords.longitude,
            },
          });
        }
        if (Number.isFinite(data.weather.temperature)) {
          values.push({
            path: 'environment.outside.temperature',
            value: (data.weather.temperature + 459.67) * (5 / 9), // APRS uses Fahrenheit
          });
        }
        if (Number.isFinite(data.weather.windSpeed)) {
          values.push({
            path: 'environment.wind.speedTrue',
            value: data.weather.windSpeed * 0.44704, // APRS uses mph
          });
        }
        if (Number.isFinite(data.weather.windDirection)) {
          values.push({
            path: 'environment.wind.directionTrue',
            value: data.weather.windDirection * (Math.PI / 180),
          });
        }
        if (Number.isFinite(data.weather.barometer)) {
          values.push({
            path: 'environment.outside.pressure',
            value: data.weather.barometer * 1000, // APRS uses tenths of a mb
          });
        }
        if (Number.isFinite(data.weather.humidity)) {
          let humidity = data.weather.humidity / 100;
          if (data.weather.humidity === 0) {
            // 00 is 100
            humidity = 1;
          }
          values.push({
            path: 'environment.outside.absoluteHumidity',
            value: humidity,
          });
        }
        if (values.length) {
          values.push({
            path: '',
            value: {
              name: data.source.callsign,
            },
          });
          values.push({
            path: 'communication.aprs.callsign',
            value: data.source.callsign,
          });
          values.push({
            path: 'communication.aprs.ssid',
            value: data.source.ssid,
          });
          values.push({
            path: 'communication.aprs.route',
            value: data.repeaterPath.map((r) => formatAddress(r)),
          });
          values.push({
            path: 'communication.aprs.comment',
            value: data.comment || '',
          });

          app.handleMessage('signalk-aprs', {
            context: `meteo.${data.source.callsign}`,
            updates: [
              {
                source: {
                  label: 'signalk-aprs',
                  src: formatAddress(data.source),
                },
                timestamp: new Date(data.position.timestamp).toISOString(),
                values,
              },
            ],
          });
        }
      }
      setTimeout(() => {
        setConnectionStatus();
      }, 3000);
    });
    settings.connections.forEach((connectionSetting) => {
      if (!connectionSetting.enabled) {
        return;
      }
      let attempt = 0;
      const connectionStr = `${connectionSetting.host}:${connectionSetting.port}`;
      const socket = new Socket();
      const conn = {
        address: connectionStr,
        socket,
        tx: connectionSetting.tx || false,
        online: false,
        reconnect: undefined,
      };
      connections.push(conn);

      const connect = () => {
        attempt += 1;
        app.debug(`${connectionStr} connect attempt ${attempt}`);
        app.setPluginStatus(`Connecting to TNC ${connectionStr}, attempt ${attempt}`);
        socket.connect(connectionSetting.port, connectionSetting.host);
      };
      const onConnectionError = (e) => {
        app.error(e);
        app.setPluginError(`Failed to connect to ${connectionStr}: ${e.message}`);
        if (conn.reconnect) {
          return;
        }
        app.debug(`Setting eventual reconnect for ${connectionStr}`);
        conn.reconnect = setTimeout(() => {
          conn.reconnect = undefined;
          // Retry to connect
          connect();
        }, 10000);
      };

      socket.setTimeout(10000);
      socket.once('error', onConnectionError);
      socket.on('ready', () => {
        app.debug(`${connectionStr} connected`);
        const mySendStream = new KISSSender();
        mySendStream.pipe(socket);
        conn.sender = mySendStream;
        conn.online = true;
        socket.removeListener('error', onConnectionError);
        setConnectionStatus();
      });
      socket.on('data', (data) => {
        app.debug(`${connectionStr} RX`, data);
        if (data.length < 4) {
          // We don't want to parse empty frames
          return;
        }
        // Remove FEND and FEND before processing
        processor.data(data.slice(1, -1));
      });
      socket.on('timeout', () => {
        app.debug(`${connectionStr} connection timeout`);
        socket.end();
      });
      socket.on('error', (e) => {
        app.error(e);
        app.setPluginError(`Error with ${connectionStr}: ${e.message}`);
      });
      socket.on('close', () => {
        app.debug(`${connectionStr} connection closed`);
        conn.online = false;
        socket.once('error', onConnectionError);
        if (conn.reconnect) {
          return;
        }
        app.debug(`Setting eventual reconnect for ${connectionStr}`);
        conn.reconnect = setTimeout(() => {
          conn.reconnect = undefined;
          // Retry to connect
          connect();
        }, 10000);
      });
      connect();
    });
    const minutes = settings.beacon.interval || 15;
    app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'navigation.position',
            period: minutes * 60 * 1000,
          },
          {
            path: 'navigation.state',
            period: 60 * 1000,
          },
        ],
      },
      unsubscribes,
      (subscriptionError) => {
        app.error(subscriptionError);
      },
      (delta) => {
        if (!delta.updates) {
          return;
        }
        // Record inputs
        delta.updates.forEach((u) => {
          if (!u.values) {
            return;
          }
          u.values.forEach((v) => {
            if (v.path === 'navigation.state') {
              state = v.value;
            }
            if (v.path !== 'navigation.position') {
              return;
            }
            const payload = `=${formatLatitude(v.value.latitude)}${settings.beacon.symbol[0]}${formatLongitude(v.value.longitude)}${settings.beacon.symbol[1]} ${app.getSelfPath('name')} ${state} ${settings.beacon.note}`;
            const frame = newKISSFrame().fromFrame({
              destination: {
                callsign: 'APZ42', // FIXME: https://github.com/aprsorg/aprs-deviceid/issues/244
              },
              source: {
                callsign: settings.beacon.callsign,
                ssid: settings.beacon.ssid,
              },
              repeaters: [
                {
                  callsign: 'WIDE1',
                  ssid: '1',
                },
              ],
              info: payload,
            });

            const frameBuffer = frame.build().slice(1);
            connections.forEach((conn) => {
              if (!conn.tx || !conn.online) {
                return;
              }
              app.debug(`${conn.address} TX`, frameBuffer);
              conn.sender.write(frameBuffer);
              app.setPluginStatus(`TX ${payload}`);
            });
            setTimeout(() => {
              setConnectionStatus();
            }, 3000);
            app.handleMessage('signalk-aprs', {
              context: 'vessels.self',
              updates: [
                {
                  source: {
                    label: 'signalk-aprs',
                    src: formatAddress(settings.beacon),
                  },
                  timestamp: new Date().toISOString(),
                  values: [
                    {
                      path: 'communication.aprs.callsign',
                      value: settings.beacon.callsign,
                    },
                    {
                      path: 'communication.aprs.ssid',
                      value: settings.beacon.ssid,
                    },
                    {
                      path: 'communication.aprs.symbol',
                      value: settings.beacon.symbol,
                    },
                  ],
                },
              ],
            });
          });
        });
      },
    );
  };

  plugin.stop = () => {
    if (publishInterval) {
      clearInterval(publishInterval);
    }
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    connections.forEach((c) => {
      c.socket.removeAllListeners();
      c.socket.destroy();
    });
    connections = [];
    beacons = {};
  };

  plugin.schema = {
    type: 'object',
    properties: {
      beacon: {
        type: 'object',
        title: 'APRS Beacon settings',
        properties: {
          callsign: {
            type: 'string',
            description: 'Callsign',
            default: 'NOCALL',
          },
          ssid: {
            type: 'integer',
            description: 'SSID',
            default: 8,
            oneOf: [
              {
                const: 0,
                title: '0: Primary station',
              },
              {
                const: 1,
                title: '1: Generic additional station',
              },
              {
                const: 2,
                title: '1: Generic additional station',
              },
              {
                const: 3,
                title: '3: Generic additional station',
              },
              {
                const: 4,
                title: '4: Generic additional station',
              },
              {
                const: 5,
                title: '5: Other network (D-Star, 3G)',
              },
              {
                const: 6,
                title: '6: Satellite',
              },
              {
                const: 7,
                title: '7: Handheld radion',
              },
              {
                const: 8,
                title: '8: Boat / ship',
              },
              {
                const: 9,
                title: '9: Mobile station',
              },
              {
                const: 10,
                title: '10: APRS-IS (no radio)',
              },
              {
                const: 11,
                title: '11: Balloon, aircraft, spacecraft',
              },
              {
                const: 12,
                title: '12: APRStt, DTMF, ... (one-way)',
              },
              {
                const: 13,
                title: '13: Weather station',
              },
              {
                const: 14,
                title: '14: Freight vehicle',
              },
              {
                const: 15,
                title: '15: Generic additional station',
              },
            ],
          },
          symbol: {
            type: 'string',
            description: 'APRS symbol',
            default: '/Y',
            oneOf: [
              {
                const: '/Y',
                title: '/Y: Yacht (sailboat)',
              },
              {
                const: '/s',
                title: '/s: Ship (power boat)',
              },
              {
                const: '/C',
                title: '/C: Canoe',
              },
              {
                const: '\\C',
                title: '\\C: Coastguard',
              },
              {
                const: '\\N',
                title: '\\N: Navigation Buoy',
              },
              {
                const: '/i',
                title: '/i: Island',
              },
            ],
          },
          note: {
            type: 'string',
            description: 'Personal note',
            default: 'https://signalk.org',
          },
          interval: {
            type: 'integer',
            description: 'Beacon transmission interval (in minutes)',
            default: 15,
          },
        },
      },
      connections: {
        type: 'array',
        title: 'KISS-TNC connections',
        minItems: 0,
        items: {
          type: 'object',
          required: ['host', 'port'],
          properties: {
            description: {
              type: 'string',
              description: 'TNC description',
            },
            host: {
              type: 'string',
              description: 'TNC host address',
            },
            port: {
              type: 'integer',
              description: 'TNC host port',
              default: 8001,
            },
            enabled: {
              type: 'boolean',
              description: 'Enable TNC connection',
              default: true,
            },
            tx: {
              type: 'boolean',
              description: 'Transmit beacon to this TNC',
              default: false,
            },
          },
        },
      },
    },
  };

  return plugin;
};
