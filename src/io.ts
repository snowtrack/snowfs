import * as cp from 'child_process';
import * as fse from 'fs-extra';
import { PathLike, Stats } from 'fs-extra';
import { join, normalize, parse } from './path';

export { PathLike, Stats } from 'fs-extra';

// Electron ships with its own patched version of the fs-module
// to be able to browse ASAR files. This highly impacts the performance
// of SnowFS inside an Electron app. Electron still has the original
// filesystem onboard called 'original-fs'. For more information see
// https://github.com/Snowtrack/SnowFS/issues/173
let useOriginalFs = false;
let fs;
if (Object.prototype.hasOwnProperty.call(process.versions, 'electron')) {
  // eslint-disable-next-line global-require, import/no-unresolved
  fs = require('original-fs');
  useOriginalFs = true;
} else {
  // eslint-disable-next-line global-require
  fs = require('fs');
}

let winattr;
if (process.platform === 'win32') {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  winattr = require('winattr');
}

/**
 * Return true if 'original-fs' is used as the underlying filesystem module.
 */
export function usesOriginalFs(): boolean {
  return useOriginalFs;
}

export class DirItem {
  /** Absolute path of dir item */
  absPath: string;

  /** Relative path of dir item */
  relPath: string;

  stats: fse.Stats;

  /** If [[DirItem.isdir]] is `true`, this value indicates if the directory is empty or not. */
  isempty: boolean;
}

/** Used in [[osWalk]]. */
export enum OSWALK {
  /** Return all directories. [[DirItem.isdir]] will be `true` */
  DIRS = 1,

  /** Return all files. [[DirItem.isdir]] will be `false` */
  FILES = 2,

  /** Return all hidden items. */
  HIDDEN = 4,

  /** Browse Git and/or SnowFS repositories. */
  BROWSE_REPOS = 8,

  /** Only run over the first level of the directory */
  NO_RECURSIVE = 16
}

function darwinZip(src: string, dst: string): Promise<void> {
  const p0 = cp.spawn('ditto', ['-c', '-k', '--sequesterRsrc', src, dst]);
  return new Promise((resolve, reject) => {
    p0.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(code);
      }
    });
  });
}

export function zipFile(src: string, dst: string, opts: {deleteSrc: boolean}): Promise<void> {
  if (!dst.endsWith('.zip')) {
    throw new Error('destination must be a zip');
  }

  let promise: Promise<void>;
  switch (process.platform) {
    case 'darwin':
      promise = darwinZip(src, dst);
      break;
    case 'win32':
    default:
      throw new Error('zip not yet implemented');
  }

  return promise.then(() => {
    if (opts.deleteSrc) {
      return fse.remove(src);
    }
  });
}

/**
 * Hides a given directory or file. If the function failed to hide the item,
 * the function doesn't throw an exception.
 *
 * @param path      Path to file or dir to hide.
 * @returns
 */
export function hideItem(path: string): Promise<void> {
  if (winattr) {
    return new Promise<void>((resolve) => {
      winattr.set(path, { hidden: true }, () => {
        // not being able to hide the directory shouldn't stop us here
        // so we ignore the error
        resolve();
      });
    });
  }
  return Promise.resolve();
}

