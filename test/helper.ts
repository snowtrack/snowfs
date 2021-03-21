import * as crypto from 'crypto';
import * as fse from 'fs-extra';

import { join } from 'path';
import { spawn } from 'child_process';

import os from 'os';

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

export function getSnowexec(t): string {
  switch (process.platform) {
    case 'darwin':
      return join(__dirname, '..', './bin/snow');
    case 'win32':
      return join(__dirname, '..', './bin/snow.bat');
    default:
      throw new Error('Unsupported Operating System');
  }
}

export async function exec(t, command: string, args?: string[], opts?: {cwd?: string},
  stdiopts?: EXEC_OPTIONS, stdin = ''): Promise<void | string> {
  t.log(`Execute ${command} ${args.join(' ')}`);

  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.', env: Object.assign(process.env, { SUPPRESS_BANNER: 'true' }) });
  return new Promise((resolve, reject) => {
    let std: string = '';
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
