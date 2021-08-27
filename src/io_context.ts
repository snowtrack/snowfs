import * as cp from 'child_process';
import * as fse from 'fs-extra';
import * as os from 'os';

import { exec, spawn } from 'child_process';
import {
  join, dirname, normalize, relative,
} from './path';
import { MB1 } from './common';
import * as io from './io';

import trash = require('trash');
import AggregateError = require('es-aggregate-error');
import drivelist = require('drivelist');
import PromisePool = require('@supercharge/promise-pool');

class StacklessError extends Error {
  constructor(...args: any) {
    super(...args);
    this.name = this.constructor.name;
    delete this.stack;
  }
}

export enum FILESYSTEM {
  APFS = 1,
  HFS_PLUS = 2,
  REFS = 3,
  NTFS = 4,
  FAT32 = 5,
  FAT16 = 6,
  OTHER = 7
}

export class Drive {
  displayName: string;

  filesystem: FILESYSTEM;

  constructor(displayName: string, filesystem: FILESYSTEM) {
    this.displayName = displayName;
    this.filesystem = filesystem;
  }
}

export enum TEST_IF {
  FILE_CAN_BE_READ_FROM = 1,
  FILE_CAN_BE_WRITTEN_TO = 2
}

/**
 * Convert a passed string to an utf-16 le string.
 */
function strEncodeUTF16(str: string) : Uint8Array {
  const buf = new ArrayBuffer(str.length * 2);
  const bufView = new Uint16Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return new Uint8Array(buf);
}

export namespace win32 {

  /**
   * Check if the passed files are written to by another process. The paths of `absPaths`
   * must be derived from `relPaths`. The order and length of both arrays must be equal.
   *
   * @param absPaths  Absolute paths of files to check.
   * @param relPaths  Relative paths of files to check.
   * @throws          Throws an AggregateError with a description of the effected files.
   */
  export function checkReadAccess(absPaths: string[], relPaths: string[]): Promise<void> {
    const promises: Promise<fse.Stats>[] = [];

    for (const absPath of absPaths) {
      promises.push(io.stat(absPath));
    }

    const stats1 = new Map<string, fse.Stats>();

    return Promise.all(promises)
      .then((stats: fse.Stats[]) => {
        if (stats.length !== relPaths.length) {
          throw new Error('Internal error: stats != paths');
        }

        for (let i = 0; i < relPaths.length; ++i) {
          stats1.set(relPaths[i], stats[i]);
        }

        return new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 500);
        });
      }).then(() => {
        const promises: Promise<fse.Stats>[] = [];

        for (const absPath of absPaths) {
          promises.push(io.stat(absPath));
        }

        return Promise.all(promises);
      })
      .then((stats: fse.Stats[]) => {
        if (stats.length !== relPaths.length) {
          throw new Error('Internal error: stats != paths');
        }

        const errors: Error[] = [];

        for (let i = 0; i < relPaths.length; ++i) {
          const prevStats = stats1.get(relPaths[i]);
          // When a file is being written by another process, either...
          // ... the size changes through time (e.g. simple write operation)
          // and/or...
          // ... the mtime changes (e.g. when a file is copied through the Windows Explorer*)
          // * When the Windows Explorer copies a file, the size seems to be already set, and only 'mtime' changes
          if (prevStats.size !== stats[i].size || prevStats.mtime.getTime() !== stats[i].mtime.getTime()) {
            const msg = `File '${relPaths[i]}' is being written by another process`;
            errors.push(new StacklessError(msg));
          }
        }

        if (errors.length > 0) {
          throw new AggregateError(errors);
        }
      });
  }

  /**
   * Check if the passed files are open by any other process.
   *
   * @param absPaths  Absolute paths of files to check.
   * @param relPaths  Relative paths of files to check.
   * @throws          Throws an AggregateError with a description of the effected files.
   */
  export function checkWriteAccess(ioContextClass: typeof IoContext, absPaths: string[]): Promise<void> {
    const winAccess = ioContextClass.calculateAndGetWinAccessPath();

    return new Promise<void>((resolve, reject) => {
      let std = '';

      let paths = '';
      for (const absPath of absPaths) {
        // the stdin of win-access.exe accepts utf-16 little endian
        paths += `${absPath}\n`;
      }

      const pathsArray = strEncodeUTF16(paths);
      const p0 = spawn(winAccess);

      p0.stdin.write(pathsArray);
      p0.stdin.end();
      p0.stdout.on('data', (data: any) => {
        std += data.toString();
      });

      p0.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          try {
            for (const d of JSON.parse(std)) {
              let msg = `Your files are accessed by ${d.strAppName}.`;
              if (d.strAppName !== 'Windows Explorer') {
                msg += ' Please close the application and retry.';
              }
              return reject(new Error(msg));
            }
          } catch (error) {
            // throw an error if something happened during JSON.parse
            reject(new Error(error));
          }
        }
      });
    });
  }
}

