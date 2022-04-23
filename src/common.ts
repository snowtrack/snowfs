import * as hasha from 'hasha';
import * as crypto from 'crypto';
import * as fse from 'fs-extra';
import * as io from './io';

import {
  join, dirname,
} from './path';

import { Repository } from './repository';

export const MB100 = 100000000;
export const MB20 = 20000000;
export const MB10 = 10000000;
export const MB2 = 2000000;
export const MB1 = 1000000;

export class SnowtrackData {
  filetypeName = '';
  isSnowProject = false;
  isGitProject = false;
  
  isPackage = false;
  isInPackage = false;
}

export class StatsSubset {
  size: number;

  ctime: Date;

  mtime: Date;
  
  birthtime: Date;

  static clone(stats: StatsSubset): StatsSubset {
    return {
      size: stats.size,
      ctime: new Date(stats.ctime),
      mtime: new Date(stats.mtime),
      birthtime: new Date(stats.birthtime),
    };
  }
}

export interface RepoDetails {
  state : LOADING_STATE;
  workdir : string | null;
  commondir : string | null;
}

/**
 * A commonly used class which contains a hash and
 * file stats of a given file
 */
export class FileInfo {
  hash: string;

  ext: string; // including '.'

  stat: StatsSubset;
}

/**
 * Indicating the type of a directory.
 */
export enum LOADING_STATE {
  /** The directory is neither a SnowFS repo, nor a Git repo */
  NONE,

  /** The directory is a Git repo. */
  GIT = 2,

  /** The directory is a SnowFS repo. */
  SNOW = 4,
}

export interface HashBlock {
  hash: string;

  start: number;

  end: number;
}

/**
 * Calculate the hash of a chunk of a given file. Used by [[calculateFileHash]] to speedup
 * the hashing operation by asynchronously executing the function on blocks of big files.
 *
 * @param filepath  The file to calculate the hash from.
 * @param options The start, end and highwatermark value (aka the internal read-buffer size).
 */
export function getPartHash(filepath: string, options?: {start?: number; end?: number; highWaterMark?: number;}): Promise<HashBlock> {
  const fh = io.createReadStream(filepath, {
    start: options?.start, end: options?.end, highWaterMark: options?.highWaterMark ?? MB2, autoClose: true,
  });

  return hasha.fromStream(fh, { algorithm: 'sha256' })
    .then((hash: string) => {
      return { hash, start: options?.start ?? -1, end: options?.end ?? -1 };
    });
}

/**
 * Check if the hash of a file matches a given `filehash`.
 *
 * @param filepath      The path of the given file.
 * @param filehash      The hash the file must match with.
 * @param hashBlocks    Array of hashblock hashes if previously calculated.
 */
export function compareFileHash(filepath: string, filehash: string, expectError: boolean, hashBlocks?: string[]): Promise<boolean> {
  return io.stat(filepath).then((stat: fse.Stats) => {
    if (stat.size < MB20) {
      if (hashBlocks) {
        console.warn(`File ${filepath} should have no hash blocks because it's too small`);
      }
      return getPartHash(filepath).then((hashBlock: HashBlock) => hashBlock.hash === filehash);
    }
    if (!hashBlocks) {
      console.warn(`File ${filepath} should have hash blocks because it's too big`);
    }

    const divider = Math.ceil(stat.size / MB100);
    const blocks = new Array<{start : number; end : number}>(divider);

    for (let i = 0; i < divider; ++i) {
      blocks[i] = { start: i * MB100, end: (i + 1) * MB100 - 1 };
    }
    // special case for 'end', in case last block is not as big as the
    // others
    blocks[blocks.length - 1].end = Math.min(MB100 * divider, stat.size) - 1;

    const promiseHash: Promise<HashBlock>[] = [];

    for (let i = 0; i < divider; ++i) {
      promiseHash.push(getPartHash(filepath, {
        start: blocks[i].start,
        end: blocks[i].end,
        highWaterMark: MB2,
      }).then((hashBlock: HashBlock) => {
        if (hashBlocks && hashBlock.hash !== hashBlocks[i]) {
          throw new Error('hashblock different');
        }
        return hashBlock;
      }));
    }

    return Promise.all(promiseHash).then((hashes: HashBlock[]) => {
      const hash = crypto.createHash('sha256');
      for (const h of hashes) {
        hash.update(h.toString());
      }
      return filehash === hash.digest('hex');
    });
  }).catch((error: Error) => {
    // return false because it is an expected error
    if (expectError && error.message === 'hashblock different') { return false; }

    throw error;
  });
}

