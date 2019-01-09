'use strict';

/* global ImageBitmap */

/**
 * Walker
 */

class Walker {
  constructor() {
    this.seen = new Map();
    this.ids = new Set();
    this.MessagePort = null;
    this.OriginalMessagePort = null;
    this.id = 0;
  }

  walk(value) {
    if (value == null || typeof value !== 'object')
      return value;

    if (this.seen.has(value))
      return this.seen.get(value);

    if (value instanceof Error) {
      const keys = Object.keys(value);

      if (!keys.includes('name'))
        keys.push('name');

      if (!keys.includes('message'))
        keys.push('message');

      if (!keys.includes('stack'))
        keys.push('stack');

      const out = Object.create(null);

      out._walkError = true;

      this.seen.set(value, out);

      for (const key of keys)
        out[key] = this.walk(value[key]);

      this.seen.delete(value);

      return out;
    }

    if (value instanceof Date)
      return value;

    if (value instanceof RegExp)
      return value;

    if (Buffer.isBuffer(value)) {
      const arr = new Uint8Array(value.buffer,
                                 value.byteOffset,
                                 value.byteLength);
      this.ids.add(this.id);
      this.id += 1;
      return arr;
    }

    if (value instanceof Uint8Array) {
      this.id += 1;
      return value;
    }

    if (ArrayBuffer.isView(value))
      return value;

    if (Array.isArray(value)) {
      const out = [];

      this.seen.set(value, out);

      for (const val of value)
        out.push(this.walk(val));

      this.seen.delete(value);

      return out;
    }

    if (value instanceof Map) {
      const out = new Map();

      this.seen.set(value, out);

      for (const [key, val] of value)
        out.set(this.walk(key), this.walk(val));

      this.seen.delete(value);

      return out;
    }

    if (value instanceof Set) {
      const out = new Set();

      this.seen.set(value, out);

      for (const key of value)
        out.add(this.walk(key));

      this.seen.delete(value);

      return out;
    }

    if (value instanceof this.MessagePort)
      return value._port;

    if (typeof ImageBitmap === 'function') {
      if (value instanceof ImageBitmap)
        return value;
    }

    const out = Object.create(null);

    this.seen.set(value, out);

    for (const key of Object.keys(value))
      out[key] = this.walk(value[key]);

    this.seen.delete(value);

    return out;
  }

  morph(value, transferList) {
    return [
      [this.walk(value), this.ids],
      this.transfer(transferList)
    ];
  }

  transfer(transferList) {
    if (!Array.isArray(transferList))
      return transferList;

    const out = [];

    for (const item of transferList) {
      if (item instanceof this.MessagePort)
        out.push(item._port);
      else
        out.push(item);
    }

    return out;
  }

  unwalk(value) {
    if (value == null || typeof value !== 'object')
      return value;

    if (this.seen.has(value))
      return this.seen.get(value);

    if (value instanceof Error)
      return value;

    if (value instanceof Date)
      return value;

    if (value instanceof RegExp)
      return value;

    if (Buffer.isBuffer(value)) {
      this.id += 1;
      return value;
    }

    if (value instanceof Uint8Array) {
      if (this.ids.has(this.id))
        value = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      this.id += 1;
      return value;
    }

    if (ArrayBuffer.isView(value))
      return value;

    if (Array.isArray(value)) {
      this.seen.set(value, value);

      for (let i = 0; i < value.length; i++)
        value[i] = this.unwalk(value[i]);

      this.seen.delete(value);

      return value;
    }

    if (value instanceof Map) {
      const del = [];
      const set = [];

      this.seen.set(value, value);

      for (const [key, val] of value) {
        const newKey = this.unwalk(key);
        const newVal = this.unwalk(val);

        if (newKey !== key) {
          del.push(key);
          set.push([newKey, newVal]);
        } else if (newVal !== val) {
          set.push([newKey, newVal]);
        }
      }

      for (const oldKey of del)
        value.delete(oldKey);

      for (const [newKey, newVal] of set)
        value.set(newKey, newVal);

      this.seen.delete(value);

      return value;
    }

    if (value instanceof Set) {
      const del = [];
      const add = [];

      this.seen.set(value, value);

      for (const key of value) {
        const newKey = this.unwalk(key);

        if (newKey !== key) {
          del.push(key);
          add.push(newKey);
        }
      }

      for (const oldKey of del)
        value.delete(oldKey);

      for (const newKey of add) {
        value.delete(oldKey);
        value.add(newKey);
      }

      this.seen.delete(value);

      return value;
    }

    if (value instanceof this.OriginalMessagePort)
      return new this.MessagePort(value);

    if (typeof ImageBitmap === 'function') {
      if (value instanceof ImageBitmap)
        return value;
    }

    if (value._walkError) {
      const out = new Error();

      this.seen.set(value, out);

      for (const key of Object.keys(value)) {
        if (key === '_walkError')
          continue;

        out[key] = this.unwalk(value[key]);
      }

      this.seen.delete(value);

      return out;
    }

    this.seen.set(value, value);

    for (const key of Object.keys(value)) {
      const val = value[key];
      const newVal = this.unwalk(val);

      if (newVal !== val)
        value[key] = newVal;
    }

    this.seen.delete(value);

    return value;
  }

  unmorph(value) {
    return this.unwalk(value);
  }
}

/*
 * API
 */

function morph(value, transferList, MessagePort) {
  const walker = new Walker();

  walker.MessagePort = MessagePort;
  walker.OriginalMessagePort = MessagePort.original;

  return walker.morph(value, transferList);
}

function unmorph([value, ids], MessagePort) {
  const walker = new Walker();

  walker.MessagePort = MessagePort;
  walker.OriginalMessagePort = MessagePort.original;
  walker.ids = ids;

  return walker.unmorph(value);
}

/*
 * Expose
 */

exports.morph = morph;
exports.unmorph = unmorph;
