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
const utils = require('../internal/utils');
const {Packet} = require('./common');
const {custom, inspectify} = utils;
const {STDIO_WRITE} = Packet.types;

/**
 * Readable
 */

class Readable extends stream.Readable {
  constructor(port, fd) {
    super();

    this._port = port;
    this._fd = fd;
    this._isStdio = true;
  }

  [custom]() {
    return inspectify(Readable);
  }
}

/**
 * Writable
 */

class Writable extends stream.Writable {
  constructor(port, fd) {
    super({ decodeStrings: false });

    this._port = port;
    this._fd = fd;
    this._isStdio = true;
  }

  _write(data, enc) {
    this._port._send(new Packet(STDIO_WRITE, [this._fd, data, enc]));
  }

  _moreData() {}

  [custom]() {
    return inspectify(Writable);
  }
}

/**
 * Console
 */

class Console extends stream.Writable {
  constructor(log, ctx = null) {
    super({ decodeStrings: true });

    if (typeof log !== 'function')
      throw new Error('Must pass a log function.');

    this.log = log.bind(ctx);
    this.buffer = '';
  }

  _write(data, enc) {
    const str = data.toString('utf8');

    if (str.length === 0)
      return true;

    const lines = str.split('\n');

    if (lines.length === 1) {
      this.buffer += lines[0];
      return false;
    }

    const last = lines.pop();
    const msg = this.buffer + lines.join('\n');

    this.buffer = last;

    this.log(msg);

    return true;
  }

  [custom]() {
    return inspectify(Writable);
  }
}

/*
 * Expose
 */

exports.Readable = Readable;
exports.Writable = Writable;
exports.Console = Console;
