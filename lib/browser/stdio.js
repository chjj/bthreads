/*!
 * stdio.js - stdio streams for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Parts of this software are based on nodejs/node:
 *   Copyright Node.js contributors. All rights reserved.
 *   https://github.com/nodejs/node
 */

'use strict';

const stream = require('./stream');
const {Packet} = require('./common');
const {STDIO_WRITE} = Packet.types;

/**
 * Readable
 */

class Readable extends stream.Readable {
  constructor(port, fd) {
    super();
    this._isStdio = true;
    this._port = port;
    this._fd = fd;
  }
}

/**
 * Writable
 */

class Writable extends stream.Writable {
  constructor(port, fd) {
    super({ decodeStrings: false });
    this._isStdio = true;
    this._port = port;
    this._fd = fd;
  }

  _write(data, enc) {
    this._port._send(new Packet(STDIO_WRITE, [this._fd, data, enc]));
  }

  _moreData() {}
}

/*
 * Expose
 */

exports.NullReadable = stream.Readable;
exports.NullWritable = stream.Writable;
exports.Readable = Readable;
exports.Writable = Writable;
