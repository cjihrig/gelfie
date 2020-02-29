'use strict';
const { Socket } = require('net');


class TcpTransport {
  constructor (options, client) {
    const {
      graylogHost = undefined,
      graylogPort = undefined,
      maxBacklogSize = 1024,
      socketOptions = {}
    } = options;

    if (typeof graylogHost !== 'string') {
      throw new TypeError('graylogHost must be a string');
    }

    if (typeof graylogPort !== 'number') {
      throw new TypeError('graylogPort must be a number');
    }

    if (typeof maxBacklogSize !== 'number') {
      throw new TypeError('maxBacklogSize must be a number');
    }

    if (maxBacklogSize < 0 || !Number.isSafeInteger(maxBacklogSize)) {
      throw new RangeError('maxBacklogSize must be a safe integer >= 0');
    }

    if (socketOptions === null || typeof socketOptions !== 'object') {
      throw new TypeError('socketOptions must be an object');
    }

    this.backlog = [];
    this.canAcceptData = true;
    this.client = client;
    this.host = graylogHost;
    this.maxBacklogSize = maxBacklogSize;
    this.port = graylogPort;
    this.socket = null;
    this.socketOptions = {
      ...socketOptions,
      port: graylogPort,
      host: graylogHost
    };
  }

  connect () {
    const socket = new Socket(this.socketOptions);

    socket.on('error', (err) => {
      this.client.emit('error', err);
    });

    socket.on('drain', () => {
      this.canAcceptData = true;

      /* $lab:coverage:off$ */
      while (this.canAcceptData && this.backlog.length > 0) {
        /* $lab:coverage:on$ */
        const data = this.backlog.shift();
        this.canAcceptData = this.socket.write(data);
      }
    });

    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.connect(this.socketOptions, () => {
        resolve();
      });
    });
  }

  close () {
    this.client = null;

    if (this.socket === null) {
      return;
    }

    const socket = this.socket;
    this.backlog = null;
    this.socket = null;
    this.socketOptions = null;
    socket.end();
  }

  send (message) {
    const msg = Buffer.from(`${JSON.stringify(message)}\0`);

    if (this.canAcceptData) {
      this.canAcceptData = this.socket.write(msg);
    } else if (this.backlog.length < this.maxBacklogSize) {
      this.backlog.push(msg);
    } else {
      this.client.emit('error', new Error('too many messages buffered'));
    }
  }
}

module.exports = { TcpTransport };
