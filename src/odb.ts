import * as crypto from 'crypto';
import * as fse from 'fs-extra';
import * as fs from 'fs';

import {
  basename, join, dirname, relative, extname,
} from './path';
import {
  DirItem, OSWALK, osWalk, zipFile,
} from './io';
import * as io from './io';
import * as fss from './fs-safe';

import { Repository, RepositoryInitOptions } from './repository';
import { Commit } from './commit';
import { Reference } from './reference';
import {
  calculateFileHash, FileInfo, HashBlock, StatsSubset,
} from './common';
import { TreeDir, TreeFile } from './treedir';
import { IoContext } from './io_context';

const defaultConfig: any = {
  version: 2,
  filemode: false,
  symlinks: true,
};

/**
 * A class representing the internal database of a `SnowFS` repository.
 * The class offers accessibility functions to read or write from the database.
 * Some functions are useful in a variety of contexts, where others are mostly
 * used when a repository is opened or initialized.
 */
export class Odb {
  config: any;

  repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  static open(repo: Repository): Promise<Odb> {
    const odb: Odb = new Odb(repo);
    return fse.readFile(join(repo.commondir(), 'config')).then((buf: Buffer) => {
      odb.config = JSON.parse(buf.toString());
      if (odb.config.version === 1) {
        throw new Error(`repository version ${odb.config.version} is not supported`);
      }
      return odb;
    });
  }

  static create(repo: Repository, options: RepositoryInitOptions): Promise<Odb> {
    const odb: Odb = new Odb(repo);
    return io.pathExists(options.commondir)
      .then((exists: boolean) => {
        if (exists) {
          throw new Error('directory already exists');
        }
        return io.ensureDir(options.commondir);
      })
      .then(() => io.ensureDir(join(options.commondir, 'objects')))
      .then(() => io.ensureDir(join(options.commondir, 'versions')))
      .then(() => io.ensureDir(join(options.commondir, 'hooks')))
      .then(() => io.ensureDir(join(options.commondir, 'refs')))
      .then(() => {
        odb.config = { ...defaultConfig };

        let config = { ...defaultConfig };
        if (options.additionalConfig) {
          config = Object.assign(config, { additionalConfig: options.additionalConfig });
        }

        return fse.writeFile(join(options.commondir, 'config'), JSON.stringify(config));
      })
      .then(() => odb);
  }

  readCommits(): Promise<Commit[]> {
    const objectsDir: string = join(this.repo.options.commondir, 'versions');
    return osWalk(objectsDir, OSWALK.FILES)
      .then((value: DirItem[]) => {
        const promises = [];
        for (const ref of value) {
          promises.push(fse.readFile(ref.absPath).then((buf: Buffer) => JSON.parse(buf.toString())));
        }
        return Promise.all(promises);
      })
      .then((commits: any) => {
        const visit = (obj: any[]|any, parent: TreeDir) => {
          if (Array.isArray(obj)) {
            return obj.map((c: any) => visit(c, parent));
          }

          if (obj.stats) {
            // backwards compatibility because item was called cTimeMs before
            if (obj.stats.ctimeMs) {
              obj.stats.ctime = obj.stats.cTimeMs;
            }

            // backwards compatibility because item was called mtimeMs before
            if (obj.stats.mtimeMs) {
              obj.stats.mtime = obj.stats.mtimeMs;
            }

            obj.stats.mtime = new Date(obj.stats.mtime);
            obj.stats.ctime = new Date(obj.stats.ctime);
          }

          if (obj.children) {
            const o: TreeDir = Object.setPrototypeOf(obj, TreeDir.prototype);
            o.children = obj.children.map((t: any) => visit(t, o));
            o.parent = parent;
            return o;
          }

          const o: TreeFile = Object.setPrototypeOf(obj, TreeFile.prototype);
          o.parent = parent;
          if (obj.hash) {
            o.hash = obj.hash;
          }
          return o;
        };

        return commits.map((commit: any) => {
          const tmpCommit = commit;

          tmpCommit.date = new Date(tmpCommit.date); // convert number from JSON into date object
          const c: Commit = Object.setPrototypeOf(tmpCommit, Commit.prototype);
          c.repo = this.repo;
          c.root = visit(c.root, null);
          return c;
        });
      });
  }

