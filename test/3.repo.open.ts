import test from 'ava';
import * as fse from 'fs-extra';
import { join } from '../src/path';
import { getRandomPath } from './helper';

import { rmdir } from '../src/io';
import { Repository } from '../src/repository';
import { testRepoCommondirInside, testRepoCommondirOutside } from './2.repo.init';

test('repo open-commondir-outside', async (t) => {
  const repoPath = getRandomPath();
  const commondir = getRandomPath();

  let repo: Repository;
  t.log(`Initialize repo at ${repoPath}`);
  await Repository.initExt(repoPath, { commondir });

  await Repository.open(repoPath)
    .then((repoResult: Repository) => {
      repo = repoResult;
      t.log(`Opened repo at ${repo.workdir()}`);
      t.log(`Found commondir at ${repo.commondir()}`);
      return testRepoCommondirOutside(t, repo);
    })
    .then(() => rmdir(repo.workdir()))
    .then(() => rmdir(repo.commondir()));
});

test('repo open-commondir-outside-subdirectory', async (t) => {
  /* Create a repository with a subdirectory and open the repo from the subdirectory.
  The test ensures that Repository.open travels up the hierarchy to find the next .snow repo */
  const repoPath = getRandomPath();
  const commondir = getRandomPath();

  let repo: Repository;
  t.log(`Initialize repo at ${repoPath}`);
  await Repository.initExt(repoPath, { commondir });

  // create directory and open the repo from the sub-directory
  const fooDir = join(repoPath, 'foo');
  fse.mkdirpSync(fooDir);
  await Repository.open(fooDir)
    .then((repoResult: Repository) => {
      repo = repoResult;
      t.log(`Opened repo at ${repo.workdir()}`);
      t.log(`Found commondir at ${repo.commondir()}`);
      t.is(repoResult.workdir(), repoPath, 'expect repository being opened from subdirectory');
    })
    .then(() => rmdir(repo.workdir()))
    .then(() => rmdir(repo.commondir()));
});

test('repo open-commondir-inside', async (t) => {
  const repoPath = getRandomPath();

  let repo: Repository;
  t.log(`Initialize repo at ${repoPath}`);
  await Repository.initExt(repoPath);

  await Repository.open(repoPath)
    .then((repoResult: Repository) => {
      repo = repoResult;
      t.log(`Opened repo at ${repo.workdir()}`);
      t.log(`Found commondir at ${repo.commondir()}`);
      return testRepoCommondirInside(t, repo);
    })
    .then(() => rmdir(repo.workdir()));
});

test('repo open-commondir-inside-subdirectory', async (t) => {
  /* Create a repository with a subdirectory and open the repo from the subdirectory.
  The test ensures that Repository.open travels up the hierarchy to find the next .snow repo */
  const repoPath = getRandomPath();

  let repo: Repository;
  t.log(`Initialize repo at ${repoPath}`);
  await Repository.initExt(repoPath);

  // create directory and open the repo from the sub-directory
  const fooDir = join(repoPath, 'foo');
  fse.mkdirpSync(fooDir);
  await Repository.open(fooDir)
    .then((repoResult: Repository) => {
      repo = repoResult;
      t.log(`Opened repo at ${repo.workdir()}`);
      t.log(`Found commondir at ${repo.commondir()}`);
      t.is(repoResult.workdir(), repoPath, 'expect repository being opened from subdirectory');
    })
    .then(() => rmdir(repo.workdir()));
});

test('repo open-repo-workdir-commondir-collision-test', async (t) => {
  /** This test ensures that Repository.initExt never overwrites another repo if executed on the same directory */
  let workdir: string;
  let commondir: string;

  // create repo
  workdir = getRandomPath();
  await Repository.initExt(workdir);
  // attempt to create repo at same location
  const error1 = await t.throwsAsync(async () => Repository.initExt(workdir));
  t.is(error1.message, 'workdir already exists');

  // create repo
  workdir = getRandomPath();
  commondir = getRandomPath();
  await Repository.initExt(workdir, { commondir });
  // create repo at another location but with same commondir
  workdir = getRandomPath();
  const error2 = await t.throwsAsync(async () => Repository.initExt(workdir, { commondir }));
  t.is(error2.message, 'commondir already exists');

  // create repo
  workdir = getRandomPath();
  commondir = getRandomPath();
  await Repository.initExt(workdir, { commondir });
  // attempt to use different commondirs but same workdir
  commondir = getRandomPath();
  const error3 = await t.throwsAsync(async () => Repository.initExt(workdir, { commondir }));
  t.is(error3.message, 'workdir already exists');
});
