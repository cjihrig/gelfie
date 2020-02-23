'use strict';
const Assert = require('assert');
const EventEmitter = require('events');
const Os = require('os');
const Zlib = require('zlib');
const Lab = require('@hapi/lab');
const StandIn = require('stand-in');
const { GelfClient, levels } = require('../lib');
const { UdpTransport } = require('../lib/udp');
const { describe, it } = exports.lab = Lab.script();

describe('Gelfie', () => {
  it('sets defaults in the constructor', () => {
    const client = new GelfClient({ graylogHost: 'foo', graylogPort: 3000 });

    Assert.strictEqual(client.host, Os.hostname());
    Assert.strictEqual(client.version, '1.1');
    Assert.strictEqual(client.serializer, GelfClient.defaultSerializer);
  });

  it('validates constructor options', () => {
    function check (options, err) {
      Assert.throws(() => {
        new GelfClient(options);  // eslint-disable-line no-new
      }, err);
    }

    check(null, /^TypeError: options must be an object$/);
    check('foo', /^TypeError: options must be an object$/);
    check({ host: 5 }, /^TypeError: host must be a string$/);
    check({ version: 5 }, /^TypeError: version must be a string$/);
    check({ transport: 5 }, /^TypeError: transport must be a string$/);
    check({ transport: 'xxx' }, /^Error: unsupported transport: xxx$/);
    check({ serializer: 5 }, /^TypeError: serializer must be a function$/);
  });

  it('supports all expected functions', () => {
    const client = new GelfClient({
      compression: 'none',
      graylogHost: 'localhost',
      graylogPort: 9000
    });
    const levels = [
      ['emergency', 0],
      ['alert', 1],
      ['critical', 2],
      ['error', 3],
      ['warning', 4],
      ['notice', 5],
      ['info', 6],
      ['debug', 7],
      ['log', 1]
    ];
    const additionalFields = {
      baz: 123,   // Numbers are supported.
      abc: 'xyz', // Strings are supported.
      id: '999',  // _id is now allowed.
      '*': 1,     // Not a valid field name.
      blah: true  // Should be converted to a string.
    };
    const timestamp = Date.now() / 1000;
    let connectCalled = false;

    return new Promise((resolve, reject) => {
      const sendStand = StandIn.replace(UdpTransport.prototype, 'send', (stand, msg) => {
        Assert.strictEqual(Object.keys(msg).length, 9);
        Assert.strictEqual(msg.version, client.version);
        Assert.strictEqual(msg.host, Os.hostname());
        Assert.strictEqual(msg.short_message, 'foo');
        Assert.strictEqual(msg.full_message, 'bar');
        Assert.strictEqual(msg.level, levels[stand.invocations - 1][1]);
        Assert.strictEqual(msg.timestamp, timestamp);
        Assert.strictEqual(msg._baz, 123);
        Assert.strictEqual(msg._abc, 'xyz');
        Assert.strictEqual(msg._blah, 'true');
      });

      StandIn.replaceOnce(UdpTransport.prototype, 'connect', (stand) => {
        connectCalled = true;
      });

      StandIn.replaceOnce(UdpTransport.prototype, 'close', (stand) => {
        sendStand.restore();
        Assert.strictEqual(connectCalled, true);
        resolve();
      });

      client.connect();
      levels.forEach(([method]) => {
        Assert(typeof client[method] === 'function');
        client[method]('foo', 'bar', additionalFields, timestamp);
      });
      client.close();
    });
  });

  it('GELF output can be configured', () => {
    const client = new GelfClient({
      compression: 'none',
      graylogHost: 'localhost',
      graylogPort: 9000,
      host: 'foo',
      version: '99'
    });
    const err = new Error('test error');
    const checks = [
      function (msg) {
        Assert.strictEqual(Object.keys(msg).length, 6);
        Assert.strictEqual(msg.version, '99');
        Assert.strictEqual(msg.host, 'foo');
        Assert.deepStrictEqual(msg.short_message, JSON.stringify({
          name: err.name,
          message: err.message,
          stack: err.stack
        }));
        Assert.strictEqual(msg.full_message, undefined);
        Assert.strictEqual(msg.level, 3);
        Assert(Number.isFinite(msg.timestamp) && msg.timestamp > 0);
      },
      function (msg) {
        Assert.strictEqual(Object.keys(msg).length, 6);
        Assert.strictEqual(msg.short_message, JSON.stringify({ foo: null }));
        Assert.strictEqual(msg.full_message, 'bar');
      },
      function (msg) {
        Assert.strictEqual(msg.level, 1);
      },
      function (msg) {
        Assert.strictEqual(msg.level, 2);
      },
      function (msg) {
        Assert.strictEqual(msg.short_message, 'zzz123');
      }
    ];

    return new Promise((resolve, reject) => {
      const sendStand = StandIn.replace(UdpTransport.prototype, 'send', (stand, msg) => {
        checks[stand.invocations - 1](msg);

        if (stand.invocations === checks.length) {
          sendStand.restore();
          resolve();
        }
      });

      client.error(err);
      client.error({ foo: null }, 'bar', null);
      client.log(null, null, null, null, -1);
      client.log(null, null, null, null, 2);

      // Custom serializer
      client.serializer = function () { return 'zzz123'; };
      client.log(null);
    });
  });

  describe('UdpTransport', () => {
    it('sets defaults in the constructor', () => {
      const testClient = {};
      const transport = new UdpTransport({
        graylogHost: 'foo',
        graylogPort: 3000
      }, testClient);

      Assert.strictEqual(transport.bufferSize, 1400);
      Assert.strictEqual(transport.client, testClient);
      Assert.strictEqual(transport.compression, 'zlib');
      Assert.strictEqual(transport.host, 'foo');
      Assert.strictEqual(transport.port, 3000);
      Assert.strictEqual(transport.socket, null);
      Assert.strictEqual(transport.reuseBuffer, true);
    });

    it('validates constructor options', () => {
      function check (options, err) {
        Assert.throws(() => {
          new UdpTransport(options, {});  // eslint-disable-line no-new
        }, err);
      }

      check({ bufferSize: 'foo' }, /^TypeError: bufferSize must be a number$/);
      check({ bufferSize: -1 }, /^RangeError: bufferSize must be a safe positive integer$/);
      check({ bufferSize: 0 }, /^RangeError: bufferSize must be a safe positive integer$/);
      check({ bufferSize: NaN }, /^RangeError: bufferSize must be a safe positive integer$/);
      check({ bufferSize: Infinity }, /^RangeError: bufferSize must be a safe positive integer$/);
      check({ bufferSize: 12 }, /^RangeError: bufferSize must be larger than 12 to support chunking$/);
      check({ compression: 1 }, /^TypeError: compression must be a string$/);
      check({ compression: 'zzz' }, /^Error: unsupported compression type: zzz$/);
      check({ graylogHost: 1 }, /^TypeError: graylogHost must be a string$/);
      check({
        graylogHost: 'foo',
        graylogPort: 'bar'
      }, /^TypeError: graylogPort must be a number$/);
      check({
        graylogHost: 'foo',
        graylogPort: 5,
        reuseBuffer: 5
      }, /^TypeError: reuseBuffer must be a boolean$/);
    });

    it('connect() sets up the socket', () => {
      const transport = new UdpTransport({
        graylogHost: 'foo',
        graylogPort: 9000
      }, {});

      Assert.strictEqual(transport.socket, null);
      transport.connect();
      Assert(transport.socket !== null && typeof transport.socket === 'object');
    });

    it('forwards error events to the gelf client', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        graylogHost: 'foo',
        graylogPort: 9000
      }, client);
      const testError = new Error('test error');

      transport.connect();
      return new Promise((resolve, reject) => {
        client.on('error', (err) => {
          Assert.strictEqual(err, testError);
          resolve();
        });

        transport.socket.emit('error', testError);
      });
    });

    it('close shuts the transport down', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        graylogHost: 'foo',
        graylogPort: 9000
      }, client);

      transport.connect();
      Assert(transport.socket !== null && typeof transport.socket === 'object');
      return new Promise((resolve, reject) => {
        const socket = transport.socket;

        socket.on('close', () => {
          resolve();
        });

        transport.close();
        Assert.strictEqual(transport.socket, null);
        Assert.strictEqual(transport.client, null);
      });
    });

    it('emits an error if a message is too large to send', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        bufferSize: 13,
        compression: 'none',
        graylogHost: 'localhost',
        graylogPort: 9000
      }, client);

      transport.connect();
      return new Promise((resolve, reject) => {
        // Repeat 127 times. There will also be two quote characters in JSON.
        const msg = 'x'.repeat(127);

        client.on('error', (err) => {
          transport.close();
          Assert.strictEqual(err.message, 'message too large');
          resolve();
        });

        transport.send(msg);
      });
    });

    it('does not chunk messages that are small enough', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        bufferSize: 13,
        compression: 'none',
        graylogHost: 'localhost',
        graylogPort: 9000
      }, client);

      transport.connect();
      return new Promise((resolve, reject) => {
        // Repeat 11 times. There will also be two quote characters in JSON.
        const msg = 'x'.repeat(11);

        transport.socket.send = function (...args) {
          transport.close();
          const buf = Buffer.from(JSON.stringify(msg));
          Assert.deepStrictEqual(args, [buf, 9000, 'localhost']);
          resolve();
        };

        transport.send(msg);
      });
    });

    it('chunks messages that are big enough with reuseBuffer = true', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        bufferSize: 13,
        compression: 'none',
        graylogHost: 'localhost',
        graylogPort: 9000
      }, client);

      transport.connect();
      return new Promise((resolve, reject) => {
        // Repeat 12 times. There will also be two quote characters in JSON.
        // With a buffer size of 13, sending 14 total characters requires 14
        // chunks, where each chunk is the 12 byte header + 1 data byte.
        const msg = 'x'.repeat(12);
        let called = 0;

        transport.socket.send = function (...args) {
          const [buf, port, host, cb] = args;

          Assert.strictEqual(args.length, 4);
          Assert.strictEqual(port, 9000);
          Assert.strictEqual(host, 'localhost');
          Assert(typeof cb === 'function');
          Assert.strictEqual(buf.length, 13);
          Assert.strictEqual(buf[0], 0x1e);
          Assert.strictEqual(buf[1], 0x0f);
          Assert.strictEqual(buf[10], called);
          Assert.strictEqual(buf[11], 14);

          if (called === 0 || called === 13) {
            Assert.strictEqual(buf[12], '"'.charCodeAt(0));
          } else {
            Assert.strictEqual(buf[12], 'x'.charCodeAt(0));
          }

          called++;
          process.nextTick(cb);

          if (called === 14) {
            setImmediate(() => {
              transport.close();
              resolve();
            });
          }
        };

        transport.send(msg);
      });
    });

    it('chunks messages that are big enough with reuseBuffer = false', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        bufferSize: 13,
        compression: 'none',
        graylogHost: 'localhost',
        graylogPort: 9000,
        reuseBuffer: false
      }, client);

      transport.connect();
      return new Promise((resolve, reject) => {
        // Repeat 12 times. There will also be two quote characters in JSON.
        // With a buffer size of 13, sending 14 total characters requires 14
        // chunks, where each chunk is the 12 byte header + 1 data byte.
        const msg = 'x'.repeat(12);
        let called = 0;

        transport.socket.send = function (...args) {
          const [buf, port, host] = args;

          Assert.strictEqual(args.length, 3);
          Assert.strictEqual(port, 9000);
          Assert.strictEqual(host, 'localhost');
          Assert.strictEqual(buf.length, 13);
          Assert.strictEqual(buf[0], 0x1e);
          Assert.strictEqual(buf[1], 0x0f);
          Assert.strictEqual(buf[10], called);
          Assert.strictEqual(buf[11], 14);

          if (called === 0 || called === 13) {
            Assert.strictEqual(buf[12], '"'.charCodeAt(0));
          } else {
            Assert.strictEqual(buf[12], 'x'.charCodeAt(0));
          }

          called++;

          if (called === 14) {
            setImmediate(() => {
              transport.close();
              resolve();
            });
          }
        };

        transport.send(msg);
      });
    });

    it('forwards send() errors from the dgram module', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        bufferSize: 13,
        compression: 'none',
        graylogHost: 'localhost',
        graylogPort: 9000
      }, client);

      transport.connect();
      return new Promise((resolve, reject) => {
        // This needs multiple chunks, but will bail after an error on the first chunk.
        const msg = 'x'.repeat(12);
        const testError = new Error('test error');
        let called = 0;

        client.on('error', (err) => {
          Assert.strictEqual(err, testError);
          setImmediate(() => {
            transport.close();
            Assert.strictEqual(called, 1);
            resolve();
          });
        });

        transport.socket.send = function (...args) {
          const cb = args[3];
          Assert.strictEqual(called, 0);
          called++;
          cb(testError);
        };

        transport.send(msg);
      });
    });

    it('supports zlib compression', () => {
      const client = new EventEmitter();
      const transport = new UdpTransport({
        bufferSize: 13,
        compression: 'zlib',
        graylogHost: 'localhost',
        graylogPort: 9000
      }, client);

      transport.connect();
      return new Promise((resolve, reject) => {
        const msg = 'x'.repeat(11);
        const expected = Zlib.deflateSync(JSON.stringify(msg));

        transport.socket.send = function (...args) {
          transport.close();
          Assert.deepStrictEqual(args[0], expected);
          resolve();
        };

        transport.send(msg);
      });
    });

    it('supports multiple calls to close()', () => {
      const transport = new UdpTransport({
        graylogHost: 'localhost',
        graylogPort: 9000
      }, null);

      transport.close();
      transport.close();
      transport.connect();
      transport.close();
      transport.close();
    });
  });

  it('exports log level constants', () => {
    Assert.deepStrictEqual(levels, {
      EMERG: 0,
      ALERT: 1,
      CRIT: 2,
      ERR: 3,
      WARNING: 4,
      NOTICE: 5,
      INFO: 6,
      DEBUG: 7
    });
  });
});
