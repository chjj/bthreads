/*!
 * stable.js - worker threads for javascript
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const parts = process.version.split(/[^\d]/);
const version = (0
  + (parts[1] & 0xff) * 0x10000
  + (parts[2] & 0xff) * 0x00100
  + (parts[3] & 0xff) * 0x00001);

// worker_threads was made stable in 12.11.0.
if (version >= 0x0c0b00)
  module.exports = require('./lib/threads');
else
  module.exports = require('./lib/process');
