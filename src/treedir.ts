/* eslint-disable no-empty-function */
/* eslint-disable no-useless-constructor */
import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import { unionWith } from 'lodash';
import * as io from './io';

import {
  join, relative, normalize, extname, dirname, basename,
} from './path';
import { Repository } from './repository';
import {
  getPartHash, HashBlock, MB20, StatsSubset,
} from './common';

const sortPaths = require('sort-paths');

export const enum FILEMODE {
  UNREADABLE = 0,
  TREE = 16384,
  BLOB = 33188,
  EXECUTABLE = 33261,
  LINK = 40960,
  COMMIT = 57344,
}

const textFileExtensions = new Set([
  '.txt', '.html', '.plist', '.htm', '.css', '.js',
  '.jsx', '.less', '.scss', '.wasm', '.php', '.c',
  '.cc', '.class', '.clj', '.cpp', '.cs', '.cxx',
  '.el', '.go', '.h', '.java', '.lua', '.m', '.m4',
  '.php', '.pl', '.po', '.py', '.rb', '.rs',
  '.sh', '.swift', '.vb', '.vcxproj', '.xcodeproj',
  '.xml', '.diff', '.patch', '.html', '.js', '.ts',
]);

export const enum DETECTIONMODE {
  /**
   * Uses SIZE_AND_HASH_FOR_SMALL_FILES for all known text files and ONLY_SIZE_AND_MKTIME for everything else.
   */
  DEFAULT = 1,

  /**
   * Only perform a size and mktime check. If the modified time differs between the commited file
   * and the one in the working directory, the file is identified as modified.
   * If the modified time is the same, the file is not identified as modified.
   */
  ONLY_SIZE_AND_MKTIME = 2,

  /**
   * Perform a size and hash check for all files smaller than 20 MB.
   */
  SIZE_AND_HASH_FOR_SMALL_FILES = 3,

  /**
   * Perform a size and hash check for all files. Please note,
   * that this is the slowest of all detection modes.
   */
  SIZE_AND_HASH_FOR_ALL_FILES = 4
}

export function calculateSizeAndHash(items: TreeEntry[]): [number, string] {
  const hash = crypto.createHash('sha256');
  let size = 0;

  // Here we ensure that the hash of the tree entries is not dependend on their order
  items = sortPaths(items, (item) => item.path, '/');

  for (const r of items) {
    size += r.stats.size;
    hash.update(r.hash.toString());
  }
  return [size, hash.digest('hex')];
}

