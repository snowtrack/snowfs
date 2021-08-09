/* eslint import/no-unresolved: [2, { commonjs: true, amd: true }] */

import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import * as io from './io';
import {
  resolve, join, dirname, extname,
} from './path';

import { Log } from './log';
import { Commit } from './commit';
import {
  calculateFileHash, FileInfo, HashBlock, StatsSubset,
} from './common';
import { IgnoreManager } from './ignore';
import { Index } from './index';
import {
  DirItem, hideItem, OSWALK, osWalk,
} from './io';
import { IoContext, TEST_IF } from './io_context';
import { Odb } from './odb';
import { Reference } from './reference';
import {
  constructTree, DETECTIONMODE, TreeDir, TreeEntry, TreeFile,
} from './treedir';

// eslint-disable-next-line import/order
const PromisePool = require('@supercharge/promise-pool');

export enum COMMIT_ORDER {
  UNDEFINED = 1,
  NEWEST_FIRST = 2,
  OLDEST_FIRST = 3
}

/**
 * Reference type, introduced to support TAGS in the future.
 */
export enum REFERENCE_TYPE {
  BRANCH = 0
}

const warningMessage = `Attention: Modifications to the content of this directory without the proper knowledge might result in data loss.

Only proceed if you know exactly what you are doing!`;

/**
 * Initialize a new [[Repository]].
 */
export class RepositoryInitOptions {
  defaultBranchName?: string;

  defaultCommitMessage?: string;

  commondir?: string;

  compress?: boolean;

  additionalConfig?: any;

  /**
   * @param commondir Path outside the repository where the versions are stored
   * @param compress true or false if the repository shall be compressed. Still needs work.
   */
  constructor(commondir?: string, compress?: boolean) {
    this.commondir = commondir;
    this.compress = compress;
  }
  // if commondir is set, the common dir is guaranteed to be outside the project directory
}

/**
 * Used in [[StatusFileOptionsCustom]] to specify the state of a [[StatusEntry]]
 */
export const enum STATUS {
  /** Set if [[FILTER.INCLUDE_UNMODIFIED]] is passed to [[Repository.getStatus]] and item is not modified */
  UNMODIFIED = 0,

  /** Set if [[FILTER.INCLUDE_UNTRACKED]] is passed to [[Repository.getStatus]] and item is new. */
  WT_NEW = 1,

  /** File existed before, and is modified. */
  WT_MODIFIED = 2,

  /** File got deleted */
  WT_DELETED = 4,

  WT_IGNORED = 8,
}

/**
 * Flags passed to [[Repository.restoreVersion]].
 */
export const enum RESET {
  NONE = 0,

  /** Restore modified items. */
  RESTORE_MODIFIED_ITEMS = 1,

  /** Delete items from the worktree, if they are untracked/new. The affected items will be deleted. */
  DELETE_NEW_ITEMS = 2,

  /** Restore deleted items from the worktree, if they were deleted. */
  RESTORE_DELETED_ITEMS = 4,

  /**
   * Restore function will detach HEAD after the commit got restored.
   * This can be helpful if the restore target is a reference, but you
   * need a detached HEAD state nonetheless.
   */
  DETACH = 8,

  /**
   * If a checkout is performed on HEAD to restore the working directory some files might get deleted
   * if they are new or were modified.
   *
   * By using this flag, each items hash will be checked if it exists in the object database.
   * If no match was found the item will be moved to the trash instead. This flag might increase
   * the runtime significantly due to the potential hash calculation.
   */
  MOVE_FILES_TO_TRASH_IF_NEEDED = 16,

  /**
   * Overwrites the default detection mode, which only to trust the mktime (or content if text-files).
   * Please check [[DETECTIONMODE.ONLY_SIZE_AND_MKTIME]] for more information.
   */
  DETECTIONMODE_ONLY_SIZE_AND_MKTIME = 2048,

  /**
   * Overwrites the default detection mode, which only to trust the mktime (or content if text-files).
   * Please check [[DETECTIONMODE.SIZE_AND_HASH_FOR_SMALL_FILES]] for more information.
   */
  DETECTIONMODE_SIZE_AND_HASH_FOR_SMALL_FILES = 4096,

  /**
   * Overwrites the default detection mode, which only to trust the mktime (or content if text-files).
   * Please check [[DETECTIONMODE.SIZE_AND_HASH_FOR_ALL_FILES]] for more information.
   */
  DETECTIONMODE_SIZE_AND_HASH_FOR_ALL_FILES = 8192,

  /** Default flag passed to [[Repository.restoreVersion]] */
  DEFAULT = RESTORE_MODIFIED_ITEMS | DELETE_NEW_ITEMS | RESTORE_DELETED_ITEMS
}

/**
 * Flags passed to [[Repository.getStatus]].
 */
export const enum FILTER {

  /** Return all untracked/new items. */
  INCLUDE_UNTRACKED = 1,

  /** Return all items ignored through [[IgnoreManager]]. */
  INCLUDE_IGNORED = 2,

  /** Return all unmodified items. */
  INCLUDE_UNMODIFIED = 4,

  /** Return all directories - in such case [[StatusEntry.isDirectory]] returns true */
  INCLUDE_DIRECTORIES = 8,

  /** Return all deleted items */
  INCLUDE_DELETED = 16,

  /** Return all modified items */
  INCLUDE_MODIFIED = 32,

  /** Default flag passed to [[Repository.getStatus]] */
  DEFAULT = INCLUDE_UNTRACKED | INCLUDE_MODIFIED | INCLUDE_DELETED | INCLUDE_UNMODIFIED | INCLUDE_DIRECTORIES,

  /** Same as DEFAULT, but includes ignored entries */
  ALL = DEFAULT | INCLUDE_IGNORED,

  /** Sort return value case sensitively. Cannot be mixed with SORT_CASE_INSENSITIVELY. */
  SORT_CASE_SENSITIVELY = 512,

  /** Sort return value case sensitively. Cannot be mixed with SORT_CASE_SENSITIVELY. */
  SORT_CASE_INSENSITIVELY = 1024,

  /**
   * Overwrites the default detection mode, which only to trust the mktime (or content if text-files).
   * Please check [[DETECTIONMODE.ONLY_SIZE_AND_MKTIME]] for more information.
   */
   DETECTIONMODE_ONLY_SIZE_AND_MKTIME = 2048,

  /**
   * Overwrites the default detection mode, which only to trust the mktime (or content if text-files).
   * Please check [[DETECTIONMODE.SIZE_AND_HASH_FOR_SMALL_FILES]] for more information.
   */
   DETECTIONMODE_SIZE_AND_HASH_FOR_SMALL_FILES = 4096,

   /**
    * Overwrites the default detection mode, which only to trust the mktime (or content if text-files).
    * Please check [[DETECTIONMODE.SIZE_AND_HASH_FOR_ALL_FILES]] for more information.
    */
   DETECTIONMODE_SIZE_AND_HASH_FOR_ALL_FILES = 8192,
}

/** Initialize a new [[StatusEntry]] */
export interface StatusItemOptionsCustom {
  /** Relative path of the item to the workdir root. */
  path?: string;

  /** Flags, which define the attributes of the item. */
  status?: STATUS;

