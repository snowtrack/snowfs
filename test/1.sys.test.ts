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
  compareFileHash, getRepoDetails, LOADING_STATE, MB100,
} from '../src/common';
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

test('proper normalize', async (t) => {
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
      fileContent: () => string;
      filehash: string;
      hashBlocks?: string[],
      error?: boolean
    }
    const testCases: TestCase[] = [{
      fileContent: () => '',
      filehash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }, {
      fileContent: () => 'hello World',
      filehash: 'db4067cec62c58bf8b2f8982071e77c082da9e00924bf3631f3b024fa54e7d7e',
    }, {
      fileContent: () => 'hello World!',
      filehash: 'e4ad0102dc2523443333d808b91a989b71c2439d7362aca6538d49f76baaa5ca',
    }, {
      fileContent: () => 'x'.repeat(MB100),
      filehash: 'b28c94b2195c8ed259f0b415aaee3f39b0b2920a4537611499fa044956917a21',
      hashBlocks: ['9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb'],
    }, {
      fileContent: () => 'x'.repeat(MB100) + 'y'.repeat(MB100),
      filehash: '4eb13de6d0eb98865b0028370cafe001afe19ebe961faa0ca227be3c9e282591',
      hashBlocks: ['9031c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb',
        '6d45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5'],
    }, {
      // failing test
      fileContent: () => 'x'.repeat(MB100) + 'y'.repeat(MB100),
      filehash: '4eb13de6d0eb98865b0028370cafe001afe19ebe961faa0ca227be3c9e282591',
      hashBlocks: ['AB31c1664d8691097a77580cb1141ba470054f87d48af18bd18ecc5ca0121adb',
        'AB45d1fc2a13245c09b2dd875145ef55d8d06921cbdffe5c5bfcc6901653ddc5'],
      error: true,
    }];

    let i = 0;
    for (const test of testCases) {
      const foo: string = join(os.tmpdir(), `foo${i++}.txt`);
      fse.writeFileSync(foo, test.fileContent());
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
          t.true(errorMessages[i++].includes(`File '${path}' is written by`));
        } else if (!fh || fh instanceof fse.ReadStream) {
          t.log(`Ensure that ${path} is not being detected as being written by another process`);
          t.false(errorMessages.includes(`File ${path} is written by`));
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
    console.error(error);
    t.fail(error.message);
  }
});

test('performFileAccessCheck / 1 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 1);
  } catch (error) {
    console.error(error);
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
