/* eslint-disable max-len */
import * as fse from 'fs-extra';

import { intersection } from 'lodash';
import {
  isAbsolute, join, resolve, relative,
} from 'path';
import { Index } from './src/index';
import { Commit } from './src/commit';
import { DirItem, OSWALK, osWalk } from './src/io';
import { Reference } from './src/reference';
import {
  StatusEntry, FILTER, Repository, RESET,
} from './src/repository';

const program = require('commander');
const chalk = require('chalk');

program
  .version('0.0.1')
  .description('SnowFS - a fast, scalable version control file storage for graphic files.');

program
  .command('init [path] [commondir]')
  .description('initialize a SnowFS repository')
  .action(async (path: string, commondir?: string) => {
    const repoPath: string = path ?? '.';
    try {
      await Repository.initExt(repoPath, { commondir });
    } catch (error) {
      console.log(`fatal: ${error.message}`);
      process.exit(-1);
    }
    console.log(`Initialized empty SnowFS repository at ${resolve(repoPath)}`);
  });

program
  .command('rm [path]')
  .description('Remove files from the working tree and from the index')
  .action(async (path: string) => {
    let repo: Repository;
    try {
      repo = await Repository.open(process.cwd());
    } catch (error) {
      console.log(`fatal: ${error.message}`);
      process.exit(-1);
    }

    const filepathAbs: string = isAbsolute(path) ? path : join(repo.workdir(), path);
    fse.unlinkSync(filepathAbs);

    const index: Index = repo.getIndex();
    index.deleteFiles([path]);
    await index.writeFiles();
  });

program
  .command('add <path>')
  .description('add file contents to the index')
  .action(async (path: string) => {
    let repo: Repository;
    try {
      repo = await Repository.open(process.cwd());
    } catch (error) {
      console.log(`fatal: ${error.message}`);
      process.exit(-1);
    }

    const files: string[] = [];
    const stats: fse.Stats = fse.statSync(path);
    if (stats.isDirectory()) {
      const dirItems: DirItem[] = await osWalk(path, OSWALK.FILES);
      for (const dirItem of dirItems) files.push(resolve(dirItem.path));
    } else files.push(resolve(path));

    if (files.length === 0) return;

    const statusFiles: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_UNTRACKED);

    const index: Index = repo.getIndex();
    index.addFiles(intersection(files, statusFiles.map((v: StatusEntry) => resolve(v.path))));
    await index.writeFiles();
  });

function commaSeparatedList(value, dummyPrevious) {
  return value.split(',');
}

const checkoutDesc = `checkout a commit, or create a branch

${chalk.bold('Examples')}

    Checkout a commit
      $ snow checkout 75f4d24726ce95dde1376c19a1ce16e53e7b1db7ffcb508f8abf57026784c040

      - If there is only one reference pointing to '75f4d24..' then the reference is checked out.
        If you still need to be in a detached head after the command, pass '-d'.

      - If there is more than one reference pointing to '75f4d24..' an error is raised.

      - If no reference is pointing to '75f4d24..', then the commit is checked out.

    Create a new branch
      $ snow checkout -b <branch-name> <start-point>
      
      - The branch must not exist yet, otherwise an error is raised`;