  /**
   * Stats that represent the status items file/directory statistics.
   * Null if [[StatusEntry.isDeleted]] is true.
   */
  stats: fse.Stats | null;
}

/**
 * Used toinitialize a new repository.
 */
export class StatusEntry {
  /** Relative path of the item to the workdir root. */
  path?: string;

  /** Flags, which define the attributes of the item. */
  status?: STATUS;

  isdir: boolean;

  stats: StatsSubset | null;

  constructor(data: StatusItemOptionsCustom, isdir: boolean) {
    this.path = data.path;
    this.status = data.status;
    this.isdir = isdir;

    if (data.stats) {
      this.stats = {
        ctime: data.stats.ctime,
        mtime: data.stats.mtime,
        size: data.stats.size,
      };
    }
  }

  /** Return true if the object is new. */
  isNew(): boolean {
    return Boolean(this.status & STATUS.WT_NEW);
  }

  /** Return true if the object is modified. */
  isModified(): boolean {
    return Boolean(this.status & STATUS.WT_MODIFIED);
  }

  /** Return true if the object got deleted. */
  isDeleted(): boolean {
    return Boolean(this.status & STATUS.WT_DELETED);
  }

  /** Return true if the object is ignored by [[IgnoreManager]]. */
  isIgnored(): boolean {
    return Boolean(this.status & STATUS.WT_IGNORED);
  }

  /** Sets the internal status bits of the object. Normally used only inside [[Repository.getStatus]]. */
  setStatusBit(status: STATUS): void {
    this.status = status;
  }

  /** Return all status bits of the object. */
  statusBit(): STATUS {
    return this.status;
  }

  /** Return true if the object represents a directory. */
  isDirectory(): boolean {
    return this.isdir;
  }

  /** Return true if the object represents a file. */
  isFile(): boolean {
    return !this.isdir;
  }

  getItemDesc(): string {
    if (this.isDirectory()) {
      return 'Directory';
    }
    return 'File';
  }
}

export function getSnowFSRepo(dirpath: string): Promise<string | null> {
  const snowInit: string = join(dirpath, '.snow');
  return io.pathExists(snowInit)
    .then((exists: boolean) => {
      if (exists) {
        return dirpath;
      }

      if (dirname(dirpath) === dirpath) { // if arrived at root
        throw new Error('commondir not found');
      }

      return getSnowFSRepo(dirname(dirpath));
    });
}

/**
 * Retrieve the common dir of a workdir path.
 * If the path could not be retrieved the function returns null.
 * @param workdir     The absolute path to the root of the workdir.
 * @returns           The absolute path to the commondir or null.
 */
export function getCommondir(workdir: string): Promise<string | null> {
  const commondir = join(workdir, '.snow');
  return io.stat(commondir)
    .then((stat: fse.Stats) => {
      if (stat.isFile()) {
        return fse.readFile(commondir)
          .then((buf: Buffer) => buf.toString());
      }

      return commondir;
    })
    .catch(() => null);
}

/**
 * Delete an item or move it to the trash/recycle-bin if the file has a shadow copy in the object database.
 */
function deleteOrTrash(repo: Repository, absPath: string, alwaysDelete: boolean, putToTrash: string[]): Promise<void> {
  let isDirectory: boolean;
  return io.stat(absPath)
    .then((stat: fse.Stats) => {
      isDirectory = stat.isDirectory();

      if (alwaysDelete) {
        if (isDirectory) {
          return io.rmdir(absPath);
        }
        return fse.remove(absPath);
      }

      let res: Promise<string[]>;

      const calculateHash: string[] = [];
      if (stat.isDirectory()) {
        res = io.osWalk(absPath, io.OSWALK.FILES)
          .then((items: io.DirItem[]) => {
            for (const item of items) {
              calculateHash.push(item.absPath);
            }
            return Promise.resolve(calculateHash);
          });
      }

      res = Promise.resolve([absPath]);
      return res.then((calculateHashFrom: string[]) => {
        return PromisePool
          .withConcurrency(8)
          .for(calculateHashFrom)
          .handleError((error) => { throw error; }) // Uncaught errors will immediately stop PromisePool
          .process((path: string) => {
            return calculateFileHash(path)
              .then((res: {filehash: string, hashBlocks?: HashBlock[]}) => {
                return { absPath: path, filehash: res.filehash };
              });
          });
      })
        .then((res: {results: {absPath: string, filehash: string}[]}) => {
          const promises = [];
          for (const r of res.results) {
            promises.push(repo.repoOdb.getObjectByHash(r.filehash, extname(r.absPath)));
          }
          return Promise.all(promises);
        })
        .then((stats: (fse.Stats | null)[]) => {
          if (stats.includes(null)) {
            // if there is one null stats object, it means that file isn't stored
            // in the object database, and therefore needs to go to the trash
            putToTrash.push(absPath);
            return Promise.resolve();
          }
          if (isDirectory) {
            return io.rmdir(absPath);
          }
          return fse.remove(absPath);
        });
    });
}

/**
 * A class representing a `SnowFS` repository.
 */
export class Repository {
  /** Object database of the repository */
  repoOdb: Odb;

  /** Repository log helper */
  repoLog: Log;

  /** Repository index of the repository */
  repoIndexes: Index[];

  /** Options object, with which the repository got initialized */
  options: RepositoryInitOptions;

  /** HEAD reference to the currently checked out commit */
  readonly head: Reference = new Reference(REFERENCE_TYPE.BRANCH, 'HEAD', this, { hash: undefined, start: null });

  /** Array of all commits of the repository. The order is undefined. */
  commits: Commit[] = [];

  /** Hash Map of all commits of the repository. The commit hash is the key, and the Commit object is the value. */
  commitMap = new Map<string, Commit>();

  /** Array of all references in the repository. The order is undefined.
   * The array does not contain the HEAD reference
   */
  references: Reference[] = [];

  /** See [[Repository.workdir]] */
  repoWorkDir: string;

  /** See [[Repository.commondir]] */
  repoCommonDir: string;

  /**
   * Path to the repositories commondir, also known as the `.snow` directory.
   * The commondir might be located outside [[Repository.repoWorkDir]].
  */
  commondir(): string {
    return this.repoCommonDir;
  }

  /**
   * Path to the repositories workdir.
   */
  workdir(): string {
    return this.repoWorkDir;
  }

  /**
   * Write a state flag (aka dirty flag) to the common dir. This can be
   * used to check, if the repository got modified.
   * @param res     Argument will be tunneled through and returned by the function.
   * @returns       Value of `res`.
   */
  modified<T>(res?: T): Promise<T> {
    const state = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex');
    return fse.writeFile(join(this.commondir(), 'state'), state)
      .then(() => res)
      .catch(() => res); // ignore any errors since it is not crucial for the repo to run
  }

  /**
   * Ensure the existance of at least 1 repo and return it. If the repo has no
   * index, one will be added. Otherwise the first one is returned.
   * @returns     Return a new or existing index.
   */
  ensureMainIndex(): Index {
    let mainIndex = this.repoIndexes.find((index: Index) => index.id === '');
    if (!mainIndex) {
      mainIndex = new Index(this, this.repoOdb);
      this.repoIndexes.push(mainIndex);
    }
    return mainIndex;
  }

