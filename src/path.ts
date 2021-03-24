import * as path from 'path';

export { sep, basename, isAbsolute } from 'path';

/**
 * Normalizes a path by using `path.normalize()` internally, and discarding a trailing directory delimiter.
 *
 * Input: /Users/snowtrack/Desktop/../foo/
 * Output: /Users/snowtrack/foo
 *
 * @param p Required. A string. The path you want to normalize.
 * @returns    A String, representing the normalized path
 */
export function normalize(p: string): string {
  p = path.normalize(p);
  if (p.endsWith(path.sep)) {
    p = p.substr(0, p.length - 1);
  }
  return p.replace(/\\/g, '/');
}

export function join(...paths: string[]) {
  return normalize(path.join(...paths));
}

export function dirname(p: string) {
  return normalize(path.dirname(p));
}

export function resolve(...pathSegments: string[]) {
  return normalize(path.resolve(...pathSegments));
}

export function relative(from: string, to: string) {
  return normalize(path.relative(from, to));
}
