# bthreads

A [worker_threads] wrapper for node.js. Provides transparent fallback for
pre-v11.7.0 node.js (via `child_process`) as well as browser web workers.
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

## Backends

bthreads has 4 backends and a few layers of fallback:

- `worker_threads` - Uses the still experimental [worker_threads] module in
  node.js. Currently only usable if `--experimental-worker` is passed on the
  command line.
- `child_process` - Leverages the [child_process] module in node.js to emulate
  worker threads.
- `web_workers` - [Web Workers API][web_workers] (browser only).
- `polyfill` - A [polyfill] for the web workers API.

The current backend is exposed as `threads.backend`. Note that the current
backend can be set with the `BTHREADS_BACKEND` environment variable.

## Caveats

Some caveats for the `child_process` backend:

- The transfer list only works for MessagePorts. Array buffers won't _actually_
  be transferred.
- `options.workerData` probably has a limited size depending on platform (the
  maximum size of an environment variable).
- `SharedArrayBuffer` does not work and will throw an error if sent.
- The object serializer does not yet support circular references. Any circular
  reference will be replaced with `undefined` on the other side.

Caveats for the `web_workers` backend:

- `options.workerData` possibly has a limited size depending on the browser
  (the maximum size of `options.name`).
- `options.eval` will create a data URI and execute a new worker from it. When
  using a bundler, note that the bundler will _not_ be able to compile the
  eval'd code. This means that `require` will have limited usability
  (restricted to only core browserify modules and `bthreads` itself).
- Furthermore, `options.eval` requires that `data:` be set for the [worker-src]
  [Content-Security-Policy]. See [content-security-policy.com] for a guide.
- The `close` event for MessagePorts only has partial support (if a thread
  suddenly terminates, `close` will not be emitted for any remote ports).
  This is because the `close` event is not yet a part of the standard Web
  Worker API. See https://github.com/whatwg/html/issues/1766 for more info.

Caveats for the `polyfill` backend:

- Code will not actually run in a separate context (obviously).
- `importScripts` will perform a synchronous XMLHttpRequest and potentially
  freeze the UI. Additionally, XHR is bound to certain cross-origin rules that
  `importScripts` is not.
- Similarly, worker scripts are also spawned using XHR. The same cross-origin
  limitations apply.
- `Blob`, `File`, `FileList`, and `ImageBitmap` cannot be cloned due to
  limitations of the DOM.

Finally, caveats for the `worker_threads` backend:

- It is somewhat unstable and crashes a lot with assertion failures,
  particularly when there is an uncaught exception or the thread is forcefully
  terminated. Note that `worker_threads` is still experimental in node.js!
- Native modules will be unusable if they are not built as context-aware
  addons.

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
    pool.call('job3')  // Runs on thread 3.
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

## API

- Default API
  - `threads.isMainThread` - See [worker_threads] documentation.
  - `threads.parentPort` - See [worker_threads] documentation (worker only).
  - `threads.threadId` - See [worker_threads] documentation.
  - `threads.workerData` - See [worker_threads] documentation (worker only).
  - `threads.MessagePort` - See [worker_threads] documentation.
  - `threads.MessageChannel` - See [worker_threads] documentation.
  - `threads.Worker` - See [worker_threads] documentation.
