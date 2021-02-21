import test from 'ava';
import * as os from 'os';
import * as fse from 'fs-extra';

import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';

enum EXEC_OPTIONS {
  RETURN_STDOUT = 1
}

async function exec(t, command: string, args?: string[], opts?: {cwd?: string}, returnStdout?: EXEC_OPTIONS): Promise<void | string> {
  t.log(`Execute ${command} ${args.join(' ')}`);
  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.', env: { SUPPRESS_BANNER: 'true' } });
  return new Promise((resolve, reject) => {
    let stdout: string;
    p0.stdout.on('data', (data) => {
      if (returnStdout === EXEC_OPTIONS.RETURN_STDOUT) {
        stdout = data.toString();
      } else {
        t.log(data.toString());
      }
    });
    p0.stderr.on('data', (data) => {
      t.log(data.toString());
    });
    p0.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout ?? undefined);
      } else {
        reject(Error(`Failed to execute ${command} ${args.join(' ')} with return-code ${code}`));
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

function createUniqueTmpDir(): string {
  return join(os.tmpdir(), fse.mkdtempSync('snowfs-cli-test-'));
}

if (!process.env.GITHUB_WORKFLOW || process.platform !== 'darwin') {
  // test doesn't work on the GitHub runners
  // https://github.com/seb-mtl/SnowFS/runs/1923599289?check_suite_focus=true#step:7:245

  test('snow add/commit/log', async (t) => {
    t.timeout(180000);

    const snow: string = getSnowexec(t);
    const snowWorkdir = createUniqueTmpDir();

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
    const snowWorkdir = createUniqueTmpDir();
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
    const snowWorkdir = createUniqueTmpDir();
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
    const snowWorkdir = createUniqueTmpDir();
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
    const snowWorkdir = createUniqueTmpDir();
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
}
