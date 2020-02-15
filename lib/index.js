'use strict';
const EventEmitter = require('events');
const Os = require('os');
const { types } = require('util');
const { UdpTransport } = require('./udp');
const { isFinite, isSafeInteger } = Number;
const kLogFunction = Symbol('logFunction');
const kTransport = Symbol('transport');
const kGelfVersion = '1.1';
const kFieldRegEx = /^[\w.-]*$/;
const kLevels = {
  EMERG: 0,   // System is unusable.
  ALERT: 1,   // Should be corrected immediately.
  CRIT: 2,    // Critical conditions.
  ERR: 3,     // Error conditions.
  WARNING: 4, // May indicate that an error will occur if action is not taken.
  NOTICE: 5,  // Events that are unusual, but not error conditions.
  INFO: 6,    // Normal operational messages that require no action.
  DEBUG: 7    // Information useful to developers for debugging the application.
};
const supportedTransports = new Set(['udp']); // TCP can also be implemented.

// GELF Payload Specification
//
// version             - UTF-8 string. Required. GELF specification version.
// host                - UTF-8 string. Required. Host/source/application name.
// short_message       - UTF-8 string. Required. Short, descriptive message.
// full_message        - String. Optional. Long message.
// timestamp           - Double. Optional. Seconds since Unix epoch.
// level               - Integer (0-7). Defaults to 1. Syslog severity level.
// facility            - UTF-8 string. Optional. Deprecated.
// line                - Integer. Optional. Deprecated.
// file                - UTF-8 string. Optional. Deprecated.
// _[additional_field] - UTF-8 string or Number. Additional fields. Should not
//                       allow _id. Must match the regular expression
//                       /^[\w\.\-]*$/

class GelfClient extends EventEmitter {
  constructor (options = {}) {
    super();

    if (options === null || typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }

    const {
      host = Os.hostname(),
      transport = 'udp',
      version = kGelfVersion
    } = options;

    if (typeof host !== 'string') {
      throw new TypeError('host must be a string');
    }

    if (typeof version !== 'string') {
      throw new TypeError('version must be a string');
    }

    if (typeof transport !== 'string') {
      throw new TypeError('transport must be a string');
    }

    if (!supportedTransports.has(transport)) {
      throw new Error(`unsupported transport: ${transport}`);
    }

    this.host = host;
    this.version = version;

    // TODO(cjihrig): Support TCP as well.
    this[kTransport] = new UdpTransport(options, this);
  }

  connect () {
    return this[kTransport].connect();
  }

  close () {
    const transport = this[kTransport];

    this[kTransport] = null;
    return transport.close();
  }

  log (shortMessage, fullMessage, additionalFields, timestamp, level) {
    return this[kLogFunction](shortMessage, fullMessage, additionalFields,
      timestamp, level);
  }

  [kLogFunction] (short, full, additionalFields, timestamp, level) {
    const shortMessage = !types.isNativeError(short) ? short : {
      name: short.name,
      message: short.message,
      stack: short.stack
    };
    const isValidLevel = isSafeInteger(level) && level >= 0 && level <= 7;
    const message = {
      version: this.version,
      host: this.host,
      short_message: shortMessage,
      full_message: full,
      level: isValidLevel ? level : 1,
      timestamp: isFinite(timestamp) ? timestamp : (Date.now() / 1000)
    };

    if (typeof additionalFields === 'object' && additionalFields !== null) {
      const keys = Object.keys(additionalFields);

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];

        if (key !== 'id' && kFieldRegEx.test(key)) {
          let value = additionalFields[key];

          if (typeof value !== 'number' && typeof value !== 'string') {
            value = String(value);
          }

          message[`_${key}`] = value;
        }
      }
    }

    this[kTransport].send(message);
  }
}

// Generate the various log level functions.
[
  ['emergency', kLevels.EMERG],
  ['alert', kLevels.ALERT],
  ['critical', kLevels.CRIT],
  ['error', kLevels.ERR],
  ['warning', kLevels.WARNING],
  ['notice', kLevels.NOTICE],
  ['info', kLevels.INFO],
  ['debug', kLevels.DEBUG]
].forEach(([name, level]) => {
  GelfClient.prototype[name] = function (shortMessage, fullMessage,
    additionalFields, timestamp) {
    return this[kLogFunction](shortMessage, fullMessage, additionalFields,
      timestamp, level);
  };
});

module.exports = {
  GelfClient,
  levels: { ...kLevels }
};

