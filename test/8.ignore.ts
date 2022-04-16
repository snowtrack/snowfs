import test from 'ava';

import * as fse from 'fs-extra';

import { join } from '../src/path';
import { getRandomPath } from './helper';
import { FILTER, Repository, StatusEntry } from '../src/repository';
import { IgnoreManager } from '../src/ignore';

function createFiles(workdir : string, ...names : string[]) {
  for (let i = 0; i < names.length; i++) {
    const f = join(workdir, names[i]);
    fse.createFileSync(f);
  }
}

async function testIgnore(t, pattern: string[], ignored: string[], unignored: string[]): Promise<void> {
  const ignore = new IgnoreManager();

  ignore.loadPatterns(pattern);

  const areIgnored: Set<string> = ignore.getIgnoreItems(ignored.concat(unignored));
  t.is(areIgnored.size, ignored.length);

  let success = true;
  for (const i of ignored) {
    const res = areIgnored.has(i);
    t.true(res);
    if (!res) {
      console.log('Expected:');
      console.log(ignored.sort());
      console.log('Received:');
      console.log(Array.from(areIgnored).sort());
      success = false;
    }
  }

  if (success && areIgnored.size === ignored.length) {
    t.log('---');
    t.log(`Ignore Pattern:  [${pattern.map((x: string) => `'${x}'`).join(', ')}]`);
    t.log(`Ignored Items:   [${ignored.map((x: string) => `'${x}'`).join(', ')}]`);
    t.log(`Unignored Items: [${unignored.map((x: string) => `'${x}'`).join(', ')}]`);
  }
}

test('Ignore Manager plain [foo, bar, bas]', async (t) => {
  const pattern = ['foo', 'bar', 'bas'];

  const ignored = [
    'foo',
    'foo/bar',
    'foo/test/abc.jpg',
    'bar',
    'bas',
    'a/foo/b',
    'a/b/c/foo',
  ];

  const unignored = [
    // must not be ignored
    'baz',
    'baz/abc',

    'afoo',
    'foob',
    'afoob',

    'a-foo',
    'foo-b',
    'a-foo-b',

    'a/b/c/foo.jpg',
  ];

  await testIgnore(t, pattern, ignored, unignored);
});

test('Ignore Manager plain [foo/bar]', async (t) => {
  const pattern = ['foo/bar'];

  const ignored = [
    'foo/bar',
    'foo/bar/baz',

    // ignore even if foo is in a subdirectory
    'x/foo/bar',
    'x/foo/bar/baz',
  ];

  const unignored = [
    'foo',
    'bar/foo',
  ];

  await testIgnore(t, pattern, ignored, unignored);
});

test('Ignore Manager [*.jpg, *.mov]', async (t) => {
  const pattern = ['*.jpg', '*.mov'];

  const ignored = [
    'abc.jpg', // bc of '*.jpg'
    'foo/bar.jpg', // bc of '*.jpg'
    'foo/bar/bas.jpg', // bc of '*.jpg'
    'abc.mov', // bc of '*.mov'
    'foo/bar.mov', // bc of '*.mov'
    'foo/bar.mov/xyz', // bc of '*.mov'
    'foo/bar/bas.mov', // bc of '*.mov'
  ];

  const unignored = [
    // This would be ignored by Git, but we set dot: false to improve speedup.
    '.jpg',

    'jpg',
    'jpg.',
    'foo.jpg.bkp',
    'foo/jpg.',
    'foo/bar/jpg.baz',
    'foo/bar.jpg.bkp',
    'foo/bar/bas.jpg.bkp',
  ];

  await testIgnore(t, pattern, ignored, unignored);
});

