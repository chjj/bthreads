/*!
 * string_decoder.js - browser string decoder for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Parts of this software are based on nodejs/string_decoder:
 *   Copyright (c) 2019, Joyent (MIT)
 *   https://github.com/nodejs/string_decoder
 *
 * Copyright Joyent, Inc. and other Node contributors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 * NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

'use strict';

/**
 * StringDecoder
 */

class StringDecoder {
  constructor(encoding) {
    this.encoding = normalizeEncoding(encoding);

    let nb = 0;

    switch (this.encoding) {
      case 'utf16le':
        this.text = utf16Text;
        this.end = utf16End;
        nb = 4;
        break;
      case 'utf8':
        this.fillLast = utf8FillLast;
        nb = 4;
        break;
      case 'base64':
        this.text = base64Text;
        this.end = base64End;
        nb = 3;
        break;
      default:
        this.write = simpleWrite;
        this.end = simpleEnd;
        return;
    }

    this.lastNeed = 0;
    this.lastTotal = 0;
    this.lastChar = Buffer.allocUnsafe(nb);
  }

  write(buf) {
    if (buf.length === 0)
      return '';

    let i = 0;
    let r;

    if (this.lastNeed) {
      r = this.fillLast(buf);

      if (r === undefined)
        return '';

      i = this.lastNeed;

      this.lastNeed = 0;
    }

    if (i < buf.length)
      return r ? r + this.text(buf, i) : this.text(buf, i);

    return r || '';
  }

  end(buf) {
    const r = buf && buf.length ? this.write(buf) : '';

    if (this.lastNeed)
      return r + '\ufffd';

    return r;
  }

  text(buf, i) {
    const total = utf8CheckIncomplete(this, buf, i);

    if (!this.lastNeed)
      return buf.toString('utf8', i);

    this.lastTotal = total;

    const end = buf.length - (total - this.lastNeed);

    buf.copy(this.lastChar, 0, end);

    return buf.toString('utf8', i, end);
  }

  fillLast(buf) {
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }

    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);

    this.lastNeed -= buf.length;

    return undefined;
  }
}

/*
 * Static
 */

StringDecoder.StringDecoder = StringDecoder;

/*
 * Helpers
 */

function normalizeEncoding(enc) {
  if (!enc)
    return 'utf8';

  enc = String(enc).toLowerCase();

  switch (enc) {
    case 'utf8':
    case 'utf-8':
      return 'utf8';
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return 'utf16le';
    case 'latin1':
    case 'binary':
      return 'latin1';
    case 'base64':
    case 'ascii':
    case 'hex':
      return enc;
    default:
      throw new Error('Unknown encoding: ' + enc);
  }
}

function utf8CheckByte(byte) {
  if (byte <= 0x7f)
    return 0;

  if ((byte >> 5) === 0x06)
    return 2;

  if ((byte >> 4) === 0x0e)
    return 3;

  if ((byte >> 3) === 0x1e)
    return 4;

  return (byte >> 6) === 0x02 ? -1 : -2;
}

function utf8CheckIncomplete(self, buf, i) {
  let j = buf.length - 1;

  if (j < i)
    return 0;

  let nb = utf8CheckByte(buf[j]);

  if (nb >= 0) {
    if (nb > 0)
      self.lastNeed = nb - 1;
    return nb;
  }

  if (--j < i || nb === -2)
    return 0;

  nb = utf8CheckByte(buf[j]);

  if (nb >= 0) {
    if (nb > 0)
      self.lastNeed = nb - 2;
    return nb;
  }

  if (--j < i || nb === -2)
    return 0;

  nb = utf8CheckByte(buf[j]);

  if (nb >= 0) {
    if (nb > 0) {
      if (nb === 2)
        nb = 0;
      else
        self.lastNeed = nb - 3;
    }
    return nb;
  }

  return 0;
}

function utf8CheckExtraBytes(self, buf, p) {
  if ((buf[0] & 0xc0) !== 0x80) {
    self.lastNeed = 0;
    return '\ufffd';
  }

  if (self.lastNeed > 1 && buf.length > 1) {
    if ((buf[1] & 0xc0) !== 0x80) {
      self.lastNeed = 1;
      return '\ufffd';
    }

    if (self.lastNeed > 2 && buf.length > 2) {
      if ((buf[2] & 0xc0) !== 0x80) {
        self.lastNeed = 2;
        return '\ufffd';
      }
    }
  }

  return undefined;
}

function utf8FillLast(buf) {
  const p = this.lastTotal - this.lastNeed;
  const r = utf8CheckExtraBytes(this, buf, p);

  if (r !== undefined)
    return r;

  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, p, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }

  buf.copy(this.lastChar, p, 0, buf.length);

  this.lastNeed -= buf.length;

  return undefined;
}

function utf16Text(buf, i) {
  if ((buf.length - i) % 2 === 0) {
    const r = buf.toString('utf16le', i);

    if (r) {
      const c = r.charCodeAt(r.length - 1);

      if (c >= 0xd800 && c <= 0xdbff) {
        this.lastNeed = 2;
        this.lastTotal = 4;
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
        return r.slice(0, -1);
      }
    }

    return r;
  }

  this.lastNeed = 1;
  this.lastTotal = 2;
  this.lastChar[0] = buf[buf.length - 1];

  return buf.toString('utf16le', i, buf.length - 1);
}

function utf16End(buf) {
  const r = buf && buf.length ? this.write(buf) : '';

  if (this.lastNeed) {
    const end = this.lastTotal - this.lastNeed;
    return r + this.lastChar.toString('utf16le', 0, end);
  }

  return r;
}

function base64Text(buf, i) {
  const n = (buf.length - i) % 3;

  if (n === 0)
    return buf.toString('base64', i);

  this.lastNeed = 3 - n;
  this.lastTotal = 3;

  if (n === 1) {
    this.lastChar[0] = buf[buf.length - 1];
  } else {
    this.lastChar[0] = buf[buf.length - 2];
    this.lastChar[1] = buf[buf.length - 1];
  }

  return buf.toString('base64', i, buf.length - n);
}

function base64End(buf) {
  const r = buf && buf.length ? this.write(buf) : '';

  if (this.lastNeed)
    return r + this.lastChar.toString('base64', 0, 3 - this.lastNeed);

  return r;
}

function simpleWrite(buf) {
  return buf.toString(this.encoding);
}

function simpleEnd(buf) {
  return buf && buf.length ? this.write(buf) : '';
}

/*
 * Expose
 */

module.exports = StringDecoder;
