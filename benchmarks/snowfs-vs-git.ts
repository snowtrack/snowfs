import { spawn } from 'child_process';
import { dirname, join, basename } from 'path';
import * as readline from 'readline';
import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import * as os from 'os';
import { Repository, RESET } from '../src/repository';

// eslint-disable-next-line import/no-extraneous-dependencies
const { green, red } = require('kleur');
const chalk = require('chalk');

const BENCHMARK_FILE_SIZE = 4000000;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function input(question: string): Promise<string> {
  let res: string;
  rl.question(question, (answer: string) => {
    res = answer;
    rl.close();
  });

  return new Promise<string>((resolve, reject) => {
    rl.on('close', () => {
      resolve(res);
    });
  });
}

async function exec(command: string, args?: string[], opts?: {cwd?: string}): Promise<void> {
  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.' });
  return new Promise((resolve, reject) => {
    p0.on('data', (data) => {
      console.error(data.toString());
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

async function createRandomBuffer() {
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

async function createFile(dst: string, size: number, progress: boolean = true) {
  const stream = fse.createWriteStream(dst, { flags: 'w' });

  const delimiter: string = `Create ${basename(dst)} file of ${size} bytes`;
  const t0 = new Date().getTime();
  let tLast = t0;
  let curSize: number = 0;
  for (let i = 0; i < size / 100; ++i) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await createRandomBuffer();
    stream.write(buf);
    if (progress) {
      const t1 = new Date().getTime() - t0;
      if (t1 > 5000) {
        const percent = (curSize++ / size * 10000.0).toFixed(2);

        if (process.env.NODE_ENV === 'benchmark') {
          process.stdout.write(`\r${delimiter} [${percent}%] ${'.'.repeat(t1 / 10000)}`);
        }
        tLast = t1;
      }
    }
  }

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', () => {
      if (process.env.NODE_ENV === 'benchmark') {
        process.stdout.write(`\r${delimiter} [100%] ${'.'.repeat(10)}`);
      }
      process.stdout.write('\n');
      resolve();
    });
    stream.on('error', (error) => {
      reject(error);
    });
    stream.end();
  });
}

async function gitAddTexture(repoPath: string): Promise<number> {
  fse.rmdirSync(repoPath, { recursive: true });

  console.log(`Create Git(+LFS) Repository at: ${repoPath}`);
  await exec('git', ['init', basename(repoPath)], { cwd: dirname(repoPath) });
  await exec('git', ['lfs', 'install'], { cwd: repoPath });
  await exec('git', ['lfs', 'track', '*.psd'], { cwd: repoPath });

  const fooFile = join(repoPath, 'texture.psd');
  await createFile(fooFile, BENCHMARK_FILE_SIZE);

  console.log('Checking in Git-LFS...');

  const t0 = new Date().getTime();
  await exec('git', ['add', fooFile], { cwd: repoPath });
  await exec('git', ['commit', '-m', 'My first commit'], { cwd: repoPath });
  return new Date().getTime() - t0;
}

async function gitRmTexture(repoPath: string): Promise<number> {
  console.log('Remove texture.psd...');

  const t0 = new Date().getTime();
  await exec('git', ['rm', 'texture.psd'], { cwd: repoPath });
  await exec('git', ['commit', '-m', 'Remove texture'], { cwd: repoPath });
  return new Date().getTime() - t0;
}

async function gitRestoreTexture(repoPath: string): Promise<number> {
  console.log('Restore texture.psd...');

  const t0 = new Date().getTime();
  await exec('git', ['checkout', 'HEAD~1'], { cwd: repoPath });
  return new Date().getTime() - t0;
}

export async function snowFsAddTexture(repoPath: string, textureFilesize: number = BENCHMARK_FILE_SIZE, t: any = console.log): Promise<number> {
  fse.rmdirSync(repoPath, { recursive: true });

  t(`Create SnowFS Repository at: ${repoPath}`);
  const repo = await Repository.initExt(repoPath);
  const index = repo.getIndex();

  const fooFile = join(repoPath, 'texture.psd');
  await createFile(fooFile, textureFilesize);

  t('Checking in SnowFS...');

  const t0 = new Date().getTime();
  index.addFiles([fooFile]);
  await index.writeFiles();
  await repo.createCommit(index, 'add texture.psd');
  return new Date().getTime() - t0;
}

export async function snowFsRmTexture(repoPath: string, t: any = console.log): Promise<number> {
  t('Remove texture.psd...');

  const repo = await Repository.open(repoPath);
  const index = repo.getIndex();

  const t0 = new Date().getTime();
  index.deleteFiles(['texture.psd']);
  await index.writeFiles();
  await repo.createCommit(index, 'Remove texture');
  return new Date().getTime() - t0;
}

export async function snowFsRestoreTexture(repoPath: string, t: any = console.log): Promise<number> {
  t('Restore texture.psd...');

  const repo = await Repository.open(repoPath);

  const t0 = new Date().getTime();
  const commit = repo.getCommitByHash(repo.getCommitByHead().parent[0]);
  repo.restore(commit, RESET.RESTORE_DELETED_FILES);
  return new Date().getTime() - t0;
}

export async function startBenchmark() {
  let playground: string;
  while (true) {
    const desktop = join(os.homedir(), 'desktop');

    // eslint-disable-next-line no-await-in-loop
    const answer: string = await input(`Location for benchmark-tests [${desktop}]: `);
    if (answer.length > 0) {
      playground = answer;
    } else {
      playground = desktop;
    }

    const tmp: string = join(playground, 'benchmark-xyz-test');
    try {
      fse.mkdirpSync(tmp);
      fse.rmdirSync(tmp);
    } catch (error) {
      console.log(error);
      // eslint-disable-next-line no-continue
      continue;
    }
    break;
  }

  let timeGitAdd: number;
  let timeGitRm: number;
  let timeGitRestore: number;

  console.log(chalk.bold('Benchmark Git'));
  try {
    const gitPath = join(playground, 'git-benchmark');
    timeGitAdd = await gitAddTexture(gitPath);
    timeGitRm = await gitRmTexture(gitPath);
    timeGitRestore = await gitRestoreTexture(gitPath);
  } catch (error) {
    console.log(error);
  }

  let timeSnowFsAdd: number;
  let timeSnowFsRm: number;
  let timeSnowRestore: number;

  console.log(chalk.bold('Benchmark SnowFS'));
  try {
    const gitPath = join(playground, 'snowfs-benchmark');
    timeSnowFsAdd = await snowFsAddTexture(gitPath);
    timeSnowFsRm = await snowFsRmTexture(gitPath);
    timeSnowRestore = await snowFsRestoreTexture(gitPath);
  } catch (error) {
    console.log(error);
  }

  console.log(`git add texture.psd:  ${`${chalk.red.bold(timeGitAdd)}ms`}`);
  console.log(`snow add texture.psd: ${`${chalk.bgWhite.green.bold(timeSnowFsAdd)}ms`}`);
  console.log(`git rm texture.psd:   ${`${chalk.red.bold(timeGitRm)}ms`}`);
  console.log(`snow rm texture.psd:  ${`${chalk.bgWhite.green.bold(timeSnowFsRm)}ms`}`);
  console.log(`git checkout HEAD~1:  ${`${chalk.red.bold(timeGitRestore)}ms`}`);
  console.log(`snow checkout HEAD~1: ${`${chalk.bgWhite.green.bold(timeSnowRestore)}ms`}`);
}

if (process.env.NODE_ENV === 'benchmark') {
  startBenchmark();
}
