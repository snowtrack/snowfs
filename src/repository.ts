/* eslint import/no-unresolved: [2, { commonjs: true, amd: true }] */

import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import {
  resolve, join, dirname,
} from './path';

import { Log } from './log';
import { Commit } from './commit';
import { FileInfo } from './common';
import { IgnoreManager } from './ignore';
import { Index } from './index';
import { DirItem, OSWALK, osWalk } from './io';
import { IoContext } from './io_context';
import { Odb } from './odb';
import { Reference } from './reference';
import {
  constructTree, TreeDir, TreeEntry, TreeFile,
} from './treedir';

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

/**
 * Initialize a new [[Repository]].
 */
export class RepositoryInitOptions {
  defaultBranchName?: string;

  defaultCommitMessage?: string;

  commondir?: string;

  compress?: boolean;

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
  /** Set if [[FILTER.INCLUDE_UNMODIFIED]] is passed to [[Repository.getStatus]] and file is not modified */
  UNMODIFIED = 0,

  /** Set if [[FILTER.INCLUDE_UNTRACKED]] is passed to [[Repository.getStatus]] and file is new. */
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

  /** Restore modified files. */
  RESTORE_MODIFIED_FILES = 1,

  /** Delete files from the worktree, if they are untracked/new. The affected files will be deleted. */
  DELETE_NEW_FILES = 2,

  /** Restore deleted files from the worktree, if they were deleted. */
  RESTORE_DELETED_FILES = 4,

  /**
   * Restore function will detach HEAD after the commit got restored.
   * This can be helpful if the restore target is a reference, but you
   * need a detached HEAD state nonetheless.
   */
  DETACH = 8,

  /** Default flag passed to [[Repository.restoreVersion]] */
  DEFAULT = RESTORE_MODIFIED_FILES | DELETE_NEW_FILES | RESTORE_DELETED_FILES
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
  SORT_CASE_INSENSITIVELY = 1024
}

/** Initialize a new [[StatusEntry]] */
export interface StatusItemOptionsCustom {
  /** Relative path of the item to the workdir root. */
  path?: string;

  /** Flags, which define the attributes of the item. */
  status?: STATUS;
}

/**
 * Used toinitialize a new repository.
 */
export class StatusEntry {
  /** Relative path of the item to the workdir root. */
  path?: string;

  /** Flags, which define the attributes of the item. */
  status?: STATUS;

  /** True if the item is a directory. */
  isdir: boolean;

