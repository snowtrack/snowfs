/* eslint-disable no-await-in-loop */
import * as fse from 'fs-extra';

import test from 'ava';

import { join } from '../src/path';
import { Diff } from '../src/diff';
import { COMMIT_ORDER, Repository } from '../src/repository';
import { getRandomPath } from './helper';
import { Commit } from '../src/commit';

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
