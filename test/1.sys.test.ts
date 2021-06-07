/* eslint-disable no-await-in-loop */
import * as fse from 'fs-extra';
import * as os from 'os';
import * as unzipper from 'unzipper';

import test from 'ava';

import { differenceBy } from 'lodash';
import {
  join, dirname, normalize, normalizeExt, sep, basename,
} from '../src/path';
import * as fss from '../src/fs-safe';
import { DirItem, OSWALK, osWalk } from '../src/io';
import { IoContext, TEST_IF } from '../src/io_context';
import {
  calculateFileHash,
  compareFileHash, getRepoDetails, LOADING_STATE, MB100,
} from '../src/common';
import { createRandomString } from './helper';
import {
  calculateSizeAndHash,
  constructTree, TreeDir, TreeEntry, TreeFile,
} from '../src/treedir';

const PromisePool = require('@supercharge/promise-pool');
const AggregateError = require('es-aggregate-error');

const sortPaths = require('sort-paths');

const exampleDirs = [
  join('foo', 'a'),
  join('bar', 'b', 'c'),
  join('bar', 'b', 'd'),
  join('bas', 'a', 'b', 'c', 'd'),
  'x',
  join('y', '1'),
  join('y', '1', '2'),
];

const exampleFiles = [
  join('foo', 'a', 'file1'),
  join('bar', 'b', 'c', 'file2'),
  join('bar', 'b', 'd', 'file1'),
  join('bas', 'a', 'b', 'c', 'd', 'file3'),
  join('x', 'file4'),
  join('x', 'file5'),
  join('y', '1', 'file4'),
  join('y', '1', '2', 'file6'),
];

const LOG_DIRECTORY = 'Check getRepoDetails(..) with directory path';
const LOG_FILE = 'Check getRepoDetails(..) with  filepath:';

async function sleep(delay) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, delay);
  });
}

async function createDirs(t, tmpDir: string, dirs: string[]) {
  if (dirs.length === 0) {
    return Promise.resolve();
  }

  const dir: string = join(tmpDir, dirs[0]);
  t.log(`Create dir: ${dir}${sep}`);
  return fse.mkdirp(dir).then(() => createDirs(t, tmpDir, dirs.slice(1)));
}

function getUniquePaths(dirSet: string[]): string[] {
  // Calculate unique paths from the exampleDirs array
  // Input:
  //     foo/a/b and foo/a/c
  // Output:
  //     foo
  //     foo/a
  //     foo/a/b
  //     foo/a/c

  const visitedPaths: Set<string> = new Set();
  for (const dir of dirSet) {
    let sumPath = '';
    for (const p of dir.split('/')) {
      sumPath = join(sumPath, p);
      visitedPaths.add(sumPath);
    }
  }
  return Array.from(visitedPaths).sort();
}

test('proper normalize', (t) => {
  let error: any;

  error = t.throws(() => normalize(undefined));
  t.is(error.code, 'ERR_INVALID_ARG_TYPE', 'no error expected');

  error = t.throws(() => normalize(null));
  t.is(error.code, 'ERR_INVALID_ARG_TYPE', 'no error expected');

  t.is(normalize(''), '');
  t.is(normalize('.'), '');
  t.is(normalize('xyz'), 'xyz');

  switch (process.platform) {
    case 'win32':
      t.is(normalize('\\xyz'), '/xyz');
      t.is(normalize('xyz\\'), 'xyz');
      t.is(normalize('/xyz/'), '/xyz');
      t.is(normalize('C:\\Users\\sebastian\\Desktop\\..\\..\\foo'), 'C:/Users/foo');
      t.is(normalize('C:\\Users\\sebastian\\Desktop\\..\\..\\foo\\'), 'C:/Users/foo');
      break;
    case 'linux':
    case 'darwin':
      t.is(normalize('/xyz'), '/xyz');
      t.is(normalize('xyz/'), 'xyz');
      t.is(normalize('/xyz/'), '/xyz');
      t.is(normalize('/Users/sebastian/Desktop/../../foo/'), '/Users/foo');
      t.is(normalize('/Users/sebastian/Desktop/../../foo'), '/Users/foo');
      break;
    default:
      throw new Error('unsupported operating system');
  }
});

test('osWalk test#0', async (t) => {
  /// //////////////////////////////////////////////////////////////////////////
  t.log("Check that osWalk fails if the passed directory doesn't exist");
  /// //////////////////////////////////////////////////////////////////////////
  const tmpDir: string = join(os.tmpdir(), "dir-doesn't-exist-fgo8dsf7g");

  const error1 = await t.throwsAsync(() => osWalk(tmpDir, OSWALK.DIRS));
  t.true(error1.message.includes('no such file or directory'));
  const error2 = await t.throwsAsync(() => osWalk(tmpDir, OSWALK.FILES));
  t.true(error2.message.includes('no such file or directory'));
  const error3 = await t.throwsAsync(() => osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES));
  t.true(error3.message.includes('no such file or directory'));
});

