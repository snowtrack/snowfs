import * as fse from 'fs-extra';

import nm = require('micromatch');

export class IgnoreManager {
    patterns: string[];

    constructor() {
      this.patterns = [
        '**/.DS_Store',
        '**/thumbs.db',
        '**/._.*',
        '**/.git', // for .git worktree file
        '**/.git/**',
        '**/.snowignore',
        '**/backup/**',
        '**/*.bkp',
        '**/**/bkp/**',
        '**/Backup_of*', // Auto backup by Corel Draw
        '**/*_bak[0-9]*.[A-Za-z0-9]+',
        '**/**/*.tmp',
        '**/tmp/**',
        '**/temp/**',
        '**/cache/**',
        '**/*.lnk',
        '**/.idea/**',
        '**/.Spotlight-V100',

        '**/*.blend[0-9]+', // Blender auto-saved files
      ];
    }

    loadFile(filepath: string): Promise<void> {
      return fse.readFile(filepath).then((value: Buffer) => {
        const lines: string[] = value.toString().split('\n');
        for (let line of lines) {
          line = line.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''); // remove /* comment */ or // comment
          if (line.length > 0) {
            this.patterns.push(line);

            if (!line.endsWith('/')) { // could be a file or directory
              this.patterns.push(`${line}/**`);
            }
          }
        }
      });
    }

    ignoredList(filepaths: string[]): Set<string> {
      const ignored = nm(filepaths, this.patterns, {
        dot: true, // Match dotfiles
        nocase: true, // a case-insensitive regex for matching files
      });
      return new Set(ignored as string[]);
    }
}
