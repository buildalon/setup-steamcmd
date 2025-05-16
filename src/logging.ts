import core = require('@actions/core');
import fs = require('fs');

export async function PrintLogs(directory: string, clear = false): Promise<void> {
    core.info(directory);
    try {
        const paths = await fs.promises.readdir(directory, { recursive: true });
        const excludedPaths = [
            'steambootstrapper',
            'appcache',
            'steamapps',
            'Steam.AppBundle',
            'siteserverui',
            'htmlcache'
        ];
        for (const path of paths) {
            try {
                const fullPath = `${directory}/${path}`;
                if (excludedPaths.some(excluded => fullPath.includes(excluded))) { continue; }
                let stat: fs.Stats;
                try {
                    stat = await fs.promises.stat(fullPath);
                } catch (error) {
                    continue;
                }
                if (!stat.isFile()) {
                    continue;
                }
                if (!/\.(log|txt|vdf)$/.test(path)) {
                    continue
                }
                const logContent = await fs.promises.readFile(fullPath, 'utf8');
                core.startGroup(fullPath);
                core.info(logContent);
                core.endGroup();
                if (clear && fullPath.includes('/logs')) {
                    await fs.promises.unlink(fullPath);
                }
            } catch (error) {
                core.error(`Failed to read log: ${path}\n${error.message}`);
            }
        }
    } catch (error) {
        core.error(`Failed to read logs in ${directory}!\n${error.message}`);
    }
}
