'use strict';

import assert from 'assert';
import threads from '../../';

assert(!threads.isMainThread);

threads.parent.send('foobar');
