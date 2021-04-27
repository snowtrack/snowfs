import * as cp from 'child_process';
import * as fse from 'fs-extra';
import { normalize } from './path';

let winattr;
if (process.platform === 'win32') {
  // eslint-disable-next-line global-require
  winattr = require('winattr');
}

export class DirItem {
  /** Absolute path of dir item */
  absPath: string;

  /** Relative path of dir item */
  relPath: string;

  isdir: boolean;

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
      fse.readdir(dirPath, (error, entries: string[]) => {
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
      .then((entries: string[]) => {
        const dirItemsTmp: DirItem[] = [];

        for (const entry of entries) {
          if (entry === '.DS_Store' || entry === 'thumbs.db') {
            continue;
          } else if (!browseRepo && (entry === '.snow' || entry === '.git')) {
            continue;
          } else if (!returnHidden && entry.startsWith('.')) {
            continue;
          }

          const absPath = `${dirPath}/${entry}`;

          try {
            // While the function browses through a hierarchy,
            // the item might be inaccessible or existant anymore
            const isDir: boolean = fse.statSync(absPath).isDirectory();
            dirItemsTmp.push({
              absPath, isdir: isDir, isempty: false, relPath: relPath.length === 0 ? entry : `${relPath}/${entry}`,
            });
          } catch (_error) {
            // ignore error
          }
        }

        if (dirItemRef) {
          dirItemRef.isempty = entries.length === 0;
        }

        const promises = [];
        for (const dirItem of dirItemsTmp) {
          if ((dirItem.isdir && returnDirs) || (!dirItem.isdir && returnFiles)) {
            dirItems.push(dirItem);
          }

          if (dirItem.isdir && !(request & OSWALK.NO_RECURSIVE)) {
            promises.push(internalOsWalk(dirItem.absPath, request, dirItem.relPath, dirItem));
          }
        }

        return Promise.all(promises);
      })
      .then((dirItemResults: DirItem[]) => dirItems.concat(...dirItemResults));
  }

  return internalOsWalk(dirPath, request, '');
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
      winattr.set(path, { hidden: true }, (error) => {
        console.log(error);
        // not being able to hide the directory shouldn't stop us here
        resolve();
      });
    });
  }
  return Promise.resolve();
}
