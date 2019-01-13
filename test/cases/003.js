'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

process.stdout.write(threads.workerData + 'bar');
