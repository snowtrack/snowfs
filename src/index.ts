import * as fse from 'fs-extra';

import { difference } from 'lodash';

import {
  isAbsolute, join, relative, basename,
} from './path';
import * as fss from './fs-safe';
import { IoContext, posix } from './io_context';
import { Odb } from './odb';
import { Repository } from './repository';
import { DirItem, OSWALK, osWalk } from './io';
import { FileInfo } from './common';

// if Node version 15, switch to built-in AggregateError
const AggregateError = require('aggregate-error');
const { fcntl, constants } = require('fs-ext');

class StacklessError extends Error {
  constructor(...args) {
    super(...args);
    this.name = this.constructor.name;
    delete this.stack;
  }
}

export async function lock(path: string) {
  return new Promise<number>((resolve, reject) => fse.open(path, 'r', (err, fd: number) => {
    if (err) reject(err);
    resolve(fd);
  })).then((fd: number) => new Promise<any>((resolve, reject) => {
    async function release() {
      return new Promise<void>((resolve, reject) => {
        fcntl(fd, constants.F_UNLCK, (err: Error) => {
          if (err) reject(err);
          resolve();
        });
      });
    }

    fcntl(fd, constants.F_RDLCK, (err: Error) => {
      if (err) reject(err);
      resolve(release);
    });
  }));
}

/**
 * A class representing a list of files that is used to create a new Commit object.
 * Every repository contains an individual instance of the Index class which can
 * be acquired by [[Repository.getIndex]]. Files can be then added to, or removed from,
 * the index which is then passed to [[Repository.createCommit]] to create a new commit.
 */
export class Index {
  /**
   * The repository this instance belongs to.
   */
  repo: Repository;

  /**
   * The object database. Same as [[Repository.getOdb]].
   */
  odb: Odb;

  /**
   * Unique id for the index, used in the filename of the index
   */
  id: string;

  /** Hash map of hashes and files. Empty by default, and filled
   * after [[Index.writeFiles]] has been called and the hashes of the files have been calculated.
   */
  processed: Map<string, FileInfo> = new Map();

  /**
   * A set of filepaths of new files that will be part of the new commit.
   */
  addRelPaths: Set<string> = new Set();

  /**
   * A set of filepaths of new files that will be removed from the new commit.
   */
  deleteRelPaths: Set<string> = new Set();

  constructor(repo: Repository, odb: Odb, id = '') {
    this.repo = repo;
    this.id = id;
    this.odb = odb;
  }

  /**
   * Reset the entire index object. Used internally after a commit has been created,
   * or can be useful to discard any added or deleted files from the index object.
   */
  invalidate(): Promise<void> {
    return fse.pathExists(this.getAbsPath()).then((exists: boolean) => {
      if (exists) { return fse.unlink(this.getAbsPath()); }
    }).then(() => {
      this.repo.removeIndex(this);

      this.addRelPaths = new Set();
      this.deleteRelPaths = new Set();
      this.processed.clear();
      this.id = undefined;
      this.repo = null;
      this.odb = null;
    });
  }

  /**
   * Ensure the index is valid. After a commit is created, the index file will be
   * deleted and this object will be invalidated and shouldn't be used anymore
   *
   * @throws Throws an exception if Index.invalidate() got called before.
   */
  throwIfNotValid() {
    if (!this.id && this.id !== '') { // an empty string is allowed for the main index
      // this happens if an index object got commited, it will be deleted and cleared
      throw new Error('index object is invalid');
    }
  }

  /**
   * Return the absolute path of the index directory
   *
   * @returns       Absolute path to the index directory.
   */
  static getAbsDir(repo: Repository): string {
    const indexDir: string = join(repo.commondir(), 'indexes');
    return indexDir;
  }

  /**
   * Return the absolute path of the index file
   *
   * @returns       Absolute path to the index file.
   */
  getAbsPath(): string {
    const indexPath: string = join(Index.getAbsDir(this.repo), this.id ? `index.${this.id}` : 'index');
    return indexPath;
  }

  /**
   * Store the index object to disk. Saved to {workdir}/.snow/index/..
   */
  private save(): Promise<void> {
    this.throwIfNotValid();

    const userData: string = JSON.stringify({
      adds: this.addRelPaths,
      deletes: this.deleteRelPaths,
      processed: this.processed,
    }, (key, value) => {
      if (value instanceof Map) {
        return Array.from(value.entries());
      }
      if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    });
    return fse.ensureDir(Index.getAbsDir(this.repo)).then(() => fss.writeSafeFile(this.getAbsPath(), userData))
      .then(() => this.repo.modified());
  }

  /**
   * Load a saved index object from `{workdir}/.snow/index/..`.
   * If the index wasn't saved before, the function does not fail.
   */
  static loadAll(repo: Repository, odb: Odb): Promise<Index[]> {
    return fse.ensureDir(Index.getAbsDir(repo)).then(() => osWalk(Index.getAbsDir(repo), OSWALK.FILES)).then((dirItems: DirItem[]) => {
      const readIndexes = [];
      for (const dirItem of dirItems) {
        const indexName = basename(dirItem.absPath);
        if (indexName.startsWith('index') || indexName === 'index') {
          readIndexes.push(fse.readFile(dirItem.absPath).then((buf: Buffer) => [dirItem.absPath, buf]));
        }
      }
      return Promise.all(readIndexes);
    }).then((promises: [string, Buffer][]) => {
      const parseIndexes = [];
      for (const parseIndex of promises) {
        const indexName = basename(parseIndex[0]); // 'index.abc123'
        const isMainIndex = indexName === 'index';
        const index = new Index(repo, odb, isMainIndex ? '' : indexName.substr(6, indexName.length - 6)); // set 'abc123' as index id
        const content: string = parseIndex[1].toString();
        const json: any = JSON.parse(content);
        index.addRelPaths = new Set(json.adds);
        index.deleteRelPaths = new Set(json.deletes);
        index.processed = new Map(json.processed);
        parseIndexes.push(index);
      }
      return parseIndexes;
    });
  }

