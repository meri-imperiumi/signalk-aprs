const { Socket } = require('node:net');
const { KISSSender } = require('kiss-tnc');
const { APRSProcessor, newKISSFrame } = require('utils-for-aprs');
const { formatLatitude, formatLongitude } = require('./aprs');

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  let connections = [];
  let publishInterval;
  plugin.id = 'signalk-aprs';
  plugin.name = 'APRS';
  plugin.description = 'Connect Signal K with the Automatic Packet Reporting System for Radio Amateurs';

  function setConnectionStatus() {
    if (connections.length === 0) {
      app.setPluginStatus('No TNC connection');
    }
    const connectedStr = connections.map((c) => c.address).join(', ');
    app.setPluginStatus(`Connected to TNC ${connectedStr}`);
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
      // TODO: Populate into SK data structure
      setTimeout(() => {
        setConnectionStatus();
      }, 3000);
    });
    settings.connections.forEach((connectionSetting) => {
      if (!connectionSetting.enabled) {
        return;
      }
      const mySendStream = new KISSSender();
      const socket = new Socket();
      socket.once('ready', () => {
        mySendStream.pipe(socket);
        connections.push({
          address: `${connectionSetting.host}:${connectionSetting.port}`,
          socket,
          send: mySendStream,
        });
        setConnectionStatus();
        // TODO: Reconnect handling
        socket.on('data', (data) => {
          app.debug(data);
          if (data.length < 4) {
            // We don't want to parse empty frames
            return;
          }
          // Remove FEND and FEND before processing
          processor.data(data.slice(1, -1));
        });
      });
      app.setPluginStatus(`Connecting to TNC ${connectionSetting.host}:${connectionSetting.port}`);
      socket.connect(connectionSetting.port, connectionSetting.host);
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
            // TODO: Produce Maidenhead
            if (v.path !== 'navigation.position') {
              return;
            }
            if (!settings.beacon.enabled) {
              app.setPluginStatus('Beaconing disabled, no TX');
              return;
            }

            const payload = `:=${formatLatitude(v.value.latitude)}${settings.beacon.symbol[0]}${formatLongitude(v.value.longitude)}${settings.beacon.symbol[1]} ${settings.beacon.note}`;
            const frame = newKISSFrame().fromFrame({
              destination: {
                callsign: 'APZ42',
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

            connections.forEach((conn) => conn.sender.write(frame.build().slice(1)));
            app.setPluginStatus(`TX ${payload}`);
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
    connections.forEach((c) => c.socket.destroy());
    connections = [];
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
            default: 0,
          },
          symbol: {
            type: 'string',
            minLength: 2,
            maxLength: 2,
            description: 'APRS symbol',
            default: '/Y',
          },
          note: {
            type: 'string',
            description: 'Personal note',
            default: 'https://signalk.org',
          },
          enabled: {
            type: 'boolean',
            title: 'Transmit vessel as APRS beacon periodically',
            default: false,
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
          },
        },
      },
    },
  };

  return plugin;
};
