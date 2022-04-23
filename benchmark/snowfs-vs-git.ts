import * as readline from 'readline';
import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import * as os from 'os';
import { spawn } from 'child_process';
import { dirname, join, basename } from '../src/path';
import { Repository, RESET } from '../src/repository';
import { getErrorMessage } from '../src/common';

const chalk = require('chalk');

const BENCHMARK_FILE_SIZE = 4000000000;

async function input(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let res: string;

  rl.question(question, (answer: string) => {
    res = answer;
    rl.close();
  });

  return new Promise<string>((resolve) => {
    rl.on('close', () => {
      resolve(res);
    });
  });
}

function exec(command: string, args?: string[], t?: any, opts?: {cwd?: string}): Promise<void> {
  t.log(`$ ${command} ${args.join(' ')}`);
  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.' });
  return new Promise((resolve, reject) => {
    p0.stderr.on('data', (data) => {
      t.log(data.toString());
    });
    p0.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(code);
      }
    });
  });
}

async function createRandomBuffer(): Promise<Buffer> {
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    crypto.randomBytes(100000, (ex, buffer) => {
      if (ex) {
        reject(ex);
      }
      resolve(buffer);
    });
  });
  return buffer;
}

async function createFile(dst: string, size: number, t: any = console): Promise<void> {
  const stream = fse.createWriteStream(dst, { flags: 'w' });

  const delimiter = `Create ${basename(dst)} file of ${size} bytes`;
  let t0 = new Date().getTime();
  let curSize = 0;

  // if no terminal available, at least print the information about the size of hte file
  if (!process.stdout.isTTY) {
    t.log(`${delimiter}`);
  }

  for (let i = 0; i < size / 100000; ++i) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await createRandomBuffer();
    stream.write(buf);
    if (process.stdout.isTTY) {
      const t1 = new Date().getTime() - t0;
      if (t1 > 2000) {
        const percent = (curSize++ / size * 10000000.0).toFixed(2);

        process.stdout.write(`\r${delimiter} [${percent}%] ${'.'.repeat(i / 1000)}`);
        t0 = t1;
      }
    }
  }

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', () => {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${delimiter} [100%] ${'.'.repeat(10)}`);
        process.stdout.write('\n');
      }
      resolve();
    });
    stream.on('error', reject);
    stream.end();
  });
}

async function gitAddTexture(repoPath: string, textureFilesize: number = BENCHMARK_FILE_SIZE, t: any = console): Promise<number> {
  fse.rmdirSync(repoPath, { recursive: true });

  t.log(`Create Git(+LFS) Repository at: ${repoPath}`);
  await exec('git', ['init', basename(repoPath)], t, { cwd: dirname(repoPath) });
  await exec('git', ['config', 'user.name', 'github-actions'], t, { cwd: repoPath });
  await exec('git', ['config', 'user.email', 'snowtrack@example.com'], t, { cwd: repoPath });
  // don't print 'Note: switching to 'HEAD~1'.' to console, it spoils stdout
  await exec('git', ['config', 'advice.detachedHead', 'false'], t, { cwd: repoPath });
  // don't sign for this test, just in case the global/system config has this set
  await exec('git', ['config', 'commit.gpgsign', 'false'], t, { cwd: repoPath });
  await exec('git', ['lfs', 'install'], t, { cwd: repoPath });
  await exec('git', ['lfs', 'track', '*.psd'], t, { cwd: repoPath });

  const fooFile = join(repoPath, 'texture.psd');
  await createFile(fooFile, textureFilesize ?? BENCHMARK_FILE_SIZE, t);

  t.log('Checking in Git-LFS...');

  const t0 = new Date().getTime();
  await exec('git', ['add', fooFile], t, { cwd: repoPath });
  await exec('git', ['commit', '-m', 'My first commit'], t, { cwd: repoPath });
  return new Date().getTime() - t0;
}

async function gitRmTexture(repoPath: string, t: any = console): Promise<number> {
  t.log('Remove texture.psd...');

  const t0 = new Date().getTime();
  await exec('git', ['rm', 'texture.psd'], t, { cwd: repoPath });
  await exec('git', ['commit', '-m', 'Remove texture'], t, { cwd: repoPath });
  return new Date().getTime() - t0;
}

async function gitRestoreTexture(repoPath: string, t: any = console): Promise<number> {
  t.log('Restore texture.psd...');

  const t0 = new Date().getTime();
  await exec('git', ['checkout', 'HEAD~1'], t, { cwd: repoPath });
  return new Date().getTime() - t0;
}

