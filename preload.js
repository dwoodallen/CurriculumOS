const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    saveFile: (filePath, content) => ipcRenderer.invoke('fs:saveFile', filePath, content),
    compileLatex: (nodeId, content, supportingFiles) => ipcRenderer.invoke('latex:compile', nodeId, content, supportingFiles),
    checkLatex: () => ipcRenderer.invoke('latex:check'),
    compileTypst: (nodeId, content, supportingFiles) => ipcRenderer.invoke('typst:compile', nodeId, content, supportingFiles),
    checkTypst: () => ipcRenderer.invoke('typst:check'),
    publishCourse: (courseTitle, payload) => ipcRenderer.invoke('course:publish', courseTitle, payload),
    openCourseFolder: (courseTitle) => ipcRenderer.invoke('course:openFolder', courseTitle),
    openLibraryFolder: () => ipcRenderer.invoke('app:openLibrary'),
    openExternalFile: (filePath) => ipcRenderer.invoke('app:openExternalFile', filePath),
    generateOfficePreview: (filePath) => ipcRenderer.invoke('office:generatePreview', filePath),

    // State & Archive
    loadState: () => ipcRenderer.invoke('app:loadState'),
    saveState: (state) => ipcRenderer.invoke('app:saveState', state),
    managedCopy: (sourcePath) => ipcRenderer.invoke('fs:managedCopy', sourcePath),
    exportArchive: (destPath) => ipcRenderer.invoke('archive:export', destPath),
    importArchive: (zipPath) => ipcRenderer.invoke('archive:import', zipPath),
    getFilesPath: () => ipcRenderer.invoke('app:getFilesPath'),
    selectFile: (options) => ipcRenderer.invoke('dialog:selectFile', options),
    onPresentationKeydown: (callback) => ipcRenderer.on('presentation-keydown', (event, data) => callback(data))
});