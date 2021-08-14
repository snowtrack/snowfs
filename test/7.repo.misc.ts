import test from 'ava';
import * as fse from 'fs-extra';
import { Index } from '../src';
import { Commit } from '../src/commit';
import { join } from '../src/path';
import { Reference } from '../src/reference';
import { REFERENCE_TYPE, Repository, RESET } from '../src/repository';
import { getRandomPath, shuffleArray } from './helper';

function createRepo1(): Promise<Repository> {
  let repo: Repository;
  let commit2: Commit;
  let commit3: Commit;
  const repoPath = getRandomPath();
  return Repository.initExt(repoPath, { defaultBranchName: 'Red Track' })
    .then((repoResult: Repository) => {
      repo = repoResult;
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 1', { allowEmpty: true });
    })
    .then(() => {
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 2', { allowEmpty: true });
    })
    .then((commit2Result: Commit) => {
      commit2 = commit2Result;
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 3', { allowEmpty: true });
    })
    .then((commit3Result: Commit) => {
      commit3 = commit3Result;
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 4', { allowEmpty: true });
    })
    .then(() => {
      return repo.createNewReference(REFERENCE_TYPE.BRANCH, 'Yellow Track', commit2.hash);
    })
    .then((ref: Reference) => {
      return repo.checkout(ref, RESET.DEFAULT);
    })
    .then(() => {
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 5', { allowEmpty: true });
    })
    .then(() => {
      return repo.createNewReference(REFERENCE_TYPE.BRANCH, 'Blue Track', commit3.hash);
    })
    .then((ref: Reference) => {
      return repo.checkout(ref, RESET.DEFAULT);
    })
    .then(() => {
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 6', { allowEmpty: true });
    })
    .then(() => {
      const index: Index = repo.ensureMainIndex();
      return repo.createCommit(index, 'commit 7', { allowEmpty: true });
    })
    .then(() => {
      return repo;
    });
}

test('Repository.baisc.fail', async (t) => {
  // Making merging to unrelated repos fail
  t.plan(2);
  const repo1: Repository = await createRepo1();
  const repo2: Repository = await createRepo1();
  const error = t.throws(() => Repository.merge(repo1, repo2));
  t.is(error.message, 'refusing to merge unrelated histories');
});

function shuffleRepoMembers(repo: Repository): void {
  // shuffle members in commit map
  const commitArray = Array.from(repo.commitMap.values());
  repo.commitMap = new Map(shuffleArray(commitArray).map((c: Commit) => [c.hash, c]));

  repo.references = shuffleArray(repo.references);
}

test.only('Repository.basic1', async (t) => {
  // Create a simple linear repo, clone it, delete a commit, and finally merge
  // On top, we shuffle the commits inside the commit map to ensure the output
  // of Repository.merge is always deterministic

  const repo1: Repository = await createRepo1();
  const repo2path = getRandomPath();
  fse.copySync(repo1.workdir(), repo2path, { recursive: true });
  const repo2: Repository = await Repository.open(repo2path);
  await repo2.deleteCommit('HEAD~1');

  for (let i = 0; i < 10; ++i) {
    shuffleRepoMembers(repo1);
    shuffleRepoMembers(repo2);

    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2);
    t.is(merge1.commits.size, 8);

    console.log(join(repo1.commondir(), 'objects').replace(/\//g, '\\'));
    fse.rmdirSync(join(repo1.commondir(), 'versions'), { recursive: true });
    fse.rmdirSync(join(repo1.commondir(), 'refs'), { recursive: true });
    fse.ensureDirSync(join(repo1.commondir(), 'versions'));
    fse.ensureDirSync(join(repo1.commondir(), 'refs'));

    for (const commit of Array.from(merge1.commits.values())) {
      // eslint-disable-next-line no-await-in-loop
      await repo1.getOdb().writeCommit(commit);
    }

    for (const ref of Array.from(merge1.refs.values())) {
      // eslint-disable-next-line no-await-in-loop
      await repo1.getOdb().writeReference(ref);
    }

    const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1);
    t.is(merge2.commits.size, 8);
  }
  t.pass();
});
