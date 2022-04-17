import * as fse from 'fs-extra';

const mm = require('micromatch');

const DEFAULT_IGNORE_PATTERNS = [
  'thumbs.db',
  '*.bkp',
  'bkp/**',
  '*_bak[0-9]*.[A-Za-z0-9]+',
  '*.tmp',
  'tmp/**',
  'temp/**',
  'cache/**',
  '*.lnk',
  '[Dd]esktop.ini',

  'Backup_of*', // Auto backup by Corel Draw
  'Adobe Premiere Pro Auto-Save/**', // Adobe Premiere
  'Adobe After Effects Auto-Save/**', // Adobe After Effects
  'tmpAEtoAMEProject-*.aep', // Adobe After Effects <--> Media Encoder
  'RECOVER_*', // Adobe Animate
  'temp.noindex/**', // Adobe Character Animator
  '~*', // Adobe InDesign lock files start with ~ and end with 'idlk'
  '*.blend+([0-9])', // Blender auto-saved files
  '*.bak*([0-9])', // Cinema 4D Backup files
  'backup/**', // Cinema 4D auto-saved
  '*.3dm.rhl', // Rhino tmp files
  '*.3dmbak', // Rhino backup files
];
export class IgnoreManager {
  patterns: string[] = [];

  async init(filepath: string | null): Promise<void> {
    const patterns: string[] = [];

    if (filepath) {
      const content: Buffer = await fse.readFile(filepath);

      for (let line of content.toString().split('\n')) {
        line = line.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*|#.*/g, ''); // remove # comment */ or // comment #
        if (line.length > 0) {
          patterns.push(line);
        }
      }
    }

    this.loadPatterns(patterns);
  }

  loadPatterns(patterns: string[]): void {
    this.patterns = this.patterns.concat(DEFAULT_IGNORE_PATTERNS);

    for (let item of patterns) {
      const negate = item.startsWith('!');
      if (negate) {
        item = item.slice(1);
      }

      if (item.endsWith('/**')) {
        item = item.slice(0, -3);
      } else if (item.endsWith('/*')) {
        item = item.slice(0, -2);
      } else if (item.endsWith('/')) {
        item = item.slice(0, -1);
      }

      // Only match items that are based in root.
      let startInRoot = false;
      if (item.startsWith('/')) {
        item = item.slice(1);
        startInRoot = true;
      }

      this.patterns.push(`${negate ? '!' : ''}${startInRoot ? '' : '?(**/)'}${item}?(/**)`);
    }
  }

  getIgnoreItemsArray(filepaths: string[]): string[] {
    const options = {
      // Doc: Match dotfiles. Otherwise dotfiles are ignored unless a . is explicitly defined in the pattern.
      // We disable dots as it reduces the amount of default patterns to improve performance.
      // This is a candidate to be configurable through .snow/config
      dot: false,

      // Doc: Perform case-insensitive matching. Equivalent to the regex i flag. Note that this option is ignored when the flags option is defined.
      nocase: false,

      // Doc: Convert all slashes in file paths to forward slashes. This does not convert slashes in the glob pattern itself
      posixSlashes: true,

      // Doc: Support for matching with extglobs (like +(a|b))
      // https://github.com/micromatch/micromatch#extglobs
      noextglob: false,

      // Doc: Disable brace matching, so that {a,b} and {1..3} would be treated as literal characters.
      // https://github.com/micromatch/micromatch#braces-1
      // Instead use [1-3]
      nobrace: true,

      // Doc: Disable regex positive and negative lookbehinds. Note that you must be using Node 8.1.10 or higher to enable regex lookbehinds.
      lookbehinds: false,

      // Doc: POSIX character classes ("posix brackets").
      // https://github.com/micromatch/micromatch#posix-bracket-expressions
      posix: false,
    };

    const ignored = mm(filepaths, this.patterns, options);
    return ignored;
  }

  getIgnoreItems(filepaths: string[]): Set<string> {
    return new Set(this.getIgnoreItemsArray(filepaths));
  }
}
