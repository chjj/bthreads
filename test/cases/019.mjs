'use strict';

import assert from 'assert';
import threads from '../../lib/bthreads.js';

assert(!threads.isMainThread);

threads.parent.send('foobar');
