# bthreads

A [worker_threads] wrapper for node.js. Provides transparent fallback for
pre-v12.0.0 node.js (via `child_process`) as well as browser web workers.
Browserifiable, webpack-able.

## Usage

``` js
const threads = require('bthreads');

if (threads.isMainThread) {
  const worker = new threads.Worker(__filename, {
    workerData: 'foo'
  });

  worker.on('message', console.log);
  worker.on('error', console.error);

  worker.on('exit', (code) => {
    if (code !== 0)
      console.error(`Worker stopped with exit code ${code}.`);
  });
} else {
  threads.parentPort.postMessage(threads.workerData + 'bar');
}
```

Output:

``` bash
$ node --experimental-worker threads.js
foobar
$ node threads.js
foobar
```

## Caveats

Some caveats for the `child_process` backend:

- The transfer list only works for MessagePorts. Array buffers won't _actually_
  be transferred.
- `options.workerData` probably has a limited size depending on platform (the
  maximum size of an environment variable).
- `SharedArrayBuffer` does not work and will throw an error if sent.

Caveats for the browser backend:

- `options.workerData` possibly has a limited size depending on the browser
  (the maximum size of `options.name`).
- `options.eval` will create a data URI and execute a new worker from it. When
  using a bundler, note that the bundler will _not_ be able to compile the
  eval'd code. This means that `require` will have limited usability
  (restricted to only core browserify modules and `bthreads` itself).
- Furthermore, `options.eval` requires that `data:` be set for the [worker-src]
  [Content-Security-Policy]. See [content-security-policy.com] for a guide.

Finally, caveats for the `worker_threads` backend:

- It is remarkably unstable and crashes a lot with assertion failures,
  particularly when there is an uncaught exception or the thread is forcefully
  terminated. Note that `worker_threads` is still experimental in node.js!
- Native modules will be unusable if they are not built as context-aware
  addons.

## Writing code for node and the browser

It's good to be aware of browserify and how it sets `__filename` and
`__dirname`.

For example:

``` js
const worker = new threads.Worker(`${__dirname}/worker.js`);
```

If your code resides in `/root/project/lib/main.js`, the browserify generated
path will ultimately be `/lib/worker.js`. Meaning `/root/project/lib/worker.js`
should exist for node and `http://[host]/lib/worker.js` should exist for the
browser.

The browser backend also exposes a `browser` flag for this situation.

Example:

``` js
const worker = new threads.Worker(threads.browser
                                ? 'http://.../' + path.basename(file)
                                : file);
```

To make self-execution easier, bthreads also exposes a `threads.source`
property which refers to the main module's filename in node.js and the current
script URL in the browser.

## importScripts

In the browser, bthreads exposes a more useful version of `importScripts`.

``` js
const threads = require('bthreads');
const _ = threads.importScripts('https://unpkg.com/underscore/underscore.js');
```

This should work for any bundle exposed as UMD or CommonJS. Note that
`threads.importScripts` behaves more like `require` in that it caches modules
by URL. The cache is accessible through `threads.importScripts.cache`.

## High-level API

The low-level node.js API is not very useful on its own. bthreads optionally
provides an API similar to [bsock].

Example (for brevity, the async wrapper is not included below):

``` js
const threads = require('bthreads');

if (threads.isMainThread) {
  const thread = new threads.Thread(__filename);

  thread.bind('event', (x, y) => {
    console.log(x + y);
  });

  console.log(await thread.call('job', ['hello']));
} else {
  const {parent} = threads;

  parent.hook('job', async (arg) => {
    return arg + ' world';
  });

  parent.fire('event', ['foo', 'bar']);
}
```

Output:

``` js
foobar
hello world
```

### Creating a thread pool

You may find yourself wanting to parallelize the same worker jobs. The
high-level API offers a thread pool object (`threads.Pool`) which will
automatically load balance and scale to the number of CPU cores.

``` js
if (threads.isMainThread) {
  const pool = new threads.Pool(threads.source);

  const results = await Promise.all([
    pool.call('job1'), // Runs on thread 1.
    pool.call('job2'), // Runs on thread 2.
    pool.call('job3')  // Runs on thread 1.
  ]);

  console.log(results);
} else {
  Buffer.poolSize = 1; // Make buffers easily transferrable.

  pool.hook('job1', async () => {
    const buf = Buffer.from('job1 result');
    return [buf, [buf.buffer]]; // Transfer the array buffer.
  });

  pool.hook('job2', async () => {
    return 'job2 result';
  });

  pool.hook('job3', async () => {
    return 'job3 result';
  });
}
```

## More about eval'd browser code

Note that if you are eval'ing some code inside a script you plan to bundle with
browserify or webpack, `require` may get unintentionally transformed or
overridden. This generally happens when you are calling toString on a defined
function.

``` js
const threads = require('bthreads');

function myWorker() {
  const threads = require('bthreads');

  threads.parentPort.postMessage('foo');
}

const code = `(${myWorker})();`;
const worker = new threads.Worker(code, { eval: true });
```

The solution is to access `global.require` instead of `require`.

``` js
const threads = require('bthreads');

function myWorker() {
  const threads = global.require('bthreads');

  threads.parentPort.postMessage('foo');
}

const code = `(${myWorker})();`;
const worker = new threads.Worker(code, { eval: true });
```

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2019, Christopher Jeffrey (MIT License).

See LICENSE for more info.

[worker_threads]: https://nodejs.org/api/worker_threads.html
[worker-src]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/worker-src
[Content-Security-Policy]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
[content-security-policy.com]: https://content-security-policy.com/
[bsock]: https://github.com/bcoin-org/bsock