function checkPath(pth): void {
  if (process.platform === 'win32') {
    const pathHasInvalidWinCharacters = /[<>:"|?*]/u.test(pth.replace(parse(pth).root, ''));

    if (pathHasInvalidWinCharacters) {
      const error = new Error(`Path contains invalid characters: ${pth}`);
      (error as any).code = 'EINVAL';
      throw error;
    }
  }
}

const getMode = (options) => {
  const defaults = { mode: 0o777 };
  if (typeof options === 'number') return options;
  return ({ ...defaults, ...options }).mode;
};

/**
 * Ensures that the directory exists. If the directory structure does not exist, it is created.
 * Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [pathExists] visit https://nodejs.org/api/fs.html#fs_fs_exists_path_callback
 */
export function ensureDir(dir: string, options?: number | any): Promise<void> {
  checkPath(dir);

  return new Promise<void>((resolve, reject) => {
    fs.mkdir(dir, {
      mode: getMode(options),
      recursive: true,
    }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Tests a user's permissions for the file or directory specified by path.
 * Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [pathExists] visit https://nodejs.org/api/fs.html#fs_fs_exists_path_callback
 */
export function access(path: PathLike, mode: number | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.access(path, mode, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Test whether or not the given path exists by checking with the file system.
 * Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [pathExists] visit https://nodejs.org/api/fs.html#fs_fs_exists_path_callback
 */
export function pathExists(path: PathLike): Promise<boolean> {
  return new Promise((resolve) => {
    fs.exists(path, (exists) => {
      resolve(exists);
    });
  });
}

/**
 * Change the file system timestamps of the object referenced by the <FileHandle> then resolves the promise with no arguments upon success.
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [createReadStream] visit https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
 */
export function utimes(path: PathLike, atime: Date, mtime: Date): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.utimes(path, atime, mtime, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export async function rmdir(dir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fs.readdir(dir, { withFileTypes: true }, async (error, entries) => {
      if (error) {
        reject();
      }

      const results = await Promise.all(entries.map((entry) => {
        const fullPath = join(dir, entry.name);
        const task = entry.isDirectory() ? rmdir(fullPath)
          : new Promise<void>((resolve, reject) => fs.unlink(fullPath, (error) => (error ? reject(error) : resolve())));
        return task.catch((error) => ({ error }));
      }));

      results.forEach((result: Error & { error: { code: string} }) => {
        // Ignore missing files/directories; bail on other errors
        if (result && result.error.code !== 'ENOENT') {
          throw result.error;
        }
      });

      return new Promise<void>((resolve, reject) => {
        fs.rmdir(dir, (error) => (error ? reject(error) : resolve()));
      }).then(() => resolve());
    });
  });
}

/**
 * Retrieve the statistics about a directory item. Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [stat] visit https://nodejs.org/api/fs.html#fs_fs_fstat_fd_options_callback
 */
export function stat(path: PathLike): Promise<Stats> {
  return new Promise((resolve, reject) => {
    fs.stat(path, (error, stats: Stats) => {
      if (error) {
        reject(error);
      } else {
        resolve(stats);
      }
    });
  });
}

/**
 * Asynchronously copies `src` to `dest`. Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [copyFile] visit https://nodejs.org/api/fs.html#fs_fs_copyfilesync_src_dest_mode
 */
export function copyFile(src: PathLike, dest: PathLike, flags: number): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.copyFile(src, dest, flags, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Read the contents of a directory. Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [readdir] visit https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback
 */
export function readdir(path: PathLike, callback: (err: Error | null, files: string[]) => void): void {
  return fs.readdir(path, callback);
}

/**
 * Open a read stream. Preferred usage over 'fs' or 'fs-extra' because it ensures always the
 * fastest filesystem module is used inside Electron or inside node.
 * For more information check the module import ocmments above.
 * For more information about the API of [createReadStream] visit https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
 */
export function createReadStream(path: PathLike, options?: string | {
  flags?: string;
  encoding?: unknown;
  fd?: number;
  mode?: number;
  autoClose?: boolean;
  /**
   * @default false
   */
  emitClose?: boolean;
  start?: number;
  end?: number;
  highWaterMark?: number;
}): fse.ReadStream {
  return fs.createReadStream(path, options);
}

/**
 * Helper function to recursively request information of all files or directories of a given directory.
 * @param dirPath       The directory in question.
 * @param request       Specify which elements are of interest.
 * @param dirItemRef    Only for internal use, must be not set when called.
 */
export function osWalk(dirPath: string, request: OSWALK): Promise<DirItem[]> {
  const returnDirs = request & OSWALK.DIRS;
  const returnFiles = request & OSWALK.FILES;
  const returnHidden = request & OSWALK.HIDDEN;
  const browseRepo = request & OSWALK.BROWSE_REPOS;

  function internalOsWalk(dirPath: string, request: OSWALK, relPath: string, dirItemRef?: DirItem): Promise<DirItem[]> {
    if (dirPath.endsWith('/')) {
      // if directory ends with a seperator, we cut it off to ensure
      // we don't return a path like /foo/directory//file.jpg
      dirPath = dirPath.substr(0, dirPath.length - 1);
    }

    const dirItems = [];
    return new Promise<string[]>((resolve, reject) => {
      readdir(dirPath, (error, entries: string[]) => {
        if (error) {
          // While browsing through a sub-directory, readdir
          // might fail if the directory e.g. gets deleted at the same
          // time. Therefore sub-directories don't throw an error
          if (dirItemRef) {
            resolve([]);
          } else {
            reject(error);
          }
          return;
        }

        // normalize all dir items
        resolve(entries.map(normalize));
      });
    })
      .then((items: string[]) => {
        const promises = [];

        for (const item of items) {
          if (item === '.DS_Store' || item === 'thumbs.db') {
            continue;
          } else if (!browseRepo && (item === '.snow' || item === '.git')) {
            continue;
          } else if (!returnHidden && item.startsWith('.')) {
            continue;
          }

          const absPath = `${dirPath}/${item}`;

          promises.push(stat(absPath)
            .then((stats: Stats) => {
              return {
                absPath,
                isempty: false,
                relPath: relPath.length === 0 ? item : `${relPath}/${item}`,
                stats,
              };
            }).catch(() => null));
        }

        return Promise.all(promises);
      }).then((itemStatArray: DirItem[]) => {
        const promises = [];

        for (const dirItem of itemStatArray.filter((x) => x)) {
          if ((dirItem.stats.isDirectory() && returnDirs) || (!dirItem.stats.isDirectory() && returnFiles)) {
            dirItems.push(dirItem);
          }

          if (dirItem.stats.isDirectory() && !(request & OSWALK.NO_RECURSIVE)) {
            promises.push(internalOsWalk(dirItem.absPath, request, dirItem.relPath, dirItem));
          }
        }

        if (dirItemRef) {
          dirItemRef.isempty = itemStatArray.length === 0;
        }

        return Promise.all(promises);
      })
      .then((dirItemResults: DirItem[]) => dirItems.concat(...dirItemResults));
  }

  return internalOsWalk(dirPath, request, '');
}
