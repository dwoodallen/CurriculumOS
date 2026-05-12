let latexCompileTimeout = null;
let typstCompileTimeout = null;

/**
 * Resolves a file path.
 * If the path is absolute, it returns it as is (legacy).
 * If the path is relative, it resolves it against the Zenith_Data/Files directory.
 */
function resolvePath(p) {
    if (!p) return p;
    if (p.startsWith('/') || p.includes(':/') || p.startsWith('http') || p.startsWith('data:')) return p;
    return (window.zenithDataFilesPath ? (window.zenithDataFilesPath + '/' + p) : p);
}

async function initStorage() {
    window.zenithDataFilesPath = await window.electronAPI.getFilesPath();
    const saved = await window.electronAPI.loadState();
    if (saved) {
        if (saved.state) state = saved.state;
        if (saved.autoCompileLatex !== undefined) autoCompileLatex = saved.autoCompileLatex;
        return;
    }

    // 2. Migration: Check localStorage
    const local = localStorage.getItem('zenith_os_data');
    if (local) {
        try {
            const data = JSON.parse(local);
            const legacyState = data.state || data; // Handle both wrapped and unwrapped legacy data
            if (legacyState) {
                state = legacyState;
                if (data.autoCompileLatex !== undefined) autoCompileLatex = data.autoCompileLatex;

                showToast("Migrating legacy data...", "info");
                const collectFiles = async (nodes) => {
                    for (let node of nodes) {
                        if (node.fileFullPath && !node.fileFullPath.startsWith('http')) {
                            const res = await window.electronAPI.managedCopy(node.fileFullPath);
                            if (res.success) { node.file = res.fileName; node.fileFullPath = res.fileName; }
                        }
                        if (node.videoFileFullPath && !node.videoFileFullPath.startsWith('http')) {
                            const res = await window.electronAPI.managedCopy(node.videoFileFullPath);
                            if (res.success) { node.videoFile = res.fileName; node.videoFileFullPath = res.fileName; }
                        }
                        if (node.epubFileFullPath && !node.epubFileFullPath.startsWith('http')) {
                            const res = await window.electronAPI.managedCopy(node.epubFileFullPath);
                            if (res.success) { node.epubFile = res.fileName; node.epubFileFullPath = res.fileName; }
                        }
                        if (node.latexFile && !node.latexFile.startsWith('http')) {
                            const res = await window.electronAPI.managedCopy(node.latexFile);
                            if (res.success) { node.latexFile = res.fileName; }
                        }
                        if (node.children) await collectFiles(node.children);
                    }
                };

                for (let cls of state.classes) {
                    if (cls.nodes) await collectFiles(cls.nodes);
                }

                await saveWorkspace();
                showToast("Migration complete", "success");
            }
        } catch (e) {
            console.error("Migration failed", e);
        }
    }
}

let rawPreviewTimeout = null;
let linkPreviewTimeout = null;

function scheduleRawPreview(content) {
    clearTimeout(rawPreviewTimeout);
    rawPreviewTimeout = setTimeout(() => {
        const iframe = document.getElementById('ed-raw-preview');
        const activeClass = getActiveClass();
        const info = findNodeInfo(activeEditingNodeId, activeClass.nodes);
        const title = info ? info.node.title : 'Document';
        
        let focusHtml = '';
        if (info && info.parent && info.parent.objectives) {
            const label = (info.parent.type === 'l1' ? activeClass.labels.l1 : activeClass.labels.l2) || 'Weekly Focus';
            const objectives = info.parent.objectives.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            focusHtml = `
            <div class="focus-box" style="background:#f8fafc; border:1px solid #e2e8f0; padding:24px; margin-bottom:40px; border-radius:12px; font-family:system-ui, -apple-system, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-weight:800; text-transform:uppercase; font-size:0.7rem; color:#64748b; letter-spacing:0.1em; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <span style="font-size: 1.2rem;">🎯</span> ${label} Focus
                </div>
                <div style="color:#1e293b; line-height:1.6; font-size:1rem; font-weight: 500;">${objectives}</div>
            </div>`;
        }

        const safeContent = (content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const htmlStr = `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>${title}</title>\n    <style>\n        body { background:#ffffff; color:#333333; font-family:ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; padding:60px 40px; line-height:1.8; max-width:800px; margin:0 auto; font-size: 1.15rem; }\n        h1 { margin-top: 0; font-family: system-ui, -apple-system, sans-serif; font-size: 2.5rem; color: #111; letter-spacing: -0.03em; border-bottom: 1px solid #eaeaea; padding-bottom: 15px; margin-bottom: 30px; }\n        .content { white-space: pre-wrap; }\n    </style>\n</head>\n<body>\n    ${focusHtml}\n    <h1>${title}</h1>\n    <div class="content">${safeContent}</div>\n</body>\n</html>`;
        iframe.srcdoc = htmlStr;
    }, 500);
}

function scheduleLinkPreview(url) {
    clearTimeout(linkPreviewTimeout);
    linkPreviewTimeout = setTimeout(() => {
        const iframe = document.getElementById('ed-link-preview');
        if (!url) { iframe.removeAttribute('src'); return; }

        // Only embed actual websites
        let finalUrl = url;
        if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
        iframe.src = finalUrl;
    }, 1000);
}

let videoPreviewTimeout = null;
function scheduleVideoPreview() {
    clearTimeout(videoPreviewTimeout);
    videoPreviewTimeout = setTimeout(() => {
        const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
        if (!info) return;
        const node = info.node;
        const yTIframe = document.getElementById('ed-video-yt-preview');
        const vFile = document.getElementById('ed-video-file-preview');
        const fallback = document.getElementById('video-preview-fallback');
        if (node.videoFile) {
            yTIframe.style.display = 'none'; yTIframe.removeAttribute('src');
            fallback.style.display = 'none';
            vFile.style.display = 'block';
            vFile.src = 'file://' + encodeURI(resolvePath(node.videoFileFullPath)) + '#t=' + new Date().getTime();
        } else if (node.videoLink) {
            vFile.style.display = 'none'; vFile.removeAttribute('src');
            fallback.style.display = 'none';
            yTIframe.style.display = 'block';
            let embedUrl = node.videoLink;
            if (embedUrl.includes('youtube.com/watch?v=')) {
                let videoId = embedUrl.split('watch?v=')[1].split('&')[0];
                embedUrl = `https://www.youtube.com/embed/${videoId}`;
            } else if (embedUrl.includes('youtu.be/')) {
                let videoId = embedUrl.split('youtu.be/')[1].split('?')[0];
                embedUrl = `https://www.youtube.com/embed/${videoId}`;
            } else if (!embedUrl.startsWith('http')) {
                embedUrl = 'https://' + embedUrl;
            }
            yTIframe.src = embedUrl;
        } else {
            yTIframe.style.display = 'none'; yTIframe.removeAttribute('src');
            vFile.style.display = 'none'; vFile.removeAttribute('src');
            fallback.style.display = 'flex';
        }
    }, 500);
}
async function handleSingleVideoFile(file) {
    if (!file || !activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        const result = await window.electronAPI.managedCopy(file.path);
        if (result.success) {
            info.node.videoFile = result.fileName;
            info.node.videoFileFullPath = result.fileName; // Relative in storage
            info.node.videoLink = '';
            showEditor(activeEditingNodeId);
            await saveWorkspace();
        } else {
            showToast("Failed to collect video: " + result.error, "error");
        }
    }
}
function removeAttachedVideo() {
    if (!activeEditingNodeId) return; const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) { info.node.videoFile = null; info.node.videoFileFullPath = null; showEditor(activeEditingNodeId); saveWorkspace(); }
}

let currentEpubBook = null;
let currentEpubRendition = null;
let currentEpubSelectionCfi = null;

function addEpubHighlight(cfi) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    if (!info.node.epubHighlights) info.node.epubHighlights = [];
    if (!info.node.epubHighlights.includes(cfi)) {
        info.node.epubHighlights.push(cfi);
        if (currentEpubRendition) {
            currentEpubRendition.annotations.add("highlight", cfi, {}, null, "hl-class", { "fill": "rgba(255, 255, 0, 0.4)" });
            currentEpubRendition.getRange(cfi).then(range => {
                if (range) {
                    const selection = currentEpubRendition.getContents()[0].window.getSelection();
                    selection.removeAllRanges();
                }
            });
        }
        saveWorkspace();
    }
}

function renderEpub(fileFullPath) {
    const area = document.getElementById('epub-reader-area');
    const prev = document.getElementById('epub-nav-prev');
    const next = document.getElementById('epub-nav-next');
    const fallback = document.getElementById('epub-preview-fallback');
    if (!fileFullPath) {
        area.innerHTML = '';
        prev.style.display = 'none'; next.style.display = 'none';
        fallback.style.display = 'flex';
        if (currentEpubBook) { currentEpubBook.destroy(); currentEpubBook = null; currentEpubRendition = null; }
        return;
    }
    fallback.style.display = 'none';
    prev.style.display = 'flex'; next.style.display = 'flex';
    if (currentEpubBook) { currentEpubBook.destroy(); }
    area.innerHTML = '';
    try {
        currentEpubBook = ePub("file://" + encodeURI(resolvePath(fileFullPath)));
        currentEpubRendition = currentEpubBook.renderTo("epub-reader-area", { width: "100%", height: "100%", spread: "none" });
        
        const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
        if (info) {
            applyEpubStyles(currentEpubRendition, info.node);
            applyEpubHighlights(currentEpubRendition, info.node);
            document.getElementById('epub-font-size-display').innerText = (info.node.epubFontSize || 100) + "%";
        } else {
            document.getElementById('epub-font-size-display').innerText = "100%";
        }

        currentEpubRendition.on("selected", (cfiRange) => {
            currentEpubSelectionCfi = cfiRange;
        });

        currentEpubRendition.on("keydown", (e) => {
            if (e.key === 'h' || e.key === 'H') {
                if (currentEpubSelectionCfi) {
                    addEpubHighlight(currentEpubSelectionCfi);
                    currentEpubSelectionCfi = null;
                }
            }
        });

        currentEpubRendition.display();
        prev.onclick = () => { if (currentEpubRendition) currentEpubRendition.prev(); };
        next.onclick = () => { if (currentEpubRendition) currentEpubRendition.next(); };
    } catch (e) {
        fallback.style.display = 'flex';
        fallback.innerHTML = `<div style="font-size:3.5rem; margin-bottom:15px; opacity:0.5;">⚠️</div><h3 style="color:var(--danger)">Error Loading EPUB</h3><p style="color:#888;">${e.message}</p>`;
    }
}
async function handleSingleEpubFile(file) {
    if (!file || !activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        const result = await window.electronAPI.managedCopy(file.path);
        if (result.success) {
            info.node.epubFile = result.fileName;
            info.node.epubFileFullPath = result.fileName;
            showEditor(activeEditingNodeId);
            await saveWorkspace();
        } else {
            showToast("Failed to collect EPUB: " + result.error, "error");
        }
    }
}
function removeAttachedEpub() {
    if (!activeEditingNodeId) return; const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) { info.node.epubFile = null; info.node.epubFileFullPath = null; showEditor(activeEditingNodeId); saveWorkspace(); }
}

function changeEpubFontSize(delta) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    
    if (!info.node.epubFontSize) info.node.epubFontSize = 100;
    info.node.epubFontSize = Math.max(50, Math.min(300, info.node.epubFontSize + delta));
    
    if (currentEpubRendition) {
        currentEpubRendition.themes.fontSize(info.node.epubFontSize + "%");
    }
    document.getElementById('epub-font-size-display').innerText = info.node.epubFontSize + "%";
    saveWorkspace();
}

function setEpubFontSize(value) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    
    info.node.epubFontSize = value;
    if (currentEpubRendition) {
        currentEpubRendition.themes.fontSize(info.node.epubFontSize + "%");
    }
    document.getElementById('epub-font-size-display').innerText = info.node.epubFontSize + "%";
    saveWorkspace();
}

function changeEpubMargin(delta) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    if (!info.node.epubMargin) info.node.epubMargin = 40;
    info.node.epubMargin = Math.max(0, Math.min(200, info.node.epubMargin + delta));
    applyEpubStyles(currentEpubRendition, info.node);
    saveWorkspace();
}

function changeEpubLineHeight(delta) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    if (!info.node.epubLineHeight) info.node.epubLineHeight = 1.5;
    info.node.epubLineHeight = Math.max(0.8, Math.min(3.0, info.node.epubLineHeight + delta));
    applyEpubStyles(currentEpubRendition, info.node);
    saveWorkspace();
}

function changeEpubParagraphSpacing(delta) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    if (!info.node.epubParagraphSpacing) info.node.epubParagraphSpacing = 1.0;
    info.node.epubParagraphSpacing = Math.max(0, Math.min(5.0, info.node.epubParagraphSpacing + delta));
    applyEpubStyles(currentEpubRendition, info.node);
    saveWorkspace();
}

function applyEpubStyles(rd, node) {
    if (!rd) return;
    const styles = {
        "body": {
            "padding": `0 ${node.epubMargin || 40}px !important`,
            "line-height": `${node.epubLineHeight || 1.5} !important`
        },
        "p": {
            "margin-bottom": `${node.epubParagraphSpacing || 1.0}em !important`,
            "line-height": `${node.epubLineHeight || 1.5} !important`
        }
    };
    rd.themes.register("custom", styles);
    rd.themes.select("custom");
    if (node.epubFontSize) rd.themes.fontSize(node.epubFontSize + "%");
}

function applyEpubHighlights(rd, node) {
    if (!rd || !node.epubHighlights) return;
    node.epubHighlights.forEach(cfi => {
        rd.annotations.add("highlight", cfi, {}, null, "hl-class", { "fill": "rgba(255, 255, 0, 0.4)" });
    });
}

function clearEpubHighlights() {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    info.node.epubHighlights = [];
    if (currentEpubRendition) {
        // Unfortunately epub.js doesn't have a clear all, so we re-render or remove specifically
        // Simplest is to re-render for now or just remove the highlight entries
        info.node.epubHighlights.forEach(cfi => currentEpubRendition.annotations.remove(cfi, "highlight"));
    }
    showEditor(activeEditingNodeId);
    saveWorkspace();
}

let autoCompileLatex = false;
let autoCompileTypst = false;
let latexMaximized = false;
let typstMaximized = false;
let htmlMaximized = false;

function toggleMinimizeCode(type) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;
    info.node[`${type}Minimized`] = !info.node[`${type}Minimized`];
    saveWorkspace();
    applyMinimizeCodeState(type, info.node[`${type}Minimized`]);
}

function applyMinimizeCodeState(type, isMinimized) {
    const ta = document.getElementById(`ed-${type}`);
    const btn = document.getElementById(`${type}-minimize-code-btn`);
    if (!ta || !btn) return;
    if (isMinimized) {
        ta.style.display = 'none';
        btn.innerText = '⊞ Show Code';
    } else {
        ta.style.display = 'block';
        btn.innerText = '⊟ Hide Code';
    }
}



let treePaneCollapsed = false;

let isResizingPane = false;
document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('pane-resizer');
    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            isResizingPane = true;
            document.body.classList.add('is-resizing');
            resizer.classList.add('active-resize');
        });
    }
});
document.addEventListener('mousemove', (e) => {
    if (!isResizingPane) return;
    const newWidth = Math.max(200, Math.min(e.clientX, window.innerWidth - 300));
    document.documentElement.style.setProperty('--tree-pane-width', `${newWidth}px`);
});
document.addEventListener('mouseup', () => {
    if (isResizingPane) {
        isResizingPane = false;
        document.body.classList.remove('is-resizing');
        const resizer = document.getElementById('pane-resizer');
        if (resizer) resizer.classList.remove('active-resize');
    }
});

let currentImportTarget = null;
let currentImportNodeId = null;
let pendingImportData = null;

let currentConfirmCallback = null;

let state = {
    classes: [
        {
            id: 'c1', title: 'Web Development Basics', emoji: '🌐', color: '#8b5cf6',
            labels: { l1: 'Module', l2: 'Lesson' },
            nodes: [],
            collapsed: false,
            seatingChart: { students: {}, objects: [] }
        }
    ]
};

let activeClassId = null; let activeEditingNodeId = null; let draggedNodeId = null;

async function saveWorkspace() {
    const data = { state, autoCompileLatex };
    if (window.electronAPI && window.electronAPI.saveState) {
        await window.electronAPI.saveState(data);
    } else {
        localStorage.setItem('zenith_os_data', JSON.stringify(data));
    }
}

async function loadWorkspace() {
    const saved = await window.electronAPI.loadState();
    if (saved) {
        if (saved.state) state = saved.state;
        if (saved.autoCompileLatex !== undefined) autoCompileLatex = saved.autoCompileLatex;
    } else {
        const local = localStorage.getItem('zenith_os_data');
        if (local) {
            try {
                const data = JSON.parse(local);
                if (data.state) state = data.state;
                if (data.autoCompileLatex !== undefined) autoCompileLatex = data.autoCompileLatex;
            } catch (e) {
                console.error('Failed to load local storage', e);
            }
        }
    }
}

