import test from 'ava';
import * as fse from 'fs-extra';
import { join } from '../src/path';
import { getRandomPath } from './helper';

import {
  DirItem, OSWALK, osWalk, rmdir,
} from '../src/io';
import { COMMIT_ORDER, Repository } from '../src/repository';
import { testRepoCommondirInside, testRepoCommondirOutside } from './2.repo.init';
import { Commit } from '../src/commit';

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

test.only('repo open-repo ignore temp files', async (t) => {
  // this unit-tests ensures that temp files in 'refs' or 'versions' are ignored upon opening a repo
  let repo: Repository;

  // create repo
  const workdir = getRandomPath();
  repo = await Repository.initExt(workdir);

  const refsDir: string = join(repo.commondir(), 'refs');
  const versionsDir: string = join(repo.commondir(), 'versions');

  const dirItems: DirItem[] = await osWalk(versionsDir, OSWALK.FILES);
  t.is(dirItems.length, 1); // expect only the root commit

  t.log("Creating invalid ref name 'Main.tmp' and '.Main'");
  fse.copyFileSync(join(refsDir, 'Main'), join(refsDir, 'Main.tmp'));
  fse.copyFileSync(join(refsDir, 'Main'), join(refsDir, '.Main'));

  t.log(`Creating invalid commit ${dirItems[0].relPath}.tmp`);
  fse.copyFileSync(dirItems[0].absPath, `${dirItems[0].absPath}.tmp`);
  t.log("Creating invalid commit '.F0E4C2F76C58916EC258F246851BEA091D14D4247A2FC3E18694461B1816E13B'");
  fse.copyFileSync(dirItems[0].absPath, join(versionsDir, '.F0E4C2F76C58916EC258F246851BEA091D14D4247A2FC3E18694461B1816E13B'));

  repo = await Repository.open(workdir);

  t.is(repo.getAllReferences().length, 1);
  const refNames = repo.getAllReferenceNames()[0];
  t.log(`Got following ref names (expect 1): ${refNames}`);
  t.is(refNames, 'Main');

  const commits: Commit[] = repo.getAllCommits(COMMIT_ORDER.UNDEFINED);
  t.is(commits.length, 1);
  t.log(`Got following commits (expect 1): ${commits.map((x) => x.message)}`);
  t.is(commits[0].message, 'Created Project');
});
