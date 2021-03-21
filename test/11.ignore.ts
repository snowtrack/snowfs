import test from 'ava';

import * as crypto from 'crypto';
import * as os from 'os';
import * as fse from 'fs-extra';

import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';

enum EXEC_OPTIONS {
  RETURN_STDOUT = 1,
  WRITE_STDIN = 2
}

async function exec(t, command: string, args?: string[], opts?: {cwd?: string}, stdiopts?: EXEC_OPTIONS, stdin = ''): Promise<void | string> {
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

function getSnowexec(t): string {
  switch (process.platform) {
    case 'darwin':
      return join(__dirname, '..', './bin/snow');
    case 'win32':
      return join(__dirname, '..', './bin/snow.bat');
    default:
      throw new Error('Unsupported Operating System');
  }
}

function generateUniqueTmpDirName(): string {
  const id = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
  return join(os.tmpdir(), `snowfs-cli-test-${id}`);
}

function createFiles(workdir : string, ...names : string[]) {
  for (let i = 0; i < names.length; i++) {
    const f = join(workdir, names[i]);
    fse.createFileSync(f);
  }
}

test('Test Sanity Check --- CHECK FUNCTIONING FILE IO', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const ignoreFile = join(snowWorkdir, 'ignore');

  const buf : Buffer = Buffer.from('donde esta la biblioteca');

  fse.createFileSync(ignoreFile);
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  const data : Buffer = fse.readFileSync(ignoreFile);
  t.deepEqual(buf, data);
});

test('Ignore single file in root --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  // create ignore file
  const toIgnoreName = 'ignore-me.txt';
  createFiles(snowWorkdir, 'ignore', toIgnoreName);

  // add file to ignore
  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf : Buffer = Buffer.from(toIgnoreName);
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);
  t.is(true, !String(stdout).includes(toIgnoreName));
});

test('Ignore multiple files in root --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore', toIgnore1, toIgnore2, toIgnore3);

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf1 : Buffer = Buffer.from(`${toIgnore1}\n\r`);
  const buf2 : Buffer = Buffer.from(`${toIgnore2}\n\r`);
  const buf3 : Buffer = Buffer.from(`${toIgnore3}\n\r`);

  const buf = Buffer.concat([buf1, buf2, buf3]);
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && !String(stdout).includes(toIgnore1);
  success = success && !String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore *.txt --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore', toIgnore1, toIgnore2, toIgnore3);

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('*.txt');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && !String(stdout).includes(toIgnore1);
  success = success && !String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore subdirectory unix seperator --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore', toIgnore1, toIgnore2, join('subdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('subdir/*');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && String(stdout).includes(toIgnore1);
  success = success && String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore subdirectory windows seperator --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore', toIgnore1, toIgnore2, join('subdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('subdir\\*');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && String(stdout).includes(toIgnore1);
  success = success && String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore nested subdirectory --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore',
    toIgnore1,
    join('subsubdir', toIgnore2),
    join('subdir', 'subsubdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('subdir/subsubdir/*');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && String(stdout).includes(toIgnore1);
  success = success && String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore directory name --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore',
    toIgnore1,
    join('subsubdir', toIgnore2),
    join('subdir', 'subsubdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('subsubdir/*');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && String(stdout).includes(toIgnore1);
  success = success && !String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore comments in ignore --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore',
    toIgnore1,
    join('subsubdir', toIgnore2),
    join('subdir', 'subsubdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('// subsubdir/*');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && String(stdout).includes(toIgnore1);
  success = success && String(stdout).includes(toIgnore2);
  success = success && String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore inline comments in ignore --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore',
    toIgnore1,
    join('subsubdir', toIgnore2),
    join('subdir', 'subsubdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('sub/*comment*/subdir/*');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && String(stdout).includes(toIgnore1);
  success = success && !String(stdout).includes(toIgnore2);
  success = success && !String(stdout).includes(toIgnore3);

  t.is(true, success);
});

test('Ignore inverse --- SUCCEED NOT ADD FILE', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const toIgnore1 = 'ignore-1.txt';
  const toIgnore2 = 'ignore-2.txt';
  const toIgnore3 = 'ignore-3.txt';
  createFiles(snowWorkdir, 'ignore',
    toIgnore1,
    join('subsubdir', toIgnore2),
    join('subdir', 'subsubdir', toIgnore3));

  const ignoreFile = join(snowWorkdir, 'ignore');
  const buf = Buffer.from('^(?!*subsubdir/*)');
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  const stdout = await exec(t, snow, ['status', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  let success = true;
  success = success && !String(stdout).includes(toIgnore1);
  success = success && String(stdout).includes(toIgnore2);
  success = success && String(stdout).includes(toIgnore3);

  t.is(true, success);
});
