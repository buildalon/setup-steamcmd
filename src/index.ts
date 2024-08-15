import core = require('@actions/core');
import logging = require('./logging');
import setup = require('./setup');

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
        core.info('steamcmd logs:');
        await logging.PrintLogs(process.env.STEAM_TEMP);
        if (process.platform === 'win32') {
            await logging.PrintLogs(process.env.STEAM_CMD, true);
        } else {
            await logging.PrintLogs(process.env.STEAM_DIR, true);
        }
    }
}

main();