  /**
   * Create a new Index. The index is not saved to disk yet.
   * @returns     The new index.
   */
  createIndex(): Index {
    const indexId = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
    const index = new Index(this, this.repoOdb, indexId);
    this.repoIndexes.push(index);
    return index;
  }

  /**
   * Return the first index of the repository.
   */
  getFirstIndex(): Index | null {
    return this.repoIndexes.length > 0 ? this.repoIndexes[0] : null;
  }

  /**
   * Return the index by id.
   */
  getIndex(id: string): Index | null {
    return this.repoIndexes.find((index: Index) => index.id === id);
  }

  /**
   * Remove a passed index from the internal index array. The index is identifier by its id.
   * @param index       The index to be removed. Must not be invalidated yet, otherwise an error is thrown.
   */
  removeIndex(index: Index): void {
    index.throwIfNotValid();

    const foundIndex = this.repoIndexes.findIndex((i: Index) => i.id === index.id);
    if (foundIndex > -1) {
      this.repoIndexes.splice(foundIndex, 1);
    }
  }

  /**
   * Return all indexes. No copied are returned
   */
  getIndexes(): Index[] {
    return this.repoIndexes;
  }

  /**
   * Return a clone instance of the HEAD ref.
   */
  getHead(): Reference {
    return this.head.clone();
  }

  /**
   * Return the internal object database.
   */
  getOdb(): Odb {
    return this.repoOdb;
  }

  /**
   * Return an array of all commit clones of the repository. The order is undefined.
   */
  getAllCommits(order: COMMIT_ORDER): Commit[] {
    const commits = this.commits.map((c: Commit) => c.clone());
    switch (order) {
      case COMMIT_ORDER.OLDEST_FIRST:
        commits.sort((a: Commit, b: Commit) => {
          const aDate = a.date.getTime();
          const bDate = b.date.getTime();
          if (aDate < bDate) {
            return -1;
          }
          if (aDate > bDate) {
            return 1;
          }
          return 0;
        });
        break;
      case COMMIT_ORDER.NEWEST_FIRST:
        commits.sort((a: Commit, b: Commit) => {
          const aDate = a.date.getTime();
          const bDate = b.date.getTime();
          if (aDate > bDate) {
            return -1;
          }
          if (aDate < bDate) {
            return 1;
          }
          return 0;
        });
        break;
      case COMMIT_ORDER.UNDEFINED:
      default:
        break;
    }
    return commits;
  }

  /**
   * Find and return the commit object by a given reference name.
   * The reference names can be acquired by [[Repository.getAllReferences]].
   * `name` can also be `HEAD`.
   */
  findCommitByReferenceName(type: REFERENCE_TYPE, refName: string): Commit|null {
    let ref: Reference = this.references.find((r: Reference) => r.getName() === refName && r.getType() === type);
    if (!ref) {
      ref = (refName === 'HEAD') ? this.head : null;
    }
    if (!ref) {
      return null;
    }
    return this.commitMap.get(ref.hash.toString());
  }

  /**
   * Find and return the commit object by a given reference.
   * The references can be acquired by [[Repository.getAllReferences]].
   */
  findCommitByReference(ref: Reference): Commit {
    return this.commitMap.get(ref.hash.toString());
  }

  /**
   * Find and return the reference by a given name.
   * The reference names can be acquired by [[Repository.getAllReferences]].
   */
  findReferenceByName(type: REFERENCE_TYPE, refName: string): Reference|null {
    const ref: Reference = this.references.find((r: Reference) => r.getName() === refName && r.getType() === type);
    return ref?.clone();
  }

  /**
   * Walk the commits back in the history by it's parents. Useful to acquire
   * all commits only related to the current branch.
   */
  walkCommit(commit: Commit, cb: (commit: Commit) => void): void {
    if (!commit) {
      throw new Error('commit must be set');
    }

    while (commit.parent) {
      for (const parentHash of commit.parent) {
        this.walkCommit(this.commitMap.get(parentHash.toString()), cb);
      }
    }
  }

  /**
   * Returns all references of the repository. The HEAD reference is not part
   * returned array and must be acquired seperately by [[Repository.getHead]].
   */
  getAllReferences(): Reference[] {
    return Object.assign([], this.references);
  }

  /**
   * Returns all reference names of the repository. The HEAD reference name is not part
   * returned array and must be acquired seperately by [[Repository.getHead]].
   */
  getAllReferenceNames(): string[] {
    return this.references.map((ref: Reference) => ref.getName());
  }

  /**
   * Return the commit the HEAD reference is pointing to.
   */
  getCommitByHead(): Commit {
    return this.commitMap.get(this.head.hash.toString());
  }

  /**
   * Return the commit by a given commit hash.
   * @param hash      Requested hash, or `HEAD~n`.
   * @throws          Throws an exception if 'hash' is of invalid syntax, e.g. HEAD~non-number.
   * @returns         Requested commit, or null if not found.
   */
  findCommitByHash(hash: string): Commit | null {
    let commit: Commit = null;
    const hashSplit = hash.split('~');
    if (hashSplit.length > 1) {
      for (const idx of hash.split('~')) {
        if (idx === 'HEAD') {
          commit = this.commitMap.get(this.getHead().hash);
        } else if (this.references.map((r: Reference) => r.getName()).includes(idx)) {
          const ref = this.references.find((r: Reference) => r.getName() === idx);
          commit = this.commitMap.get(ref.target());
        } else if (commit) {
          const iteration: number = parseInt(idx, 10);
          if (Number.isNaN(iteration)) {
            throw Error(`invalid commit-hash '${hash}'`);
          }
          for (let i = 0; i < iteration; ++i) {
            if (!commit.parent || commit.parent.length === 0) {
              throw new Error(`commit hash '${hash}' out of history`);
            }
            commit = this.commitMap.get(commit.parent[0]);
            if (!commit) {
              throw new Error(`could not find commit with hash '${hash}'`);
            }
          }
        }
      }
    } else {
      commit = this.commitMap.get(hash);
    }
    return (commit === undefined) ? null : commit;
  }

  /**
   * Return all references, which point to a given commit hash. The HEAD reference
   * is not part of the returned array and must be acquired seperately by [[Repository.getHead]].
   */
  filterReferenceByHash(hash: string): Reference[] {
    return this.references.filter((ref: Reference) => ref.hash === hash);
  }

  filterReferencesByHead(): Reference[] {
    return this.references.filter((ref: Reference) => this.head.hash === ref.hash);
  }

  /**
   * Deletes the passed reference. If the passed Reference is the HEAD reference, it is ignored.
   */
  deleteReference(type: REFERENCE_TYPE, branchName: string): Promise<string | null> {
    if (this.getHead().getName() === branchName) {
      throw new Error(`Cannot delete branch '${branchName}' checked out at '${this.workdir()}'`);
    }

    let ref: Reference = null;
    const index = this.references.findIndex((r: Reference) => r.getName() === branchName && r.getType() === type);
    if (index > -1) {
      ref = this.references[index];
      this.references.splice(index, 1);
    }
    return this.repoOdb.deleteReference(ref).then(() =>
      // delete the sha the reference was pointing to
      (ref ? ref.target() : null)).catch(() =>
      // delete the sha the reference was pointing to
      (ref ? ref.target() : null));
  }

