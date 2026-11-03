const path = require('path')
const { createRadio } = require('../lib/v50-radio')
const { mergeOptions, REPLY_STATUS } = require('../lib/v50-identity')

module.exports = function (app) {
  const plugin = {}
  let radio = null

  plugin.id = 'signalk-navico-v50-plugin'
  plugin.name = 'Navico V60 (DSC)'
  plugin.description =
    'Emulate a B&G V60 on NMEA 2000 so Zeus Call is enabled, with a DSC call-flow webapp'

  plugin.schema = function () {
    return {
      type: 'object',
      properties: {
        canDevice: {
          type: 'string',
          title: 'CAN device',
          default: 'can0',
        },
        preferredAddress: {
          type: 'number',
          title: 'Preferred N2K address',
          default: 25,
        },
        uniqueNumber: {
          type: 'number',
          title: 'ISO unique number (15-bit serial)',
          default: 12345,
        },
        productCode: {
          type: 'number',
          title: 'Product code (126996)',
          default: 30041,
        },
        modelId: {
          type: 'string',
          title: 'Model ID (126996)',
          default: 'V60B',
        },
        ownMmsi: {
          type: 'string',
          title: 'Own MMSI',
          description:
            'Leave blank to use vessels.self.mmsi from Signal K (AIS / vessel identity).',
          default: '',
        },
        dscEnabled: {
          type: 'boolean',
          title: 'DSC enabled',
          default: true,
        },
        autoReplyStatus: {
          type: 'number',
          title: 'Auto-reply status byte (0=OK)',
          default: 0,
          enum: [0, 1, 2, 3, 4, 5, 6],
        },
        forwardDscToSignalk: {
          type: 'boolean',
          title: 'Forward DSC dial to Signal K',
          description:
            'On OK dial, PUT vessels.self/communication.vhf.dsc.call so another plugin can TX the call.',
          default: true,
        },
      },
    }
  }

  function json(res, code, body) {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  plugin.registerWithRouter = function (router) {
    router.get('/status', function (req, res) {
      json(res, 200, radio ? radio.getState() : { error: 'not started' })
    })
    router.post('/call', function (req, res) {
      if (!radio) return json(res, 503, { error: 'not started' })
      const body = req.body || {}
      const call = radio.simulateCall({
        mmsi: body.mmsi,
        channel: body.channel,
      })
      json(res, 200, call)
    })
    router.post('/options', function (req, res) {
      if (!radio) return json(res, 503, { error: 'not started' })
      radio.setOptions(req.body || {})
      json(res, 200, radio.getState())
    })
  }

  plugin.start = function (options) {
    const opts = mergeOptions(options || {})
    if (options && options.canDevice) opts.canDevice = options.canDevice
    radio = createRadio(app, opts)
    app.setPluginStatus(
      opts.modelId +
        ' claiming on ' +
        (opts.canDevice || 'can0') +
        ' (event ' +
        radio.getState().eventId +
        ', reply ' +
        REPLY_STATUS[opts.autoReplyStatus] +
        ')'
    )
  }

  plugin.stop = function () {
    if (radio) radio.stop()
    radio = null
  }

  return plugin
}
