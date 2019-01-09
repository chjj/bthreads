'use strict';

/**
 * Walker
 */

class Walker {
  constructor() {
    this.seen = new Set();
    this.buffers = new Set();
    this.id = 0;
  }

  walk(value) {
    if (value == null || typeof value !== 'object')
      return value;

    if (this.seen.has(value))
      return value;

    if (value instanceof Error)
      return value;

    if (value instanceof Date)
      return value;

    if (value instanceof RegExp)
      return value;

    if (Buffer.isBuffer(value)) {
      this.buffers.add(this.id);
      this.id += 1;
      return value;
    }

    if (value instanceof Uint8Array) {
      this.id += 1;
      return value;
    }

    if (ArrayBuffer.isView(value))
      return value;

    if (Array.isArray(value)) {
      this.seen.add(value);

      for (const val of value)
        this.walk(val);

      this.seen.delete(value);

      return value;
    }

    if (value instanceof Map) {
      this.seen.add(value);

      for (const [key, val] of value) {
        this.walk(key);
        this.walk(val);
      }

      this.seen.delete(value);

      return value;
    }

    if (value instanceof Set) {
      this.seen.add(value);

      for (const key of value)
        this.walk(key);

      this.seen.delete(value);

      return value;
    }

    const keys = Object.keys(value);

    this.seen.add(value);

    for (const key of keys)
      this.walk(value[key]);

    this.seen.delete(value);

    return value;
  }

  morph(value) {
    return [this.walk(value), this.buffers];
  }

  unwalk(value) {
    if (value == null || typeof value !== 'object')
      return value;

    if (this.seen.has(value))
      return value;

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
      if (this.buffers.has(this.id))
        value = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      this.id += 1;
      return value;
    }

    if (ArrayBuffer.isView(value))
      return value;

    if (Array.isArray(value)) {
      this.seen.add(value);

      for (let i = 0; i < value.length; i++)
        value[i] = this.unwalk(value[i]);

      this.seen.delete(value);

      return value;
    }

    if (value instanceof Map) {
      this.seen.add(value);

      const del = [];
      const set = [];

      for (const [key, val] of value) {
        const k = this.unwalk(key);
        const v = this.unwalk(val);

        if (k !== key) {
          del.push(key);
          set.push([k, v]);
        } else if (v !== val) {
          set.push([k, v]);
        }
      }

      for (const key of del)
        value.delete(key);

      for (const [k, v] of set)
        value.set(k, v);

      this.seen.delete(value);

      return value;
    }

    if (value instanceof Set) {
      this.seen.add(value);

      const set = [];

      for (const key of value) {
        const k = this.unwalk(key);

        if (k !== key)
          set.push([key, k]);
      }

      for (const [key, k] of set) {
        value.delete(key);
        value.add(k);
      }

      this.seen.delete(value);

      return value;
    }

    const keys = Object.keys(value);

    this.seen.add(value);

    for (const key of keys) {
      const val = value[key];
      const v = this.unwalk(val);

      if (v !== val)
        value[key] = v;
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

function morph(value) {
  const walker = new Walker();
  return walker.morph(value);
}

function unmorph([value, buffers]) {
  const walker = new Walker();
  walker.buffers = buffers;
  return walker.unmorph(value);
}

/*
 * Expose
 */

exports.morph = morph;
exports.unmorph = unmorph;
