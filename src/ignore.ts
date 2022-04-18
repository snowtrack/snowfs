import * as fse from 'fs-extra';

const mm = require('micromatch');

const DEFAULT_IGNORE_PATTERNS = [
  'thumbs.db',
  '*.bkp',
  'bkp/**',
  '*_bak[0-9]*.[A-Za-z0-9]+',
  '*.tmp',
  't?(e)mp/**',
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
  patterns: string[];

  constructor() {
    this.patterns = [
      '**/.DS_Store',
      '**/thumbs.db',
      '**/._.*',
      '**/.git', // for .git worktree file
      '**/.git/**',
      '**/.snowignore',
      '**/*.bkp',
      '**/**/bkp/**',
      '**/*_bak[0-9]*.[A-Za-z0-9]+',
      '**/*.tmp',
      '**/tmp/**',
      '**/temp/**',
      '**/cache/**',
      '**/*.lnk',
      '**/desktop.ini',
      '**/.idea/**',
      '**/.Spotlight-V100',

      '**/Backup_of*', // Auto backup by Corel Draw
      '**/Adobe Premiere Pro Auto-Save/**', // Adobe Premiere
      '**/Adobe After Effects Auto-Save/**', // Adobe After Effects
      '**/tmpAEtoAMEProject-*.aep', // Adobe After Effects <--> Media Encoder
      '**/RECOVER_*', // Adobe Animate
      '**/temp.noindex/**', // Adobe Character Animator
      '**/~*', // Adobe InDesign lock files start with ~ and end with 'idlk'
      '**/*.blend+([0-9])', // Blender auto-saved files
      '**/*.bak*([0-9])', // Cinema 4D Backup files
      '**/backup/**', // Cinema 4D auto-saved
      '**/.autosave/**', // autosave for Substance
      '**/*.3dm.rhl', // Rhino tmp files
      '**/*.3dmbak', // Rhino backup files
    ];
  }

  loadFile(filepath: string): Promise<void> {
    return fse.readFile(filepath).then((value: Buffer) => {
      const lines: string[] = value.toString().split('\n');
      for (let line of lines) {
        line = line.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*|#.*/g, ''); // remove # comment */ or // comment #
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
