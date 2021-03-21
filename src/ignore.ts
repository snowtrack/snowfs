import * as fse from 'fs-extra';

const nm = require('nanomatch');

export class IgnoreManager {
    patterns: string[];

    async init(filepath: string) {
      this.patterns = ['**'];

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
              this.patterns.push(line.substring(1, line.length - 2));
            } else {
              this.patterns.push(`!${line}`);
            }
          }
        }
      });
    }

    filter(filepaths: string[]): string[] {
      return nm(filepaths, this.patterns);
    }

    contains(filepath: string): boolean {
      return nm.contains(filepath, this.patterns);
    }
}
