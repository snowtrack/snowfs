import * as fse from 'fs-extra';

import test from 'ava';

import { join, dirname } from '../src/path';
import { Commit } from '../src/commit';
import { Index } from '../src/index';
import { DirItem, OSWALK, osWalk } from '../src/io';
import { Reference } from '../src/reference';
import { COMMIT_ORDER, Repository } from '../src/repository';
import { createRandomFile, getRandomPath, rmDirRecursive } from './helper';
import { TreeEntry } from '../src/treedir';

async function repoTest(t, commondirInside: boolean) {
  const repoPath = getRandomPath();

  let repo: Repository;
  let index: Index;
  let foopath1: string;
  let foopath2: string;
  if (commondirInside) {
    await Repository.initExt(repoPath);
  } else {
    const commondir = getRandomPath();
    await Repository.initExt(repoPath, { commondir: `${commondir}.external-snow` });
  }

  const firstCommitMessage = 'Add Foo';
  const secondCommitMessage = 'Delete Foo';
  await Repository.open(repoPath)
    .then(async (repoResult: Repository) => {
      repo = repoResult;
      index = repo.ensureMainIndex();
      foopath1 = join(repo.workdir(), 'foo');

      const file1 = await createRandomFile(foopath1, 2048);
      index.addFiles([file1.filepath]);

      // index uses an internal set. So this is an additional check
      // to ensure addFiles doesn't add the file actually twice
      index.addFiles([file1.filepath]);

      foopath2 = join(repo.workdir(), 'subdir', 'bar');
      fse.ensureDirSync(dirname(foopath2));
      const file2 = await createRandomFile(foopath2, 2048);
      index.addFiles([file2.filepath]);

      return index.writeFiles();
    }).then(() => repo.createCommit(repo.getFirstIndex(), firstCommitMessage))
    .then((commit: Commit) => {
      t.is(commit.message, firstCommitMessage, 'commit message');
      t.true(Boolean(commit.parent), "Commit has a parent 'Created Project'");
      t.is(commit.root.children.length, 2, 'one file in root dir, one subdir');

      const filenames = Array.from(commit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true }).keys());
      t.true(filenames.includes('foo'));
      t.true(filenames.includes('subdir'));
      t.true(filenames.includes('subdir/bar'));

      return osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN | OSWALK.BROWSE_REPOS);
    })
    .then((dirItems: DirItem[]) => {
      if (commondirInside) {
        t.is(dirItems.length, 24, 'expect 24 items');
      } else {
        t.is(dirItems.length, 4, 'expect 3 items (foo + subdir + subdir/bar + .snow)');
      }

      t.true(fse.pathExistsSync(join(repo.commondir(), 'HEAD')), 'HEAD reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'config')), 'repo must contain a config file');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'hooks')), 'repo must contain a hooks directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'objects')), 'repo must contain an objects directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs')), 'repo must have a refs directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs', 'Main')), 'Main reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'versions')), 'repo must have a version directory');
      /* and a few more
          .snow
          .snow/config
          .snow/HEAD
          .snow/hooks
          .snow/objects
          .snow/objects/8e1760c0354228ce59e0c7b4356a933778823f40d8de89f56046cfa44e4667c1
          .snow/objects/tmp
          .snow/refs
          .snow/refs/Main
          .snow/versions
          .snow/versions/20c3bc6257fd094295c8c86abb921c20985843a7af4b5bee8f9ab978a8bb70ab
          .snow/versions/e598bbca7aa9d50f174e977cbc707292a7324082b45a9d078f45e892f670c9db
        */

      // Reference checks
      const head: Reference = repo.getHead();
      t.is(head.getName(), 'Main', 'Default branch must be Main');
      t.false(head.isDetached(), 'Default branch must not be detached');

      // Commit checks
      const commit: Commit = repo.getCommitByHead();
      t.is(repo.getAllCommits(COMMIT_ORDER.UNDEFINED).length, 2);
      t.is(commit.message, firstCommitMessage);

      return osWalk(join(repo.commondir(), 'versions'), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 2, 'expect 2 versions (Create Project + Version where foo got added)');
      return fse.unlink(foopath1);
    })
    .then(() => {
      index = repo.ensureMainIndex();
      index.deleteFiles([foopath1]);
      return index.writeFiles();
    })
    .then(() => repo.createCommit(repo.getFirstIndex(), secondCommitMessage))
    .then((commit: Commit) => {
      t.is(commit.message, secondCommitMessage, 'commit message');
      t.true(Boolean(commit.parent), "Commit has a parent 'Created Project'");
      t.is(commit.root.children.length, 1, 'no file anymore in root dir');

      return osWalk(join(repo.commondir(), 'versions'), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 3, 'expect 3 versions (Create Project + Version where foo got added and where foo got deleted)');
      return osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    })
    .then((dirItems: DirItem[]) => {
      t.is(dirItems.length, 2, 'expect 2 items (subdir and subdir/bar)'); // foo got deleted

      t.true(fse.pathExistsSync(join(repo.commondir(), 'HEAD')), 'HEAD reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'config')), 'repo must contain a config file');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'hooks')), 'repo must contain a hooks directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'objects')), 'repo must contain an objects directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs')), 'repo must have a refs directory');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'refs', 'Main')), 'Main reference');
      t.true(fse.pathExistsSync(join(repo.commondir(), 'versions')), 'repo must have a version directory');
      /*
          .snow/hooks
          .snow
          .snow/config
          .snow/HEAD
          .snow/objects
          .snow/objects/c89df5c29949cb021e75efb768dcd5413f57da0bf69a644824b86c066b964ca5
          .snow/objects/tmp
          .snow/refs
          .snow/refs/Main
          .snow/versions
          .snow/versions/3b884181f8919e113e69f82e0d3e0f0d610b5087e5bc1e202f380d83029694ee
          .snow/versions/812da2a9e3116f6134d84d1743b655f1452ef8b2bcd42f6b747b555b8c059dc5
          .snow/versions/c5f79ed5edfd5dcb27d4bfd61d115f4b242f8b647393c4dd441dec7c48673d53
        */
    })
    .then(() => // cleanup unit-test
      rmDirRecursive(repo.workdir()))
    .then((): Promise<void> => // cleanup unit-test
      rmDirRecursive(repo.commondir()));
}

