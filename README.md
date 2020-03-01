# gelfie

[![Current Version](https://img.shields.io/npm/v/gelfie.svg)](https://www.npmjs.org/package/gelfie)
![Dependencies](http://img.shields.io/david/cjihrig/gelfie.svg)
[![belly-button-style](https://img.shields.io/badge/eslint-bellybutton-4B32C3.svg)](https://github.com/cjihrig/belly-button)

`gelfie` is a client for sending [GELF](https://docs.graylog.org/en/latest/pages/gelf.html) data to a server.

## Usage

The following example demonstrates how `gelfie` can be utilized. See the API
documentation below for more specific details, including all supported options
and methods.

```javascript
'use strict';
const { GelfClient } = require('gelfie');

(async () => {
  const client = new GelfClient({
    graylogHost: 'your-graylog-host',
    graylogPort: 12201
  });

  client.on('error', console.error);

  await client.connect();
  client.info('informational data to log');
  client.error(new Error('uh oh!'));
  client.debug('debug info', 'gelf full_message', {
    facility: 'gelf facility'
  });

  setTimeout(() => {
    client.close();
  }, 3000);
})();
```

## API

`gelfie` exports the `GelfClient` class which is used to send GELF data to a
remote server. `gelfie` also exports a table of log level constants.

### `GelfClient(options)` Constructor

  - Arguments
    - `options` (object) - Configuration data supporting the following options:
      - `host` (string) - Used as the `host` field in GELF data. Optional. Defaults to `os.hostname()` from the Node.js runtime.
      - `serializer(field)` (function) - A function used to customize the serialization of the GELF `short_message` and `full_message` fields. The only parameter passed to the `serializer()` function is `field`, which corresponds to the `short_message` or `full_message`. Optional. Defaults to `GelfClient.defaultSerializer()`. An example use of this function is to
      improve the serialization of objects that do not naturally map to JSON, such as `Map`s and circular data structures.
      - `transport` (string) - The type of network transport to use. Valid
      values are `'udp'` and `'tcp'`. Optional. Defaults to `'udp'`.
      - `version` (string) - Used as the `version` field in GELF data. Optional. Defaults to `'1.1'`.

Constructs a new `GelfClient` instance. Must be called with `new`. Internally,
the `options` object is passed to constructor function of the selected
transport. Therefore, any transport options must also be included in `options`.
See the documentation of the appropriate transport for a list of supported
options.

#### Transport Specific Options

This section describes options passed to the `GelfClient` constructor that are
specific to individual transports.

##### UDP

The UDP transport supports the following options:

  - `bufferSize` (integer) - The maximum buffer size that `gelfie` will attempt
  to send in a single message. If a message is larger than `bufferSize`,
  `gelfie` will attempt to send it as chunked messages. For this reason, this
  option impacts chunking behavior. This value cannot be made arbitrarily large
  due to UDP restrictions related to Maximum Transmission Unit (MTU) sizes. It
  also should not be made very small, as GELF limits the number of chunks for a
  single message to 128. Optional. Defaults to 1400.
  - `compression` (string) - Specifies the type of compression to apply to
  outgoing messages. Compression increases the amount of CPU used to send each
  message, but can significantly improve network usage. Supported values are
  `'none'` (no compression) and `zlib`. Optional. Defaults to `'zlib'`.
  - `graylogHost` (string) - The Graylog host to send data to.
  - `graylogPort` (integer) - The port on `graylogHost` to send data to.
  - `reuseBuffer` (boolean) - If `true`, the transport reuses a single buffer to
  send all chunks of a single message. This is done to conserve memory. If
  `false`, all chunks are sent as quickly as possible using separate buffers.
  Optional. Defaults to `true`.

##### TCP

The TCP transport supports the following options:

  - `graylogHost` (string) - The Graylog host to send data to.
  - `graylogPort` (integer) - The port on `graylogHost` to send data to.
  - `maxBacklogSize` (integer) - If the underlying TCP socket cannot send data
  fast enough to keep up with the application, `gelfie` will respect
  backpressure, by buffering messages until the socket emits a `'drain'` event.
  At that time, `gelfie` will attempt to send all buffered messages, while still
  respecting backpressure. `maxBacklogSize` defines the maximum number of
  messages that will be buffered. Attempting to buffer more messages results in
  an error being emitted. If the transport is closed while there are buffered
  messages, they will be silently discarded. Optional. Defaults to 1024.
  - `socketOptions` (object) - An object passed to Node's `net.Socket`. These
  options will be passed verbatim, with the exception of the `host` and `port`
  options, which take their values from the transport's `graylogHost` and
  `graylogPort` options. Optional. Defaults to
  `{ host: graylogHost, port: graylogPort }`.

### `GelfClient.prototype.connect()`

  - Arguments
    - None
  - Returns
    - Nothing

Performs any asynchronous operations required to begin sending GELF data to a
remote server. Depending on the transport in use, this function may return a
`Promise`.

### `GelfClient.prototype.close()`

  - Arguments
    - None
  - Returns
    - Nothing

Shuts down the client. After `close()` is called, the client is no longer
usable.

### `GelfClient.prototype.emergency(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.alert(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.critical(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.error(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.warning(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.notice(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.info(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.debug(shortMessage[, fullMessage[, additionalFields[, timestamp]]])`
### `GelfClient.prototype.log(shortMessage[, fullMessage[, additionalFields[, timestamp[, level]]]])`

  - Arguments
    - `shortMessage` (any) - Used as the `short_message` field in GELF data.
    This value is passed to the client's `serializer()` function.
    - `fullMessage` (any) - Used as the `full_message` field in GELF data. If
    present, this value is passed to the client's `serializer()` function.
    Optional. Defaults to `undefined`.
    - `additionalFields` (object) - A collection of fields used as
    `additional_field`s in GELF data. The object's own enumerable property names
    are used as the field names. An underscore is automatically prepended to the
    property names. Property names that are not valid GELF `additional_field`
    names are silently discarded. Optional.
    - `timestamp` (number) - Used as the `timestamp` field in GELF data.
    Optional. If this value is not provided, it is computed from the current
    time.
    - `level` (integer) - The logging level. This argument is only supported by
    the `log()` function. The other functions (`emergency()`, `error()`, etc.)
    implicitly use their associated log level. This value must be a integer from
    0 (inclusive) to 7 (inclusive). Optional. Defaults to 1 if the value is not
    provided, or is not in the range of valid values.
  - Returns
    - Nothing

These functions convert their inputs to GELF and then forward the data to the
transport layer to be sent over the network.

### `GelfClient.defaultSerializer(field)`

  - Arguments
    - `field` (any) - Data to be converted to a valid GELF `short_message` or
    `full_message`.
  - Returns
    - `value` (string or undefined) - The representation of `field` to be sent
    in an outgoing message.

Converts arbitrary data to a representation suitable for GELF. Strings are
returned as is. `Error` objects are converted to a plain object containing
`name`, `message`, and `stack` properties before being passed to
`JSON.stringify()`. All other values are passed directly to `JSON.stringify()`.

Due to the use of `JSON.stringify()`, circular data structures will cause an
exception to be thrown. Similarly, objects such as `Map`s will not serialize as
expected. These limitations can be worked around by passing a custom
`serializer()` function to the `GelfClient` constructor.

### `levels`

This is an object whose keys are log level names and values are numeric log
levels. For example, `levels.EMERG` is 0, `levels.NOTICE` is 5, etc.