async function exportZipBackup() {
    const destDir = await window.electronAPI.selectDirectory();
    if (!destDir) return;
    const zipName = `CurriculumOS_Backup_${new Date().toISOString().split('T')[0]}.zip`;
    const fullZipPath = `${destDir}/${zipName}`;
    showToast("Generating ZIP...", "info");
    const result = await window.electronAPI.exportArchive(fullZipPath);
    if (result.success) {
        showToast("Backup saved to " + zipName, "success");
    } else {
        showToast("Export failed: " + result.error, "error");
    }
}

async function importZipBackup() {
    openConfirmModal("Restore from ZIP", "This will PERMANENTLY OVERWRITE your current workspace and all managed files. Are you sure?", async () => {
        const zipPath = await window.electronAPI.selectFile({ filters: [{ name: 'ZIP Archives', extensions: ['zip'] }] });
        if (!zipPath) return;
        showToast("Importing...", "info");
        const result = await window.electronAPI.importArchive(zipPath);
        if (result.success) {
            window.location.reload();
        } else {
            showToast("Import failed: " + result.error, "error");
        }
    });
}

function getPublishPath(nodeId) {
    const cls = getActiveClass();
    if (!cls) return '';

    let foundPath = '';
    function search(nodes, targetId, currentPath) {
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const num = String(i + 1).padStart(2, '0');
            const safeTitle = node.title.replace(/[^a-z0-9\s-]/gi, '').trim();
            const prefixName = `${num}_${safeTitle}`;

            if (node.id === targetId) {
                if (node.type === 'block') {
                    let ext = '.txt';
                    if (node.assetType === 'html') ext = '.html';
                    else if (node.assetType === 'raw') ext = '.html';
                    else if (node.assetType === 'latex') ext = '.pdf';
                    else if (node.assetType === 'json') {
                        ext = node.customExtension || '.json';
                        if (!ext.startsWith('.')) ext = '.' + ext;
                    }
                    else if (node.assetType === 'link') ext = '.html';
                    else if (node.assetType === 'video') ext = node.videoFile ? '_' + node.videoFile : '.html';
                    else if (node.assetType === 'epub') ext = '.epub';
                    else if (node.assetType === 'file' && node.file) ext = '_' + node.file;
                    foundPath = currentPath ? `${currentPath}/${prefixName}${ext}` : `${prefixName}${ext}`;
                } else {
                    foundPath = currentPath ? `${currentPath}/${prefixName}/` : `${prefixName}/`;
                }
                return true;
            }
            if (node.children) {
                const newPath = currentPath ? `${currentPath}/${prefixName}` : prefixName;
                if (search(node.children, targetId, newPath)) return true;
            }
        }
        return false;
    }
    search(cls.nodes, nodeId, '');
    return `CurriculumOS Library/${cls.title.replace(/[^a-z0-9\s-]/gi, '').trim()}/${foundPath}`;
}

function isNodeFilled(node) {
    if (!node || node.type !== 'block') return true; // Folders are always "filled" for tree logic
    if (node.assetType === 'empty') return false;
    if (node.assetType === 'html' && node.html && node.html.trim().length > 0) return true;
    if (node.assetType === 'raw' && node.raw && node.raw.trim().length > 0) return true;
    if (node.assetType === 'latex' && ((node.latex && node.latex.trim().length > 0) || (node.typst && node.typst.trim().length > 0) || node.latexFile)) return true;
    if (node.assetType === 'json' && node.json && node.json.trim().length > 0) return true;
    if (node.assetType === 'link' && node.link && node.link.trim().length > 0) return true;
    if (node.assetType === 'file' && node.file) return true;
    if (node.assetType === 'video' && (node.videoFile || (node.videoLink && node.videoLink.trim().length > 0))) return true;
    if (node.assetType === 'epub' && node.epubFile) return true;
    return false;
}

function buildPublishPayload(nodes, currentPath = '', parentNode = null) {
    let payload = [];
    let publishedCount = 0;
    nodes.forEach((node) => {
        // Skip nodes in draft status or without content
        if (node.type === 'block') {
            if (node.assetType === 'empty' || !isNodeFilled(node)) {
                return;
            }
        }

        publishedCount++;
        const num = String(publishedCount).padStart(2, '0');
        const safeTitle = node.title.replace(/[^a-z0-9\s-]/gi, '').trim();
        const prefixName = `${num}_${safeTitle}`;

        if (node.type === 'block') {
            let ext = '.txt';
            let content = '';

            if (node.assetType === 'raw' || node.assetType === 'empty') {
                ext = '.html';
                const cls = getActiveClass();
                let focusHtml = '';
                if (parentNode && parentNode.objectives) {
                    const label = (parentNode.type === 'l1' ? cls.labels.l1 : cls.labels.l2) || 'Weekly Focus';
                    const objectives = parentNode.objectives.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                    focusHtml = `
            <div class="focus-box" style="background:#f8fafc; border:1px solid #e2e8f0; padding:24px; margin-bottom:40px; border-radius:12px; font-family:system-ui, -apple-system, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-weight:800; text-transform:uppercase; font-size:0.7rem; color:#64748b; letter-spacing:0.1em; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <span style="font-size: 1.2rem;">🎯</span> ${label} Focus
                </div>
                <div style="color:#1e293b; line-height:1.6; font-size:1rem; font-weight: 500;">${objectives}</div>
            </div>`;
                }

                const safeContent = (node.raw || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                content = `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>${safeTitle}</title>\n    <style>\n        body { background:#ffffff; color:#333333; font-family:ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; padding:60px 40px; line-height:1.8; max-width:800px; margin:0 auto; font-size: 1.15rem; }\n        h1 { margin-top: 0; font-family: system-ui, -apple-system, sans-serif; font-size: 2.5rem; color: #111; letter-spacing: -0.03em; border-bottom: 1px solid #eaeaea; padding-bottom: 15px; margin-bottom: 30px; }\n        .content { white-space: pre-wrap; }\n    </style>\n</head>\n<body>\n    ${focusHtml}\n    <h1>${safeTitle}</h1>\n    <div class="content">${safeContent}</div>\n</body>\n</html>`;
            }
            else if (node.assetType === 'html') {
                ext = '.html';
                content = node.html || '';
            }
            else if (node.assetType === 'latex') {
                const subtype = node.latexSubtype || (node.latexFile ? 'pdf' : (node.typst ? 'typst' : 'latex'));
                let reliablePdfPath = null;

                if (subtype === 'pdf' && node.latexFile) {
                    reliablePdfPath = resolvePath(node.latexFile);
                } else if (subtype === 'typst' && node.compiledTypstPath) {
                    const isAbsolute = node.compiledTypstPath.startsWith('/') || node.compiledTypstPath.includes(':/');
                    if (!isAbsolute) {
                        reliablePdfPath = resolvePath(node.compiledTypstPath);
                    }
                } else if (subtype === 'latex' && node.compiledLatexPath) {
                    const isAbsolute = node.compiledLatexPath.startsWith('/') || node.compiledLatexPath.includes(':/');
                    if (!isAbsolute) {
                        reliablePdfPath = resolvePath(node.compiledLatexPath);
                    }
                }

                if (reliablePdfPath) {
                    payload.push({
                        path: currentPath ? `${currentPath}/${prefixName}.pdf` : `${prefixName}.pdf`,
                        type: 'copyFile',
                        sourcePath: reliablePdfPath
                    });
                } else {
                    const supportingFiles = [];
                    if (node.fileFullPath) supportingFiles.push(resolvePath(node.fileFullPath));
                    if (node.videoFileFullPath) supportingFiles.push(resolvePath(node.videoFileFullPath));
                    if (node.epubFileFullPath) supportingFiles.push(resolvePath(node.epubFileFullPath));

                    if (subtype === 'typst') {
                        payload.push({
                            path: currentPath ? `${currentPath}/${prefixName}.pdf` : `${prefixName}.pdf`,
                            type: 'compileTypst',
                            rawTypst: node.typst || '',
                            supportingFiles: supportingFiles
                        });
                    } else {
                        payload.push({
                            path: currentPath ? `${currentPath}/${prefixName}.pdf` : `${prefixName}.pdf`,
                            type: 'compileLatex',
                            rawLatex: node.latex || '',
                            supportingFiles: supportingFiles
                        });
                    }
                }
                return;
            }
            else if (node.assetType === 'json') {
                ext = node.customExtension || '.json';
                if (!ext.startsWith('.')) ext = '.' + ext;
                content = node.json || '';
            }
            else if (node.assetType === 'link') {
                ext = '.html';
                let finalUrl = node.link.startsWith('http') ? node.link : 'https://' + node.link;
                content = `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>${safeTitle}</title>\n</head>\n<body style="margin:0;height:100vh;overflow:hidden;">\n    <iframe src="${finalUrl}" style="width:100%;height:100%;border:none;"></iframe>\n</body>\n</html>`;
            }
            else if (node.assetType === 'epub') {
                if (node.epubFile) {
                    payload.push({
                        path: currentPath ? `${currentPath}/${prefixName}.epub` : `${prefixName}.epub`,
                        type: 'copyFile',
                        sourcePath: resolvePath(node.epubFileFullPath)
                    });
                }
                return;
            }
            else if (node.assetType === 'video') {
                ext = '.html';
                if (node.videoFile) {
                    payload.push({ path: currentPath ? `${currentPath}/${prefixName}_${node.videoFile}` : `${prefixName}_${node.videoFile}`, type: 'copyFile', sourcePath: resolvePath(node.videoFileFullPath) });
                    content = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;"><video controls preload="metadata" style="max-width:100%;max-height:100%;"><source src="${prefixName}_${node.videoFile}"></video></body></html>`;
                } else if (node.videoLink) {
                    let embedUrl = node.videoLink;
                    if (embedUrl.includes('youtube.com/watch?v=')) {
                        let videoId = embedUrl.split('watch?v=')[1].split('&')[0];
                        embedUrl = `https://www.youtube.com/embed/${videoId}`;
                    } else if (embedUrl.includes('youtu.be/')) {
                        let videoId = embedUrl.split('youtu.be/')[1].split('?')[0];
                        embedUrl = `https://www.youtube.com/embed/${videoId}`;
                    } else if (!embedUrl.startsWith('http')) {
                        embedUrl = 'https://' + embedUrl;
                    }
                    content = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;"><iframe src="${embedUrl}" style="width:100vw;height:100vh;border:none;" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></body></html>`;
                }
            }
            else if (node.assetType === 'file') {
                if (node.file) {
                    payload.push({
                        path: currentPath ? `${currentPath}/${prefixName}_${node.file}` : `${prefixName}_${node.file}`,
                        type: 'copyFile',
                        sourcePath: resolvePath(node.fileFullPath)
                    });
                }
                return;
            }

            if (node.assetType !== 'empty' || content) {
                payload.push({
                    path: currentPath ? `${currentPath}/${prefixName}${ext}` : `${prefixName}${ext}`,
                    type: 'file',
                    assetType: node.assetType,
                    content: content,
                    nodeId: node.id
                });
            }
        } else {
            const newPath = currentPath ? `${currentPath}/${prefixName}` : prefixName;
            payload.push({
                path: newPath,
                type: 'folder'
            });
            if (node.children) {
                payload = payload.concat(buildPublishPayload(node.children, newPath, node));
            }
        }
    });
    return payload;
}

async function publishActiveCourse() {
    const cls = getActiveClass();
    if (!cls) return;
    showToast(`Publishing ${cls.title}...`, 'info');
    await publishData(cls);
}

async function publishAllCourses() {
    if (!state || !state.classes || state.classes.length === 0) {
        showToast('Nothing to publish', 'warning');
        return;
    }

    showToast('Batch Publishing Started...', 'info');
    for (const cls of state.classes) {
        console.log(`Batch processing: ${cls.title}`);
        await publishData(cls, false); // false to suppress individual success toasts if needed, but the user liked visibility
    }
    showToast('All Courses Published!', 'success');
}

async function publishData(cls, showSuccess = true) {
    const payload = buildPublishPayload(cls.nodes, '');
    try {
        if (window.electronAPI && window.electronAPI.publishCourse) {
            const result = await window.electronAPI.publishCourse(cls.title, payload);
            if (result && result.success) {
                if (showSuccess) showToast(`${cls.title}: Published!`, 'success');
            } else {
                const errMsg = (result && result.error) ? `: ${result.error}` : '';
                showToast(`${cls.title}: Publish Failed${errMsg}`, 'error');
                console.error(`Publish failed for ${cls.title}`, result);
            }
        } else {
            console.log(`Payload for ${cls.title}:`, payload);
            if (showSuccess) showToast(`${cls.title}: Complete (Simulated)`, 'success');
        }
    } catch (e) {
        showToast(`${cls.title}: Execution Error`, 'error');
    }
}

async function openCourseFolder() {
    const cls = getActiveClass();
    if (!cls) return;

    try {
        if (window.electronAPI && window.electronAPI.openCourseFolder) {
            const result = await window.electronAPI.openCourseFolder(cls.title);
            if (!result || !result.success) showToast('Failed to open Finder', 'error');
        } else {
            showToast('Finder integration requires Electron', 'warning');
        }
    } catch (e) {
        showToast('Error opening Finder', 'error');
    }
}

async function openLibraryFolder() {
    try {
        if (window.electronAPI && window.electronAPI.openLibraryFolder) {
            const result = await window.electronAPI.openLibraryFolder();
            if (!result || !result.success) showToast('Failed to open Finder', 'error');
        } else {
            showToast('Finder integration requires Electron', 'warning');
        }
    } catch (e) {
        showToast('Error opening Finder', 'error');
    }
}


function toggleTreePane() {
    treePaneCollapsed = !treePaneCollapsed;
    const tp = document.getElementById('tree-pane');
    if (treePaneCollapsed) tp.classList.add('collapsed'); else tp.classList.remove('collapsed');
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight) + 'px';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || document.body.appendChild(document.createElement('div'));
    container.id = 'toast-container';
    const toast = document.createElement('div'); toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : (type === 'warning' ? '!' : (type === 'error' ? '✕' : 'i'));
    toast.innerHTML = `<div class="toast-icon">${icon}</div> <div>${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function openConfirmModal(title, message, onConfirm, isLarge = false, okText = 'Confirm', cancelText = 'Cancel') {
    const modal = document.getElementById('confirm-modal');
    const content = modal.querySelector('.modal-content');

    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerHTML = message;

    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    okBtn.innerText = okText;
    cancelBtn.innerText = cancelText;

    // If it's just an alert (no onConfirm passed), hide the cancel button
    if (!onConfirm) cancelBtn.style.display = 'none';
    else cancelBtn.style.display = 'block';
    currentConfirmCallback = onConfirm;
    modal.classList.add('active');
}

function closeConfirmModal() { document.getElementById('confirm-modal').classList.remove('active'); currentConfirmCallback = null; }
function executeConfirm() {
    if (currentConfirmCallback) currentConfirmCallback();
    closeConfirmModal();
}

let currentInputCallback = null;
function openInputModal(title, message, defaultValue, onConfirm) {
    document.getElementById('input-title').innerText = title;
    document.getElementById('input-message').innerText = message;
    const field = document.getElementById('modal-input-field');
    field.value = defaultValue || '';
    currentInputCallback = onConfirm;
    document.getElementById('input-modal').classList.add('active');
    setTimeout(() => field.focus(), 100);
}
function closeInputModal() { document.getElementById('input-modal').classList.remove('active'); currentInputCallback = null; }
function executeInputConfirm() {
    const value = document.getElementById('modal-input-field').value;
    if (currentInputCallback) currentInputCallback(value);
    closeInputModal();
}

// Global Key Handlers
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeConfirmModal();
        closeImportModal();
        closeStaging();
        document.getElementById('export-modal').classList.remove('active');
        document.getElementById('course-modal').classList.remove('active');
    }
});

function getActiveClass() { return state.classes.find(c => c.id === activeClassId); }
function generateId() { return Math.random().toString(36).substr(2, 9); }

function healJSON(rawString) {
    if (!rawString || !rawString.trim()) return null;
    try { return JSON.parse(rawString); } catch (e) { }
    let s = rawString.trim();
    let inString = false, escape = false, stack = [];
    for (let i = 0; i < s.length; i++) {
        let c = s[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (!inString) {
            if (c === '{') stack.push('}');
            else if (c === '[') stack.push(']');
            else if (c === '}' || c === ']') stack.pop();
        }
    }
    if (inString) s += '"';
    s = s.replace(/,\s*$/, '');
    while (stack.length > 0) s += stack.pop();
    try { return JSON.parse(s); } catch (e) { console.error("Auto-heal failed"); return null; }
}

function toggleMaximizeLatex() {
    latexMaximized = !latexMaximized;
    const container = document.getElementById('fg-latex');
    const btn = document.getElementById('latex-maximize-btn');
    if (latexMaximized) {
        container.classList.add('maximized-editor');
        btn.innerText = '🗗 Minimize Editor';
    } else {
        container.classList.remove('maximized-editor');
        btn.innerText = '⛶ Maximize Editor';
    }
}

function toggleMaximizeTypst() {
    typstMaximized = !typstMaximized;
    const container = document.getElementById('fg-latex'); // same container
    const btn = document.getElementById('typst-maximize-btn');
    if (typstMaximized) {
        container.classList.add('maximized-editor');
        btn.innerText = '🗗 Minimize Editor';
    } else {
        container.classList.remove('maximized-editor');
        btn.innerText = '⛶ Maximize Editor';
    }
}

function toggleMaximizeHtml() {
    htmlMaximized = !htmlMaximized;
    const container = document.getElementById('fg-html');
    const btn = document.getElementById('html-maximize-btn');
    if (htmlMaximized) {
        container.classList.add('maximized-editor');
        btn.innerText = '🗗 Minimize Editor';
    } else {
        container.classList.remove('maximized-editor');
        btn.innerText = '⛶ Maximize Editor';
    }
}

function showEditor(nodeId) {
    activeEditingNodeId = nodeId; document.querySelectorAll('.tree-node').forEach(el => el.classList.remove('active'));
    document.getElementById('editor-empty').style.display = 'none'; document.getElementById('editor-active-block').classList.remove('active'); document.getElementById('editor-active-folder').classList.remove('active');

    // Failsafe: Reset maximize views when switching files
    latexMaximized = false;
    typstMaximized = false;
    document.getElementById('fg-latex').classList.remove('maximized-editor');
    document.getElementById('latex-maximize-btn').innerText = '⛶ Maximize Editor';
    document.getElementById('typst-maximize-btn').innerText = '⛶ Maximize Editor';

    htmlMaximized = false;
    document.getElementById('fg-html').classList.remove('maximized-editor');
    document.getElementById('html-maximize-btn').innerText = '⛶ Maximize Editor';

    if (!nodeId) { document.getElementById('editor-empty').style.display = 'flex'; return; }

    let info = null;
    let foundClassId = null;
    for (const cls of state.classes) {
        info = findNodeInfo(nodeId, cls.nodes);
        if (info) {
            foundClassId = cls.id;
            break;
        }
    }

    if (!info) return;

    if (foundClassId !== activeClassId) {
        activeClassId = foundClassId;
        renderTree();
    }

    const node = info.node;

    if (node.type === 'block') {
        document.getElementById('editor-active-block').classList.add('active');
        document.getElementById('ed-title-block').value = node.title;

        // Clear state inputs so file selection can be invoked correctly
        document.getElementById('ed-file-input').value = '';
        document.getElementById('ed-video-file-input').value = '';
        document.getElementById('ed-epub-file-input').value = '';
        document.getElementById('ed-path-block').innerText = getPublishPath(node.id);
        document.getElementById('ed-desc').value = node.description || ''; autoResize(document.getElementById('ed-desc'));
        document.getElementById('ed-raw').value = node.raw || ''; autoResize(document.getElementById('ed-raw'));
        scheduleRawPreview(node.raw);
        scheduleRawPreview(node.raw);
        document.getElementById('ed-html').value = node.html || '';
        document.getElementById('ed-html-preview').srcdoc = node.html || '';
        applyMinimizeCodeState('html', !!node.htmlMinimized);

        const subtype = node.latexSubtype || (node.latexFile ? 'pdf' : (node.typst ? 'typst' : 'latex'));
        document.getElementById('ed-latex-subtype').value = subtype;

        document.getElementById('ed-latex').value = node.latex || '';
        applyMinimizeCodeState('latex', !!node.latexMinimized);
        document.getElementById('ed-latex-preview').removeAttribute('src');
        document.getElementById('ed-latex-preview').srcdoc = '';
        document.getElementById('latex-compile-status').innerText = '';
        document.getElementById('latex-auto-toggle').checked = autoCompileLatex;

        document.getElementById('ed-typst').value = node.typst || '';
        applyMinimizeCodeState('typst', !!node.typstMinimized);
        document.getElementById('ed-typst-preview').removeAttribute('src');
        document.getElementById('ed-typst-preview').srcdoc = '';
        document.getElementById('typst-compile-status').innerText = '';
        document.getElementById('typst-auto-toggle').checked = autoCompileTypst;

        if (node.latexFile) {
            document.getElementById('latex-file-active-area').style.display = 'flex';
            document.getElementById('attached-latex-file-name').innerText = node.latexFileName || 'Attached PDF';
            document.getElementById('latex-attach-btn').style.display = 'none';
        } else {
            document.getElementById('latex-file-active-area').style.display = 'none';
            document.getElementById('latex-attach-btn').style.display = 'inline-flex';
        }

        setLatexSubtype(subtype, true);

        document.getElementById('ed-json').value = node.json || '';
        document.getElementById('ed-json-ext').value = node.customExtension || '';
        
        const subtypeSelect = document.getElementById('ed-json-subtype');
        subtypeSelect.value = node.jsonSubtype || 'json';
        document.getElementById('ed-json-collection').value = node.jsonCollection || '';
        
        // Match UI to subtype
        const val = subtypeSelect.value;
        const extContainer = document.getElementById('json-ext-container');
        const collectionContainer = document.getElementById('json-collection-container');
        const baselineEditor = document.getElementById('json-baseline-editor');
        const srs1Container = document.getElementById('srs1-composer-container');

        extContainer.style.display = val === 'srs1' ? 'none' : 'block';
        collectionContainer.style.display = val === 'srs1' ? 'block' : 'none';
        baselineEditor.style.display = val === 'srs1' ? 'none' : 'block';
        srs1Container.style.display = val === 'srs1' ? 'block' : 'none';

        document.getElementById('ed-link').value = node.link || '';
        scheduleLinkPreview(node.link);

        // assign video properties
        document.getElementById('ed-video-link').value = node.videoLink || '';
        if (node.videoFile) {
            document.getElementById('video-drop-area').style.display = 'none';
            document.getElementById('video-active-area').style.display = 'flex';
            document.getElementById('attached-video-name').innerText = node.videoFile;
        } else {
            document.getElementById('video-drop-area').style.display = 'flex';
            document.getElementById('video-active-area').style.display = 'none';
        }

        setAssetType(node.assetType || 'empty', true);

        if (node.assetType === 'video') { scheduleVideoPreview(); }

        if (node.epubFile) {
            document.getElementById('epub-drop-area').style.display = 'none';
            document.getElementById('epub-active-area').style.display = 'flex';
            document.getElementById('attached-epub-name').innerText = node.epubFile;
            renderEpub(node.epubFileFullPath);
        } else {
            document.getElementById('epub-drop-area').style.display = 'flex';
            document.getElementById('epub-active-area').style.display = 'none';
            renderEpub(null);
        }

        if (node.assetType === 'latex') {
            const currentSubtype = node.latexSubtype || (node.latexFile ? 'pdf' : (node.typst ? 'typst' : 'latex'));
            if (currentSubtype === 'pdf' && node.latexFile) {
                // If PDF preview is needed, point the dedicated iframe to it
                document.getElementById('ed-latex-pdf-preview').src = `file://${encodeURI(resolvePath(node.latexFile))}#t=${new Date().getTime()}`;
            } else if (currentSubtype === 'latex' && node.latex) {
                executeLatexCompile(node.latex);
            } else if (currentSubtype === 'typst' && node.typst) {
                executeTypstCompile(node.typst);
            }
        }

        if (node.file) {
            document.getElementById('file-drop-area').style.display = 'none';
            document.getElementById('file-active-area').style.display = 'flex';
            document.getElementById('attached-file-name').innerText = node.file;

            const iframe = document.getElementById('ed-file-preview');
            const fallback = document.getElementById('file-preview-fallback');
            const officeContainer = document.getElementById('ed-office-preview-container');

            if (node.fileFullPath) {
                const safeExt = node.file.toLowerCase().split('.').pop();
                const viewableExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf'];
                // Hide all first
                iframe.style.display = 'none';
                fallback.style.display = 'none';
                officeContainer.style.display = 'none';

                if (viewableExts.includes(safeExt)) {
                    iframe.style.display = 'block';
                    iframe.src = 'file://' + encodeURI(node.fileFullPath) + '#t=' + new Date().getTime();
                } else if (officeExtensions.includes(safeExt)) {
                    renderOfficePreview(resolvePath(node.fileFullPath), 'ed-office-iframe', 'ed-office-loading', 'ed-office-preview-container');
                } else {
                    fallback.style.display = 'flex';
                }
            } else {
                iframe.style.display = 'none';
                iframe.removeAttribute('src');
                fallback.style.display = 'none';
                officeContainer.style.display = 'none';
                const officeIframe = document.getElementById('ed-office-iframe');
                if (officeIframe) officeIframe.src = '';
            }
        } else {
            document.getElementById('file-drop-area').style.display = 'flex';
            document.getElementById('file-active-area').style.display = 'none';
            document.getElementById('ed-file-preview').style.display = 'none';
            document.getElementById('ed-file-preview').removeAttribute('src');
            document.getElementById('file-preview-fallback').style.display = 'none';
            document.getElementById('ed-office-preview-container').style.display = 'none';
            const officeIframe = document.getElementById('ed-office-iframe');
            if (officeIframe) officeIframe.src = '';
        }
    } else {
        document.getElementById('editor-active-folder').classList.add('active');
        const cls = getActiveClass();
        const badge = document.getElementById('ed-badge-folder');
        badge.className = `badge badge-${node.type}`;
        badge.innerHTML = node.type === 'l1' ? cls.labels.l1 : cls.labels.l2;
        document.getElementById('ed-title-folder').value = node.title;
        document.getElementById('ed-path-folder').innerText = getPublishPath(node.id);
        document.getElementById('ed-folder-obj').value = node.objectives || ''; autoResize(document.getElementById('ed-folder-obj'));
        renderTimeline(node);
    }
    if (document.querySelector(`[data-id="${nodeId}"]`)) document.querySelector(`[data-id="${nodeId}"]`).classList.add('active');

    // If it's a JSON/SRS1 activity, make sure the iframe is synced
    if (node.type === 'block' && node.assetType === 'json' && node.jsonSubtype === 'srs1') {
        setTimeout(() => loadDataIntoSrs1(node), 500);
    }
}