test('repo open-commondir-outside', async (t) => {
  /* This test creates a repo, and creates 2 commits.
  1st commit: Add file 'foo'
  2nd commit: Delete file  'foo'
  */
  await repoTest(t, false);
});

test('repo open-commondir-inside', async (t) => {
  /* This test creates a repo, and creates 2 commits.
  1st commit: Add file 'foo'
  2nd commit: Delete file  'foo'
  */
  await repoTest(t, true);
});

test('custom-commit-data', async (t) => {
  /*
  Add a file and attach user-data to the commit
  */
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;
    return fse.writeFile(join(repo.workdir(), 'foo.txt'), 'Hello World!');
  }).then(() => {
    const index = repo.ensureMainIndex();
    index.addFiles(['foo.txt']);
    return index.writeFiles();
  }).then(() => {
    const index = repo.getFirstIndex();
    return repo.createCommit(index, 'This is a commit with custom-data', {}, [], { hello: 'world', foo: 'bar', bas: 3 });
  })
    .then((commit: Commit) => {
      t.log('User Data of commit', commit.userData);
      t.is(commit.userData.hello, 'world');
      t.is(commit.userData.foo, 'bar');
      t.is(commit.userData.bas, 3);
    });

  await Repository.open(repoPath).then((repo: Repository) => {
    const lastCommit = repo.getAllCommits(COMMIT_ORDER.NEWEST_FIRST)[0];
    t.is(lastCommit.userData.hello, 'world');
    t.is(lastCommit.userData.foo, 'bar');
    t.is(lastCommit.userData.bas, 3);
  });
});

test('commit hash subdirectory test', async (t) => {
  /*
  createCommit contains a hash to ensure that all items commited have a hash, even in subdirectories.
  This test ensures no exception is thrown.
  */
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;
    return fse.ensureFile(join(repo.workdir(), 'a', 'b', 'c', 'd', 'e', 'foo.txt'));
  }).then(() => {
    const index = repo.ensureMainIndex();
    index.addFiles(['a/b/c/d/e/foo.txt']);
    return index.writeFiles();
  }).then(() => {
    const index = repo.getFirstIndex();
    return repo.createCommit(index, 'This is a commit with several subdirectories');
  })
    .then((commit: Commit) => {
      // The hash is already verified inside `createCommit`, but we check here again, just in case `createCommit` gets some changes in the future
      const items: Map<string, TreeEntry> = commit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
      items.forEach((item: TreeEntry) => {
        t.true(!!item.hash);
      });
      t.pass();
    });
});

function makeCommit(repo: Repository, message: string): Promise<Commit> {
  return fse.writeFile(join(repo.workdir(), 'foo.txt'), message)
    .then(() => {
      const index = repo.ensureMainIndex();
      index.addFiles(['foo.txt']);
      return index.writeFiles();
    }).then(() => {
      const index = repo.getFirstIndex();
      return repo.createCommit(index, message);
    });
}

test('HEAD~n', async (t) => {
  const repoPath = getRandomPath();
  const repo = await Repository.initExt(repoPath);
  const commit1: Commit = await makeCommit(repo, '1st-commit');
  const commit2: Commit = await makeCommit(repo, '2nd-commit');
  const commit3: Commit = await makeCommit(repo, '3rd-commit');
  const commit4: Commit = await makeCommit(repo, '4th-commit');
  const commit5: Commit = await makeCommit(repo, '5th-commit');

  let res: Commit;

  t.log('Test HEAD~0');
  res = repo.findCommitByHash('HEAD~0');
  t.is(res.hash, commit5.hash);

  t.log('Test HEAD~1');
  res = repo.findCommitByHash('HEAD~1');
  t.is(res.hash, commit4.hash);

  t.log('Test Main~1');
  res = repo.findCommitByHash('Main~1');
  t.is(res.hash, commit4.hash);

  t.log('Test HEAD~2');
  res = repo.findCommitByHash('HEAD~2');
  t.is(res.hash, commit3.hash);

  t.log('Test HEAD~3');
  res = repo.findCommitByHash('HEAD~3');
  t.is(res.hash, commit2.hash);

  t.log('Test HEAD~4');
  res = repo.findCommitByHash('HEAD~4');
  t.is(res.hash, commit1.hash);

  t.log('Test HEAD~1~2');
  res = repo.findCommitByHash('HEAD~1~2'); // ~1~2 ==> 3 commits back from HEAD
  t.is(res.hash, commit2.hash);

  t.log('Test HEAD~1~1~1~1');
  res = repo.findCommitByHash('HEAD~1~1~1~1'); // ~1~1~1~1 ==> 4 commits back from HEAD
  t.is(res.hash, commit1.hash);
});

test('HEAD~n --- ERROR INPUTS', async (t) => {
  const repoPath = getRandomPath();
  const repo = await Repository.initExt(repoPath);

  t.log('Test HEAD~A for failure');
  const error0 = t.throws(() => repo.findCommitByHash('HEAD~A'));
  t.is(error0.message, "invalid commit-hash 'HEAD~A'");

  t.log('Test HEAD~6 for failure');
  const error1 = t.throws(() => repo.findCommitByHash('HEAD~6'));
  t.is(error1.message, "commit hash 'HEAD~6' out of history");
});
