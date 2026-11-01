import tc = require('@actions/tool-cache');
import core = require('@actions/core');
import exec = require('@actions/exec');
import path = require('path');
import fs = require('fs');
import os = require('os');
import crypto = require('crypto');

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
    const [toolDirectory, steam_dir, version] = await findOrDownload();
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
    core.setOutput('path', path.join(toolDirectory, IS_LINUX ? steamcmd : toolPath));
    core.setOutput('version', version);
    await exec.exec(steamcmd, ['+help', '+quit'], { ignoreReturnCode: true });
}

async function findOrDownload(): Promise<[string, string, string]> {
    const allVersions = tc.findAllVersions(steamcmd);
    core.debug(`Found versions: ${allVersions}`);
    let toolDirectory = undefined;
    if (allVersions && allVersions.length > 0) {
        // '*' resolves to the highest cached semver
        toolDirectory = tc.find(steamcmd, '*');
    }
    let tool = undefined;
    if (!toolDirectory) {
        const [url, archiveName] = getDownloadUrl();
        const tempDirectory = path.join(getTempDirectory(), `${steamcmd}-${crypto.randomUUID()}`);
        const archiveDownloadPath = path.join(tempDirectory, archiveName);
        core.debug(`Attempting to download ${steamcmd} from ${url} to ${archiveDownloadPath}`);
        const archivePath = await tc.downloadTool(url, archiveDownloadPath);
        core.debug(`Successfully downloaded ${steamcmd} to ${archivePath}`);
        core.debug(`Extracting ${steamcmd} from ${archivePath}`);
        let downloadDirectory = path.join(tempDirectory, steamcmd);
        if (IS_WINDOWS) {
            downloadDirectory = await tc.extractZip(archivePath, downloadDirectory);
        } else {
            downloadDirectory = await tc.extractTar(archivePath, downloadDirectory);
        }
        if (!downloadDirectory) {
            throw new Error(`Failed to extract ${steamcmd} from ${archivePath}`);
        }
        core.debug(`Successfully extracted ${steamcmd} to ${downloadDirectory}`);
        tool = path.join(downloadDirectory, toolPath);
        if (IS_LINUX || IS_MAC) {
            await fs.promises.chmod(tool, 0o755);
        }
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
    // steamcmd self-updates on first launch, after which steamcmd.sh
    // re-execs "${STEAMROOT}/linux/steamcmd" -- but the binary stays under
    // "linux32/". Mirror linux32 -> linux next to steamcmd.sh so the
    // re-exec resolves instead of failing with "Couldn't find steamcmd at
    // .../linux/steamcmd".
    const steamRoot = path.dirname(tool);
    const linux32Dir = path.join(steamRoot, 'linux32');
    const linuxDir = path.join(steamRoot, 'linux');
    try {
        await fs.promises.access(linux32Dir);
        try {
            await fs.promises.access(linuxDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.promises.symlink(linux32Dir, linuxDir, 'dir');
                core.debug(`Linked ${linuxDir} -> ${linux32Dir}`);
            } else {
                throw error;
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    await fs.promises.access(tool, fs.constants.X_OK);
    core.debug(`Found ${tool} in ${toolDirectory}`);
    const steamDir = await getSteamDir(toolDirectory);
    // query the executable: steamcmd self-updates in place, so the cache
    // directory name can lag behind the installed client version
    const version = await getVersion(tool);
    return [toolDirectory, steamDir, version];
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
    await exec.exec(`"${tool}"`, [`+quit`], {
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
