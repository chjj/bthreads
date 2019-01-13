/*!
 * clone.js - object cloning for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
 *   https://w3c.github.io/html/infrastructure.html#safe-passing-of-structured-data
 *   https://w3c.github.io/html/infrastructure.html#serializable-objects
 *   https://heycam.github.io/webidl/#dfn-platform-object
 *   https://developer.mozilla.org/en-US/docs/Web/API/Transferable
 */

/* global SharedArrayBuffer, Blob, File, FileList, ImageData, ImageBitmap */

'use strict';

const {cloneError} = require('./utils');

/*
 * Constants
 */

const HAS_SHARED_ARRAY_BUFFER = typeof SharedArrayBuffer === 'function';
const HAS_BLOB = typeof Blob === 'function';
const HAS_FILE = typeof File === 'function';
const HAS_FILE_LIST = typeof FileList === 'function';
const HAS_IMAGE_DATA = typeof ImageData === 'function';
const HAS_IMAGE_BITMAP = typeof ImageBitmap === 'function';

/**
 * Cloner
 */

class Cloner {
  transform(value, opt) {
    return value;
  }

  isPort(value, opt) {
    return false;
  }

  toPort(value, opt) {
    return value;
  }

  hasPort(transferList, opt) {
    if (!Array.isArray(transferList))
      return false;

    for (const item of transferList) {
      if (this.isPort(item, opt))
        return true;
    }

    return false;
  }

  clone(value, opt) {
    return this._walk(value, opt, null);
  }

  _walk(value, opt, seen) {
    if (isPrimitive(value))
      return this.transform(value, opt);

    if (this.isPort(value, opt))
      return this.toPort(value, opt);

    if (!seen)
      seen = new Map();

    if (seen.has(value))
      return seen.get(value);

    if (Array.isArray(value)) {
      const out = [];

      seen.set(value, out);

      for (const val of value)
        out.push(this._walk(val, opt, seen));

      seen.delete(value);

      return out;
    }

    if (value instanceof Map) {
      const out = new Map();

      seen.set(value, out);

      for (const [key, val] of value) {
        out.set(this._walk(key, opt, seen),
                this._walk(val, opt, seen));
      }

      seen.delete(value);

      return out;
    }

    if (value instanceof Set) {
      const out = new Set();

      seen.set(value, out);

      for (const key of value)
        out.add(this._walk(key, opt, seen));

      seen.delete(value);

      return out;
    }

    const out = Object.create(null);

    seen.set(value, out);

    for (const key of Object.keys(value))
      out[key] = this._walk(value[key], opt, seen);

    seen.delete(value);

    return out;
  }

  morph(value, transferList, opt) {
    if (!this.hasPort(transferList, opt))
      return [value, transferList, false];

    const list = [];

    for (const item of transferList) {
      if (this.isPort(item, opt))
        list.push(this.toPort(item, opt));
      else
        list.push(item);
    }

    return [this.clone(value, opt), list, true];
  }

  static clone(value, opt) {
    return new this().clone(value, opt);
  }

  static morph(value, transferList, opt) {
    return new this().morph(value, transferList, opt);
  }
}

/**
 * Uncloner
 */

class Uncloner {
  transform(value, opt) {
    return value;
  }

  isPort(value, opt) {
    return false;
  }

  toPort(value, opt) {
    return value;
  }

  unclone(value, opt) {
    return this._walk(value, opt, null);
  }

  _walk(value, opt, seen) {
    if (isPrimitive(value))
      return this.transform(value, opt);

    if (this.isPort(value, opt))
      return this.toPort(value, opt);

    if (!seen)
      seen = new Set();

    if (seen.has(value))
      return value;

    seen.add(value);

    if (Array.isArray(value)) {
      seen.add(value);

      for (let i = 0; i < value.length; i++)
        value[i] = this._walk(value[i], opt, seen);

      seen.delete(value);

      return value;
    }

    if (value instanceof Map) {
      const added = [];

      seen.add(value);

      for (const [key, val] of value) {
        const k = this._walk(key, opt, seen);
        const v = this._walk(val, opt, seen);

        if (k !== key) {
          value.delete(key);
          added.push([k, v]);
        } else if (v !== val) {
          value.set(k, v);
        }
      }

      for (const [k, v] of added)
        value.set(k, v);

      seen.delete(value);

      return value;
    }

    if (value instanceof Set) {
      const added = [];

      seen.add(value);

      for (const key of value) {
        const k = this._walk(key, opt, seen);

        if (k !== key) {
          value.delete(key);
          added.push(k);
        }
      }

      for (const k of added)
        value.add(k);

      seen.delete(value);

      return value;
    }

    seen.add(value);

    for (const key of Object.keys(value)) {
      const val = value[key];
      const v = this._walk(val, opt, seen);

      if (v !== val)
        value[key] = v;
    }

    seen.delete(value);

    return value;
  }