test('Ignore Manager [pic.*, bar.*]', async (t) => {
  const pattern = ['pic.*', 'bar.*'];

  const ignored = [
    'pic.', // because of 'pic.*', is ignored, same behaviour in Git
    'pic.jpg', // because of 'pic.*'
    'pic.jpg.bkp', // because of 'pic.*'
    'foo/pic.jpg', // because of 'pic.*'
    'foo/pic.jpg.bkp', // because of 'pic.*'
    'foo/baz/pic.jpg', // because of 'pic.*'
    'foo/baz/pic.jpg.bkp', // because of 'pic.*'
    'foo/bar.xyz', // because of 'bar.*'
    'foo/bar.baz/xyz', // because of 'bar.*'
  ];

  const unignored = [
    'pic',
    'foo.pic',
    'foo/bar/bas.pic',
  ];

  await testIgnore(t, pattern, ignored, unignored);
});

test('Ignore Manager [foo, !foo/bar/baz]', async (t) => {
  const pattern = ['foo', '!foo/bar/bas'];

  const ignored = [
    'foo',
    'foo/bar',
    'foo/bar/baz',

    // ignore even if foo is in a subdirectory
    'x/foo',
    'x/foo/bar',
    'x/foo/bar/bas',
    'x/foo/bar/baz',
  ];

  const unignored = [
    'foo/bar/bas',
    'x/foo/bar/bas',
    'bar',
    'bar/baz',
  ];

  await testIgnore(t, pattern, ignored, unignored);
});

test('Ignore Manager [foo/*/baz], [foo/*/baz/], [foo/*/baz/**]', async (t) => {
  const patterns = [['foo/*/baz'], ['foo/*/baz/'], ['foo/*/baz/**']];
  for (const pattern of patterns) {
    const ignored = [
      'foo/bar/baz',
      'x/foo/bar/baz',
      'x/foo/bar/baz/y',
    ];

    const unignored = [
      'foo',
      'foo/bar',
      'foo/baz',
    ];

    // eslint-disable-next-line no-await-in-loop
    await testIgnore(t, pattern, ignored, unignored);
  }
});

test('Ignore Manager [foo/bar[1-4]]', async (t) => {
  const pattern = ['foo/bar[1-4].jpg'];

  const ignored = [
    'foo/bar1.jpg',
    'foo/bar2.jpg',
    'foo/bar3.jpg',
    'foo/bar4.jpg',
  ];

  const unignored = [
    'foo/bar0.jpg',
    'foo/bar5.jpg',
    'foo/bar6.jpg',
    'foo/bar7.jpg',
    'foo/bar8.jpg',
    'foo/bar11.jpg',
    'bar1.jpg',
    'bar11.jpg',
  ];

  await testIgnore(t, pattern, ignored, unignored);
});

test('Ignore Test in getStatus: Ignore single file in root', async (t) => {
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

test('Ignore Test in getStatus: Ignore multiple files in root', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
      'ignore-me.txt',
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
    );

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

test('Ignore Test in getStatus: Ignore *.txt', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.foo',
    );

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

test('Ignore Test in getStatus: Ignore subdirectory', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
      'file5.txt',
      join('subdir', 'file1.txt'),
      join('subdir', 'file2.txt'),
      join('subdir', 'file3.txt'),
      join('subdir', 'file4.txt'),
      join('subdir', 'file5.foo'),
    );

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

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 11);

      t.is(items[0].path, 'subdir');
      t.is(items[1].path, 'file1.txt');
      t.is(items[2].path, 'file2.txt');
      t.is(items[3].path, 'file3.txt');
      t.is(items[4].path, 'file4.txt');
      t.is(items[5].path, 'file5.txt');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.foo');

      t.true(items[0].isDirectory()); // subdir

      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());
      t.true(items[5].isNew());

      t.true(items[6].isIgnored());
      t.true(items[7].isIgnored());
      t.true(items[8].isIgnored());
      t.true(items[9].isIgnored());
      t.true(items[10].isIgnored());
    });
});

