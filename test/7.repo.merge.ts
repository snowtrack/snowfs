import test from 'ava';
import { assert } from 'console';
import * as fse from 'fs-extra';
import { Index } from '../src';
import { Commit } from '../src/commit';
import { join } from '../src/path';
import { Reference } from '../src/reference';
import { REFERENCE_TYPE, Repository, RepositoryInitOptions, RESET } from '../src/repository';
import { getRandomPath, shuffleArray } from './helper';

export function getBranchNames(): Set<string> {
  return new Set(['Yellow Track',
    'Blue Track',
    'Green Track',
    'Pink Track',
    'Purple Track',
    'Mint Track',
  ]);
}

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
  const error = t.throws(() => Repository.merge(repo1, repo2, getBranchNames()));
  t.is(error.message, 'refusing to merge unrelated histories');
});

test('Repository.merge0', async (t) => {
  // t.plan(20);

  // 1. Create a simple linear repo
  // 2. Create a new commit
  // 3. Clone repo
  // 4. Create a new commit on the clone
  // 5. Merge

  const repoPath = getRandomPath();
  const repo1: Repository = await Repository.initExt(repoPath, { defaultBranchName: 'Red Track' });
  await repo1.createCommit(null, 'commit 1', { allowEmpty: true });
  
  const repo2path = getRandomPath();
  fse.copySync(repo1.workdir(), repo2path, { recursive: true });
  const repo2: Repository = await Repository.open(repo2path);
  await repo2.createCommit(null, 'commit2', { allowEmpty: true });
  
  const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2, getBranchNames());
  t.is(merge1.commits.size, 3);
  t.is(merge1.refs.size, 1);

  const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1, getBranchNames());
  t.is(merge2.commits.size, 3);
  t.is(merge1.refs.size, 1);
});

test('Repository.merge1', async (t) => {
  // t.plan(20);

  // Create a more complicated repo, clone it, delete a commit, and finally merge
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

    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2, getBranchNames());
    t.is(merge1.commits.size, 8);
    t.is(merge1.refs.size, 3);

    const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1, getBranchNames());
    t.is(merge2.commits.size, 8);
    t.is(merge1.refs.size, 3);
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
    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2, getBranchNames());
    t.is(merge1.refs.size, 2);
    t.is(Array.from(merge1.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge1.refs.values())[1].getName(), 'Yellow Track');
    t.is(Array.from(merge1.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge1.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge1.commits.values())[2].message, 'commit 1 (repo2)');
  }

  function merge2(t, repo1: Repository, repo2: Repository): void {
    const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1, getBranchNames());
    t.is(merge2.refs.size, 2);
    t.is(Array.from(merge2.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge2.refs.values())[1].getName(), 'Yellow Track');
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
    const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2, getBranchNames());
    t.is(merge1.refs.size, 3);
    t.is(Array.from(merge1.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge1.refs.values())[1].getName(), 'Yellow Track');
    t.is(Array.from(merge1.refs.values())[2].getName(), 'Blue Track');
    t.is(Array.from(merge1.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge1.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge1.commits.values())[2].message, 'commit 1 (repo2)');
    t.is(Array.from(merge1.commits.values())[3].message, 'commit 2 (repo2)');
  }

  function merge2(t, repo1: Repository, repo2: Repository): void {
    const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1, getBranchNames());
    t.is(merge2.refs.size, 3);
    t.is(Array.from(merge2.refs.values())[0].getName(), 'Red Track');
    t.is(Array.from(merge2.refs.values())[1].getName(), 'Yellow Track');
    t.is(Array.from(merge2.refs.values())[2].getName(), 'Blue Track');
    t.is(Array.from(merge2.commits.values())[0].message, 'Created Project');
    t.is(Array.from(merge2.commits.values())[1].message, 'commit 1 (repo1)');
    t.is(Array.from(merge2.commits.values())[2].message, 'commit 1 (repo2)');
    t.is(Array.from(merge2.commits.values())[3].message, 'commit 2 (repo2)');
  }

  merge1(t, repo1, repo2);
  merge2(t, repo1, repo2);
});


test('Repository.merge4', async (t) => {
  // Create two repos with the same branch but with different starting points of the references
  // The goal is to ensure that one of the references will get a numeric suffix as they are non-mergable

  const repoPath = getRandomPath();
  const repo1: Repository = await Repository.initExt(repoPath, { defaultBranchName: 'Red Track' });

  const repo2path = getRandomPath();
  fse.copySync(repo1.workdir(), repo2path, { recursive: true });

  const yellowTrack1: Reference = await repo1.createNewReference(REFERENCE_TYPE.BRANCH, 'Yellow Track', null);
  await repo1.checkout(yellowTrack1, RESET.DEFAULT);
  await repo1.createCommit(null, 'commit 1 (repo1)', { allowEmpty: true });

  const repo2: Repository = await Repository.open(repo2path);

  await repo2.createCommit(null, 'commit 1 (repo2)', { allowEmpty: true });
  const yellowTrack2: Reference = await repo2.createNewReference(REFERENCE_TYPE.BRANCH, 'Yellow Track', null);
  await repo2.checkout(yellowTrack2, RESET.DEFAULT);
  await repo2.createCommit(null, 'commit 2 (repo2)', { allowEmpty: true });

  const merge1: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo1, repo2, getBranchNames());
  t.is(merge1.refs.size, 2);
  t.is(merge1.commits.size, 4);

  const merge2: { commits: Map<string, Commit>, refs: Map<string, Reference> } = Repository.merge(repo2, repo1, getBranchNames());
  t.is(merge2.refs.size, 2);
  t.is(merge2.commits.size, 4);
});
