/* eslint-disable no-empty-function */
/* eslint-disable no-useless-constructor */
import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import { unionWith } from 'lodash';
import * as io from './io';

import {
  join, relative, normalize, extname, dirname,
} from './path';
import { Repository } from './repository';
import {
  FileInfo, getPartHash, HashBlock, MB20, StatsSubset,
} from './common';

export const enum FILEMODE {
  UNREADABLE = 0,
  TREE = 16384,
  BLOB = 33188,
  EXECUTABLE = 33261,
  LINK = 40960,
  COMMIT = 57344,
}

export const enum DETECTIONMODE {
  /**
   * Only perform a size and mktime check. If the modified time differs between the commited file
   * and the one in the working directory, the file is identified as modified.
   * If the modified time is the same, the file is not identified as modified.
   */
  ONLY_SIZE_AND_MKTIME = 1,

  /**
   * Perform a size and hash check for all files smaller than 20 MB.
   */
  SIZE_AND_HASH_FOR_SMALL_FILES = 2,

  /**
   * Perform a size and hash check for all files. Please note,
   * that this is the slowest of all detection modes.
   */
  SIZE_AND_HASH_FOR_ALL_FILES = 3
}

export abstract class TreeEntry {
  constructor(
    public hash: string,
    public path: string,
    public stats: StatsSubset,
  ) {
  }

  isDirectory(): boolean {
    return this instanceof TreeDir;
  }

  isFile(): boolean {
    return this instanceof TreeFile;
  }

  abstract clone(parent?: TreeDir);
}

export class TreeFile extends TreeEntry {
  constructor(
    hash: string,
    path: string,
    stats: StatsSubset,
    public ext: string,
    public parent: TreeDir,
  ) {
    super(hash, path, stats);
  }

  clone(parent?: TreeDir): TreeFile {
    return new TreeFile(this.hash, this.path, { ...this.stats }, this.ext, parent);
  }

  toString(): string {
    if (!this.parent && this.path) {
      throw new Error('parent has no path');
    } else if (this.parent && !this.path) {
      // only the root path with no parent has no path
      throw new Error('item must have path');
    }

    const output: any = {
      hash: this.hash,
      path: this.path,
      ext: this.ext,
      stats: {
        size: this.stats.size,
        ctimeMs: this.stats.ctimeMs,
        mtimeMs: this.stats.mtimeMs,
      },
    };
    return JSON.stringify(output);
  }

  isFileModified(repo: Repository, detectionMode: DETECTIONMODE): Promise<{file : TreeFile; modified : boolean, newStats: fse.Stats}> {
    const filepath = join(repo.workdir(), this.path);
    return io.stat(filepath).then((newStats: fse.Stats) => {
      // first we check for for modification time and file size
      if (this.stats.size !== newStats.size) {
        return { file: this, modified: true, newStats };
      }

      // When a commit is checked out, 'mtime' of restored items is set by fse.utimes.
      // The fractional part (microseconds) of mtime comes from JSON and might be
      // clamped (rounding errors). It's also not guaranteed that all filesystems support
      // microseconds. That's why all items are identified if the mtime from the commit
      // and the mtime from the file on disk is greater than 1ms, everything below is
      // considered equal.
      if (Math.abs(this.stats.mtimeMs - newStats.mtimeMs) >= 1.0) {
        switch (detectionMode) {
          case DETECTIONMODE.ONLY_SIZE_AND_MKTIME:
            return { file: this, modified: true, newStats };
          case DETECTIONMODE.SIZE_AND_HASH_FOR_SMALL_FILES:
            if (this.stats.size >= MB20) {
              return { file: this, modified: true, newStats };
            }
            break;
          case DETECTIONMODE.SIZE_AND_HASH_FOR_ALL_FILES:
          default:
            break;
        }

        return getPartHash(filepath)
          .then((hashBlock: HashBlock) => {
            return { file: this, modified: this.hash !== hashBlock.hash, newStats };
          });
      }

      return { file: this, modified: false, newStats };
    });
  }
}

export class TreeDir extends TreeEntry {
  static ROOT = undefined;

  hash: string;

  children: (TreeEntry)[] = [];

  constructor(public path: string,
              public stats: StatsSubset,
              public parent: TreeDir = null) {
    super('', path, stats);
  }

  static createRootTree(): TreeDir {
    return new TreeDir('', { size: 0, ctimeMs: 0, mtimeMs: 0 });
  }

  clone(parent?: TreeDir): TreeDir {
    const newTree = new TreeDir(this.path, { ...this.stats }, parent);
    newTree.children = this.children.map((c: TreeEntry) => c.clone(newTree));
    return newTree;
  }

  /**
   * Merge two trees, with target having the precedence in case
   * the element is already located in 'source.
   */
  static mergeTrees(source: TreeEntry, target: TreeEntry) {
    function calculateSizeAndHash(items: TreeEntry[]): [number, string] {
      const hash = crypto.createHash('sha256');
      let size = 0;
      for (const r of items) {
        size += r.stats.size;
        hash.update(r.hash.toString());
      }
      target.stats.size = size;
      return [size, hash.digest('hex')];
    }

    function privateMergeTrees(source: TreeEntry, target: TreeEntry) {
      if (source instanceof TreeDir && target instanceof TreeDir) {
        let children = [];
        source.children.forEach((s: TreeEntry) => {
          target.children.forEach((t: TreeEntry) => {
            if (s.path === t.path) {
              children = children.concat(this.mergeTrees(s, t));
            }
          });
        });

        // Update each items size and hash
        const calcs = calculateSizeAndHash(target.children);
        target.stats.size = calcs[0];
        target.hash = calcs[1];

        // first arg has precedence, so in this case target
        return unionWith(target.children, source.children, (a: TreeEntry, b: TreeEntry) => {
          return a.path === b.path;
        });
      }

      if (target instanceof TreeDir) {
        return [...target.children]; // target has precedence
      }
      return [target];
    }

    const root = TreeDir.createRootTree();
    const children = privateMergeTrees(source, target);
    const calcs = calculateSizeAndHash(children);
    root.stats.size = calcs[0];
    root.hash = calcs[1];
    return root;
  }

