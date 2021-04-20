import * as fse from 'fs-extra';

const nm = require('micromatch');

export class IgnoreManager {
    patterns: string[];

    constructor() {
      this.patterns = ['.DS_Store',
                       'thumbs.db',
                       '._.*',
                       '.snowignore',
                       'backup/*',
                       '*.bkp',
                       'bkp/*',
                       '*_bak[0-9]*.[A-Za-z0-9]+',
                       '*.tmp',
                       'tmp/*',
                       'temp/*',
                       'cache/*',
                       '*.lnk', // *.lnk
                       '*.log', // *.log
                       '.vscode/*', 
                       '.idea/*',
                       '.Spotlight-V100'
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
              this.patterns.push(`${line}/*`);
            }
          }
        }
      });
    }

    ignored(filepath: string): boolean {
      return nm.match(filepath, this.patterns, { dot: true, nocase: true }).length > 0;
    }
}
