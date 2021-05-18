import test from 'ava';
import * as fse from 'fs-extra';
import * as io from '../src/io';
import { Index } from '../src';
import { join } from '../src/path';

import {
  FILTER, Repository, STATUS, StatusEntry,
} from '../src/repository';
import { getRandomPath } from './helper';

test('Status empty', async (t) => {
  // Test an empty directory
  const repoPath = getRandomPath();

  t.log('Create empty repo');
  await Repository.initExt(repoPath)
    .then((repo: Repository) => {
      return repo.getStatus(FILTER.ALL);
    }).then((statuses: StatusEntry[]) => {
      t.is(statuses.length, 0);
      return Promise.resolve();
    });
});

test('status + 1 file', async (t) => {
  // Test a simple file
  const repoPath = getRandomPath();

  await Repository.initExt(repoPath)
    .then((repo: Repository) => {
      t.log("Write 'foo' with 5 bytes");
      fse.writeFileSync(join(repoPath, 'foo'), 'hello');

      return repo.getStatus(FILTER.ALL);
    }).then((statuses: StatusEntry[]) => {
      t.is(statuses.length, 1);
      t.is(statuses[0].path, 'foo');
      return Promise.resolve();
    });
});

test('simple status test with new repo', async (t) => {
  // test first 1 file, then another one in a subdirectory
  const repoPath = getRandomPath();

  const subdir = join(repoPath, 'subdir1', 'subdir2');

  let repo: Repository;
  await Repository.initExt(repoPath)
    .then((repoResult: Repository) => {
      repo = repoResult;

      fse.ensureDirSync(subdir);
      t.log("Write 'subdir1/subdir2/foo' with 9 bytes");
      fse.writeFileSync(join(subdir, 'foo'), 'foo123456');

      t.log('getStatus on all elements, including directories');
      return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
    }).then((statuses: StatusEntry[]) => {
      t.is(statuses.length, 3);

      t.is(statuses[0].path, 'subdir1');
      t.true(statuses[0].isdir);
      t.is(statuses[0].statusBit(), STATUS.WT_NEW);

      t.is(statuses[1].path, 'subdir1/subdir2');
      t.true(statuses[1].isdir);
      t.is(statuses[1].statusBit(), STATUS.WT_NEW);

      t.is(statuses[2].path, 'subdir1/subdir2/foo');
      t.true(!statuses[2].isdir);
      t.is(statuses[2].statusBit(), STATUS.WT_NEW);
      t.is(statuses[2].stats.size, 9);

      t.log('getStatus on all elements, excluding directories');
      return repo.getStatus(FILTER.INCLUDE_UNTRACKED
                            | FILTER.INCLUDE_MODIFIED
                            | FILTER.INCLUDE_DELETED
                            | FILTER.INCLUDE_UNMODIFIED
                            | FILTER.SORT_CASE_SENSITIVELY);
    }).then((statuses: StatusEntry[]) => {
      t.is(statuses.length, 1);

      t.is(statuses[0].path, 'subdir1/subdir2/foo');
      t.true(!statuses[0].isdir);
      t.is(statuses[0].statusBit(), STATUS.WT_NEW);
      t.is(statuses[0].stats.size, 9);

      t.log("Write 'subdir1/subdir2/foo1' with 6 bytes");
      fse.writeFileSync(join(subdir, 'foo1'), 'xyz123');

      t.log('getStatus on all elements, excluding directories');
      return repo.getStatus(FILTER.INCLUDE_UNTRACKED
                            | FILTER.INCLUDE_MODIFIED
                            | FILTER.INCLUDE_DELETED
                            | FILTER.INCLUDE_UNMODIFIED
                            | FILTER.SORT_CASE_SENSITIVELY);
    })
    .then((statuses: StatusEntry[]) => {
      t.is(statuses.length, 2);

      t.is(statuses[0].path, 'subdir1/subdir2/foo');
      t.true(!statuses[0].isdir);
      t.is(statuses[0].statusBit(), STATUS.WT_NEW);
      t.is(statuses[0].stats.size, 9);

      t.is(statuses[1].path, 'subdir1/subdir2/foo1');
      t.true(!statuses[1].isdir);
      t.is(statuses[1].statusBit(), STATUS.WT_NEW);
      t.is(statuses[1].stats.size, 6);
    });
});

test.only('100.000 files status test', async (t) => {
  // This test has two intentions. First, to ensure getStatus works with 100.000 files in general.
  // More specifically, by creating 100.000 files is a nice distribution of timestamps and therefore
  // we can also ensure all the timestamp handling within getStatus works as expected as well.
  const repoPath = getRandomPath();

  const subdir = join(repoPath, 'subdir1', 'subdir2');

  const fileSample = 100;

  let testFile1: string;
  let testFile2: string;
  let testFile3: string;

  let repo: Repository;
  let index: Index;
  await Repository.initExt(repoPath)
    .then((repoResult: Repository) => {
      repo = repoResult;

      const addedFiles: string[] = [];
      index = repo.ensureMainIndex();

      fse.ensureDirSync(subdir);
      t.log("Write 'subdir1/subdir2/foo' with 9 bytes");
      for (let i = 0; i < fileSample; ++i) {
        const relPath = join(subdir, `foo${i}`);
        addedFiles.push(relPath);
        if (i === 5000) {
          testFile1 = relPath;
        } else if (i === 5001) {
          testFile2 = relPath;
        } else if (i === 5002) {
          testFile3 = relPath;
        }
        fse.writeFileSync(relPath, i.toString());
      }

      index.addFiles(addedFiles);

      return index.writeFiles();
    }).then(() => {
      return repo.createCommit(index, 'Foo');
    }).then(() => {
      t.log('getStatus on all elements, including directories');
      return repo.getStatus(FILTER.ALL);
    })
    .then((statuses: StatusEntry[]) => {
      t.is(statuses.length, fileSample + 2); // + 2 for the subdirectories subdir1 + subdir2

      t.log('getStatus on all elements, excluding directories');
      return repo.getStatus(FILTER.INCLUDE_UNTRACKED
                            | FILTER.INCLUDE_MODIFIED
                            | FILTER.INCLUDE_DELETED);
    })
    .then((statuses: StatusEntry[]) => {
      t.is(statuses.length, 0);
      // modify the test file
      return io.utimes(testFile1, new Date(), new Date());
    });
});
