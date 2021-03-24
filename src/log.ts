import * as fse from 'fs-extra';
import { join } from './path';
import { Repository } from './repository';

/**
 * Return the timezone offset in the UTC designator Z notation.
 * @param date      Instance of `Date`
 * @returns         E.g. -0500
 */
function getZOffset(date: Date) {
  function fill(value: number) {
    return value < 10 ? `0${value}` : value;
  }
  const offset = Math.abs(date.getTimezoneOffset());
  const hours = fill(Math.floor(offset / 60));
  const minutes = fill(offset % 60);
  const sign = (date.getTimezoneOffset() > 0) ? '-' : '+';
  return `${sign + hours}${minutes}`;
}

/**
 * The log helper class of a Repository
 */
export class Log {
  // eslint-disable-next-line no-useless-constructor,no-empty-function
  constructor(private repo: Repository) { }

  getAbsLogDirPath(): string {
    return join(this.repo.commondir(), 'logs');
  }

  async init() {
    return fse.ensureDir(this.getAbsLogDirPath());
  }

  /**
   * Writes a log message to .snow/logs/mainlog. The message is recommended to be a one-liner.
   * @param message:          One-line message, e.g.  "commit: foo"
   */
  async writeLog(message: string) {
    const now = new Date();
    const logMessage = `${now.getTime()} ${getZOffset(now)} $> ${message}\n`;
    return fse.appendFile(join(this.getAbsLogDirPath(), 'mainlog'), logMessage)
      .catch(() => { /* do nothing, logs are second-class citizens here */ });
  }
}
