const path = require('path');
const crypto = require('crypto');

function testFix() {
    let content = `
    \\includegraphics[width=0.95\\linewidth]{https://spectrum.ieee.org/media-library/the-uncanny-valley.jpg?id=25588301}
    \\includegraphics[width=0.95\\linewidth]{https://spectrum.ieee.org/media-library/telenoid-robot.jpg?id=25590011\\&width=1800\\&quality=85}
    `;

    const urlRegex = /\\includegraphics(?:\[.*?\])?\{\s*(https?:\/\/[^\s}]+)\s*\}/g;
    let match;
    const downloads = new Map();
    
    // 1. Capture unique URLs
    while ((match = urlRegex.exec(content)) !== null) {
        const url = match[1];
        if (!downloads.has(url)) {
            const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
            const originalPath = url.split('?')[0];
            const originalExt = path.extname(originalPath) || '.png';
            const safeName = `web_img_${hash}${originalExt}`;
            downloads.set(url, safeName);
        }
    }

    let processedContent = content;
    for (const [url, safeName] of downloads) {
        // --- This is the fix logic ---
        const fetchUrl = url.replace(/\\&/g, '&');
        console.log(`Original URL: ${url}`);
        console.log(`Fetch URL:    ${fetchUrl}`);
        
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const replaceRegex = new RegExp(`\\\\includegraphics(\\[.*?\\])?\\{\\s*${escapedUrl}\\s*\\}`, 'g');
        processedContent = processedContent.replace(replaceRegex, `\\includegraphics$1{${safeName}}`);
    }

    console.log("\nFinal content check:");
    console.log(processedContent);
}

testFix();