function loadDataIntoSrs1(node) {
    const iframe = document.getElementById('srs1-iframe');
    if (!iframe || !iframe.contentWindow) return;
    
    let payload = null;
    try {
        if (node.json) payload = JSON.parse(node.json);
    } catch (e) {
        console.error("Failed to parse node.json for SRS1 loading", e);
    }

    iframe.contentWindow.postMessage({ type: 'load', payload: payload }, '*');
    iframe.contentWindow.postMessage({ type: 'setCollection', value: node.jsonCollection || '' }, '*');
}

function setJsonSubtype(value) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;

    info.node.jsonSubtype = value;
    
    const extContainer = document.getElementById('json-ext-container');
    const collectionContainer = document.getElementById('json-collection-container');
    const baselineEditor = document.getElementById('json-baseline-editor');
    const srs1Container = document.getElementById('srs1-composer-container');
    const extInput = document.getElementById('ed-json-ext');

    // Reset visibility
    extContainer.style.display = 'block';
    collectionContainer.style.display = 'none';
    baselineEditor.style.display = 'block';
    srs1Container.style.display = 'none';

    if (value === 'srs1') {
        extContainer.style.display = 'none';
        collectionContainer.style.display = 'block';
        baselineEditor.style.display = 'none';
        srs1Container.style.display = 'block';
        
        info.node.customExtension = '.srs1';
        extInput.value = '.srs1';
        
        // Initial load
        loadDataIntoSrs1(info.node);
    } else if (value === 'json') {
        info.node.customExtension = '.json';
        extInput.value = '.json';
    } else {
        // Other - user manual control
    }

    document.getElementById('ed-path-block').innerText = getPublishPath(activeEditingNodeId);
    saveWorkspace();
}

function updateSrs1Collection(value) {
    const iframe = document.getElementById('srs1-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'setCollection', value: value }, '*');
    }
}

// Global listener for SRS1 feedback
window.addEventListener('message', (event) => {
    if (event.data.type === 'srs1-save') {
        if (!activeEditingNodeId) return;
        const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
        if (!info) return;

        let payload = event.data.payload;
        
        if (info.node.jsonCollection && info.node.jsonCollection.trim() !== '') {
            const collectionName = info.node.jsonCollection.trim();
            const applyCollection = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) {
                    obj.forEach(applyCollection);
                } else {
                    if (obj.collectionTitle !== undefined) obj.collectionTitle = collectionName;
                    if (obj.courseName !== undefined) obj.courseName = collectionName;
                    Object.values(obj).forEach(applyCollection);
                }
            };
            applyCollection(payload);
        }

        const jsonStr = JSON.stringify(payload, null, 2);
        info.node.json = jsonStr;
        document.getElementById('ed-json').value = jsonStr;
        
        showToast("SRS1 Data Saved to Baseline", "success");
        saveWorkspace();
        renderTree();
    }
});

function setLatexSubtype(value, bypassUpdate = false) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;

    if (!bypassUpdate) {
        info.node.latexSubtype = value;
        saveWorkspace();
    }

    const pdfContainer = document.getElementById('document-pdf-container');
    const latexContainer = document.getElementById('document-latex-container');
    const typstContainer = document.getElementById('document-typst-container');

    if (pdfContainer) pdfContainer.style.display = value === 'pdf' ? 'block' : 'none';
    if (latexContainer) latexContainer.style.display = value === 'latex' ? 'block' : 'none';
    if (typstContainer) typstContainer.style.display = value === 'typst' ? 'block' : 'none';

    if (value === 'pdf') {
        if (info.node.latexFile) {
            document.getElementById('latex-file-active-area').style.display = 'flex';
            document.getElementById('attached-latex-file-name').innerText = info.node.latexFileName || 'Attached PDF';
            document.getElementById('latex-attach-btn').style.display = 'none';
            // Update preview
            document.getElementById('ed-latex-pdf-preview').src = `file://${encodeURI(resolvePath(info.node.latexFile))}#t=${new Date().getTime()}`;
        } else {
            document.getElementById('latex-file-active-area').style.display = 'none';
            document.getElementById('latex-attach-btn').style.display = 'inline-flex';
            document.getElementById('ed-latex-pdf-preview').src = '';
        }
    } else if (value === 'latex') {
        updateCompileUI();
    } else if (value === 'typst') {
        updateTypstCompileUI();
    }
}

function setAssetType(type, bypassUpdate = false) {
    if (!activeEditingNodeId) return;
    document.getElementById('asset-type-select').value = type;
    document.querySelectorAll('.field-group').forEach(el => { if (!el.classList.contains('meta')) el.classList.remove('active') });
    if (type !== 'empty') document.getElementById(`fg-${type}`).classList.add('active');
    if (!bypassUpdate) {
        const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
        if (info) {
            info.node.assetType = type;
            document.getElementById('ed-path-block').innerText = getPublishPath(activeEditingNodeId);
            
            if (type === 'latex') {
                const subtype = info.node.latexSubtype || (info.node.latexFile ? 'pdf' : (info.node.typst ? 'typst' : 'latex'));
                if (subtype === 'latex' && info.node.latex) executeLatexCompile(info.node.latex);
                else if (subtype === 'typst' && info.node.typst) executeTypstCompile(info.node.typst);
            }
            
            saveWorkspace();
        }
    }
}

function handleTitleInput(val) {
    if (!activeEditingNodeId) return; const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        info.node.title = val || 'Untitled'; renderTree();
        if (info.node.type === 'block') { document.getElementById('ed-path-block').innerText = getPublishPath(activeEditingNodeId); }
        else { document.getElementById('ed-path-folder').innerText = getPublishPath(activeEditingNodeId); renderTimeline(info.node); }
        saveWorkspace();
    }
}

function updateActiveNode(key, val) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        info.node[key] = val;
        saveWorkspace();
        // Refresh tree if content fields that affect "TO DO" state are changed
        const refreshFields = ['raw', 'html', 'latex', 'typst', 'json', 'link'];
        if (refreshFields.includes(key)) {
            renderTree();
        }
    }
}

async function handleSingleFile(file) {
    if (!file || !activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        const result = await window.electronAPI.managedCopy(file.path);
        if (result.success) {
            info.node.fileIdx = generateId(); // Trigger refresh
            info.node.file = result.fileName;
            info.node.fileFullPath = result.fileName;
            showEditor(activeEditingNodeId);
            await saveWorkspace();
        } else {
            showToast("Failed to collect file: " + result.error, "error");
        }
    }
}
function removeAttachedFile() {
    if (!activeEditingNodeId) return; const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) { info.node.file = null; info.node.fileFullPath = null; document.getElementById('ed-file-preview').removeAttribute('src'); showEditor(activeEditingNodeId); saveWorkspace(); }
}

function renderTimeline(node) {
    const container = document.getElementById('fd-timeline'); container.innerHTML = ''; if (!node.children) return;
    node.children.forEach(child => {
        const item = document.createElement('div'); item.className = 'timeline-item';
        const isBlock = child.type === 'block';
        item.innerHTML = `<div class="timeline-dot ${isBlock ? 'block' : 'folder'}"></div><div class="timeline-content" onclick="showEditor('${child.id}')"><div class="timeline-title">${child.title}</div><div style="font-size:0.8rem; color:#666;">${isBlock ? (child.assetType !== 'empty' ? child.assetType.toUpperCase() : 'Draft') : (child.children ? child.children.length + ' items' : 'Empty')}</div></div>`;
        container.appendChild(item);
    });
}

