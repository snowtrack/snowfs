import * as fse from 'fs-extra';

import { difference } from 'lodash';

import { isAbsolute, join, relative } from 'path';
import { Commit } from './commit';
import { IoContext } from './io_context';
import { Odb } from './odb';
import { Repository } from './repository';
import { TreeFile } from './treedir';

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

  constructor(repo: Repository, odb: Odb) {
    this.repo = repo;
    this.odb = odb;
  }

  /** Hash map of hashes and files. Empty by default, and filled
   * after [[Index.writeFiles]] has been called and the hashes of the files have been calculated.
   */
  processed: Map<string, string> = new Map();

  /**
   * A set of filepaths of new files that will be part of the new commit.
   */
  adds: Set<string> = new Set();

  /**
   * A set of filepaths of new files that will be removed from the new commit.
   */
  deletes: Set<string> = new Set();

  /**
   * Reset the entire index object. Used internally after a commit has been created,
   * or can be useful to discard any added or deleted files from the index object.
   */
  async reset() {
    this.adds = new Set();
    this.deletes = new Set();
    this.processed.clear();

    const indexPath: string = join(this.repo.commondir(), 'INDEX');
    return fse.pathExists(indexPath).then((exists: boolean) => {
      if (exists) return fse.unlink(indexPath);
    });
  }

  /**
   * Store the index object to disk. Saved to {workdir}/.snowtrack/INDEX.
   */
  private async save() {
    const data: string = JSON.stringify({
      adds: this.adds,
      deletes: this.deletes,
      hashMap: this.processed,
    }, (key, value) => {
      if (value instanceof Map) {
        return Array.from(value.entries());
      } if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    });
    return fse.writeFile(join(this.repo.commondir(), 'INDEX'), data);
  }

  /**
   * Load a saved index object from `{workdir}/.snowtrack/INDEX`.
   * If the index wasn't saved before, the function does not fail.
   */
  async load() {
    const indexPath: string = join(this.repo.commondir(), 'INDEX');
    return fse.pathExists(indexPath).then((exists: boolean) => {
      if (exists) {
        return fse.readFile(indexPath).then((buf: Buffer) => {
          const content: string = buf.toString();
          const json: any = JSON.parse(content);
          this.adds = new Set(json.adds);
          this.deletes = new Set(json.deletes);
          this.processed = new Map(json.hashMap);
        });
      }
    });
  }

  /**
   * Mark files as modified or new for the new commit.
   * @param filepaths     Paths can be absolute or relative to `{workdir}`.
   */
  addFiles(filepaths: string[]) {
    // filepaths can be absolute or relative to workdir
    for (const filepath of filepaths) {
      const relPath: string = isAbsolute(filepath) ? relative(this.repo.workdir(), filepath) : filepath;
      // if the file has already been processed from a previous 'index add .',
      // we don't need to do it again
      if (!this.processed.has(relPath)) {
        this.adds.add(relPath);
      }
    }
  }

  /**
   * Mark files as being deleted for the new commit.
   * @param filepaths     Paths can be absolute or relative to `{workdir}`.
   */
  deleteFiles(filepaths: string[]) {
    // filepaths can be absolute or relative to workdir
    for (const filepath of filepaths) {
      const relPath: string = isAbsolute(filepath) ? relative(this.repo.workdir(), filepath) : filepath;
      if (!this.processed.has(relPath)) {
        this.deletes.add(relPath);
      }
    }

    // TODO: Remove filepaths also from 'adds', in case 'deleteFiles' was called after 'addFiles'
  }

  /**
   * Hashes of files. Filled after [[Index.writeFiles]] has been called.
   */
  getHashedIndexMap(): Map<string, string> {
    return this.processed;
  }

  /**
   * Write files to object database. Needed before a commit can be made.
   */
  async writeFiles(): Promise<void> {
    const ioContext = new IoContext();

    return ioContext.init()
      .then(() => {
        const promises = [];

        const adds: string[] = difference(Array.from(this.adds), Array.from(this.deletes));

        for (const filepath of adds) {
          const filepathAbs: string = isAbsolute(filepath) ? filepath : join(this.repo.repoWorkDir, filepath);
          if (!filepathAbs.startsWith(this.repo.workdir())) {
            throw new Error(`file or directory not in workdir: ${filepath}`);
          }
          promises.push(this.odb.writeObject(filepathAbs, ioContext));
        }

        return Promise.all(promises);
      })
      .then((value: {file: string, hash: string}[]) => {
        ioContext.invalidate();

        let hashMap: Map<string, string>;

        // the first commit doesn't have a hash at head
        if (this.repo.getHead().hash) {
          const checkedOutCommit: Commit = this.repo.getCommitByHead();
          const currentFiles = checkedOutCommit.root.getAllTreeFiles({
            entireHierarchy: true,
            includeDirs: false,
          }) as Map<string, TreeFile>;

          hashMap = new Map();
          currentFiles.forEach((file: TreeFile) => {
            hashMap.set(file.path, file.hash);
          });
        } else {
          hashMap = new Map();
        }

        // add/overwrite the hashes for the new added files
        for (const r of value) {
          hashMap.set(r.file.replace(/\\/g, '/'), r.hash);
        }

        this.processed = hashMap;
        return this.save();
      });
  }
}
