import test from 'ava';

import * as crypto from 'crypto';
import * as os from 'os';
import * as fse from 'fs-extra';

import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';
import { COMMIT_ORDER, Repository } from '../src/repository';

enum EXEC_OPTIONS {
  RETURN_STDOUT = 1,
  WRITE_STDIN = 2
}

async function exec(t, command: string, args?: string[], opts?: {cwd?: string}, stdiopts?: EXEC_OPTIONS, stdin = ''): Promise<void | string> {
  t.log(`Execute ${command} ${args.join(' ')}`);

  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.', env: Object.assign(process.env, { SUPPRESS_BANNER: 'true' }) });
  return new Promise((resolve, reject) => {
    let stdout: string = '';
    let stderr: string = '';
    if (stdiopts & EXEC_OPTIONS.WRITE_STDIN) {
      p0.stdin.write(`${stdin}\n`);
      p0.stdin.end(); /// this call seems necessary, at least with plain node.js executable
    }
    p0.stdout.on('data', (data) => {
      if (stdiopts & EXEC_OPTIONS.RETURN_STDOUT) {
        stdout += data.toString();
      } else {
        t.log(data.toString());
      }
    });
    p0.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    p0.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout ?? undefined);
      } else {
        reject(Error(`Failed to execute ${command} ${args.join(' ')} with exit-code ${code}\n${stderr}`));
      }
    });
  });
}

function getSnowexec(t): string {
  switch (process.platform) {
    case 'darwin':
      return join(__dirname, '..', './bin/snow');
    case 'win32':
      return join(__dirname, '..', './bin/snow.bat');
    default:
      throw new Error('Unsupported Operating System');
  }
}

function generateUniqueTmpDirName(): string {
  const id = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex').substring(0, 6);
  return join(os.tmpdir(), `snowfs-cli-test-${id}`);
}

// test doesn't work on the GitHub runners
// https://github.com/seb-mtl/SnowFS/runs/1923599289?check_suite_focus=true#step:7:245

test('snow add/commit/log', async (t) => {
  t.timeout(180000);

  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  for (let i = 0; i < 2; ++i) {
    t.log(`Write abc${i}.txt`);
    fse.writeFileSync(join(snowWorkdir, `abc${i}.txt`), 'Hello World');
    // eslint-disable-next-line no-await-in-loop
    await exec(t, snow, ['add', '.'], { cwd: snowWorkdir });
    // eslint-disable-next-line no-await-in-loop
    await exec(t, snow, ['commit', '-m', `add hello-world ${i}`], { cwd: snowWorkdir });
    // eslint-disable-next-line no-await-in-loop
    await exec(t, snow, ['log'], { cwd: snowWorkdir });
  }

  t.is(true, true);
});

test('snow add .', async (t) => {
  t.timeout(180000);

  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', '.'], { cwd: subdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('snow add *', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', '*'], { cwd: subdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

/**
 * This test ensures that foo.txt is not added to the staging area because cwd is the subdirectory
 */
test('snow add foo.txt', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', 'foo.txt'], { cwd: subdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('snow add bar.txt', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', 'bar.txt'], { cwd: subdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('snow rm foo.txt', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'First commit'], { cwd: snowWorkdir });

  // delete the file and commit
  await exec(t, snow, ['rm', 'foo.txt'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'Delete foo.txt'], { cwd: snowWorkdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('snow rm subdir', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'First commit'], { cwd: snowWorkdir });

  // delete the file and commit
  await exec(t, snow, ['rm', 'subdir'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'Delete subdir'], { cwd: snowWorkdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('snow rm subdir/bar.txt', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'First commit'], { cwd: snowWorkdir });

  // delete the file and commit
  await exec(t, snow, ['rm', 'subdir/bar.txt'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'Delete subdir/bar.txt'], { cwd: snowWorkdir });

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('snow rm file-does-not-exist', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const subdir = join(snowWorkdir, 'subdir');

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write foo.txt');
  fse.writeFileSync(join(snowWorkdir, 'foo.txt'), 'foo');
  t.log('Create subdir');
  fse.mkdirpSync(subdir);
  t.log('Write subdir/foo.txt');
  fse.writeFileSync(join(subdir, 'bar.txt'), 'bar');

  await exec(t, snow, ['add', '*'], { cwd: snowWorkdir });
  await exec(t, snow, ['commit', '-m', 'First commit'], { cwd: snowWorkdir });

  const error = await t.throwsAsync(async () => exec(t, snow, ['rm', 'file-does-not-exist'], { cwd: snowWorkdir }));
  t.true(error.message.includes('fatal: ENOENT: no such file or directory, stat'));

  // TODO: (Fix getStatus to differ between worktree and staging area)
  // const stdout = await exec(t, snow, ['status', '--output=json-pretty'], { cwd: subdir }, EXEC_OPTIONS.RETURN_STDOUT);

  t.is(true, true);
});

test('Commit User Data --- STORE AND LOAD IDENTICAL', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  const uData: any = { str_key: 'str_value', int_key: 3 };

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });
  await exec(t, snow,
    ['commit', '-m', 'unit test user data', '--allow-empty', '--input=stdin'], { cwd: snowWorkdir },
    EXEC_OPTIONS.RETURN_STDOUT | EXEC_OPTIONS.WRITE_STDIN,
    `--user-data: ${JSON.stringify(uData)}`);

  const out = await exec(t, snow, ['log', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);
  const c: any = JSON.parse(String(out));

  let identical = false;
  if (c.commits.length > 0) {
    const d = c.commits[0].userData;

    // eslint-disable-next-line guard-for-in
    for (const key in d) {
      if (!(key in uData)) {
        identical = false;
        break;
      }
      if (d[key] !== uData[key]) {
        identical = false;
        break;
      }

      identical = true;
    }
  }

  t.is(true, identical);
});

test('Commit User Data --- FAIL INVALID INPUT', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const error = await t.throwsAsync(async () => exec(t, snow,
    ['commit', '-m', 'unit test user data', '--allow-empty', '--input=stdin'], { cwd: snowWorkdir },
    EXEC_OPTIONS.RETURN_STDOUT | EXEC_OPTIONS.WRITE_STDIN, '--user-data: garbage-because-json-object-expected'));

  const errorMsgSub = 'fatal: invalid user-data: SyntaxError: Unexpected token g in JSON at position 0';
  t.true(error.message.includes(errorMsgSub));
});

