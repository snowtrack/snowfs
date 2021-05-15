import * as fse from 'fs-extra';

import { difference } from 'lodash';
import {
  isAbsolute, join, relative, basename,
} from './path';
import * as io from './io';
import * as fss from './fs-safe';
import { IoContext, TEST_IF } from './io_context';
import { Odb } from './odb';
import { Repository } from './repository';
import { DirItem, OSWALK, osWalk } from './io';
import { FileInfo } from './common';

// eslint-disable-next-line import/order
import PromisePool = require('@supercharge/promise-pool');
/**
 * Used in [[Index.writeFiles]]. Used to control certain behaviours
 * when files are written to disk.
 */
export enum WRITE {
  NONE = 0,
  /**
   * By default filelocks are checked to ensure none of the given files
   * is written by another process. Using this flag skips this check.
   */
  SKIP_FILELOCK_CHECKS = 1
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
  processedFiles = new Map<string, FileInfo>();

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
    if (this.repo) {
      // check if index exists, this can be false if the commit has no files (--allowEmpty)
      return io.pathExists(this.getAbsPath()).then((exists: boolean) => {
        if (exists) { return fse.unlink(this.getAbsPath()); }
      }).then(() => {
        this.repo.removeIndex(this);

        this.addRelPaths = new Set();
        this.deleteRelPaths = new Set();
        this.processedFiles.clear();
        this.id = undefined;
        this.repo = null;
        this.odb = null;
      });
    }
  }

  /**
   * Ensure the index is valid. After a commit is created, the index file will be
   * deleted and this object will be invalidated and shouldn't be used anymore
   *
   * @throws Throws an exception if Index.invalidate() got called before.
   */
  throwIfNotValid(): void {
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
      processed: this.processedFiles,
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
        index.processedFiles = new Map(json.processed);
        parseIndexes.push(index);
      }
      return parseIndexes;
    });
  }

  /**
   * Mark files as modified or new for the new commit.
   * @param filepaths     Paths can be absolute or relative to `{workdir}`.
   */
  addFiles(filepaths: string[]): void {
    this.throwIfNotValid();

    // filepaths can be absolute or relative to workdir
    for (const filepath of filepaths) {
      const relPath: string = isAbsolute(filepath) ? relative(this.repo.workdir(), filepath) : filepath;

      // if the file has already been processed from a previous 'index add .',
      // we don't need to do it again
      if (!this.processedFiles.has(relPath)) {
        this.addRelPaths.add(relPath);
      }
    }
  }

  /**
   * Mark files as being deleted for the new commit.
   * @param filepaths     Paths can be absolute or relative to `{workdir}`.
   */
  deleteFiles(filepaths: string[]): void {
    this.throwIfNotValid();

    // filepaths can be absolute or relative to workdir
    for (const filepath of filepaths) {
      const relPath: string = isAbsolute(filepath) ? relative(this.repo.workdir(), filepath) : filepath;

      if (!this.processedFiles.has(relPath)) {
        this.deleteRelPaths.add(relPath);
      }
    }

    // TODO: Remove filepaths also from 'adds', in case 'deleteFiles' was called after 'addFiles'
  }

  /**
   * Hashes of files. Filled after [[Index.writeFiles]] has been called.
   */
  getFileProcessedMap(): Map<string, FileInfo> {
    this.throwIfNotValid();

    return this.processedFiles;
  }

  /**
   * Write files to object database. Needed before a commit can be made.
   */
  writeFiles(flags: WRITE = WRITE.NONE): Promise<void> {
    this.throwIfNotValid();

    const ioContext = new IoContext();

    let unprocessedRelItems: string[] = [];

    return ioContext.init()
      .then(() => {
        const relPaths: string[] = difference(Array.from(this.addRelPaths), Array.from(this.deleteRelPaths));

        unprocessedRelItems = relPaths.filter((p: string) => !this.processedFiles.has(p));

        if (flags & WRITE.SKIP_FILELOCK_CHECKS) {
          return Promise.resolve();
        }
        return ioContext.performFileAccessCheck(this.repo.workdir(), unprocessedRelItems, TEST_IF.FILE_CAN_BE_READ_FROM);
      }).then(() => {
        return PromisePool
          .withConcurrency(32)
          .for(unprocessedRelItems)
          .handleError((error) => { throw error; }) // Uncaught errors will immediately stop PromisePool
          .process((relFilePath: string) => {
            const filepathAbs: string = join(this.repo.repoWorkDir, relFilePath);
            return this.odb.writeObject(filepathAbs, ioContext);
          });
      })
      .then((res: {results: {file: string, fileinfo: FileInfo}[]}) => {
        ioContext.invalidate();

        // TODO: (Seb) Handle deleted files as well here
        for (const r of res.results) {
          this.processedFiles.set(r.file, r.fileinfo);
        }
        return this.save();
      });
  }
}
