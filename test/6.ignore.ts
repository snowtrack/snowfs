import test from 'ava';

import * as crypto from 'crypto';
import * as os from 'os';
import * as fse from 'fs-extra';

import { join } from '../src/path';
import { getRandomPath } from './helper';
import { FILTER, Repository, StatusEntry } from '../src/repository';

function createFiles(workdir : string, ...names : string[]) {
  for (let i = 0; i < names.length; i++) {
    const f = join(workdir, names[i]);
    fse.createFileSync(f);
  }
}

test('Ignore single file in root', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath, 'ignore-me.txt');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'ignore-me.txt');

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
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'ignore-me.txt');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 5);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file1.txt'));
    t.true(files.includes('file2.txt'));
    t.true(files.includes('file3.txt'));
    t.true(files.includes('file4.txt'));
  });
});

test('Ignore *.txt', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.foo');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, '*.txt');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 2);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file5.foo'));
  });
});

test('Ignore subdirectory', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.foo'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 6);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file1.txt'));
    t.true(files.includes('file2.txt'));
    t.true(files.includes('file3.txt'));
    t.true(files.includes('file4.txt'));
    t.true(files.includes('file5.txt'));
  });
});

test('Ignore nested subdirectory', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'),
      join('subdir', 'subdir', 'file1.txt'),
      join('subdir', 'subdir', 'file2.txt'),
      join('subdir', 'subdir', 'file3.txt'),
      join('subdir', 'subdir', 'file4.txt'),
      join('subdir', 'subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir/subdir');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 11);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file1.txt'));
    t.true(files.includes('file2.txt'));
    t.true(files.includes('file3.txt'));
    t.true(files.includes('file4.txt'));
    t.true(files.includes('file5.txt'));
    t.true(files.includes('subdir/file1.txt'));
    t.true(files.includes('subdir/file2.txt'));
    t.true(files.includes('subdir/file3.txt'));
    t.true(files.includes('subdir/file4.txt'));
    t.true(files.includes('subdir/file5.txt'));
  });
});

test('Ignore comments in ignore', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'),
      join('subdir', 'subdir', 'file1.txt'),
      join('subdir', 'subdir', 'file2.txt'),
      join('subdir', 'subdir', 'file3.txt'),
      join('subdir', 'subdir', 'file4.txt'),
      join('subdir', 'subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, '// subsubdir\nsubdir/subdir\n/*subdir*/');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 11);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file1.txt'));
    t.true(files.includes('file2.txt'));
    t.true(files.includes('file3.txt'));
    t.true(files.includes('file4.txt'));
    t.true(files.includes('file5.txt'));
    t.true(files.includes('subdir/file1.txt'));
    t.true(files.includes('subdir/file2.txt'));
    t.true(files.includes('subdir/file3.txt'));
    t.true(files.includes('subdir/file4.txt'));
    t.true(files.includes('subdir/file5.txt'));
  });
});

test('Ignore inline comments in ignore', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'),
      join('subdir', 'subdir', 'file1.txt'),
      join('subdir', 'subdir', 'file2.txt'),
      join('subdir', 'subdir', 'file3.txt'),
      join('subdir', 'subdir', 'file4.txt'),
      join('subdir', 'subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'sub/*comment*/dir');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 6);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file1.txt'));
    t.true(files.includes('file2.txt'));
    t.true(files.includes('file3.txt'));
    t.true(files.includes('file4.txt'));
    t.true(files.includes('file5.txt'));
  });
});

test('Ignore inverse', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir\n!subdir/file5.txt');

    return repo.getStatus(FILTER.ALL);
  }).then((items: StatusEntry[]) => {
    const files = items.map((value: StatusEntry) => value.path);
    t.is(files.length, 7);
    t.true(files.includes('.snowignore'));
    t.true(files.includes('file1.txt'));
    t.true(files.includes('file2.txt'));
    t.true(files.includes('file3.txt'));
    t.true(files.includes('file4.txt'));
    t.true(files.includes('file5.txt'));
    t.true(files.includes('subdir/file5.txt'));
  });
});
