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

  /**
   * A temporary variable, which holds the value if the list of files have been written to disk or not.
   */
  filesWritten: boolean = false;

  /** Hash map of hashes and files. Empty by default, and filled
   * after [[Index.writeFiles]] has been called and the hashes of the files have been calculated.
   */
  hashMap: Map<string, string> = new Map();

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
    this.filesWritten = false;
    this.adds = new Set();
    this.deletes = new Set();
    this.hashMap.clear();

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
      filesWritten: this.filesWritten,
      adds: this.adds,
      deletes: this.deletes,
      hashMap: this.hashMap,
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
          this.filesWritten = json.filesWritten;
          this.adds = new Set(json.adds);
          this.deletes = new Set(json.deletes);
          this.hashMap = new Map(json.hashMap);
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
      this.adds.add(relPath);
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

      // TODO: (Seb) if filepath is absolute throw exception
      // Currently checked in writeFiles but prefer to catch this early on
      this.deletes.add(relPath);
    }

    // TODO: Remove filepaths also from 'adds', in case 'deleteFiles' was called after 'addFiles'
  }

  /**
   * Hashes of files. Filled after [[Index.writeFiles]] has been called.
   */
  getHashedIndexMap(): Map<string, string> {
    return this.hashMap;
  }

  /**
   * Write files to object database. Needed before a commit can be made.
   */
  async writeFiles(): Promise<void> {
    if (this.filesWritten) {
      throw new Error('files were already written to disk');
    }

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

        this.hashMap = hashMap;
        this.filesWritten = true;
        return this.save();
      });
  }
}