  constructor(data: StatusItemOptionsCustom, isdir: boolean) {
    this.path = data.path;
    this.status = data.status;
    this.isdir = isdir;
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
  public setStatusBit(status: STATUS) {
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
}

function getSnowFSRepo(path: string): Promise<string | null> {
  const snowInit: string = join(path, '.snow');
  return fse.pathExists(snowInit).then((exists: boolean) => {
    if (exists) {
      return path;
    }

    if (dirname(path) === path) {
      return null;
    }
    return getSnowFSRepo(dirname(path));
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
  commitMap: Map<string, Commit> = new Map();

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
  removeIndex(index: Index) {
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
  walkCommit(commit: Commit, cb: (commit: Commit) => void) {
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
              throw new Error(`commit ${commit.hash} has no parent`);
            }
            commit = this.commitMap.get(commit.parent[0]);
            if (!commit) {
              throw new Error(`commit hash '${hash}' out of history`);
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

    let ref: Reference;
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
  setHead(name: string) {
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
  setHeadDetached(hash: string) {
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
    const commit: Commit = this.findCommitByHash(commitHash);
    if (!commit) {
      throw new Error('cannot find commit');
    }

    const parentOfDeletedCommit = commit.parent;

    const updateCommits = [];
    this.commitMap.forEach((c: Commit) => {
      if (c.parent.includes(commitHash)) {
        c.parent = parentOfDeletedCommit;
        updateCommits.push(this.repoOdb.writeCommit(c));
      }
    });

    this.commitMap.delete(commitHash);

    let promise: Promise<unknown>;
    if (this.head.hash === commitHash) {
      this.head.hash = commit.parent[0];
      promise = this.repoOdb.writeHeadReference(this.head);
    } else {
      promise = Promise.resolve();
    }

    return promise
      .then(() => {
        const promises = [];
        for (const ref of this.references) {
          if (ref.hash === commitHash) {
            ref.hash = commit.parent[0];
            promises.push(this.repoOdb.writeReference(ref));
          }
        }
        return Promise.all(promises);
      }).then(() => {
        return this.repoOdb.deleteCommit(commit);
      }).then(() => {
        return Promise.all(updateCommits);
      });
  }

  /**
   * Restore to a commit by a given reference, commit or commit hash.
   *
   * @param target    Reference, commit or commit hash.
   * @param reset     Options for the restore operation.
   */
  checkout(target: string|Reference|Commit, reset: RESET): Promise<void> {
    let targetRef: Reference;
    let targetCommit: Commit;
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
      targetCommit = this.findCommitByHash((target as Reference).hash);
    } else if (target instanceof Commit) {
      const refs: Reference[] = this.filterReferenceByHash(target.hash);
      // if more than one ref is available we end up in a detached HEAD
      if (refs.length === 1) {
        targetRef = refs[0];
      }
      targetCommit = target as Commit;
    }
    if (!targetCommit) {
      throw new Error('unknown target version');
    }

    const oldFilesMap: Map<string, TreeEntry> = targetCommit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

    let statuses: StatusEntry[] = [];
    const deleteCandidates = new Map<string, StatusEntry>();
    const deleteRevokeDirs = new Set<string>();

    const ioContext = new IoContext();
    return ioContext.init()
      .then(() => this.getStatus(FILTER.DEFAULT | FILTER.INCLUDE_IGNORED | FILTER.SORT_CASE_SENSITIVELY, targetCommit))
      .then((statusResult: StatusEntry[]) => {
        // head hash is null before first commit is made
        if (!this.head.hash) {
          return [] as any; // as any otherwise TS doesn't like it
        }

        statuses = statusResult;

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
        const promises = [];

        // Items which existed before but don't anymore
        statuses.forEach((status: StatusEntry) => {
          if (status.isDeleted() && reset & RESET.RESTORE_DELETED_FILES) {
            const dst: string = join(this.repoWorkDir, status.path);

            if (status.isFile()) {
              const tfile: TreeEntry = oldFilesMap.get(status.path);
              if (tfile) {
                promises.push(this.repoOdb.readObject(tfile.hash, dst, ioContext));
              } else {
                throw new Error("item was detected as deleted but couldn't be found in reference commit");
              }

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
              promises.push(fse.ensureDir(dst));
            }
          } else if (status.isNew() && reset & RESET.DELETE_NEW_FILES) {
            deleteCandidates.set(status.path, status);
          } else if (status.isIgnored()) {
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

        return Promise.all(promises);
      })
      .then(() => {
        const promises = [];

        if (reset & RESET.RESTORE_MODIFIED_FILES) {
          for (const file of statuses) {
            if (file.isModified() && file.isFile()) {
              const tfile: TreeFile = oldFilesMap.get(file.path) as TreeFile;
              if (tfile) {
                promises.push(tfile.isFileModified(this));
              } else {
                throw new Error(`File '${tfile.path}' not found during last-modified-check`);
              }
            }
          }
        }

        return Promise.all(promises);
      })
      .then((modifiedFiles: {file: TreeFile; modified : boolean}[]) => {
        const promises = [];

        for (const modifiedFile of modifiedFiles) {
          if (modifiedFile.modified) {
            const dst: string = join(this.repoWorkDir, modifiedFile.file.path);
            promises.push(this.repoOdb.readObject(modifiedFile.file.hash, dst, ioContext));
          }
        }
        return Promise.all(promises);
      })
      .then(() => {
        const promises = [];

        deleteCandidates.forEach((candidate: StatusEntry, relPath: string) => {
          // Check if the delete operation got revoked for the directory
          if (candidate.isDirectory()) {
            if (!deleteRevokeDirs.has(relPath)) {
              // If we delete a directory, we can remove all its subdirectories and files from the candidate list
              // as they will already be deleted by the delete operation below.
              deleteCandidates.forEach((_c: StatusEntry, relPath2: string) => {
                if (relPath2.startsWith(relPath)) {
                  deleteCandidates.delete(relPath2);
                }
              });
              promises.push(IoContext.putToTrash(join(this.workdir(), candidate.path)));
            }
          } else {
            promises.push(IoContext.putToTrash(join(this.workdir(), candidate.path)));
          }
        });

        return Promise.all(promises);
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
        return this.repoLog.writeLog(`checkout: move to '${moveTo}' at ${targetCommit.hash} with ${reset}`);
      });
  }

  /**
   * Get the status of files in the current worktree. The returned entries can be
   * controlled by the passed filter.
   * @param filter  Defines which entries the function returns
   */
  getStatus(filter?: FILTER, commit?: Commit): Promise<StatusEntry[]> {
    const statusResult: Map<string, StatusEntry> = new Map();

    const ignore = new IgnoreManager();

    // First iterate over all files and get their file stats
    const snowtrackIgnoreDefault: string = join(this.repoWorkDir, '.snowignore');
    return fse.pathExists(snowtrackIgnoreDefault)
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
      .then((currentFilesInProj: DirItem[]) => {
        const targetCommit: Commit = commit ?? this.getCommitByHead();
        const promises = [];

        // head is null before first commit is made, so add check to be safe than sorry
        if (!this.head.hash || !targetCommit) {
          return [] as any;
        }

        // Get all tree entries from HEAD
        const oldFilesMap: Map<string, TreeEntry> = targetCommit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
        const curFilesMap: Map<string, DirItem> = new Map(currentFilesInProj.map((x: DirItem) => [x.relPath, x]));

        const oldFiles: TreeEntry[] = Array.from(oldFilesMap.values());

        if (filter & FILTER.INCLUDE_IGNORED) {
          const ignored: DirItem[] = currentFilesInProj.filter((value) => ignore.ignored(value.relPath));
          for (const entry of ignored) {
            if (!entry.isdir || filter & FILTER.INCLUDE_DIRECTORIES) {
              statusResult.set(entry.relPath, new StatusEntry({ path: entry.relPath, status: STATUS.WT_IGNORED }, entry.isdir));
            }
          }
        }

        // Files which didn't exist before, but do now
        if (filter & FILTER.INCLUDE_UNTRACKED) {
          const entries: DirItem[] = currentFilesInProj.filter((value) => !oldFilesMap.has(value.relPath) && !ignore.ignored(value.relPath));
          for (const entry of entries) {
            if (!entry.isdir || filter & FILTER.INCLUDE_DIRECTORIES) {
              statusResult.set(entry.relPath, new StatusEntry({ path: entry.relPath, status: STATUS.WT_NEW }, entry.isdir));
            }
          }
        }

        // Files which existed before but don't anymore
        if (filter & FILTER.INCLUDE_DELETED) {
          const entries: TreeEntry[] = oldFiles.filter((value) => !curFilesMap.has(value.path) && !ignore.ignored(value.path));

          for (const entry of entries) {
            if (!entry.isDirectory() || filter & FILTER.INCLUDE_DIRECTORIES) {
              statusResult.set(entry.path, new StatusEntry({ path: entry.path, status: STATUS.WT_DELETED }, entry.isDirectory()));
            }
          }
        }

        if (filter & FILTER.INCLUDE_DIRECTORIES) {
          for (const entry of currentFilesInProj) {
            if (entry.isdir && !statusResult.has(entry.relPath) && !ignore.ignored(entry.relPath)) {
              // the status of this directory will later be overwritten in case
              // the directory contains a file that is modified
              statusResult.set(entry.relPath, new StatusEntry({ path: entry.relPath, status: 0 }, true));
            }
          }
        }

        // Check which files were modified
        if (filter & FILTER.INCLUDE_MODIFIED) {
          const entries: TreeEntry[] = oldFiles.filter((value) => curFilesMap.has(value.path) && !ignore.ignored(value.path));

          for (const existingEntry of entries) {
            if (existingEntry instanceof TreeFile) {
              promises.push(existingEntry.isFileModified(this));
            }
          }
        }
        return Promise.all(promises);
      })
      .then((existingFiles: {file: TreeFile; modified : boolean}[]) => {
        for (const existingFile of existingFiles) {
          if (existingFile.modified) {
            statusResult.set(existingFile.file.path, new StatusEntry({ path: existingFile.file.path, status: STATUS.WT_MODIFIED }, false));
          } else if (filter & FILTER.INCLUDE_UNMODIFIED) {
            statusResult.set(existingFile.file.path, new StatusEntry({ path: existingFile.file.path, status: STATUS.UNMODIFIED }, false));
          }
        }

        const result = Array.from(statusResult.values());

        // The following sorting also ensures that a directory is listed before its sub-items.
        // E.g: ['foo.pxd', 'foo.pxd/Info.plist', 'foo2.pxd', 'foo2.pxd/Info.plist']
        if (filter & FILTER.SORT_CASE_SENSITIVELY) {
          result.sort((a: StatusEntry, b: StatusEntry) => a.path.toLocaleLowerCase().localeCompare(b.path.toLocaleLowerCase()));
        } else if (filter & FILTER.SORT_CASE_SENSITIVELY) {
          result.sort((a: StatusEntry, b: StatusEntry) => a.path.localeCompare(b.path));
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
    let tree: TreeDir;
    let commit: Commit;
    if (opts?.allowEmpty) {
      if (!index) {
        index = new Index(this, this.repoOdb); // dummy index if no index got passed
        await index.writeFiles();
      }
    } else if (index.addRelPaths.size === 0 && index.deleteRelPaths.size === 0) {
      // did you forget to call index.writeFiles(..)?
      throw new Error('nothing to commit (create/copy files and use "snow add" to track)');
    }

    const processedMap = new Map<string, FileInfo>();

    // head is not available when repo is initialized
    if (this.head?.hash) {
      const headCommit = this.getCommitByHead();
      const currentTree: Map<string, TreeEntry> = headCommit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: false });

      // store the current tree files in the processed map...
      currentTree.forEach((value: TreeFile) => {
        processedMap.set(value.path, {
          hash: value.hash,
          stat: {
            size: value.size, atime: 0, mtime: value.mtime, ctime: value.ctime,
          },
        });
      });
    }

    // ... and overwrite the items with the new values from the index that just got commited
    index.getProcessedMap().forEach((value: FileInfo, path: string) => {
      processedMap.set(path, value);
    });

    return constructTree(this.repoWorkDir, processedMap)
      .then((treeResult: TreeDir) => {
        tree = treeResult;

        // the tree already contains the new files, added by constructTree
        // through the processed hashmap
        // index.addRelPaths.forEach(...) ...

        // remove the elements from the tree that were removed in the index
        index.deleteRelPaths.forEach((relPath: string) => {
          tree.remove(relPath);
        });

        return index.invalidate();
      }).then(() => {
        commit = new Commit(this, message, new Date(), tree, [this.head ? this.head.hash : null]);

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

    let odb: Odb;
    let commondirInside: string;
    let commondir: string;
    return getSnowFSRepo(workdir).then((snowFSRepoPath: string | null) => {
      if (!snowFSRepoPath) {
        throw new Error('not a SnowFS repository (or any of the parent directories): .snow');
      }
      workdir = snowFSRepoPath;
      commondirInside = join(workdir, '.snow');
      return fse.stat(commondirInside);
    })
      .then((stat: fse.Stats) => {
        if (stat.isFile()) {
          return fse.readFile(commondirInside).then((buf: Buffer) => buf.toString());
        }

        return commondirInside;
      })
      .then((commondirResult: string) => {
        commondir = commondirResult;
        return fse.pathExists(commondir);
      })
      .then((exists: boolean) => {
        if (!exists) throw new Error("commondir doesn't exist");
        return fse.stat(commondir);
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

        let headRef: Reference;
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

    return fse.ensureDir(workdir)
      .then(() => {
        if (commondirOutside) {
          const snowtrackFile: string = join(workdir, '.snow');
          return fse.writeFile(snowtrackFile, opts.commondir);
        }
      }).then(() => Odb.create(repo, opts))
      .then((odb: Odb) => {
        repo.repoOdb = odb;
        repo.options = opts;
        repo.repoWorkDir = workdir;
        repo.repoCommonDir = opts.commondir;
        repo.repoIndexes = [];
        repo.repoLog = new Log(repo);
        return repo.repoLog.init();
      })
      .then(() => repo.repoLog.writeLog(`init: initialized at ${resolve(workdir)}`))
      .then(() => repo.createCommit(repo.getFirstIndex(), repo.options.defaultCommitMessage ?? 'Created Project', { allowEmpty: true }))
      .then(() => repo);
  }
}
