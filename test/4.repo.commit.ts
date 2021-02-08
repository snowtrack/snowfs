import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fse from 'fs-extra';

import test from 'ava';
import os from 'os';

import { join } from 'path';
import { Commit } from '../src/commit';
import { calculateFileHash, HashBlock } from '../src/common';
import { Index } from '../src/index';
import { DirItem, OSWALK, osWalk } from '../src/io';
import { Reference } from '../src/reference';
import { Repository } from '../src/repository';

function getRandomPath(): string {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const name = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
    const repoPath = join(os.tmpdir(), 'snowtrack-repo', name);
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

function getRandomInt(max: number) {
  return Math.floor(Math.random() * Math.floor(max));
}

function createRandomString(length: number) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

async function createRandomFile(dst: string, size: number): Promise<{filepath: string, filehash: string, hashBlocks?: HashBlock[]}> {
  const stream = fse.createWriteStream(dst, { flags: 'w' });
  for (let i = 0; i < size; ++i) {
    stream.write(createRandomString(size));
  }

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      resolve(dst);
    });
    stream.on('error', (error) => {
      reject(error);
    });
    stream.end();
  }).then(() => calculateFileHash(dst))
    .then((res: {filehash: string, hashBlocks?: HashBlock[]}) => ({ filepath: dst, filehash: res.filehash, hashBlocks: res.hashBlocks }));
}

async function repoTest(t, commondirInside: boolean) {
  const repoPath = getRandomPath();

  let repo: Repository;
  let index: Index;
  let foopath: string;
  if (commondirInside) {
    await Repository.initExt(repoPath);
  } else {
    const commondir = getRandomPath();
    await Repository.initExt(repoPath, { commondir });
  }

  const firstCommitMessage = 'Add Foo';
  const secondCommitMessage = 'Delete Foo';
  await Repository.open(repoPath)
    .then((repoResult: Repository) => {
      repo = repoResult;
      index = repo.getIndex();
      foopath = join(repo.workdir(), 'foo');

      return createRandomFile(foopath, 2048);
    })
    .then((res: {filepath: string, filehash: string, hashBlocks?: HashBlock[]}) => {
      index.addFiles([res.filepath]);

      // index uses an internal set. So this is an additional check
      // to ensure addFiles doesn't add the file actually twice
      index.addFiles([res.filepath]);

      return index.writeFiles();
    }).then(() => repo.createCommit(repo.getIndex(), firstCommitMessage))
    .then((commit: Commit) => {
      t.is(commit.message, firstCommitMessage, 'commit message');
      t.true(Boolean(commit.parent), "Commit has a parent 'Created Project'");
      t.is(commit.root.children.length, 1, 'one file in root dir');
      t.is(commit.root.children[0].path, 'foo');

      return osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      if (commondirInside) {
        t.is(dirItems.length, 13, 'expect 13 items');
      } else {
        t.is(dirItems.length, 2, 'expect 2 items (foo + .snowtrack)');
      }

      t.true(fse.pathExistsSync(join(repo.commondir(), 'HEAD')), 'HEAD reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'config')), 'repo must contain a config file');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'hooks')), 'repo must contain a hooks directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'objects')), 'repo must contain an objects directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs')), 'repo must have a refs directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs', 'Main')), 'Main reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'versions')), 'repo must have a version directory');
      /* and a few more
          .snowtrack
          .snowtrack/config
          .snowtrack/HEAD
          .snowtrack/hooks
          .snowtrack/objects
          .snowtrack/objects/8e1760c0354228ce59e0c7b4356a933778823f40d8de89f56046cfa44e4667c1
          .snowtrack/objects/tmp
          .snowtrack/refs
          .snowtrack/refs/Main
          .snowtrack/versions
          .snowtrack/versions/20c3bc6257fd094295c8c86abb921c20985843a7af4b5bee8f9ab978a8bb70ab
          .snowtrack/versions/e598bbca7aa9d50f174e977cbc707292a7324082b45a9d078f45e892f670c9db
        */

      // Reference checks
      const head: Reference = repo.getHead();
      t.is(head.getName(), 'Main', 'Default branch must be Main');
      t.false(head.isDetached(), 'Default branch must not be detached');

      // Commit checks
      const commit: Commit = repo.getCommitByHead();
      t.is(repo.getAllCommits().length, 2);
      t.is(commit.message, firstCommitMessage);

      return osWalk(join(repo.commondir(), 'versions'), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 2, 'expect 2 versions (Create Project + Version where foo got added)');
      return fse.unlink(foopath);
    })
    .then(() => {
      index.deleteFiles([foopath]);
      return index.writeFiles();
    })
    .then(() => repo.createCommit(repo.getIndex(), secondCommitMessage))
    .then((commit: Commit) => {
      t.is(commit.message, secondCommitMessage, 'commit message');
      t.true(Boolean(commit.parent), "Commit has a parent 'Created Project'");
      t.is(commit.root.children.length, 0, 'no file anymore in root dir');

      return osWalk(join(repo.commondir(), 'versions'), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 3, 'expect 3 versions (Create Project + Version where foo got added and where foo got deleted)');
      return osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.true(fse.pathExistsSync(join(repo.commondir(), 'HEAD')), 'HEAD reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'config')), 'repo must contain a config file');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'hooks')), 'repo must contain a hooks directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'objects')), 'repo must contain an objects directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs')), 'repo must have a refs directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs', 'Main')), 'Main reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'versions')), 'repo must have a version directory');
      /*
          .snowtrack/hooks
          .snowtrack
          .snowtrack/config
          .snowtrack/HEAD
          .snowtrack/objects
          .snowtrack/objects/c89df5c29949cb021e75efb768dcd5413f57da0bf69a644824b86c066b964ca5
          .snowtrack/objects/tmp
          .snowtrack/refs
          .snowtrack/refs/Main
          .snowtrack/versions
          .snowtrack/versions/3b884181f8919e113e69f82e0d3e0f0d610b5087e5bc1e202f380d83029694ee
          .snowtrack/versions/812da2a9e3116f6134d84d1743b655f1452ef8b2bcd42f6b747b555b8c059dc5
          .snowtrack/versions/c5f79ed5edfd5dcb27d4bfd61d115f4b242f8b647393c4dd441dec7c48673d53
        */
    })
    .then(() => // cleanup unit-test
      rmDirRecursive(repo.workdir()))
    .then((): Promise<void> => // cleanup unit-test
      rmDirRecursive(repo.commondir()));
}

test('repo open-commondir-inside', async (t) => {
  /* This test creates a repo, and creates 2 commits.
  1st commit: Add file 'foo'
  2nd commit: Delete file  'foo'
  */
  await repoTest(t, true);
});

test('repo open-commondir-outside', async (t) => {
  /* This test creates a repo, and creates 2 commits.
  1st commit: Add file 'foo'
  2nd commit: Delete file  'foo'
  */
  await repoTest(t, false);
});
