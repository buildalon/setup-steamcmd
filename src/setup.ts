import tc = require('@actions/tool-cache');
import cache = require('@actions/cache');
import core = require('@actions/core');
import exec = require('@actions/exec');
import path = require('path');
import fs = require('fs');
import os = require('os');

const steamcmd = 'steamcmd';
const STEAM_CMD = 'STEAM_CMD';
const STEAM_DIR = 'STEAM_DIR';
const STEAM_TEMP = 'STEAM_TEMP';
const IS_LINUX = process.platform === 'linux';
const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';
const toolExtension = IS_WINDOWS ? '.exe' : '.sh';
const toolPath = `${steamcmd}${toolExtension}`;

export async function Run(): Promise<void> {
    const [toolDirectory, steam_dir] = await findOrDownload();
    core.info(`${STEAM_CMD} -> ${toolDirectory}`);
    core.addPath(toolDirectory);
    const steam_cmd = path.join(toolDirectory, steamcmd, '..');
    core.exportVariable(STEAM_CMD, steam_cmd);
    core.saveState('STEAM_CMD', steam_cmd);
    core.info(`${STEAM_DIR} -> ${steam_dir}`);
    core.exportVariable(STEAM_DIR, steam_dir);
    core.saveState('STEAM_DIR', steam_dir);
    const steam_temp = path.join(process.env.RUNNER_TEMP, '.steamworks');
    try {
        await fs.promises.access(steam_temp, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        await fs.promises.mkdir(steam_temp);
    }
    core.info(`${STEAM_TEMP} -> ${steam_temp}`);
    core.exportVariable(STEAM_TEMP, steam_temp);
    core.saveState('STEAM_TEMP', steam_temp);
    await exec.exec(steamcmd, ['+help', '+quit'], { ignoreReturnCode: true });
    await restoreConfigCache(steam_dir);
}

async function findOrDownload(): Promise<[string, string]> {
    const allVersions = tc.findAllVersions(steamcmd);
    core.debug(`Found versions: ${allVersions}`);
    let toolDirectory = undefined;
    if (allVersions && allVersions.length > 0) {
        const latest = allVersions.sort().pop();
        toolDirectory = tc.find(steamcmd, latest);
    }
    let tool = undefined;
    if (!toolDirectory) {
        const [url, archiveName] = getDownloadUrl();
        const archiveDownloadPath = path.join(getTempDirectory(), archiveName);
        core.debug(`Attempting to download ${steamcmd} from ${url} to ${archiveDownloadPath}`);
        const archivePath = await tc.downloadTool(url, archiveDownloadPath);
        core.debug(`Successfully downloaded ${steamcmd} to ${archivePath}`);
        core.debug(`Extracting ${steamcmd} from ${archivePath}`);
        let downloadDirectory = path.join(getTempDirectory(), steamcmd);
        if (IS_WINDOWS) {
            downloadDirectory = await tc.extractZip(archivePath, downloadDirectory);
        } else {
            downloadDirectory = await tc.extractTar(archivePath, downloadDirectory);
        }
        if (!downloadDirectory) {
            throw new Error(`Failed to extract ${steamcmd} from ${archivePath}`);
        }
        if (IS_LINUX || IS_MAC) {
            await exec.exec(`chmod +x ${downloadDirectory}`);
        }
        core.debug(`Successfully extracted ${steamcmd} to ${downloadDirectory}`);
        tool = path.join(downloadDirectory, toolPath);
        const downloadVersion = await getVersion(tool);
        core.debug(`Setting tool cache: ${downloadDirectory} | ${steamcmd} | ${downloadVersion}`);
        toolDirectory = await tc.cacheDir(downloadDirectory, steamcmd, downloadVersion);
    } else {
        tool = path.join(toolDirectory, toolPath);
    }
    if (IS_LINUX) {
        const exe = path.join(toolDirectory, steamcmd);
        core.debug(`Creating ${exe} to point to ${tool}`);
        try {
            await fs.promises.access(exe);
            await fs.promises.unlink(exe);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        await fs.promises.writeFile(exe, `#!/bin/bash\nexec "${tool}" "$@"`);
        await fs.promises.chmod(exe, 0o777);
        await fs.promises.access(exe, fs.constants.X_OK);
    }
    await fs.promises.access(tool, fs.constants.X_OK);
    core.debug(`Found ${tool} in ${toolDirectory}`);
    const steamDir = await getSteamDir(toolDirectory);
    return [toolDirectory, steamDir];
}

function getDownloadUrl(): [string, string] {
    let archiveName = undefined;
    switch (process.platform) {
        case 'linux':
            archiveName = 'steamcmd_linux.tar.gz';
            break;
        case 'darwin':
            archiveName = 'steamcmd_osx.tar.gz';
            break;
        case 'win32':
            archiveName = 'steamcmd.zip';
            break;
        default:
            throw new Error('Unsupported platform');
    }
    return [`https://steamcdn-a.akamaihd.net/client/installer/${archiveName}`, archiveName];
}

function getTempDirectory(): string {
    const tempDirectory = process.env['RUNNER_TEMP'] || ''
    return tempDirectory
}

async function getVersion(tool: string): Promise<string> {
    let output = '';
    await exec.exec(tool, [`+quit`], {
        listeners: {
            stdout: (data) => {
                output += data.toString();
            }
        },
        ignoreReturnCode: IS_WINDOWS,
        silent: !core.isDebug()
    });
    const match = output.match(/Steam Console Client \(c\) Valve Corporation - version (?<version>\d+)/);
    if (!match) {
        throw new Error('Failed to get version');
    }
    const version = `${match.groups.version}.0.0`;
    if (!version) {
        throw new Error('Failed to parse version');
    }
    core.debug(`Found version: ${version}`);
    return version
}

async function getSteamDir(toolDirectory: string): Promise<string> {
    let steamDir = undefined;
    const homeDir = os.homedir();
    switch (process.platform) {
        case 'linux':
            steamDir = `${homeDir}/Steam`;
            break;
        case 'darwin':
            steamDir = `${homeDir}/Library/Application Support/Steam`;
            break;
        default:
            steamDir = toolDirectory;
            break;
    }
    try {
        await fs.promises.access(steamDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        if (error.code === 'ENOENT') {
            core.debug(`Creating steam directory: ${steamDir}`);
            await fs.promises.mkdir(steamDir);
        } else {
            throw error;
        }
    }
    core.debug(`Steam directory: ${steamDir}`);
    return steamDir;
}

async function restoreConfigCache(steamDir: string): Promise<void> {
    try {
        const configVdfPath = path.join(steamDir, 'config', 'config.vdf');
        const cacheKey = await cache.restoreCache([configVdfPath], `steamcmd-config-${process.platform}-${process.arch}`, [
            `steamcmd-config-${process.platform}`,
            `steamcmd-config`
        ]);
        if (cacheKey) {
            core.info(`Restored cache: ${cacheKey}`);
            core.saveState('steamcmd-config-cacheKey', cacheKey);
        } else {
            core.info(`No cache found for ${configVdfPath}`);
        }
    } catch (error) {
        core.error(`Failed to restore cache: ${error.message}`);
    }
}

export async function SaveConfigCache(): Promise<void> {
    if (!process.env.STEAM_DIR) {
        core.warning('STEAM_DIR is not set, skipping cache save');
        return;
    }
    let cacheKey = core.getState('steamcmd-config-cacheKey');
    if (cacheKey) {
        core.info(`cache for "${cacheKey}" already exists, skipping cache save`);
        return;
    }
    try {
        const configVdfPath = path.join(process.env.STEAM_DIR, 'config', 'config.vdf');
        try {
            await fs.promises.access(configVdfPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (error) {
            core.warning(`Cache path ${configVdfPath} does not exist, skipping cache save`);
            return;
        }
        const cacheId = await cache.saveCache([configVdfPath], `steamcmd-config-${process.platform}-${process.arch}`);
        if (cacheId) {
            core.info(`Saved cacheId: ${cacheId}`);
        } else {
            core.info(`No cache saved for ${configVdfPath}`);
        }
    } catch (error) {
        core.error(`Failed to save cache: ${error.message}`);
    }
}