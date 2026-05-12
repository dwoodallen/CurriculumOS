const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');
const crypto = require('crypto');

const macTexEnv = { ...process.env, PATH: `${process.env.PATH}:/Library/TeX/texbin:/usr/texbin:/usr/local/bin:/opt/homebrew/bin` };

// Force the app to use the existing 'Zenith OS' data folder to prevent data loss
// since we changed the productName to 'CurriculumOS' in package.json.
if (process.platform === 'darwin') {
    const oldDataPath = path.join(app.getPath('appData'), 'zenith-os');
    app.setPath('userData', oldDataPath);
}
app.name = 'CurriculumOS';

// Setup preview directory
const getPreviewDir = () => path.join(app.getPath('userData'), 'Zenith_Temp', 'Previews');

protocol.registerSchemesAsPrivileged([
    { scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, allowServiceWorkers: true } }
]);

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            plugins: true,
            webSecurity: false,
            webviewTag: true
        }
    });

    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        let responseHeaders = Object.assign({}, details.responseHeaders);
        delete responseHeaders['X-Frame-Options'];
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['Content-Security-Policy'];
        delete responseHeaders['content-security-policy'];
        callback({ cancel: false, responseHeaders: responseHeaders });
    });

    // Global shortcut listener for Presentation Mode
    // Catch keys before they reach the renderer or any sub-frames
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown') {
            const presentationKeys = [';', '[', 'ArrowRight', 'ArrowLeft', ' ', 'Escape'];
            if (presentationKeys.includes(input.key)) {
                win.webContents.send('presentation-keydown', {
                    key: input.key,
                    shiftKey: input.shiftKey,
                    ctrlKey: input.ctrlKey,
                    metaKey: input.metaKey,
                    altKey: input.altKey
                });
            }
        }
    });

    win.loadFile('index.html');
}

