import * as fse from 'fs-extra';

import { basename, dirname, join } from './path';

const parser = require('gitignore-parser');

const DEFAULT_IGNORE_PATTERN = [
  '.DS_Store',
  'thumbs.db',
  '._.*',
  '.git', // for .git worktree file
  '.git/**',
  '.snow', // for .git worktree file
  '.snow/**',
  '.snowignore',
  '*.bkp',
  'bkp/**',
  '*_bak[0-9]*.[A-Za-z0-9]+',
  '*.tmp',
  'tmp/**',
  'temp/**',
  'cache/**',
  '*.lnk',
  'desktop.ini',
  '.idea/**',
  '.Spotlight-V100',

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
  '.autosave/**', // autosave for Substance
  '*.3dm.rhl', // Rhino tmp files
  '*.3dmbak', // Rhino backup files
];

export class IgnoreManager {
  ign: any = { denies: () => false };

  async loadIgnore(gitignore: string): Promise<void> {
    const file = await fse.readFile(gitignore, 'utf8');

    const lines: string[] = file.toString().split('\n');
    let ignoreItems = '';
    for (let line of lines) {
      line = line.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*|#.*/g, ''); // remove # comment */ or // comment #
      if (line.length > 0) {
        ignoreItems += `${line}\n`;
      }
    }

    this.ign = parser.compile(ignoreItems);
  }

  filter(filepath: string[]): Set<string> {
    return new Set(filepath.filter(this.ign.denies));
  }
}
