import * as fse from 'fs-extra';
import * as os from 'os';
import * as unzipper from 'unzipper';

import test from 'ava';

import {
  join, dirname, normalize, normalizeExt, sep,
} from '../src/path';
import * as fss from '../src/fs-safe';
import { DirItem, OSWALK, osWalk } from '../src/io';
import { IoContext } from '../src/io_context';
import {
  compareFileHash, getRepoDetails, LOADING_STATE, MB100,
} from '../src/common';

const AggregateError = require('es-aggregate-error');

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

const LOG_DIRECTORY: string = 'Check getRepoDetails(..) with directory path';
const LOG_FILE: string = 'Check getRepoDetails(..) with  filepath:';

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
    let sumPath: string = '';
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
    const tmpDir: string = `${await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'))}/`;
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
  function runTest(filepath: string = '', errorMessage?: string) {
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
  async function runTest(filepath: string = '') {
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
  async function runTest(filepath: string = '') {
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

async function sleep(delay) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, delay);
  });
}

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

  const noFileHandleFile: string = 'no-file-handle.txt';
  const absNoFileHandleFilePath = join(absDir, noFileHandleFile);
  fse.writeFileSync(absNoFileHandleFilePath, 'no-file handle is on this file');
  fileHandles.set(noFileHandleFile, null);

  const readFileHandleFile: string = 'read-file-handle.txt';
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
    await ioContext.performWriteLockChecks(absDir, Array.from(fileHandles.keys()));
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
}

test('performWriteLockChecks / 0 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 0);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performWriteLockChecks / 1 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 1);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performWriteLockChecks / 10 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 10);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performWriteLockChecks / 100 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 100);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performWriteLockChecks / 1000 file', async (t) => {
  try {
    await performWriteLockCheckTest(t, 1000);
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});

test('performWriteLockChecks / no access', async (t) => {
  try {
    const tmp = join(process.cwd(), 'tmp');
    fse.ensureDirSync(tmp);

    const absDir = fse.mkdtempSync(join(tmp, 'snowtrack-'));

    const tmpFile = join(absDir, 'foo.txt');
    t.log(`Create ${tmpFile}`);
    fse.ensureFileSync(tmpFile);
    t.log(`Set chmod(444) for ${tmpFile}`);
    fse.chmodSync(tmpFile, fse.constants.O_RDONLY);

    const ioContext = new IoContext();
    const error = await t.throwsAsync(() => ioContext.performWriteLockChecks(absDir, ['foo.txt']));
    if (error) {
      if (process.platform === 'win32' && error.message.startsWith('EPERM: operation not permitted, access')) {
        t.log('succesfully detected foo.txt as not accessible');
        t.pass();
      } else if (process.platform !== 'win32' && error.message.includes('permission denied')) {
        t.log('succesfully detected foo.txt as not accessible');
        t.pass();
      } else {
        throw new Error(`expected function to detect foo.txt as not accessible but received: ${error.message}`);
      }
    } else {
      throw new Error('expected function to detect foo.txt as not accessible but function succeeded');
    }
  } catch (error) {
    console.error(error);
    t.fail(error.message);
  }
});