export namespace unix {

/**
 * Possible file lock types on a given file. This are the extracted
 * information from a `man lsof` converted into an enum.
 */
export enum LOCKTYPE {
  NFS_LOCK = 'N', // for a Solaris NFS lock of unknown type
  READ_LOCK_FILE_PART = 'r', // for read lock on part of the file
  READ_LOCK_FILE = 'R', // for a read lock on the entire file
  WRITE_LOCK_FILE_PART = 'w', // for a write lock on part of the file
  WRITE_LOCK_FILE = 'W', // for a write lock on the entire file
  READ_WRITE_LOCK_FILE = 'u', // for a read and write lock of any length
  UNKNOWN = 'X' // An unknown lock type (U, x or X)
}

export class FileHandle {
  /** PID of process which acquired the file handle */
  pid: string;

  processname: string;

  /** File access information with file lock info */
  lockType: LOCKTYPE;

  /** Documents filepath */
  filepath: string;
}

export function whichFilesInDirAreOpen(dirpath: string): Promise<Map<string, FileHandle[]>> {
  try {
    return new Promise<Map<string, FileHandle[]>>((resolve, reject) => {
      const p0 = cp.spawn('lsof', ['-X', '-F', 'pcan', '+D', dirpath]);
      const p = new Map<string, FileHandle[]>();

      let stdout = '';
      p0.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      function parseStdout(stdout: string): void {
        let lsofEntry: FileHandle = new FileHandle();
        for (const pline of stdout.split(/\n/)) {
          if (pline.startsWith('p')) { // PID of process which acquired the file handle
            // first item, therefore it creates the file handle
            lsofEntry = new FileHandle();
            lsofEntry.pid = pline.substr(1, pline.length - 1);
          } else if (pline.startsWith('c')) { // Name of process which acquired the file handle
            lsofEntry.processname = pline.substr(1, pline.length - 1);
          } else if (pline.startsWith('a')) { // File access information with file lock info
            // See `LOCKTYPE` for more information
            if (pline.includes('N')) {
              lsofEntry.lockType = LOCKTYPE.NFS_LOCK;
            } else if (pline.includes('r')) {
              lsofEntry.lockType = LOCKTYPE.READ_LOCK_FILE_PART;
            } else if (pline.includes('R')) {
              lsofEntry.lockType = LOCKTYPE.READ_LOCK_FILE;
            } else if (pline.includes('w')) {
              lsofEntry.lockType = LOCKTYPE.WRITE_LOCK_FILE_PART;
            } else if (pline.includes('W')) {
              lsofEntry.lockType = LOCKTYPE.WRITE_LOCK_FILE;
            } else if (pline.includes('u')) {
              lsofEntry.lockType = LOCKTYPE.READ_WRITE_LOCK_FILE;
            } else {
              lsofEntry.lockType = LOCKTYPE.UNKNOWN;
            }
          } else if (pline.startsWith('n')) { // Documents filepath
            const absPath = pline.substr(1, pline.length - 1);
            if (absPath.startsWith(dirpath)) {
              const relPath = relative(dirpath, pline.substr(1, pline.length - 1));
              const q = p.get(relPath);
              if (q) {
                // if there was an entry before, add the new entry to the array in the map
                q.push(lsofEntry);
              } else {
                // ..otherwise add a new list with the lsofEntry as the first element
                p.set(relPath, [lsofEntry]);
              }
              lsofEntry = new FileHandle();
            } else {
              console.log(`lsof reported unknown path: ${absPath}`);
            }
          }
        }
      }

      p0.on('exit', (code) => {
        if (code === 1) { // lsof returns 1
          parseStdout(stdout);
          resolve(p);
        } else {
          reject(code);
        }
      });
    });
  } catch (error) {
    console.log(error);
    return Promise.resolve(new Map());
  }
}

}

