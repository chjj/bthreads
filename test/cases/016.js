'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

threads.parentPort.close();
