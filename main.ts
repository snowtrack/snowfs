/* eslint-disable max-len */
import * as fse from 'fs-extra';

import * as readline from 'readline';
import {
  isAbsolute, join, resolve, relative, normalize,
} from './src/path';

import { Index } from './src/index';
import { Commit } from './src/commit';
import { Reference } from './src/reference';
import {
  StatusEntry, FILTER, Repository, RESET, COMMIT_ORDER, REFERENCE_TYPE,
} from './src/repository';
import { TreeDir, TreeEntry, TreeFile } from './src/treedir';
import { IoContext } from './src/io_context';

const program = require('commander');
const chalk = require('chalk');
const drivelist = require('drivelist');
const AggregateError = require('es-aggregate-error');

function fileMatch(relFilepath: string, relCwd: string, pathPattern: string): boolean {
  return pathPattern === '*' || (pathPattern === '.' && relFilepath.startsWith(relCwd)) || pathPattern === relative(relCwd, relFilepath);
}

/**
 * Helper function to get an existing or creating a new index.
 * @param index   Either null/defined, or 'create' or an existing index;
*/
function getIndex(repo: Repository, index: string | null | undefined) {
  if (index === 'create') {
    const i = repo.createIndex();
    console.log(`Created new index: [${i.id}]`);
    return i;
  }
  if (index) {
    const i = repo.getIndex(index);
    if (!i) {
      throw new Error(`unknown index: ${index}`);
    }
    return i;
  }
  return repo.ensureMainIndex();
}

/**
 * Helper function for additional parsing options. Some CLI commands support passing information
 * through stdin or a text-file (e.g. --user-data for commits). If the passed options object
 * contains 'input', the options can be loaded from a stdin, otherwise the value is treated as
 * a filepath. The content is extracted from the source and applied on top of the 'opts' object.
 *
 * Example:
 *    --cmd-arg1: can,be,multiple\nlines\r\n\r\n\r\n\r\n
 *    --cmd-arg2: random-value
 *
 * '\r\n\r\n\r\n\r\n' is the delimiter between the passed arguments.
 * The payload of the argument must not contain the delimiter, otherwise an error will occur.
 *
 * @param opts      Options passed from the commander.
 * @return          New options object.
 */
async function parseOptions(opts: any) {
  let tmp: string;
  if (opts.input) {
    if (opts.input === 'stdin') {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let res: string;

      rl.question('', (answer: string) => {
        res = answer;
        rl.close();
      });

      tmp = await new Promise<string>((resolve, reject) => {
        rl.on('close', () => {
          resolve(res);
        });
      });
    } else { // else assumes it is a file-path
      const buf: Buffer = fse.readFileSync(opts.input);
      tmp = buf.toString();
    }
  } else {
    // no --input set, simply use the options from the command-line
    return opts;
  }

  const splitOpts: string[] = tmp.split('\r\n\r\n\r\n\r\n');
  for (const splitOpt of splitOpts) {
    if (!splitOpt.startsWith('--')) {
      throw new Error("option must start with '--', e.g. --option: value");
    }

    // '--option:'
    const parsed = splitOpt.match(/--([\w-]+):/g);
    if (!parsed) {
      throw new Error(`option '${parsed}' is invalid`);
    }

    // '--foo-bar:' ==> 'fooBar'
    const parsedOption = parsed[0].substr(2, parsed[0].length - 3)
      .replace(/-([a-z])/g, (g) => g[1].toUpperCase());

    opts[parsedOption] = splitOpt.substring(parsed[0].length, splitOpt.length)
      .replace(/^[\n|\s]*/, '')
      .replace(/[\n|\s]*$/, '');
  }

  return opts;
}

program
  .version('0.9.1')
  .description('SnowFS - a fast, scalable version control file storage for graphic files.');