/**
 * Calculate the hash of a given file. Although the resulting hash is a sha256 hash, it does **not** match
 * the standard sha256 hash due to the way how this function calculates a hash. The given file, depending on
 * its size, is sliced into segments and each segment is hashed asynchronously. That speeds up the hasing
 * for bigger files. Currently the block size is set to 100 MB, but will be adjusted in future versions.
 *
 * @param filepath The path of the file where to calculate the hash from.
 */
export function calculateFileHash(filepath: string): Promise<{filehash : string, hashBlocks?: HashBlock[]}> {
  return io.stat(filepath).then((stat: fse.Stats) => {
    if (stat.size < MB20) {
      return getPartHash(filepath).then((oid: HashBlock) => ({ filehash: oid.hash }));
    }
    const divider = Math.ceil(stat.size / MB100);
    const blocks = new Array<{start : number; end : number}>(divider);

    for (let i = 0; i < divider; ++i) {
      blocks[i] = { start: i * MB100, end: (i + 1) * MB100 - 1 };
    }
    // special case for 'end', in case last block is not as big as the
    // others
    blocks[blocks.length - 1].end = Math.min(MB100 * divider, stat.size) - 1;

    const promiseHash: Promise<HashBlock>[] = [];

    for (let i = 0; i < divider; ++i) {
      promiseHash.push(getPartHash(filepath, {
        start: blocks[i].start,
        end: blocks[i].end,
        highWaterMark: MB2,
      }));
    }

    return Promise.all(promiseHash).then((hashes: HashBlock[]) => {
      const hash = crypto.createHash('sha256');
      for (const h of hashes) {
        hash.update(h.hash);
      }
      return { filehash: hash.digest('hex'), hashBlocks: hashes };
    });
  });
}

/**
 * Return information of a given directory. Used to determine if a directory is a Git or SnowFS repo.
 * @param repoPath      The directory in question
 * @returns             Information about the directory. See [[LOADING_STATE]] for more information
 */
export function getRepoDetails(repoPath: string): Promise<RepoDetails> {
  return io.stat(repoPath)
    .then((stat: fse.Stats) => {
      // if the repo path is a file we treat the directory it is in as the repo path
      if (stat.isFile()) {
        repoPath = dirname(repoPath);
      }
      return io.pathExists(join(repoPath, '.git'));
    })
    .then((exists: boolean) => {
      if (exists) {
        return {
          state: LOADING_STATE.GIT,
          workdir: null,
          commondir: null,
        };
      }
      return io.pathExists(join(repoPath, '.snow')).then((exists: boolean) => {
        if (exists) {
          return Repository.open(repoPath).then((repo: any) => {
            const workdir: string = repo.workdir();
            const commondir: string = repo.commondir();
            if (repo) {
              return {
                state: LOADING_STATE.SNOW,
                workdir,
                commondir,
              };
            }
            return { state: LOADING_STATE.NONE, workdir: null, commondir: null };
          });
        }
        return { state: LOADING_STATE.NONE, workdir: null, commondir: null };
      });
    });
}
/**
 * Escape string from hazardous characters which interfere with json parsing.
 * @param s       The input string to be treated
 * @returns       The string with escaped characters
 */
export function jsonCompliant(s : string) : string {
  return s
    .replace(/\\n/g, '\\n')
    .replace(/\\'/g, "\\'")
    .replace(/\\"/g, '\\"')
    .replace(/\\&/g, '\\&')
    .replace(/\\r/g, '\\r')
    .replace(/\\t/g, '\\t')
    .replace(/\\b/g, '\\b')
    .replace(/\\f/g, '\\f');
}

export function sleep(time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
}