function togglePreviewMode(isActive) {
    const overlay = document.getElementById('preview-overlay');
    if (isActive) {
        const cls = getActiveClass();
        document.getElementById('prev-course-title').innerText = `${cls.title}`;
        buildPreviewSidebar(cls.nodes); document.getElementById('prev-page').innerHTML = `<div class="empty-state"><h3>Select module</h3></div>`;
        overlay.classList.add('active');
    } else { overlay.classList.remove('active'); }
}

function buildPreviewSidebar(nodes) {
    const sidebar = document.getElementById('prev-sidebar'); sidebar.innerHTML = '';
    const buildList = (nodesList, container) => {
        nodesList.forEach(n => {
            if (n.type === 'l1' || n.type === 'l2') {
                const folderHead = document.createElement('div'); folderHead.className = 'preview-nav-folder'; folderHead.innerText = n.title;
                folderHead.onclick = () => renderPreviewPage(n); folderHead.style.cursor = 'pointer'; container.appendChild(folderHead);
                if (n.children) { const childContainer = document.createElement('div'); buildList(n.children, childContainer); container.appendChild(childContainer); }
            } else if (n.type === 'block') {
                const item = document.createElement('div'); item.className = 'preview-nav-item'; item.innerText = `${n.title}`;
                item.onclick = () => renderPreviewPage(n); container.appendChild(item);
            }
        });
    };
    buildList(nodes, sidebar);
}

function renderPreviewPage(node) {
    const page = document.getElementById('prev-page'); document.querySelectorAll('.preview-nav-item, .preview-nav-folder').forEach(el => el.classList.remove('active'));
    let html = `<h1 style="font-size: 2.5rem; margin-bottom: 25px;">${node.title}</h1>`;
    if (node.objectives || node.description) html += `<div style="font-size: 1.1rem; line-height: 1.8; color: #334155; margin-bottom: 40px; white-space:pre-wrap;">${node.objectives || node.description}</div>`;

    // Default max-width for most modules
    page.style.maxWidth = '800px';

    if (node.type === 'block') {
        const t = node.assetType;
        if (t === 'raw' && node.raw) html += `<div style="background: #f8fafc; padding: 30px; border-radius: 8px; font-family: serif; font-size: 1.1rem; line-height: 1.8; color: #334155; white-space: pre-wrap; border: 1px solid #e2e8f0;">${node.raw}</div>`;
        else if (t === 'html' && node.html) {
            page.style.maxWidth = '1200px'; // Make HTML viewer wider
            html += `<iframe id="student-html-preview" style="width: 100%; height: 700px; border: 1px solid #e2e8f0; border-radius: 8px; background: white;"></iframe>`;
        }
        else if (t === 'latex') {
            const subtype = node.latexSubtype || (node.latexFile ? 'pdf' : (node.typst ? 'typst' : 'latex'));
            page.style.maxWidth = '1100px';

            if (subtype === 'pdf' && node.latexFile) {
                html += `<iframe src="file://${encodeURI(resolvePath(node.latexFile))}#t=${new Date().getTime()}" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: white;"></iframe>`;
            } else if (subtype === 'typst') {
                if (node.compiledTypstPath) {
                    html += `<iframe src="file://${encodeURI(resolvePath(node.compiledTypstPath))}#t=${new Date().getTime()}" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: white;"></iframe>`;
                } else {
                    const tempId = `simulator-typst-${node.id}`;
                    html += `<iframe id="${tempId}" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;"></iframe>`;
                    setTimeout(() => compileTypstInBackground(node, tempId), 100);
                }
            } else {
                if (node.compiledLatexPath) {
                    html += `<iframe src="file://${encodeURI(resolvePath(node.compiledLatexPath))}#t=${new Date().getTime()}" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: white;"></iframe>`;
                } else {
                    const tempId = `simulator-latex-${node.id}`;
                    html += `<iframe id="${tempId}" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;"></iframe>`;
                    setTimeout(() => compileLatexInBackground(node, tempId), 100);
                }
            }
        }
        else if (t === 'json') html += `<div style="background: #1e293b; color: #f8fafc; padding: 30px; border-radius: 8px; text-align: center; border: 1px solid #334155;"><div style="font-size: 3rem; margin-bottom: 15px;">📦</div><h3>Data Payload</h3><p style="color:#94a3b8; margin-bottom: 20px;">This is a data file for use in other app structures.</p><button type="button" class="btn btn-primary" onclick="alert('Simulation: Download triggered')">Download File</button></div>`;
        else if (t === 'file') {
            const safeExt = node.file ? node.file.toLowerCase().split('.').pop() : '';
            if (node.file && officeExtensions.includes(safeExt)) {
                page.style.maxWidth = 'none';
                page.style.width = '100%';
                page.style.margin = '0';
                const id = `prev-office-${node.id}`;
                html += `
                            <div id="${id}-container" class="office-preview-wrap" style="height: 800px; border: 1px solid #e2e8f0;">
                                <div class="office-preview-header">
                                    <span style="font-size: 0.8rem; font-weight: 700; color: #64748b;">Office Document Preview</span>
                                    <button type="button" class="btn btn-outline" style="padding: 4px 10px; font-size: 0.75rem; border-color: #cbd5e1; color: #0f172a;" onclick="window.electronAPI.openExternalFile(resolvePath('${node.fileFullPath.replace(/\\/g, '\\\\')}'))">Open in Native App</button>
                                </div>
                                <div class="preview-loading-overlay" id="${id}-loading">
                                    <div class="spinner"></div>
                                    <div class="loading-text">Generating Preview...</div>
                                </div>
                                <iframe id="${id}-iframe" class="office-preview-iframe"></iframe>
                            </div>
                        `;
                setTimeout(() => renderOfficePreview(resolvePath(node.fileFullPath), `${id}-iframe`, `${id}-loading`, `${id}-container`), 100);
            } else {
                html += `<div style="background: #f8fafc; color: #334155; padding: 30px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;"><div style="font-size: 3rem; margin-bottom: 15px;">📎</div><h3>File Attachment</h3><p style="color:#64748b; margin-bottom: 20px;">Download the attached file.</p><button type="button" class="btn btn-primary" onclick="window.electronAPI.openExternalFile(resolvePath('${node.fileFullPath ? node.fileFullPath.replace(/\\/g, '\\\\') : ''}'))">Open File</button></div>`;
            }
        }
        else if (t === 'link' && node.link) {
            let finalUrl = node.link.startsWith('http') ? node.link : 'https://' + node.link;
            html += `<iframe src="${finalUrl}" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: white;"></iframe>`;
        }
        else if (t === 'epub') {
            if (node.epubFileFullPath) {
                html += `<div id="student-epub-preview" style="width: 100%; height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa; position: relative;">
                            <div id="student-epub-area" style="width: 100%; height: 100%;"></div>
                            <div id="student-epub-prev" style="position: absolute; top:0; bottom:0; left:0; width:40px; background:rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:24px; color:#333;">‹</div>
                            <div id="student-epub-next" style="position: absolute; top:0; bottom:0; right:0; width:40px; background:rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:24px; color:#333;">›</div>
                        </div>`;
            } else {
                html += `<div style="padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; color: #64748b;">(No EPUB file attached)</div>`;
            }
        }
        else if (t === 'video') {
            if (node.videoFileFullPath) {
                html += `<video controls src="file://${encodeURI(resolvePath(node.videoFileFullPath))}#t=${new Date().getTime()}" style="width: 100%; max-height: 900px; border: 1px solid #e2e8f0; border-radius: 8px; background: #000;"></video>`;
            } else if (node.videoLink) {
                let embedUrl = node.videoLink;
                if (embedUrl.includes('youtube.com/watch?v=')) {
                    let videoId = embedUrl.split('watch?v=')[1].split('&')[0];
                    embedUrl = `https://www.youtube.com/embed/${videoId}`;
                } else if (embedUrl.includes('youtu.be/')) {
                    let videoId = embedUrl.split('youtu.be/')[1].split('?')[0];
                    embedUrl = `https://www.youtube.com/embed/${videoId}`;
                } else if (!embedUrl.startsWith('http')) {
                    embedUrl = 'https://' + embedUrl;
                }
                html += `<iframe src="${embedUrl}" style="width: 100%; height: 600px; border: 1px solid #e2e8f0; border-radius: 8px; background: #000;" allowfullscreen></iframe>`;
            } else {
                html += `<div style="padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; color: #64748b;">(No Video attached)</div>`;
            }
        }
    }
    if (node.type !== 'block' && node.children) {
        node.children.forEach(child => { html += `<div style="padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 15px; cursor:pointer;" onclick="renderPreviewPage(findNodeInfo('${child.id}', state.classes[activeClassId].nodes).node)"><strong>${child.title}</strong></div>`; });
    }
    page.innerHTML = html;
    if (node.type === 'block' && node.assetType === 'html' && node.html) document.getElementById('student-html-preview').srcdoc = node.html;
    if (node.type === 'block' && node.assetType === 'epub' && node.epubFileFullPath) {
        setTimeout(() => {
            try {
                let bk = ePub("file://" + encodeURI(resolvePath(node.epubFileFullPath)));
                let rd = bk.renderTo("student-epub-area", { width: "100%", height: "100%", spread: "none" });
                applyEpubStyles(rd, node);
                applyEpubHighlights(rd, node);
                rd.display();
                document.getElementById('student-epub-prev').onclick = () => rd.prev();
                document.getElementById('student-epub-next').onclick = () => rd.next();
            } catch (e) { }
        }, 100);
    }
}

function renderEmojiGrids() {
    const commonEmojis = ['💻', '🌐', '📚', '🚀', '🧠', '✍️', '🔬', '🎨', '📊', '🛠️', '💡', '📱', '🎮', '🧩', '🌎', '🧬', '⚙️', '🎵', '📐', '🗣️', '📝', '🏆', '⭐', '🎬'];
    const makeGrid = (targetId, inputId) => {
        const grid = document.getElementById(targetId);
        if (!grid) return;
        grid.innerHTML = commonEmojis.map(e => `<button type="button" class="emoji-btn" onclick="document.getElementById('${inputId}').value = '${e}'">${e}</button>`).join('');
    };
    makeGrid('new-c-emoji-grid', 'new-c-emoji');
    makeGrid('set-emoji-grid', 'set-emoji');
}

async function checkLatexEngine() {
    if (window.electronAPI && window.electronAPI.checkLatex) {
        const hasLatex = await window.electronAPI.checkLatex();
        if (!hasLatex) {
            document.getElementById('latex-missing-modal').classList.add('active');
        }
    }
}

function updateCompileUI() {
    const btn = document.getElementById('latex-manual-btn');
    if (autoCompileLatex) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'inline-flex';
    }
}

function scheduleLatexCompile(content) {
    if (!autoCompileLatex) return;
    const status = document.getElementById('latex-compile-status');
    status.innerText = 'Typing...';
    status.style.color = '#888';
    clearTimeout(latexCompileTimeout);
    latexCompileTimeout = setTimeout(() => {
        executeLatexCompile(content);
    }, 1500);
}

async function internalCompileLatex(nodeId, content) {
    if (window.electronAPI && window.electronAPI.compileLatex) {
        const info = findNodeInfo(nodeId, getActiveClass().nodes);
        const supportingFiles = [];
        if (info && info.node) {
            if (info.node.fileFullPath) supportingFiles.push(resolvePath(info.node.fileFullPath));
            if (info.node.videoFileFullPath) supportingFiles.push(resolvePath(info.node.videoFileFullPath));
            if (info.node.epubFileFullPath) supportingFiles.push(resolvePath(info.node.epubFileFullPath));
        }
        const result = await window.electronAPI.compileLatex(nodeId, content, supportingFiles);
        if (result && result.success && result.pdfPath) {
            // Permanently store the compiled PDF in managed storage with a unique name
            const timestamp = Date.now();
            const uniqueName = `compiled_${nodeId}_${timestamp}.pdf`;
            const moveRes = await window.electronAPI.managedCopy(result.pdfPath, uniqueName);
            if (moveRes.success) {
                info.node.compiledLatexPath = moveRes.fileName;
                await saveWorkspace();
                return { ...result, pdfPath: moveRes.fileName };
            }
        }
        // If managedCopy failed or we are in a state without nodeId, return the original result (potentially absolute path)
        return result;
    }
    return null;
}

async function compileLatexInBackground(node, iframeId) {
    const result = await internalCompileLatex(node.id, node.latex || '');
    if (result && result.success) {
        node.compiledLatexPath = result.pdfPath;
        const iframe = document.getElementById(iframeId);
        if (iframe) {
            iframe.src = `file://${encodeURI(resolvePath(result.pdfPath))}#t=${new Date().getTime()}`;
        }
    }
}

async function executeLatexCompile(content) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    const status = document.getElementById('latex-compile-status');

    if (info && info.node.latexFile) {
        status.innerText = '✓ PDF Attached';
        status.style.color = 'var(--success)';
        const iframe = document.getElementById('ed-latex-preview');
        iframe.removeAttribute('srcdoc');
        iframe.src = `file://${encodeURI(resolvePath(info.node.latexFile))}#t=${new Date().getTime()}`;
        return;
    }

    status.innerText = 'Compiling...';
    status.style.color = 'var(--warning)';

    console.log(`[Renderer] Triggering LaTeX compile for node ${activeEditingNodeId}...`);
    const result = await internalCompileLatex(activeEditingNodeId, content);
    console.log(`[Renderer] Compile Result:`, result);

    if (result && result.success) {
        status.innerText = '✓ Ready';
        status.style.color = 'var(--success)';

        info.node.compiledLatexPath = result.pdfPath;

        const iframe = document.getElementById('ed-latex-preview');
        iframe.removeAttribute('srcdoc');
        iframe.src = `file://${encodeURI(resolvePath(result.pdfPath))}#t=${new Date().getTime()}`;
    } else if (result) {
        status.innerText = '✕ Error';
        status.style.color = 'var(--danger)';
        console.error(`[Renderer] LaTeX Compilation Failed:`, result.error || 'Check logs', result.log);

        const errorLog = result.log || result.error || 'Check system logs for details.';
        // Escape the log to prevent HTML breakage
        const safeLog = errorLog.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        openConfirmModal("LaTeX Compilation Failed",
            `<div style="text-align:left; background:#1a1a1a; color:#f8f8f2; padding:20px; border-radius:12px; font-family:'Menlo', 'Monaco', 'Courier New', monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; border: 1px solid #333; margin: 10px 0;">${safeLog}</div>`,
            null, // This is an alert, no confirm callback needed
            true, // isLarge
            "Got it" // okText
        );
    } else {
        // Simulation Mode
        setTimeout(() => {
            status.innerText = '✓ Ready (Simulated)';
            status.style.color = 'var(--success)';
            const iframe = document.getElementById('ed-latex-preview');
            iframe.srcdoc = `<html style="background:#333; color:white; font-family:sans-serif; text-align:center; display:flex; flex-direction:column; justify-content:center; height:100%; margin:0;"><body><div style="font-size:2rem; margin-bottom:10px;">📄</div><div style="color:#aaa; margin-bottom: 5px;">PDF Draft Render</div></body></html>`;
        }, 1200);
    }
}

async function checkTypstEngine() {
    if (window.electronAPI && window.electronAPI.checkTypst) {
        const hasTypst = await window.electronAPI.checkTypst();
        if (!hasTypst) {
            document.getElementById('typst-missing-modal').classList.add('active');
        }
    }
}

function updateTypstCompileUI() {
    const btn = document.getElementById('typst-manual-btn');
    if (autoCompileTypst) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'inline-flex';
    }
}

function scheduleTypstCompile(content) {
    if (!autoCompileTypst) return;
    const status = document.getElementById('typst-compile-status');
    status.innerText = 'Typing...';
    status.style.color = '#888';
    clearTimeout(typstCompileTimeout);
    typstCompileTimeout = setTimeout(() => {
        executeTypstCompile(content);
    }, 1500);
}

async function internalCompileTypst(nodeId, content) {
    if (window.electronAPI && window.electronAPI.compileTypst) {
        const info = findNodeInfo(nodeId, getActiveClass().nodes);
        const supportingFiles = [];
        if (info && info.node) {
            if (info.node.fileFullPath) supportingFiles.push(resolvePath(info.node.fileFullPath));
            if (info.node.videoFileFullPath) supportingFiles.push(resolvePath(info.node.videoFileFullPath));
            if (info.node.epubFileFullPath) supportingFiles.push(resolvePath(info.node.epubFileFullPath));
        }
        const result = await window.electronAPI.compileTypst(nodeId, content, supportingFiles);
        if (result && result.success && result.pdfPath) {
            const timestamp = Date.now();
            const uniqueName = `compiled_typst_${nodeId}_${timestamp}.pdf`;
            const moveRes = await window.electronAPI.managedCopy(result.pdfPath, uniqueName);
            if (moveRes.success) {
                info.node.compiledTypstPath = moveRes.fileName;
                await saveWorkspace();
                return { ...result, pdfPath: moveRes.fileName };
            }
        }
        return result;
    }
    return null;
}