function getFilesystem(drive: any, mountpoint: string): Promise<FILESYSTEM> {
  try {
    if (process.platform === 'win32') {
      return new Promise<string | null>((resolve) => {
        const driveLetter = mountpoint.endsWith('\\') ? mountpoint.substring(0, mountpoint.length - 1) : mountpoint;
        exec(`fsutil fsinfo volumeinfo ${driveLetter}`, (error, stdout) => {
          if (error) {
            return resolve(null); // if we can't extract the volume info, we simply skip the ReFS detection
          }

          const lines = stdout.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split(/\r/);
          for (const line of lines) {
            if (line.startsWith('File System Name :')) {
              const filesystem: string = line.split(':', 2)[1].trim();
              return resolve(filesystem);
            }
          }
          return resolve(null);
        });
      }).then((filesystem: string | null) => {
        if (filesystem) {
          // eslint-disable-next-line default-case
          switch (filesystem.toLowerCase()) {
            case 'refs':
              return FILESYSTEM.REFS;
            case 'ntfs':
              return FILESYSTEM.NTFS;
            case 'fat16':
              return FILESYSTEM.FAT16;
            case 'fat32':
            case 'fat':
              return FILESYSTEM.FAT32;
          }
        }
        return FILESYSTEM.OTHER;
      }).catch((error) => {
        console.log(error);
        return FILESYSTEM.OTHER;
      });
    }
    if (process.platform === 'darwin') {
      const isApfs: boolean = (drive.description === 'AppleAPFSMedia');
      if (isApfs) {
        return Promise.resolve(FILESYSTEM.APFS);
      }
    }
  } catch (error) {
    return Promise.resolve(FILESYSTEM.OTHER);
  }

  return Promise.resolve(FILESYSTEM.OTHER);
}

type TrashExecutor = string | ((item: string[] | string) => void);

/**
 * Class to be instantiated to speedup certain I/O operations by acquiring information
 * about all connected storage devices when initialized with [[IoContext.init]].
 * In this case, [[IoContext.CopyFile]] can make use of some optimizations by checking
 * if `src` and `dst` are both on a similar APFS or ReFS storage device to use block cloning
 * operations.
 *
 * ```
 * const ioContext = new IoContext();
 * ioContext.init().then(() => {
 *     // perform many I/O operations here
 *     return io.copyFile(..);
 * });
 * ```
 */
export class IoContext {
  /** Path to 'win-access.exe'. If the path is undefined or null the path is set after
   * the first call of [IoContext.calculateAndGetWinAccessPath].
   */
  private static winAccessPath: string;

  /** Either pass a callback (for Electron environments to use shell.moveItemToTrash) or
   * set a path to the trash executable (e.g. 'recycle-bin.exe', 'trash', ...)
   * of the currently active system. If undefined or null the path is guessed.
   */
  private static trashExecutor?: TrashExecutor;

  /** Original returned object from `drivelist` */
  origDrives: any;

  /** Map of drive objects with mountpoints as the key */
  drives: Map<string, Drive>;

  /**
   * `true` after [[IoContext.init]] got called, `false`
   * before [[IoContext.init]] and after [[IoContext.invalidate]]
   */
  valid: boolean;

