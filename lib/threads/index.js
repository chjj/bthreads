'use strict';

// Make sure we're not loading a third-party module.
if (require.resolve('worker_threads') !== 'worker_threads') {
  const err = new Error('Cannot find module: \'worker_threads\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

const threads = require('worker_threads');

if (!threads.isMainThread)
  module.exports = require('./thread');
else
  module.exports = require('./main');