async function compileTypstInBackground(node, iframeId) {
    const result = await internalCompileTypst(node.id, node.typst || '');
    if (result && result.success) {
        node.compiledTypstPath = result.pdfPath;
        const iframe = document.getElementById(iframeId);
        if (iframe) {
            iframe.src = `file://${encodeURI(resolvePath(result.pdfPath))}#t=${new Date().getTime()}`;
        }
    }
}

async function executeTypstCompile(content) {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    const status = document.getElementById('typst-compile-status');

    status.innerText = 'Compiling...';
    status.style.color = 'var(--warning)';

    console.log(`[Renderer] Triggering Typst compile for node ${activeEditingNodeId}...`);
    const result = await internalCompileTypst(activeEditingNodeId, content);
    console.log(`[Renderer] Compile Result:`, result);

    if (result && result.success) {
        status.innerText = '✓ Ready';
        status.style.color = 'var(--success)';

        info.node.compiledTypstPath = result.pdfPath;

        const iframe = document.getElementById('ed-typst-preview');
        iframe.removeAttribute('srcdoc');
        iframe.src = `file://${encodeURI(resolvePath(result.pdfPath))}#t=${new Date().getTime()}`;
    } else if (result) {
        status.innerText = '✕ Error';
        status.style.color = 'var(--danger)';
        console.error(`[Renderer] Typst Compilation Failed:`, result.error || 'Check logs', result.log);

        const errorLog = result.log || result.error || 'Check system logs for details.';
        const safeLog = errorLog.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        openConfirmModal("Typst Compilation Failed",
            `<div style="text-align:left; background:#1a1a1a; color:#f8f8f2; padding:20px; border-radius:12px; font-family:'Menlo', 'Monaco', 'Courier New', monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; border: 1px solid #333; margin: 10px 0;">${safeLog}</div>`,
            null,
            true,
            "Got it"
        );
    } else {
        setTimeout(() => {
            status.innerText = '✓ Ready (Simulated)';
            status.style.color = 'var(--success)';
            const iframe = document.getElementById('ed-typst-preview');
            iframe.srcdoc = `<html style="background:#333; color:white; font-family:sans-serif; text-align:center; display:flex; flex-direction:column; justify-content:center; height:100%; margin:0;"><body><div style="font-size:2rem; margin-bottom:10px;">📄</div><div style="color:#aaa; margin-bottom: 5px;">Typst Draft Render</div></body></html>`;
        }, 1200);
    }
}

async function handleLatexFile(file) {
    if (!file || !activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        const result = await window.electronAPI.managedCopy(file.path);
        if (result.success) {
            info.node.latexFile = result.fileName;
            info.node.latexFileName = result.fileName;
            await saveWorkspace();
            showEditor(activeEditingNodeId);
        } else {
            showToast("Failed to collect PDF: " + result.error, "error");
        }
    }
}

function removeLatexFile() {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info) {
        info.node.latexFile = null;
        info.node.latexFileName = null;
        saveWorkspace();
        showEditor(activeEditingNodeId);
    }
}

function sanitizeImportData(node) {
    const textFields = ['description', 'raw', 'html', 'latex', 'json', 'objectives'];
    textFields.forEach(field => {
        if (Array.isArray(node[field])) {
            node[field] = node[field].join('\n');
        }
    });
    if (node.classes && Array.isArray(node.classes)) {
        node.classes.forEach(sanitizeImportData);
    }
    if (node.nodes && Array.isArray(node.nodes)) {
        node.nodes.forEach(sanitizeImportData);
    }
    if (node.children && Array.isArray(node.children)) {
        node.children.forEach(sanitizeImportData);
    }
    return node;
}

function openImportModal(target, nodeId = null) {
    currentImportTarget = target; currentImportNodeId = nodeId;
    document.getElementById('ui-modal-title').innerText = target === 'workspace' ? 'Restore Full Workspace' : (target === 'course' ? 'Import Course' : 'Inject Data payload');
    document.getElementById('ui-modal-textarea').value = '';
    document.getElementById('universal-import-modal').classList.add('active');
}

function closeImportModal() {
    document.getElementById('universal-import-modal').classList.remove('active');
    currentImportTarget = null; currentImportNodeId = null; document.getElementById('ui-file-input').value = '';
}

function handleUIFileInput(event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (e) => { executeImportData(e.target.result); }; reader.readAsText(file);
}

function processTextareaImport() { executeImportData(document.getElementById('ui-modal-textarea').value); }

function executeImportData(rawString) {
    let healedData = healJSON(rawString);
    if (!healedData) { showToast("Invalid format", "error"); return; }

    if (Array.isArray(healedData)) {
        healedData.forEach(sanitizeImportData);
    } else {
        sanitizeImportData(healedData);
    }

    if (currentImportTarget === 'workspace') {
        if (healedData.classes) { state = healedData; renderWelcomeScreen(); closeImportModal(); saveWorkspace(); showToast('Workspace Restored', 'success'); }
    } else if (currentImportTarget === 'course') {
        if (healedData.title && healedData.nodes) { healedData.id = generateId(); state.classes.push(healedData); renderWelcomeScreen(); closeImportModal(); saveWorkspace(); showToast(`Imported ${healedData.title}`, 'success'); }
    } else if (currentImportTarget === 'node') {
        pendingImportData = Array.isArray(healedData) ? healedData : [healedData];
        let bCount = 0, fCount = 0;
        const countItems = (arr) => { arr.forEach(n => { if (n.type === 'block') bCount++; else fCount++; if (n.children) countItems(n.children); }); };
        countItems(pendingImportData);
        document.getElementById('staging-stats').innerText = `${fCount} Folders | ${bCount} Activities`;
        document.getElementById('universal-import-modal').classList.remove('active');
        document.getElementById('import-staging-modal').classList.add('active');
    }
}

function confirmNodeImport() {
    const info = findNodeInfo(currentImportNodeId, getActiveClass().nodes);
    if (info && pendingImportData) {
        const deepCopyRefresh = (node) => { const copy = JSON.parse(JSON.stringify(node)); copy.id = generateId(); if (copy.children) copy.children = copy.children.map(c => deepCopyRefresh(c)); return copy; };
        const refreshedData = pendingImportData.map(n => deepCopyRefresh(n));
        if (info.node.type !== 'block') { info.node.children.push(...refreshedData); info.node.collapsed = false; }
        else { info.array.splice(info.index, 0, ...refreshedData); }
        renderTree(); saveWorkspace(); showToast("Injection Complete", "success");
    } closeStaging();
}

function closeStaging() { document.getElementById('import-staging-modal').classList.remove('active'); pendingImportData = null; }