  /**
   * Mark files as modified or new for the new commit.
   * @param filepaths     Paths can be absolute or relative to `{workdir}`.
   */
  addFiles(filepaths: string[]) {
    this.throwIfNotValid();

    // filepaths can be absolute or relative to workdir
    for (const filepath of filepaths) {
      const relPath: string = isAbsolute(filepath) ? relative(this.repo.workdir(), filepath) : filepath;

      // if the file has already been processed from a previous 'index add .',
      // we don't need to do it again
      if (!this.processed.has(relPath)) {
        this.addRelPaths.add(relPath);
      }
    }
  }

  /**
   * Mark files as being deleted for the new commit.
   * @param filepaths     Paths can be absolute or relative to `{workdir}`.
   */
  deleteFiles(filepaths: string[]) {
    this.throwIfNotValid();

    // filepaths can be absolute or relative to workdir
    for (const filepath of filepaths) {
      const relPath: string = isAbsolute(filepath) ? relative(this.repo.workdir(), filepath) : filepath;

      if (!this.processed.has(relPath)) {
        this.deleteRelPaths.add(relPath);
      }
    }

    // TODO: Remove filepaths also from 'adds', in case 'deleteFiles' was called after 'addFiles'
  }

  /**
   * Hashes of files. Filled after [[Index.writeFiles]] has been called.
   */
  getProcessedMap(): Map<string, FileInfo> {
    this.throwIfNotValid();

    return this.processed;
  }

  /**
   * Write files to object database. Needed before a commit can be made.
   */
  writeFiles(): Promise<void> {
    this.throwIfNotValid();

    const ioContext = new IoContext();

    return ioContext.init()
      .then(async () => {
        const addRelPaths: string[] = difference(Array.from(this.addRelPaths), Array.from(this.deleteRelPaths));
        const absolutePaths: string[] = [];

        for (const relFilePath of addRelPaths) {
          if (!this.processed.has(relFilePath)) {
            const filepathAbs: string = join(this.repo.repoWorkDir, relFilePath);
            if (!filepathAbs.startsWith(this.repo.workdir())) {
              throw new Error(`file or directory not in workdir: ${relFilePath}`);
            }
            absolutePaths.push(filepathAbs);
          }
        }

        // Ensure that no file in the index is opened by another process
        // For more information, or to add comments visit https://github.com/Snowtrack/SnowFS/discussions/110
        if (process.platform === 'win32') {
          // On Windows, there is no known way to know if a file is opened by another process.
          // But renaming a file is current workaround, until `CreateFile` for a read-lock is implemented.

          let atLeastOneFileIsOpenInAnotherProcess: string = null;
          const renamed: string[] = [];

          // give each file a temporary name...
          for (const absolutePath of absolutePaths) {
            try {
              fse.renameSync(absolutePath, `${absolutePaths}.tmp_rename`);
              renamed.push(absolutePath);
            } catch (error) {
              atLeastOneFileIsOpenInAnotherProcess = absolutePath;
              continue;
            }
          }

          // ...rename each file back.
          for (const tmp of renamed) {
            try {
              fse.renameSync(`${tmp}.tmp_rename`, tmp);
            } catch (error) {
              continue;
            }
          }

          if (atLeastOneFileIsOpenInAnotherProcess) {
            throw new Error(`file '${atLeastOneFileIsOpenInAnotherProcess}' is opened by another process.`);
          }
        } else {
          const fileHandles: Map<string, posix.FileHandle[]> = await posix.whichFilesInDirAreOpen(this.repo.workdir());
          const errors: Error[] = [];
          for (const absolutePath of absolutePaths) {
            const fhs: posix.FileHandle[] = fileHandles.get(absolutePath);
            if (fhs) {
              for (const fh of fhs) {
                if (fh.lockType === posix.LOCKTYPE.READ_WRITE_LOCK_FILE
                  || fh.lockType === posix.LOCKTYPE.WRITE_LOCK_FILE
                  || fh.lockType === posix.LOCKTYPE.WRITE_LOCK_FILE_PART) {
                  errors.push(new StacklessError(`File '${relative(this.repo.workdir(), absolutePath)}' is locked by ${fh.processname}`));
                }
              }
            }
          }
          if (errors) {
            throw new AggregateError(errors);
          }
        }

        const promises = [];
        for (const absolutePath of absolutePaths) {
          promises.push(this.odb.writeObject(absolutePath, ioContext));
          let release: any;
          promises.push(
            lock(absolutePath)
              .then((releaseResult: any) => {
                release = releaseResult;
                return this.odb.writeObject(absolutePath, ioContext);
              }).finally(async () => {
                if (release) {
                  release();
                }
              }),
          );
        }

        return Promise.all(promises);
      })
      .then((value: {file: string, fileinfo: FileInfo}[]) => {
        ioContext.invalidate();

        // TODO: (Seb) Handle deleted files as well here
        for (const r of value) {
          this.processed.set(r.file, r.fileinfo);
        }
        return this.save();
      });
  }
}
