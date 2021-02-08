import { spawn } from 'child_process';
import { dirname, join, basename } from 'path';
import * as readline from 'readline';
import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import * as os from 'os';
import { Repository } from '../src/repository';

// eslint-disable-next-line import/no-extraneous-dependencies
const { green, red } = require('kleur');

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

  const delimiter: string = `Create ${basename(dst)} file of 4GB`;
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
        process.stdout.write(`\r${delimiter} [${percent}%] ${'.'.repeat(t1 / 10000)}`);
        tLast = t1;
      }
    }
  }

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', () => {
      process.stdout.write(`\r${delimiter} [100%] ${'.'.repeat(10)}`);
      process.stdout.write('\n');
      resolve();
    });
    stream.on('error', (error) => {
      reject(error);
    });
    stream.end();
  });
}

async function gitAdd(repoPath: string): Promise<number> {
  const gitPath = join(repoPath, 'git-benchmark');
  fse.rmdirSync(gitPath, { recursive: true });

  console.log(`Create Git(+LFS) Repository at: ${gitPath}`);
  await exec('git', ['init', basename(gitPath)], { cwd: dirname(gitPath) });
  await exec('git', ['lfs', 'install'], { cwd: gitPath });
  await exec('git', ['lfs', 'track', '*.psd'], { cwd: gitPath });

  const fooFile = join(gitPath, 'texture.psd');
  await createFile(fooFile, BENCHMARK_FILE_SIZE);

  console.log('Checking in Git-LFS ...');

  const t0 = new Date().getTime();
  await exec('git', ['add', fooFile], { cwd: gitPath });
  await exec('git', ['commit', '-m', 'My first commit'], { cwd: gitPath });
  const t1: number = new Date().getTime() - t0;
  console.log(`Checking in took ${t1} milliseconds`);
  return t1;
}

async function snowFsAdd(repoPath: string): Promise<number> {
  const gitPath = join(repoPath, 'snowfs-benchmark');
  fse.rmdirSync(gitPath, { recursive: true });

  console.log(`Create SnowFS Repository at: ${gitPath}`);
  const repo = await Repository.initExt(gitPath);
  const index = repo.getIndex();

  const fooFile = join(gitPath, 'texture.psd');
  await createFile(fooFile, BENCHMARK_FILE_SIZE);

  const t0 = new Date().getTime();
  index.addFiles([fooFile]);
  await index.writeFiles();
  await repo.createCommit(index, 'This is my first commit');
  const t1: number = new Date().getTime() - t0;
  console.log(`Checking in took ${t1} milliseconds`);
  return t1;
}

async function main() {
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
  let timeSnowFsAdd: number;

  console.log('Benchmark Git');
  console.log('-------------');
  try {
    timeGitAdd = await gitAdd(playground);
  } catch (error) {
    console.log(error);
  }

  console.log('\n\n\n');

  console.log('Benchmark SnowFS');
  console.log('----------------');
  try {
    timeSnowFsAdd = await snowFsAdd(playground);
  } catch (error) {
    console.log(error);
  }

  if (timeGitAdd < timeSnowFsAdd) {
    console.log(red('Git wins, please report this ;-)'));
  } else if (timeGitAdd > timeSnowFsAdd) {
    console.log(green(`Snowtrack was ${((timeGitAdd - timeSnowFsAdd) / timeSnowFsAdd * 100).toFixed(2)}% faster`));
  } else if (timeGitAdd === timeSnowFsAdd) {
    console.log('Same speed on ms? That\'s odd...');
  }
}

main();
