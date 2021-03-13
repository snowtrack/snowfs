import test from 'ava';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fse from 'fs-extra';

import { tmpdir } from 'os';
import { join } from 'path';
import { Commit } from '../src/commit';
import { DirItem, OSWALK, osWalk } from '../src/io';
import { Reference } from '../src/reference';
import { COMMIT_ORDER, Repository } from '../src/repository';

function createRepoPath(): string {
  while (true) {
    const name = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
    const repoPath = join(tmpdir(), 'snowtrack-repo', name);
    if (!fse.pathExistsSync(repoPath)) {
      return repoPath;
    }
  }
}

async function rmDirRecursive(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.rmdir(dir, { recursive: true }, (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

test('repo commondir', async (t) => {
  const repoPath = createRepoPath();
  const commondirInside = repoPath;

  const error1 = await t.throwsAsync(async () => Repository.initExt(repoPath, { commondir: commondirInside }));
  t.is(error1.message, 'commondir must be outside repository');
  t.false(fse.pathExistsSync(repoPath), 'repo must not exist yet');

  const error2 = await t.throwsAsync(async () => Repository.initExt(repoPath, { commondir: join(commondirInside, 'inside') }));
  t.is(error2.message, 'commondir must be outside repository');
  t.false(fse.pathExistsSync(repoPath), 'repo must not exist yet');

  const commondirOutside = createRepoPath();
  const error3 = await t.notThrowsAsync(async () =>
    Repository.initExt(repoPath, { commondir: commondirOutside }));
  t.is(error3, undefined, 'no error expected');
  t.true(fse.pathExistsSync(repoPath), 'repo must have been created');
});

export async function testRepoCommondirOutside(t, repo: Repository) {
  return osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN)
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 1, 'expect .snow reference in workdir');

      return osWalk(repo.commondir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 9, 'expected .snow reference with 9 elements inside');

      t.true(fse.pathExistsSync(join(repo.commondir(), 'HEAD')), 'HEAD reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'config')), 'repo must contain a config file');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'hooks')), 'repo must contain a hooks directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'objects')), 'repo must contain an objects directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs')), 'repo must have a refs directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs', 'Main')), 'Main reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'indexes')), 'repo must contain an index directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'versions')), 'repo must have a version directory');
      // t.true(fse.pathExistsSync(join(repo.commondir(), "versions", "4d3bbbc06afa29bd9287f22c813436a6cb9593f7a00196c5d81714dffe1e9b9b")),
      // "repo must contain a config file");

      // Reference checks
      const head: Reference = repo.getHead();
      t.is(head.getName(), 'Main', 'Default branch must be Main');
      t.false(head.isDetached(), 'Default branch must not be detached');

      // Commit checks
      const commit: Commit = repo.getCommitByHead();
      t.is(repo.getAllCommits(COMMIT_ORDER.UNDEFINED).length, 1, 'repo has 1 default commit');
      t.is(commit.message, 'Created Project');
    });
}

export async function testRepoCommondirInside(t, repo: Repository) {
  return osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN).then((dirItems: DirItem[]) => {
    t.is(dirItems.length, 9 + 1, 'expect .snow reference in workdir (+1 for .snow)');

    t.true(fse.pathExistsSync(join(repo.commondir(), 'HEAD')), 'HEAD reference');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'config')), 'repo must contain a config file');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'hooks')), 'repo must contain a hooks directory');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'indexes')), 'repo must contain a index directory');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'objects')), 'repo must contain an objects directory');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'refs')), 'repo must have a refs directory');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'refs', 'Main')), 'Main reference');
    t.true(fse.pathExistsSync(join(repo.commondir(), 'versions')), 'repo must have a version directory');

    // Reference checks
    const head: Reference = repo.getHead();
    t.is(head.getName(), 'Main', 'Default branch must be Main');
    t.false(head.isDetached(), 'Default branch must not be detached');

    // Commit checks
    const commit: Commit = repo.getCommitByHead();
    t.is(repo.getAllCommits(COMMIT_ORDER.UNDEFINED).length, 1, 'repo has 1 default commit');
    t.is(commit.message, 'Created Project');
  });
}

test('repo init-commondir-outside', async (t) => {
  const repoPath = createRepoPath();
  const commondir = createRepoPath();

  let repo: Repository;
  await Repository.initExt(repoPath, { commondir })
    .then((repoResult: Repository) => {
      repo = repoResult;
      return testRepoCommondirOutside(t, repo);
    })
    .then(() => // cleanup unit-test
      rmDirRecursive(repo.workdir()))
    .then((): Promise<void> => // cleanup unit-test
      rmDirRecursive(repo.commondir()));
});

test('repo init-commondir-inside', async (t) => {
  const repoPath = createRepoPath();

  let repo: Repository;
  await Repository.initExt(repoPath)
    .then((repoResult: Repository) => {
      repo = repoResult;
      return testRepoCommondirInside(t, repo);
    })
    .then(() => // cleanup unit-test
      rmDirRecursive(repo.workdir()))
    .then((): Promise<void> => // cleanup unit-test
      rmDirRecursive(repo.commondir()));
});
