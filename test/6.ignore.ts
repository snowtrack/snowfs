import test from 'ava';

import * as crypto from 'crypto';
import * as os from 'os';
import * as fse from 'fs-extra';

import { join } from '../src/path';
import { getRandomPath } from './helper';
import { FILTER, Repository, StatusEntry } from '../src/repository';

function createFiles(workdir : string, ...names : string[]) {
  for (let i = 0; i < names.length; i++) {
    const f = join(workdir, names[i]);
    fse.createFileSync(f);
  }
}

test('Ignore single file in root', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath, 'ignore-me.txt');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'ignore-me.txt');

    // In Default mode ignored filed are not included,
    return repo.getStatus(FILTER.DEFAULT);
  }).then((items: StatusEntry[]) => {
    // 0 items because ignore-me.txt is ignored and .snowignore (by default)
    t.is(items.length, 0);
  }).then(() => {
    // Also return the ignored files
    return repo.getStatus(FILTER.ALL);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 1);
      t.true(!items[0].isdir);
      t.true(items[0].isIgnored());
      t.is(items[0].path, 'ignore-me.txt');
    });
});

test('Ignore multiple files in root', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath, 'ignore-me.txt',
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'ignore-me.txt');

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 5);

    t.is(items[0].path, 'file1.txt');
    t.is(items[1].path, 'file2.txt');
    t.is(items[2].path, 'file3.txt');
    t.is(items[3].path, 'file4.txt');
    t.is(items[4].path, 'ignore-me.txt');

    t.true(items[0].isNew());
    t.true(items[1].isNew());
    t.true(items[2].isNew());
    t.true(items[3].isNew());
    t.true(items[4].isIgnored());
  });
});

test('Ignore *.txt', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.foo');

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, '*.txt');

    // Don't return any ignored files
    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 1);
    t.is(items[0].path, 'file5.foo');
    t.true(items[0].isNew());
  }).then(() => {
    // now return all the ignored files
    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items[0].path, 'file1.txt');
      t.is(items[1].path, 'file2.txt');
      t.is(items[2].path, 'file3.txt');
      t.is(items[3].path, 'file4.txt');
      t.is(items[4].path, 'file5.foo');

      t.true(items[0].isIgnored());
      t.true(items[1].isIgnored());
      t.true(items[2].isIgnored());
      t.true(items[3].isIgnored());
      t.true(items[4].isNew());
    });
});

test('Ignore subdirectory', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.foo'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 5);
    t.is(items[0].path, 'file1.txt');
    t.is(items[1].path, 'file2.txt');
    t.is(items[2].path, 'file3.txt');
    t.is(items[3].path, 'file4.txt');
    t.is(items[4].path, 'file5.txt');
  }).then(() => {
    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 11);

      t.is(items[0].path, 'file1.txt');
      t.is(items[1].path, 'file2.txt');
      t.is(items[2].path, 'file3.txt');
      t.is(items[3].path, 'file4.txt');
      t.is(items[4].path, 'file5.txt');
      t.is(items[5].path, 'subdir');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.foo');

      t.true(items[0].isNew());
      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());

      t.true(items[5].isDirectory()); // subdir

      t.true(items[6].isIgnored());
      t.true(items[7].isIgnored());
      t.true(items[8].isIgnored());
      t.true(items[9].isIgnored());
      t.true(items[10].isIgnored());
    });
});

test('Ignore nested subdirectory', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'),
      join('subdir', 'subdir', 'file1.txt'),
      join('subdir', 'subdir', 'file2.txt'),
      join('subdir', 'subdir', 'file3.txt'),
      join('subdir', 'subdir', 'file4.txt'),
      join('subdir', 'subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir/subdir');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 11);
    t.is(items[0].path, 'file1.txt');
    t.is(items[1].path, 'file2.txt');
    t.is(items[2].path, 'file3.txt');
    t.is(items[3].path, 'file4.txt');
    t.is(items[4].path, 'file5.txt');

    t.is(items[5].path, 'subdir');

    t.is(items[6].path, 'subdir/file1.txt');
    t.is(items[7].path, 'subdir/file2.txt');
    t.is(items[8].path, 'subdir/file3.txt');
    t.is(items[9].path, 'subdir/file4.txt');
    t.is(items[10].path, 'subdir/file5.txt');

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 17);

      t.is(items[0].path, 'file1.txt');
      t.is(items[1].path, 'file2.txt');
      t.is(items[2].path, 'file3.txt');
      t.is(items[3].path, 'file4.txt');
      t.is(items[4].path, 'file5.txt');
      t.is(items[5].path, 'subdir');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.txt');
      t.is(items[11].path, 'subdir/subdir');
      t.is(items[12].path, 'subdir/subdir/file1.txt');
      t.is(items[13].path, 'subdir/subdir/file2.txt');
      t.is(items[14].path, 'subdir/subdir/file3.txt');
      t.is(items[15].path, 'subdir/subdir/file4.txt');
      t.is(items[16].path, 'subdir/subdir/file5.txt');

      t.true(items[0].isNew());
      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());

      t.true(items[5].isDirectory()); // subdir

      t.true(items[6].isNew());
      t.true(items[7].isNew());
      t.true(items[8].isNew());
      t.true(items[9].isNew());
      t.true(items[10].isNew());

      t.true(items[11].isDirectory()); // subdir/subdir

      t.true(items[12].isIgnored());
      t.true(items[13].isIgnored());
      t.true(items[14].isIgnored());
      t.true(items[15].isIgnored());
      t.true(items[16].isIgnored());
    });
});

