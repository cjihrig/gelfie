'use strict';
const Crypto = require('crypto');
const Dgram = require('dgram');
const Zlib = require('zlib');
const { promisify } = require('util');
const kChunkHeaderSize = 12;
const kDefaultBufSize = 1400;
const kMagicByte0 = 0x1e;
const kMagicByte1 = 0x0f;
const kMaxChunks = 128;
const kMessageIdBytes = 8;
const kOffsetMagicByte0 = 0;
const kOffsetMagicByte1 = 1;
const kOffsetMessageId = 2;
const kOffsetSequenceNumber = 10;
const kOffsetSequenceCount = 11;
const kOffsetPayload = 12;
const supportedCompression = new Set(['none', 'zlib']);
const randomBytes = promisify(Crypto.randomBytes);
const deflate = promisify(Zlib.deflate);
const { isSafeInteger } = Number;


class UdpTransport {
  constructor (options, client) {
    const {
      compression = 'zlib',
      bufferSize = kDefaultBufSize,
      graylogHost = undefined,
      graylogPort = undefined,
      reuseBuffer = true
    } = options;

    if (typeof bufferSize !== 'number') {
      throw new TypeError('bufferSize must be a number');
    }

    if (bufferSize <= 0 || !isSafeInteger(bufferSize)) {
      throw new RangeError('bufferSize must be a safe positive integer');
    }

    if (bufferSize <= kChunkHeaderSize) {
      throw new RangeError(
        `bufferSize must be larger than ${kChunkHeaderSize} to support chunking`
      );
    }

    if (typeof compression !== 'string') {
      throw new TypeError('compression must be a string');
    }

    if (!supportedCompression.has(compression)) {
      throw new Error(`unsupported compression type: ${compression}`);
    }

    if (typeof graylogHost !== 'string') {
      throw new TypeError('graylogHost must be a string');
    }

    if (typeof graylogPort !== 'number') {
      throw new TypeError('graylogPort must be a number');
    }

    if (typeof reuseBuffer !== 'boolean') {
      throw new TypeError('reuseBuffer must be a boolean');
    }

    this.bufferSize = bufferSize;
    this.client = client;
    this.compression = compression;
    this.host = graylogHost;
    this.port = graylogPort;
    this.socket = null;
    this.reuseBuffer = reuseBuffer;
  }

  connect () {
    // For UDP, this could be done in the constructor. However, since a TCP
    // transport uses a connect() call, we might as well do some work here.
    const socket = Dgram.createSocket('udp4');

    socket.on('error', (err) => {
      this.client.emit('error', err);
    });

    this.socket = socket;
  }

  close () {
    if (this.socket === null) {
      return;
    }

    const socket = this.socket;

    this.client = null;
    this.socket = null;
    socket.close(() => {
      socket.removeAllListeners();
    });
  }

  async send (message) {
    const json = JSON.stringify(message);
    const msg = this.compression === 'zlib' ? await deflate(json) :
      Buffer.from(json);
    const byteLength = Buffer.byteLength(msg);

    if (byteLength <= this.bufferSize) {
      // Chunking is not required.
      this.socket.send(msg, this.port, this.host);
      return;
    }

    const maxDataPerChunk = this.bufferSize - kChunkHeaderSize;
    const numChunks = Math.ceil(byteLength / maxDataPerChunk);

    if (numChunks > kMaxChunks) {
      this.client.emit('error', new Error('message too large'));
      return;
    }

    // Send as few bytes per chunk as possible. We're still sending the same
    // number of bytes in the same number of chunks.
    const totalHeaderSize = numChunks * kChunkHeaderSize;
    const chunkSize = Math.ceil((byteLength + totalHeaderSize) / numChunks);
    const msgId = await randomBytes(kMessageIdBytes);

    if (this.reuseBuffer) {
      const buf = Buffer.allocUnsafe(chunkSize);

      buf[kOffsetMagicByte0] = kMagicByte0;
      buf[kOffsetMagicByte1] = kMagicByte1;
      msgId.copy(buf, kOffsetMessageId);
      buf[kOffsetSequenceCount] = numChunks;
      this._send(msg, buf, 0, byteLength);
    } else {
      for (let sequenceId = 0; sequenceId < numChunks; sequenceId++) {
        const buf = Buffer.allocUnsafe(chunkSize);
        const msgStart = sequenceId * maxDataPerChunk;
        const msgEnd = Math.min(msg.byteLength, msgStart + maxDataPerChunk);

        buf[kOffsetMagicByte0] = kMagicByte0;
        buf[kOffsetMagicByte1] = kMagicByte1;
        msgId.copy(buf, kOffsetMessageId);
        buf[kOffsetSequenceCount] = numChunks;
        buf[kOffsetSequenceNumber] = sequenceId;
        msg.copy(buf, kOffsetPayload, msgStart, msgEnd);
        this.socket.send(buf, this.port, this.host);
      }
    }
  }

  _send (data, chunk, sequenceId, bytesToSend) {
    const bytesToCopy =
      Math.min(bytesToSend, chunk.byteLength - kChunkHeaderSize);
    const dataStart = data.byteLength - bytesToSend;
    const dataEnd = dataStart + bytesToCopy;

    chunk[kOffsetSequenceNumber] = sequenceId;
    data.copy(chunk, kOffsetPayload, dataStart, dataEnd);
    this.socket.send(chunk, this.port, this.host, (err) => {
      if (err) {
        this.client.emit('error', err);
        return;
      }

      const remainingBytes = bytesToSend - bytesToCopy;

      if (remainingBytes > 0) {
        this._send(data, chunk, sequenceId + 1, remainingBytes);
      }
    });
  }
}

module.exports = { UdpTransport };