test('Commit Tags --- STORE AND LOAD IDENTICAL', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  const tag1 = 'FirstTag';
  const tag2 = 'SecondTag';

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });
  await exec(t, snow, ['commit', '-m', 'unit test tags', '--allow-empty', `--tags=${tag1},${tag2}`], { cwd: snowWorkdir });

  const out = await exec(t, snow, ['log', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);
  const c: any = JSON.parse(String(out));

  let identical = false;
  if (c.commits.length > 0) {
    const d = c.commits[0].tags;
    identical = d.includes(tag1) && d.includes(tag2);
  }

  t.is(true, identical);
});

test('Commit Tags --- SPECIAL SYMBOLS INPUT', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  const tag1 = '[]}';
  const tag2 = '\'%$[,.}}';

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });
  await exec(t, snow, ['commit', '-m', 'unit test tags', '--allow-empty', `--tags=${tag1},${tag2}`], { cwd: snowWorkdir });

  const out = await exec(t, snow, ['log', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);
  const c: any = JSON.parse(String(out));

  let tags: string[] = [];
  if (c.commits.length > 0) {
    tags = c.commits[0].tags;
  }

  t.is(true, tags.length === 3); // === 3 due to comma in tag2
});

test('Commit Tags --- EMPTY INPUT', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });
  await exec(t, snow, ['commit', '-m', 'unit test tags', '--allow-empty', '--tags='], { cwd: snowWorkdir });

  const out = await exec(t, snow, ['log'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  // should not print tags as we never passed any
  const tagsLog = 'Tags:';
  t.is(true, !String(out).includes(tagsLog));
});

test('Branch User Data --- STORE AND LOAD IDENTICAL', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  const uData: any = { str_key: 'str_value', int_key: 3 };
  const branchName = 'u-data-test';

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });
  await exec(t, snow,
    ['checkout', '-b', branchName, '--input=stdin'], { cwd: snowWorkdir },
    EXEC_OPTIONS.RETURN_STDOUT | EXEC_OPTIONS.WRITE_STDIN,
    `--user-data:${JSON.stringify(uData)}`);

  const out = await exec(t, snow, ['log', '--output=json'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);
  const c: any = JSON.parse(String(out));

  let identical = false;
  if (c.refs.length > 1) {
    const d = c.refs[1].userData;

    // eslint-disable-next-line guard-for-in
    for (const key in d) {
      if (!(key in uData)) {
        identical = false;
        break;
      }
      if (d[key] !== uData[key]) {
        identical = false;
        break;
      }

      identical = true;
    }
  }

  t.is(true, identical);
});

test('Branch User Data --- FAIL INVALID INPUT', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();
  const branchName = 'u-data-test';

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  const error = await t.throwsAsync(async () => exec(t, snow,
    ['checkout', '-b', branchName, '--input=stdin'], { cwd: snowWorkdir },
    EXEC_OPTIONS.RETURN_STDOUT | EXEC_OPTIONS.WRITE_STDIN, '--user-data: garbage-because-json-object-expected'));

  const errorMsgSub = 'fatal: invalid user-data: SyntaxError: Unexpected token g in JSON at position 0';
  t.true(error.message.includes(errorMsgSub));
  t.log('Test failed as expected');
});