  static unclone(value, opt) {
    return new this().unclone(value, opt);
  }
}

/**
 * Collector
 */

class Collector {
  isPort(value, opt) {
    return false;
  }

  collect(value, opt) {
    return this._walk(value, opt, [], null);
  }

  _walk(value, opt, list, seen) {
    if (isPrimitive(value))
      return list;

    if (this.isPort(value, opt)) {
      list.push(value);
      return list;
    }

    if (!seen)
      seen = new Set();

    if (seen.has(value))
      return list;

    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++)
        this._walk(value[i], opt, list, seen);
    } else if (value instanceof Map) {
      for (const [key, val] of value) {
        this._walk(key, opt, list, seen);
        this._walk(val, opt, list, seen);
      }
    } else if (value instanceof Set) {
      for (const key of value) {
        this._walk(key, opt, list, seen);
      }
    } else {
      for (const key of Object.keys(value))
        this._walk(value[key], opt, list, seen);
    }

    seen.delete(value);

    return list;
  }

  static collect(value, opt) {
    return new this().collect(value, opt);
  }
}

/**
 * FullCloner
 */

class FullCloner extends Cloner {
  constructor() {
    super();
  }

  isTransferList(list) {
    if (list === undefined)
      return true;

    if (!Array.isArray(list))
      return false;

    for (const item of list) {
      if (!this.isTransferable(item))
        return false;
    }

    return true;
  }

  isTransferable(item) {
    if (item instanceof ArrayBuffer)
      return true;

    if (this.isPort(item))
      return true;

    if (HAS_IMAGE_BITMAP) {
      if (item instanceof ImageBitmap)
        return true;
    }

    return false;
  }

  transform(value, list) {
    if (typeof value === 'function')
      throw cloneError(value);

    if (typeof value === 'symbol')
      throw cloneError(value);

    if (value === null || typeof value !== 'object')
      return value;

    if (value instanceof Error)
      throw cloneError(value);

    if (value instanceof RegExp)
      return new RegExp(value.source, value.flags);

    if (value instanceof Date)
      return new Date(value.getTime());

    if (value instanceof Promise)
      throw cloneError(value);

    if (value instanceof ArrayBuffer) {
      if (list.has(value))
        return value;

      const arr = new Uint8Array(value, 0, value.byteLength);

      return (new Uint8Array(arr)).buffer;
    }

    if (Buffer.isBuffer(value)) {
      if (list.has(value.buffer)) {
        return new Uint8Array(value.buffer,
                              value.byteOffset,
                              value.byteLength);
      }

      return new Uint8Array(value);
    }

    if (ArrayBuffer.isView(value)) {
      if (list.has(value.buffer))
        return value;

      return new value.constructor(value);
    }

    if (HAS_BLOB) {
      if (value instanceof Blob)
        throw cloneError(value);
    }

    if (HAS_FILE) {
      if (value instanceof File)
        throw cloneError(value);
    }

    if (HAS_FILE_LIST) {
      if (value instanceof FileList)
        throw cloneError(value);
    }

    if (HAS_IMAGE_DATA) {
      if (value instanceof ImageData) {
        const data = new Uint8ClampedArray(value.data);
        const {width, height} = value;

        return new ImageData(data, width, height);
      }
    }

    if (HAS_IMAGE_BITMAP) {
      if (value instanceof ImageBitmap) {
        if (list.has(value))
          return value;

        throw cloneError(value);
      }
    }

    return value;
  }

  clone(value, transferList) {
    if (transferList === undefined)
      transferList = [];

    if (!this.isTransferList(transferList))
      throw new TypeError('Invalid transferList.');

    return this._walk(value, new Set(transferList), null);
  }
}

/*
 * Helpers
 */

function isPrimitive(value) {
  if (value === null || typeof value !== 'object')
    return true;

  if (value instanceof Error)
    return true;

  if (value instanceof RegExp)
    return true;

  if (value instanceof Date)
    return true;

  if (value instanceof Promise)
    return true;

  if (value instanceof ArrayBuffer)
    return true;

  if (HAS_SHARED_ARRAY_BUFFER) {
    if (value instanceof SharedArrayBuffer)
      return true;
  }

  if (Buffer.isBuffer(value))
    return true;

  if (ArrayBuffer.isView(value))
    return true;

  if (HAS_BLOB) {
    if (value instanceof Blob)
      return true;
  }

  if (HAS_FILE) {
    if (value instanceof File)
      return true;
  }

  if (HAS_FILE_LIST) {
    if (value instanceof FileList)
      return true;
  }

  if (HAS_IMAGE_DATA) {
    if (value instanceof ImageData)
      return true;
  }

  if (HAS_IMAGE_BITMAP) {
    if (value instanceof ImageBitmap)
      return true;
  }

  return false;
}

/*
 * Expose
 */

exports.Cloner = Cloner;
exports.Uncloner = Uncloner;
exports.Collector = Collector;
exports.FullCloner = FullCloner;