test('osWalk test#1', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create a set of directories and verify with osWalk(returnDirs=true, returnFiles=false)');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    await createDirs(t, tmpDir, exampleDirs);

    const items: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS);

    const res1: string[] = getUniquePaths(exampleDirs);
    const res2: string[] = getUniquePaths(items.map((value: DirItem) => value.relPath));

    t.log(
      `Expected ${res1.length} directories, got ${res2.length}: `,
      res1.length === res2.length ? 'OK' : 'FAILED',
    );
    t.deepEqual(res1, res2);

    /// //////////////////////////////////////////////////////////////////////////
    t.log('Test to ensure that no directory has a trailing platform specific seperator and they don\'t contain \'//\' nor \'/\'');
    /// //////////////////////////////////////////////////////////////////////////
    for (const item of items) {
      /// //////////////////////////////////////////////////////////////////////////
      t.log(`  ${item.relPath}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.relPath.endsWith(sep));

      t.true(item.relPath.search(/\/\//) === -1); // search for //
      t.true(item.relPath.search(/\\\//) === -1); // search for \\/
      t.true(item.relPath.search(/\/\\/) === -1); // search for /\\
    }

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#2a', async (t) => {
  try {
    // Almost same as osWalk test#2, but with trailing seperator to ensure the paths are still returning ok
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create a set of directories and files and verify with osWalk(returnDirs=true, returnFiles=true)');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir = `${await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'))}/`;
    await createDirs(t, tmpDir, exampleDirs);
    for (let file of exampleFiles) {
      file = join(tmpDir, file);
      t.log(`Create file: ${file}`);
      fse.ensureFileSync(file);
    }

    const items: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);

    const res1: string[] = getUniquePaths(exampleFiles.concat(exampleDirs));
    const res2: string[] = items.map((value: DirItem) => value.relPath).sort();

    t.log(
      `Expected ${res1.length} directories, got ${res2.length}: `,
      res1.length === res2.length ? 'OK' : 'FAILED',
    );
    t.deepEqual(res1, res2);

    /// //////////////////////////////////////////////////////////////////////////
    t.log('Test to ensure that no directory has a trailing platform specific seperator');
    /// //////////////////////////////////////////////////////////////////////////
    for (const item of items) {
      /// //////////////////////////////////////////////////////////////////////////
      t.log(`  ${item.relPath}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.relPath.endsWith(sep));

      t.true(item.relPath.search(/\/\//) === -1); // search for //
      t.true(item.relPath.search(/\\\//) === -1); // search for \\/
      t.true(item.relPath.search(/\/\\/) === -1); // search for /\\
    }

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#2', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create a set of directories and files and verify with osWalk(returnDirs=true, returnFiles=true)');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    await createDirs(t, tmpDir, exampleDirs);
    for (let file of exampleFiles) {
      file = join(tmpDir, file);
      t.log(`Create file: ${file}`);
      fse.ensureFileSync(file);
    }

    const items: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);

    const res1: string[] = getUniquePaths(exampleFiles.concat(exampleDirs));
    const res2: string[] = items.map((value: DirItem) => value.relPath).sort();

    t.log(
      `Expected ${res1.length} directories, got ${res2.length}: `,
      res1.length === res2.length ? 'OK' : 'FAILED',
    );
    t.deepEqual(res1, res2);

    /// //////////////////////////////////////////////////////////////////////////
    t.log('Test to ensure that no directory has a trailing platform specific seperator');
    /// //////////////////////////////////////////////////////////////////////////
    for (const item of items) {
      /// //////////////////////////////////////////////////////////////////////////
      t.log(`  ${item.relPath}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.relPath.endsWith(sep));
    }

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#3', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create a set of directories AND files but only request directories via osWalk(returnDirs=true, returnFiles=false)');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    await createDirs(t, tmpDir, exampleDirs);
    for (let file of exampleFiles) {
      file = join(tmpDir, file);
      t.log(`Create file: ${file}`);
      fse.ensureFileSync(file);
    }

    const items: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.HIDDEN);

    const res1: string[] = getUniquePaths(exampleDirs);
    const res2: string[] = items.map((value: DirItem) => value.relPath).sort();

    t.log(
      `Expected ${res1.length} directories, got ${res2.length}: `,
      res1.length === res2.length ? 'OK' : 'FAILED',
    );
    t.deepEqual(res1, res2);

    /// //////////////////////////////////////////////////////////////////////////
    t.log('Test to ensure that no directory has a trailing platform specific seperator');
    /// //////////////////////////////////////////////////////////////////////////
    for (const item of items) {
      /// //////////////////////////////////////////////////////////////////////////
      t.log(`  ${item.relPath}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.relPath.endsWith(sep));
    }

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#4', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create a set of directories AND files but only request files via osWalk(returnDirs=false, returnFiles=true)');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    await createDirs(t, tmpDir, exampleDirs);
    for (let file of exampleFiles) {
      file = join(tmpDir, file);
      t.log(`Create file: ${file}`);
      fse.ensureFileSync(file);
    }

    const paths: DirItem[] = await osWalk(tmpDir, OSWALK.FILES);

    t.log(
      `Expected ${paths.length} directories, got ${exampleFiles.length}: `,
      paths.length === exampleFiles.length ? 'OK' : 'FAILED',
    );
    t.is(paths.length, exampleFiles.length);

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#5', async (t) => {
  try {
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    t.log(`Create empty dir: ${tmpDir}`);
    await fse.mkdirp(tmpDir);

    const paths: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    t.is(paths.length, 0);
    t.log(
      `Expected 0 directories, got ${paths.length}: `,
      paths.length === 0 ? 'OK' : 'FAILED',
    );

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#6', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create 1000 files and iterate over them while files are being deleted. osWalk must never fail');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    t.log(`Create empty dir: ${tmpDir}`);
    await fse.mkdirp(tmpDir);

    const fileSample = 1000;
    const files: string[] = [];

    t.log(`Create ${fileSample} files`);
    for (let i = 0; i < fileSample; ++i) {
      const absPath = join(tmpDir, 'subdir1', 'subdir2', `foo${i}`);
      files.push(absPath);
      fse.ensureFileSync(absPath);
    }

    let stop = false;

    const iteratedOverFiles: number[] = [];

    // eslint-disable-next-line no-inner-declarations
    async function executeOsWalk(): Promise<void> {
      const dirItems: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES)
        .catch((error) => {
          t.fail(error.message); // osWalk must never fail while we delete files from a directory
          return [];
        });
      iteratedOverFiles.push(dirItems.length);
      if (!stop) {
        return executeOsWalk();
      }
    }

    const executeOsWalkPromise = executeOsWalk();

    // no we delete all files, while executeOsWalk is constantly running
    const time0 = Date.now();

    await PromisePool
      .withConcurrency(10)
      .for(files)
      .handleError((error) => { throw error; }) // Uncaught errors will immediately stop PromisePool
      .process((path: string) => {
        return fse.remove(path)
          .then(() => sleep(25)); // fse.remove is executed too quickly, so introduce a few ms of delay
      });

    t.log(`Deleted ${files.length} files within ${Date.now() - time0}ms`);
    stop = true;
    await Promise.resolve(executeOsWalkPromise);
    t.log(`Number of iterations: ${iteratedOverFiles.join(' ')}`);
    t.pass();

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('osWalk test#7', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create 1000 files and iterate over them while the subdirectory is moved in and out of the directory');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    t.log(`Create empty dir: ${tmpDir}`);
    await fse.mkdirp(tmpDir);

    const fileSample = 1000;
    const files: string[] = [];

    t.log(`Create ${fileSample} files`);
    for (let i = 0; i < fileSample; ++i) {
      const absPath = join(tmpDir, 'subdir1', 'subdir2', `foo${i}`);
      files.push(absPath);
      fse.ensureFileSync(absPath);
    }

    let stop = false;

    const iteratedOverFiles: number[] = [];

    // eslint-disable-next-line no-inner-declarations
    async function executeOsWalk(): Promise<void> {
      const dirItems: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES)
        .catch((error) => {
          t.fail(error.message); // osWalk must never fail while we delete files from a directory
          return [];
        });
      iteratedOverFiles.push(dirItems.length);
      if (!stop) {
        return executeOsWalk();
      }
    }

    const executeOsWalkPromise = executeOsWalk();

    // no we delete all files, while executeOsWalk is constantly running
    const time0 = Date.now();

    const inDir = join(tmpDir, 'subdir1');
    const outDir = join(tmpDir, '..', 'subdir-xyz');
    if (fse.pathExistsSync(outDir)) {
      fse.rmdirSync(outDir, { recursive: true });
    }

    await PromisePool
      .withConcurrency(1)
      .for(Array.from(Array(25).keys()))
      .handleError((error) => { throw error; }) // Uncaught errors will immediately stop PromisePool
      .process((i: number) => {
        // fse.remove is executed too quickly, so introduce a few ms of delay
        if (i % 2 === 0) {
          t.log('Move outside the directory');
          return fse.move(inDir, outDir).then(() => sleep(10));
        }

        t.log('Move back into the directory');
        return fse.move(outDir, inDir).then(() => sleep(10));
      });

    t.log(`Deleted ${files.length} files within ${Date.now() - time0}ms`);
    stop = true;
    await Promise.resolve(executeOsWalkPromise);
    t.log(`Number of iterations: ${iteratedOverFiles.join(' ')}`);
    t.pass();

    fse.rmdirSync(tmpDir, { recursive: true });
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

function testGitZip(t, zipname: string): Promise<string> {
  const snowtrack: string = join(os.tmpdir(), 'foo');

  let tmpDir: string;
  return fse
    .mkdirp(snowtrack)
    .then(() => fse.mkdtemp(join(snowtrack, 'snowtrack-')))
    .then((tmpDirResult: string) => {
      tmpDir = tmpDirResult;
      const gitanddstPath: string = join(__dirname, zipname);
      t.log(`Unzip: ${zipname}`);
      return unzipper.Open.buffer(fse.readFileSync(gitanddstPath));
    })
    .then((d) => d.extract({ path: normalizeExt(tmpDir).replace('/', sep), concurrency: 5 }))
    .then(() =>
      // if tmpDir starts with /var/ we replace it with /private/var because
      // it is a symlink on macOS.
      (process.platform === 'darwin'
        ? tmpDir.replace(/^(\/var\/)/, '/private/var/')
        : tmpDir));
}

test('getRepoDetails (no git directory nor snowtrack)', async (t) => {
  t.plan(8);

  let tmpDir: string;
  function runTest(filepath = '', errorMessage?: string) {
    if (filepath) t.log(LOG_FILE, filepath);
    else t.log(LOG_DIRECTORY);

    return testGitZip(t, 'nogit.zip')
      .then((directory: string) => {
        tmpDir = directory;
        return getRepoDetails(
          filepath ? join(tmpDir, filepath) : tmpDir,
        );
      })
      .then(
        (res: {
          state: LOADING_STATE;
          commondir: string | null;
          uuid?: string;
        }) => {
          // neither git, nor snowtrack, neither known project, and therefore 0
          const expect = LOADING_STATE.NONE;
          if (res.state === expect) {
            t.log(
              'Project got neither detect as git nor snowtrack - as expected',
            );
          }
          t.is(res.state, LOADING_STATE.NONE);
          t.is(res.commondir, null);
          t.is(res.uuid, undefined);
          t.pass();
        },
      )
      .catch((error) => {
        if (errorMessage) {
          if (!error.message.startsWith(errorMessage)) {
            t.fail(
              `Exepceted error message, but received wrong one: ${error.message}`,
            );
            throw error;
          }
        } else {
          t.fail(error.message);
        }
      })
      .finally(() => {
        fse.rmdirSync(tmpDir, { recursive: true });
      });
  }
  try {
    await runTest();
    await runTest('foo');
    await runTest(
      'FILE_DOES_NOT_EXIST',
      'ENOENT: no such file or directory, stat',
    );
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('getRepoDetails (.git)', async (t) => {
  t.plan(4);

  let tmpDir: string;
  async function runTest(filepath = '') {
    if (filepath) t.log(LOG_FILE, filepath);
    else t.log(LOG_DIRECTORY);

    return testGitZip(t, 'onlygit.zip')
      .then((directory: string) => {
        tmpDir = directory;
        return getRepoDetails(
          filepath ? join(tmpDir, filepath) : tmpDir,
        );
      })
      .then(
        (res: {
          state: LOADING_STATE;
          commondir: string | null;
          uuid?: string;
        }) => {
          const expect = LOADING_STATE.GIT;
          if (res.state === expect) {
            t.log('Project got detected as git only - as expected');
          }
          t.is(res.state, expect);
          t.pass();
        },
      )
      .catch((error) => {
        t.fail(error.message);
      })
      .finally(() => {
        fse.rmdirSync(tmpDir, { recursive: true });
      });
  }

  try {
    await runTest();
    await runTest('foo');
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('getRepoDetails (.git and .snow)', async (t) => {
  t.plan(8);

  let tmpDir: string;
  async function runTest(filepath = '') {
    if (filepath) t.log(LOG_FILE, filepath);
    else t.log(LOG_DIRECTORY);

    return testGitZip(t, 'onlysnowtrack.zip')
      .then((directory: string) => {
        tmpDir = directory;
        return getRepoDetails(
          filepath ? join(tmpDir, filepath) : tmpDir,
        );
      })
      .then(
        (res: {
          state: LOADING_STATE;
          commondir: string | null;
          uuid?: string;
        }) => {
          const expect = LOADING_STATE.SNOW;
          if (res.state === expect) {
            t.log('Project got detected as snowtrack - as expected');
          }
          t.is(res.state, expect);

          t.is(res.commondir, (join(tmpDir, '.snow')));
          t.log(`Found .snow in ${res.commondir}`);
          t.is(res.uuid, undefined);
          t.pass();
        },
      )
      .catch((error) => {
        t.fail(error.message);
      })
      .finally(() => {
        fse.rmdirSync(tmpDir, { recursive: true });
      });
  }

  try {
    await runTest();

    // test to see what happens if getRepoDetails gets an element from the direectory, than then directory itself
    await runTest('cube.blend');
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('getRepoDetails (parent of .git and .snow)', async (t) => {
  // In this test we go a level up and expect that the snowtrack directory is
  // NOT detected because we intentionally only travel UP, never DOWN into the
  // hierarchy. Reason: Imagine someone selects C: or '/', that would take
  // forever

  t.plan(4);

  // Btw, this test does not have a LOG_FILE like the others because we test the
  // parent directory

  let tmpDir: string;

  try {
    await testGitZip(t, 'onlysnowtrack.zip')
      .then((directory: string) => {
        tmpDir = dirname(directory);
        return getRepoDetails(tmpDir);
      })
      .then(
        (res: { state: LOADING_STATE; commondir: string | null; uuid?: string }) => {
          const expect = LOADING_STATE.NONE;
          if (res.state === expect) {
            t.log('No project got detected - as expected');
          }
          t.is(res.state, expect);
          t.is(res.commondir, null);
          t.is(res.uuid, undefined);
          t.pass();
        },
      )
      .catch((error) => {
        t.fail(error.message);
      })
      .finally(() => {
        fse.rmdirSync(tmpDir, { recursive: true });
      });
  } catch (error) {
    t.fail(error.message);
  }
});

test('compareFileHash test', async (t) => {
  try {
    interface TestCase {
      fileContent: string;
      filehash: string;
      hashBlocks?: string[],
      error?: boolean
    }
    const testCases: TestCase[] = [{
      fileContent: '',
      filehash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }, {
      fileContent: 'hello World',
      filehash: 'db4067cec62c58bf8b2f8982071e77c082da9e00924bf3631f3b024fa54e7d7e',
    }, {
      fileContent: 'hello World!',
      filehash: 'e4ad0102dc2523443333d808b91a989b71c2439d7362aca6538d49f76baaa5ca',
    }, {
      fileContent: 'x'.repeat(MB100),
      filehash: 'b28c94b2195c8ed259f0b415aaee3f39b0b2920a4537611499fa044956917a21',
      hashBlocks: ['9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb'],
    }, {
      fileContent: 'x'.repeat(MB100) + 'y'.repeat(MB100),
      filehash: '4eb13de6d0eb98865b0028370cafe001afe19ebe961faa0ca227be3c9e282591',
      hashBlocks: ['9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb',
        '6d45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5'],
    }, {
      // failing test
      fileContent: 'x'.repeat(MB100) + 'y'.repeat(MB100),
      filehash: '4eb13de6d0eb98865b0028370cafe001afe19ebe961faa0ca227be3c9e282591',
      hashBlocks: ['AB31c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb',
        'AB45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5'],
      error: true,
    }];

    let i = 0;
    for (const test of testCases) {
      const foo: string = join(os.tmpdir(), `foo${i++}.txt`);
      fse.writeFileSync(foo, test.fileContent);
      if (test.error) {
        t.log(`Calculate '${foo}' and expect failing`);
        // eslint-disable-next-line no-await-in-loop
        t.false(await compareFileHash(foo, test.filehash, test.hashBlocks));
      } else {
        t.log(`Calculate '${foo}' and expect hash: ${test.filehash}`);
        // eslint-disable-next-line no-await-in-loop
        t.true(await compareFileHash(foo, test.filehash, test.hashBlocks));
      }
      fse.unlinkSync(foo);
    }
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('fss.writeSafeFile test', async (t) => {
  try {
    const tmpDir = fse.mkdtempSync(join(os.tmpdir(), 'snowtrack-'));
    const tmpFile = join(tmpDir, 'foo.txt');

    await fss.writeSafeFile(tmpFile, 'Foo1');
    t.true(fse.pathExistsSync(tmpFile));
    t.is(fse.readFileSync(tmpFile).toString(), 'Foo1');

    await fss.writeSafeFile(tmpFile, 'Foo2');
    t.true(fse.pathExistsSync(tmpFile));
    t.is(fse.readFileSync(tmpFile).toString(), 'Foo2');
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

async function performWriteLockCheckTest(t, fileCount: number) {
  if (fileCount === 0) {
    t.plan(1); // in that case t.true(true) is checked nothing is reported
  } else {
    t.plan(fileCount + 2); // +2 because of 2 additional checks for no-file-handle.txt and read-file-handle.txt
  }

  const tmp = join(process.cwd(), 'tmp');
  fse.ensureDirSync(tmp);

  const absDir = fse.mkdtempSync(join(tmp, 'snowtrack-'));

  const fileHandles = new Map<string, fse.WriteStream | fse.ReadStream | null>();

  const noFileHandleFile = 'no-file-handle.txt';
  const absNoFileHandleFilePath = join(absDir, noFileHandleFile);
  fse.writeFileSync(absNoFileHandleFilePath, 'no-file handle is on this file');
  fileHandles.set(noFileHandleFile, null);

  const readFileHandleFile = 'read-file-handle.txt';
  const absReadFileHandleFile = join(absDir, readFileHandleFile);
  fse.writeFileSync(absReadFileHandleFile, 'single read-handle is on this file');
  fileHandles.set(readFileHandleFile, fse.createReadStream(absReadFileHandleFile, { flags: 'r' }));

  for (let i = 0; i < fileCount; ++i) {
    const relName = `foo${i}.txt`;
    const absFile = join(absDir, relName);

    fileHandles.set(relName, fse.createWriteStream(absFile, { flags: 'w' }));
  }

  let stop = false;

  function parallelWrite() {
    fileHandles.forEach((fh: fse.ReadStream | fse.WriteStream) => {
      if (fh instanceof fse.WriteStream) {
        fh.write('123456789abcdefghijklmnopqrstuvwxyz\n');
      }
    });

    setTimeout(() => {
      if (stop) {
        t.log('Stop parallel writes');
      } else {
        parallelWrite();
      }
    });
  }

  parallelWrite();

  await sleep(500); // just to ensure on GitHub runners that all files were written to

  const ioContext = new IoContext();
  try {
    await ioContext.performFileAccessCheck(absDir, Array.from(fileHandles.keys()), TEST_IF.FILE_CAN_BE_READ_FROM);
    t.log('Ensure no file is reported as being written to');
    if (fileCount === 0) {
      t.true(true); // to satisfy t.plan
    }
  } catch (error) {
    if (error instanceof AggregateError) {
      const errorMessages: string[] = error.errors.map((e) => e.message);

      let i = 0;
      fileHandles.forEach((fh: fse.ReadStream | fse.WriteStream | null, path: string) => {
        if (fh instanceof fse.WriteStream) {
          if (i === 15) {
            t.log(`${fileCount - i} more to go...`);
          } else if (i < 15) {
            t.log(`Check if ${path} is detected as being written by another process`);
          }
          t.true(errorMessages[i++].includes(`File '${path}' is being written by`));
        } else if (!fh || fh instanceof fse.ReadStream) {
          t.log(`Ensure that ${path} is not being detected as being written by another process`);
          t.false(errorMessages.includes(`File ${path} is being written by`));
        }
      });
    } else {
      // any other error than AggregateError is unexpected
      throw error;
    }
  }

  stop = true;

  for (const [, handle] of fileHandles) {
    handle?.close();
  }
}

async function performReadLockCheckTest(t, fileCount: number) {
  t.plan(1); // every test results in 1 checked test

  const tmp = join(process.cwd(), 'tmp');
  fse.ensureDirSync(tmp);

  const absDir = fse.mkdtempSync(join(tmp, 'snowtrack-'));

  const fileHandles = new Map<string, fse.WriteStream | fse.ReadStream | null>();

  const noFileHandleFile = 'no-file-handle.txt';
  const absNoFileHandleFilePath = join(absDir, noFileHandleFile);
  fse.writeFileSync(absNoFileHandleFilePath, 'no-file handle is on this file');
  fileHandles.set(noFileHandleFile, null);

  for (let i = 0; i < fileCount; ++i) {
    const relName = `foo${i}.txt`;
    const absFile = join(absDir, relName);

    fse.writeFileSync(absFile, `file path content: ${absFile}`);
  }

  if (fileCount > 0) {
    // we create X files and add a file handler to the last file
    // because 'win-access.exe' was slow if only the last element
    // had the file handle
    const relName = `foo${fileCount - 1}.txt`;
    const absFile = join(absDir, relName);
    fileHandles.set(relName, fse.createReadStream(absFile, { flags: 'r' }));
  }

  await sleep(500); // just to ensure on GitHub runners that all files were written to

  const ioContext = new IoContext();
  try {
    await ioContext.performFileAccessCheck(absDir, Array.from(fileHandles.keys()), TEST_IF.FILE_CAN_BE_WRITTEN_TO);
    t.log('Ensure no file is reported as being written to');
    if (fileCount === 0) {
      t.true(true); // to satisfy t.plan
    }
  } catch (error) {
    t.log('Ensure that files are accessed by another process.');
    t.true(error.message.includes('Your files are accessed by'));
  }

  for (const [, handle] of fileHandles) {
    handle?.close();
  }
}

if (process.platform === 'win32') {
  test('performFileAccessCheck (read/write) / 0 file', async (t) => {
    try {
      await performReadLockCheckTest(t, 0);
    } catch (error) {
      t.fail(error.message);
    }
  });

  test('performFileAccessCheck (read/write) / 1 file', async (t) => {
    try {
      await performReadLockCheckTest(t, 1);
    } catch (error) {
      t.fail(error.message);
    }
  });

  test('performFileAccessCheck (read/write) / 100 file', async (t) => {
    try {
      await performReadLockCheckTest(t, 100);
    } catch (error) {
      t.fail(error.message);
    }
  });

  test('performFileAccessCheck (read/write) / 1000 file', async (t) => {
    try {
      await performReadLockCheckTest(t, 1000);
    } catch (error) {
      t.fail(error.message);
    }
  });

  test('performFileAccessCheck (read/write) / 10000 file', async (t) => {
    try {
      await performReadLockCheckTest(t, 10000);
    } catch (error) {
      t.fail(error.message);
    }
  });
}

test('performFileAccessCheck / 0 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 0);
  } catch (error) {
    t.fail(error.message);
  }
});

test('performFileAccessCheck / 1 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 1);
  } catch (error) {
    t.fail(error.message);
  }
});

test('performFileAccessCheck / 10 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 10);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performFileAccessCheck / 100 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 100);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performFileAccessCheck / 1000 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 1000);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performFileAccessCheck / no access', async (t) => {
  // Test to check if IoContext.performFileAccessCheck detects a file not being accessible because of missing chmod
  try {
    const tmp = join(process.cwd(), 'tmp');
    fse.ensureDirSync(tmp);

    const absDir = fse.mkdtempSync(join(tmp, 'snowtrack-'));

    const tmpFile = join(absDir, 'foo.txt');
    t.log(`Create ${tmpFile}`);
    fse.ensureFileSync(tmpFile);
    t.log(`Set chmod(444) for ${tmpFile}`);
    fse.chmodSync(tmpFile, fse.constants.S_IRUSR | fse.constants.S_IRGRP | fse.constants.S_IROTH);

    const ioContext = new IoContext();

    await t.notThrowsAsync(() => ioContext.performFileAccessCheck(absDir, ['foo.txt'], TEST_IF.FILE_CAN_BE_READ_FROM));

    const error2 = await t.throwsAsync(() => ioContext.performFileAccessCheck(absDir, ['foo.txt'], TEST_IF.FILE_CAN_BE_WRITTEN_TO));
    if (error2) {
      if (process.platform === 'win32' && error2.message.startsWith('EPERM: operation not permitted, access')) {
        t.log('succesfully detected foo.txt as not accessible');
        t.pass();
      } else if (process.platform !== 'win32' && error2.message.includes('permission denied')) {
        t.log('succesfully detected foo.txt as not accessible');
        t.pass();
      } else {
        throw new Error(`expected function to detect foo.txt as not accessible but received: ${error2.message}`);
      }
    } else {
      throw new Error('expected function to detect foo.txt as not accessible but function succeeded');
    }
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('constructTree', async (t) => {
  const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));

  const relPaths = [
    'foo',
    'bar/baz',
    'bar/goz',
    'bar/subdir/file1',
    'bar/subdir/file2',
    'bar/subdir/file3',
    'bar/subdir/file4',
    'bar/subdir/subdir1/file1',
    'bar/subdir/subdir1/file2',
  ];

  for (const f of relPaths) {
    t.log(`Create ${f}`);
    fse.ensureFileSync(join(tmpDir, f));
  }

  t.log('Construct a TreeDir of dir');
  const root = await constructTree(tmpDir);

  for (const relPath of relPaths) {
    const ditem = root.find(dirname(relPath));
    t.log(`Find '${relPath}' and received: '${ditem?.path}'`);
    t.true(ditem instanceof TreeDir);

    const item = root.find(relPath);
    t.log(`Find '${relPath}' and received: '${item?.path}'`);
    t.true(!!item);
    t.is(item?.path, relPath);
  }
});

test('TreeDir.clone', async (t) => {
  const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));

  const relPaths = [
    'foo', // has 3 bytes
    'bar/baz', // has 3 bytes
    'bar/goz', // has 3 bytes
    'bar/subdir/fileX', // has 5 bytes
    'bar/subdir/fileXX', // has 6 bytes
    'bar/subdir/fileXXX', // has 7 bytes
    'bar/subdir/fileXXXX', // has 8 bytes
    'bar/subdir/subdir1/file1', // has 5 bytes
    'bar/subdir/subdir1/file2', // has 5 bytes
  ];

  for (const f of relPaths) {
    t.log(`Create ${f}`);

    const absPath = join(tmpDir, f);
    fse.ensureFileSync(absPath);
    fse.writeFileSync(absPath, '.'.repeat(basename(f).length));
  }

  t.log('Construct a TreeDir of dir');
  const origRoot = await constructTree(tmpDir);
  const newRoot = origRoot.clone();

  // we modify each item in the original root tree and
  // check afterwards if the change spilled over to the clone tree
  TreeDir.walk(origRoot, (entry: TreeEntry) => {
    entry.path += '.xyz';
    entry.stats.size = 1234;
  });

  // Now check if all the items still have their old path
  for (const relPath of relPaths) {
    const item = newRoot.find(relPath);
    t.log(`Find '${relPath}' and received: '${item?.path}'`);
    t.is(item?.path, relPath);

    const expectedSize = basename(item.path).length;
    t.log(`Expect ${relPath} of size ${expectedSize} and received ${item.stats.size}`);
    t.is(item.stats.size, expectedSize);
  }
});

async function createTree(t, relPaths: string[]): Promise<[TreeDir, string]> {
  const tmpDir: string = fse.mkdtempSync(join(os.tmpdir(), 'snowtrack-'));

  for (const f of relPaths) {
    t.log(`Create ${f}`);

    const absPath = join(tmpDir, f);
    fse.ensureFileSync(absPath);
    fse.writeFileSync(absPath, '.'.repeat(basename(f).length));
  }

  const tree = await constructTree(tmpDir);
  return [tree, tmpDir];
}

test('TreeDir merge tree 1', async (t) => {
  // This test creates 1 tree, clones it, and merges it with itself

  const relPaths = [
    'foo-bar', // will have 7 bytes inside
    'xyz', // will have 3 bytes inside
  ];

  const [root0] = await createTree(t, relPaths);
  const root1 = root0.clone();

  const mergedRoots = TreeDir.merge(root0, root1);

  const root0Map = root0.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const root1Map = root1.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const mergedRootsMap = mergedRoots.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

  t.log(`Expected 2 elements in the tree, received ${mergedRootsMap.size}`);
  t.is(root0Map.size, 2);
  t.is(root1Map.size, 2);
  t.is(mergedRootsMap.size, 2);

  // there must be no difference between the merged array and our initial file list
  t.is(differenceBy(Array.from(mergedRootsMap.keys()), relPaths).length, 0);
});

test('TreeDir merge tree 2', async (t) => {
  // This test creates 2 trees, and merges them

  const relPaths0 = [
    'foo-bar', // will have 7 bytes inside
  ];
  const relPaths1 = [
    'xyz', // will have 3 bytes inside
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const root0Map = root0.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const root1Map = root1.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const mergedRootsMap = mergedRoots.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

  t.log(`Expected 1 elements in the first tree, received ${root0Map.size}`);
  t.is(root0Map.size, 1);
  t.log(`Expected 1 elements in the second tree, received ${root1Map.size}`);
  t.is(root1Map.size, 1);
  t.log(`Expected 2 elements in the merged tree, received ${mergedRootsMap.size}`);
  t.is(mergedRootsMap.size, 2);

  // there must be no difference between the merged array and our initial file lists
  t.is(differenceBy(Array.from(mergedRootsMap.keys()), relPaths0.concat(relPaths1)).length, 0);
});

test('TreeDir merge tree 3', async (t) => {
  // This test creates 2 trees, both with no intersection of subdirectories

  const relPaths0 = [
    'subdir0/a/b/foo-bar', // will have 7 bytes inside
  ];
  const relPaths1 = [
    'subdir1/a/b/xyz', // will have 3 bytes inside
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const firstChildren: string[] = mergedRoots.children.map((item: TreeEntry) => item.path);
  t.log(`The first children must be 'subdir0, subdir' and got '${firstChildren.join(',')}'`);
  t.is(differenceBy(['subdir0', 'subdir1'], firstChildren).length, 0);

  const mergedPaths = new Set<string>();
  TreeDir.walk(mergedRoots, (item: TreeEntry) => {
    t.log('Ensure that the tree is unique');
    t.true(!mergedPaths.has(item.path));
    mergedPaths.add(item.path);
  });

  const dir0 = mergedRoots.find('subdir0');
  t.log(`Expect subdir0 in size of 7 bytes and got ${dir0?.stats.size} bytes`);
  t.is(dir0?.stats.size, 7); // because of the filename 'foo-bar' we expect 7 bytes

  const dir1 = mergedRoots.find('subdir1');
  t.log(`Expect subdir1 in size of 3 bytes and got ${dir1?.stats.size} bytes`);
  t.is(dir1?.stats.size, 3); // because of the filename 'xyz' we expect 3 bytes
});

test('TreeDir merge tree 4', async (t) => {
  // This test creates 2 trees, both with same subdirectory but different files.
  // Test is to ensure that the subdir will have the correct size

  const relPaths0 = [
    'subdir/foo-bar', // will have 7 bytes inside
  ];
  const relPaths1 = [
    'subdir/xyz', // will have 3 bytes inside
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const file0 = mergedRoots.find(relPaths0[0]);
  t.true(file0 instanceof TreeFile);
  const file1 = mergedRoots.find(relPaths1[0]);
  t.true(file1 instanceof TreeFile);

  const subdir = mergedRoots.find('subdir');
  t.log(`Expect subdir in size of 10 bytes and got ${subdir?.stats.size} bytes`);
  t.is(subdir?.stats.size, 10); // because of the filename 'xyz'(3) + 'foo-bar'(7)
});

test('TreeDir merge tree 5', async (t) => {
  // This test creates 2 trees, where the left is empty

  const relPaths0 = [
  ];
  const relPaths1 = [
    'subdir1/xyz', // will have 3 bytes inside
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const root0Map = root0.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const root1Map = root1.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const mergedRootsMap = mergedRoots.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

  t.log(`Expected 0 elements in the first tree, received ${root0Map.size}`);
  t.is(root0Map.size, 0);
  t.log(`Expected 2 elements in the second tree, received ${root1Map.size}`);
  t.is(root1Map.size, 2);
  t.log(`Expected 2 elements in the merged tree, received ${mergedRootsMap.size}`);
  t.is(mergedRootsMap.size, 2);

  const dname = 'subdir1';
  const dir = mergedRootsMap.get(dname);
  const isdir = dir instanceof TreeDir;
  t.log(`Expect ${dname} to be a dir: ${isdir}`);
  t.true(isdir);

  const fname = relPaths1[0];
  const file = mergedRootsMap.get(fname);
  const isfile = file instanceof TreeFile;
  t.log(`Expect ${fname} to be a file: ${isfile}`);
  t.true(isfile);

  const dir1 = mergedRoots.find('subdir1');
  t.log(`Expect subdir1 in size of 3 bytes and got ${dir1?.stats.size} bytes`);
  t.is(dir1?.stats.size, 3); // because of the filename 'xyz' we expect 3 bytes
});

test('TreeDir merge tree 6', async (t) => {
  // This test creates 2 trees, where the right is empty

  const relPaths0 = [
    'subdir0/foo-bar', // will have 7 bytes inside
  ];
  const relPaths1 = [
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const root0Map = root0.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const root1Map = root1.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const mergedRootsMap = mergedRoots.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

  t.log(`Expected 2 elements in the first tree, received ${root0Map.size}`);
  t.is(root0Map.size, 2);
  t.log(`Expected 0 elements in the second tree, received ${root1Map.size}`);
  t.is(root1Map.size, 0);
  t.log(`Expected 2 elements in the merged tree, received ${mergedRootsMap.size}`);
  t.is(mergedRootsMap.size, 2);

  const dname = 'subdir0';
  const dir = mergedRootsMap.get(dname);
  const isdir = dir instanceof TreeDir;
  t.log(`Expect ${dname} to be a dir: ${isdir}`);
  t.true(isdir);

  const fname = relPaths0[0];
  const file = mergedRootsMap.get(fname);
  const isfile = file instanceof TreeFile;
  t.log(`Expect ${fname} to be a file: ${isfile}`);
  t.true(isfile);

  const dir1 = mergedRoots.find('subdir0');
  t.log(`Expect subdir1 in size of 7 bytes and got ${dir1?.stats.size} bytes`);
  t.is(dir1?.stats.size, 7); // because of the filename 'foo-bar' we expect 7 bytes
});

test('TreeDir merge tree 7', async (t) => {
  // This test creates 2 trees, where one elemtent is a dir in one tree, and a file in the other.
  // Expected is the merged tree to have a file located at 'foo/bar'

  const relPaths0 = [
    'foo/bar/bas',
    'foo/xyz',
  ];
  const relPaths1 = [
    'foo/bar',
    'foo/123',
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const root0Map = root0.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const root1Map = root1.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const mergedRootsMap = mergedRoots.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

  t.log(`Expected 4 elements in the first tree, received ${root0Map.size}`);
  t.is(root0Map.size, 4);
  t.log(`Expected 3 elements in the second tree, received ${root1Map.size}`);
  t.is(root1Map.size, 3);
  t.log(`Expected 4 elements in the merged tree, received ${mergedRootsMap.size}`);
  t.is(mergedRootsMap.size, 4);

  t.log("Check that 'foo' is a directory");
  t.true(mergedRoots.find('foo') instanceof TreeDir);

  t.log("Check that 'foo/xyz' is a file");
  t.true(mergedRoots.find('foo/xyz') instanceof TreeFile);

  t.log("Check that 'foo/123' is a file");
  t.true(mergedRoots.find('foo/123') instanceof TreeFile);

  t.log("Check that directory 'foo/bar' was replaced by the file 'foo/bar'");
  t.true(!mergedRoots.find('foo/bar/bas'));
});

test('TreeDir merge tree 8', async (t) => {
  // This test creates 2 bigger trees with new objects left and right and intersections

  const relPaths0 = [
    // conflict
    join('123/foo'),
    // intersections
    join('foo/a/file1'),
    join('bar/b/c/file2'),
    join('bar/b/d/file1'),
    // new
    join('x/file5'),
    join('y/1/file4'),
    join('y/1/2/file6'),
  ];
  const relPaths1 = [
    // conflict
    join('123'), // must survive
    // intersections
    join('foo/a/file1'),
    join('bar/b/c/file2'),
    join('bar/b/d/file1'),
    // new
    join('a/file5'),
    join('b/3/file4'),
    join('b/3/1/file6'),
  ];

  const [root0] = await createTree(t, relPaths0);
  const [root1] = await createTree(t, relPaths1);

  const mergedRoots = TreeDir.merge(root0, root1);

  const root0Map = root0.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const root1Map = root1.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
  const mergedRootsMap = mergedRoots.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });

  t.log('First Tree:');
  t.log('-'.repeat(20));
  TreeDir.walk(root0, (item: TreeEntry) => {
    const suffix = item.isFile() ? 'F' : 'D';
    t.log(`${' '.repeat(dirname(item.path).length) + item.path} (${suffix})`);
  });
  t.log('Second Tree:');
  t.log('-'.repeat(20));
  TreeDir.walk(root1, (item: TreeEntry) => {
    const suffix = item.isFile() ? 'F' : 'D';
    t.log(`${' '.repeat(dirname(item.path).length) + item.path} (${suffix})`);
  });
  t.log('Merged Tree:');
  t.log('-'.repeat(20));
  TreeDir.walk(mergedRoots, (item: TreeEntry) => {
    const suffix = item.isFile() ? 'F' : 'D';
    t.log(`${' '.repeat(dirname(item.path).length) + item.path} (${suffix})`);
  });

  t.log('-'.repeat(20));

  t.log(`Expected 18 elements in the first tree, received ${root0Map.size}`);
  t.is(root0Map.size, 18);
  t.log(`Expected 17 elements in the second tree, received ${root1Map.size}`);
  t.is(root1Map.size, 17);
  t.log(`Expected 24 elements in the merged tree, received ${mergedRootsMap.size}`);
  t.is(mergedRootsMap.size, 24);
});

test('TreeDir.remove 1', async (t) => {
  // test that nothing gets deleted

  const relPaths0 = [
    join('123/foo'),
  ];

  const [root0] = await createTree(t, relPaths0);

  t.log('Remove nothing');
  TreeDir.remove(root0, (): boolean => {
    return false;
  });

  t.log(`Ensure that only one element is available and got ${root0.children.length}`);
  t.is(root0.children.length, 1);
  t.true(root0.children[0] instanceof TreeDir);
  t.is(root0.children[0].path, '123');

  t.is((root0.children[0] as TreeDir).children.length, 1);
  t.true((root0.children[0] as TreeDir).children[0] instanceof TreeFile);
  t.is((root0.children[0] as TreeDir).children[0].path, '123/foo');
});

test('TreeDir.remove 2', async (t) => {
  // test that the single file gets deleted

  const relPaths0 = [
    join('123/foo'),
  ];

  const [root0] = await createTree(t, relPaths0);

  t.log('Remove everyting');
  TreeDir.remove(root0, (): boolean => {
    return true;
  });

  t.is(root0.children.length, 0);
});

test('TreeDir.remove 3', async (t) => {
  // test to delete a single file

  const relPaths0 = [
    join('123/foo'),
    join('123/bar'),
  ];

  const [root0] = await createTree(t, relPaths0);

  t.log('Remove 123/foo');
  TreeDir.remove(root0, (item: TreeEntry): boolean => {
    return item.path === '123/foo';
  });

  t.is(root0.children.length, 1);
  t.is((root0.children[0] as TreeDir).children.length, 1);
  t.is((root0.children[0] as TreeDir).children[0].path, '123/bar');
});

test('TreeDir.remove 4', async (t) => {
  // test to delete a single file

  const relPaths0 = [
    join('foo/bar'),
    join('foo/bas'),
    join('xyz/123'),
  ];

  const [root0] = await createTree(t, relPaths0);

  t.log('Remove foo');
  TreeDir.remove(root0, (item: TreeEntry): boolean => {
    return item.path === 'foo';
  });

  t.is(root0.children.length, 1);
  t.is((root0.children[0] as TreeDir).children.length, 1);
  t.is((root0.children[0] as TreeDir).children[0].path, 'xyz/123');
});

function shuffle(arr) {
  let len = arr.length;
  const d = len;
  const array = [];
  let k; let
    i;
  for (i = 0; i < d; i++) {
    k = Math.floor(Math.random() * len);
    array.push(arr[k]);
    arr.splice(k, 1);
    len = arr.length;
  }
  for (i = 0; i < d; i++) {
    arr[i] = array[i];
  }
  return arr;
}

test('TreeDir hash stability 1', (t) => {
  /*
  Python verification:
  import hashlib
  hasher = hashlib.sha256()
  hasher.update("9CC7221BC98C63669876B592A24D526BB26D4AC35DE797AA3571A6947CA5034E".encode("utf8")) # foo copy
  hasher.update("831f508de037020cd190118609f8c554fc9aebcc039349b9049d0a06b165195c".encode("utf8")) # foo1
  hasher.update("E375CA4D4D4A4A7BE19260FFF5540B02DF664059C0D76B89FC2E8DEA85A45B3E".encode("utf8")) # foo
  hasher.update("6DCF42C93219B9A1ADCE837B99FBFC80AAF9BA98EFF3A21FADCFFA2819F506C0".encode("utf8")) # foo3/abc
  dgst = hasher.hexdigest()
  print(dgst, dgst == '803b778e162664a586c5d720ab80a0f730211fd76e09be82325112c6c0bdd8ab')
  */

  const tree1 = new TreeFile('831f508de037020cd190118609f8c554fc9aebcc039349b9049d0a06b165195c',
    'foo1', { size: 0, ctime: new Date(0), mtime: new Date(0) }, '.ext', null);
  const tree2 = new TreeFile('9CC7221BC98C63669876B592A24D526BB26D4AC35DE797AA3571A6947CA5034E',
    'foo copy', { size: 0, ctime: new Date(0), mtime: new Date(0) }, '.ext', null);
  const tree3 = new TreeFile('6DCF42C93219B9A1ADCE837B99FBFC80AAF9BA98EFF3A21FADCFFA2819F506C0',
    'foo3/abc', { size: 0, ctime: new Date(0), mtime: new Date(0) }, '.ext', null);
  const tree4 = new TreeFile('E375CA4D4D4A4A7BE19260FFF5540B02DF664059C0D76B89FC2E8DEA85A45B3E',
    'foo4', { size: 0, ctime: new Date(0), mtime: new Date(0) }, '.ext', null);

  const hash = '75859dac2c7ece838134f7c50b67f119ec0636073a9fd19d0dc5ee0438c212d2';
  t.log(`All files must have the following hash: ${hash}`);

  for (let i = 0; i < 20; ++i) {
    const shuffledArray = shuffle([tree1, tree2, tree3, tree4]);
    const res = calculateSizeAndHash(shuffledArray);

    // Here we ensure that the hash of the tree entries is not dependend on their order
    const sortedArray = sortPaths(shuffledArray, (item) => item.path, '/');

    t.log(`Run ${i}: ${shuffledArray.map((item) => item.path).join(', ')} => ${sortedArray.map((item) => item.path)}`);
    t.log(res[1]);
    t.is(res[1], hash);
  }
});

test('Hash Integrity (Empty File)', async (t) => {
  const filename = join(os.tmpdir(), `snowfs-hash-unittest-${createRandomString(10)}`);
  t.log('Create a file of 0 bytes');
  fse.ensureFileSync(filename);

  const hashOriginal = await calculateFileHash(filename);
  t.log(`Expected e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, got ${hashOriginal.filehash}`);
  t.is(hashOriginal.filehash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('Hash Integrity (1-byte)', async (t) => {
  const filename = join(os.tmpdir(), `snowfs-hash-unittest-${createRandomString(10)}`);
  t.log('Create a file of 1 byte');
  fse.writeFileSync(filename, 'a');

  const hashOriginal1 = await calculateFileHash(filename);
  t.log(`Expected ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb, got ${hashOriginal1.filehash}`);
  t.is(hashOriginal1.filehash, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');

  t.log('Create another file of 1 byte');
  fse.writeFileSync(filename, 'b');

  const hashOriginal2 = await calculateFileHash(filename);
  t.log(`Expected 3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d, got ${hashOriginal2.filehash}`);
  t.is(hashOriginal2.filehash, '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d');

  t.not(hashOriginal1.filehash, hashOriginal2.filehash);
});

test('Hash Integrity Test 2', async (t) => {
  // This test creates a file of 100.000.000 bytes and modifies some
  // bytes at certain positions to assert the file hash changes

  const filename = join(os.tmpdir(), `snowfs-hash-unittest-${createRandomString(10)}`);
  t.log('Create a file of 100000000 bytes');
  fse.writeFileSync(filename, 'x'.repeat(100000000));

  t.log(`Calculate hash of ${filename}`);
  const hashOriginal1 = await calculateFileHash(filename);
  const hashOriginal2 = await calculateFileHash(filename);
  t.log(`Expected d15aa13358a8d5f90faa99d6e4f168f2f58101b2c7db3bdda96ca68694883c07, got ${hashOriginal1.filehash}`);
  t.is(hashOriginal1.filehash, hashOriginal2.filehash);
  t.is(hashOriginal1.filehash, 'd15aa13358a8d5f90faa99d6e4f168f2f58101b2c7db3bdda96ca68694883c07');

  async function test0() {
    // Copy1 (overwrite byte at position 99999998)
    const copy0 = `${filename}.copy0`;
    t.log('Create copy and overwrite byte at position 99999998');
    fse.copyFileSync(filename, copy0);
    const fh0 = fse.openSync(copy0, 'r+');
    fse.writeSync(fh0, new Uint8Array([0x65]), 0, 1, 99999998);
    fse.closeSync(fh0);
    const hashCopy0 = await calculateFileHash(copy0);
    t.log(hashCopy0.filehash);
    t.is(fse.statSync(copy0).size, 100000000); // just to ensure the file didn't change its size
    t.log(`Expected 4ed783a2bad9613bb60864b6e4a7825ac37ab634c1b42c35c3a054e440a211ad, got ${hashCopy0.filehash}`);
    t.is(hashCopy0.filehash, '4ed783a2bad9613bb60864b6e4a7825ac37ab634c1b42c35c3a054e440a211ad');
    fse.removeSync(copy0);
  }

  async function test1() {
    // Copy1 (overwrite byte at position 99999999)
    const copy1 = `${filename}.copy1`;
    t.log('Create copy and overwrite byte at position 99999999');
    fse.copyFileSync(filename, copy1);
    const fh1 = fse.openSync(copy1, 'r+');
    fse.writeSync(fh1, new Uint8Array([0x65]), 0, 1, 99999999);
    fse.closeSync(fh1);
    const hashCopy1 = await calculateFileHash(copy1);
    t.log(hashCopy1.filehash);
    t.is(fse.statSync(copy1).size, 100000000); // just to ensure the file didn't change its size
    t.log(`Expected a37da7994c24396ab37507ad0c7efd27945ee7b6662bffd60f959b17a45d722a, got ${hashCopy1.filehash}`);
    t.is(hashCopy1.filehash, 'a37da7994c24396ab37507ad0c7efd27945ee7b6662bffd60f959b17a45d722a');
    fse.removeSync(copy1);
  }

  async function test2() {
    // Copy2 (overwrite 2nd byte at position 1)
    const copy2 = `${filename}.copy2`;
    t.log('Create copy and overwrite byte at position 1');
    fse.copyFileSync(filename, copy2);
    const fh2 = fse.openSync(copy2, 'r+');
    fse.writeSync(fh2, new Uint8Array([0x65]), 0, 1, 1);
    fse.closeSync(fh2);
    const hashCopy2 = await calculateFileHash(copy2);
    t.log(hashCopy2.filehash);
    t.is(fse.statSync(copy2).size, 100000000); // just to ensure the file didn't change its size
    t.log(`Expected a901ca0c8fa3b3dc3946c50c59316c94d95e0504041fab7a82a11bef56a62479, got ${hashCopy2.filehash}`);
    t.is(hashCopy2.filehash, 'a901ca0c8fa3b3dc3946c50c59316c94d95e0504041fab7a82a11bef56a62479');
    fse.removeSync(copy2);
  }

  async function test3() {
    // Copy3 (overwrite 1st byte at position 0)
    const copy3 = `${filename}.copy3`;
    t.log('Create copy and overwrite byte at position 0');
    fse.copyFileSync(filename, copy3);
    const fh3 = fse.openSync(copy3, 'r+');
    fse.writeSync(fh3, new Uint8Array([0x65]), 0, 1, 0);
    fse.closeSync(fh3);
    const hashCopy3 = await calculateFileHash(copy3);
    t.log(hashCopy3.filehash);
    t.is(fse.statSync(copy3).size, 100000000); // just to ensure the file didn't change its size
    t.log(`Expected db10941e21bcc109dce822216a5bc37f133222643581f1b00e13828c7891efe7, got ${hashCopy3.filehash}`);
    t.is(hashCopy3.filehash, 'db10941e21bcc109dce822216a5bc37f133222643581f1b00e13828c7891efe7');
    fse.removeSync(copy3);
  }

  async function test4() {
    // Copy4 (append a single byte to file)
    t.log('Create copy and append byte');
    const copy4 = `${filename}.copy4`;
    fse.copyFileSync(filename, copy4);
    fse.appendFileSync(copy4, new Uint8Array([0x65]));
    const hashCopy4 = await calculateFileHash(copy4);
    t.log(hashCopy4.filehash);
    t.is(fse.statSync(copy4).size, 100000001); // ensures the file grew by 1 byte
    t.log(`Expected 41f21cfcc442e7c23a7387007bcb24dc82b4d2292669edb7f5bed091f296b4de, got ${hashCopy4.filehash}`);
    t.is(hashCopy4.filehash, '41f21cfcc442e7c23a7387007bcb24dc82b4d2292669edb7f5bed091f296b4de');
    fse.removeSync(copy4);
  }

  t.log('--');
  await test0();
  t.log('--');
  await test1();
  t.log('--');
  await test2();
  t.log('--');
  await test3();
  t.log('--');
  await test4();
});

test('Hash Integrity (Hash Block)', async (t) => {
  // The hash block size for a finger print is 100 MB
  // This test creates a file of 499.999.999 bytes where
  // block 1 and 3 are similar, and block 2 and 4.
  // The last block is similar to block 2 and 4 but has 1 byte less.
  // This test ensures the hash block of 1,3 and 2,4 are equal.

  const filename = join(os.tmpdir(), `snowfs-hash-unittest-${createRandomString(10)}`);
  t.log('Create a file of 499999999 bytes');
  fse.ensureFileSync(filename);
  fse.appendFileSync(filename, 'x'.repeat(100000000));
  fse.appendFileSync(filename, 'y'.repeat(100000000));
  fse.appendFileSync(filename, 'x'.repeat(100000000));
  fse.appendFileSync(filename, 'y'.repeat(100000000));
  fse.appendFileSync(filename, 'y'.repeat(99999999)); // last block has only 99.999.999 bytes
  const hashOriginal = await calculateFileHash(filename);
  t.log('Check 5 hash blocks');
  t.is(hashOriginal.hashBlocks.length, 5);
  t.log(`Expected 9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb and got ${hashOriginal.hashBlocks[0].hash}`);
  t.is(hashOriginal.hashBlocks[0].hash, '9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb');
  t.log(`Expected 6d45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5 and got ${hashOriginal.hashBlocks[1].hash}`);
  t.is(hashOriginal.hashBlocks[1].hash, '6d45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5');
  t.log(`Expected 9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb and got ${hashOriginal.hashBlocks[2].hash}`);
  t.is(hashOriginal.hashBlocks[2].hash, '9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb');
  t.log(`Expected 6d45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5 and got ${hashOriginal.hashBlocks[3].hash}`);
  t.is(hashOriginal.hashBlocks[3].hash, '6d45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5');
  t.log(`Expected 7729e12d6824bf7164aee4ed63fd736b6e5cf804aa01df83f178d0d25329926a and got ${hashOriginal.hashBlocks[4].hash}`);
  t.is(hashOriginal.hashBlocks[4].hash, '7729e12d6824bf7164aee4ed63fd736b6e5cf804aa01df83f178d0d25329926a');

  t.is(hashOriginal.filehash, 'cd20dd504a52128506897b7f89fe6e88722aac6283e6d3dc1a2ae4c8cd1647bc');
});

test('HashTest', async (t) => {
  const precaculatedHashes = [
    [0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    [1, '3973e022e93220f9212c18d0d0c543ae7c309e46640da93a4a0314de999f5112'],
    [2, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c'],
    [10, '590ccb73c8a4de29c964c2b9942276ea692f69ba18a38a53ef981edb91e916de'],
    [100, '7a4c731de37ee1fc22fc30ca452a3eb7a59efe1492df2887e399de26c43db1f8'],
    [5000, '23e9f874310efc0486e5ddb75cfff5e0e326beedabe81aef44ebba1367bebb40'],
    [505000, '481761e3572cfb647852a8c7a2fd92f9030e47cca266c39b83b017e0c3fde97f'],
    [1005000, 'c931ee3e04cfc3a1b8e2880c48821031221f76a01b799bd4629a1c538c3ff6db'],
    [1505000, 'bad8b489468c6ad0a9cb74cebe0310544f0228ff958dd0c0553279dbe9f49042'],
    [2005000, '57d1b1b275388314548f5dca5af5623f01726fff7802b71fa98702af5e768adb'],
    [2505000, 'af0ce51b8a62743886eaa2b6807446657cfa1a52da5e885b5349a2558f36bcbc'],
    [3005000, '195b404c40bd7365bb90493eb7af8b3b976db926d83ffc636a43fce9c99fdaa4'],
    [3505000, '8545b62eec043edcc7e281297f21f59739e086b6ab2b32fc0c45589bc21a3b38'],
    [4005000, 'ec4b6ceb0c7b526ddd1c561412ad42ca484ca23d8769f29844dd35de3c0afe0c'],
    [4505000, '1c3460c8f0bdd4e426e80330e0eb3ae98f09983efa1379c0b4bce400f3125456'],
    [5005000, '450a87e792918ea00faaf05ce3df43b254af4e9bcdde2f1a2e49e6043df76ed6'],
    [5505000, '6f00995070359ff14329d6b7ab9ec08ae0917954bd94513dd00e6203fd7d5f76'],
    [6005000, 'c22f599b10af88b16915dc74689cb94ecb092f827ffd1d35fa604ce78ce2548c'],
    [6505000, '112f519c0ff6a2cbe5f1f9319cde8d3c48ba59c7a7d3524cf2ba090b8a83a8b4'],
    [7005000, '12106beac70f43bfc7b95675c81fa69f972976128e7a91995598042d9eb85892'],
    [7505000, '7a0e6c66db49e092c5e375fdd290f6a0bcb7bfd037709e4e68b3b389010f45e0'],
    [8005000, '9a6f9b9263c651eb7864b58269ed8161c58823d620ff00eef3fdf2cd91869f61'],
    [8505000, '55ca6cf8e50920a6729469a24199148c4183e942dfc7bcf15a478f7df8af82d6'],
    [9005000, '3864847b1ed24d4bb48696a7b1f8c4115bd0e78efdfd67e171d2231fdef24e98'],
    [9505000, '04f5adf3b5df72b6b10eb2c203fd075649c44563b92bb3a76ea0f0937185c1f2'],
    [10005000, '718f8e0e97fe473ce899fdc53348138ba106bed86a49fb78eb79d29be84a38ce'],
    [10505000, '9e1d7ef63ca7a79e4efb1487379c016ee0e08a218358140772665b53abff0ac4'],
    [11005000, '998d32f826d61bff5fb2026ae844cc79b5356d62f8ec82066827d3df13c89730'],
    [11505000, '161b6c8f9b444bb1af36b2e01abca1cb777ef2cbc6fcd8d8d84b7f3a16b47479'],
    [12005000, 'e17734ff8defa24e5425fec572106207f35525dd012cee63783f74891e2aeb64'],
    [12505000, 'f8c19cbca9ce416e131392e6251735bc595e039318259fd7b0b9b0ee70df559b'],
    [13005000, '549a5f105ce1894850ac6e6fa31666399ca127b59dc0675e51604e3be1ef5d45'],
    [13505000, 'fd09f7e0ce342de77b2df107f1e83e6f23dc2d911642e9f7729d1025e3905eb1'],
    [14005000, '3563b9c6645921113fd1eee3aaf14bc8a7b16a45e5d8f551637f2aaf596a1817'],
    [14505000, '991bfa3150ddc039241b02a3e80932f7de64bbc3f54b24be0cd51fae85819d97'],
    [15005000, '67d4bb2883454ab187e514d3fd3956abee6396d42423cc0b5740cbdde33f4f9b'],
    [15505000, '454623ee200c6cb9d5ae3bac3d5fab6151c935353fc42584ae531263a8fb9ada'],
    [16005000, '013353c5785454da30db18fb3d864e65ecb46f77a961f5d47caa97cbb9c2def2'],
    [16505000, 'a19e2a595a7a7aef9b12001878cb506befbb5e2b60894aacf1fbaeba7c9b9eeb'],
    [17005000, '961e03c056cdda3160131a484e94a74da91643dab1e4dfad17d1ee66daa355c9'],
    [17505000, '78acc9f5aaae886cf5387b0393033ece9c4c78f7b2bd29176bf3bfbb969fb9ad'],
    [18005000, '115bc3b69770d145c7f2ea017225fc6074412cb912d8dc777c14a600ec628e6d'],
    [18505000, '842e7bb3263a35ba72fbcda6f1a94222c2fe2ac3c655d7d6c01543f28239540b'],
    [19005000, 'c975ec5186a4cc7643b4ff052a20da6a3193b3572aa360aee0a22c5d16fde9df'],
    [19505000, '62e4e69694bb174857c6d346b77a22b41ab90ad7bfc762615b3dc58add51320a'],
  ];

  const calculatedHashes = new Map<string, number>();

  for (const preHash of precaculatedHashes) {
    const i = preHash[0] as number;
    const filename: string = join(os.tmpdir(), `foo${i}.txt`);
    t.log(`Create file ${filename}`);
    if (i === 0) {
      fse.ensureFileSync(filename);
    } else {
      fse.writeFileSync(filename, '-'.repeat(i));
    }
    const res = await calculateFileHash(filename);
    if (calculatedHashes.has(res.filehash)) {
      throw new Error('hash already calculated');
    }
    calculatedHashes.set(res.filehash, i);
    t.log(`Expect hash ${preHash[1]} and received ${res.filehash}`);
    t.is(preHash[1], res.filehash);
  }
  t.pass();
});
