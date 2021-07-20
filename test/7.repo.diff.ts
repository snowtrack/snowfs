/* eslint-disable no-await-in-loop */
import * as fse from 'fs-extra';

import test from 'ava';

import { join } from '../src/path';
import { Diff } from '../src/diff';
import { COMMIT_ORDER, Repository } from '../src/repository';
import { getRandomPath } from './helper';
import { Commit } from '../src/commit';

const sortPaths = require('sort-paths');

function writeFileAndCommit(repo: Repository, filename: string, message: string): Promise<Commit> {
  return fse.writeFile(join(repo.workdir(), filename), message)
    .then(() => {
      const index = repo.ensureMainIndex();
      index.addFiles([filename]);
      return index.writeFiles();
    }).then(() => {
      const index = repo.getFirstIndex();
      return repo.createCommit(index, message);
    });
}

function deleteFileAndCommit(repo: Repository, filename: string, message: string): Promise<Commit> {
  return fse.unlink(join(repo.workdir(), filename))
    .then(() => {
      const index = repo.ensureMainIndex();
      index.deleteFiles([filename]);
      return index.writeFiles();
    }).then(() => {
      const index = repo.getFirstIndex();
      return repo.createCommit(index, message);
    });
}

test('Diff.basic', async (t) => {
  const repoPath = getRandomPath();
  const repo = await Repository.initExt(repoPath);

  const commit0: Commit = repo.getAllCommits(COMMIT_ORDER.OLDEST_FIRST)[0];

  // Commit 1: create a file fooA.txt
  const commit1: Commit = await writeFileAndCommit(repo, 'fooA.txt', 'some-random-content');

  // Commit 2: modify fooA.txt
  const commit2: Commit = await writeFileAndCommit(repo, 'fooA.txt', 'another-random-content');

  // Commit 3: create a file fooB.txt
  const commit3: Commit = await writeFileAndCommit(repo, 'fooB.txt', 'fooB-content');

  // Commit 4: create a file fooB.txt
  const commit4: Commit = await deleteFileAndCommit(repo, 'fooB.txt', 'delete fooB.txt');

  const test0 = () => {
    t.log('Compare initial commit with itself');
    const diff = new Diff(commit0, commit0, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 0, 'expected 0 elements');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 0, 'expected 0 elements');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  const test1 = () => {
    t.log('Compare initial commit with first commit');
    const diff = new Diff(commit1, commit0, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 1, 'expected 1 element: fooA.txt');
    t.is(addedArray[0].path, 'fooA.txt');
    t.is(addedArray[0].hash, '43d18c0f9e453f787c9649a6532d5270ab9a180baa635944d9501ae8ffb44387');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 0, 'expected 0 elements');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  const test2 = () => {
    t.log('Compare second commit with first commit');
    const diff = new Diff(commit2, commit1, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 0, 'expected 0 elements');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 1, 'expected 1 element: fooA.txt');
    t.is(modifiedArray[0].path, 'fooA.txt');
    t.is(modifiedArray[0].hash, '0a81db0c8c27c03e00934e074da1423a1b621f447e22bd1c423b491ecd27ee31');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 0, 'expected 0 elements');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  const test3 = () => {
    t.log('Compare second commit with itself');
    const diff = new Diff(commit2, commit2, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 0, 'expected 0 elements');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 1, 'expected 1 element: fooA.txt');
    t.is(nonModifiedArray[0].path, 'fooA.txt');
    t.is(nonModifiedArray[0].hash, '0a81db0c8c27c03e00934e074da1423a1b621f447e22bd1c423b491ecd27ee31');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  const test4 = () => {
    t.log('Compare 3rd commit with 2nd commit');
    const diff = new Diff(commit3, commit2, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 1, 'expected 1 element: fooA.txt');
    t.is(addedArray[0].path, 'fooB.txt');
    t.is(addedArray[0].hash, 'ca90917cccffe77b6c01bab4a3ebc77243d784e1874dda8f35e217a858ea05f2');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 1, 'expected 1 element: fooA.txt');
    t.is(nonModifiedArray[0].path, 'fooA.txt');
    t.is(nonModifiedArray[0].hash, '0a81db0c8c27c03e00934e074da1423a1b621f447e22bd1c423b491ecd27ee31');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  const test5 = () => {
    t.log('Compare 4th commit with 3rd commit');
    const diff = new Diff(commit4, commit3, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 0, 'expected 0 elements');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 1, 'expected 1 element: fooA.txt');
    t.is(nonModifiedArray[0].path, 'fooA.txt');
    t.is(nonModifiedArray[0].hash, '0a81db0c8c27c03e00934e074da1423a1b621f447e22bd1c423b491ecd27ee31');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 1, 'expected 1 element: fooB.txt');
    t.is(deletedArray[0].path, 'fooB.txt');
    t.is(deletedArray[0].hash, 'ca90917cccffe77b6c01bab4a3ebc77243d784e1874dda8f35e217a858ea05f2');
  };

  const test6 = () => {
    t.log('Compare initial commit with 3rd commit');
    const diff = new Diff(commit3, commit0, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 2, 'expected 2 elements: fooA.txt, fooB.txt');
    t.is(addedArray[0].path, 'fooA.txt');
    t.is(addedArray[0].hash, '0a81db0c8c27c03e00934e074da1423a1b621f447e22bd1c423b491ecd27ee31');
    t.is(addedArray[1].path, 'fooB.txt');
    t.is(addedArray[1].hash, 'ca90917cccffe77b6c01bab4a3ebc77243d784e1874dda8f35e217a858ea05f2');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 0, 'expected 0 elements');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  test0();
  test1();
  test2();
  test3();
  test4();
  test5();
  test6();
});