test('Ignore Test in getStatus: Ignore nested subdirectory', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
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
      join('subdir', 'subdir', 'file5.txt'),
    );

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, 'subdir/subdir');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 11);

    t.is(items[0].path, 'subdir');

    t.is(items[1].path, 'file1.txt');
    t.is(items[2].path, 'file2.txt');
    t.is(items[3].path, 'file3.txt');
    t.is(items[4].path, 'file4.txt');
    t.is(items[5].path, 'file5.txt');

    t.is(items[6].path, 'subdir/file1.txt');
    t.is(items[7].path, 'subdir/file2.txt');
    t.is(items[8].path, 'subdir/file3.txt');
    t.is(items[9].path, 'subdir/file4.txt');
    t.is(items[10].path, 'subdir/file5.txt');

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 17);

      t.is(items[0].path, 'subdir');
      t.is(items[1].path, 'subdir/subdir');

      t.is(items[2].path, 'file1.txt');
      t.is(items[3].path, 'file2.txt');
      t.is(items[4].path, 'file3.txt');
      t.is(items[5].path, 'file4.txt');
      t.is(items[6].path, 'file5.txt');

      t.is(items[7].path, 'subdir/file1.txt');
      t.is(items[8].path, 'subdir/file2.txt');
      t.is(items[9].path, 'subdir/file3.txt');
      t.is(items[10].path, 'subdir/file4.txt');
      t.is(items[11].path, 'subdir/file5.txt');

      t.is(items[12].path, 'subdir/subdir/file1.txt');
      t.is(items[13].path, 'subdir/subdir/file2.txt');
      t.is(items[14].path, 'subdir/subdir/file3.txt');
      t.is(items[15].path, 'subdir/subdir/file4.txt');
      t.is(items[16].path, 'subdir/subdir/file5.txt');

      t.true(items[0].isDirectory()); // subdir
      t.true(items[1].isDirectory()); // subdir/subdir

      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());
      t.true(items[5].isNew());
      t.true(items[6].isNew());

      t.true(items[7].isNew());
      t.true(items[8].isNew());
      t.true(items[9].isNew());
      t.true(items[10].isNew());
      t.true(items[11].isNew());

      t.true(items[12].isIgnored());
      t.true(items[13].isIgnored());
      t.true(items[14].isIgnored());
      t.true(items[15].isIgnored());
      t.true(items[16].isIgnored());
    });
});

test('Ignore Test in getStatus: Ignore comments in ignore', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
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
      join('subdir', 'subdir', 'file5.txt'),
    );

    // add file to ignore
    const ignoreFile = join(repoPath, '.snowignore');
    fse.writeFileSync(ignoreFile, '// subsubdir\nsubdir/subdir\n/*subdir*/');

    return repo.getStatus(FILTER.DEFAULT | FILTER.SORT_CASE_SENSITIVELY);
  }).then((items: StatusEntry[]) => {
    t.is(items.length, 11);

    t.is(items[0].path, 'subdir');

    t.is(items[1].path, 'file1.txt');
    t.is(items[2].path, 'file2.txt');
    t.is(items[3].path, 'file3.txt');
    t.is(items[4].path, 'file4.txt');
    t.is(items[5].path, 'file5.txt');

    t.is(items[6].path, 'subdir/file1.txt');
    t.is(items[7].path, 'subdir/file2.txt');
    t.is(items[8].path, 'subdir/file3.txt');
    t.is(items[9].path, 'subdir/file4.txt');
    t.is(items[10].path, 'subdir/file5.txt');

    return repo.getStatus(FILTER.ALL | FILTER.SORT_CASE_SENSITIVELY);
  })
    .then((items: StatusEntry[]) => {
      t.is(items.length, 17);

      t.is(items[0].path, 'subdir');
      t.is(items[1].path, 'subdir/subdir');

      t.is(items[2].path, 'file1.txt');
      t.is(items[3].path, 'file2.txt');
      t.is(items[4].path, 'file3.txt');
      t.is(items[5].path, 'file4.txt');
      t.is(items[6].path, 'file5.txt');
      t.is(items[7].path, 'subdir/file1.txt');
      t.is(items[8].path, 'subdir/file2.txt');
      t.is(items[9].path, 'subdir/file3.txt');
      t.is(items[10].path, 'subdir/file4.txt');
      t.is(items[11].path, 'subdir/file5.txt');
      t.is(items[12].path, 'subdir/subdir/file1.txt');
      t.is(items[13].path, 'subdir/subdir/file2.txt');
      t.is(items[14].path, 'subdir/subdir/file3.txt');
      t.is(items[15].path, 'subdir/subdir/file4.txt');
      t.is(items[16].path, 'subdir/subdir/file5.txt');

      t.true(items[0].isDirectory()); // subdir

      t.true(items[1].isDirectory()); // subdir/subdir

      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());
      t.true(items[5].isNew());
      t.true(items[6].isNew());

      t.true(items[7].isNew());
      t.true(items[8].isNew());
      t.true(items[9].isNew());
      t.true(items[10].isNew());
      t.true(items[11].isNew());

      t.true(items[12].isIgnored());
      t.true(items[13].isIgnored());
      t.true(items[14].isIgnored());
      t.true(items[15].isIgnored());
      t.true(items[16].isIgnored());
    });
});