  /**
   * Stores the HEAD reference to disk, inside the commondir.
   */
  writeHeadRefToDisk(): Promise<void> {
    return this.repoOdb.writeHeadReference(this.head);
  }

  /**
   * Create a new reference.
   *
   * @param name  Name of the new reference
   * @param startPoint  Commit hash of the new reference, if null HEAD is used.
   */
  createNewReference(type: REFERENCE_TYPE, name: string, startPoint: string, userData?: any): Promise<Reference> {
    const existingRef: Reference = this.references.find((ref: Reference) => ref.getName() === name);
    if (existingRef) {
      if (type === REFERENCE_TYPE.BRANCH) {
        throw new Error(`A branch named '${name}' already exists.`);
      } else {
        throw new Error(`A reference named '${name}' already exists.`);
      }
    }

    // if null HEAD is used
    startPoint = startPoint ?? this.getHead().hash;

    if (!this.commitMap.has(startPoint)) {
      throw new Error(`Not a valid start point: '${startPoint}'`);
    }

    const newRef: Reference = new Reference(type, name, this, { hash: startPoint, start: startPoint, userData });

    this.references.push(newRef);
    return this.repoOdb.writeReference(newRef).then(() => this.repoLog.writeLog(`reference: creating ${name} at ${startPoint}`)).then(() => newRef);
  }

  /**
   * Set the HEAD state to a specific reference. This can be useful right after a
   * commit got checked out and multiple references point to this commit.
   * The reference name must be valid, otherwise an exception is thrown.
   * @param name    Name of the reference.
   */
  setHead(name: string): void {
    if (!this.references.find((v: Reference) => v.getName() === name)) {
      throw new Error(`unknown reference name ${name}`);
    }
    this.head.setName(name);
  }

  /**
   * Set the HEAD state to a specific reference. This can be useful right after a
   * reference got checked out but the HEAD state needs to be detached.
   * The commit hash must be valid, otherwise an exception is thrown.
   * @param hash      Hash of the commit
   */
  setHeadDetached(hash: string): void {
    if (!this.commitMap.get(hash)) {
      throw new Error('unknown commit hash');
    }
    this.head.hash = hash;
    this.head.setName('HEAD');
  }

  async setCommitMessage(commitHash: string, message: string) {
    if (!message) {
      throw new Error('commit message cannot be empty');
    }

    const commit: Commit = this.commitMap.get(commitHash);
    commit.message = message;
    return this.repoOdb.writeCommit(commit).then(() => {
      return this.modified();
    });
  }

  async deleteCommit(commitHash: string) {
    const commitToDelete: Commit = this.findCommitByHash(commitHash);
    if (!commitToDelete) {
      throw new Error('cannot find commit');
    }

    if (!commitToDelete.parent || commitToDelete.parent.length === 0) {
      throw new Error('cannot delete first commit');
    }

    if (this.head.hash === commitHash) {
      throw new Error('cannot delete commit that is checked out');
    }

    const parentsOfCommitReferencedByOtherCommits = new Set<string>();
    const parentsOfDeletedCommit: string[] = commitToDelete.parent;

    let promise: Promise<unknown> = Promise.resolve();

    this.commitMap.forEach((c: Commit) => {
      if (c.hash === commitHash || !c.parent || c.parent.length === 0) {
        return;
      }

      // every commit that is a child commit (direct descendant) of the
      // deleted commit must be updated
      if (c.parent.includes(commitHash)) {
        c.parent = parentsOfDeletedCommit;
        promise = promise.then(() => {
          return this.repoOdb.writeCommit(c);
        });
      }

      // Fill 'parentsOfCommitReferencedByOtherCommits' with all the commits
      // that are referenced indirectly by another commit
      const referencedCommits = c.parent.filter((parentCommit: string) => parentsOfDeletedCommit.includes(parentCommit));
      referencedCommits.forEach((parentHash: string) => {
        parentsOfCommitReferencedByOtherCommits.add(parentHash);
      });
    });

    // We need to update every branch that points to the commit
    const branchesPointingToDeletedCommit = this.filterReferenceByHash(commitHash);
    if (branchesPointingToDeletedCommit.length > 0) {
      // If all parents of the deleted commit are indirectly referenced by other branches and commits,
      // we can safely delete the branch ...
      if (parentsOfDeletedCommit.length === parentsOfCommitReferencedByOtherCommits.size) {
        for (const b of branchesPointingToDeletedCommit) {
          promise = promise.then((): Promise<unknown> => {
            // ensure we dont delete the last reference
            if (this.references.length <= 1) {
              return Promise.resolve();
            }

            return this.deleteReference(REFERENCE_TYPE.BRANCH, b.getName());
          });
        }
      } else { // ... otherwise it means the commit is not an orphan and we need to update all branches that pointed to it
        let headUpdated = false;
        for (const ref of branchesPointingToDeletedCommit) {
          ref.hash = commitToDelete.parent[0];

          // if we are in a detached head, and we update a branch
          // that now points to the 'detached head', we switch from detached head
          // to the branch
          if (this.head.isDetached() && ref.hash === this.getHead().hash && !headUpdated) {
            headUpdated = true; // we only do this with the first branch we encounter
            promise = promise.then(() => {
              this.head.refName = ref.getName();
              return this.repoOdb.writeHeadReference(this.getHead());
            });
          }
          promise = promise.then(() => {
            return this.repoOdb.writeReference(ref);
          });
        }
      }
    }

    // we now delete the commit from the commit map and the commit array
    this.commitMap.delete(commitHash);
    const index = this.commits.findIndex((c) => c.hash === commitHash);
    if (index > -1) {
      this.commits.splice(index, 1);
    }

    return promise
      .then(() => {
        return this.repoOdb.deleteCommit(commitToDelete);
      });
  }

