'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

console.error(threads.workerData + 'bar');
