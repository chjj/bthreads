/*!
 * encoding.js - worker encoding for bthreads
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

/* global BigInt, BigInt64Array, BigUint64Array */

// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm

'use strict';

const bio = require('bufio');

/*
 * Constants
 */

const types = {
  UNDEFINED: 0,
  NULL: 1,
  TRUE: 2,
  FALSE: 3,
  NUMBER: 4,
  NAN: 5,
  POSITIVE_INFINITY: 6,
  NEGATIVE_INFINITY: 7,
  INT32: 8,
  UINT32: 9,
  STRING: 10,
  SYMBOL: 11,
  BIGINT: 12,
  FUNCTION: 13,
  OBJECT: 14,
  ARRAY: 15,
  MAP: 16,
  SET: 17,
  ERROR: 18,
  REGEX: 19,
  DATE: 20,
  INVALID_DATE: 21,
  BUFFER: 22,
  ARRAY_BUFFER: 23,
  INT8_ARRAY: 24,
  UINT8_ARRAY: 25,
  UINT8_CLAMPED_ARRAY: 26,
  INT16_ARRAY: 27,
  UINT16_ARRAY: 28,
  INT32_ARRAY: 29,
  UINT32_ARRAY: 30,
  FLOAT32_ARRAY: 31,
  FLOAT64_ARRAY: 32,
  BIG_INT64_ARRAY: 33,
  BIG_UINT64_ARRAY: 34,
  MESSAGE_PORT: 35
};

/*
 * Encoding
 */

function encode(value) {
  const size = getSize(value);
  const bw = bio.write(size);
  write(bw, value);
  return bw.render();
}

function getType(value) {
  switch (typeof value) {
    case 'undefined': {
      return types.UNDEFINED;
    }
    case 'boolean': {
      return value ? types.TRUE : types.FALSE;
    }
    case 'number': {
      if ((value >>> 0) === value)
        return types.UINT32;

      if ((value | 0) === value)
        return types.INT32;

      if (value !== value)
        return types.NAN;

      if (value === Infinity)
        return types.POSITIVE_INFINITY;

      if (value === -Infinity)
        return types.NEGATIVE_INFINITY;

      return types.NUMBER;
    }
    case 'string': {
      return types.STRING;
    }
    case 'symbol': {
      return types.SYMBOL;
    }
    case 'bigint': {
      return types.BIGINT;
    }
    case 'function': {
      return types.FUNCTION;
    }
    case 'object': {
      if (value === null)
        return types.NULL;

      if (Array.isArray(value))
        return types.ARRAY;

      if (value instanceof Map)
        return types.MAP;

      if (value instanceof Set)
        return types.SET;

      if (value instanceof Error)
        return types.ERROR;

      if (value instanceof RegExp)
        return types.REGEX;

      if (value instanceof Date) {
        const time = value.getTime();
        if (time !== time)
          return types.INVALID_DATE;
        return types.DATE;
      }

      if (Buffer.isBuffer(value))
        return types.BUFFER;

      if (value instanceof ArrayBuffer)
        return types.ARRAY_BUFFER;

      if (value instanceof Int8Array)
        return types.INT8_ARRAY;

      if (value instanceof Uint8Array)
        return types.UINT8_ARRAY;

      if (value instanceof Uint8ClampedArray)
        return types.UINT8_CLAMPED_ARRAY;

      if (value instanceof Int16Array)
        return types.INT16_ARRAY;

      if (value instanceof Uint16Array)
        return types.UINT16_ARRAY;

      if (value instanceof Int32Array)
        return types.INT32_ARRAY;

      if (value instanceof Uint32Array)
        return types.UINT32_ARRAY;

      if (value instanceof Float32Array)
        return types.FLOAT32_ARRAY;

      if (value instanceof Float64Array)
        return types.FLOAT64_ARRAY;

      if (typeof BigInt !== 'undefined') {
        if (value instanceof BigInt64Array)
          return types.BIG_INT64_ARRAY;

        if (value instanceof BigUint64Array)
          return types.BIG_UINT64_ARRAY;
      }

      if (value._bthreadPort)
        return types.MESSAGE_PORT;

      return types.OBJECT;
    }
    default: {
      return types.OBJECT;
    }
  }
}