  /**
   * Restore to a commit by a given reference, commit or commit hash.
   *
   * @param target    Reference, commit or commit hash.
   * @param reset     Options for the restore operation.
   */
  checkout(target: string|Reference|Commit, reset: RESET, limitTo?: StatusEntry): Promise<void> {
    let targetRef: Reference = null;
    let targetCommit: Commit = null;
    if (typeof target === 'string') {
      // check first if target is a reference name...
      const ref: Reference = this.findReferenceByName(REFERENCE_TYPE.BRANCH, target);
      if (ref) {
        targetRef = ref;
        targetCommit = this.findCommitByHash(ref.target());
      } else {
        // ... otherwise check if its a hash
        const refs: Reference[] = this.filterReferenceByHash(target);
        // 1) If more than one ref is available we are in a detached HEAD
        // 2) If there is no ref available, we are in a detached HEAD
        if (refs.length === 0) {
          // if no reference was found by name, nor a reference that points
          // to the commit hash, try if the target is a commit hash
          targetCommit = this.findCommitByHash(target);
        } else if (refs.length > 1) {
          throw new Error(`more than one ref found for ${target}`);
        } else {
          targetRef = refs[0];
          targetCommit = this.findCommitByHash(refs[0].target());
        }
      }
    } else if (target instanceof Reference) {
      targetRef = target;
      targetCommit = this.findCommitByHash(target.hash);
    } else if (target instanceof Commit) {
      const refs: Reference[] = this.filterReferenceByHash(target.hash);
      // if more than one ref is available we end up in a detached HEAD
      if (refs.length === 1) {
        targetRef = refs[0];
      }
      targetCommit = target;
    }
    if (!targetCommit) {
      throw new Error('unknown target version');
    }

    let detectionMode = DETECTIONMODE.DEFAULT; // default
    if (reset & RESET.DETECTIONMODE_ONLY_SIZE_AND_MKTIME) {
      detectionMode = DETECTIONMODE.ONLY_SIZE_AND_MKTIME;
    } else if (reset & RESET.DETECTIONMODE_SIZE_AND_HASH_FOR_ALL_FILES) {
      detectionMode = DETECTIONMODE.SIZE_AND_HASH_FOR_ALL_FILES;
    } else if (reset & RESET.DETECTIONMODE_SIZE_AND_HASH_FOR_SMALL_FILES) {
      detectionMode = DETECTIONMODE.SIZE_AND_HASH_FOR_SMALL_FILES;
    }

    const oldFilesMap: Map<string, TreeEntry> = targetCommit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

    let statuses: StatusEntry[] = [];

    // During the execution of this checkout function, it can happen that directories that will be deleted,
    // shouldn't be due to the evaluation of e.g. the ignore patterns
    const deleteDirCandidates = new Map<string, StatusEntry>();
    const deleteRevokeDirs = new Set<string>();

    // IoTask is a callback helper, used by the promise pool to ensure that no more async operations
    // of this type are executed than set/limited by PromisePool.withConcurrency(..)
    type IoTask = () => Promise<unknown>;

    // Array of async functions that are executed by the promise pool
    const tasks: IoTask[] = [];

    // Array of relative paths to files that will undergo the write access check
    const performAccessCheck: string[] = [];

    const putToTrash: string[] = [];

    const oldHeadHash = this.head.hash;

    // checkout(..) can either be used to switch between different commits, or to
    // stay on the current commit to discard the currently changed items.
    const commitChange: boolean = targetCommit.hash !== this.head.hash;

    // If we switch to another commit or RESET.MOVE_FILES_TO_TRASH_IF_NEEDED is unset
    // we can safely delete all affected items
    const alwaysDelete = commitChange || !(reset & RESET.MOVE_FILES_TO_TRASH_IF_NEEDED);

    const ioContext = new IoContext();
    return ioContext.init()
      .then(() => this.getStatus(FILTER.INCLUDE_UNTRACKED
                                 | FILTER.INCLUDE_MODIFIED
                                 | FILTER.INCLUDE_DELETED
                                 | FILTER.INCLUDE_DIRECTORIES
                                 | FILTER.INCLUDE_IGNORED
                                 | FILTER.SORT_CASE_SENSITIVELY, targetCommit))
      .then((statusResult: StatusEntry[]) => {
        // head hash is null before first commit is made
        if (!this.head.hash) {
          return [] as any; // as any otherwise TS doesn't like it
        }

        if (limitTo) {
          statusResult = statusResult.filter((status: StatusEntry) => {
            if (limitTo.isDirectory()) {
              return status.path.startsWith(`${limitTo.path}/`) || status.path === limitTo.path;
            }
            return status.path === limitTo.path;
          });
        }

        statuses = statusResult;
        // Items which existed before but don't anymore
        statuses.forEach((status: StatusEntry) => {
          if (reset & RESET.RESTORE_DELETED_ITEMS && status.isDeleted()) {
            const dst: string = join(this.repoWorkDir, status.path);

            if (status.isFile()) {
              const tfile: TreeEntry = oldFilesMap.get(status.path);
              if (tfile) {
                tasks.push(() => this.repoOdb.readObject(<TreeFile>tfile, dst, ioContext));
              } else {
                throw new Error("item was detected as deleted but couldn't be found in reference commit");
              }

              // The file above didn't exist and is about to be restored.
              // That means we have to ensure the parent directories are not deleted
              let parent = status.path;
              while (parent.length > 0) {
                if (deleteRevokeDirs.has(parent)) {
                  // if the parent got added, the other parents got added already as well
                  break;
                } else {
                  deleteRevokeDirs.add(parent);
                }
                parent = dirname(parent);
              }
            } else {
              tasks.push(() => io.ensureDir(dst));
            }
          } else if (reset & RESET.DELETE_NEW_ITEMS && status.isNew()) {
            deleteDirCandidates.set(status.path, status);
          } else if (reset & RESET.RESTORE_MODIFIED_ITEMS && status.isModified()) {
            const tfile = oldFilesMap.get(status.path);
            if (tfile) {
              if (tfile instanceof TreeFile) {
                performAccessCheck.push(tfile.path);

                const dst: string = join(this.repoWorkDir, tfile.path);

                // We first use deleteOrTrash to delete/trash the item because it checks if the item is backed up
                // in the version database and rather sends it to trash than destroying the data
                const putToTrashImmediately = [];
                tasks.push(() => deleteOrTrash(this, dst, alwaysDelete, putToTrashImmediately)
                  .then(() => {
                    // Since we replace the object, we can delete the object immediately and we don't
                    // need to treat it as a delete candidate
                    if (putToTrashImmediately.length > 0) {
                      return IoContext.putToTrash(putToTrashImmediately);
                    }
                  }).then(() => {
                    return this.repoOdb.readObject(tfile, dst, ioContext);
                  }));
              }
            } else {
              throw new Error(`File '${tfile.path}' not found during last-modified-check`);
            }
          } else if (status.isIgnored()) {
            // If a file is being ignored by snowignore, the parent directories
            // must not be deleted under any circumstances
            let parent = dirname(status.path);
            while (parent.length > 0) {
              if (deleteRevokeDirs.has(parent)) {
                // if the parent got added, the other parents got added already as well
                break;
              } else {
                deleteRevokeDirs.add(parent);
              }
              parent = dirname(parent);
            }
          }
        });

        deleteDirCandidates.forEach((candidate: StatusEntry, relPath: string) => {
          // Check if the delete operation got revoked for the directory
          if (candidate.isDirectory()) {
            if (!deleteRevokeDirs.has(relPath)) {
              // If we delete a directory, we can remove all its subdirectories and files from the candidate list
              // as they will already be deleted by... (see next comment)
              deleteDirCandidates.forEach((_c: StatusEntry, relPath2: string) => {
                if (relPath2.startsWith(`${relPath}/`)) {
                  deleteDirCandidates.delete(relPath2);
                }
              });
              /// ... the delete operation below.
              tasks.push(() => deleteOrTrash(this, join(this.workdir(), candidate.path), alwaysDelete, putToTrash));
            }
          } else {
            performAccessCheck.push(candidate.path);
            tasks.push(() => deleteOrTrash(this, join(this.workdir(), candidate.path), alwaysDelete, putToTrash));
          }
        });

        return ioContext.performFileAccessCheck(this.workdir(), performAccessCheck, TEST_IF.FILE_CAN_BE_WRITTEN_TO);
      })
      .then(() => {
        // After we received the target commit, we update the commit and reference
        // because any following error needs to be resolved by a user operation
        this.head.hash = targetCommit.hash;
        if (!targetRef || reset & RESET.DETACH) {
          this.head.setName('HEAD');
        } else {
          this.head.setName(targetRef.getName());
        }
        return this.writeHeadRefToDisk();
      })
      .then(() => {
        return PromisePool
          .withConcurrency(32)
          .for(tasks)
          .handleError((error) => { throw error; }) // Uncaught errors will immediately stop PromisePool
          .process((task: IoTask) => task());
      })
      .then(() => {
        if (putToTrash.length > 0) {
          return IoContext.putToTrash(putToTrash);
        }
      })
      .then(() => {
        let moveTo = '';
        if (target instanceof Reference) {
          moveTo = target.getName();
        } else if (target instanceof Commit) {
          moveTo = target.hash;
        } else {
          moveTo = target;
        }
        return this.repoLog.writeLog(`checkout: move from '${oldHeadHash}' to ${targetCommit.hash} with ${reset}`);
      });
  }