program
  .command('init [path] [commondir]')
  .option('--debug', 'add more debug information on errors')
  .description('initialize a SnowFS repository')
  .action(async (path: string, commondir?: string, opts?: any) => {
    const repoPath: string = path ?? '.';
    try {
      await Repository.initExt(repoPath, { commondir });
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
    console.log(`Initialized empty SnowFS repository at ${resolve(repoPath)}`);
  });

program
  .command('rm [path]')
  .option('--index [id]', 'use a custom index id')
  .option('--debug', 'add more debug information on errors')
  .description('Remove files from the working tree and from the index')
  .action(async (path: string, opts?: any) => {
    try {
      const repo = await Repository.open(normalize(process.cwd()));

      const filepathAbs: string = isAbsolute(path) ? path : join(repo.workdir(), path);

      // important! this fails and throw an error
      // if the file is not there! (expected by a unit-test in 9.cli.test)
      fse.statSync(filepathAbs);

      await IoContext.putToTrash(filepathAbs);

      const index: Index = getIndex(repo, opts.index);
      index.deleteFiles([path]);
      await index.writeFiles();
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('add <path>')
  .option('--index [id]', 'use a custom index id')
  .option('--debug', 'add more debug information on errors')
  .description('add file contents to the index')
  .action(async (pathPattern: string, opts?: any) => {
    try {
      const repo = await Repository.open(normalize(process.cwd()));

      const statusFiles: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_MODIFIED | FILTER.INCLUDE_DELETED | FILTER.INCLUDE_UNTRACKED);

      const relCwd = relative(repo.workdir(), normalize(process.cwd()));

      const index: Index = getIndex(repo, opts.index);
      for (const file of statusFiles) {
        if (file.isNew() || file.isModified()) {
          if (fileMatch(file.path, relCwd, pathPattern)) {
            index.addFiles([file.path]);
          }
        }
      }
      for (const file of statusFiles) {
        if (file.isDeleted()) {
          if (fileMatch(file.path, relCwd, pathPattern)) {
            index.deleteFiles([file.path]);
          }
        }
      }
      await index.writeFiles();
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('branch [branch-name] [start-point]')
  .option('--debug', 'add more debug information on errors')
  .option('--delete', 'delete a branch')
  .option('--no-color')
  .option('--user-data', 'open standard input to apply user data for commit')
  .option('--input <type>', "type can be 'stdin' or {filepath}")
  .description('create a new branch')
  .action(async (branchName: string, startPoint: string, opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      opts = await parseOptions(opts);
      const repo = await Repository.open(normalize(process.cwd()));

      if (opts.delete) {
        if (startPoint) {
          throw new Error('start-point must be empty');
        }

        const oldTarget = await repo.deleteReference(REFERENCE_TYPE.BRANCH, branchName);
        console.log(`Deleted branch '${branchName}' (was ${oldTarget})`);
      } else {
        let data = {};
        if (opts.userData) {
          try {
            data = JSON.parse(opts.userData);
          } catch (e) {
            throw new Error(`invalid user-data: ${e}`);
          }
        }

        await repo.createNewReference(REFERENCE_TYPE.BRANCH, branchName, startPoint, data);
        console.log(`A branch '${branchName}' got created.`);
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('checkout [target]')
  .option('--discard-changes', 'force switch and discard changes in workdir')
  .option('-k, --keep-changes', "don't reset files in the workdir")
  .option('--debug', 'add more debug information on errors')
  .option('--no-color')
  .option('--user-data', 'open standard input to apply user data for commit')
  .option('--input <type>', "type can be 'stdin' or {filepath}")
  .description('checkout a commit')
  .action(async (target: string | undefined, opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      opts = await parseOptions(opts);
      const repo = await Repository.open(normalize(process.cwd()));
      const targetCommit = repo.findCommitByHash(target);
      if (!targetCommit) {
        if (repo.findCommitByReferenceName(REFERENCE_TYPE.BRANCH, target)) {
          throw new Error(`target ${target} seems to be a branch and must be checked out via 'snow switch'`);
        }
        throw new Error(`cannot find commit '${target}'`);
      }

      if (target) {
        if (opts.discardChanges && opts.keepChanges) {
          throw new Error('either --discard-changes or --keep-changes can be used, not both');
        } else if (!opts.discardChanges && !opts.keepChanges) {
          const statusFiles: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_UNTRACKED | FILTER.INCLUDE_MODIFIED);
          let criticalChanges = 0;
          for (const statusFile of statusFiles) {
            // new or modified files will abort the checkout to prevent data loss
            if (statusFile.isModified()) {
              process.stdout.write(`M ${statusFile.path}\n`);
              criticalChanges++;
            } else if (statusFile.isNew()) {
              process.stdout.write(`A ${statusFile.path}\n`);
              criticalChanges++;
            }
            // 'Ignored' or 'Deleted' files can also be ignored, since they could be restored
          }
          if (criticalChanges > 0) {
            throw new Error(`You have local changes to '${target}'; not switching branches.`);
          }
        }

        let reset: RESET = RESET.DETACH; // checkout always results in a detached HEAD
        if (!opts.keepChanges) {
          reset |= RESET.RESTORE_MODIFIED_ITEMS | RESET.DELETE_NEW_ITEMS | RESET.RESTORE_DELETED_ITEMS;
        }

        await repo.checkout(target, reset);
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('index [command]')
  .action(async (command: any, opts: any) => {
    try {
      const repo = await Repository.open(normalize(process.cwd()));
      if (command === 'create') {
        const index = repo.createIndex();
        // the user explicitely asked for an index
        // so we must dump the empty index to disk
        await index.writeFiles();

        console.log(`Created new index: [${index.id}]`);
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('status')
  .option('--no-color')
  .option('--output [format]', "currently supported output formats 'json', 'json-pretty'")
  .option('--index [id]', 'use a custom index id')
  .option('--debug', 'add more debug information on errors')
  .description('show the working tree status')
  .action(async (opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      const repo = await Repository.open(normalize(process.cwd()));

      const statuses: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_MODIFIED | FILTER.INCLUDE_DELETED | FILTER.INCLUDE_UNTRACKED | FILTER.INCLUDE_DIRECTORIES);
      const newe: StatusEntry[] = [];
      const modified: StatusEntry[] = [];
      const deleted: StatusEntry[] = [];
      for (const status of statuses) {
        if (status.isNew()) {
          newe.push(status);
        } else if (status.isModified()) {
          modified.push(status);
        } else if (status.isDeleted()) {
          deleted.push(status);
        }
      }

      const index: Index = getIndex(repo, opts.index);

      if (opts.output === 'json' || opts.output === 'json-pretty') {
        const o = { new: newe, modified, deleted };

        process.stdout.write(JSON.stringify(o, (key, value) => {
          if (value instanceof StatusEntry) {
            return {
              path: value.path, isdir: value.isdir,
            };
          }
          return value;
        }, opts.output === 'json-pretty' ? '   ' : ''));
      } else {
        console.log(`On branch ${repo.getHead().getName()}`);
        console.log('Changes not staged for commit:');
        console.log('use "snow add <rel-path>..." to update what will be committed');

        for (const modifiedFile of modified) {
          console.log(modifiedFile.path);
        }
        process.stdout.write('\n');
        if (deleted.length > 0) {
          console.log('Deleted:');
          for (const del of deleted) {
            console.log(del.path);
          }
        } else {
          console.log('no deleted changes added to commit (use "snow rm")');
        }
        process.stdout.write('\n');
        if (newe.length > 0) {
          console.log('New:');
          for (const n of newe) {
            if (index.addRelPaths.has(n.path)) {
              process.stdout.write(chalk.red('+ '));
            }
            console.log(n.path);
          }
        } else {
          console.log('no changes added to commit (use "snow add"');
        }
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
    // process.exit(0);
  });

program
  .command('commit')
  .option('-m, --message [message]', 'input file')
  .option('--allow-empty', 'allow an empty commit without any changes, not set by default')
  .option('--debug', 'add more debug information on errors')
  .option('--user-data', 'open standard input to apply user data for commit')
  .option('--tags [collection]', 'add user defined tags to commit')
  .option('--input <type>', "type can be 'stdin' or {filepath}")
  .option('--index [id]', 'use a custom index id')
  .description('complete the commit')
  .action(async (opts: any) => {
    try {
      opts = await parseOptions(opts);

      const repo = await Repository.open(normalize(process.cwd()));
      const index: Index = getIndex(repo, opts.index);
      let data = {};

      let tags: string[];
      if (opts.tags && opts.tags.length > 0) {
        tags = String(opts.tags).split(',');
      }

      if (opts.userData) {
        try {
          data = JSON.parse(opts.userData);
        } catch (e) {
          throw new Error(`invalid user-data: ${e}`);
        }
      }

      const newCommit: Commit = await repo.createCommit(index, opts.message, opts, tags, data);

      console.log(`[${repo.getHead().getName()} (root-commit) ${newCommit.hash.substr(0, 6)}]`);
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('log')
  .option('--no-color')
  .option('-v, --verbose', 'verbose')
  .option('--output [format]', "currently supported output formats 'json', 'json-pretty'")
  .option('--debug', 'add more debug information on errors')
  .description('print the log to the console')
  .action(async (opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      const repo = await Repository.open(normalize(process.cwd()));

      const commits: Commit[] = repo.getAllCommits(COMMIT_ORDER.NEWEST_FIRST);
      const refs: Reference[] = repo.getAllReferences();
      const headHash: string = repo.getHead().hash;
      const headName: string = repo.getHead().getName();

      if (opts.output === 'json' || opts.output === 'json-pretty') {
        const o = { commits, refs, head: headName };

        process.stdout.write(JSON.stringify(o, (key, value) => {
          if (value instanceof Commit) {
            return {
              hash: value.hash,
              message: value.message,
              date: value.date.getTime() / 1000.0,
              root: opts.verbose ? value.root : undefined,
              tags: value.tags,
              userData: value.userData ? JSON.parse(JSON.stringify(value.userData)) : {},
            };
          }
          if (value instanceof TreeDir) {
            return { path: value.path, hash: value.hash, children: value.children };
          }
          if (value instanceof TreeFile) {
            return {
              path: value.path,
              hash: value.hash,
              ctime: value.ctime / 1000.0,
              mtime: value.mtime / 1000.0,
              size: value.size,
            };
          }
          if (value instanceof Reference) {
            return {
              name: value.getName(),
              hash: value.hash,
              start: value.startHash,
              userData: value.userData ? JSON.parse(JSON.stringify(value.userData)) : {},
            };
          }
          return value;
        }, opts.output === 'json-pretty' ? '   ' : ''));
      } else {
        for (const commit of commits) {
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

          process.stdout.write(`Date: ${commit.date}\n`);

          if (commit.tags && commit.tags.length > 0) {
            process.stdout.write('Tags:');
            let seperator = ' ';
            commit.tags.forEach((tag) => {
              process.stdout.write(`${seperator}${tag}`);
              seperator = ', ';
            });
            process.stdout.write('\n');
          }

          if (Object.keys(commit.userData).length > 0) {
            process.stdout.write('User Data:');
            let seperator = ' ';
            // eslint-disable-next-line guard-for-in
            for (const key in commit.userData) {
              if ({}.hasOwnProperty.call(commit.userData, key)) {
                process.stdout.write(`${seperator}${key}=${commit.userData[key]}`);
              }
              seperator = ', ';
            }
            process.stdout.write('\n');
          }
          process.stdout.write(`\n  ${commit.message}\n\n\n`);

          if (opts.verbose) {
            const files = commit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
            files.forEach((value: TreeEntry) => {
              if (value.isDirectory()) {
                process.stdout.write(`      [${value.hash}] ${value.path}\n`);
              } else if (value instanceof TreeFile) {
                process.stdout.write(`      [${value.hash}] ${value.path} (${value.size}B)\n`);
              }
            });
            if (files.size > 0) {
              process.stdout.write('\n');
            }
          }
        }
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program
  .command('driveinfo')
  .option('--output [format=json-pretty]', "currently supported output formats 'json', 'json-pretty'")
  .description('List all connected drives in your computer, in all major operating systems')
  .action(async (opts: any) => {
    const drives = await drivelist.list();
    console.log(JSON.stringify(drives, null, opts.output === 'json' ? '' : '    '));
  });

const switchDesc = `switch a commit, or create a branch
  
  ${chalk.bold('Examples')}
  
      switch to a branch
        $ snow switch branch-name`;

program
  .command('switch [branch-name]')
  .option('--discard-changes', 'force switch and discard changes in workdir')
  .option('-k, --keep-changes', "don't reset files in the workdir")
  .option('-d, --detach', 'detach the branch')
  .option('--debug', 'add more debug information on errors')
  .option('--no-color')
  .option('--user-data', 'open standard input to apply user data for commit')
  .option('--input <type>', "type can be 'stdin' or {filepath}")
  .description('switch a commit')
  .action(async (branchName: string | undefined, opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      opts = await parseOptions(opts);
      const repo = await Repository.open(normalize(process.cwd()));

      if (branchName) {
        const targetCommit = repo.findCommitByReferenceName(REFERENCE_TYPE.BRANCH, branchName);
        if (!targetCommit) {
          if (repo.findCommitByHash(branchName)) {
            throw new Error(`target ${branchName} seems to be a commit and must be checked out via 'snow checkout'`);
          }
          throw new Error(`cannot find branch '${branchName}'`);
        }

        if (opts.discardChanges && opts.keepChanges) {
          throw new Error('either --discard-changes or --keep-changes can be used, not both');
        } else if (!opts.discardChanges && !opts.keepChanges) {
          const statusFiles: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_UNTRACKED | FILTER.INCLUDE_MODIFIED);
          let criticalChanges = 0;

          for (const statusFile of statusFiles) {
            // new or modified files will abort the checkout to prevent data loss
            if (statusFile.isModified()) {
              process.stdout.write(`M ${statusFile.path}\n`);
              criticalChanges++;
            } else if (statusFile.isNew()) {
              process.stdout.write(`A ${statusFile.path}\n`);
              criticalChanges++;
            }
            // 'Ignored' or 'Deleted' files can also be ignored, since they could be restored
          }
          if (criticalChanges > 0) {
            throw new Error(`You have local changes to '${branchName}'; not switching branches.`);
          }
        }

        let reset: RESET = RESET.NONE;
        if (!opts.keepChanges) {
          reset |= RESET.RESTORE_MODIFIED_ITEMS | RESET.DELETE_NEW_ITEMS | RESET.RESTORE_DELETED_ITEMS;
        }
        if (opts.detach) {
          reset |= RESET.DETACH;
        }

        await repo.checkout(branchName, reset);
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        if (error instanceof AggregateError) {
          process.stderr.write(`fatal: ${error.errors.map((e) => e.message).join('\n')}`);
        } else {
          process.stderr.write(`fatal: ${error.message}\n`);
        }
        process.exit(-1);
      }
    }
  });

program.parse(process.argv.filter((x) => x !== '--'));