test('Diff with subdirectories', async (t) => {
  const repoPath = getRandomPath();
  const repo = await Repository.initExt(repoPath);

  const commit0: Commit = repo.getAllCommits(COMMIT_ORDER.OLDEST_FIRST)[0];

  fse.ensureDirSync(join(repo.workdir(), 'subdir1'));
  fse.ensureDirSync(join(repo.workdir(), 'subdir2'));

  // Commit 1: create various files and commit
  fse.writeFileSync(join(repo.workdir(), 'subdir1/fooA.txt'), 'content: subdir1/fooA.txt');
  fse.writeFileSync(join(repo.workdir(), 'subdir1/fooB.txt'), 'content: subdir1/fooB.txt');
  fse.writeFileSync(join(repo.workdir(), 'subdir1/fooC.txt'), 'content: subdir1/fooC.txt');
  fse.writeFileSync(join(repo.workdir(), 'subdir1/fooD.txt'), 'content: subdir1/fooD.txt');

  fse.writeFileSync(join(repo.workdir(), 'subdir2/fooA.txt'), 'content: subdir2/fooA.txt');
  fse.writeFileSync(join(repo.workdir(), 'subdir2/fooB.txt'), 'content: subdir2/fooB.txt');

  fse.writeFileSync(join(repo.workdir(), 'fooA.txt'), 'content: fooA');

  let index = repo.ensureMainIndex();
  index.addFiles([
    'subdir1/fooA.txt',
    'subdir1/fooB.txt',
    'subdir1/fooC.txt',
    'subdir1/fooD.txt',
    'subdir2/fooA.txt',
    'subdir2/fooB.txt',
    'fooA.txt',
  ]);

  await index.writeFiles();

  const commit1 = await repo.createCommit(index, 'commit1');

  fse.writeFileSync(join(repo.workdir(), 'subdir2/fooA.txt'), 'content: subdir2/fooA.txt modified');

  index = repo.ensureMainIndex();
  index.addFiles(['subdir2/fooA.txt']);

  await index.writeFiles();

  const commit2 = await repo.createCommit(index, 'commit2');

  const test0 = () => {
    t.log('Compare initial commit with first commit');
    const diff = new Diff(commit1, commit0, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    const sortedAddedArray = sortPaths(addedArray, (item) => item.path, '/');

    t.is(sortedAddedArray.length, 9, 'expected 1 element: fooA.txt');
    t.is(sortedAddedArray[0].path, 'fooA.txt');
    t.is(sortedAddedArray[0].hash, 'fbb70f5f22a0f1040c9978351c8b3302fa0f77044e36d6ca0fdb0b646fc32611');
    t.is(sortedAddedArray[1].path, 'subdir1');
    t.is(sortedAddedArray[1].hash, '34f40a8f2533b51ed3cdc44d0913431f7b6642cea194eea982ff6aa268c85e48');
    t.is(sortedAddedArray[2].path, 'subdir2');
    t.is(sortedAddedArray[2].hash, '86aee0487e56510ef47d0c6c369f08ba5585e57a251d9c39461519430bc358d4');
    t.is(sortedAddedArray[3].path, 'subdir1/fooA.txt');
    t.is(sortedAddedArray[3].hash, 'eb4d879649dbc97e1bcc280c1abcd56c30d211da2a0f3ec7e6251124c7646edd');
    t.is(sortedAddedArray[4].path, 'subdir1/fooB.txt');
    t.is(sortedAddedArray[4].hash, '81a281150cd97e24ce7628d98f90b1789676fbad19f6bb7c50676d41144b813c');
    t.is(sortedAddedArray[5].path, 'subdir1/fooC.txt');
    t.is(sortedAddedArray[5].hash, '1911748a6284c23df9f9619151a364c0d0fd9d05b3386a1b808fa7773f90c2ad');
    t.is(sortedAddedArray[6].path, 'subdir1/fooD.txt');
    t.is(sortedAddedArray[6].hash, '1baf798eba71b480295794fadf3e929b97c36001a985ccddffdddad445b21aa4');
    t.is(sortedAddedArray[7].path, 'subdir2/fooA.txt');
    t.is(sortedAddedArray[7].hash, '61ec705e763af9e3b2e5c12deba78cb11f51e429f8a4aa4160922d9a926bba16');
    t.is(sortedAddedArray[8].path, 'subdir2/fooB.txt');
    t.is(sortedAddedArray[8].hash, '26a9e4753ef2791e012bca321f9f9cacba992b752d9e38710e157d05396af65a');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 0, 'expected 0 elements');

    const nonModifiedArray = Array.from(diff.nonModified());
    t.is(nonModifiedArray.length, 0, 'expected 0 elements');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  const test1 = () => {
    t.log('Compare 2nd commit with first commit');
    const diff = new Diff(commit2, commit1, { includeDirs: true });

    const addedArray = Array.from(diff.added());
    t.is(addedArray.length, 0, 'expected 0 elements');

    const modifiedArray = Array.from(diff.modified());
    t.is(modifiedArray.length, 2, 'expected 1 element: fooA.txt');
    t.is(modifiedArray[0].path, 'subdir2');
    t.is(modifiedArray[0].hash, '694f3d7ec5fc89cf64dc1ada0b3117ed78dec08e0794328e5836edc7f4ca69ef');
    t.is(modifiedArray[1].path, 'subdir2/fooA.txt');
    t.is(modifiedArray[1].hash, '0c6611c83f11f7dc822c64c3f1e934907bef406b802e6d7be979171743b25da2');

    const nonModifiedArray = Array.from(diff.nonModified());
    const sortedNonModifiedArray = sortPaths(nonModifiedArray, (item) => item.path, '/');
    t.is(sortedNonModifiedArray[0].path, 'fooA.txt');
    t.is(sortedNonModifiedArray[0].hash, 'fbb70f5f22a0f1040c9978351c8b3302fa0f77044e36d6ca0fdb0b646fc32611');
    t.is(sortedNonModifiedArray[1].path, 'subdir1');
    t.is(sortedNonModifiedArray[1].hash, '34f40a8f2533b51ed3cdc44d0913431f7b6642cea194eea982ff6aa268c85e48');
    t.is(sortedNonModifiedArray[2].path, 'subdir1/fooA.txt');
    t.is(sortedNonModifiedArray[2].hash, 'eb4d879649dbc97e1bcc280c1abcd56c30d211da2a0f3ec7e6251124c7646edd');
    t.is(sortedNonModifiedArray[3].path, 'subdir1/fooB.txt');
    t.is(sortedNonModifiedArray[3].hash, '81a281150cd97e24ce7628d98f90b1789676fbad19f6bb7c50676d41144b813c');
    t.is(sortedNonModifiedArray[4].path, 'subdir1/fooC.txt');
    t.is(sortedNonModifiedArray[4].hash, '1911748a6284c23df9f9619151a364c0d0fd9d05b3386a1b808fa7773f90c2ad');
    t.is(sortedNonModifiedArray[5].path, 'subdir1/fooD.txt');
    t.is(sortedNonModifiedArray[5].hash, '1baf798eba71b480295794fadf3e929b97c36001a985ccddffdddad445b21aa4');
    t.is(sortedNonModifiedArray[6].path, 'subdir2/fooB.txt');
    t.is(sortedNonModifiedArray[6].hash, '26a9e4753ef2791e012bca321f9f9cacba992b752d9e38710e157d05396af65a');

    const deletedArray = Array.from(diff.deleted());
    t.is(deletedArray.length, 0, 'expected 0 elements');
  };

  test0();
  test1();
});