  /**
   * Get the status of files in the current worktree. The returned entries can be
   * controlled by the passed filter.
   * @param filter  Defines which entries the function returns
   */
  getStatus(filter?: FILTER, commit?: Commit): Promise<StatusEntry[]> {
    const statusResult = new Map<string, StatusEntry>();
    const currentDirs = new Map<string, StatusEntry>();
    const ignore = new IgnoreManager();

    let detectionMode = DETECTIONMODE.DEFAULT; // default
    if (filter & FILTER.DETECTIONMODE_ONLY_SIZE_AND_MKTIME) {
      detectionMode = DETECTIONMODE.ONLY_SIZE_AND_MKTIME;
    } else if (filter & FILTER.DETECTIONMODE_SIZE_AND_HASH_FOR_ALL_FILES) {
      detectionMode = DETECTIONMODE.SIZE_AND_HASH_FOR_ALL_FILES;
    } else if (filter & FILTER.DETECTIONMODE_SIZE_AND_HASH_FOR_SMALL_FILES) {
      detectionMode = DETECTIONMODE.SIZE_AND_HASH_FOR_SMALL_FILES;
    }

    // For each deleted status item, we flag its parent directory as modified.
    function markParentsAsModified(itemPath: string) {
      // Create the parent strings from the status path and call flagDirAsModified
      // E.g. for hello/foo/bar/texture.psd we flag hello, hello/foo/ hello/foo/bar
      const parents = [];
      dirname(itemPath).split('/').reduce((a, b) => {
        const constructedPath = a ? `${a}/${b}` : b;
        parents.push(constructedPath);
        return constructedPath;
      }, null);

      for (const parent of parents) {
        const dirItem = currentDirs.get(parent);
        dirItem?.setStatusBit(STATUS.WT_MODIFIED);
      }
    }

    // First iterate over all files and get their file stats
    const snowtrackIgnoreDefault: string = join(this.repoWorkDir, '.snowignore');
    return io.pathExists(snowtrackIgnoreDefault)
      .then((exists: boolean) => {
        if (exists) {
          return ignore.loadFile(snowtrackIgnoreDefault);
        }
      })
      .then(() => {
        let walk: OSWALK = OSWALK.FILES;
        walk |= filter & FILTER.INCLUDE_DIRECTORIES ? OSWALK.DIRS : 0;
        return osWalk(this.repoWorkDir, walk);
      })
      .then((currentItemsInProj: DirItem[]) => {
        const targetCommit: Commit = commit ?? this.getCommitByHead();
        const promises = [];

        // head is null before first commit is made, so add check to be safe than sorry
        if (!this.head.hash || !targetCommit) {
          return [] as any;
        }

        // Get all tree entries from HEAD
        const oldItemsMap: Map<string, TreeEntry> = targetCommit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
        const curItemsMap: Map<string, DirItem> = new Map(currentItemsInProj.map((x: DirItem) => [x.relPath, x]));

        const oldItems: TreeEntry[] = Array.from(oldItemsMap.values());

        if (filter & FILTER.INCLUDE_IGNORED) {
          const areIgnored: Set<string> = ignore.ignoredList(currentItemsInProj.map((item) => item.relPath));

          const ignored: DirItem[] = currentItemsInProj.filter((item) => areIgnored.has(item.relPath));
          for (const entry of ignored) {
            if (!entry.stats.isDirectory() || filter & FILTER.INCLUDE_DIRECTORIES) {
              statusResult.set(entry.relPath, new StatusEntry({
                path: entry.relPath,
                status: STATUS.WT_IGNORED,
                stats: entry.stats,
              },
              entry.stats.isDirectory()));
            }
          }
        }

        if (filter & FILTER.INCLUDE_DIRECTORIES) {
          // check which items are a directory
          const itemsStep1: DirItem[] = currentItemsInProj.filter((item) => item.stats.isDirectory() && !statusResult.has(item.relPath));

          /// check which items of the directories are ignored
          const areIgnored: Set<string> = ignore.ignoredList(itemsStep1.map((item) => item.relPath));

          // get the list of directories which are not ignored
          const itemsStep2: DirItem[] = itemsStep1.filter((item) => !areIgnored.has(item.relPath));

          for (const item of itemsStep2) {
            const dir = new StatusEntry({
              path: item.relPath,
              status: 0,
              stats: item.stats,
            }, true);
            // the status of this directory will later be overwritten in case
            // the directory contains a file that is modified. See 'markParentsAsModified'.
            statusResult.set(item.relPath, dir);

            // We want to achieve the following use cases (e.g:  foo/bar/bas/texture.psd)
            // 1) If the texture + hierarchy is completely new, all directories shall be marked as 'new'.
            // 1) If a hierarchy is NOT new, but the file is deleted/modified all directories shall be marked as 'modified'.
            // That's why statusResult is not used here, because 'currentDirs' is used to mark all dirs as 'modified',
            // but if the directory is new, it will be replaced in 'statusResult' below by FILTER.INCLUDE_UNTRACKED
            // with WT_NEW, which will end up in the returned array
            currentDirs.set(item.relPath, dir);
          }
        }

        // Items which didn't exist before, but do now
        if (filter & FILTER.INCLUDE_UNTRACKED) {
          // check which items are new and didn't exist in the old commit
          const itemsStep1: DirItem[] = currentItemsInProj.filter((item) => !oldItemsMap.has(item.relPath));

          /// check which items of the new items are ignored
          const areIgnored: Set<string> = ignore.ignoredList(itemsStep1.map((item) => item.relPath));

          // get the list of new items which are not ignored
          const itemsStep2: DirItem[] = itemsStep1.filter((item) => !areIgnored.has(item.relPath));

          for (const entry of itemsStep2) {
            if (!entry.stats.isDirectory()
            || (filter & FILTER.INCLUDE_DIRECTORIES && !entry.isempty) // we don't include empty directories
            ) {
              statusResult.set(entry.relPath, new StatusEntry({
                path: entry.relPath,
                status: STATUS.WT_NEW,
                stats: entry.stats,
              }, entry.stats.isDirectory()));
              markParentsAsModified(entry.relPath);
            }
          }
        }

        // Items which existed before but don't anymore
        if (filter & FILTER.INCLUDE_DELETED) {
          // check which items are deleted now
          const itemsStep1: TreeEntry[] = oldItems.filter((item) => !curItemsMap.has(item.path));

          /// check which items of the deleted items are ignored
          const areIgnored: Set<string> = ignore.ignoredList(itemsStep1.map((item) => item.path));

          // get the list of deleted items which are not ignored
          const itemsStep2: TreeEntry[] = itemsStep1.filter((item) => !areIgnored.has(item.path));

          for (const entry of itemsStep2) {
            if (!entry.isDirectory() || filter & FILTER.INCLUDE_DIRECTORIES) {
              statusResult.set(entry.path, new StatusEntry({ path: entry.path, status: STATUS.WT_DELETED, stats: null }, entry.isDirectory()));

              markParentsAsModified(entry.path);
            }
          }
        }

        // Check which items were modified
        if (filter & FILTER.INCLUDE_MODIFIED) {
          // check which items did exist before and now
          const itemsStep1: TreeEntry[] = oldItems.filter((item) => curItemsMap.has(item.path));

          /// check which items of the still existing items are ignored
          const areIgnored: Set<string> = ignore.ignoredList(itemsStep1.map((item) => item.path));

          // get the list of items which are not ignored
          const itemsStep2: TreeEntry[] = itemsStep1.filter((item) => !areIgnored.has(item.path));

          for (const existingItem of itemsStep2) {
            if (existingItem instanceof TreeFile) {
              promises.push(existingItem.isFileModified(this, detectionMode));
            }
          }
        }
        return Promise.all(promises);
      })
      .then((existingItems: {file: TreeFile; modified : boolean, newStats: fse.Stats}[]) => {
        for (const existingItem of existingItems) {
          if (existingItem.modified) {
            statusResult.set(existingItem.file.path,
              new StatusEntry({
                path: existingItem.file.path,
                status: STATUS.WT_MODIFIED,
                stats: existingItem.newStats,
              }, false));

            markParentsAsModified(existingItem.file.path);
          } else if (filter & FILTER.INCLUDE_UNMODIFIED) {
            statusResult.set(existingItem.file.path,
              new StatusEntry({
                path: existingItem.file.path,
                status: STATUS.UNMODIFIED,
                stats: existingItem.newStats,
              }, false));
          }
        }

        const result = Array.from(statusResult.values());

        // The following sorting also ensures that a directory is listed before its sub-items.
        // E.g: ['foo.pxd', 'foo.pxd/Info.plist', 'foo2.pxd', 'foo2.pxd/Info.plist']
        if (filter & FILTER.SORT_CASE_INSENSITIVELY) {
          result.sort((a: StatusEntry, b: StatusEntry) => {
            if (a.isDirectory() !== b.isDirectory()) {
              return a.isDirectory() ? -1 : 1;
            }
            return a.path.toLocaleLowerCase().localeCompare(b.path.toLocaleLowerCase());
          });
        } else if (filter & FILTER.SORT_CASE_SENSITIVELY) {
          result.sort((a: StatusEntry, b: StatusEntry) => {
            if (a.isDirectory() !== b.isDirectory()) {
              return a.isDirectory() ? -1 : 1;
            }
            return a.path.localeCompare(b.path);
          });
        }
        return result;
      });
  }

