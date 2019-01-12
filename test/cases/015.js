'use strict';

const assert = require('assert');
const threads = require('bthreads');

assert(!threads.isMainThread);

const {parent} = threads;

parent.hook('job', async (arg) => {
  return Buffer.from(arg + ' world');
});

parent.fire('event', ['foo', 'bar']);
