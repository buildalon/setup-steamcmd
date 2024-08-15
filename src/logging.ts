import core = require('@actions/core');
import fs = require('fs');

const excludedPaths = ['steambootstrapper', 'appcache', 'steamapps'];

async function PrintLogs(directory: string, clear = false): Promise<void> {
    core.info(directory);
    try {
        const files = await fs.promises.readdir(directory, { recursive: true });
        for (const file of files) {
            try {
                const fullPath = `${directory}/${file}`;
                const stat = await fs.promises.stat(fullPath);
                if (!stat.isFile()) { continue; }
                if (!/\.(log|txt|vdf)$/.test(file)) { continue }
                if (excludedPaths.some(excluded => fullPath.includes(excluded))) { continue; }
                const logContent = await fs.promises.readFile(fullPath, 'utf8');
                core.startGroup(file);
                core.info(logContent);
                core.endGroup();
                if (clear && fullPath.includes('logs')) {
                    await fs.promises.unlink(fullPath);
                }
            } catch (error) {
                core.error(`Failed to read log: ${file}\n${error.message}`);
            }
        }
    } catch (error) {
        core.error(`Failed to read logs in ${directory}!\n${error.message}`);
    }
}

export { PrintLogs }
