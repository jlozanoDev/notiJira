const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(assetsDir, 'jira.svg'), 'utf-8');

const size = 512;
const logoSize = Math.round(size * 0.72);

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: ${size}px;
        height: ${size}px;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .logo { width: ${logoSize}px; height: ${logoSize}px; }
      .logo svg { width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <div class="logo">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
  </body>
</html>`;

function makeIco(pngBuffer, outputPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);

  fs.writeFileSync(outputPath, Buffer.concat([header, entry, pngBuffer]));
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });

  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const captured = await win.webContents.capturePage({
          x: 0,
          y: 0,
          width: size,
          height: size,
        });
        const png = captured.resize({ width: size, height: size, quality: 'best' }).toPNG();
        fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);

        const small = nativeImage
          .createFromBuffer(png)
          .resize({ width: 256, height: 256, quality: 'best' })
          .toPNG();
        makeIco(small, path.join(assetsDir, 'icon.ico'));

        console.log('Iconos generados en', assetsDir);
      } catch (err) {
        console.error('Error generando icono:', err);
      } finally {
        app.quit();
      }
    }, 500);
  });

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});