  /**
   * Create a new commit, by the given index. The index must have been written onto disk by calling [[Index.writeFiles]].
   * @param index    Passed index of files that will be added to the commit object. Can be null if opts.allowEmpty is true.
   * @param message  A human readable message string, that describes the changes.
   * @param userData Custom data that is attached to the commit data. The data must be JSON.stringifyable.
   * @returns        New commit object.
   */
  async createCommit(index: Index, message: string, opts?: {allowEmpty?: boolean}, tags?: string[], userData?: {}): Promise<Commit> {
    let tree: TreeDir = null;
    let commit: Commit = null;
    if (opts?.allowEmpty) {
      if (!index) {
        index = new Index(this, this.repoOdb); // dummy index if no index got passed
        await index.writeFiles();
      }
    } else if (index.addRelPaths.size === 0 && index.deleteRelPaths.size === 0) {
      // did you forget to call index.writeFiles(..)?
      throw new Error('nothing to commit (create/copy files and use "snow add" to track)');
    }

    let promise = Promise.resolve(TreeDir.createRootTree());

    if (this.head?.hash) {
      promise = constructTree(this.repoWorkDir)
        .then((workdirTree: TreeDir) => {
          const headCommit = this.getCommitByHead();

          /* 1) We first generate a full tree of the working directory. Result:

                  root-dir
                      |
                     /\
                    /  \
           subdir-a ▼   ▼ subdir-b
                   /    |
          file.bas(A)   /\
                       /  \
                      ▼   ▼
              file.foo    file.bar (A)
          */

          // 2) For each item we marked as "added/modified" in the index,
          // we add them and their parent directories to an "added" set.
          const added = new Set<string>();
          for (const relPath of Array.from(index.addRelPaths.keys())) {
            // Skip every item that hasn't been processed yet
            if (!index.processedAdded.has(relPath)) {
              continue;
            }

            let dname = relPath;
            do {
              added.add(dname);
              dname = dirname(dname);
            } while (dname !== '');
          }

          /* 3) Now we remove every item from the worktree that didn't get "added". Result:
                  root-dir
                      |
                      /\
                     /  \
            subdir-a ▼   ▼ subdir-b
                    /    |
           file.bas(A)  /\
                          \
                           ▼
                            file.bar (A)
          */
          TreeDir.remove(workdirTree, (entry: TreeEntry): boolean => {
            const removeItem = !added.has(entry.path);
            if (removeItem) {
              return true;
            }

            const finfo: FileInfo = index.processedAdded.get(entry.path);
            if (finfo) {
              // while we are at it, we update the file infos
              entry.hash = finfo.hash;
              entry.stats = finfo.stat;
            }
            return false;
          });

          // 3) Now we take the tree from the latest-commit and remove every item
          //    that got deleted. No directories are touched here, as the tree will
          //    be sanitized later.
          const commitTree = headCommit.root.clone();
          TreeDir.remove(commitTree, (entry: TreeEntry): boolean => {
            return index.deleteRelPaths.has(entry.path);
          });

          // 4) Merge the tree with the added/modified items and the old commit tree.
          //    If there are any node conflicts in the tree, the items of the working tree
          //    have a higher precedence. This is done by the behaviour of TreeDir.merge(lowerPrec, higherPrec).
          const newTree = TreeDir.merge(commitTree, workdirTree);

          // 5) Remove any empty directory from the new
          TreeDir.remove(newTree, (entry: TreeEntry): boolean => {
            return entry instanceof TreeDir && entry.children.length === 0;
          });

          // TODO: (Seb) Move this to the index creation
          return newTree;
        });
    }

    return promise.then((treeResult: TreeDir) => {
      tree = treeResult;

      // Check hash and size for validty
      TreeDir.walk(treeResult, (item: TreeEntry) => {
        if (!Number.isInteger(item.stats.size)) {
          throw new Error(`Item '${item.path}' has no valid size: ${item.stats.size}`);
        }

        if (!(item.stats.ctime instanceof Date)) {
          throw new Error(`Item '${item.path}' has no valid ctime: ${item.stats.ctime}`);
        }

        if (!(item.stats.mtime instanceof Date)) {
          throw new Error(`Item '${item.path}' has no valid mtime: ${item.stats.mtime}`);
        }

        if (!item.hash.match(/[0-9a-f]{64}/i)) {
          throw new Error(`Item '${item.path}' has no valid hash: ${item.hash}`);
        }
      });

      return index.invalidate();
    }).then(() => {
      commit = new Commit(this, message, new Date(), tree, this.head?.hash ? [this.head.hash] : null);

      if (tags && tags.length > 0) {
        tags.forEach((tag: string) => {
          commit.addTag(tag);
        });
      }

      if (userData) {
        for (const [key, value] of Object.entries(userData)) {
          commit.addData(key, value);
        }
      }

      this.commits.push(commit);
      this.commitMap.set(commit.hash.toString(), commit);

      if (this.head.hash) {
        this.head.hash = commit.hash;
        // update the hash of the current head reference as well
        const curRef = this.references.find((r: Reference) => r.getName() === this.head.getName());
        if (curRef) {
          curRef.hash = commit.hash;
        }
      } else {
        this.head.setName(this.options.defaultBranchName ?? 'Main');
        this.head.hash = commit.hash;
        this.references.push(new Reference(REFERENCE_TYPE.BRANCH, this.head.getName(), this, { hash: commit.hash, start: commit.hash }));
      }

      return this.repoOdb.writeCommit(commit);
    })
      .then(() => {
        this.head.hash = commit.hash;
        // update .snow/HEAD
        return this.repoOdb.writeHeadReference(this.head);
      })
      .then(() =>
        // update .snow/refs/XYZ
        this.repoOdb.writeReference(this.head))
      .then(() => this.repoLog.writeLog(`commit: ${message}`))
      .then(() => commit);
  }