app.whenReady().then(async () => {
    // Clean up previews on startup
    const previewDir = getPreviewDir();
    try {
        await fs.rm(previewDir, { recursive: true, force: true });
        await fs.mkdir(previewDir, { recursive: true });
    } catch (e) {
        console.error('Failed to init preview dir', e);
    }

    protocol.handle('preview', async (request) => {
        try {
            const urlPath = request.url.replace('preview://', '');
            // Properly decode the URL to handle spaces and special characters
            const decodedPath = decodeURIComponent(urlPath);
            const filePath = path.join(getPreviewDir(), decodedPath);

            const buffer = await fs.readFile(filePath);

            // Determine MIME type
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.pdf': 'application/pdf'
            };

            const contentType = mimeTypes[ext] || 'application/octet-stream';

            return new Response(buffer, {
                headers: { 'Content-Type': contentType }
            });
        } catch (e) {
            console.error('Preview protocol error', e);
            return new Response('Not found', { status: 404 });
        }
    });

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:selectDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('dialog:selectFile', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        ...options
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('app:getFilesPath', async () => {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'Zenith_Data', 'Files');
});

ipcMain.handle('app:loadState', async () => {
    try {
        const userDataPath = app.getPath('userData');
        const statePath = path.join(userDataPath, 'Zenith_Data', 'state.json');
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        const data = await fs.readFile(statePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return null; // File doesn't exist yet
    }
});

ipcMain.handle('app:saveState', async (event, state) => {
    try {
        const userDataPath = app.getPath('userData');
        const statePath = path.join(userDataPath, 'Zenith_Data', 'state.json');
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:managedCopy', async (event, sourcePath, targetName = null) => {
    try {
        const userDataPath = app.getPath('userData');
        const filesDir = path.join(userDataPath, 'Zenith_Data', 'Files');
        await fs.mkdir(filesDir, { recursive: true });

        const fileName = targetName || path.basename(sourcePath);
        const destPath = path.join(filesDir, fileName);

        await fs.copyFile(sourcePath, destPath);
        return { success: true, fileName: fileName };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('archive:export', async (event, destinationPath) => {
    try {
        const userDataPath = app.getPath('userData');
        const sourceDir = path.join(userDataPath, 'Zenith_Data');

        // Use native zip command on macOS to avoid dependencies
        const command = `cd "${sourceDir}" && zip -r "${destinationPath}" .`;
        return new Promise((resolve) => {
            exec(command, (error) => {
                if (error) resolve({ success: false, error: error.message });
                else resolve({ success: true });
            });
        });
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('archive:import', async (event, zipPath) => {
    try {
        const userDataPath = app.getPath('userData');
        const targetDir = path.join(userDataPath, 'Zenith_Data');

        // Destructive overwrite for safety and simplicity
        await fs.rm(targetDir, { recursive: true, force: true });
        await fs.mkdir(targetDir, { recursive: true });

        const command = `unzip -o "${zipPath}" -d "${targetDir}"`;
        return new Promise((resolve) => {
            exec(command, (error) => {
                if (error) resolve({ success: false, error: error.message });
                else resolve({ success: true });
            });
        });
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:saveFile', async (event, filePath, content) => {
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content || '', 'utf8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

async function performLatexCompilation(id, content, supportingFiles, customDir = null) {
    const userDataPath = app.getPath('userData');
    const dir = customDir || path.join(userDataPath, 'Zenith_Temp', id);

    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    const downloadErrors = [];
    try {
        // Copy supporting files (attachments) to the temp directory
        for (const filePath of supportingFiles) {
            if (filePath) {
                try {
                    const dest = path.join(dir, path.basename(filePath));
                    await fs.copyFile(filePath, dest);
                } catch (e) {
                    console.warn(`Failed to copy supporting file: ${filePath}`, e);
                }
            }
        }

        // --- NEW: Detect and Automatic Download Remote Images ---
        let processedContent = content || '';
        const urlRegex = /\\includegraphics\s*(?:\[.*?\])?\s*\{\s*(https?:\/\/[^\s}]+)\s*\}/g;
        let match;
        const downloads = new Map(); // URL -> localFilename

        // Collect all unique URLs
        while ((match = urlRegex.exec(processedContent)) !== null) {
            const url = match[1];
            if (!downloads.has(url)) {
                // Create a safe, unique filename based on the URL
                const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
                const originalPath = url.split('?')[0];
                const originalExt = path.extname(originalPath) || '.png';
                const safeName = `web_img_${hash}${originalExt}`;
                downloads.set(url, safeName);
            }
        }

        // Download all images and replace content
        for (const [url, safeName] of downloads.entries()) {
            try {
                console.log(`[LaTeX] Downloading remote asset: ${url}`);
                const fetchUrl = url.replace(/\\&/g, '&');
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

                const response = await fetch(fetchUrl, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'Referer': 'https://images.squarespace-cdn.com/'
                    }
                });
                clearTimeout(timeoutId);
                
                if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);
                const contentType = response.headers.get('content-type') || '';
                const buffer = Buffer.from(await response.arrayBuffer());
                
                let finalSafeName = safeName;
                const tempRawPath = path.join(dir, `raw_${safeName}`);
                await fs.writeFile(tempRawPath, buffer);

                // Check if it's WebP (either via Content-Type or RIFF header)
                const isWebP = contentType.includes('webp') || (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
                
                if (isWebP) {
                    console.log(`[LaTeX] WebP detected for ${url}. Converting to JPEG...`);
                    // Ensure safeName ends with .jpg for LaTeX compatibility
                    finalSafeName = safeName.replace(path.extname(safeName), '.jpg');
                    const finalPath = path.join(dir, finalSafeName);
                    
                    await new Promise((resolve, reject) => {
                        exec(`sips -s format jpeg "${tempRawPath}" --out "${finalPath}"`, (err) => {
                            if (err) reject(new Error(`Conversion failed: ${err.message}`));
                            else resolve();
                        });
                    });
                    
                    // Cleanup raw file
                    await fs.rm(tempRawPath, { force: true });
                } else {
                    // Regular image, just rename from temp raw to safeName
                    await fs.rename(tempRawPath, path.join(dir, safeName));
                }

                console.log(`[LaTeX] Asset processed as ${finalSafeName}`);

                const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const replaceRegex = new RegExp(`\\\\includegraphics\\s*(\\[.*?\\])?\\s*\\{\\s*${escapedUrl}\\s*\\}`, 'g');
                processedContent = processedContent.replace(replaceRegex, `\\includegraphics$1{${finalSafeName}}`);
            } catch (e) {
                console.error(`[LaTeX] Image processing failed: ${url}`, e.message);
                downloadErrors.push(`[Error: Could not process image ${url}: ${e.message}]`);
                
                const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const failRegex = new RegExp(`\\\\includegraphics\\s*(\\[.*?\\])?\\s*\\{\\s*${escapedUrl}\\s*\\}`, 'g');
                processedContent = processedContent.replace(failRegex, `\\textcolor{red}{[Image Load Error: ${path.basename(url).substring(0,20)}...]}`);
            }
        }

        const texPath = path.join(dir, `doc.tex`);
        await fs.writeFile(texPath, processedContent, 'utf8');
        console.log(`[LaTeX] doc.tex written to ${dir}`);

        return new Promise((resolve) => {
            const command = `xelatex -interaction=nonstopmode -output-directory="${dir}" "doc.tex"`;
            console.log(`[LaTeX] Running command: ${command}`);
            exec(command, { env: macTexEnv, cwd: dir }, async (error, stdout, stderr) => {
                let log = stdout + '\n' + stderr;
                console.log(`[LaTeX] Compilation finished. Error: ${!!error}`);
                
                if (downloadErrors.length > 0) {
                    log = "PRE-COMPILATION ERRORS (Assets):\n" + downloadErrors.join('\n') + "\n\n" + log;
                }
                const pdfPath = path.join(dir, `doc.pdf`);

                let pdfExists = false;
                try {
                    const stats = await fs.stat(pdfPath);
                    pdfExists = stats.size > 0; // Ensure PDF is not 0 bytes
                } catch (e) {
                    pdfExists = false;
                }

                if (pdfExists) {
                    resolve({ success: true, log: log, pdfPath: pdfPath });
                } else {
                    resolve({ success: false, log: log, error: error ? error.message : 'No PDF produced (or generation crashed).' });
                }
            });
        });
    } catch (e) {
        return { success: false, error: e.message, log: e.stack };
    }
}

ipcMain.handle('latex:compile', async (event, nodeId, content, supportingFiles = []) => {
    const result = await performLatexCompilation(nodeId, content, supportingFiles);
    if (result.success) {
        // For preview, we still want to timestamp it to bypass cache
        const dir = path.dirname(result.pdfPath);
        const timestampedPdf = path.join(dir, `preview_${Date.now()}.pdf`);
        try {
            await fs.rename(result.pdfPath, timestampedPdf);
            return { ...result, pdfPath: timestampedPdf };
        } catch (e) {
            console.error(`[LaTeX] Failed to rename preview PDF: ${e.message}`);
            return { ...result }; // Fallback to doc.pdf if rename fails
        }
    }
    return result;
});

async function performTypstCompilation(id, content, supportingFiles, customDir = null) {
    const userDataPath = app.getPath('userData');
    const dir = customDir || path.join(userDataPath, 'Zenith_Temp', id);

    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    try {
        for (const filePath of supportingFiles) {
            if (filePath) {
                try {
                    const dest = path.join(dir, path.basename(filePath));
                    await fs.copyFile(filePath, dest);
                } catch (e) {
                    console.warn(`Failed to copy supporting file: ${filePath}`, e);
                }
            }
        }

        const typPath = path.join(dir, `doc.typ`);
        await fs.writeFile(typPath, content || '', 'utf8');
        console.log(`[Typst] doc.typ written to ${dir}`);

        return new Promise((resolve) => {
            const command = `typst compile "doc.typ" "doc.pdf"`;
            console.log(`[Typst] Running command: ${command}`);
            exec(command, { env: macTexEnv, cwd: dir }, async (error, stdout, stderr) => {
                let log = stdout + '\n' + stderr;
                console.log(`[Typst] Compilation finished. Error: ${!!error}`);

                const pdfPath = path.join(dir, `doc.pdf`);
                let pdfExists = false;
                try {
                    const stats = await fs.stat(pdfPath);
                    pdfExists = stats.size > 0;
                } catch (e) {
                    pdfExists = false;
                }

                if (pdfExists) {
                    resolve({ success: true, log: log, pdfPath: pdfPath });
                } else {
                    resolve({ success: false, log: log, error: error ? error.message : 'No PDF produced (or generation crashed).' });
                }
            });
        });
    } catch (e) {
        return { success: false, error: e.message, log: e.stack };
    }
}

ipcMain.handle('typst:compile', async (event, nodeId, content, supportingFiles = []) => {
    const result = await performTypstCompilation(nodeId, content, supportingFiles);
    if (result.success) {
        const dir = path.dirname(result.pdfPath);
        const timestampedPdf = path.join(dir, `preview_${Date.now()}.pdf`);
        try {
            await fs.rename(result.pdfPath, timestampedPdf);
            return { ...result, pdfPath: timestampedPdf };
        } catch (e) {
            console.error(`[Typst] Failed to rename preview PDF: ${e.message}`);
            return { ...result };
        }
    }
    return result;
});


ipcMain.handle('office:generatePreview', async (event, filePath) => {
    try {
        const previewDir = getPreviewDir();
        const id = crypto.randomUUID();
        const targetDir = path.join(previewDir, id);

        await fs.mkdir(targetDir, { recursive: true });

        return new Promise((resolve) => {
            const command = `qlmanage -p -o "${targetDir}" "${filePath}"`;
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('qlmanage error', error);
                    resolve({ success: false, error: error.message });
                    return;
                }

                // qlmanage generates a folder named "[filename].qlpreview"
                // We need to return the ID so the renderer can construct the preview:// URL
                const fileName = path.basename(filePath);
                resolve({ success: true, id: id, folderName: `${fileName}.qlpreview` });
            });
        });
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('latex:check', () => {
    return new Promise((resolve) => {
        exec('which xelatex', { env: macTexEnv }, (error) => {
            if (error) resolve(false);
            else resolve(true);
        });
    });
});

ipcMain.handle('typst:check', () => {
    return new Promise((resolve) => {
        exec('which typst', { env: macTexEnv }, (error) => {
            if (error) resolve(false);
            else resolve(true);
        });
    });
});

ipcMain.handle('course:publish', async (event, courseTitle, payload) => {
    try {
        const userDataPath = app.getPath('userData');
        const safeTitle = courseTitle.replace(/[^a-z0-9\s-]/gi, '').trim();
        const courseDir = path.join(userDataPath, 'Zenith_Library', safeTitle);

        await fs.rm(courseDir, { recursive: true, force: true });
        await fs.mkdir(courseDir, { recursive: true });

        let currentItemPath = '';
        try {
            for (const item of payload) {
                currentItemPath = item.path;
                const fullPath = path.join(courseDir, item.path);
                if (!fullPath.startsWith(courseDir)) continue;

                if (item.type === 'folder') {
                    await fs.mkdir(fullPath, { recursive: true });
                } else if (item.type === 'file') {
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, item.content || '', 'utf8');
                } else if (item.type === 'copyFile') {
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.copyFile(item.sourcePath, fullPath);
                } else if (item.type === 'compileLatex') {
                    const tempDir = path.join(userDataPath, 'Zenith_Temp', 'publish_compile');
                    await fs.rm(tempDir, { recursive: true, force: true });
                    await fs.mkdir(tempDir, { recursive: true });

                    const result = await performLatexCompilation('publish', item.rawLatex || '', item.supportingFiles || [], tempDir);
                    if (result.success) {
                        await fs.mkdir(path.dirname(fullPath), { recursive: true });
                        await fs.copyFile(result.pdfPath, fullPath);
                    } else {
                        throw new Error(`LaTeX Compile Error for ${item.path}: ${result.error}`);
                    }
                } else if (item.type === 'compileTypst') {
                    const tempDir = path.join(userDataPath, 'Zenith_Temp', 'publish_compile_typst');
                    await fs.rm(tempDir, { recursive: true, force: true });
                    await fs.mkdir(tempDir, { recursive: true });

                    const result = await performTypstCompilation('publish', item.rawTypst || '', item.supportingFiles || [], tempDir);
                    if (result.success) {
                        await fs.mkdir(path.dirname(fullPath), { recursive: true });
                        await fs.copyFile(result.pdfPath, fullPath);
                    } else {
                        throw new Error(`Typst Compile Error for ${item.path}: ${result.error}`);
                    }
                }
            }
        } catch (loopError) {
            throw new Error(`Failed at "${currentItemPath}": ${loopError.message}`);
        }

        return { success: true };
    } catch (error) {
        console.error('Course publish error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('course:openFolder', async (event, courseTitle) => {
    try {
        const userDataPath = app.getPath('userData');
        const safeTitle = courseTitle.replace(/[^a-z0-9\s-]/gi, '').trim();
        const courseDir = path.join(userDataPath, 'Zenith_Library', safeTitle);

        await fs.mkdir(courseDir, { recursive: true });
        await shell.openPath(courseDir);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('app:openLibrary', async () => {
    try {
        const userDataPath = app.getPath('userData');
        const libraryDir = path.join(userDataPath, 'Zenith_Library');

        await fs.mkdir(libraryDir, { recursive: true });
        await shell.openPath(libraryDir);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('app:openExternalFile', async (event, filePath) => {
    try {
        await shell.openPath(filePath);
        return { success: true };
    } catch (e) {
        return { success: false };
    }
});