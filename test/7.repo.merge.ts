import test from 'ava';
import { assert } from 'console';
import * as fse from 'fs-extra';
import { Index } from '../src';
import { Commit } from '../src/commit';
import { join } from '../src/path';
import { Reference } from '../src/reference';
import { REFERENCE_TYPE, Repository, RepositoryInitOptions, RESET } from '../src/repository';
import { getRandomPath, shuffleArray } from './helper';

function createRepo(): Promise<Repository> {
  let repo: Repository;
  let commit2: Commit;
  let commit3: Commit;
  const repoPath = getRandomPath();
  return Repository.initExt(repoPath, { defaultBranchName: 'Red Track' })
    .then((repoResult: Repository) => {
      repo = repoResult;
      return repo.createCommit(null, 'commit 1', { allowEmpty: true });
    })
    .then(() => {
      return repo.createCommit(null, 'commit 2', { allowEmpty: true });
    })
    .then((commit2Result: Commit) => {
      commit2 = commit2Result;
      return repo.createCommit(null, 'commit 3', { allowEmpty: true });
    })
    .then((commit3Result: Commit) => {
      commit3 = commit3Result;
      return repo.createCommit(null, 'commit 4', { allowEmpty: true });
    })
    .then(() => {
      return repo.createNewReference(REFERENCE_TYPE.BRANCH, 'Yellow Track', commit2.hash);
    })
    .then((ref: Reference) => {
      return repo.checkout(ref, RESET.DEFAULT);
    })
    .then(() => {
      return repo.createCommit(null, 'commit 5', { allowEmpty: true });
    })
    .then(() => {
      return repo.createNewReference(REFERENCE_TYPE.BRANCH, 'Blue Track', commit3.hash);
    })
    .then((ref: Reference) => {
      return repo.checkout(ref, RESET.DEFAULT);
    })
    .then(() => {
      return repo.createCommit(null, 'commit 6', { allowEmpty: true });
    })
    .then(() => {
      return repo.createCommit(null, 'commit 7', { allowEmpty: true });
    })
    .then(() => {
      return repo;
    });
}

function shuffleRepoMembers(repo: Repository): void {
  // shuffle members in commit map
  const commitArray = Array.from(repo.commitMap.values());
  repo.commitMap = new Map(shuffleArray(commitArray).map((c: Commit) => [c.hash, c]));

  repo.references = shuffleArray(repo.references);
}

test('Repository.getRootCommit', async (t) => {
  t.plan(11);

  const repo: Repository = await createRepo();
  
  for (let i = 0; i < 10; ++i) {
    shuffleRepoMembers(repo);

    const firstCommit = Repository.getRootCommit(repo.commitMap);
    t.is(firstCommit.message, 'Created Project');
  }

  const ret = Repository.getRootCommit(new Map());
  t.is(ret, undefined);
});

test('Repository.sortCommits', async (t) => {
  t.plan(90);

  const repo: Repository = await createRepo();
  
  for (let i = 0; i < 10; ++i) {
    shuffleRepoMembers(repo);

    const sortedCommits = Repository.sortCommits(repo.commitMap);
    const commits: Commit[] = Array.from(sortedCommits.values());

    t.is(sortedCommits.size, 8);
    t.is(commits[0].message, 'Created Project');
    t.is(commits[1].message, 'commit 1');
    t.is(commits[2].message, 'commit 2');
    t.is(commits[3].message, 'commit 3');
    t.is(commits[4].message, 'commit 4');
    t.is(commits[5].message, 'commit 5');
    t.is(commits[6].message, 'commit 6');
    t.is(commits[7].message, 'commit 7');
  }
});

test('Repository.findLeafCommits', async (t) => {
  t.plan(40);

  const repo: Repository = await createRepo();
  
  for (let i = 0; i < 10; ++i) {
    shuffleRepoMembers(repo);

    const leafCommits = Repository.findLeafCommits(repo.commitMap);
    const commits: Commit[] = Array.from(leafCommits.values())
      .sort((a: Commit, b: Commit) => a.message > b.message ? 1 : -1);

    t.is(leafCommits.size, 3);

    t.is(commits[0].message, 'commit 4');
    t.is(commits[1].message, 'commit 5');
    t.is(commits[2].message, 'commit 7');
  }
});

