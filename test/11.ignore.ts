import test from 'ava';

import * as crypto from 'crypto';
import * as os from 'os';
import * as fse from 'fs-extra';

import { join, dirname, basename } from 'path';
import {
  getSnowexec, getRandomPath, exec, EXEC_OPTIONS,
} from './helper';
import { FILTER, Repository, StatusEntry } from '../src/repository';

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
  const snowWorkdir = generateUniqueTmpDirName();
  const ignoreFile = join(snowWorkdir, 'ignore');

  const buf : Buffer = Buffer.from('donde esta la biblioteca');

  fse.createFileSync(ignoreFile);
  fse.writeFileSync(ignoreFile, buf, { flag: 'a' });

  const data : Buffer = fse.readFileSync(ignoreFile);
  t.deepEqual(buf, data);
});

test('Ignore single file in root', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath, 'ignore-me.txt');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'ignore-me.txt', { flag: 'a' });

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 1);
    t.true(files.includes('.snowignore'));
  });
});

test('Ignore multiple files in root', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath, 'ignore-me.txt',
      'dont-ignore-me1.txt',
      'dont-ignore-me2.txt',
      'dont-ignore-me3.txt',
      'dont-ignore-me4.txt');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'ignore-me.txt', { flag: 'a' });

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 5);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('dont-ignore-me1.txt'));
    t.true(files.includes('dont-ignore-me2.txt'));
    t.true(files.includes('dont-ignore-me3.txt'));
    t.true(files.includes('dont-ignore-me4.txt'));
  });
});

test.only('Ignore *.txt', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'dont-ignore-me1.txt',
      'dont-ignore-me2.txt',
      'dont-ignore-me3.txt',
      'dont-ignore-me4.txt',
      'dont-ignore-me5.foo');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, '*.txt', { flag: 'a' });

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 2);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('dont-ignore-me5.txt'));
  });
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
