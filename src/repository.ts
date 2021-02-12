/* eslint import/no-unresolved: [2, { commonjs: true, amd: true }] */

import * as fse from 'fs-extra';
import { difference, intersection } from 'lodash';
import {
  isAbsolute, join, dirname, relative,
} from 'path';

import { Commit } from './commit';
import { properNormalize, putToTrash } from './common';
import { IgnoreManager } from './ignore';
import { Index } from './index';
import { DirItem, OSWALK, osWalk } from './io';
import { IoContext } from './io_context';
import { Odb } from './odb';
import { Reference } from './reference';
import { constructTree, TreeDir, TreeFile } from './treedir';

/**
 * Initialize a new [[Repository]].
 */
export class RepositoryInitOptions {
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
  WT_NEW = 128,

  /** File existed before, and is modified. */
  WT_MODIFIED = 256,

  /** File got deleted */
  WT_DELETED = 512,

  /** TODO: Not implemented yet */
  WT_TYPECHANGE = 1024,

  /** TODO: Not implemented yet */
  WT_RENAMED = 2048,

  /** TODO: Not implemented yet. Use if file is ignored by [[IgnoreManager]] */
  IGNORED = 16384,
}

/**
 * Flags passed to [[Repository.restoreVersion]].
 */
export const enum RESET {
  NONE = 0,

  /** Delete files from the worktree, if they are modified. The affected files will be deleted. */
  DELETE_MODIFIED_FILES = 1,

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
  DEFAULT = DELETE_MODIFIED_FILES | DELETE_NEW_FILES | RESTORE_DELETED_FILES
}

/**
 * Flags passed to [[Repository.getStatus]].
 */
export const enum FILTER {

  /** Return all untracked/new files. */
  INCLUDE_UNTRACKED = 1,

  /** Return all files ignored through [[IgnoreManager]]. */
  INCLUDE_IGNORED = 2,

  /** Return all unmodified files. */
  INCLUDE_UNMODIFIED = 4,

  /** Return all directories - in such case [[StatusEntry.isDirectory]] returns true */
  INCLUDE_DIRECTORIES = 8,

  /** Default flag passed to [[Repository.getStatus]] */
  ALL = INCLUDE_UNTRACKED | INCLUDE_UNMODIFIED,

  /** TODO: Not implemented yet. */
  SORT_CASE_SENSITIVELY = 512,

  /** TODO: Not implemented yet. */
  SORT_CASE_INSENSITIVELY = 1024,

  /** TODO: Not implemented yet. */
  INCLUDE_UNREADABLE = 16384,

  /** TODO: Not implemented yet. */
  INCLUDE_UNREADABLE_AS_UNTRACKED = 32768,
}

/** Initialize a new [[StatusEntry]] */
export interface StatusFileOptionsCustom {
  /** Relative path of the file to the workdir root. */
  path?: string;

  /** Flags, which define the attributes of the file. */
  status?: STATUS;
}

/**
 * Used toinitialize a new repository.
 */
export class StatusEntry {
  /** Internal data object which contains meta information about the file */
  data: StatusFileOptionsCustom;

  /** True if the "file" is actually a directory. */
  isdir: boolean;

  constructor(data: StatusFileOptionsCustom, isdir: boolean) {
    this.data = data;
    this.isdir = isdir;
  }

  /** Return true if the object is new. */
  isNew(): boolean {
    return Boolean(this.data.status & STATUS.WT_NEW);
  }

  /** Return true if the object is modified. */
  isModified(): boolean {
    return Boolean(this.data.status & STATUS.WT_MODIFIED);
  }

  /** Return true if the object got deleted. */
  isDeleted(): boolean {
    return Boolean(this.data.status & STATUS.WT_DELETED);
  }

  /** Return true if the object is ignored by [[IgnoreManager]]. */
  isIgnored(): boolean {
    return Boolean(this.data.status & STATUS.IGNORED);
  }

  /** Return true if the object got renamed. */
  isRenamed(): boolean {
    return Boolean(this.data.status & STATUS.WT_RENAMED);
  }

  /** Return true if the meta info got changed. For more information, please see [[STATUS.WT_TYPECHANGE]]. */
  isTypechange(): boolean {
    return Boolean(this.data.status & STATUS.WT_TYPECHANGE);
  }

  // Return the path of the object.
  get path(): string {
    return this.data.path;
  }

  /** Sets the internal status bits of the object. Normally used only inside [[Repository.getStatus]]. */
  public setStatusBit(status: STATUS) {
    this.data.status = status;
  }

  /** Return all status bits of the object. */
  statusBit(): STATUS {
    return this.data.status;
  }

  /** Return true if the object represents a directory. */
  isDirectory(): boolean {
    return this.isdir;
  }
}