test('Repository.basic.fail', async (t) => {
  // Making merging to unrelated repos fail
  t.plan(2);
  const repo1: Repository = await createRepo();
  const repo2: Repository = await createRepo();
  const error = t.throws(() => Repository.merge(repo1, repo2));
  t.is(error.message, 'refusing to merge unrelated histories');
});

test('Repository.merge1', async (t) => {
  t.plan(21);

  // Create a simple linear repo, clone it, delete a commit, and finally merge
  // On top, we shuffle the commits inside the commit map to ensure the output
  // of Repository.merge is always deterministic

  const repo1: Repository = await createRepo();
  const repo2path = getRandomPath();
  fse.copySync(repo1.workdir(), repo2path, { recursive: true });
  const repo2: Repository = await Repository.open(repo2path);
  await repo2.deleteCommit('HEAD~1'); // delete 'commit 6'

  for (let i = 0; i < 10; ++i) {
    shuffleRepoMembers(repo1);
    shuffleRepoMembers(repo2);

    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2);
    t.is(merge1.commits.size, 8);

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
});

test('Repository.merge2', async (t) => {
  // 1. Create an empty repo
  // 2. Clone it
  // 3. Add a commit to each repo
  // 4. Merge both repos

  const repoPath = getRandomPath();
  const repo1: Repository = await Repository.initExt(repoPath, { defaultBranchName: 'Red Track' });

  const repo2path = getRandomPath();
  fse.copySync(repo1.workdir(), repo2path, { recursive: true });
  const repo2: Repository = await Repository.open(repo2path);

  await repo1.createCommit(null, 'commit 1 (repo1)', { allowEmpty: true });
  await repo2.createCommit(null, 'commit 1 (repo2)', { allowEmpty: true });

  function merge1(t, repo1: Repository, repo2: Repository): void {
    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2);
    t.is(merge1.refs.size, 1);
    t.is(Array.from(merge1.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge1.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge1.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge1.commits.values())[2].message, 'commit 1 (repo2)');
  }

  function merge2(t, repo1: Repository, repo2: Repository): void {
    const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1);
    t.is(merge2.refs.size, 1);
    t.is(Array.from(merge2.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge2.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge2.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge2.commits.values())[2].message, 'commit 1 (repo2)');
  }

  merge1(t, repo1, repo2);
  merge2(t, repo1, repo2);
});

test('Repository.merge3', async (t) => {
  // 1. Create an empty repo1
  // 2. Clone to make repo2
  // 3. Create a commit on repo1 
  // 4. Create a blue track on repo2
  // 5. Make a commit on red track on repo2
  // 6. Revert to blue track and create a commit on repo2
  // 7. Merge both repos

  const repoPath = getRandomPath();
  const repo1: Repository = await Repository.initExt(repoPath, { defaultBranchName: 'Red Track' });

  const repo2path = getRandomPath();
  fse.copySync(repo1.workdir(), repo2path, { recursive: true });

  await repo1.createCommit(null, 'commit 1 (repo1)', { allowEmpty: true });

  const repo2: Repository = await Repository.open(repo2path);
  const blueTrack: Reference = await repo2.createNewReference(REFERENCE_TYPE.BRANCH, 'Blue Track', null);
  await repo2.createCommit(null, 'commit 1 (repo2)', { allowEmpty: true });
  await repo2.checkout(blueTrack, RESET.DEFAULT);
  await repo2.createCommit(null, 'commit 2 (repo2)', { allowEmpty: true });

  function merge1(t, repo1: Repository, repo2: Repository): void {
    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2);
    t.is(merge1.refs.size, 2);
    t.is(Array.from(merge1.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge1.refs.values())[1].getName(), 'Blue Track');
    t.is(Array.from(merge1.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge1.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge1.commits.values())[2].message, 'commit 1 (repo2)');
    t.is(Array.from(merge1.commits.values())[3].message, 'commit 2 (repo2)');
  }

  function merge2(t, repo1: Repository, repo2: Repository): void {
    const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1);
    t.is(merge2.refs.size, 2);
    t.is(Array.from(merge2.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge2.refs.values())[1].getName(), 'Blue Track');
    t.is(Array.from(merge2.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge2.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge2.commits.values())[2].message, 'commit 1 (repo2)');
    t.is(Array.from(merge2.commits.values())[3].message, 'commit 2 (repo2)');
  }

  merge1(t, repo1, repo2);
  merge2(t, repo1, repo2);
});