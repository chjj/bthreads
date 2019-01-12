/* eslint-env mocha */
/* global register */

'use strict';

Buffer.poolSize = 1;

const assert = require('assert');
const {join} = require('path');
const encoding = require('../lib/internal/encoding');
const threads = require('../');
const location = global.location || {};

const PORT = (location.port >>> 0) || 80;
const URL = `http://localhost:${PORT}/bundle.js`;

const vector = (index) => {
  let n = index.toString(10);

  while (n.length < 3)
    n = '0' + n;

  return join(__dirname, 'cases', `${n}.js`);
};

function onExit(cb, test, expect) {
  if (typeof test === 'number')
    [test, expect] = [expect, test];

  return (code) => {
    if ((code >>> 0) !== (expect >>> 0))
      cb(new Error('Exit code: ' + code));
    else if (test && !test())
      cb(new Error('Condition not met.'));
    else
      cb();
  };
}

function wait(thread, test, expect) {
  return new Promise((resolve, reject) => {
    const cb = (err) => {
      if (err)
        reject(err);
      else
        resolve();
    };

    thread.on('error', reject);
    thread.on('exit', onExit(cb, test, expect));
  });
}

if (process.browser)
  register('/bundle.js', [__dirname, '../lib/browser/bundle.js']);

describe('Threads', (ctx) => {
  ctx.timeout(5000);

  it('should encode and decode', () => {
    const arr = new Float32Array([1, 2]);
    const enc = encoding.encode(arr);
    const dec = encoding.decode(enc);

    assert.deepStrictEqual(arr, dec);
  });

  it('should have correct environment', () => {
    const {execArgv} = process;

    assert(threads.isMainThread);

    if (execArgv && execArgv.includes('--experimental-worker')) {
      assert.strictEqual(threads.backend, 'worker_threads');
    } else if (!process.browser) {
      assert.strictEqual(threads.backend, 'child_process');
    } else {
      assert(threads.backend === 'web_workers'
          || threads.backend === 'polyfill');
    }
  });

  it('should create worker with data', (cb) => {
    const worker = new threads.Worker(vector(1), {
      workerData: 'foo'
    });

    let called = false;

    worker.on('message', (msg) => {
      msg = Buffer.from(msg);
      assert.strictEqual(msg.toString(), 'foobar');
      called = true;
      if (process.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have stdin', (cb) => {
    const worker = new threads.Worker(vector(2), {
      stdin: true
    });

    let called = false;

    worker.on('message', (msg) => {
      assert.strictEqual(msg, 'foobar');
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));

    worker.stdin.write('foo\n');
  });

  it('should not hang if there is no input', (cb) => {
    if (process.browser)
      cb.skip();

    const worker = new threads.Worker(vector(2), {
      stdin: true
    });

    let called = false;

    worker.on('message', (msg) => {
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => !called));
  });

  it('should have stdout', (cb) => {
    const worker = new threads.Worker(vector(3), {
      workerData: 'foo',
      stdout: true
    });

    let called = false;

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar');
      called = true;
      if (process.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have stderr', (cb) => {
    const worker = new threads.Worker(vector(4), {
      workerData: 'foo',
      stderr: true
    });

    let called = false;

    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar');
      called = true;
      if (process.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have console.log', (cb) => {
    const worker = new threads.Worker(vector(5), {
      workerData: 'foo',
      stdout: true
    });

    let called = false;

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar\n');
      called = true;
      if (process.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have console.error', (cb) => {
    const worker = new threads.Worker(vector(6), {
      workerData: 'foo',
      stderr: true
    });

    let called = false;

    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar\n');
      called = true;
      if (process.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should terminate long running thread', (cb) => {
    const worker = new threads.Worker(vector(7));

    let called = false;

    worker.on('message', (msg) => {
      assert.strictEqual(msg, 'kill me');
      called = true;
      worker.terminate();
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called, 1));
  });

  it('should hang on input', (cb) => {
    const worker = new threads.Worker(vector(8), {
      stdin: true
    });

    let called = false;

    worker.on('error', cb);

    worker.on('exit', () => {
      called = true;
    });

    // NOTE: worker_threads hangs even if we're not listening on stdin.
    setTimeout(() => {
      assert(!called);
      worker.terminate();
      cb();
    }, 1000);
  });

  it('should open message port with child', (cb) => {
    const worker = new threads.Worker(vector(9));
    const {port1, port2} = new threads.MessageChannel();

    worker.postMessage(port2, [port2]);

    let called = false;

    port1.on('message', (msg) => {
      assert.strictEqual(msg, 'hello world');
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should open message port with parent', (cb) => {
    const worker = new threads.Worker(vector(10));

    let called = false;

    worker.on('message', (port) => {
      assert(port instanceof threads.MessagePort);
      port.postMessage('hello world');
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should open port between children', (cb) => {
    const worker1 = new threads.Worker(vector(11));
    const worker2 = new threads.Worker(vector(11));
    const {port1, port2} = new threads.MessageChannel();

    worker1.on('error', cb);
    worker2.on('error', cb);

    let i = 2;

    function done(err) {
      if (err)
        cb(err);
      else if (--i === 0)
        cb();
    }

    worker1.on('exit', onExit(done));
    worker2.on('exit', onExit(done));

    worker1.postMessage(port1, [port1]);
    worker2.postMessage(port2, [port2]);
  });

  it('should receive and send port', (cb) => {
    const worker1 = new threads.Worker(vector(10));
    const worker2 = new threads.Worker(vector(9));

    let called = false;

    worker1.on('error', cb);
    worker2.on('error', cb);

    worker1.on('message', (port) => {
      assert(port instanceof threads.MessagePort);
      worker2.postMessage(port, [port]);
      called = true;
    });

    let i = 2;

    function done(err) {
      if (err)
        cb(err);
      else if (--i === 0)
        cb();
    }

    worker1.on('exit', onExit(done, () => called));
    worker2.on('exit', onExit(done, () => called));
  });

  it('should create nested worker to talk to', (cb) => {
    if (process.browser)
      cb.skip();

    const worker = new threads.Worker(vector(12));

    let called = false;

    worker.on('message', (port) => {
      assert(port instanceof threads.MessagePort);
      port.on('message', (msg) => {
        assert.strictEqual(msg, 'hello from below');
        called = true;
      });
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should transfer buffer', (cb) => {
    const worker = new threads.Worker(vector(14));

    let called = false;

    worker.on('error', cb);

    worker.on('message', (msg) => {
      msg = Buffer.from(msg);
      assert.strictEqual(msg.toString(), 'foobar');
      called = true;
    });

    const data = Buffer.from('foobar');

    worker.postMessage(data, [data.buffer]);

    if (threads.backend === 'web_workers'
        || threads.backend === 'worker_threads') {
      assert(data.length === 0);
    }

    worker.on('exit', onExit(cb, () => called));
  });

  it('should eval string', (cb) => {
    function workerThread() {
      const assert = global.require('assert');
      const path = global.require('path');
      const threads = global.require('bthreads');

      assert(threads.parentPort);
      assert(!global.require.main);
      assert.strictEqual(module.id, '[worker eval]');
      assert.strictEqual(path.basename(module.filename), '[worker eval]');
      assert.strictEqual(__dirname, '.');
      assert.strictEqual(__filename, '[worker eval]');
      assert(!threads.source);

      threads.parentPort.postMessage('evaled!');

      setTimeout(() => {
        process.exit(2);
      }, 100);
    }

    const code = `(${workerThread})();`;
    const worker = new threads.Worker(code, {
      header: URL,
      eval: true
    });

    let called = false;

    worker.on('error', cb);

    worker.on('message', (msg) => {
      assert.strictEqual(msg, 'evaled!');
      called = true;
    });

    worker.on('exit', onExit(cb, () => called, 2));
  });

  it('should do basic thread test', async () => {
    const thread = new threads.Thread(vector(15));

    let called = false;

    thread.bind('event', (x, y) => {
      assert.strictEqual(x + y, 'foobar');
      called = true;
    });

    const buf1 = await thread.call('job', ['hello']);
    const buf2 = await thread.call('job', ['goodbye']);

    assert.strictEqual(buf1.toString(), 'hello world');
    assert.strictEqual(buf2.toString(), 'goodbye world');

    setTimeout(() => {
      thread.terminate();
    }, 1000);

    return wait(thread, () => called, 1);
  });

  it('should test pool (serial)', async () => {
    const pool = new threads.Pool(vector(15));

    let called = false;

    pool.bind('event', (x, y) => {
      assert.strictEqual(x + y, 'foobar');
      called = true;
    });

    for (let i = 0; i < 10; i++) {
      const data = await pool.call('job', [i]);
      assert.strictEqual(data.toString(), i + ' world');
    }

    setTimeout(() => {
      pool.terminate();
    }, 1000);

    return wait(pool, () => called, 1);
  });

  it('should test pool (parallel)', async () => {
    const pool = new threads.Pool(vector(15));

    let called = false;

    pool.bind('event', (x, y) => {
      assert.strictEqual(x + y, 'foobar');
      called = true;
    });

    const jobs = [];

    for (let i = 0; i < 10; i++)
      jobs.push(pool.call('job', [i]));

    const results = await Promise.all(jobs);

    for (let i = 0; i < 10; i++)
      assert.strictEqual(results[i].toString(), i + ' world');

    setTimeout(() => {
      pool.terminate();
    }, 1000);

    return wait(pool, () => called, 1);
  });

  it('should transfer buffer to thread', async () => {
    const thread = new threads.Thread(() => {
      const assert = global.require('assert');
      const {parent} = global.require('bthreads');

      parent.hook('job', (data) => {
        assert(Buffer.isBuffer(data));
        setTimeout(() => process.exit(0), 100);
        return [data, [data.buffer]];
      });
    }, { header: URL });

    const data = Buffer.from('foo');
    const result = await thread.call('job', [data], [data.buffer]);

    if (threads.backend === 'web_workers'
        || threads.backend === 'worker_threads') {
      assert(data.length === 0);
    }

    assert(Buffer.isBuffer(result));
    assert(result.length === 3);

    return wait(thread, 0);
  });

  it('should transfer complex data to thread', async () => {
    const thread = new threads.Thread(() => {
      const {parent} = global.require('bthreads');

      parent.hook('job', (data) => {
        setTimeout(() => process.exit(0), 100);
        return data;
      });
    }, { header: URL });

    const date = new Date();
    const data = {
      undefined_: undefined,
      null_: null,
      number: date.getTime(),
      infinity: Infinity,
      nan: NaN,
      string: 'foobar',
      date: date,
      regex: /foobar/,
      array: [1, 2],
      map: new Map([[1, 2]]),
      set: new Set([1, 2]),
      buffer: Buffer.from('foobar'),
      floatArray: new Float32Array([1, 2])
    };

    const result = await thread.call('job', [data]);

    if (process.browser) {
      assert.strictEqual(result.now, data.now);
      assert.strictEqual(result.date.getTime(), date.getTime());
    } else {
      assert.deepStrictEqual(result, data);
    }

    return wait(thread, 0);
  });
});
