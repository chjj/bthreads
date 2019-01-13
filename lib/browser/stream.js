/*!
 * stream.js - stream object for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Parts of this software are based on nodejs/node:
 *   Copyright Node.js contributors. All rights reserved.
 *   https://github.com/nodejs/node
 */

'use strict';

const {EventEmitter} = require('events');
const {StringDecoder} = require('string_decoder');

/**
 * Stream
 */

class Stream extends EventEmitter {
  constructor() {
    super();
    this.readable = false;
    this.writable = false;
    this.decoder = null;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }
}

/**
 * Readable
 */

class Readable extends Stream {
  constructor() {
    super();
    this.readable = true;
    this.readableHighWaterMark = 16384;
    this.readableLength = 0;
    this.ended = false;
    this._decoder = null;
  }

  emit(event, ...args) {
    if (event === 'end')
      this.ended = true;

    return super.emit(event, ...args);
  }

  setEncoding(enc) {
    if (typeof enc === 'string')
      this._decoder = new StringDecoder(enc);
    else
      this._decoder = null;

    return this;
  }

  destroy(err) {
    if (err)
      this.emit('error', err);

    return this;
  }

  isPaused() {
    return false;
  }

  push(data, enc) {
    if (this._decoder) {
      if (Buffer.isBuffer(data))
        data = this._decoder.write(data);

      if (typeof data !== 'string')
        data = String(data);
    } else {
      if (typeof data === 'string')
        data = Buffer.from(data, enc || 'utf8');

      if (!Buffer.isBuffer(data))
        data = Buffer.from(String(data), 'utf8');
    }

    this.emit('data', data);

    return this;
  }

  pause() {
    return this;
  }

  resume() {
    return this;
  }

  pipe(dest, options) {
    const source = this;

    function ondata(chunk) {
      if (dest.writable && dest.write(chunk) === false && source.pause)
        source.pause();
    }

    source.on('data', ondata);

    function ondrain() {
      if (source.readable && source.resume)
        source.resume();
    }

    dest.on('drain', ondrain);

    // If the 'end' option is not supplied, dest.end() will be called when
    // source gets the 'end' or 'close' events.  Only dest.end() once.
    if (!dest._isStdio && (!options || options.end !== false)) {
      source.on('end', onend);
      source.on('close', onclose);
    }

    let didOnEnd = false;

    function onend() {
      if (didOnEnd)
        return;

      didOnEnd = true;
      dest.end();
    }

    function onclose() {
      if (didOnEnd)
        return;

      didOnEnd = true;

      if (typeof dest.destroy === 'function')
        dest.destroy();
    }

    // don't leave dangling pipes when there are errors.
    function onerror(err) {
      cleanup();
      if (EventEmitter.listenerCount(this, 'error') === 0)
        throw err; // Unhandled stream error in pipe.
    }

    source.on('error', onerror);
    dest.on('error', onerror);

    // remove all the event listeners that were added.
    function cleanup() {
      source.removeListener('data', ondata);
      dest.removeListener('drain', ondrain);

      source.removeListener('end', onend);
      source.removeListener('close', onclose);

      source.removeListener('error', onerror);
      dest.removeListener('error', onerror);

      source.removeListener('end', cleanup);
      source.removeListener('close', cleanup);

      dest.removeListener('close', cleanup);
    }

    source.on('end', cleanup);
    source.on('close', cleanup);

    dest.on('close', cleanup);
    dest.emit('pipe', source);

    // Allow for unix-like usage: A.pipe(B).pipe(C)
    return dest;
  }
}

/**
 * Writable
 */

class Writable extends Stream {
  constructor(options) {
    super();
    this.options = options;
    this.writable = true;
    this.writableHighWaterMark = 16384;
    this.writableLength = 0;
  }

  setDefaultEncoding(enc) {
    return this;
  }

  uncork() {
    return this;
  }

  destroy(err) {
    if (err)
      this.emit('error', err);

    return this;
  }

  write(data, enc, callback) {
    if (typeof enc === 'function')
      [enc, callback] = [callback, enc];

    if (typeof enc !== 'string')
      enc = null;

    if (typeof callback !== 'function')
      callback = null;

    if (typeof data !== 'string'
        && !Buffer.isBuffer(data)) {
      data = String(data);
    }

    if (this.options && this.options.decodeStrings !== false) {
      if (typeof data === 'string')
        data = Buffer.from(data, enc || 'utf8');
    }

    if (callback)
      callback();

    return this._write(data, enc);
  }

  _write(data, enc, callback) {
    return true;
  }

  end(data, enc, callback) {
    return this.write(data, enc, callback);
  }
}

/*
 * Expose
 */

exports.Stream = Stream;
exports.Readable = Readable;
exports.Writable = Writable;