  /** Set of all known mountpoints. Set after [[IoContext.init]] is called */
  mountpoints: Set<string> | undefined;

  constructor() {
    this.valid = false;
  }

  /**
   * Invalidates the internal device storage information.
   * Normally not needed to explicitly call.
   */
  invalidate(): void {
    this.valid = false;
    this.mountpoints = undefined;
  }

  checkIfInitialized(): void {
    if (!this.valid) {
      throw new Error('IoContext is not initialized, did you forget to call IoContext.init(..)?');
    }
  }

  /**
   * Set the path of win-access.exe. Should only be set if process.platform === 'win32'.
   * If the path is manually set, the path is not calculated anymore by [calculateAndGetWinAccessPath].
   * @param winAccessPath   Absolute path to 'win-access.exe'
   * @throws                An error is raised if the passed file does not exist.
   */
  static setWin32AccessPath(winAccessPath: string): void {
    if (!fse.pathExistsSync(winAccessPath)) {
      throw new Error(`path ${winAccessPath} does not exist`);
    }
    IoContext.winAccessPath = winAccessPath;
  }

  /**
   * Calculate the path of 'win-access.exe'. If the path was set manually before by [setWin32AccessPath]
   * the function only returns and no path calculation is performed.
   * @returns Absolute path to 'win-access.exe'.
   * @throws Error if 'win-access.exe' could not be found.
   */
  static calculateAndGetWinAccessPath(): string {
    let winAccess = IoContext.winAccessPath;
    if (!winAccess) {
      if (fse.pathExistsSync(join(dirname(process.execPath), 'resources', 'win-access.exe'))) {
        winAccess = join(dirname(process.execPath), 'resources', 'win-access.exe');
      } else if (fse.pathExistsSync(join(__dirname, '..', 'resources', 'win-access.exe'))) {
        winAccess = join(__dirname, '..', 'resources', 'win-access.exe');
      } else {
        throw new Error('unable to locate win-access executable');
      }
      IoContext.winAccessPath = winAccess;
    }
    return IoContext.winAccessPath;
  }

  /**
   * In some cases the helper processes, which are used in `IoContext.putToTrash` to move a file
   * to the recycle-bin/trash are located in a different location. If that is the case, pass
   * the path of the executable. You can also set a callback instead if you you prefer your own trash handling.
   * @param execPath  Callback or path to the executable. Fails if the file does not exist or the path is a directory.
   */
  static setTrashExecutor(trashExecutor: TrashExecutor): void {
    if (typeof trashExecutor === 'string') {
      if (!fse.pathExistsSync(trashExecutor)) {
        throw new Error(`path ${trashExecutor} does not exist`);
      }
      if (fse.statSync(trashExecutor).isDirectory()) {
        throw new Error(`path ${trashExecutor} must not be a directory`);
      }
    }

    IoContext.trashExecutor = trashExecutor;
  }

  init(): Promise<void> {
    const tmpDrives: [string, string][] = [];
    return drivelist.list().then((drives: any) => {
      this.origDrives = drives;
      this.mountpoints = new Set();
      this.drives = new Map();

      for (const drive of drives) {
        for (const mountpoint of drive.mountpoints) {
          if (mountpoint && !mountpoint.path.startsWith('/System/')) {
            this.mountpoints.add(normalize(mountpoint.path));
          }
        }
      }

      const promises: Promise<FILESYSTEM>[] = [];

      for (const drive of drives) {
        for (const mountpoint of drive.mountpoints) {
          promises.push(getFilesystem(drive, normalize(mountpoint.path)));
          tmpDrives.push([normalize(mountpoint.path), mountpoint.label]);
        }
      }
      return Promise.all(promises);
    }).then((res: FILESYSTEM[]) => {
      let i = 0;
      res.forEach((filesystem: FILESYSTEM) => {
        if (!tmpDrives[i][0].startsWith('/System/')) {
          this.drives.set(tmpDrives[i][0], new Drive(tmpDrives[i][1], filesystem));
        }
        i++;
      });
    }).then(() => {
      this.valid = true;
    });
  }