function generateSizeAndCaches(item: TreeEntry): [number, string] {
  if (item instanceof TreeDir) {
    for (const subitem of item.children) {
      if (subitem instanceof TreeDir) {
        generateSizeAndCaches(subitem);
      }
    }

    const calcs = calculateSizeAndHash(item.children);
    item.stats.size = calcs[0];
    item.hash = calcs[1];
    return [calcs[0], calcs[1]];
  }

  return [item.stats.size, item.hash];
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
    return new TreeFile(this.hash,
      this.path, StatsSubset.clone(this.stats), this.ext, parent);
  }

  toJsonObject(): any {
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
        ctime: this.stats.ctime.getTime(),
        mtime: this.stats.mtime.getTime(),
      },
    };
    return output;
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
      if (Math.abs(+this.stats.mtime - (+newStats.mtime)) >= 1.0) {
        switch (detectionMode) {
          case DETECTIONMODE.DEFAULT:
            const ext = extname(filepath);
            // Text files are more prone to mtime changes than other files,
            // so by default text files are checked for content changes than rather relying only on mtime.
            if (!textFileExtensions.has(ext)) {
              // If not a text file, use same heuristics as ONLY_SIZE_AND_MKTIME
              return { file: this, modified: true, newStats };
            }
            // If a text file, fallthrough to SIZE_AND_HASH_FOR_SMALL_FILES

          case DETECTIONMODE.SIZE_AND_HASH_FOR_SMALL_FILES:
            // A file bigger than 20 MB is considered as changed if the mtime is different ...
            if (this.stats.size >= MB20) {
              return { file: this, modified: true, newStats };
            }
            // ... otherwise break and check the file hash.
            break;
          case DETECTIONMODE.ONLY_SIZE_AND_MKTIME:
            return { file: this, modified: true, newStats };
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
    return new TreeDir('', { size: 0, ctime: new Date(0), mtime: new Date(0) });
  }

  clone(parent?: TreeDir): TreeDir {
    const newTree = new TreeDir(this.path, StatsSubset.clone(this.stats), parent);
    newTree.children = this.children.map((c: TreeEntry) => c.clone(newTree));
    return newTree;
  }

  /**
   * Merge two trees, with target having the precedence in case
   * the element is already located in 'source.
   */
  static merge(source: TreeEntry, target: TreeEntry) {
    function privateMerge(source: TreeEntry, target: TreeEntry) {
      // walk source nodes...
      if (source instanceof TreeDir && target instanceof TreeDir) {
        const newItems = new Map<string, TreeEntry>();
        for (const child of source.children) {
          newItems.set(child.path, child);
        }

        for (const child of target.children) {
          newItems.set(child.path, child);
        }

        for (const sourceItem of source.children) {
          for (const targetItem of target.children) {
            if (targetItem.path === sourceItem.path) {
              const res = privateMerge(sourceItem, targetItem);
              newItems.set(res.path, res);
            }
          }
        }
        target.children = Array.from(newItems.values());

        const calcs = generateSizeAndCaches(target);
        target.stats.size = calcs[0];
        target.hash = calcs[1];
      }
      return target;
    }

    return privateMerge(source, target.clone()) as TreeDir;
  }

  toJsonObject(includeChildren?: boolean): any {
    if (!this.parent && this.path) {
      throw new Error('parent has no path');
    } else if (this.parent && (!this.path || this.path.length === 0)) {
      // only the root path with no parent has no path
      throw new Error('item must have path');
    }

    const children: string[] = this.children.map((value: TreeDir | TreeFile) => value.toJsonObject(includeChildren));

    const stats: any = {
      size: this.stats.size,
      ctime: this.stats.ctime.getTime(),
      mtime: this.stats.mtime.getTime(),
    };

    return {
      hash: this.hash, path: this.path ?? '', stats, children,
    };
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
        return obj.children.forEach((c: any) => visit(c, map));
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
   * Browse through the entire hierarchy of the tree and remove the given item.
   */
  static remove(tree: TreeDir,
    cb: (entry: TreeEntry, index: number, array: TreeEntry[]) => boolean): void {
    for (const child of tree.children) {
      if (child instanceof TreeDir) {
        TreeDir.remove(child, cb);
      }
    }
    tree.children = tree.children.filter((value: TreeEntry, index: number, array: TreeEntry[]) => !cb(value, index, array));
  }

  static walk(
    tree: TreeDir,
    cb: (entry: TreeDir | TreeFile, index: number, length: number) => void,
  ): void {
    let i = 0;
    for (const entry of tree.children) {
      cb(<TreeFile>entry, i, tree.children.length);
      if (entry instanceof TreeDir) {
        TreeDir.walk(entry, cb);
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
              const subtree: TreeDir = new TreeDir(relative(root, absPath), StatsSubset.clone(stat), tree);

              tree.children.push(subtree);
              return constructTree(absPath, subtree, root);
            }

            const entry: TreeFile = new TreeFile('', relPath, StatsSubset.clone(stat), extname(relPath), tree);
            tree.children.push(entry);
          }),
        );
      }

      return Promise.all(promises);
    })
    .then(() => {
      // calculate the size of the directory
      let size = 0;
      for (const r of tree.children) {
        size += r.stats.size;
      }
      tree.stats.size = size;
      return tree;
    });
}