  readReference(ref: DirItem): Promise<{ref: DirItem, content: string}> {
    const refPath = ref.absPath;
    return fse.readFile(refPath)
      .then((buf: Buffer) => {
        try {
          return { ref, content: JSON.parse(buf.toString()) };
        } catch (error) {
          console.log('Error');
          return null;
        }
      });
  }

  readReferences(): Promise<Reference[]> {
    type DirItemAndReference = { ref: DirItem; content : any };

    const refsDir: string = join(this.repo.options.commondir, 'refs');

    return osWalk(refsDir, OSWALK.FILES)
      .then((value: DirItem[]) => {
        const promises = [];
        for (const ref of value) {
          promises.push(this.readReference(ref));
        }
        return Promise.all(promises);
      })
      .then((ret: DirItemAndReference[] | null): Reference[] => ret.filter((x) => !!x).map((ret: DirItemAndReference | null) => {
        const opts = {
          hash: ret.content.hash,
          start: ret.content.start,
          userData: ret.content.userData,
        };
        return new Reference(ret.content.type, basename(ret.ref.absPath), this.repo, opts);
      }))
      .then((refsResult: Reference[]) => refsResult);
  }

  deleteReference(ref: Reference): Promise<void> {
    const refsDir: string = join(this.repo.options.commondir, 'refs');
    // writing a head to disk means that either the name of the ref is stored or the hash in case the HEAD is detached
    return fse.unlink(join(refsDir, ref.getName()))
      .then(() => this.repo.modified());
  }

  writeHeadReference(head: Reference): Promise<void> {
    const refsDir: string = this.repo.options.commondir;
    // writing a head to disk means that either the name of the ref is stored or the hash in case the HEAD is detached
    return fss.writeSafeFile(join(refsDir, 'HEAD'), head.getName() === 'HEAD' ? head.hash : head.getName())
      .then(() => this.repo.modified());
  }

  readHeadReference(): Promise<string | null> {
    const refsDir: string = this.repo.options.commondir;
    return fse.readFile(join(refsDir, 'HEAD'))
      .then((buf: Buffer) => buf.toString())
      .catch((error) => {
        console.log('No HEAD found');
        return null;
      });
  }

  getAbsObjectPath(file: TreeFile): string {
    const objects: string = join(this.repo.options.commondir, 'objects');
    return join(objects, file.hash.substr(0, 2), file.hash.substr(2, 2), file.hash.toString() + extname(file.path));
  }

  getObjectByHash(hash: string, extname: string): Promise<fse.Stats> {
    const objects: string = join(this.repo.options.commondir, 'objects');
    const object = join(objects, hash.substr(0, 2), hash.substr(2, 2), hash.toString() + extname);
    return io.stat(object)
      .catch(() => null); // if the file is not available, we return null
  }

  writeReference(ref: Reference): Promise<void> {
    const refsDir: string = join(this.repo.options.commondir, 'refs');

    if (ref.isDetached()) {
      console.warn('Was about to write HEAD ref to disk');
      return;
    }

    if (!ref.hash) {
      throw new Error(`hash value of ref is ${ref.hash}`);
    }

    const refPath = join(refsDir, ref.getName());

    return fss.writeSafeFile(refPath, JSON.stringify({
      hash: ref.hash,
      type: ref.type,
      start: ref.startHash ? ref.startHash : undefined,
      userData: ref.userData ?? {},
    })).then(() => this.repo.modified());
  }

