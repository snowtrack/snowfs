import * as fse from 'fs-extra';

export class IgnoreManager {
    ignores: RegExp[];

    includes: RegExp[];

    async init(filepath: string) {
      this.ignores = [];
      this.includes = [];

      return fse.readFile(filepath).then((value: Buffer) => {
        const lines: string[] = value.toString().split('\n');
        for (let line of lines) {
          line = line.trim();
          if (line.length > 0 && !line.startsWith('//')) {
            line = line.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
            if (line.startsWith('!')) {
              this.includes.push(new RegExp(line.substr(1, line.length - 1).replace(/\*/, '[\\w\/]*')));
            } else {
              this.ignores.push(new RegExp(line.replace(/\*/, '[\\w/]*')));
            }
          }
        }
      });
    }

    ignored(filepath: string): boolean {
      for (const ignore of this.ignores) {
        if (ignore.exec(filepath)) {
          let keep: boolean = false;
          for (const include of this.includes) {
            if (include.exec(filepath)) {
              keep = true;
              break;
            }
          }
          if (keep) {
            continue;
          } else {
            return true;
          }
        }
      }
      return false;
    }
}