function getSize(value, seen = new Set()) {
  if (seen.has(value))
    return 1;

  const type = getType(value);

  let size = 1;

  switch (type) {
    case types.UNDEFINED: {
      break;
    }
    case types.NULL: {
      break;
    }
    case types.TRUE: {
      break;
    }
    case types.FALSE: {
      break;
    }
    case types.NUMBER: {
      size += 8;
      break;
    }
    case types.NAN: {
      break;
    }
    case types.POSITIVE_INFINITY: {
      break;
    }
    case types.NEGATIVE_INFINITY: {
      break;
    }
    case types.INT32: {
      size += 4;
      break;
    }
    case types.UINT32: {
      size += 4;
      break;
    }
    case types.STRING: {
      size += bio.sizeVarString(value, 'utf8');
      break;
    }
    case types.SYMBOL: {
      size += bio.sizeVarString(value.description, 'utf8');
      break;
    }
    case types.BIGINT: {
      size += 1;

      let len = value.toString(16).length;

      if (len & 1)
        len += 1;

      len >>>= 1;

      size += len;

      break;
    }
    case types.FUNCTION: {
      throw cloneError();
    }
    case types.OBJECT: {
      if (Object.getPrototypeOf(value) === null)
        throw cloneError();

      const keys = Object.keys(value);

      size += 4;

      seen.add(value);

      for (const key of keys) {
        size += bio.sizeVarString(key, 'utf8');
        size += getSize(value[key], seen);
      }

      seen.delete(value);

      break;
    }
    case types.ARRAY: {
      size += 4;

      seen.add(value);

      for (const val of value)
        size += getSize(val, seen);

      seen.delete(value);

      break;
    }
    case types.MAP: {
      size += 4;

      seen.add(value);

      for (const [key, val] of value) {
        size += getSize(key, seen);
        size += getSize(val, seen);
      }

      seen.delete(value);

      break;
    }
    case types.SET: {
      size += 4;

      seen.add(value);

      for (const key of value)
        size += getSize(key, seen);

      seen.delete(value);

      break;
    }
    case types.ERROR: {
      const keys = Object.keys(value);

      if (!keys.includes('name'))
        keys.push('name');

      if (!keys.includes('message'))
        keys.push('message');

      if (!keys.includes('stack'))
        keys.push('stack');

      size += 4;

      seen.add(value);

      for (const key of keys) {
        size += bio.sizeVarString(key, 'utf8');
        size += getSize(value[key], seen);
      }

      seen.delete(value);

      break;
    }
    case types.REGEX: {
      size += bio.sizeVarString(value.source, 'utf8');
      size += bio.sizeVarString(value.flags, 'utf8');
      break;
    }
    case types.DATE: {
      size += 8;
      break;
    }
    case types.INVALID_DATE: {
      break;
    }
    case types.BUFFER: {
      size += bio.sizeVarlen(value.length);
      break;
    }
    case types.ARRAY_BUFFER: {
      size += bio.sizeVarlen(value.byteLength);
      break;
    }
    case types.INT8_ARRAY:
    case types.UINT8_ARRAY:
    case types.UINT8_CLAMPED_ARRAY:
    case types.INT16_ARRAY:
    case types.UINT16_ARRAY:
    case types.INT32_ARRAY:
    case types.UINT32_ARRAY:
    case types.FLOAT32_ARRAY:
    case types.FLOAT64_ARRAY:
    case types.BIG_INT64_ARRAY:
    case types.BIG_UINT64_ARRAY: {
      size += bio.sizeVarlen(value.byteLength);
      break;
    }
    case types.MESSAGE_PORT: {
      size += 4;
      break;
    }
    default: {
      throw cloneError();
    }
  }

  return size;
}