  writeCommit(commit: Commit): Promise<void> {
    const objectsDir: string = join(this.repo.options.commondir, 'versions');
    const commitSha256: string = commit.hash;
    const dstFile: string = join(objectsDir, commitSha256);

    // json content
    const parent = commit.parent ? commit.parent : null;
    const root = commit.root.toJsonObject(true);
    const tags = commit.tags?.length > 0 ? commit.tags : undefined;
    const userData = commit.userData && Object.keys(commit.userData).length > 0 ? commit.userData : undefined;

    const stream = fse.createWriteStream(dstFile, { flags: 'w' });
    const content = JSON.stringify({
      hash: commit.hash,
      message: commit.message,
      date: commit.date.getTime(),
      parent,
      root,
      tags,
      userData,
    }, null, '\t');
    stream.write(content);

    return new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
      stream.end();
    }).then(() => this.repo.modified());
  }

  writeObject(filepath: string, ioContext: IoContext): Promise<{file: string, fileinfo: FileInfo}> {
    const tmpFilename: string = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex');
    const objects: string = join(this.repo.options.commondir, 'objects');
    const tmpDir: string = join(this.repo.options.commondir, 'tmp');
    const tmpPath: string = join(tmpDir, tmpFilename);

    let dstFile: string;
    let filehash: string;
    let hashBlocks: HashBlock[];

    // Important, first copy the file, then compute the hash of the cloned file.
    // In that order we prevent race conditions of file changes between the hash
    // computation and the file that ends up in the odb.

    return fse.ensureDir(tmpDir, {}).then(() => ioContext.copyFile(filepath, tmpPath)).then(() => calculateFileHash(filepath))
      .then((res: {filehash: string, hashBlocks?: HashBlock[]}) => {
        filehash = res.filehash;
        hashBlocks = res.hashBlocks;
        dstFile = join(objects, filehash.substr(0, 2), filehash.substr(2, 2), filehash.toString() + extname(filepath));
        return io.pathExists(dstFile);
      })
      .then((exists: boolean) => {
        if (exists) {
          // if dst already exists, we don't need the source anymore
          return fse.remove(tmpPath);
        }

        if (this.repo.options.compress) {
          return zipFile(tmpPath, dstFile, { deleteSrc: true });
        }

        return fse.move(tmpPath, dstFile, { overwrite: false })
          .catch((error) => {
            // the error message below is thrown, especially on Windows if
            // several files that are commited have the same fingerprint hash.
            // This leads to the same dstFile, and despite 'overwrite:false',
            // concurrent write operations might make this function fail, so
            // we can safely ignore it
            if (!error.message.startsWith('dest already exists')
                && !error.message.startsWith('EPERM: operation not permitted, rename')) {
              throw error;
            }
          });
      })
      .then(() => {
        if (hashBlocks) {
          const content: string = hashBlocks.map((block: HashBlock) => `${block.start};${block.end};${block.hash};`).join('\n');
          return fss.writeSafeFile(`${dstFile}.hblock`, content);
        }
        return Promise.resolve();
      })
      .then(() => io.stat(filepath)
        .then((stat: fse.Stats) => ({
          file: relative(this.repo.repoWorkDir, filepath),
          fileinfo: {
            ext: extname(filepath),
            hash: filehash,
            stat: StatsSubset.clone(stat),
          },
        })))
      .then((res) => this.repo.modified(res));
  }

  readObject(file: TreeFile, dstAbsPath: string, ioContext: IoContext): Promise<void> {
    const hash: string = file.hash;
    const objectFile: string = this.getAbsObjectPath(file);

    return io.pathExists(objectFile)
      .then((exists: boolean) => {
        if (!exists) {
          throw new Error(`object ${hash} not found`);
        }

        return io.ensureDir(dirname(dstAbsPath));
      }).then(() => {
        return ioContext.copyFile(objectFile, dstAbsPath);
      }).then(() => {
        // atime will be set as mtime because thats the time we accessed the file
        return io.utimes(dstAbsPath, file.stats.mtime, file.stats.mtime);
      });
  }
}