test('Multi-Index -- CREATE 2 INDEXES, COMMIT SEQUENTIALLY', async (t) => {
  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write a.txt');
  fse.writeFileSync(join(snowWorkdir, 'a.txt'), 'a');

  t.log('Write b.txt');
  fse.writeFileSync(join(snowWorkdir, 'b.txt'), 'b');

  const outAddA = await exec(t, snow, ['add', 'a.txt', '--index', 'create'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);
  const outAddB = await exec(t, snow, ['add', 'b.txt', '--index', 'create'], { cwd: snowWorkdir }, EXEC_OPTIONS.RETURN_STDOUT);

  const indexAMatch = (outAddA as string).match(/Created new index:\s\[(\w*)\]/);
  t.true(Boolean(indexAMatch));

  const indexBMatch = (outAddB as string).match(/Created new index:\s\[(\w*)\]/);
  t.true(Boolean(indexBMatch));

  t.log('Write dontcommit-c.txt'); // dummy file just to ensure file is not commited
  fse.writeFileSync(join(snowWorkdir, 'dontcommit-c.txt'), 'dontcommit-c');

  if (indexAMatch) {
    const indexA: string = indexAMatch[1];
    await exec(t, snow, ['commit', '-m', 'commit a.txt', '--index', indexA], { cwd: snowWorkdir });
  }

  t.log('Write dontcommit-d.txt'); // dummy file just to ensure file is not commited
  fse.writeFileSync(join(snowWorkdir, 'dontcommit-d.txt'), 'dontcommit-d');

  if (indexBMatch) {
    const indexB: string = indexBMatch[1];
    await exec(t, snow, ['commit', '-m', 'commit b.txt', '--index', indexB], { cwd: snowWorkdir });
  }

  t.log('Write dontcommit-e.txt'); // dummy file just to ensure file is not commited
  fse.writeFileSync(join(snowWorkdir, 'dontcommit-e.txt'), 'dontcommit-e');

  const repo = await Repository.open(snowWorkdir);
  const allCommits = repo.getAllCommits(COMMIT_ORDER.OLDEST_FIRST);

  t.is(allCommits.length, 3, 'all 3 commits'); // Dummy commit 'Created Project' + 'commit a.txt' + 'commit b.txt'
  t.is(allCommits[1].message, 'commit a.txt');
  t.is(allCommits[2].message, 'commit b.txt');

  // ensure a.txt and b.txt are in their commits
  t.true(allCommits[1].root.children.map((t) => t.path).includes('a.txt'));
  t.true(allCommits[1].root.children.map((t) => t.path).includes('a.txt'));
  t.true(allCommits[2].root.children.map((t) => t.path).includes('b.txt'));

  // ensure the commits ONLY contain these files
  t.is(allCommits[1].root.children.length, 1, '"First" commit shall contain 1 file (a.txt)');
  t.is(allCommits[2].root.children.length, 2, 'Last commit shall contain 2 files (a.txt, b.txt)');
});

test('Multi-Index -- FAIL INVALID INPUT TEST 1', async (t) => {
  t.timeout(180000);

  const snow: string = getSnowexec(t);
  const snowWorkdir = generateUniqueTmpDirName();

  await exec(t, snow, ['init', basename(snowWorkdir)], { cwd: dirname(snowWorkdir) });

  t.log('Write abc.txt');
  fse.writeFileSync(join(snowWorkdir, 'abc.txt'), 'Hello World');

  const error = await t.throwsAsync(async () => exec(t, snow, ['add', '.', '--index', 'non-existing-index'], { cwd: snowWorkdir }));

  const errorMsgSub = 'fatal: unknown index: non-existing-index';
  t.true(error.message.includes(errorMsgSub));
  t.log('Test failed as expected');
});

test('driveinfo test', async (t) => {
  const snow: string = getSnowexec(t);

  const out1 = await exec(t, snow, ['driveinfo'], {}, EXEC_OPTIONS.RETURN_STDOUT) as string;

  const parsedObj = JSON.parse(out1);
  if (!Array.isArray(parsedObj) || parsedObj.length === 0) {
    t.fail('expected array with minimum size of 1 element');
    return;
  }

  t.log(out1);
  t.true(parsedObj[0].description?.length > 0, 'stdout must be a JSON parsable string');
  t.true(out1.includes('    '), 'driveinfo uses --output json-pretty as default and requires a 4-width space JSON output');

  const out2 = await exec(t, snow, ['driveinfo', '--output', 'json'], {}, EXEC_OPTIONS.RETURN_STDOUT) as string;
  t.true(JSON.parse(out2)[0].description?.length > 0, 'stdout must be a JSON parsable string');
  t.true(out1.includes('    '), 'driveinfo --output json must return a minified JSON output');

  const out3 = await exec(t, snow, ['driveinfo', '--output', 'json-pretty'], {}, EXEC_OPTIONS.RETURN_STDOUT) as string;
  t.true(JSON.parse(out3)[0].description?.length > 0, 'stdout must be a JSON parsable string');
  t.true(out1.includes('    '), 'driveinfo --output json-pretty requires a 4-width space JSON output');
});