test('Ignore comments in ignore', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'),
      join('subdir', 'subdir', 'file1.txt'),
      join('subdir', 'subdir', 'file2.txt'),
      join('subdir', 'subdir', 'file3.txt'),
      join('subdir', 'subdir', 'file4.txt'),
      join('subdir', 'subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, '// subsubdir\nsubdir/subdir\n/*subdir*/');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 11);
    t.is(items[0].path, 'file1.txt');
    t.is(items[1].path, 'file2.txt');
    t.is(items[2].path, 'file3.txt');
    t.is(items[3].path, 'file4.txt');
    t.is(items[4].path, 'file5.txt');

    t.is(items[5].path, 'subdir');

    t.is(items[6].path, 'subdir/file1.txt');
    t.is(items[7].path, 'subdir/file2.txt');
    t.is(items[8].path, 'subdir/file3.txt');
    t.is(items[9].path, 'subdir/file4.txt');
    t.is(items[10].path, 'subdir/file5.txt');

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 17);

      t.is(items[0].path, 'file1.txt');
      t.is(items[1].path, 'file2.txt');
      t.is(items[2].path, 'file3.txt');
      t.is(items[3].path, 'file4.txt');
      t.is(items[4].path, 'file5.txt');
      t.is(items[5].path, 'subdir');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.txt');
      t.is(items[11].path, 'subdir/subdir');
      t.is(items[12].path, 'subdir/subdir/file1.txt');
      t.is(items[13].path, 'subdir/subdir/file2.txt');
      t.is(items[14].path, 'subdir/subdir/file3.txt');
      t.is(items[15].path, 'subdir/subdir/file4.txt');
      t.is(items[16].path, 'subdir/subdir/file5.txt');

      t.true(items[0].isNew());
      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());

      t.true(items[5].isDirectory()); // subdir

      t.true(items[6].isNew());
      t.true(items[7].isNew());
      t.true(items[8].isNew());
      t.true(items[9].isNew());
      t.true(items[10].isNew());

      t.true(items[11].isDirectory()); // subdir/subdir

      t.true(items[12].isIgnored());
      t.true(items[13].isIgnored());
      t.true(items[14].isIgnored());
      t.true(items[15].isIgnored());
      t.true(items[16].isIgnored());
    });
});

test('Ignore inline comments in ignore', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'),
      join('subdir', 'subdir', 'file1.txt'),
      join('subdir', 'subdir', 'file2.txt'),
      join('subdir', 'subdir', 'file3.txt'),
      join('subdir', 'subdir', 'file4.txt'),
      join('subdir', 'subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'sub/*comment*/dir');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 5);
    t.is(items[0].path, 'file1.txt');
    t.is(items[1].path, 'file2.txt');
    t.is(items[2].path, 'file3.txt');
    t.is(items[3].path, 'file4.txt');
    t.is(items[4].path, 'file5.txt');

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 17);

      t.is(items[0].path, 'file1.txt');
      t.is(items[1].path, 'file2.txt');
      t.is(items[2].path, 'file3.txt');
      t.is(items[3].path, 'file4.txt');
      t.is(items[4].path, 'file5.txt');
      t.is(items[5].path, 'subdir');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.txt');
      t.is(items[11].path, 'subdir/subdir');
      t.is(items[12].path, 'subdir/subdir/file1.txt');
      t.is(items[13].path, 'subdir/subdir/file2.txt');
      t.is(items[14].path, 'subdir/subdir/file3.txt');
      t.is(items[15].path, 'subdir/subdir/file4.txt');
      t.is(items[16].path, 'subdir/subdir/file5.txt');

      t.true(items[0].isNew());
      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());

      t.true(items[5].isDirectory()); // subdir

      t.true(items[6].isIgnored());
      t.true(items[7].isIgnored());
      t.true(items[8].isIgnored());
      t.true(items[9].isIgnored());
      t.true(items[10].isIgnored());

      t.true(items[11].isDirectory()); // subdir/subdir

      t.true(items[12].isIgnored());
      t.true(items[13].isIgnored());
      t.true(items[14].isIgnored());
      t.true(items[15].isIgnored());
      t.true(items[16].isIgnored());
    });
});

test('Ignore inverse', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.txt'));

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir\n!subdir/file5.txt');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 6);
    t.is(items[0].path, 'file1.txt');
    t.is(items[1].path, 'file2.txt');
    t.is(items[2].path, 'file3.txt');
    t.is(items[3].path, 'file4.txt');
    t.is(items[4].path, 'file5.txt');

    t.is(items[5].path, 'subdir/file5.txt');

    t.true(items[0].isNew());
    t.true(items[1].isNew());
    t.true(items[2].isNew());
    t.true(items[3].isNew());
    t.true(items[4].isNew());
    t.true(items[5].isNew());
  }).then(() => {
    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 11);

      t.is(items[0].path, 'file1.txt');
      t.is(items[1].path, 'file2.txt');
      t.is(items[2].path, 'file3.txt');
      t.is(items[3].path, 'file4.txt');
      t.is(items[4].path, 'file5.txt');
      t.is(items[5].path, 'subdir');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.txt');

      t.true(items[0].isNew());
      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());

      t.true(items[5].isDirectory()); // subdir

      t.true(items[6].isIgnored());
      t.true(items[7].isIgnored());
      t.true(items[8].isIgnored());
      t.true(items[9].isIgnored());
      t.true(items[10].isNew()); // remember, isNew because subdir/file5.foo is included
    });
});
