import * as path from 'path';

export {
  sep, basename, isAbsolute,
} from 'path';

/**
 * Normalizes a path by using `path.normalize()` internally, and discarding a trailing directory delimiter.
 * If a path normalizes to the root ('/'), this will be returned
 *
 * Input: '/Users/snowtrack/Desktop/../foo/'
 * Output: '/Users/snowtrack/foo'
 * Input: '/'
 * Output: '/'
 *
 * @param p Required. A string. The path you want to normalize.
 * @returns    A String, representing the normalized path
 */
export function normalize(p: string): string {
  // empty path stays an empty path, otherwise would return '.'
  if (p === '' || p === '.') {
    return '';
  }

  p = path.normalize(p).replace(/\\/g, '/');

  // strip away trailing slashes
  if (p !== '/' && p.endsWith('/')) {
    p = p.substr(0, p.length - 1);
  }
  return p;
}

/**
 * Denormalizes a path. If on Windows, all forward slashes will be converted to backward slashes
 *
 * Input: '/Users/snowtrack/Desktop/../foo/'
 * Output: '\Users\snowtrack\foo'
 * Input: '\'
 * Output: '\'
 *
 * @param p    Required. A string. The path you want to denormalize.
 * @returns    A String, representing the denormalized path
 */
export function denormalize(p: string): string {
  if (process.platform === 'win32') {
    return p.replace(/\//g, '\\');
  }
  return p;
}

export function join(...paths: string[]): string {
  return normalize(path.join(...paths));
}

export function dirname(p: string): string {
  return normalize(path.dirname(p));
}

export function resolve(...pathSegments: string[]): string {
  return normalize(path.resolve(...pathSegments));
}

export function relative(from: string, to: string): string {
  return normalize(path.relative(from, to));
}

export function extname(p: string): string {
  return path.extname(p).toLowerCase();
}

export function parse(p: string): path.ParsedPath {
  return path.parse(p);
}