program
  .command('checkout [target]')
  .option('-b, --branch <args...>')
  .option('-d, --detach', 'detach the branch')
  .option('-n, --no-reset', "don't modify the worktree")
  .option('-d, --debug', 'add more debug information on errors')
  .option('--no-color')
  .description(checkoutDesc)
  .action(async (target: string | undefined, opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    let repo: Repository;
    try {
      repo = await Repository.open(process.cwd());

      if (opts.branch) { // snow checkout -b ref-name [hash]
        const startPoint: string = opts.branch.length >= 1 ? opts.branch[1] : repo.getHead().hash;
        await repo.createReference(opts.branch[0], startPoint);
      } else if (target) { // snow checkout [hash]
        let reset: RESET = RESET.NONE;
        if (opts.reset) {
          reset |= RESET.DEFAULT;
        }
        if (opts.detach) {
          reset |= RESET.DETACH;
        }
        await repo.restore(target, reset);
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

program
  .command('status')
  .option('--no-color')
  .description('show the working tree status')
  .action(async (opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    let repo: Repository;
    try {
      repo = await Repository.open(process.cwd());
    } catch (error) {
      console.log(`fatal: ${error.message}`);
      process.exit(-1);
    }

    const files: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_IGNORED | FILTER.INCLUDE_UNTRACKED);
    const newFiles: StatusEntry[] = [];
    const modifiedFiles: StatusEntry[] = [];
    const deletedFiles: StatusEntry[] = [];
    for (const file of files) {
      if (file.isNew()) {
        newFiles.push(file);
      } else if (file.isModified()) {
        modifiedFiles.push(file);
      } else if (file.isDeleted()) {
        deletedFiles.push(file);
      }
    }

    const index = repo.getIndex();

    console.log(`On branch ${repo.getHead().getName()}`);
    console.log('Changes not staged for commit:');
    console.log('use "snow add <file>..." to update what will be committed');
    // console.log(`use "snow restore <file>..." to discard changes in working directory`);
    for (const modifiedFile of modifiedFiles) {
      console.log(modifiedFile.path);
    }
    process.stdout.write('\n');
    if (deletedFiles.length > 0) {
      console.log('Deleted files:');
      for (const deleteFile of deletedFiles) {
        console.log(deleteFile.path);
      }
    } else {
      console.log('no deleted changes added to commit (use "snow rm")');
    }
    process.stdout.write('\n');
    if (newFiles.length > 0) {
      console.log('New files:');
      for (const newFile of newFiles) {
        if (index.adds.has(relative(repo.workdir(), newFile.path))) {
          process.stdout.write(chalk.red('+ '));
        }
        console.log(newFile.path);
      }
    } else {
      console.log('no changes added to commit (use "snow add"');
    }
  });

program
  .command('commit')
  .option('-m, --message [message]', 'input file')
  .description('complete the commit')
  .action(async (opts) => {
    let repo: Repository;
    try {
      repo = await Repository.open(process.cwd());
    } catch (error) {
      console.log(`fatal: ${error.message}`);
      process.exit(-1);
    }

    const index: Index = repo.getIndex();
    const newCommit: Commit = await repo.createCommit(index, opts.message);
    console.log(`[${repo.getHead().getName()} (root-commit) ${newCommit.hash.substr(0, 6)}]`);
  });

program
  .command('log')
  .option('--no-color')
  .description('print the log to the console')
  .action(async (opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    let repo: Repository;
    try {
      repo = await Repository.open(process.cwd());
    } catch (error) {
      console.log(`fatal: ${error.message}`);
      process.exit(-1);
    }

    const commits: Commit[] = repo.getAllCommits();
    commits.sort((a: Commit, b: Commit) => {
      const aDate = a.date.getTime();
      const bDate = b.date.getTime();
      if (aDate > bDate) {
        return 1;
      } if (aDate < bDate) {
        return -1;
      }
      return 0;
    });

    const refs: Reference[] = repo.getAllReferences();
    const headHash: string = repo.getHead().hash;
    const headName: string = repo.getHead().getName();

    for (const commit of commits.reverse()) {
      process.stdout.write(chalk.magenta.bold(`commit: ${commit.hash}`));

      const branchRefs: Reference[] = refs.filter((ref: Reference) => ref.hash === commit.hash);
      if (repo.getHead().isDetached() && commit.hash === headHash) {
        branchRefs.unshift(repo.getHead());
      }

      if (branchRefs.length > 0) {
        process.stdout.write('  (');

        process.stdout.write(`${branchRefs.map((ref) => {
          if (ref.hash === commit.hash) {
            if (ref.getName() === headName) {
              if (headName === 'HEAD') {
                return chalk.blue.bold(ref.getName());
              }
              return chalk.blue.bold(`HEAD -> ${ref.getName()}`);
            }
            return chalk.rgb(255, 165, 0)(ref.getName());
          }
          return null;
        }).filter((x) => !!x).join(', ')}`);

        process.stdout.write(')');
      }
      process.stdout.write('\n');

      console.log(`Date: ${commit.date}`);
      console.log(`\n  ${commit.message}\n`);
    }
  });

program.parse(process.argv.filter((x) => x !== '--'));
