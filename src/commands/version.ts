import { Command } from 'commander';
import { VERSION } from '@protontech/drive-sdk';
import pkg from '../../package.json';

export const versionCommand = new Command('version')
    .description('Show version information')
    .action(() => {
        console.log(`proton-drive-cli: ${pkg.version}`);
        console.log(`@protontech/drive-sdk: ${VERSION}`);
    });
