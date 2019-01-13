'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

console.log(threads.workerData + 'bar');