export async function snowFsAddTexture(repoPath: string, textureFilesize: number = BENCHMARK_FILE_SIZE, t: any = console): Promise<number> {
  if (fse.pathExistsSync(repoPath)) {
    fse.rmdirSync(repoPath, { recursive: true });
  }

  t.log(`Create SnowFS Repository at: ${repoPath}`);
  const repo = await Repository.initExt(repoPath);
  const index = repo.ensureMainIndex();

  const fooFile = join(repoPath, 'texture.psd');
  await createFile(fooFile, textureFilesize, t);

  t.log('Checking in SnowFS...');

  const t0 = new Date().getTime();
  index.addFiles([fooFile]);
  await index.writeFiles();
  await repo.createCommit(index, 'add texture.psd');
  return new Date().getTime() - t0;
}

export async function snowFsRmTexture(repoPath: string, t: any = console): Promise<number> {
  t.log('Remove texture.psd...');

  const repo = await Repository.open(repoPath);
  const index = repo.ensureMainIndex();

  const t0 = new Date().getTime();
  fse.unlinkSync(join(repoPath, 'texture.psd'));
  index.deleteFiles(['texture.psd']);
  await index.writeFiles();
  await repo.createCommit(index, 'Remove texture');
  return new Date().getTime() - t0;
}

export async function snowFsRestoreTexture(repoPath: string, t: any = console): Promise<number> {
  t.log('Restore texture.psd...');

  const repo = await Repository.open(repoPath);

  const t0 = new Date().getTime();
  const commit = repo.findCommitByHash('HEAD~1');
  await repo.checkout(commit, RESET.RESTORE_DELETED_ITEMS);
  return new Date().getTime() - t0;
}

export async function startBenchmark(textureFilesize: number = BENCHMARK_FILE_SIZE, t: any = console): Promise<void> {
  let playground: string;
  while (true) {
    const desktop = join(os.homedir(), 'desktop');

    if (process.stdin.isTTY) {
      // eslint-disable-next-line no-await-in-loop
      const answer: string = await input(`Location for benchmark-tests [${desktop}]: `);
      playground = answer.length > 0 ? answer : desktop;
    } else {
      playground = os.tmpdir();
    }

    const tmp: string = join(playground, 'benchmark-xyz-test');
    try {
      fse.mkdirpSync(tmp);
      fse.rmdirSync(tmp);
    } catch (error) {
      t.log(error);
      // eslint-disable-next-line no-continue
      continue;
    }
    break;
  }

  t.log(chalk.bold('Benchmark Git'));
  const gitPath = join(playground, 'git-benchmark');
  const timeGitAdd = await gitAddTexture(gitPath, textureFilesize, t);
  const timeGitRm = await gitRmTexture(gitPath, t);
  const timeGitRestore = await gitRestoreTexture(gitPath, t);

  t.log(chalk.bold('Benchmark SnowFS'));
  const snowFsPath = join(playground, 'snowfs-benchmark');
  const timeSnowFsAdd = await snowFsAddTexture(snowFsPath, textureFilesize, t);
  const timeSnowFsRm = await snowFsRmTexture(snowFsPath, t);
  const timeSnowRestore = await snowFsRestoreTexture(snowFsPath, t);

  t.log(timeGitAdd, timeSnowFsRm, timeSnowRestore);
  t.log(`git add texture.psd:  ${`${chalk.red.bold(timeGitAdd)}ms`}`);
  t.log(`snow add texture.psd: ${`${chalk.green.bold(timeSnowFsAdd)}ms`}`);
  t.log(`git rm texture.psd:   ${`${chalk.red.bold(timeGitRm)}ms`}`);
  t.log(`snow rm texture.psd:  ${`${chalk.green.bold(timeSnowFsRm)}ms`}`);
  t.log(`git checkout HEAD~1:  ${`${chalk.red.bold(timeGitRestore)}ms`}`);
  t.log(`snow checkout HEAD~1: ${`${chalk.green.bold(timeSnowRestore)}ms`}  ${timeSnowRestore < 300 ? '<-- Yeah!' : ''}`);
}

if (process.env.NODE_ENV === 'benchmark') {
  void (async () => {
    try {
      await startBenchmark();
    } catch (e) {
      process.stderr.write(getErrorMessage(e));
    }
  })();
}
