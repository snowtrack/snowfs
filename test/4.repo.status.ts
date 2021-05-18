import test from 'ava';
import * as fse from 'fs-extra';
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