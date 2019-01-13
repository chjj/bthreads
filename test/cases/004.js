'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

process.stderr.write(threads.workerData + 'bar');
