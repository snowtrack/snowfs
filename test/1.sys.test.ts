import * as path from 'path';
import * as fse from 'fs-extra';
import * as os from 'os';
import * as fs from 'fs';
import * as unzipper from 'unzipper';

import test from 'ava';

import {
  join, relative, dirname, sep,
} from 'path';
import { DirItem, OSWALK, osWalk } from '../src/io';
import { getRepoDetails, LOADING_STATE, properNormalize } from '../src/common';

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
    for (const p of dir.split(path.sep)) {
      sumPath = join(sumPath, p);
      visitedPaths.add(sumPath);
    }
  }
  return Array.from(visitedPaths).sort();
}

test('osWalk test#1', async (t) => {
  try {
    /// //////////////////////////////////////////////////////////////////////////
    t.log('Create a set of directories and verify with osWalk(returnDirs=true, returnFiles=false)');
    /// //////////////////////////////////////////////////////////////////////////
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-'));
    await createDirs(t, tmpDir, exampleDirs);

    const items: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS);

    const res1: string[] = getUniquePaths(exampleDirs);
    const res2: string[] = getUniquePaths(
      items.map((value: DirItem) => relative(tmpDir, value.path)),
    );

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
      t.log(`  ${item.path}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.path.endsWith(sep));

      t.true(item.path.search(/\/\//) === -1); // search for //
      t.true(item.path.search(/\\\//) === -1); // search for \\/
      t.true(item.path.search(/\/\\/) === -1); // search for /\\
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
    const tmpDir: string = await fse.mkdtemp(join(os.tmpdir(), 'snowtrack-')) + path.sep;
    await createDirs(t, tmpDir, exampleDirs);
    for (let file of exampleFiles) {
      file = join(tmpDir, file);
      t.log(`Create file: ${file}`);
      fse.ensureFileSync(file);
    }

    const items: DirItem[] = await osWalk(tmpDir, OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);

    const res1: string[] = getUniquePaths(exampleFiles.concat(exampleDirs));
    const res2: string[] = items
      .map((value: DirItem) => relative(tmpDir, value.path))
      .sort();

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
      t.log(`  ${item.path}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.path.endsWith(sep));

      t.true(item.path.search(/\/\//) === -1); // search for //
      t.true(item.path.search(/\\\//) === -1); // search for \\/
      t.true(item.path.search(/\/\\/) === -1); // search for /\\
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
    const res2: string[] = items
      .map((value: DirItem) => relative(tmpDir, value.path))
      .sort();

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
      t.log(`  ${item.path}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.path.endsWith(sep));
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
    const res2: string[] = items
      .map((value: DirItem) => relative(tmpDir, value.path))
      .sort();

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
      t.log(`  ${item.path}`);
      /// //////////////////////////////////////////////////////////////////////////
      t.false(item.path.endsWith(sep));
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

async function testGitZip(t, zipname: string): Promise<string> {
  const snowtrack: string = join(os.tmpdir(), 'foo');

  let tmpDir: string;
  return fse
    .mkdirp(snowtrack)
    .then(() => fse.mkdtemp(join(snowtrack, 'snowtrack-')))
    .then((tmpDirResult: string) => {
      tmpDir = tmpDirResult;
      const gitanddstPath: string = join(__dirname, zipname);
      t.log(`Unzip: ${zipname}`);
      return unzipper.Open.buffer(fs.readFileSync(gitanddstPath));
    })
    .then((d) => d.extract({ path: tmpDir, concurrency: 5 }))
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
  async function runTest(filepath: string = '', errorMessage?: string) {
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

test('getRepoDetails (.git and .snowtrack)', async (t) => {
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
          const expect = LOADING_STATE.SNOWTRACK;
          if (res.state === expect) {
            t.log('Project got detected as snowtrack - as expected');
          }
          t.is(res.state, expect);

          res.commondir = properNormalize(res.commondir);

          t.is(res.commondir, properNormalize(join(tmpDir, '.snow')));
          t.log(`Found .snowtrack in ${res.commondir}`);
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

test('getRepoDetails (parent of .git and .snowtrack)', async (t) => {
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
