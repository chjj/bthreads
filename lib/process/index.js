'use strict';

if (process.env.BTHREADS_THREAD_ID)
  module.exports = require('./thread');
else
  module.exports = require('./main');