- Helpers
  - `threads.backend` - A string indicating the current backend
    (`worker_threads`, `child_process`, `web_workers`, or `polyfill`).
  - `threads.source` - The current main module filename or script URL (`null`
    if in eval'd thread).
  - `threads.browser` - `true` if a browser backend is being used.
  - `threads.process` - Reference to the `child_process` backend. This is
    present to explicitly use the `child_process` backend instead of the
    `worker_threads` backend.
  - `threads.exit(code)` - A reference to `process.exit` (worker only).
  - `threads.stdin` - A reference to `process.stdin` (worker only).
  - `threads.stdout` - A reference to `process.stdout` (worker only).
  - `threads.stderr` - A reference to `process.stderr` (worker only).
  - `threads.console` - A reference to `global.console` (worker only).
  - `threads.importScripts(url)` - `importScripts()` wrapper (browser+worker
    only).
- High-Level API
  - `threads.Thread` - `Thread` Class (see below).
  - `threads.Port` - `Port` Class (see below).
  - `threads.Channel` - `Channel` Class (see below).
  - `threads.Pool` - `Pool` Class (see below).
  - `threads.parent` - A reference to the parent `Port` (worker only, see
    below).

### Socket Class (abstract, extends EventEmitter)

- Constructor
  - `new Socket()` - Not meant to be called directly.
- Properties
  - `Socket#events` (read only) - A reference to the bind `EventEmitter`.
- Methods
  - `Socket#bind(name, handler)` - Bind remote event.
  - `Socket#unbind(name, handler)` - Unbind remote event.
  - `Socket#hook(name, handler)` - Add hook handler.
  - `Socket#unhook(name)` - Remove hook handler.
  - `Socket#send(msg, [transferList])` - Send message, will be emitted as a
    `message` event on the other side.
  - `Socket#fire(name, args, [transferList])` - Fire bind event.
  - `Socket#call(name, args, [transferList], [timeout])` (async) - Call remote
    hook.
  - `Socket#ref()` - Reference socket.
  - `Socket#unref()` - Clear socket reference.
- Events
  - `Socket@message(msg)` - Emitted on message received.
  - `Socket@error(err)` - Emitted on error.
  - `Socket@event(event, args)` - Emitted on bind event.

### Thread Class (extends Socket)

- Constructor
  - `new Thread(filename, [options])` - Instantiate thread with module.
  - `new Thread(code, [options])` - Instantiate thread with code.
  - `new Thread(function, [options])` - Instantiate thread with function.
- Properties
  - `Thread#stdin` (read only) - A writable stream representing stdin (only
    present if `options.stdin` was passed).
  - `Thread#stdout` (read only) - A readable stream representing stdout.
  - `Thread#stderr` (read only) - A readable stream representing stderr.
  - `Thread#threadId` (read only) - An integer representing the thread ID.
- Methods
  - `Thread#terminate([callback])` - Terminate the thread and optionally bind
    to the `exit` event.
  - `Thread#close()` (async) - Terminate the thread and wait for exit but also
    listen for errors and reject the promise if any occur (in other words, a
    better `async` version of `Thread#terminate`).
- Events
  - `Thread@online()` - Emitted once thread is online.
  - `Thread@exit(code)` - Emitted on exit.

### Port Class (extends Socket)

- Constructor
  - `new Port()` - Not meant to be called directly.
- Methods
  - `Port#start()` - Open and bind port (usually automatic).
  - `Port#close()` - Close port.
- Events
  - `Port@close()` - Emitted on port close.

### Channel Class

- Constructor
  - `new Channel()` - Instantiate channel.
- Properties
  - `Channel#port1` (read only) - A `Port` object.
  - `Channel#port2` (read only) - A `Port` object.

### Pool Class

- Constructor
  - `new Pool(filename, [options])` - Instantiate pool with module.
  - `new Pool(code, [options])` - Instantiate pool with code.
  - `new Pool(function, [options])` - Instantiate pool with function.
- Properties
  - `Pool#file` (read only) - A reference to the filename, function, or code
    that was passed in.
  - `Pool#options` (read only) - A reference to the options passed in.
  - `Pool#size` (read only) - Number of threads to spawn.
  - `Pool#events` (read only) - A reference to the bind `EventEmitter`.
  - `Pool#threads` (read only) - A `Set` containing all spawned threads.
- Methods
  - `Pool#open()` - Open and populate the pool with `this.size` threads
    (otherwise threads will be lazily spawned).
  - `Pool#close()` (async) - Close all threads in pool, reject on errors.
  - `Pool#next()` - Return the next thread in queue (this may spawn a new
    thread).
  - `Pool#terminate(callback)` - Terminate all threads in pool, optionally
    execute a callback once `exit` has been emitted for all threads.
  - `Pool#bind(name, handler)` - Bind remote event for all threads.
  - `Pool#unbind(name, handler)` - Unbind remote event for all threads.
  - `Pool#hook(name, handler)` - Add hook handler for all threads.
  - `Pool#unhook(name)` - Remove hook handler for all threads.
  - `Pool#send(msg)` - Send message to all threads, will be emitted as a
    `message` event on the other side (this will populate the pool with threads
    on the first call).
  - `Pool#fire(name, args)` - Fire bind event to all threads (this will
    populate the pool with threads on the first call).
  - `Pool#call(name, args, [transferList], [timeout])` (async) - Call remote
    hook on next thread in queue (this may spawn a new thread).
  - `Pool#ref()` - Reference pool.
  - `Pool#unref()` - Clear pool reference.
- Events
  - `Pool@message(msg, thread)` - Emitted on message received.
  - `Pool@error(err, thread)` - Emitted on error.
  - `Pool@event(event, args, thread)` - Emitted on bind event.
  - `Pool@spawn(thread)` - Emitted immediately after thread is spawned.
  - `Pool@online(thread)` - Emitted once thread is online.
  - `Pool@exit(code, thread)` - Emitted on thread exit.

### Thread, Pool, and Worker Options

The `options` object accepted by the `Thread`, `Pool`, and `Worker` classes
nearly identical to the [worker_threads] worker options with some differences:

- `options.type` and `options.credentials` are valid options when using the
  browser backend (see [web_workers]). Note that `options.type = 'module'` will
  not work with the `polyfill` backend. If a file extension is `.mjs`,
  `options.type` is automatically set to `module` for consistency with node.js.
- The browser backend requires a header or "prelude" file for eval'd code. This
  is essentially a bundle which provides all the necessary browserify modules
  (such that `require('path')` works, for example), as well as bthreads itself.
  When using a browser backend `options.header` is a valid option. It should be
  the URL to a [bundle]. By default, bthreads imports the [bthreads-bundle]
  package from [unpkg.com].
- The `Pool` class accepts `size` option. This allows you to manually set the
  pool size instead of determining it by the number of CPU cores.

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2019, Christopher Jeffrey (MIT License).

See LICENSE for more info.

[worker_threads]: https://nodejs.org/api/worker_threads.html
[child_process]: https://nodejs.org/api/child_process.html
[web_workers]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
[polyfill]: https://github.com/chjj/bthreads/blob/master/lib/browser/polyfill.js
[worker-src]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/worker-src
[Content-Security-Policy]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
[content-security-policy.com]: https://content-security-policy.com/
[bsock]: https://github.com/bcoin-org/bsock
[bundle]: https://github.com/chjj/bthreads/blob/master/lib/browser/bundle.js
[bthreads-bundle]: https://www.npmjs.com/package/bthreads-bundle
[unpkg.com]: https://unpkg.com/