  /**
   * Opens the repository from a given path.
   * @param workdir     The path at which the directory is located.
   * @returns           The new repository object.
   */
  static open(workdir: string): Promise<Repository> {
    const repo = new Repository();

    let odb: Odb = null;
    let commondirInside: string = null;
    let commondir: string = null;
    return io.pathExists(workdir)
      .then((exists: boolean) => {
        if (!exists) {
          throw new Error('workdir doesn\'t exist');
        }
        return getSnowFSRepo(workdir);
      })
      .then((snowFSRepoPath: string | null) => {
        if (!snowFSRepoPath) {
          throw new Error('directory contains no .snow');
        }
        workdir = snowFSRepoPath;
        commondirInside = join(workdir, '.snow');
        return io.stat(commondirInside);
      })
      .then((stat: fse.Stats) => {
        if (stat.isFile()) {
          return fse.readFile(commondirInside).then((buf: Buffer) => buf.toString());
        }

        return commondirInside;
      })
      .then((commondirResult: string) => {
        commondir = commondirResult;
        return io.pathExists(commondir);
      })
      .then((exists: boolean) => {
        if (!exists) throw new Error('commondir not found');
        return io.stat(commondir);
      })
      .then((stat: fse.Stats) => {
        if (!stat.isDirectory()) throw new Error('commondir must be a directory');

        // TODO: (Seb) Restore compress option
        repo.options = new RepositoryInitOptions(commondir);
        repo.repoWorkDir = workdir;
        repo.repoCommonDir = commondir;

        return Odb.open(repo);
      })
      .then((odbResult: Odb) => {
        odb = odbResult;
        repo.repoOdb = odbResult;
        repo.repoLog = new Log(repo);
        return odb.readCommits();
      })
      .then((commits: Commit[]) => {
        repo.commits = commits;
        for (const commit of commits) {
          repo.commitMap.set(commit.hash.toString(), commit);
        }
        return odb.readReferences();
      })
      .then((references: Reference[]) => {
        repo.references = references;
        return odb.readHeadReference();
      })
      .then((hashOrRefNameResult: string|null) => {
        let hashOrRefName = hashOrRefNameResult;
        if (!hashOrRefName) {
          if (repo.references.length > 0) {
            hashOrRefName = repo.references[0].getName();
          } else {
            // TODO (Seb): What shall we do if no reaf nor HEAD is available?
            throw new Error('no reference nor HEAD found');
          }
        }

        let headRef: Reference = null;
        // check if the head is a name
        if (hashOrRefName) {
          headRef = repo.references.find((ref: Reference) => ref.getName() === hashOrRefName);
        }

        if (!headRef) {
          headRef = new Reference(REFERENCE_TYPE.BRANCH, 'HEAD', repo, { hash: hashOrRefName, start: hashOrRefName });
        }

        repo.head.setName(headRef.getName());
        repo.head.hash = headRef.hash;
        return Index.loadAll(repo, odb);
      })
      .then((indexes: Index[]) => {
        repo.repoIndexes = indexes;
        return repo;
      });
  }

  /**
   * Creates and initializes a new repository at a given path.
   * @param workdir     The path at which the new repository will be created
   * @param opts        Additional options for the new repository.
   * @returns           The new repository object.
   */
  static initExt(workdir: string, opts?: RepositoryInitOptions): Promise<Repository> {
    const repo = new Repository();

    if (!opts) {
      // eslint-disable-next-line no-param-reassign
      opts = new RepositoryInitOptions();
    }

    let commondirOutside: boolean;
    if (opts.commondir) {
      if (opts.commondir.startsWith(workdir)) {
        throw new Error('commondir must be outside repository');
      }
      commondirOutside = true;
    } else {
      commondirOutside = false;
      // eslint-disable-next-line no-param-reassign
      opts.commondir = join(workdir, '.snow');
    }

    return fse.pathExists(join(workdir, '.snow'))
      .then((workdirExists: boolean) => {
        if (workdirExists) {
          throw new Error('workdir already exists');
        }
        return fse.pathExists(opts.commondir);
      }).then((commondirExists: boolean) => {
        if (commondirExists) {
          throw new Error('commondir already exists');
        }
        return io.ensureDir(workdir);
      })
      .then(() => Odb.create(repo, opts))
      .then((odb: Odb) => {
        repo.repoOdb = odb;
        repo.options = opts;
        repo.repoWorkDir = workdir;
        repo.repoCommonDir = opts.commondir;
        repo.repoIndexes = [];

        if (commondirOutside) {
          const snowtrackFile: string = join(workdir, '.snow');
          return fse.writeFile(snowtrackFile, opts.commondir)
            .then(() => hideItem(snowtrackFile));
        }
        return hideItem(opts.commondir);
      }).then(() => {
        return fse.writeFile(join(opts.commondir, 'IMPORTANT.txt'), warningMessage);
      })
      .then(() => {
        repo.repoLog = new Log(repo);
        return repo.repoLog.init();
      })
      .then(() => repo.repoLog.writeLog(`init: initialized at ${resolve(workdir)}`))
      .then(() => repo.createCommit(repo.getFirstIndex(), repo.options.defaultCommitMessage ?? 'Created Project', { allowEmpty: true }))
      .then(() => repo);
  }
}
