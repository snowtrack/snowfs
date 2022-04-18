import * as crypto from 'crypto';
import * as fse from 'fs-extra';

import { spawn } from 'child_process';

import os from 'os';
import { join } from '../src/path';
import { calculateFileHash, HashBlock } from '../src/common';

export enum EXEC_OPTIONS {
    RETURN_STDOUT = 1,
    WRITE_STDIN = 2
}

export function generateUniqueTmpDirName(): string {
  const id = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
  return join(os.tmpdir(), `snowfs-cli-test-${id}`);
}

export function getRandomPath(): string {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const name = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
    const repoPath = join(os.tmpdir(), 'snowtrack-repo', name);
    if (!fse.pathExistsSync(repoPath)) {
      return repoPath;
    }
  }
}

export function createRandomString(length: number): string {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function createRandomFile(dst: string, size: number): Promise<{filepath: string, filehash: string, hashBlocks?: HashBlock[]}> {
  const stream = fse.createWriteStream(dst, { flags: 'w' });
  for (let i = 0; i < size; ++i) {
    stream.write(createRandomString(size));
  }

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      resolve(dst);
    });
    stream.on('error', reject);
    stream.end();
  }).then(() => calculateFileHash(dst))
    .then((res: {filehash: string, hashBlocks?: HashBlock[]}) => ({ filepath: dst, filehash: res.filehash, hashBlocks: res.hashBlocks }));
}

export function getSnowexec(): string {
  switch (process.platform) {
    case 'linux':
    case 'darwin':
      return join(__dirname, '..', './bin/snow');
    case 'win32':
      return join(__dirname, '..', './bin/snow.bat');
    default:
      throw new Error('Unsupported Operating System');
  }
}

export function exec(
  t,
  command: string,
  args?: string[],
  opts?: {cwd?: string},
  stdiopts?: EXEC_OPTIONS,
  stdin = '',
): Promise<void | string> {
  t.log(`Execute ${command} ${args.join(' ')}`);

  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.', env: Object.assign(process.env, { SUPPRESS_BANNER: 'true' }) });
  return new Promise((resolve, reject) => {
    let std = '';
    if (stdiopts & EXEC_OPTIONS.WRITE_STDIN) {
      p0.stdin.write(`${stdin}\n`);
      p0.stdin.end(); /// this call seems necessary, at least with plain node.js executable
    }
    p0.stdout.on('data', (data) => {
      if (stdiopts & EXEC_OPTIONS.RETURN_STDOUT) {
        std += data.toString();
      } else {
        t.log(data.toString());
      }
    });
    p0.stderr.on('data', (data) => {
      std += data.toString();
    });
    p0.on('exit', (code) => {
      if (code === 0) {
        // if used in Visual Studio these are some debug outputs added to the output
        std = std.replace(/Debugger attached./, '').trimLeft();
        std = std.replace(/Waiting for the debugger to disconnect.../, '').trimRight();
        resolve(std ?? undefined);
      } else {
        reject(Error(`Failed to execute ${command} ${args.join(' ')} with exit-code ${code}\n${std}`));
      }
    });
  });
}
