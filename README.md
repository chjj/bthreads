# bthreads

`worker_threads` wrapper for node.js. Provides transparent fallback for
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
- SharedArrayBuffer does not work, and will throw an error if sent.

Caveats for the browser backend:

- `options.workerData` possibly has a limited size depending on the browser
  (the maximum size of `options.name`).
- `options.eval` will create an object URL if possible and execute a new worker
  from it. When using a bundler, note that the bundler will _not_ be able to
  compile the eval'd code. This means that `import` and `require` will not be
  available.

Finally, caveats for the `worker_threads` backend.

- It is remarkably unstable and crashes a lot with assertion failures,
  particularly when there is an uncaught exception or the thread is forcefully
  terminated. Note that `worker_threads` is still unstable in node.js!
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

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2019, Christopher Jeffrey (MIT License).

See LICENSE for more info.
