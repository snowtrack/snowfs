import * as fse from 'fs-extra';

const nm = require('micromatch');

export class IgnoreManager {
    patterns: string[];

    constructor() {
      this.patterns = ['.DS_Store', 'thumbs.db', '._.*', '.snowignore'];
    }

    async init(filepath: string) {
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

    ignored(filepath: string): boolean {
      return nm.match(filepath, this.patterns, { dot: true }).length > 0;
    }
}
