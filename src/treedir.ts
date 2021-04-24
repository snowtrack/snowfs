/* eslint-disable no-empty-function */
/* eslint-disable no-useless-constructor */
import * as fse from 'fs-extra';
import * as crypto from 'crypto';

import {
  join, relative, normalize, extname,
} from './path';
import { Repository } from './repository';
import {
  FileInfo, getPartHash, HashBlock, MB20,
} from './common';

export const enum FILEMODE {
  UNREADABLE = 0,
  TREE = 16384,
  BLOB = 33188,
  EXECUTABLE = 33261,
  LINK = 40960,
  COMMIT = 57344,
}

export class TreeEntry {
  constructor(
    public hash: string,
    public path: string,
  ) {
  }

  isDirectory(): boolean {
    return this instanceof TreeDir;
  }

  isFile(): boolean {
    return this instanceof TreeFile;
  }

  getItemDesc(): string {
    if (this.isDirectory()) {
      return "Directory";
    } else {
      return "File";
    }
  }
}

export class TreeFile extends TreeEntry {
  constructor(
    hash: string,
    public ext: string,
    public parent: TreeDir,
    path: string,
    public ctime: number,
    public mtime: number,
    public size: number,
  ) {
    super(hash, path);
  }

  toString(): string {
    if (!this.parent && this.path) {
      throw new Error('parent has no path');
    } else if (this.parent && !this.path) {
      // only the root path with no parent has no path
      throw new Error('item must have path');
    }

    const hash: string = this.hash.toString();
    const { ctime } = this;
    const { mtime } = this;
    const { size } = this;
    const { ext } = this;
    const path: string = this.path;
    const output: any = {
      ext, hash, ctime, mtime, size, path,
    };
    return JSON.stringify(output);
  }

  isFileModified(repo: Repository): Promise<{file : TreeFile; modified : boolean}> {
    const filepath = join(repo.workdir(), this.path);
    return fse.stat(filepath).then((value: fse.Stats) => {
      // first we check for for modification time and file size
      if (this.size !== value.size) {
        return { file: this, modified: true };
      }
      if (this.mtime !== value.mtime.getTime()) {
        // we hash compare every file that is smaller than 20 MB
        // Every file that is bigger than 20MB should better differ
        // in size to reflect a correct modification, otherwise
        // we simply present it as modified because it will be determined
        // when the user commits where we have more time for this
        if (this.size < MB20) {
          return getPartHash(filepath).then((hashBlock: HashBlock) => ({ file: this, modified: this.hash !== hashBlock.hash }));
        }

        return { file: this, modified: true };
      }

      return { file: this, modified: false };
    });
  }
}

export class TreeDir extends TreeEntry {
  static ROOT = undefined;

  hash: string;

  children: (TreeEntry)[] = [];

  constructor(public path: string | undefined, public parent: TreeDir = null) {
    super(undefined, path);
  }

  toString(includeChildren?: boolean): string {
    const children: string[] = this.children.map((value: TreeDir | TreeFile) => value.toString(includeChildren));
    return `{"hash": "${this.hash.toString()}", "path": "${this.path ?? ''}", "children": [${children.join(',')}]}`;
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

    const tree: TreeEntry| null = null;
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
  ) {
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
  processed: Map<string, FileInfo>,
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
    tree = new TreeDir(undefined);
  }

  return new Promise<string[]>((resolve, reject) => {
    fse.readdir(dirPath, (error, entries: string[]) => {
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
        if (entry === '.snow' || entry === '.git') {
          continue;
        }

        const absPath = `${dirPath}/${entry}`;
        promises.push(
          fse.stat(absPath).then((stat: fse.Stats) => {
            if (stat.isDirectory()) {
              const subtree: TreeDir = new TreeDir(
                relative(root, absPath),
                tree,
              );
              tree.children.push(subtree);
              return constructTree(absPath, processed, subtree, root);
            }
            const fileinfo: FileInfo | null = processed?.get(relative(root, absPath));
            if (fileinfo) {
              const path: string = relative(root, absPath);
              const entry: TreeFile = new TreeFile(fileinfo.hash, extname(path), tree, path, stat.ctime.getTime(), stat.mtime.getTime(), stat.size);
              tree.children.push(entry);
            } else {
              // console.warn(`No hash for ${absPath}`);
            }
          }),
        );
      }

      return Promise.all(promises);
    })
    .then(() => {
      // update all parents id hash with their children ids
      const hash = crypto.createHash('sha256');
      for (const r of tree.children) {
        hash.update(r.hash.toString());
      }
      tree.hash = hash.digest('hex');
      return tree;
    });
}