async function getSnowFSRepo(path: string): Promise<string | null> {
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

  /** Repository index of the repository */
  repoIndex: Index;

  /** Options object, with which the repository got initialized */
  options: RepositoryInitOptions;

  /** HEAD reference to the currently checked out commit */
  readonly head: Reference = new Reference('HEAD', this, { hash: undefined, start: null });

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
   * Path to the repositories commondir, also known as the `.snowtrack` directory.
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
   * Return the currently active Index object for the repository.
   */
  getIndex(): Index {
    return this.repoIndex;
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
  getAllCommits(): Commit[] {
    return this.commits.map((c: Commit) => c.clone());
  }

  /**
   * Find and return the commit object by a given reference name.
   * The reference names can be acquired by [[Repository.getAllReferences]].
   * `name` can also be `HEAD`.
   */
  findCommitByReferenceName(name: string): Commit|null {
    let ref: Reference = this.references.find((ref: Reference) => ref.getName() === name);
    if (!ref) {
      ref = (name === 'HEAD') ? this.head : null;
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
  findReferenceByName(refName: string): Reference|null {
    const ref: Reference = this.references.find((r: Reference) => r.getName() === refName);
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
   */
  getCommitByHash(hash: string): Commit {
    return this.commitMap.get(hash);
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
   * Deletes the current branch. If the passed Reference is the HEAD reference, it is ignored.
   */
  async deleteBranch(ref: Reference) {
    const index = this.references.findIndex((r: Reference) => r.getName() === ref.getName());
    if (index > -1) {
      this.references.splice(index, 1);
    }
    return this.repoOdb.deleteHeadReference(ref);
  }

  /**
   * Stores the HEAD reference to disk, inside the commondir.
   */
  async writeHeadRefToDisk() {
    return this.repoOdb.writeHeadReference(this.head);
  }

  /**
   * Create a new reference.
   *
   * @param name  Name of the new reference
   * @param hash  Commit hash of the new reference.
   * @param start Set commit hash of the start of the reference.
   */
  async createReference(name: string, hash: string, start?: string|null): Promise<Reference> {
    const existingRef: Reference = this.references.find((ref: Reference) => ref.getName() === name);
    if (existingRef) {
      throw new Error('Reference already exists');
    }

    const newRef: Reference = new Reference(name, this, { hash, start });
    this.references.push(newRef);
    return this.repoOdb.writeReference(newRef).then(() => newRef);
  }

  /**
   * Restore to a commit by a given reference, commit or commit hash.
   *
   * @param target    Reference, commit or commit hash.
   * @param reset     Options for the restore operation.
   */
  async restore(target: string|Reference|Commit, reset: RESET): Promise<void> {
    let oldFilePaths: string[];
    let oldFilesMap: Map<string, TreeFile>;
    const currentFiles: string[] = [];

    let targetRef: Reference;
    let targetCommit: Commit;
    if (typeof target === 'string') {
      // check first if target is a reference name...
      const ref: Reference = this.findReferenceByName(target);
      if (ref) {
        targetRef = ref;
        targetCommit = this.getCommitByHash(ref.target());
      } else {
        // ... otherwise check if its a hash
        const refs: Reference[] = this.filterReferenceByHash(target);
        // 1) If more than one ref is available we are in a detached HEAD
        // 2) If there is no ref available, we are in a detached HEAD
        if (refs.length === 0) {
          // if no reference was found by name, nor a reference that points
          // to the commit hash, try if the target is a commit hash
          targetCommit = this.getCommitByHash(target);
        } else if (refs.length > 1) {
          throw new Error(`more than one ref found for ${target}`);
        } else {
          targetRef = refs[0];
          targetCommit = this.getCommitByHash(refs[0].target());
        }
      }
    } else if (target instanceof Reference) {
      targetRef = target;
      targetCommit = this.getCommitByHash((target as Reference).hash);
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

    let items: DirItem[];

    const ioContext = new IoContext();
    // First iterate over all files and get their file stats
    return ioContext.init()
      .then(() => osWalk(this.repoWorkDir, OSWALK.FILES))
      .then((itemsResult: DirItem[]) => {
        // head hash is null before first commit is made
        if (!this.head.hash) {
          return [] as any; // as any otherwise TS doesn't like it
        }

        items = itemsResult;

        oldFilesMap = targetCommit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: false }) as Map<string, TreeFile>;

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
        for (const item of items) {
          currentFiles.push(relative(this.repoWorkDir, item.path));
        }

        // Contains all files that are registered by the Commit object
        oldFilePaths = Array.from(oldFilesMap.values()).map((f: TreeFile) => f.path);

        const promises: Promise<void>[] = [];
        if (reset & RESET.DELETE_NEW_FILES) {
          // Delete files which didn't exist before, but do now
          const newFiles: string[] = difference(currentFiles, oldFilePaths);
          for (const newFile of newFiles) {
            promises.push(putToTrash(join(this.repoWorkDir, newFile)));
          }
        }

        // Files which existed before but don't anymore
        if (reset & RESET.RESTORE_DELETED_FILES) {
          const deletedFiles: string[] = difference(oldFilePaths, currentFiles);
          for (const deletedFile of deletedFiles) {
            const file: TreeFile = oldFilesMap.get(deletedFile);
            if (file) {
              promises.push(this.repoOdb.readObject(file.hash, join(this.repoWorkDir, deletedFile), ioContext));
            } else {
              throw new Error("file was detected as deleted but couldn't be found in old commit either");
            }
          }
        }

        return Promise.all(promises);
      })
      .then(() => {
        // Files which existed before, and still do, but check if they were modified

        const promises = [];
        const existingFiles = intersection(currentFiles, oldFilePaths);
        for (const existingFile of existingFiles) {
          const tfile: TreeFile = oldFilesMap.get(existingFile);
          if (!tfile) {
            throw new Error(`File '${tfile.path}' not found during last-modified-check`);
          }

          promises.push(tfile.isFileModified(this));
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

      });
  }

  /**
   * Get the status of files in the current worktree. The returned entries can be
   * controlled by the passed filter.
   * @param filter  Defines which entries the function returns
   */
  async getStatus(filter?: FILTER): Promise<StatusEntry[]> {
    let oldFilesMap: Map<string, TreeFile>;
    let oldFilePaths: string[];
    const statusResult: StatusEntry[] = [];
    const currentFiles: string[] = [];

    let ignore: IgnoreManager;

    // First iterate over all files and get their file stats
    const snowtrackIgnoreDefault: string = join(this.repoWorkDir, 'ignore');
    return fse.pathExists(snowtrackIgnoreDefault)
      .then((exists: boolean) => {
        if (exists) {
          ignore = new IgnoreManager();
          return ignore.init(snowtrackIgnoreDefault);
        }
      })
      .then(() => {
        let walk: OSWALK = OSWALK.FILES | OSWALK.IGNORE_REPOS;
        walk |= filter & FILTER.INCLUDE_DIRECTORIES ? OSWALK.DIRS : 0;
        walk |= filter & FILTER.INCLUDE_IGNORED ? OSWALK.HIDDEN : 0;
        return osWalk(this.repoWorkDir, walk);
      })
      .then((items: DirItem[]) => {
        // head is null before first commit is made
        if (!this.head.hash) {
          return [] as any;
        }

        for (const item of items) {
          if (item.isdir) {
            if (filter & FILTER.INCLUDE_DIRECTORIES) {
              statusResult.push(new StatusEntry({ path: relative(this.repoWorkDir, item.path).replace(/\\/g, '/') }, true));
            }
          } else {
            currentFiles.push(relative(this.repoWorkDir, item.path).replace(/\\/g, '/'));
          }
        }
        const currentCommit: Commit = this.getCommitByHead();

        // Contains all files that are registered by the Commit object
        oldFilesMap = currentCommit?.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: false }) as Map<string, TreeFile>;
        if (oldFilesMap) {
          oldFilePaths = Array.from(oldFilesMap.values()).map((f: TreeFile) => f.path);
        } else {
          // no files map is available directly after getStatus is called if no commit made yet
          oldFilesMap = new Map();
          oldFilePaths = [];
        }

        if (filter & FILTER.INCLUDE_UNTRACKED) {
          // Files which didn't exist before, but do now
          const newFiles: string[] = difference(currentFiles, oldFilePaths);
          for (const newFile of newFiles) {
            if (!ignore || !ignore.ignored(newFile)) {
              statusResult.push(new StatusEntry({ path: newFile, status: STATUS.WT_NEW }, false));
            }
          }
        }

        // Files which existed before but don't anymore
        const deletedFiles: string[] = difference(oldFilePaths, currentFiles);
        for (const deletedFile of deletedFiles) {
          if (!ignore || !ignore.ignored(deletedFile)) {
            statusResult.push(new StatusEntry({ path: deletedFile, status: STATUS.WT_DELETED }, false));
          }
        }

        const promises = [];
        const existingFiles = intersection(currentFiles, oldFilePaths);
        for (const existingFile of existingFiles) {
          const tfile: TreeFile = oldFilesMap.get(existingFile);
          if (!tfile) {
            throw new Error(`File '${tfile.path}' not found during last-modified-check`);
          }

          promises.push(tfile.isFileModified(this));
        }

        return Promise.all(promises);
      })
      .then((existingFiles: {file: TreeFile; modified : boolean}[]) => {
        for (const existingFile of existingFiles) {
          if (existingFile.modified) {
            if (!ignore || !ignore.ignored(existingFile.file.path)) {
              statusResult.push(new StatusEntry({ path: existingFile.file.path, status: STATUS.WT_MODIFIED }, false));
            }
          } else if (filter & FILTER.INCLUDE_UNMODIFIED) {
            statusResult.push(new StatusEntry({ path: existingFile.file.path, status: STATUS.UNMODIFIED }, false));
          }
        }

        return statusResult;
      });
  }

  /**
   * Create a new commit, by the given index. The index must have been written onto disk by calling [[Index.writeFiles]].
   * @param index Passed index of files that will be added to the commit object.
   * @param message A human readable message string, that describes the changes.
   * @param data Custom data that is attached to the commit data. The data must be JSON.stringifyable.
   * @returns     New commit object.
   */
  async createCommit(index: Index, message: string, opts?: {allowEmpty?: boolean}, data?: {}): Promise<Commit> {
    let tree: TreeDir;
    let commit: Commit;
    if (index.adds.size === 0 && index.deletes.size === 0 && (!opts || !opts.allowEmpty)) {
      // did you forget to call index.writeFiles(..)?
      throw new Error('nothing to commit (create/copy files and use "git add" to track)');
    }

    const hashMap: Map<string, string> = index.getHashedIndexMap();
    return constructTree(this.repoWorkDir, hashMap)
      .then((treeResult: TreeDir) => {
        tree = treeResult;
        this.repoIndex.deletes.forEach((r: string) => {
          tree.remove(isAbsolute(r) ? relative(this.repoWorkDir, r) : r);
        });

        return index.reset();
      }).then(() => {
        commit = new Commit(this, message, new Date(), tree, [this.head ? this.head.hash : null]);
        if (data) {
          for (const [key, value] of Object.entries(data)) {
            commit.addData(key, value);
          }
        }

        this.commits.push(commit);
        this.commitMap.set(commit.hash.toString(), commit);

        if (this.head.hash) {
          this.head.hash = commit.hash;
        } else {
          this.head.setName('Main');
          this.head.hash = commit.hash;
          this.references.push(new Reference(this.head.getName(), this, { hash: commit.hash, start: commit.hash }));
        }

        return this.repoOdb.writeCommit(commit);
      })
      .then(() => {
        this.head.hash = commit.hash;
        // update .snowtrack/HEAD
        return this.repoOdb.writeHeadReference(this.head);
      })
      .then(() =>
      // update .snowtrack/refs/XYZ
        this.repoOdb.writeReference(this.head))
      .then(() => commit);
  }

  /**
   * Opens the repository from a given path.
   * @param workdir     The path at which the directory is located.
   * @returns           The new repository object.
   */
  static async open(workdir: string): Promise<Repository> {
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
      .then(async (stat: fse.Stats) => {
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
          headRef = new Reference('HEAD', repo, { hash: hashOrRefName, start: hashOrRefName });
        }

        repo.head.setName(headRef.getName());
        repo.head.hash = headRef.hash;
        repo.repoIndex = new Index(repo, odb);
        return repo.repoIndex.load();
      })
      .then(() => repo);
  }

  /**
   * Creates and initializes a new repository at a given path.
   * @param workdir     The path at which the new repository will be created
   * @param opts        Additional options for the new repository.
   * @returns           The new repository object.
   */
  static async initExt(workdir: string, opts?: RepositoryInitOptions): Promise<Repository> {
    const repo = new Repository();

    if (!opts) {
      // eslint-disable-next-line no-param-reassign
      opts = new RepositoryInitOptions();
    }

    let commondirOutside: boolean;
    if (opts.commondir) {
      if (properNormalize(opts.commondir).startsWith(properNormalize(workdir))) {
        throw new Error('commondir must be outside repository');
      }
      commondirOutside = true;
    } else {
      commondirOutside = false;
      // eslint-disable-next-line no-param-reassign
      opts.commondir = join(workdir, '.snow');
    }

    return fse.ensureDir(workdir)
      .then(async () => {
        if (commondirOutside) {
          const snowtrackFile: string = join(workdir, '.snow');
          return fse.writeFile(snowtrackFile, opts.commondir);
        }
      })
      .then(() => Odb.create(repo, opts))
      .then((odb: Odb) => {
        repo.repoOdb = odb;
        repo.options = opts;
        repo.repoWorkDir = workdir;
        repo.repoCommonDir = opts.commondir;
        repo.repoIndex = new Index(repo, odb);

        // although empty, call writeFiles to satisfy createCommit which checks that writeFiles got called
        return repo.repoIndex.writeFiles();
      })
      .then(() => repo.createCommit(repo.getIndex(), 'Created Project', { allowEmpty: true }))
      .then((commit: Commit) => repo);
  }
}