  /**
   * Check if two filepaths are pointing to the same storage device.
   * @param file0     First filepath.
   * * @param file1   Second filepath.
   */
  areFilesOnSameDrive(file0: string, file1: string): boolean {
    this.checkIfInitialized();

    // detect if src and dst are copied onto the same drive
    let i = 0; let
      j = 0;
    this.mountpoints.forEach((mountpoint: string) => {
      if (file0.startsWith(mountpoint)) {
        i++;
      }
      if (file1.startsWith(mountpoint)) {
        j++;
      }
    });

    return i === j;
  }

  private copyFileApfs(src: string, dst: string): Promise<void> {
    return io.stat(src).then((stat: fse.Stats) => {
      // TODO: (Need help)
      // It seems on APFS copying files smaller than 1MB is faster than using COW.
      // Could be a local hickup on my system, verification/citation needed
      if (stat.size < MB1) {
        return io.copyFile(src, dst, fse.constants.COPYFILE_FICLONE);
      }

      const p0 = cp.spawn('cp', ['-c', src, dst]);
      return new Promise((resolve, reject) => {
        p0.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(code);
          }
        });
      });
    });
  }

  private copyFileRefs(src: string, dst: string): Promise<void> {
    return io.stat(src).then((stat: fse.Stats) => {
      if (stat.size < MB1) {
        return io.copyFile(src, dst, fse.constants.COPYFILE_FICLONE);
      }

      let cloneFileViaBlockClonePs1 = 'Clone-FileViaBlockClone.ps1';
      if (fse.pathExistsSync(join(dirname(process.execPath), 'resources', cloneFileViaBlockClonePs1))) {
        cloneFileViaBlockClonePs1 = join(dirname(process.execPath), 'resources', cloneFileViaBlockClonePs1);
      } else if (fse.pathExistsSync(join(__dirname, '..', 'resources', cloneFileViaBlockClonePs1))) {
        cloneFileViaBlockClonePs1 = join(__dirname, '..', 'resources', cloneFileViaBlockClonePs1);
      } else {
        console.warn(`unable to locate ${cloneFileViaBlockClonePs1}, fallback to fss.copyFile(..)`);
        return io.copyFile(src, dst, fse.constants.COPYFILE_FICLONE);
      }

      const p0 = cp.spawn('powershell.exe', [cloneFileViaBlockClonePs1, src, dst]);
      return new Promise((resolve, reject) => {
        p0.stdout.on('data', (data) => console.log(data.toString()));
        p0.stderr.on('data', (data) => console.log(data.toString()));
        p0.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(code);
          }
        });
      });
    });
  }

  /**
   * Asynchronously copies `src` to `dest`. By default, `dest` is overwritten if it already exists.
   * The Promise will be resolved with no arguments upon success.
   *
   * Node.js makes no guarantees about the atomicity of the copy operation. If an error occurs after
   * the destination file has been opened for writing, Node.js will attempt to remove the destination.
   *
   * @param src   source filename to copy
   * @param dst   destination filename of the copy operation
   */
  copyFile(src: string, dst: string): Promise<void> {
    this.checkIfInitialized();
    const srcAndDstOnSameDrive = this.areFilesOnSameDrive(src, dst);
    let filesystem = FILESYSTEM.OTHER;
    if (srcAndDstOnSameDrive) {
      // find the mountpoint again to extract filesystem info
      for (const mountpoint of Array.from(this.mountpoints)) {
        if (src.startsWith(mountpoint)) {
          const obj = this.drives.get(mountpoint);
          if (obj) {
            filesystem = obj.filesystem;
            break;
          }
        }
      }
    }

    switch (process.platform) {
      // @ts-ignore
      // fall through
      case 'darwin':
        if (srcAndDstOnSameDrive && filesystem === FILESYSTEM.APFS) {
          return this.copyFileApfs(src, dst);
        }
      // @ts-ignore
      // fall through
      case 'win32':
        if (srcAndDstOnSameDrive && filesystem === FILESYSTEM.REFS) {
          return this.copyFileRefs(src, dst);
        }
        // fall through
      case 'linux':
        // The copy operation will attempt to create a copy-on-write reflink.
        // If the platform does not support copy-on-write, then a fallback copy mechanism is used.
        return io.copyFile(src, dst, fse.constants.COPYFILE_FICLONE);
      default:
        throw new Error('Unsupported Operating System');
    }
  }

  /**
   * Check if the given filepaths are accessibled by another process.
   * For more information, or to add comments visit https://github.com/Snowtrack/SnowFS/discussions/110
   *
   * @param dir               The root directory path to check
   * @param relPaths          Relative file paths inside the given directory.
   * @param testIf            Request which access test should be applied on the tests.
   * @throws {AggregateError} Aggregated error of StacklessError
   */
  performFileAccessCheck(dir: string, relPaths: string[], testIf: TEST_IF): Promise<void> {
    function checkAccess(absPaths: string[]): Promise<void[]> {
      const promises: Promise<void>[] = [];

      for (const absPath of absPaths) {
        promises.push(io.access(absPath, testIf === TEST_IF.FILE_CAN_BE_READ_FROM ? fse.constants.R_OK : fse.constants.W_OK));
      }

      return Promise.all(promises);
    }

    function checkWin32(relPaths): Promise<void> {
      const absPaths = relPaths.map((p: string) => join(dir, p));

      return checkAccess(absPaths)
        .then(() => {
          switch (testIf) {
            case TEST_IF.FILE_CAN_BE_READ_FROM:
              // check if files are written by another process
              return win32.checkReadAccess(absPaths, relPaths);
            case TEST_IF.FILE_CAN_BE_WRITTEN_TO:
            default:
              // Check if files are touched by any other process.
              // Files that are opened by another process cannot be replaced, moved or deleted.
              // The current limit to check for write access on Windows is 5000 which takes around
              // 10 seconds on my machine. Everything below simply takes too long. In that case
              // we let the proceeding function fail
              if (absPaths.length <= 5000) {
                return win32.checkWriteAccess(IoContext, absPaths);
              }
              return Promise.resolve();
          }
        });
    }

    function checkUnixLike(relPaths): Promise<void> {
      const absPaths = relPaths.map((p: string) => join(dir, p));
      return checkAccess(absPaths)
        .then(() => {
          return unix.whichFilesInDirAreOpen(dir);
        })
        .then((fileHandles: Map<string, unix.FileHandle[]>) => {
          const errors: Error[] = [];

          for (const relPath of relPaths) {
            const fhs: unix.FileHandle[] | undefined = fileHandles.get(relPath);
            if (fhs) {
              for (const fh of fhs) {
                if (fh.lockType === unix.LOCKTYPE.READ_WRITE_LOCK_FILE
                    || fh.lockType === unix.LOCKTYPE.WRITE_LOCK_FILE
                    || fh.lockType === unix.LOCKTYPE.WRITE_LOCK_FILE_PART) {
                  const msg = `File '${relPath}' is being written by ${fh.processname ?? 'another process'}`;
                  errors.push(new StacklessError(msg));
                }
              }
            }
          }

          if (errors.length > 0) {
            throw new AggregateError(errors);
          }
        });
    }

    switch (process.platform) {
      case 'win32':
        return checkWin32(relPaths);
      case 'darwin':
      case 'linux':
        return checkUnixLike(relPaths);
      default:
        throw new Error('Unknown operating system');
    }
  }

  /**
   * Move files into the trash of the operating system. `SnowFS` avoids
   * destructive delete operations at all costs, and rather moves files to trash.
   *
   * @param absPaths    The file(s) or directory to move to the trash.
  */
  static putToTrash(absPaths: string[] | string): Promise<void> {
    if (typeof absPaths === 'string') {
      absPaths = [absPaths];
    }

    if (!Array.isArray(absPaths)) { // assertion absPath is an array
      return Promise.resolve();
    }

    // just to be on the safe side
    absPaths.forEach((absPath: string) => {
      switch (process.platform) {
        case 'win32': {
          if (absPath.length <= 3) { // if empty or C:\ or C:/
            throw new Error(`cannot move '${absPath}' to trash`);
          }
          break;
        }
        case 'darwin':
        case 'linux': {
          if (absPath.length <= 1) { // if empty or root (/)
            throw new Error(`cannot move '${absPath}' to trash`);
          }
          break;
        }
        default:
          throw new Error('Unsupported operating system');
      }
    });

    if (IoContext.trashExecutor && typeof IoContext.trashExecutor !== 'string') {
      IoContext.trashExecutor(absPaths);
      return Promise.resolve();
    }

    let trashPath: string | undefined;

    if (typeof IoContext.trashExecutor === 'string') {
      trashPath = IoContext.trashExecutor;
    }

    if (!trashPath) {
      switch (process.platform) {
        case 'linux': {
          // if no trash path is set, we use the trash module right away
          // since there is no executable and 'trash' already splits the absPaths
          // into chunks if too many files are passed
          return trash(absPaths);
        }
        case 'darwin': {
          if (fse.pathExistsSync(join(dirname(process.execPath), 'resources', 'trash'))) {
            trashPath = join(dirname(process.execPath), 'resources', 'trash');
          } else if (fse.pathExistsSync(join(__dirname, '..', 'resources', 'trash'))) {
            trashPath = join(__dirname, '..', 'resources', 'trash');
          } else {
            throw new Error('unable to locate trash executable');
          }
          break;
        }
        case 'win32': {
          if (fse.pathExistsSync(join(dirname(process.execPath), 'resources', 'recycle-bin.exe'))) {
            trashPath = join(dirname(process.execPath), 'resources', 'recycle-bin.exe');
          } else if (fse.pathExistsSync(join(__dirname, '..', 'resources', 'recycle-bin.exe'))) {
            trashPath = join(__dirname, '..', 'resources', 'recycle-bin.exe');
          } else {
            throw new Error('unable to locate trash executable');
          }
          break;
        }
        default: {
          throw new Error('Unknown operating system');
        }
      }
    }

    switch (process.platform) {
      case 'darwin': {
        const isOlderThanMountainLion = Number(os.release().split('.')[0]) < 12;
        if (isOlderThanMountainLion) {
          throw new Error('macOS 10.12 or later required');
        }
        break;
      }
      case 'win32': {
        break;
      }
      default: {
        throw new Error('Unknown operating system');
      }
    }

    // Slice the array into multiple arrays because
    // the trash executables allow multiple arguments.
    //  $ trash path [...]
    //  $ recycle-bin.exe path [...]
    // The amount of arguments is limited and
    // 4096 is a good compromise for macOS and Windows
    const chunks: string[][] = [];
    let currentSize = 0;
    let currentChunk: string[] = [];
    chunks.push(currentChunk);
    for (const absPath of absPaths) {
      if (currentSize + absPath.length + 1 > 4096) {
        currentSize = 0;
        currentChunk = [];
        chunks.push(currentChunk);
      }

      currentSize += absPath.length + 1;
      currentChunk.push(absPath);
    }

    if (!trashPath) {
      throw new Error('no trash executable set');
    }

    return PromisePool
      .withConcurrency(8)
      .for(chunks)
      .handleError((error) => { throw error; }) // Uncaught errors will immediately stop PromisePool
      .process((path: string[]) => {
        return new Promise<void>((resolve, reject) => {
          const proc: cp.ChildProcessWithoutNullStreams = spawn(trashPath, path);

          proc.on('exit', (code: number) => {
            if (code === 0) {
              resolve();
            } else {
              const stderr = proc.stderr.read();
              if (stderr) {
                reject(new Error(stderr.toString()));
              } else {
                reject(new Error('deleting files failed'));
              }
            }
          });
        });
      }).then(() => {/* */});
  }
}
