import * as cp from 'child_process';
import * as fse from 'fs-extra';

import { normalize } from './path';

export class DirItem {
  /** Absolute path of dir item */
  path: string;

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
  BROWSE_REPOS = 8
}

/**
 * Helper function to recursively request information of all files or directories of a given directory.
 * @param dirPath       The directory in question.
 * @param request       Specify which elements are of interest.
 * @param dirItemRef    Only for internal use, must be not set when called.
 */
export async function osWalk(dirPath: string, request: OSWALK): Promise<DirItem[]> {
  const returnDirs = request & OSWALK.DIRS;
  const returnFiles = request & OSWALK.FILES;
  const returnHidden = request & OSWALK.HIDDEN;
  const browseRepo = request & OSWALK.BROWSE_REPOS;

  async function internalOsWalk(dirPath: string, request: OSWALK, relPath: string, dirItemRef?: DirItem): Promise<DirItem[]> {
    if (dirPath.endsWith('/')) {
      // if directory ends with a seperator, we cut it off to ensure
      // we don't return a path like /foo/directory//file.jpg
      dirPath = dirPath.substr(0, dirPath.length - 1);
    }

    const dirItems = [];
    return new Promise<string[]>((resolve, reject) => {
      fse.readdir(dirPath, (error, entries: string[]) => {
        if (error) {
          reject(error);
          return;
        }

        // normalize all dir items
        resolve(entries.map(normalize));
      });
    })
      .then((entries: string[]) => {
        const dirItemsTmp: DirItem[] = [];

        for (const entry of entries) {
          if (!browseRepo && (entry === '.snow' || entry.startsWith('.git') || entry.endsWith('.DS_Store'))) {
            continue;
          } else if (!returnHidden && entry.startsWith('.')) {
            continue;
          }

          const absPath = `${dirPath}/${entry}`;
          const isDir: boolean = fse.statSync(absPath).isDirectory();
          dirItemsTmp.push({
            path: absPath, isdir: isDir, isempty: false, relPath: relPath.length === 0 ? entry : `${relPath}/${entry}`,
          });
        }

        if (dirItemRef) {
          dirItemRef.isempty = entries.length === 0;
        }

        const promises = [];
        for (const dirItem of dirItemsTmp) {
          if ((dirItem.isdir && returnDirs) || (!dirItem.isdir && returnFiles)) {
            dirItems.push(dirItem);
          }

          if (dirItem.isdir) {
            promises.push(internalOsWalk(dirItem.path, request, dirItem.relPath, dirItem));
          }
        }

        return Promise.all(promises);
      })
      .then((dirItemResults: DirItem[]) => dirItems.concat(...dirItemResults));
  }

  return internalOsWalk(dirPath, request, '');
}

async function darwinZip(src: string, dst: string): Promise<void> {
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

export async function zipFile(src: string, dst: string, opts: {deleteSrc: boolean}) {
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
