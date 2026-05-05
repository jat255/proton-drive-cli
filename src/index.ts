#!/usr/bin/env node

import { Command } from 'commander';
import { uploadCommand } from './commands/upload';
import { listCommand } from './commands/list';
import { loginCommand } from './commands/login';
import { versionCommand } from './commands/version';
import { downloadCommand } from './commands/download';
import { rmCommand } from './commands/rm';
import { mkdirCommand } from './commands/mkdir';
import { mvCommand } from './commands/mv';

async function main() {
    const program = new Command();

    program
        .name('proton-drive')
        .description('CLI tool for Proton Drive')
        .version('1.0.0', '-v, --version', 'Output the version number');

    program.addCommand(loginCommand);
    program.addCommand(listCommand);
    program.addCommand(uploadCommand);
    program.addCommand(downloadCommand);
    program.addCommand(rmCommand);
    program.addCommand(mkdirCommand);
    program.addCommand(mvCommand);
    program.addCommand(versionCommand);

    await program.parseAsync(process.argv);
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
