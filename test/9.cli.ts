import test from 'ava';
import * as os from 'os';
import * as fse from 'fs-extra';

import { spawn } from 'child_process';
import { join, dirname } from 'path';

async function exec(command: string, args?: string[], opts?: {cwd?: string}): Promise<void> {
  console.log(`Execute ${command} ${args.join(' ')}`);
  const p0 = spawn(command, args ?? [], { cwd: opts?.cwd ?? '.' });
  return new Promise((resolve, reject) => {
    p0.stdout.on('data', (data) => {
      console.log(data.toString());
    });
    p0.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(Error(`Failed to execute ${command} ${args} with return-code ${code}`));
      }
    });
  });
}

test('run-cli-test', async (t) => {
  let snow;
  switch (process.platform) {
    case 'darwin':
      snow = join(__dirname, '..', './bin/snow');
      break;
    case 'win32':
      snow = join(__dirname, '..', './bin/snow.bat');
      break;
    default:
      throw new Error('Unsupported Operating System');
  }
  const playground = join(os.tmpdir(), 'xyz');

  if (fse.pathExistsSync(playground)) {
    fse.rmdirSync(playground, { recursive: true });
  }

  await exec(snow, ['init', playground], { cwd: dirname(os.tmpdir()) });

  for (let i = 0; i < 2; ++i) {
    console.log(`Write abc${i}.txt`);
    fse.writeFileSync(join(playground, `abc${i}.txt`), 'Hello World');
    // eslint-disable-next-line no-await-in-loop
    await exec(snow, ['add', '.'], { cwd: playground });
    // eslint-disable-next-line no-await-in-loop
    await exec(snow, ['commit', '-m', `add hello-world ${i}`], { cwd: playground });
    // eslint-disable-next-line no-await-in-loop
    await exec(snow, ['log'], { cwd: playground });
  }

  t.is(true, true);
});