function write(bw, value, seen = new Set()) {
  if (seen.has(value)) {
    bw.writeU8(types.UNDEFINED);
    return;
  }

  const type = getType(value);

  if (type === types.BUFFER)
    bw.writeU8(types.UINT8_ARRAY);
  else
    bw.writeU8(type);

  switch (type) {
    case types.UNDEFINED: {
      break;
    }
    case types.NULL: {
      break;
    }
    case types.TRUE: {
      break;
    }
    case types.FALSE: {
      break;
    }
    case types.NUMBER: {
      bw.writeDouble(value);
      break;
    }
    case types.NAN: {
      break;
    }
    case types.POSITIVE_INFINITY: {
      break;
    }
    case types.NEGATIVE_INFINITY: {
      break;
    }
    case types.INT32: {
      bw.writeI32(value);
      break;
    }
    case types.UINT32: {
      bw.writeU32(value);
      break;
    }
    case types.STRING: {
      bw.writeVarString(value, 'utf8');
      break;
    }
    case types.SYMBOL: {
      bw.writeVarString(value.description, 'utf8');
      break;
    }
    case types.BIGINT: {
      const sign = value < BigInt(0) ? 1 : 0;

      bw.writeU8(sign);

      let hex = value.toString(16);

      if (hex.length & 1)
        hex = '0' + hex;

      bw.writeVarString(hex, 'hex');

      break;
    }
    case types.FUNCTION: {
      throw cloneError();
    }
    case types.OBJECT: {
      if (Object.getPrototypeOf(value) === null)
        throw cloneError();

      const keys = Object.keys(value);

      bw.writeU32(keys.length);

      seen.add(value);

      for (const key of keys) {
        bw.writeVarString(key, 'utf8');
        write(bw, value[key], seen);
      }

      seen.delete(value);

      break;
    }
    case types.ARRAY: {
      bw.writeU32(value.length);

      seen.add(value);

      for (const val of value)
        write(bw, val, seen);

      seen.delete(value);

      break;
    }
    case types.MAP: {
      bw.writeU32(value.size);

      seen.add(value);

      for (const [key, val] of value) {
        write(bw, key, seen);
        write(bw, val, seen);
      }

      seen.delete(value);

      break;
    }
    case types.SET: {
      bw.writeU32(value.size);

      seen.add(value);

      for (const key of value)
        write(bw, key, seen);

      seen.delete(value);

      break;
    }
    case types.ERROR: {
      const keys = Object.keys(value);

      if (!keys.includes('name'))
        keys.push('name');

      if (!keys.includes('message'))
        keys.push('message');

      if (!keys.includes('stack'))
        keys.push('stack');

      bw.writeU32(keys.length);

      seen.add(value);

      for (const key of keys) {
        bw.writeVarString(key, 'utf8');
        write(bw, value[key], seen);
      }

      seen.delete(value);

      break;
    }
    case types.REGEX: {
      bw.writeVarString(value.source, 'utf8');
      bw.writeVarString(value.flags, 'utf8');
      break;
    }
    case types.DATE: {
      bw.writeU64(value.getTime());
      break;
    }
    case types.INVALID_DATE: {
      break;
    }
    case types.BUFFER: {
      bw.writeVarBytes(value);
      break;
    }
    case types.ARRAY_BUFFER: {
      const data = Buffer.from(value, 0, value.byteLength);
      bw.writeVarBytes(data);
      break;
    }
    case types.INT8_ARRAY:
    case types.UINT8_ARRAY:
    case types.UINT8_CLAMPED_ARRAY:
    case types.INT16_ARRAY:
    case types.UINT16_ARRAY:
    case types.INT32_ARRAY:
    case types.UINT32_ARRAY:
    case types.FLOAT32_ARRAY:
    case types.FLOAT64_ARRAY:
    case types.BIG_INT64_ARRAY:
    case types.BIG_UINT64_ARRAY: {
      const data = Buffer.from(value.buffer,
                               value.byteOffset,
                               value.byteLength);
      bw.writeVarBytes(data);
      break;
    }
    case types.MESSAGE_PORT: {
      bw.writeU32(value._id);
      break;
    }
    default: {
      throw cloneError();
    }
  }
}

function decode(data, parent) {
  return read(bio.read(data), parent);
}

