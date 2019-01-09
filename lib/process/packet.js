/*!
 * packet.js - worker packets for bthreads
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const bio = require('bufio');
const encoding = require('../internal/encoding');

/**
 * Packet
 */

class Packet extends bio.Struct {
  constructor() {
    super();

    this.port = 0;
    this.value = null;
  }

  getSize() {
    return 8 + encoding.getSize(this.value) + 1;
  }

  write(bw) {
    const size = bw.data.length - 9;

    bw.writeU32(this.port);
    bw.writeU32(size);
    encoding.write(bw, this.value);
    bw.writeU8(0x0a);

    return this;
  }

  read(br) {
    this.port = br.readU32();

    const size = br.readU32();
    const data = br.readBytes(size, true);

    this.value = encoding.decode(data);

    if (br.readU8() !== 0x0a)
      throw new Error('Invalid packet.');

    return this;
  }
}

/*
 * Expose
 */

module.exports = Packet;