function exportBackup() {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
    a.download = `curriculumos_backup_${new Date().getTime()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); showToast('Backup triggered', 'success');
}

function openExportModal() {
    const cls = getActiveClass(); const scopeSelect = document.getElementById('export-scope'); scopeSelect.innerHTML = `<option value="all">Entire Course Hierarchy</option>`;
    const addScopeOptions = (nodes, depthStr) => { nodes.forEach(n => { if (n.type !== 'block') { scopeSelect.innerHTML += `<option value="${n.id}">${depthStr} ${n.title}</option>`; if (n.children) addScopeOptions(n.children, depthStr + '- '); } }); };
    addScopeOptions(cls.nodes, ''); document.getElementById('export-modal').classList.add('active');
}

function executeExport() { document.getElementById('export-modal').classList.remove('active'); showToast('Job compiled', 'success'); }

function renderWelcomeScreen() {
    const container = document.getElementById('class-cards-container'); container.innerHTML = '';
    state.classes.forEach(cls => {
        const card = document.createElement('div'); card.className = 'class-card'; card.style.setProperty('--card-color', cls.color);
        card.onclick = () => openClass(cls.id, true);
        card.innerHTML = `<div class="class-emoji">${cls.emoji}</div><h3 class="class-title">${cls.title}</h3>`;
        container.appendChild(card);
    });
    const addCard = document.createElement('div'); addCard.className = 'class-card add-course-card'; addCard.onclick = () => document.getElementById('course-modal').classList.add('active');
    addCard.innerHTML = `<div style="font-size: 2rem; color: var(--text-muted); margin-bottom: 5px;">+</div><h3 class="class-title" style="color: var(--text-muted);">New Environment</h3>`;
    container.appendChild(addCard);
}

function createCourse() {
    const title = document.getElementById('new-c-title').value || 'New Course'; const emoji = document.getElementById('new-c-emoji').value || '📁'; const color = document.getElementById('new-c-color').value || '#8b5cf6';
    state.classes.push({ id: generateId(), title: title, emoji: emoji, color: color, labels: { l1: 'Unit', l2: 'Folder' }, nodes: [], collapsed: false, seatingChart: { students: {}, objects: [] } });
    document.getElementById('new-c-title').value = ''; document.getElementById('course-modal').classList.remove('active');
    renderWelcomeScreen(); saveWorkspace(); showToast('Environment generated', 'success');
}

function deleteCurrentCourse() {
    const cls = getActiveClass();
    if (!cls) return;
    openConfirmModal("Delete Course", `Permanently delete "${cls.title}" and all its activities? This action cannot be undone.`, () => {
        state.classes = state.classes.filter(c => c.id !== activeClassId);
        goHome();
        saveWorkspace();
        showToast('Course deleted', 'success');
    });
}

function openClass(id, fromDashboard = false) {
    activeClassId = id; 
    document.getElementById('welcome-screen').style.display = 'none'; 
    document.getElementById('workspace').classList.add('active');
    
    if (fromDashboard) {
        state.classes.forEach(cls => {
            if (cls.id === id) {
                cls.collapsed = false;
                // Spotlight: Expand Units (l1), Collapse Folders/Weeks (l2)
                if (cls.nodes) {
                    cls.nodes.forEach(node => {
                        if (node.type === 'l1') {
                            node.collapsed = false; 
                            if (node.children) {
                                node.children.forEach(child => {
                                    if (child.type === 'l2') child.collapsed = true;
                                });
                            }
                        } else if (node.type === 'l2') {
                            node.collapsed = true;
                        }
                    });
                }
            } else {
                cls.collapsed = true;
            }
        });
    } else {
        const cls = state.classes.find(c => c.id === id);
        if (cls) cls.collapsed = false;
    }

    renderTree(); 
    showEditor(null);
    saveWorkspace();
}

function goHome() { document.getElementById('workspace').classList.remove('active'); document.getElementById('welcome-screen').style.display = 'flex'; renderWelcomeScreen(); activeClassId = null; }

function openSettings() {
    const cls = getActiveClass(); document.getElementById('set-title').value = cls.title; document.getElementById('set-emoji').value = cls.emoji; document.getElementById('set-color').value = cls.color; document.getElementById('set-l1').value = cls.labels.l1; document.getElementById('set-l2').value = cls.labels.l2; document.getElementById('settings-modal').classList.add('active');
}
function closeSettings() { document.getElementById('settings-modal').classList.remove('active'); }
function saveSettings() {
    const cls = getActiveClass(); cls.title = document.getElementById('set-title').value || 'Env'; cls.emoji = document.getElementById('set-emoji').value || '📁'; cls.color = document.getElementById('set-color').value || '#8b5cf6'; cls.labels.l1 = document.getElementById('set-l1').value || 'L1'; cls.labels.l2 = document.getElementById('set-l2').value || 'L2';
    renderTree(); closeSettings(); saveWorkspace(); showToast('Config applied', 'success');
}

function findNodeInfo(id, nodes, parent = null, index = -1) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { node: nodes[i], array: nodes, index: i, parent: parent };
        if (nodes[i].children) { const res = findNodeInfo(id, nodes[i].children, nodes[i], i); if (res) return res; }
    } return null;
}

function collapseAll() {
    state.classes.forEach(cls => {
        cls.collapsed = true;
        if (cls.nodes) {
            cls.nodes.forEach(node => {
                if (node.type !== 'block') {
                    node.collapsed = true;
                    collapseDescendants(node);
                }
            });
        }
    });
    renderTree();
    saveWorkspace();
    showToast("All collapsed", "info");
}

function collapseDescendants(node) {
    if (node.children) {
        node.children.forEach(child => {
            if (child.type !== 'block') {
                child.collapsed = true;
                collapseDescendants(child);
            }
        });
    }
}

function renderTree() {
    const container = document.getElementById('tree-container'); container.innerHTML = '';
    state.classes.forEach(cls => {
        const isActiveClass = cls.id === activeClassId;
        const classWrapper = document.createElement('div'); classWrapper.className = 'tree-node-wrapper';
        const classDiv = document.createElement('div');
        classDiv.className = `tree-node ${isActiveClass && !activeEditingNodeId ? 'active' : ''}`;
        classDiv.style.fontWeight = 'bold'; classDiv.style.fontSize = '1.05rem'; classDiv.style.paddingTop = '12px'; classDiv.style.paddingBottom = '12px'; classDiv.style.borderBottom = '1px solid #111'; classDiv.style.marginBottom = '5px'; classDiv.style.color = isActiveClass ? 'var(--text-light)' : '#888';

        classDiv.onclick = (e) => { e.stopPropagation(); openClass(cls.id, false); };

        const toggleDiv = document.createElement('div');
        toggleDiv.className = `node-toggle ${cls.collapsed ? 'collapsed' : ''}`;
        toggleDiv.innerHTML = '▼';
        toggleDiv.onclick = (e) => {
            e.stopPropagation();
            cls.collapsed = !cls.collapsed;
            if (cls.collapsed && cls.nodes) {
                cls.nodes.forEach(node => {
                    if (node.type !== 'block') {
                        node.collapsed = true;
                        collapseDescendants(node);
                    }
                });
            }
            renderTree();
            saveWorkspace();
        };

        classDiv.innerHTML = `<div class="node-icon">${cls.emoji}</div><div class="node-title-display" style="opacity: ${isActiveClass ? '1' : '0.6'}">${cls.title}</div><div class="node-actions"><button type="button" class="btn-ghost" title="New Unit" onclick="event.stopPropagation(); addNode('root', 'l1', '${cls.id}')">+ Unit</button></div>`;
        
        // Enable dropping onto class headers
        classDiv.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'move'; 
            classDiv.classList.add('drag-over'); 
        });
        classDiv.addEventListener('dragleave', () => classDiv.classList.remove('drag-over'));
        classDiv.addEventListener('drop', (e) => { 
            e.preventDefault(); 
            classDiv.classList.remove('drag-over'); 
            if (draggedNodeId) handleClassDrop(draggedNodeId, cls.id); 
        });

        classDiv.prepend(toggleDiv);
        classWrapper.appendChild(classDiv);

        if (!cls.collapsed) {
            const childrenDiv = document.createElement('div'); childrenDiv.className = 'tree-children'; childrenDiv.style.marginLeft = '10px'; childrenDiv.style.paddingLeft = '10px'; childrenDiv.style.borderLeft = '1px solid #333';
            if (cls.nodes) cls.nodes.forEach(node => childrenDiv.appendChild(createTreeNodeDOM(node)));
            classWrapper.appendChild(childrenDiv);
        }
        container.appendChild(classWrapper);
    });
}

function createTreeNodeDOM(node) {
    const cls = getActiveClass();
    const wrapper = document.createElement('div'); wrapper.className = 'tree-node-wrapper';
    const nodeDiv = document.createElement('div'); nodeDiv.className = `tree-node ${activeEditingNodeId === node.id ? 'active' : ''}`;
    nodeDiv.setAttribute('draggable', 'true'); nodeDiv.dataset.id = node.id;

    nodeDiv.addEventListener('dragstart', (e) => {
        draggedNodeId = node.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id);
        const ghost = nodeDiv.cloneNode(true); ghost.style.opacity = '0.8'; ghost.style.background = '#222'; ghost.style.position = 'absolute'; ghost.style.top = '-1000px'; document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(() => { nodeDiv.style.opacity = '0.3'; ghost.remove(); }, 0);
    });
    nodeDiv.addEventListener('dragend', () => { 
        draggedNodeId = null; 
        nodeDiv.style.opacity = '1'; 
        document.querySelectorAll('.tree-node').forEach(el => el.classList.remove('drag-over', 'drag-before', 'drag-after', 'drag-into')); 
    });
    nodeDiv.addEventListener('dragover', (e) => { 
        e.preventDefault(); 
        e.dataTransfer.dropEffect = 'move'; 
        if (draggedNodeId === node.id) return;
        
        const rect = nodeDiv.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const height = rect.height;

        nodeDiv.classList.remove('drag-before', 'drag-after', 'drag-into', 'drag-over');

        if (node.type === 'block') {
            if (relY < height / 2) {
                nodeDiv.classList.add('drag-before');
                nodeDiv.dataset.dropPos = 'before';
            } else {
                nodeDiv.classList.add('drag-after');
                nodeDiv.dataset.dropPos = 'after';
            }
        } else {
            if (relY < height * 0.25) {
                nodeDiv.classList.add('drag-before');
                nodeDiv.dataset.dropPos = 'before';
            } else if (relY > height * 0.75) {
                nodeDiv.classList.add('drag-after');
                nodeDiv.dataset.dropPos = 'after';
            } else {
                nodeDiv.classList.add('drag-into');
                nodeDiv.dataset.dropPos = 'into';
            }
        }
    });
    nodeDiv.addEventListener('dragleave', () => nodeDiv.classList.remove('drag-over', 'drag-before', 'drag-after', 'drag-into'));
    nodeDiv.addEventListener('drop', (e) => { 
        e.preventDefault(); 
        const dropPos = nodeDiv.dataset.dropPos || 'into';
        nodeDiv.classList.remove('drag-over', 'drag-before', 'drag-after', 'drag-into'); 
        if (draggedNodeId) handleDrop(draggedNodeId, node.id, dropPos); 
    });
    nodeDiv.onclick = (e) => { e.stopPropagation(); showEditor(node.id); };

    let icon = '<span style="color:#ffffff;">◼</span>';
    let todoHtml = '';
    if (node.type === 'block') {
        const typeMap = { 'html': '#3b82f6', 'raw': '#a8a29e', 'latex': '#eab308', 'json': '#10b981', 'link': '#8b5cf6', 'file': '#f43f5e', 'video': '#ec4899', 'epub': '#f97316' };
        const c = typeMap[node.assetType] || '#888888';
        icon = `<span style="color:${c}; font-size:1.4rem; line-height:1;">●</span>`;

        if (!isNodeFilled(node)) {
            todoHtml = `<span class="todo-tag" style="color: var(--danger, #ef4444); border: 1px solid currentColor; font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; margin-left: 8px; font-weight: 800; letter-spacing: 0.05em; line-height: 1; display: inline-flex; align-items: center; justify-content: center; height: 16px;">TO DO</span>`;
        }
    } else { icon = node.type === 'l1' ? '<span style="font-size:1.1rem; vertical-align:middle;">📚</span>' : '<span style="font-size:1.1rem; vertical-align:middle;">📁</span>'; }

    const toggleDiv = document.createElement('div'); toggleDiv.className = `node-toggle ${node.type === 'block' ? 'empty' : ''} ${node.collapsed ? 'collapsed' : ''}`; toggleDiv.innerHTML = '▼';
    toggleDiv.onclick = (e) => {
        e.stopPropagation();
        node.collapsed = !node.collapsed;
        if (node.collapsed) {
            collapseDescendants(node);
        }
        renderTree();
        saveWorkspace();
    };

    let actionsHtml = '';
    if (node.type === 'l1') actionsHtml = `<button type="button" class="btn-ghost" onclick="event.stopPropagation(); openImportModal('node', '${node.id}')">📥</button><button type="button" class="btn-ghost" onclick="event.stopPropagation(); addNode('${node.id}', 'l2')">+📁</button><button type="button" class="btn-ghost" onclick="event.stopPropagation(); addNode('${node.id}', 'block')">+📄</button>`;
    else if (node.type === 'l2') actionsHtml = `<button type="button" class="btn-ghost" onclick="event.stopPropagation(); openImportModal('node', '${node.id}')">📥</button><button type="button" class="btn-ghost" onclick="event.stopPropagation(); addNode('${node.id}', 'block')">+📄</button>`;

    nodeDiv.innerHTML = `<div class="node-icon">${icon}</div><div class="node-title-display" style="display: flex; align-items: center;">${node.title}${todoHtml}</div><div class="node-actions">${actionsHtml}<button type="button" class="btn-ghost" title="Duplicate Empty" onclick="event.stopPropagation(); duplicateEmptyNode('${node.id}')">📑</button><button type="button" class="btn-ghost" title="Duplicate" onclick="event.stopPropagation(); duplicateNode('${node.id}')">⧉</button><button type="button" class="btn-ghost" style="color:var(--danger);" onclick="event.stopPropagation(); deleteNode('${node.id}')">✕</button></div>`;
    nodeDiv.prepend(toggleDiv); wrapper.appendChild(nodeDiv);

    if (node.type !== 'block') {
        const childrenDiv = document.createElement('div'); childrenDiv.className = 'tree-children';
        if (node.collapsed) childrenDiv.style.display = 'none';
        if (node.children) node.children.forEach(child => childrenDiv.appendChild(createTreeNodeDOM(child)));
        wrapper.appendChild(childrenDiv);
    }
    return wrapper;
}

function handleDrop(draggedId, targetId, position = 'into') {
    if (draggedId === targetId) return;
    
    let draggedInfo = null;
    let targetInfo = null;
    let targetClass = null;

    for (const cls of state.classes) {
        if (!draggedInfo) {
            const info = findNodeInfo(draggedId, cls.nodes);
            if (info) draggedInfo = info;
        }
        if (!targetInfo) {
            const info = findNodeInfo(targetId, cls.nodes);
            if (info) {
                targetInfo = info;
                targetClass = cls;
            }
        }
        if (draggedInfo && targetInfo) break;
    }

    if (!draggedInfo || !targetInfo) return;

    // Prevention: dragging a node into its own descendant
    let current = targetInfo.parent;
    while (current) {
        if (current.id === draggedId) return;
        const parentInfo = findNodeInfo(current.id, targetClass.nodes);
        current = parentInfo ? parentInfo.parent : null;
    }

    // Move the node
    const nodeToMove = draggedInfo.array.splice(draggedInfo.index, 1)[0];
    
    // Re-find target because splice might have shifted indices
    const updatedTargetInfo = findNodeInfo(targetId, targetClass.nodes);
    
    if (position === 'into' && updatedTargetInfo.node.type !== 'block') {
        updatedTargetInfo.node.children.push(nodeToMove);
        updatedTargetInfo.node.collapsed = false;
    } else if (position === 'before') {
        updatedTargetInfo.array.splice(updatedTargetInfo.index, 0, nodeToMove);
    } else {
        // after
        updatedTargetInfo.array.splice(updatedTargetInfo.index + 1, 0, nodeToMove);
    }
    
    renderTree();
    saveWorkspace();
}

function handleClassDrop(draggedId, targetClassId) {
    let draggedInfo = null;
    for (const cls of state.classes) {
        const info = findNodeInfo(draggedId, cls.nodes);
        if (info) {
            draggedInfo = info;
            break;
        }
    }

    if (!draggedInfo) return;
    
    const targetClass = state.classes.find(c => c.id === targetClassId);
    if (!targetClass) return;

    // Move to root of target class
    const nodeToMove = draggedInfo.array.splice(draggedInfo.index, 1)[0];
    targetClass.nodes.push(nodeToMove);
    targetClass.collapsed = false;

    renderTree();
    saveWorkspace();
}

function addNode(parentId, type, classId = null) {
    const cls = classId ? state.classes.find(c => c.id === classId) : getActiveClass();
    if (!cls) return;
    activeClassId = cls.id; // Ensure the class becomes active if we're adding to it
    
    let typeName = type === 'block' ? 'Activity' : (type === 'l1' ? cls.labels.l1 : cls.labels.l2);
    const newNode = { id: generateId(), type: type, title: `New ${typeName}`, collapsed: false, children: [], description: '', assetType: 'empty', raw: '', latex: '', html: '', json: '', link: '', file: null, videoLink: '', videoFile: null, epubFile: null, epubFontSize: 100, epubMargin: 40, epubLineHeight: 1.5, epubParagraphSpacing: 1.0, epubHighlights: [] };
    if (parentId === 'root') cls.nodes.push(newNode);
    else { const info = findNodeInfo(parentId, cls.nodes); if (info) { info.node.children.push(newNode); info.node.collapsed = false; } }
    renderTree(); showEditor(newNode.id);
    saveWorkspace();
}

function duplicateNode(id) {
    try {
        const cls = getActiveClass(); 
        const info = findNodeInfo(id, cls.nodes);
        if (!info) {
            console.error("Node not found for duplication:", id);
            return;
        }

        const newNode = JSON.parse(JSON.stringify(info.node));
        
        const finalizeClone = (node, isRoot = false) => {
            node.id = generateId();
            if (isRoot) node.title += " (Copy)";
            if (node.children) node.children.forEach(c => finalizeClone(c));
        };

        finalizeClone(newNode, true);
        info.array.splice(info.index + 1, 0, newNode);
        
        renderTree();
        saveWorkspace();
        showToast("✅ Item duplicated");
    } catch (err) {
        console.error("Duplication failed:", err);
        showToast("❌ Duplication failed: " + err.message, 'danger');
    }
}

function duplicateEmptyNode(id) {
    try {
        const cls = getActiveClass(); 
        const info = findNodeInfo(id, cls.nodes);
        if (!info) {
            console.error("Node not found for duplication:", id);
            return;
        }

        const newNode = JSON.parse(JSON.stringify(info.node));
        
        const finalizeEmptyClone = (node, isRoot = false) => {
            node.id = generateId();
            if (isRoot) node.title += " (Template)";
            
            if (node.type === 'block') {
                node.raw = ''; node.html = ''; node.latex = ''; node.typst = ''; node.latexFile = null; node.latexFileName = null; node.compiledLatexPath = null; node.compiledTypstPath = null; node.json = ''; node.link = ''; node.file = null; node.fileFullPath = null; node.videoLink = ''; node.videoFile = null; node.videoFileFullPath = null; node.epubFile = null; node.epubFileFullPath = null; node.epubFontSize = 100; node.epubMargin = 40; node.epubLineHeight = 1.5; node.epubParagraphSpacing = 1.0; node.epubHighlights = []; node.description = '';
            } else {
                node.objectives = '';
            }
            
            if (node.children) node.children.forEach(c => finalizeEmptyClone(c));
        };

        finalizeEmptyClone(newNode, true);
        info.array.splice(info.index + 1, 0, newNode);
        
        renderTree();
        saveWorkspace();
        showToast("✅ Template created");
    } catch (err) {
        console.error("Duplicate empty failed:", err);
        showToast("❌ Duplication failed: " + err.message, 'danger');
    }
}

function deleteNode(id) {
    const info = findNodeInfo(id, getActiveClass().nodes);
    if (info) {
        openConfirmModal("Delete Item", `Are you sure you want to delete "${info.node.title}"? This cannot be undone.`, () => {
            info.array.splice(info.index, 1);
            if (activeEditingNodeId === id) showEditor(null);
            renderTree();
            saveWorkspace();
        });
    }
}

document.addEventListener('keydown', (e) => {
    if (!activeClassId) return; // Only process if in workspace
    // Don't intercept if user is typing in an input or textarea
    const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT');
    if (isTyping) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nodes = Array.from(document.querySelectorAll('.tree-node'));
        if (nodes.length === 0) return;

        let currentIndex = nodes.findIndex(node => node.classList.contains('active'));

        let newIndex = currentIndex;
        if (e.key === 'ArrowDown') {
            newIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, nodes.length - 1);
        } else if (e.key === 'ArrowUp') {
            newIndex = Math.max(currentIndex - 1, 0);
        }

        if (newIndex !== currentIndex && newIndex >= 0 && newIndex < nodes.length) {
            const targetNode = nodes[newIndex];
            targetNode.click();
            targetNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
});

// --- Boot Routine ---
initStorage().then(() => {
    renderWelcomeScreen();
    renderEmojiGrids();
    checkLatexEngine();
    checkTypstEngine();
    loadTheme();
});

let presentationSequence = [];
let presentationCurrentIndex = -1;
let isPresentationActive = false;

function getPresentationSequence(nodes) {
    let seq = [];
    nodes.forEach(n => {
        if (n.type === 'block') seq.push(n);
        else if (n.children) seq = seq.concat(getPresentationSequence(n.children));
    });
    return seq;
}

function openPresentationMode(startNodeId) {
    const cls = getActiveClass();
    if (!cls) return;
    presentationSequence = getPresentationSequence(cls.nodes);
    if (presentationSequence.length === 0) {
        showToast("No activities to present.", "warning");
        return;
    }
    if (startNodeId) {
        const idx = presentationSequence.findIndex(n => n.id === startNodeId);
        presentationCurrentIndex = idx !== -1 ? idx : 0;
    } else {
        presentationCurrentIndex = 0;
    }

    isPresentationActive = true;
    const overlay = document.getElementById('presentation-overlay');
    overlay.classList.add('active');
    overlay.focus();

    try { overlay.requestFullscreen(); } catch (e) { }

    window.addEventListener('resize', scalePresentationFrame);

    renderPresentationNode();
}

function closePresentationMode() {
    isPresentationActive = false;
    document.getElementById('presentation-overlay').classList.remove('active');
    document.getElementById('presentation-content').innerHTML = '';
    
    const stickyContainer = document.getElementById('presentation-sticky-container');
    if (stickyContainer) stickyContainer.innerHTML = '';
    
    const timerContainer = document.getElementById('presentation-timer-container');
    if (timerContainer) timerContainer.innerHTML = '';
    if (presentationTimerInterval) clearInterval(presentationTimerInterval);

    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { }

    window.removeEventListener('resize', scalePresentationFrame);
}

function navigatePresentation(direction) {
    if (!isPresentationActive) return;
    const newIndex = presentationCurrentIndex + direction;
    if (newIndex >= 0 && newIndex < presentationSequence.length) {
        presentationCurrentIndex = newIndex;
        renderPresentationNode();
    } else if (newIndex >= presentationSequence.length) {
        showToast("End of presentation.", "info");
    }
}

document.addEventListener('keydown', (e) => {
    if (!isPresentationActive) return;

    const isTyping = document.activeElement && document.activeElement.tagName === 'TEXTAREA';

    if (e.key === ';') {
        e.preventDefault();
        createPresentationStickyNote();
        return;
    }

    if (e.key === '[') {
        e.preventDefault();
        togglePresentationTimer();
        return;
    }

    if (isTyping) return; // Prevent navigation while typing in a sticky note

    if (e.key === 'ArrowRight' || e.key === 'Space') navigatePresentation(1);
    else if (e.key === 'ArrowLeft') navigatePresentation(-1);
    else if (e.key === 'Escape') closePresentationMode();
});

// Register Global Presentation Shortcuts (via Main Process)
if (window.electronAPI && window.electronAPI.onPresentationKeydown) {
    window.electronAPI.onPresentationKeydown((data) => {
        if (!isPresentationActive) return;

        // Check if user is typing in a textarea or input in the MAIN document
        // We allow shortcuts if the focus is on the overlay itself or an iframe
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        const isTypingInMain = activeTag === 'TEXTAREA' || activeTag === 'INPUT';

        if (data.key === ';') {
            if (isTypingInMain) return;
            createPresentationStickyNote();
        } else if (data.key === '[') {
            if (isTypingInMain) return;
            togglePresentationTimer();
        } else if (data.key === 'ArrowRight' || data.key === ' ') {
            if (isTypingInMain) return;
            navigatePresentation(1);
        } else if (data.key === 'ArrowLeft') {
            if (isTypingInMain) return;
            navigatePresentation(-1);
        } else if (data.key === 'Escape') {
            closePresentationMode();
        }
    });
}

// Focus Management for Presentation Mode
document.addEventListener('fullscreenchange', () => {
    if (isPresentationActive && document.fullscreenElement && document.fullscreenElement.id === 'presentation-overlay') {
        document.fullscreenElement.focus();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('presentation-overlay');
    if (overlay) {
        overlay.addEventListener('mousedown', () => {
            if (isPresentationActive) {
                overlay.focus();
            }
        });
    }
});

const stickyColors = ['#fef08a', '#fbcfe8', '#bfdbfe', '#bbf7d0'];
let stickyColorIndex = 0;
let stickyNoteIdCounter = 0;

function createPresentationStickyNote() {
    const container = document.getElementById('presentation-sticky-container');
    if (!container) return;

    const noteId = `sticky-note-${stickyNoteIdCounter++}`;
    const color = stickyColors[stickyColorIndex];
    stickyColorIndex = (stickyColorIndex + 1) % stickyColors.length;

    const note = document.createElement('div');
    note.className = 'presentation-sticky-note';
    note.id = noteId;
    note.style.background = color;
    
    const offset = (stickyNoteIdCounter % 5) * 40;
    note.style.top = `${150 + offset}px`;
    note.style.left = `${150 + offset}px`;

    const header = document.createElement('div');
    header.className = 'presentation-sticky-header';
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'presentation-sticky-close';
    closeBtn.innerText = '✕';
    closeBtn.onclick = () => note.remove();
    
    header.appendChild(closeBtn);
    note.appendChild(header);

    const textarea = document.createElement('textarea');
    textarea.className = 'presentation-sticky-textarea';
    textarea.spellcheck = false;
    
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('presentation-sticky-close')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialX = note.offsetLeft;
        initialY = note.offsetTop;
        note.style.zIndex = 15000 + stickyNoteIdCounter; 
        document.getElementById('presentation-drag-shield').style.display = 'block';
        e.preventDefault();
    });

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'presentation-resize-handle';
    note.appendChild(resizeHandle);

    let isResizing = false;
    let resizeStartX, resizeStartY, startWidth, startHeight;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        startWidth = note.offsetWidth;
        startHeight = note.offsetHeight;
        note.style.zIndex = 15000 + stickyNoteIdCounter;
        document.getElementById('presentation-drag-shield').style.display = 'block';
        e.preventDefault();
        e.stopPropagation();
    });

    const onMouseMove = (e) => {
        if (!isDragging && !isResizing) return;
        requestAnimationFrame(() => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                note.style.left = `${initialX + dx}px`;
                note.style.top = `${initialY + dy}px`;
            }
            if (isResizing) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;
                note.style.width = `${Math.max(150, startWidth + dx)}px`;
                note.style.height = `${Math.max(150, startHeight + dy)}px`;
            }
        });
    };

    const onMouseUp = () => {
        isDragging = false;
        isResizing = false;
        document.getElementById('presentation-drag-shield').style.display = 'none';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Cleanup when note is closed
    const originalClose = closeBtn.onclick;
    closeBtn.onclick = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        originalClose();
    };

    let fitTextRaf = null;
    const fitText = () => {
        if (fitTextRaf) cancelAnimationFrame(fitTextRaf);
        fitTextRaf = requestAnimationFrame(() => {
            let min = 12;
            let max = 200;
            let bestSize = min;
            
            while (min <= max) {
                let mid = Math.floor((min + max) / 2);
                textarea.style.fontSize = mid + 'px';
                if (textarea.scrollHeight <= textarea.clientHeight && textarea.scrollWidth <= textarea.clientWidth) {
                    bestSize = mid;
                    min = mid + 1;
                } else {
                    max = mid - 1;
                }
            }
            textarea.style.fontSize = bestSize + 'px';
            fitTextRaf = null;
        });
    };

    textarea.addEventListener('input', fitText);
    
    const resizeObserver = new ResizeObserver(() => {
        fitText();
    });
    resizeObserver.observe(note);

    note.addEventListener('mousedown', () => {
        note.style.zIndex = 15000 + stickyNoteIdCounter++;
    });

    note.appendChild(textarea);
    container.appendChild(note);

    setTimeout(() => {
        textarea.focus();
    }, 10);
}

let presentationTimerInterval = null;
let presentationTimerRemaining = 0; 
let presentationTimerRunning = false;

function togglePresentationTimer() {
    const container = document.getElementById('presentation-timer-container');
    if (!container) return;

    let timerWidget = document.getElementById('presentation-timer-widget');
    if (timerWidget) {
        timerWidget.remove();
        if (presentationTimerInterval) clearInterval(presentationTimerInterval);
        return;
    }

    timerWidget = document.createElement('div');
    timerWidget.id = 'presentation-timer-widget';
    timerWidget.className = 'presentation-timer-widget';
    timerWidget.style.top = '100px';
    timerWidget.style.right = '100px';
    timerWidget.style.zIndex = 15000 + stickyNoteIdCounter++;

    const header = document.createElement('div');
    header.className = 'presentation-timer-header';
    header.innerHTML = `<span>⏱️ Timer</span>`;
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'presentation-sticky-close';
    closeBtn.innerText = '✕';
    closeBtn.style.color = '#94a3b8';
    closeBtn.onclick = () => {
        timerWidget.remove();
        if (presentationTimerInterval) clearInterval(presentationTimerInterval);
    };
    header.appendChild(closeBtn);
    timerWidget.appendChild(header);

    const display = document.createElement('div');
    display.className = 'presentation-timer-display';
    const timeSpan = document.createElement('span');
    timeSpan.innerText = '00:00';
    display.appendChild(timeSpan);
    timerWidget.appendChild(display);

    const presetsContainer = document.createElement('div');
    presetsContainer.className = 'presentation-timer-presets';
    for (let i = 1; i <= 10; i++) {
        const btn = document.createElement('button');
        btn.className = 'timer-btn';
        btn.innerText = `${i}m`;
        btn.onclick = () => {
            presentationTimerRemaining = i * 60;
            presentationTimerRunning = false;
            updateTimerDisplay();
            updateTimerDisplayBtn();
        };
        presetsContainer.appendChild(btn);
    }
    timerWidget.appendChild(presetsContainer);

    const controls = document.createElement('div');
    controls.className = 'presentation-timer-controls';

    const startPauseBtn = document.createElement('button');
    startPauseBtn.className = 'timer-action-btn timer-start';
    startPauseBtn.innerText = 'Start';
    startPauseBtn.onclick = () => {
        if (presentationTimerRemaining <= 0) return;
        presentationTimerRunning = !presentationTimerRunning;
        updateTimerDisplayBtn();
    };
    controls.appendChild(startPauseBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'timer-action-btn timer-reset';
    resetBtn.innerText = 'Stop/Reset';
    resetBtn.onclick = () => {
        presentationTimerRunning = false;
        presentationTimerRemaining = 0;
        updateTimerDisplay();
        updateTimerDisplayBtn();
    };
    controls.appendChild(resetBtn);

    timerWidget.appendChild(controls);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'presentation-resize-handle';
    timerWidget.appendChild(resizeHandle);

    let isDragging = false;
    let isResizing = false;
    let startX, startY, initialX, initialY, initialWidth, initialHeight;

    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('presentation-sticky-close')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialX = timerWidget.offsetLeft;
        initialY = timerWidget.offsetTop;
        timerWidget.style.zIndex = 15000 + stickyNoteIdCounter++;
        document.getElementById('presentation-drag-shield').style.display = 'block';
        e.preventDefault();
    });

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        initialWidth = timerWidget.offsetWidth;
        initialHeight = timerWidget.offsetHeight;
        timerWidget.style.zIndex = 15000 + stickyNoteIdCounter++;
        document.getElementById('presentation-drag-shield').style.display = 'block';
        e.preventDefault();
        e.stopPropagation();
    });

    const onMouseMove = (e) => {
        if (!isDragging && !isResizing) return;
        requestAnimationFrame(() => {
            if (isDragging) {
                timerWidget.style.left = `${initialX + (e.clientX - startX)}px`;
                timerWidget.style.top = `${initialY + (e.clientY - startY)}px`;
            }
            if (isResizing) {
                timerWidget.style.width = `${Math.max(250, initialWidth + (e.clientX - startX))}px`;
                timerWidget.style.height = `${Math.max(150, initialHeight + (e.clientY - startY))}px`;
            }
        });
    };

    const onMouseUp = () => {
        isDragging = false;
        isResizing = false;
        document.getElementById('presentation-drag-shield').style.display = 'none';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    const originalClose = closeBtn.onclick;
    closeBtn.onclick = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        originalClose();
    };

    timerWidget.addEventListener('mousedown', () => {
        timerWidget.style.zIndex = 15000 + stickyNoteIdCounter++;
    });

    function updateTimerDisplay() {
        const m = Math.floor(presentationTimerRemaining / 60).toString().padStart(2, '0');
        const s = (presentationTimerRemaining % 60).toString().padStart(2, '0');
        timeSpan.innerText = `${m}:${s}`;
        
        let min = 12; let max = 800; let bestSize = min;
        while(min <= max) {
            let mid = Math.floor((min + max)/2);
            timeSpan.style.fontSize = mid + 'px';
            if (timeSpan.offsetHeight <= display.clientHeight && timeSpan.offsetWidth <= display.clientWidth) {
                bestSize = mid; min = mid + 1;
            } else {
                max = mid - 1;
            }
        }
        timeSpan.style.fontSize = bestSize + 'px';
    }

    function updateTimerDisplayBtn() {
        if (presentationTimerRunning) {
            startPauseBtn.className = 'timer-action-btn timer-pause';
            startPauseBtn.innerText = 'Pause';
        } else {
            startPauseBtn.className = 'timer-action-btn timer-start';
            startPauseBtn.innerText = 'Start';
        }
    }

    const resizeObserver = new ResizeObserver(() => { updateTimerDisplay(); });
    resizeObserver.observe(timerWidget);

    if (presentationTimerInterval) clearInterval(presentationTimerInterval);
    presentationTimerInterval = setInterval(() => {
        if (presentationTimerRunning && presentationTimerRemaining > 0) {
            presentationTimerRemaining--;
            updateTimerDisplay();
            if (presentationTimerRemaining <= 0) {
                presentationTimerRunning = false;
                updateTimerDisplayBtn();
            }
        }
    }, 1000);

    container.appendChild(timerWidget);
    updateTimerDisplay();
}

function scalePresentationFrame() {
    const frame = document.getElementById('presentation-frame');
    if (!frame) return;

    // Determine if the current node should be full-screen (e.g., PDF/Typst)
    // or a scaled 1920x1080 slide.
    const node = presentationSequence[presentationCurrentIndex];
    if (!node) return;

    const t = node.assetType;
    // Only LaTeX/Typst (PDFs) use the 100vw/vh bypass to ensure they aren't blurry.
    // HTML and Links scale better with CSS and the user wants them to appear "big" (scaled).
    const isHighResDocument = t === 'latex';

    if (isHighResDocument) {
        frame.style.width = '100vw';
        frame.style.height = '100vh';
        frame.style.transform = 'none';
        return;
    }

    // Reset to defaults for slide assets
    frame.style.width = '1920px';
    frame.style.height = '1080px';

    const targetAR = 1920 / 1080;
    const windowAR = window.innerWidth / window.innerHeight;
    let scale;
    if (windowAR > targetAR) scale = window.innerHeight / 1080;
    else scale = window.innerWidth / 1920;
    frame.style.transform = `scale(${scale})`;
}

function renderPresentationNode() {
    const node = presentationSequence[presentationCurrentIndex];
    const content = document.getElementById('presentation-content');
    if (!node) return;

    document.getElementById('presentation-prev').style.display = presentationCurrentIndex > 0 ? 'block' : 'none';
    document.getElementById('presentation-next').style.display = presentationCurrentIndex < presentationSequence.length - 1 ? 'block' : 'none';

    scalePresentationFrame();

    const t = node.assetType;
    const isFullScreenAsset = (t === 'html' && node.html) || (t === 'link' && node.link) || t === 'latex';

    let html = '';

    if (isFullScreenAsset) {
        if (t === 'html') {
            html += `<iframe id="presentation-html-iframe" style="width: 100%; height: 100%; border: none; background: white;"></iframe>`;
        } else if (t === 'link') {
            let finalUrl = node.link.startsWith('http') ? node.link : 'https://' + node.link;
            html += `<iframe src="${finalUrl}" style="width: 100%; height: 100%; border: none; background: white;"></iframe>`;
        } else if (t === 'latex') {
            const subtype = node.latexSubtype || (node.latexFile ? 'pdf' : (node.typst ? 'typst' : 'latex'));
            if (subtype === 'pdf' || subtype === 'latex') {
                const pdfSrc = node.latexFile || node.compiledLatexPath;
                if (pdfSrc) {
                    html += `<iframe src="file://${encodeURI(resolvePath(pdfSrc))}#t=${new Date().getTime()}" style="width: 100%; height: 100%; border: none; background: white;"></iframe>`;
                } else {
                    const tempId = `pres-latex-${node.id}`;
                    html += `<iframe id="${tempId}" style="width: 100%; height: 100%; border: none; background: #f8fafc;"></iframe>`;
                    setTimeout(() => compileLatexInBackground(node, tempId), 100);
                }
            } else if (subtype === 'typst') {
                const pdfSrc = node.compiledTypstPath;
                if (pdfSrc) {
                    html += `<iframe src="file://${encodeURI(resolvePath(pdfSrc))}#t=${new Date().getTime()}" style="width: 100%; height: 100%; border: none; background: white;"></iframe>`;
                } else {
                    const tempId = `pres-typst-${node.id}`;
                    html += `<iframe id="${tempId}" style="width: 100%; height: 100%; border: none; background: #f8fafc;"></iframe>`;
                    setTimeout(() => compileTypstInBackground(node, tempId), 100);
                }
            }
        }
    } else {
        html = `<div style="padding: 60px; background: #fff; height: 100%; display: flex; flex-direction: column; color: #0f172a; min-height: 0; box-sizing: border-box;">`;
        html += `<h1 style="font-size: 3.5rem; margin-bottom: 30px;">${node.title}</h1>`;

        if (node.objectives || node.description) {
            html += `<div style="font-size: 1.5rem; line-height: 1.8; color: #334155; margin-bottom: 50px; white-space:pre-wrap; max-width: 1400px; margin-left: auto; margin-right: auto; text-align: center;">${node.objectives || node.description}</div>`;
        }

        if (t === 'raw' && node.raw) {
            html += `<div style="flex:1; min-height: 0; overflow-y:auto; background: #f8fafc; padding: 50px; border-radius: 16px; font-family: serif; font-size: 1.5rem; line-height: 2; color: #334155; white-space: pre-wrap; border: 2px solid #e2e8f0; max-width: 1600px; margin: 0 auto; width: 100%; box-sizing: border-box;">${node.raw}</div>`;
        } else if (t === 'json') {
            html += `<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background: #1e293b; color: #f8fafc; border-radius: 16px; text-align: center; border: 2px solid #334155;"><div style="font-size: 6rem; margin-bottom: 25px;">📦</div><h3 style="font-size:3rem; margin-bottom:15px;">Data Payload</h3><p style="font-size:1.5rem; color:#94a3b8;">This is a data file.</p></div>`;
        } else if (t === 'file') {
            const safeExt = node.file ? node.file.toLowerCase().split('.').pop() : '';
            if (node.file && officeExtensions.includes(safeExt)) {
                const id = `pres-office-${node.id}`;
                html += `
                            <div id="${id}-container" class="office-preview-wrap" style="flex:1; width:100%; height:100%; border: none; border-radius: 0;">
                                <div class="office-preview-header" style="padding: 20px 40px; background: #fff; border-bottom: 2px solid #f1f5f9;">
                                    <span style="font-size: 1.2rem; font-weight: 800; color: #0f172a;">Document Presentation</span>
                                    <button type="button" class="btn btn-primary" style="padding: 10px 20px;" onclick="window.electronAPI.openExternalFile(resolvePath('${node.fileFullPath.replace(/\\/g, '\\\\')}'))">Open Native</button>
                                </div>
                                <div class="preview-loading-overlay" id="${id}-loading" style="background: #fff;">
                                    <div class="spinner" style="width: 60px; height: 60px;"></div>
                                    <div class="loading-text" style="font-size: 1.2rem;">Preparing Document...</div>
                                </div>
                                <iframe id="${id}-iframe" class="office-preview-iframe" style="width:100%; height:100%;"></iframe>
                            </div>
                        `;
                setTimeout(() => renderOfficePreview(resolvePath(node.fileFullPath), `${id}-iframe`, `${id}-loading`, `${id}-container`), 100);
            } else {
                html += `<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background: #f8fafc; color: #334155; border-radius: 16px; text-align: center; border: 2px solid #e2e8f0;"><div style="font-size: 6rem; margin-bottom: 25px;">📎</div><h3 style="font-size:3rem; margin-bottom:15px;">File Attachment</h3><p style="font-size:1.5rem; color:#64748b;">${node.file || 'Attached file'} visible in directory.</p></div>`;
            }
        } else if (t === 'epub') {
            if (node.epubFileFullPath) {
                html += `<div id="presentation-epub-wrapper" style="flex:1; display:flex; flex-direction:column; position:relative; background: #fafafa; border: 2px solid #e2e8f0; border-radius: 16px;">
                            <div id="presentation-epub-area" style="flex:1;"></div>
                            <div id="presentation-epub-prev" style="position: absolute; top:0; bottom:0; left:0; width:60px; background:rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:40px; color:#333;">‹</div>
                            <div id="presentation-epub-next" style="position: absolute; top:0; bottom:0; right:0; width:60px; background:rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:40px; color:#333;">›</div>
                        </div>`;
            } else {
                html += `<div style="flex:1; display:flex; align-items:center; justify-content:center; background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 16px; font-size: 1.5rem; color: #64748b;">(No EPUB file attached)</div>`;
            }
        } else if (t === 'video') {
            if (node.videoFileFullPath) {
                html += `<div style="flex:1; display:flex; justify-content:center; background: #000; border-radius: 16px; overflow:hidden;"><video controls src="file://${encodeURI(resolvePath(node.videoFileFullPath))}#t=${new Date().getTime()}" style="width: 100%; height: 100%; object-fit: contain;"></video></div>`;
            } else if (node.videoLink) {
                let embedUrl = node.videoLink;
                if (embedUrl.includes('youtube.com/watch?v=')) {
                    let videoId = embedUrl.split('watch?v=')[1].split('&')[0];
                    embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
                } else if (embedUrl.includes('youtu.be/')) {
                    let videoId = embedUrl.split('youtu.be/')[1].split('?')[0];
                    embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
                } else if (!embedUrl.startsWith('http')) {
                    embedUrl = 'https://' + embedUrl;
                }
                html += `<iframe src="${embedUrl}" style="flex:1; width: 100%; border: none; border-radius: 16px; background: #000;" allow="autoplay; fullscreen"></iframe>`;
            } else {
                html += `<div style="flex:1; display:flex; align-items:center; justify-content:center; background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 16px; font-size: 1.5rem; color: #64748b;">(No Video attached)</div>`;
            }
        }
        html += `</div>`;
    }

    content.innerHTML = html;

    if (t === 'html' && node.html) {
        document.getElementById('presentation-html-iframe').srcdoc = node.html;
    } else if (t === 'epub' && node.epubFileFullPath) {
        setTimeout(() => {
            try {
                let bk = ePub("file://" + encodeURI(resolvePath(node.epubFileFullPath)));
                let rd = bk.renderTo("presentation-epub-area", { width: "100%", height: "100%", spread: "none" });
                applyEpubStyles(rd, node);
                applyEpubHighlights(rd, node);
                rd.display();
                document.getElementById('presentation-epub-prev').onclick = () => rd.prev();
                document.getElementById('presentation-epub-next').onclick = () => rd.next();
            } catch (e) { }
        }, 100);
    }

    // Refocus the overlay after rendering to ensure keyboard events are captured
    const overlay = document.getElementById('presentation-overlay');
    if (overlay) overlay.focus();
}

