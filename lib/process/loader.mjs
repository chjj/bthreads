import process from 'process';
import {pathToFileURL} from 'url';

const root = process.env.BTHREADS_WORKER_ROOT || process.cwd();
const self = pathToFileURL(process.argv[1]).href;
const base = pathToFileURL(root).href;

export async function resolve(specifier, parent, fallback) {
  if (parent === self)
    parent = base;

  return fallback(specifier, parent, fallback);
}
