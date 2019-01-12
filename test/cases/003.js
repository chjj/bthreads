'use strict';

const assert = require('assert');
const {isMainThread, workerData} = require('bthreads');

assert(!isMainThread);

process.stdout.write(workerData + 'bar');