// --- Theme Toggling ---
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('zenith_os_theme', newTheme);
    updateThemeButtons(newTheme);
}

function loadTheme() {
    const savedTheme = localStorage.getItem('zenith_os_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeButtons(savedTheme);
}

function updateThemeButtons(theme) {
    const icon = theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode';
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => btn.innerHTML = icon);
}

// Initialize theme on load
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
});

// --- Focusout TO DO Handler ---
document.getElementById('editor-pane').addEventListener('focusout', (e) => {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (!info) return;

    const node = info.node;
    if (node.type === 'block') {
        let isFilled = false;
        if (node.assetType === 'html' && node.html && node.html.trim().length > 0) isFilled = true;
        if (node.assetType === 'raw' && node.raw && node.raw.trim().length > 0) isFilled = true;
        if (node.assetType === 'latex' && ((node.latex && node.latex.trim().length > 0) || node.latexFile)) isFilled = true;
        if (node.assetType === 'json' && node.json && node.json.trim().length > 0) isFilled = true;
        if (node.assetType === 'link' && node.link && node.link.trim().length > 0) isFilled = true;
        if (node.assetType === 'file' && node.file) isFilled = true;
        if (node.assetType === 'video' && (node.videoFile || (node.videoLink && node.videoLink.trim().length > 0))) isFilled = true;
        if (node.assetType === 'epub' && node.epubFile) isFilled = true;

        if (isFilled) {
            const domNode = document.querySelector(`.tree-node[data-id="${node.id}"] .todo-tag`);
            if (domNode && !domNode.classList.contains('fade-out')) {
                domNode.classList.add('fade-out');
                setTimeout(() => { if (domNode && domNode.parentNode) domNode.remove(); }, 400);
            }
        } else {
            const domNode = document.querySelector(`.tree-node[data-id="${node.id}"] .todo-tag`);
            if (!domNode) renderTree();
        }
    }
});
// --- Office Previews ---
const officeExtensions = ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'];

