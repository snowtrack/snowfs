import * as cp from 'child_process';
import * as fse from 'fs-extra';

import { MB1 } from './common';

const drivelist = require('drivelist');

enum FILESYSTEM {
  APFS = 1,
  HFS_PLUS = 2,
  REFS = 3,
  NTFS = 4,
  FAT32 = 5,
  FAT16 = 6,
  OTHER = 7
}

class Drive {
  displayName: string;

  filesystem: FILESYSTEM;

  constructor(displayName: string, filesystem: FILESYSTEM) {
    this.displayName = displayName;
    this.filesystem = filesystem;
  }
}

function getFilesystem(drive: any) {
  const isApfs: boolean = (drive.description === 'AppleAPFSMedia');
  if (isApfs) {
    return FILESYSTEM.APFS;
  }

  // TODO: Implement $ diskutil info to extract filesystem
  // https://ss64.com/osx/diskutil.html

  return FILESYSTEM.OTHER;
}

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
  mountpoints: Set<string>;

  driveDesc: Map<string, string[]>;

  constructor() {
    this.valid = false;
  }

  /**
   * Invalidates the internal device storage information.
   * Normally not needed to explicitly call.
   */
  invalidate() {
    this.valid = false;
    this.mountpoints = undefined;
  }

  async init() {
    return drivelist.list().then((drives: any) => {
      this.origDrives = drives;
      this.mountpoints = new Set();
      this.driveDesc = new Map();
      this.drives = new Map();

      for (const drive of drives) {
        for (const mountpoint of drive.mountpoints) {
          this.drives.set(mountpoint.path, new Drive(drive.displayName, getFilesystem(drive)));

          this.mountpoints.add(mountpoint.path);

          const mntPts = this.driveDesc.get(mountpoint.path);
          if (mntPts) {
            mntPts.push(mountpoint.description);
          } else {
            this.driveDesc.set(mountpoint.path, [mountpoint.description]);
          }
        }
      }
    });
  }

  /**
   * Check if two filepaths are pointing to the same storage device.
   * @param file0     First filepath.
   * * @param file1   Second filepath.
   */
  areFilesOnSameDrive(file0: string, file1: string): boolean {
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

  /**
   * Moves a file or directory, even across devices.
   * @param src   source filename to move
   * @param dst   destination filename of the move operation
   * @param options  overwrite existing file or directory, default is `false`.
   */
  async move(src: string, dst: string, options?: fse.MoveOptions): Promise<void> {
    return fse.move(src, dst, options);
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
  async copyFile(src: string, dst: string): Promise<void> {
    const srcAndDstOnSameDrive = this.areFilesOnSameDrive(src, dst);
    let isApfs: boolean = false;
    if (srcAndDstOnSameDrive) {
      // find the mountpoint again to extract filesystem info
      for (const mountpoint of Array.from(this.mountpoints)) {
        if (src.startsWith(mountpoint)) {
          isApfs = this.drives.get(mountpoint).filesystem === FILESYSTEM.APFS;
          break;
        }
      }
    }

    switch (process.platform) {
      case 'darwin':
        if (srcAndDstOnSameDrive && isApfs) {
          return fse.stat(src).then((stat: fse.Stats) => {
            // TODO: (Need help)
            // It seems on APFS copying files smaller than 1MB is faster than using COW.
            // Could be a local hickup on my system, verification/citation needed
            if (stat.size < MB1) {
              return fse.copyFile(src, dst);
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
        /* falls through */
      case 'win32':
        // TODO: Implement block cloning of ReFS. The script below can give some insights,
        // but I am not sure if there are simpler methods to achieve this. License also unclear
        // https://github.com/Sorrowfulgod/ReFSBlockClone

        // For more information about ReFS also check this tweet:
        // https://twitter.com/snowtrack_io/status/1351186255816646657

        /* falls through */
      case 'linux':
        // The copy operation will attempt to create a copy-on-write reflink.
        // If the platform does not support copy-on-write, then a fallback copy mechanism is used.
        return fse.copyFile(src, dst, fse.constants.COPYFILE_FICLONE);
      default:
        throw new Error('Unsupported Operating System');
    }
  }
}
