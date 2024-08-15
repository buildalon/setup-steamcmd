import tc = require('@actions/tool-cache');
import core = require('@actions/core');
import exec = require('@actions/exec');
import path = require('path');
import fs = require('fs');

const steamcmd = 'steamcmd';
const STEAM_CMD = 'STEAM_CMD';
const STEAM_DIR = 'STEAM_DIR';
const STEAM_TEMP = 'STEAM_TEMP';
const IS_LINUX = process.platform === 'linux';
const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';
const toolExtension = IS_WINDOWS ? '.exe' : '.sh';
const toolPath = `${steamcmd}${toolExtension}`;

async function Run(): Promise<void> {
    const [toolDirectory, steamDir] = await findOrDownload();
    core.debug(`${STEAM_CMD} -> ${toolDirectory}`);
    core.addPath(toolDirectory);
    const steam_cmd = path.join(toolDirectory, steamcmd, '..');
    core.exportVariable(STEAM_CMD, steam_cmd);
    core.debug(`${STEAM_DIR} -> ${steamDir}`);
    core.exportVariable(STEAM_DIR, steamDir);
    const steam_temp = path.join(process.env.RUNNER_TEMP, '.steamworks');
    await fs.promises.mkdir(steam_temp);
    core.debug(`${STEAM_TEMP} -> ${steam_temp}`);
    core.exportVariable(STEAM_TEMP, steam_temp);
    await exec.exec(steamcmd, ['+help', '+quit']);
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
        if (IS_LINUX) {
            const exe = path.join(downloadDirectory, steamcmd);
            await fs.promises.writeFile(exe, `#!/bin/bash\nexec "${tool}" "$@"`);
            await fs.promises.chmod(exe, 0o755);
        }
        const downloadVersion = await getVersion(tool);
        core.debug(`Setting tool cache: ${downloadDirectory} | ${steamcmd} | ${downloadVersion}`);
        toolDirectory = await tc.cacheDir(downloadDirectory, steamcmd, downloadVersion);
    } else {
        tool = path.join(toolDirectory, toolPath);
    }
    await fs.promises.access(tool);
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
    switch (process.platform) {
        case 'linux':
            steamDir = '/home/runner/Steam';
            break;
        case 'darwin':
            steamDir = '/Users/runner/Library/Application Support/Steam';
            break;
        default:
            steamDir = toolDirectory;
            break;
    }
    try {
        await fs.promises.access(steamDir);
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

export { Run }
