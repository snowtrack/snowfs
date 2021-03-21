import * as fse from 'fs-extra';

const nm = require('micromatch');

export class IgnoreManager {
    patterns: string[];

    constructor() {
      this.patterns = ['**', '!.DS_Store', '!thumbs.db', '!._.*'];
    }

    async init(filepath: string) {
      return fse.readFile(filepath).then((value: Buffer) => {
        const lines: string[] = value.toString().split('\n');
        for (let line of lines) {
          line = line.trim();
          if (line.length > 0 && !line.startsWith('//')) {
            line = line.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''); // remove /* comment */ or // comment

            // Invert ! here.
            // nanomatch includes every elements, means no ! in snowignore will ignore the file,
            // whereas ! means to actually include it
            if (line.startsWith('!')) {
              line = line.substr(1, line.length - 1);
              this.patterns.push(line);
              if (!line.endsWith('/')) { // could be a file or directory
                this.patterns.push(`${line}/**`);
              }
            } else {
              this.patterns.push(`!${line}`);
              if (!line.endsWith('/')) { // could be a file or directory
                this.patterns.push(`!${line}/**`);
              }
            }
          }
        }
      });
    }

    filter(filepaths: string[]): string[] {
      return nm(filepaths, this.patterns, { dot: true });
    }

    contains(filepath: string): boolean {
      return nm.contains(filepath, this.patterns, { dot: true });
    }
}