async function openAttachedFile() {
    if (!activeEditingNodeId) return;
    const info = findNodeInfo(activeEditingNodeId, getActiveClass().nodes);
    if (info && info.node.fileFullPath && window.electronAPI) {
        await window.electronAPI.openExternalFile(resolvePath(info.node.fileFullPath));
    }
}

async function renderOfficePreview(filePath, iframeId, loadingId, containerId) {
    const container = document.getElementById(containerId);
    const loading = document.getElementById(loadingId);
    const iframe = document.getElementById(iframeId);

    if (!container || !loading || !iframe) return;

    container.style.display = 'flex';
    loading.style.opacity = '1';
    loading.style.display = 'flex';
    iframe.src = '';

    try {
        if (window.electronAPI && window.electronAPI.generateOfficePreview) {
            const result = await window.electronAPI.generateOfficePreview(resolvePath(filePath));
            if (result && result.success) {
                iframe.src = `preview://${result.id}/${result.folderName}/Preview.html`;
                iframe.onload = () => {
                    loading.style.opacity = '0';
                    setTimeout(() => { loading.style.display = 'none'; }, 300);

                    // Inject CSS to force full width and remove hidden margins in native QL HTML
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (doc) {
                            const style = doc.createElement('style');
                            style.textContent = `
                                        html, body { 
                                            width: 100% !important; 
                                            max-width: none !important; 
                                            margin: 0 !important; 
                                            padding: 0 !important; 
                                            background: #fff !important;
                                        }
                                        /* Target common qlmanage output wrappers */
                                        div[class*="page"], div[class*="document"], div[class*="canvas"] {
                                            max-width: none !important;
                                            width: 100% !important;
                                            margin: 0 !important;
                                        }
                                    `;
                            doc.head.appendChild(style);
                        }
                    } catch (e) {
                        console.warn('Could not inject styles into preview (likely cross-origin restriction, but protocol should allow it)', e);
                    }
                };
            } else {
                container.innerHTML = `<div class="office-error-msg"><h3>Preview Error</h3><p>${result.error || 'Failed to generate preview bundle.'}</p><button class="btn btn-outline" style="margin-top:10px;" onclick="openAttachedFile()">Open Externally</button></div>`;
            }
        } else {
            container.innerHTML = `<div class="office-error-msg"><h3>Not Supported</h3><p>Office previews require Electron and macOS.</p></div>`;
        }
    } catch (e) {
        console.error('Office preview failure', e);
        container.innerHTML = `<div class="office-error-msg"><h3>System Failure</h3><p>An unexpected error occurred during preview generation.</p></div>`;
    }
}

// --- Seating Chart Logic ---
let selectedGridIndices = [];
let draggedGridElement = null;
let draggedGridSourceId = null;

function openSeatingChart() {
    try {
        const cls = getActiveClass();
        if (!cls) return;
        if (!cls.seatingChart) cls.seatingChart = { students: {}, objects: [] };
        if (!cls.seatingChart.students) cls.seatingChart.students = {};
        if (!cls.seatingChart.objects) cls.seatingChart.objects = [];

        document.getElementById('seating-chart-course-title').innerText = `— ${cls.title}`;
        document.getElementById('seating-chart-modal').classList.add('active');
        
        syncSeatingChartCourseSelector();
        
        selectedGridIndices = [];
        updateSelectionUI();
        renderSeatingGrid();
        
        // Remove and re-add listeners to prevent duplication
        const trash = document.getElementById('grid-trash-zone');
        const newTrash = trash.cloneNode(true);
        trash.parentNode.replaceChild(newTrash, trash);
        setupGridTrash();
    } catch (e) {
        console.error("Failed to open seating chart:", e);
        showToast("Error opening seating chart", "error");
    }
}

function closeSeatingChart() {
    document.getElementById('seating-chart-modal').classList.remove('active');
}

function switchSeatingClass(id) {
    if (!id) return;
    openClass(id);
    openSeatingChart();
}

function syncSeatingChartCourseSelector() {
    const select = document.getElementById('seating-class-selector');
    if (!select) return;
    select.innerHTML = '';
    
    if (state && state.classes) {
        state.classes.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls.id;
            opt.innerText = `${cls.emoji} ${cls.title}`;
            if (cls.id === activeClassId) opt.selected = true;
            select.appendChild(opt);
        });
    }
}

function renderSeatingGrid() {
    const cls = getActiveClass();
    const chart = cls.seatingChart || { students: {}, objects: [] };
    const grid = document.getElementById('seating-grid');
    grid.innerHTML = '';

    const COLS = 12;
    const ROWS = 8;
    const totalCells = COLS * ROWS;

    const occupiedByObject = {};
    if (chart.objects) {
        chart.objects.forEach(obj => {
            obj.indices.forEach(idx => occupiedByObject[idx] = obj.id);
        });
    }

    for (let i = 0; i < totalCells; i++) {
        const objectId = occupiedByObject[i];
        if (objectId) {
            const obj = chart.objects.find(o => o.id === objectId);
            if (obj && Math.min(...obj.indices) === i) {
                const objDiv = document.createElement('div');
                objDiv.className = 'static-object-item';
                objDiv.style.background = '#e2e8f0'; // Light gray object background
                objDiv.style.color = '#1e293b';       // Dark text
                objDiv.style.border = '1px solid #cbd5e1';
                objDiv.innerText = obj.name;
                objDiv.draggable = true;
                objDiv.style.gridColumn = `${obj.colStart} / span ${obj.colSpan}`;
                objDiv.style.gridRow = `${obj.rowStart} / span ${obj.rowSpan}`;

                objDiv.ondblclick = (e) => {
                    e.stopPropagation();
                    openInputModal("Rename Object", "Enter new name for this room element:", obj.name, (newName) => {
                        if (newName) { obj.name = newName; renderSeatingGrid(); saveWorkspace(); }
                    });
                };

                objDiv.addEventListener('dragstart', (e) => {
                    draggedGridElement = objDiv;
                    draggedGridSourceId = `object-${obj.id}`;
                    setTimeout(() => objDiv.classList.add('dragging'), 0);
                });
                objDiv.addEventListener('dragend', () => {
                    objDiv.classList.remove('dragging');
                    draggedGridElement = null;
                    draggedGridSourceId = null;
                    document.querySelectorAll('.seating-grid-cell').forEach(c => c.classList.remove('drag-over'));
                    document.getElementById('grid-trash-zone').classList.remove('drag-over');
                });

                grid.appendChild(objDiv);
            }
            continue;
        }

        const cell = document.createElement('div');
        cell.className = 'seating-grid-cell selectable';
        cell.style.backgroundColor = '#f1f5f9'; // Very light gray-blue
        cell.style.border = '1px solid #e2e8f0'; // Subtle gray border
        if (selectedGridIndices.includes(i)) cell.classList.add('selected');
        cell.dataset.index = i;

        // Force explicit grid positioning
        const row = Math.floor(i / COLS) + 1;
        const col = (i % COLS) + 1;
        cell.style.gridRow = row;
        cell.style.gridColumn = col;

        cell.onclick = () => toggleCellSelection(i);

        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedGridElement) cell.classList.add('drag-over');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            handleGridDrop(i);
        });

        const studentName = chart.students ? chart.students[i] : null;
        if (studentName) {
            const studentDiv = createGridStudentElement(studentName, i);
            cell.appendChild(studentDiv);
            cell.classList.remove('selectable');
        }

        grid.appendChild(cell);
    }
}

function createGridStudentElement(name, index) {
    const div = document.createElement('div');
    div.className = 'student-item';
    div.style.background = '#ffffff';
    div.style.color = '#0f172a';
    div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
    div.style.border = '1px solid #e2e8f0';
    div.innerText = name;
    div.draggable = true;

    div.ondblclick = (e) => {
        e.stopPropagation();
        openInputModal("Rename Student", "New name for this student:", name, (newName) => {
            if (newName !== null) {
                const cls = getActiveClass();
                if (newName.trim() === "") delete cls.seatingChart.students[index];
                else cls.seatingChart.students[index] = newName;
                renderSeatingGrid();
                saveWorkspace();
            }
        });
    };

    div.addEventListener('dragstart', (e) => {
        draggedGridElement = div;
        draggedGridSourceId = `cell-${index}`;
        setTimeout(() => div.classList.add('dragging'), 0);
    });
    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
        draggedGridElement = null;
        draggedGridSourceId = null;
        document.querySelectorAll('.seating-grid-cell').forEach(c => c.classList.remove('drag-over'));
        document.getElementById('grid-trash-zone').classList.remove('drag-over');
    });

    return div;
}

function toggleCellSelection(index) {
    const cls = getActiveClass();
    if (cls.seatingChart.students[index]) return;

    const idx = selectedGridIndices.indexOf(index);
    if (idx > -1) selectedGridIndices.splice(idx, 1);
    else selectedGridIndices.push(index);

    updateSelectionUI();
    renderSeatingGrid();
}

function updateSelectionUI() {
    const info = document.getElementById('selection-info');
    const btn = document.getElementById('create-object-btn');
    if (selectedGridIndices.length > 0) {
        info.innerText = `${selectedGridIndices.length} cells selected`;
        info.style.display = 'block';
        btn.style.display = 'block';
    } else {
        info.style.display = 'none';
        btn.style.display = 'none';
    }
}

function createStaticObject() {
    if (selectedGridIndices.length === 0) return;
    openInputModal("Create Object", "Enter a name for this room element (e.g. Door, Front, Table):", "New Object", (name) => {
        if (!name) return;

        const COLS = 12;
        let minR = 100, maxR = 0, minC = 100, maxC = 0;
        selectedGridIndices.forEach(idx => {
            const r = Math.floor(idx / COLS) + 1;
            const c = (idx % COLS) + 1;
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (c < minC) minC = c; if (c > maxC) maxC = c;
        });

        const cls = getActiveClass();
        if (!cls.seatingChart.objects) cls.seatingChart.objects = [];

        selectedGridIndices.sort((a,b) => a - b);

        cls.seatingChart.objects.push({
            id: generateId(),
            name: name,
            indices: [...selectedGridIndices],
            rowStart: minR,
            colStart: minC,
            rowSpan: (maxR - minR) + 1,
            colSpan: (maxC - minC) + 1
        });

        selectedGridIndices = [];
        updateSelectionUI();
        renderSeatingGrid();
        saveWorkspace();
    });
}

function addStudentToGrid() {
    const input = document.getElementById('newStudentNameInGrid');
    const name = input.value.trim();
    if (!name) return;

    const cls = getActiveClass();
    if (!cls.seatingChart) cls.seatingChart = { students: {}, objects: [] };

    const COLS = 12, ROWS = 8;
    let found = false;
    for (let i = 0; i < COLS * ROWS; i++) {
        const isOccupiedByObj = (cls.seatingChart.objects || []).some(o => o.indices.includes(i));
        if (!cls.seatingChart.students[i] && !isOccupiedByObj) {
            cls.seatingChart.students[i] = name;
            found = true;
            break;
        }
    }

    if (found) {
        input.value = '';
        renderSeatingGrid();
        saveWorkspace();
    } else {
        showToast("No empty seats available!", "warning");
    }
}

function handleGridDrop(targetIndex) {
    if (!draggedGridElement || !draggedGridSourceId) return;
    const cls = getActiveClass();

    const isOccupiedByObj = (cls.seatingChart.objects || []).some(o => {
        if (draggedGridSourceId.startsWith('object-')) {
            if (o.id === draggedGridSourceId.split('-')[1]) return false;
        }
        return o.indices.includes(targetIndex);
    });
    if (isOccupiedByObj) return;

    if (draggedGridSourceId.startsWith('cell-')) {
        const sourceIndex = parseInt(draggedGridSourceId.split('-')[1]);
        if (sourceIndex === targetIndex) return;

        const studentName = cls.seatingChart.students[sourceIndex];
        const targetStudent = cls.seatingChart.students[targetIndex];

        if (targetStudent) {
            cls.seatingChart.students[sourceIndex] = targetStudent;
        } else {
            delete cls.seatingChart.students[sourceIndex];
        }
        cls.seatingChart.students[targetIndex] = studentName;
    }
    else if (draggedGridSourceId.startsWith('object-')) {
        const objId = draggedGridSourceId.split('-')[1];
        const obj = cls.seatingChart.objects.find(o => o.id === objId);
        if (!obj) return;

        const firstIdx = obj.indices[0];
        const COLS = 12;
        const rd = Math.floor(targetIndex / COLS) - Math.floor(firstIdx / COLS);
        const cd = (targetIndex % COLS) - (firstIdx % COLS);

        const newIndices = obj.indices.map(idx => {
            const r = Math.floor(idx / COLS) + rd;
            const c = (idx % COLS) + cd;
            return (r * COLS) + c;
        });

        const isValid = newIndices.every(idx => idx >= 0 && idx < 12 * 8) &&
                      !newIndices.some(idx => {
                          const otherObj = cls.seatingChart.objects.find(o => o.id !== objId && o.indices.includes(idx));
                          return !!otherObj || !!cls.seatingChart.students[idx];
                      });

        if (isValid) {
            obj.indices = newIndices;
            obj.rowStart += rd;
            obj.colStart += cd;
        }
    }

    renderSeatingGrid();
    saveWorkspace();
}

function setupGridTrash() {
    const trash = document.getElementById('grid-trash-zone');
    trash.addEventListener('dragover', (e) => { e.preventDefault(); trash.classList.add('drag-over'); });
    trash.addEventListener('dragleave', () => trash.classList.remove('drag-over'));
    trash.addEventListener('drop', (e) => {
        e.preventDefault();
        trash.classList.remove('drag-over');
        if (!draggedGridSourceId) return;

        const cls = getActiveClass();
        if (draggedGridSourceId.startsWith('cell-')) {
            const idx = parseInt(draggedGridSourceId.split('-')[1]);
            delete cls.seatingChart.students[idx];
        } else if (draggedGridSourceId.startsWith('object-')) {
            const id = draggedGridSourceId.split('-')[1];
            cls.seatingChart.objects = cls.seatingChart.objects.filter(o => o.id !== id);
        }
        renderSeatingGrid();
        saveWorkspace();
    });
}

function randomizeGrid() {
    const cls = getActiveClass();
    const students = Object.values(cls.seatingChart.students);
    if (students.length < 2) return;

    openConfirmModal("Randomize Seating", "Redistribute all students across currently occupied seats?", () => {
        const indices = Object.keys(cls.seatingChart.students);
        for (let i = students.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [students[i], students[j]] = [students[j], students[i]];
        }
        indices.forEach((idx, i) => {
            cls.seatingChart.students[idx] = students[i];
        });
        renderSeatingGrid();
        saveWorkspace();
    });
}

function clearGrid() {
    openConfirmModal("Clear Layout", "Permanently clear ALL students and objects from this chart?", () => {
        const cls = getActiveClass();
        cls.seatingChart = { students: {}, objects: [] };
        renderSeatingGrid();
        saveWorkspace();
    });
}
