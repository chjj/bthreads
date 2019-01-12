/*!
 * index.js - child_process backend for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

if (process.env.BTHREADS_THREAD_ID)
  module.exports = require('./thread');
else
  module.exports = require('./main');