test('Ignore Test in getStatus: Ignore inline comments in ignore', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
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
      join('subdir', 'subdir', 'file5.txt'),
    );

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

      t.is(items[0].path, 'subdir');
      t.is(items[1].path, 'subdir/subdir');

      t.is(items[2].path, 'file1.txt');
      t.is(items[3].path, 'file2.txt');
      t.is(items[4].path, 'file3.txt');
      t.is(items[5].path, 'file4.txt');
      t.is(items[6].path, 'file5.txt');
      t.is(items[7].path, 'subdir/file1.txt');
      t.is(items[8].path, 'subdir/file2.txt');
      t.is(items[9].path, 'subdir/file3.txt');
      t.is(items[10].path, 'subdir/file4.txt');
      t.is(items[11].path, 'subdir/file5.txt');
      t.is(items[12].path, 'subdir/subdir/file1.txt');
      t.is(items[13].path, 'subdir/subdir/file2.txt');
      t.is(items[14].path, 'subdir/subdir/file3.txt');
      t.is(items[15].path, 'subdir/subdir/file4.txt');
      t.is(items[16].path, 'subdir/subdir/file5.txt');

      t.true(items[0].isDirectory()); // subdir
      t.true(items[1].isDirectory()); // subdir/subdir

      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());
      t.true(items[5].isNew());
      t.true(items[6].isNew());

      t.true(items[7].isIgnored());
      t.true(items[8].isIgnored());
      t.true(items[9].isIgnored());
      t.true(items[10].isIgnored());
      t.true(items[11].isIgnored());

      t.true(items[12].isIgnored());
      t.true(items[13].isIgnored());
      t.true(items[14].isIgnored());
      t.true(items[15].isIgnored());
      t.true(items[16].isIgnored());
    });
});

test('Ignore Test in getStatus: Ignore inverse', async (t) => {
  const repoPath = getRandomPath();
  let repo: Repository;

  await Repository.initExt(repoPath).then((repoResult: Repository) => {
    repo = repoResult;

    createFiles(
      repoPath,
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
    );

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

      t.is(items[0].path, 'subdir');
      t.is(items[1].path, 'file1.txt');
      t.is(items[2].path, 'file2.txt');
      t.is(items[3].path, 'file3.txt');
      t.is(items[4].path, 'file4.txt');
      t.is(items[5].path, 'file5.txt');
      t.is(items[6].path, 'subdir/file1.txt');
      t.is(items[7].path, 'subdir/file2.txt');
      t.is(items[8].path, 'subdir/file3.txt');
      t.is(items[9].path, 'subdir/file4.txt');
      t.is(items[10].path, 'subdir/file5.txt');

      t.true(items[0].isDirectory()); // subdir

      t.true(items[1].isNew());
      t.true(items[2].isNew());
      t.true(items[3].isNew());
      t.true(items[4].isNew());
      t.true(items[5].isNew());

      t.true(items[6].isIgnored());
      t.true(items[7].isIgnored());
      t.true(items[8].isIgnored());
      t.true(items[9].isIgnored());
      t.true(items[10].isNew()); // remember, isNew because subdir/file5.foo is included
    });
});