function read(br, parent) {
  const type = br.readU8();

  switch (type) {
    case types.UNDEFINED: {
      return undefined;
    }
    case types.NULL: {
      return null;
    }
    case types.TRUE: {
      return true;
    }
    case types.FALSE: {
      return false;
    }
    case types.NUMBER: {
      return br.readDouble();
    }
    case types.NAN: {
      return NaN;
    }
    case types.POSITIVE_INFINITY: {
      return Infinity;
    }
    case types.NEGATIVE_INFINITY: {
      return -Infinity;
    }
    case types.INT32: {
      return br.readI32();
    }
    case types.UINT32: {
      return br.readU32();
    }
    case types.STRING: {
      return br.readVarString('utf8');
    }
    case types.SYMBOL: {
      br.readVarString('utf8');
      return undefined;
    }
    case types.BIGINT: {
      const sign = br.readU8() ? -1 : 1;
      return BigInt('0x' + br.readVarString('hex')) * BigInt(sign);
    }
    case types.FUNCTION: {
      return function() {};
    }
    case types.OBJECT: {
      const obj = {};
      const count = br.readU32();

      for (let i = 0; i < count; i++) {
        const key = br.readVarString('utf8');
        const value = read(br, parent);

        obj[key] = value;
      }

      return obj;
    }
    case types.ARRAY: {
      const arr = [];
      const count = br.readU32();

      for (let i = 0; i < count; i++) {
        const value = read(br, parent);
        arr.push(value);
      }

      return arr;
    }
    case types.MAP: {
      const map = new Map();
      const count = br.readU32();

      for (let i = 0; i < count; i++) {
        const key = read(br, parent);
        const value = read(br, parent);

        map.set(key, value);
      }

      return map;
    }
    case types.SET: {
      const set = new Set();
      const count = br.readU32();

      for (let i = 0; i < count; i++) {
        const value = read(br, parent);
        set.add(value);
      }

      return set;
    }
    case types.ERROR: {
      const err = new Error();
      const count = br.readU32();

      for (let i = 0; i < count; i++) {
        const key = br.readVarString('utf8');
        const value = read(br, parent);

        err[key] = value;
      }

      return err;
    }
    case types.REGEX: {
      const source = br.readVarString('utf8');
      const flags = br.readVarString('utf8');
      return new RegExp(source, flags);
    }
    case types.DATE: {
      const ms = br.readU64();
      return new Date(ms);
    }
    case types.INVALID_DATE: {
      return new Date(NaN);
    }
    case types.BUFFER: {
      return br.readVarBytes();
    }
    case types.ARRAY_BUFFER: {
      const slice = br.readVarBytes(true);
      const data = Buffer.allocUnsafeSlow(slice.length);
      slice.copy(data, 0);
      return data.buffer;
    }
    case types.INT8_ARRAY: {
      const data = br.readVarBytes();
      return new Int8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.UINT8_ARRAY: {
      const data = br.readVarBytes();
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.UINT8_CLAMPED_ARRAY: {
      const data = br.readVarBytes();
      return new Uint8ClampedArray(data.buffer,
                                   data.byteOffset,
                                   data.byteLength);
    }
    case types.INT16_ARRAY: {
      const data = br.readVarBytes();
      return new Int16Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.UINT16_ARRAY: {
      const data = br.readVarBytes();
      return new Uint16Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.INT32_ARRAY: {
      const data = br.readVarBytes();
      return new Int32Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.UINT32_ARRAY: {
      const data = br.readVarBytes();
      return new Uint32Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.FLOAT32_ARRAY: {
      const data = br.readVarBytes();
      return new Float32Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.FLOAT64_ARRAY: {
      const data = br.readVarBytes();
      return new Float64Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.BIG_INT64_ARRAY: {
      const data = br.readVarBytes();
      return new BigInt64Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.BIG_UINT64_ARRAY: {
      const data = br.readVarBytes();
      return new BigUint64Array(data.buffer, data.byteOffset, data.byteLength);
    }
    case types.MESSAGE_PORT: {
      const id = br.readU32();

      if (!parent)
        return undefined;

      return parent._attach(id);
    }
    default: {
      throw cloneError();
    }
  }
}

/*
 * Stringification
 */

function stringify(value) {
  return encode(value).toString('base64');
}

function parse(str, parent) {
  if (typeof str !== 'string')
    throw new TypeError('"str" must be a string.');

  const data = Buffer.from(str, 'base64');

  return decode(data, parent);
}

/*
 * Helpers
 */

function cloneError() {
  const err = new TypeError('Cannot transfer object of unsupported type');

  err.code = 'ERR_CANNOT_TRANSFER_OBJECT';

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, cloneError);

  return err;
}

/*
 * Expose
 */

exports.encode = encode;
exports.getType = getType;
exports.getSize = getSize;
exports.write = write;
exports.decode = decode;
exports.read = read;
exports.stringify = stringify;
exports.parse = parse;
