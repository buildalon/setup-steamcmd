import core = require('@actions/core');
import logging = require('./logging');
import setup = require('./setup');
import { SaveConfigCache } from './setup';

const IsPost = !!core.getState('isPost');

const main = async () => {
    if (!IsPost) {
        core.saveState('isPost', 'true');
        core.info('Setup steamcmd...');
        try {
            await setup.Run();
        } catch (error) {
            core.setFailed(error);
        }
    } else {
        await SaveConfigCache();
        core.info('steamcmd logs:');
        const steam_temp = core.getState('STEAM_TEMP');
        if (!steam_temp) {
            core.error('STEAM_TEMP is not set, skipping logs');
        } else {
            await logging.PrintLogs(steam_temp);
        }
        if (process.platform === 'win32') {
            const steamCmd = core.getState('STEAM_CMD');
            if (!steamCmd) {
                core.error('STEAM_CMD is not set, skipping logs');
            } else {
                await logging.PrintLogs(steamCmd, true);
            }
        } else {
            const steamDir = core.getState('STEAM_DIR');
            if (!steamDir) {
                core.error('STEAM_DIR is not set, skipping logs');
            } else {
                await logging.PrintLogs(steamDir);
            }
        }
    }
}

main();