  toString(includeChildren?: boolean): string {
    if (!this.parent && this.path) {
      throw new Error('parent has no path');
    } else if (this.parent && (!this.path || this.path.length === 0)) {
      // only the root path with no parent has no path
      throw new Error('item must have path');
    }

    const children: string[] = this.children.map((value: TreeDir | TreeFile) => value.toString(includeChildren));
    const stats = JSON.stringify(this.stats);
    return `{"hash": "${this.hash.toString()}", "path": "${this.path ?? ''}", "stats": ${stats}, "children": [${children.join(',')}]}`;
  }

  getAllTreeFiles(opt: {entireHierarchy: boolean, includeDirs: boolean}): Map<string, TreeEntry> {
    const visit = (obj: TreeEntry[] | TreeEntry, map: Map<string, TreeEntry>) => {
      if (Array.isArray(obj)) {
        return obj.forEach((c: any) => visit(c, map));
      }
      if (obj instanceof TreeDir) {
        if (opt.includeDirs) {
          map.set(obj.path, obj);
        }
        return (obj as TreeDir).children.forEach((c: any) => visit(c, map));
      }
      map.set(obj.path, obj);
    };

    const map: Map<string, TreeEntry> = new Map();

    if (opt.entireHierarchy) {
      visit(this.children, map);
    } else {
      this.children.forEach((o: TreeDir | TreeFile) => {
        if (o instanceof TreeFile || opt.entireHierarchy) {
          map.set(o.path, o);
        }
      });
    }
    return map;
  }

  find(relativePath: string): TreeEntry | null {
    if (relativePath === this.path) {
      return this;
    }

    let tree: TreeEntry | null = null;
    // TODO: (Seb) return faster if found
    TreeDir.walk(this, (entry: TreeDir | TreeFile) => {
      if (entry.path === relativePath) {
        tree = entry;
      }
    });
    return tree;
  }

  /**
   * Browse through the entire hierarchy of the tree and remove the given file.
   * Doesn't throw an error if the element is not found.
   *
   * @param relativePath      The relative file path to remove.
   */
  remove(relativePath: string): void {
    function privateDelete(
      tree: TreeDir,
      cb: (entry: TreeEntry, index: number, length: number) => boolean,
    ) {
      let i = 0;

      for (const entry of tree.children) {
        if (cb(entry, i, tree.children.length)) {
          tree.children.splice(i, 1);
          return;
        }
        if (entry.isDirectory()) {
          privateDelete(entry as TreeDir, cb);
        }
        i++;
      }
    }

    // TODO: (Seb) return faster if found
    privateDelete(this, (entry: TreeEntry): boolean => {
      if (entry.path === relativePath) {
        return true;
      }
    });
  }

  static walk(
    tree: TreeDir,
    cb: (entry: TreeDir | TreeFile, index: number, length: number) => void,
  ): void {
    let i = 0;
    for (const entry of tree.children) {
      cb(<TreeFile>entry, i, tree.children.length);
      if (entry.isDirectory()) {
        TreeDir.walk(entry as TreeDir, cb);
      }
      i++;
    }
  }
}
// This function has the same basic functioanlity as io.osWalk(..) but works with Tree
export function constructTree(
  dirPath: string,
  tree?: TreeDir,
  root?: string,
): Promise<TreeDir> {
  if (dirPath.endsWith('/')) {
    // if directory ends with a seperator, we cut it of to ensure
    // we don't return a path like /foo/directory//file.jpg
    dirPath = dirPath.substr(0, dirPath.length - 1);
  }

  if (!root) {
    root = dirPath;
  }

  if (!tree) {
    tree = TreeDir.createRootTree();
  }

  return new Promise<string[]>((resolve, reject) => {
    io.readdir(dirPath, (error, entries: string[]) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(entries.map(normalize));
    });
  })
    .then((entries: string[]) => {
      const promises: Promise<any>[] = [];

      for (const entry of entries) {
        if (entry === '.snow' || entry === '.git' || entry === '.DS_Store' || entry === 'thumbs.db') {
          continue;
        }

        const absPath = `${dirPath}/${entry}`;
        const relPath = relative(root, absPath);
        promises.push(
          io.stat(absPath).then((stat: fse.Stats) => {
            if (stat.isDirectory()) {
              // hash is later added to subtree (see next promise task)
              const subtree: TreeDir = new TreeDir(
                relative(root, absPath),
                {
                  ctimeMs: stat.ctimeMs,
                  mtimeMs: stat.mtimeMs,
                  size: stat.size,
                },
                tree,
              );

              tree.children.push(subtree);
              return constructTree(absPath, subtree, root);
            }

            const entry: TreeFile = new TreeFile('',
              relPath, {
                size: stat.size,
                ctimeMs: stat.ctimeMs,
                mtimeMs: stat.mtimeMs,
              }, extname(relPath), tree);
            tree.children.push(entry);
          }),
        );
      }

      return Promise.all(promises);
    })
    .then(() => {
      // assign the parent 'tree' a hash of all its children
      // and calculate their size
      const hash = crypto.createHash('sha256');
      let size = 0;
      for (const r of tree.children) {
        size += r.stats.size;
        hash.update(r.hash.toString());
      }
      tree.stats.size = size;
      tree.hash = hash.digest('hex');
      return tree;
    });
}
