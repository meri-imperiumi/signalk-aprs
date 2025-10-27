const { KissConnection } = require('jsax25');

function formatLatitude(coord) {
  const degFloat = Math.abs(coord);
  const deg = String(Math.floor(degFloat)).padStart(2, '0');
  const minFloat = 60 * (degFloat - Math.floor(degFloat));
  const min = String(Math.floor(minFloat)).padStart(2, '0');
  const secFloat = 60 * (minFloat - Math.floor(minFloat));
  const sec = String(Math.floor(secFloat)).padStart(2, '0');
  const sign = coord > 0 ? 'N' : 'S';
  return `${deg}${min}.${sec}${sign}`;
}
function formatLongitude(coord) {
  const degFloat = Math.abs(coord);
  const deg = String(Math.floor(degFloat)).padStart(3, '0');
  const minFloat = 60 * (degFloat - Math.floor(degFloat));
  const min = String(Math.floor(minFloat)).padStart(2, '0');
  const secFloat = 60 * (minFloat - Math.floor(minFloat));
  const sec = String(Math.floor(secFloat)).padStart(2, '0');
  const sign = coord > 0 ? 'E' : 'W';
  return `${deg}${min}.${sec}${sign}`;
}

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  let connections = [];
  let publishInterval;
  plugin.id = 'signalk-aprs';
  plugin.name = 'APRS';
  plugin.description = 'Connect Signal K with the Automatic Packet Reporting System for Radio Amateurs';

  plugin.start = (settings) => {
    if (!settings.connections || !settings.connections.length) {
      // Not much to do here
      app.setPluginStatus('No TNC connections configured');
      return;
    }
    settings.connections.forEach((connectionSetting) => {
      if (!connectionSetting.enabled) {
        return;
      }
      const conn = new KissConnection({
        tcpHost: connectionSetting.host,
        tcpPort: connectionSetting.port,
      });
      connections.push(conn);
      conn.on('data', (frame) => {
        // TODO: Process into SK data structure
        const addressed = `${frame.sourceCallsign}>${frame.destinationCallsign}:${frame.payload}`;
        app.setPluginStatus(`RX ${addressed}`);
      });
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
            const frame = {
              sourceCallsign: settings.beacon.callsign,
              sourceSsid: settings.beacon.ssid,
              destinationCallsign: 'APZ42', // TODO: Register this plugin
              payload,
              repeaters: [
                {
                  callsign: 'WIDE1',
                  ssid: '1',
                },
              ],
              frameType: 'unnumbered',
            };

            connections.forEach((conn) => conn.send(frame));
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
    connections.forEach((c) => c.end());
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
