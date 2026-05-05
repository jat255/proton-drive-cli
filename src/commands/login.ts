import { Command } from 'commander';
import inquirer from 'inquirer';
import { authenticate } from '../auth/protonAuth';
import { saveSession, defaultConfigPath } from '../config/config';

export const loginCommand = new Command('login')
    .description('Log in to your Proton account')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .action(async (options) => {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'email',
                message: 'Proton email:',
                validate: (v: string) => v.includes('@') || 'Enter a valid email',
            },
            {
                type: 'password',
                name: 'password',
                message: 'Password:',
                mask: '*',
            },
        ]);

        console.log('Authenticating...');

        try {
            const session = await authenticate(answers.email, answers.password);
            saveSession(session, options.config);
            console.log(`Logged in as ${session.addresses[0]?.email ?? 'unknown'}`);
        } catch (error) {
            console.error('Login failed:', (error as Error).message);
            process.exit(1);
        }
    });
