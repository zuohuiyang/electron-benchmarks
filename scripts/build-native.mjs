import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('Native helper is built only on Windows x64.');
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = path.join(root, 'native', 'windows-helper.cc');
  const output = path.join(root, 'native', 'windows-helper.exe');
  const args = ['/nologo', '/O2', '/MT', '/EHsc', '/W4', source, `/Fe:${output}`, `/Fo:${path.join(root, 'native', 'windows-helper.obj')}`, '/link', 'wtsapi32.lib', 'advapi32.lib', 'user32.lib'];
  try { execFileSync('cl.exe', args, { cwd: root, stdio: 'inherit' }); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!fs.existsSync(vswhere)) throw Error('Install Visual Studio C++ x64 build tools, then run npm run build.');
    const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
    const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    // Paths originate from the workspace / VS installer, not CLI input. Batch cannot represent % or newline safely.
    if ([root, vcvars].some(s => /[%\r\n"!]/.test(s))) throw Error('Build in a path without batch expansion characters.');
    const command = `call "${vcvars}" && cl.exe ${args.map(s => `"${s}"`).join(' ')}`;
    execSync(command, { shell: process.env.ComSpec ?? 'cmd.exe', cwd: root, stdio: 'inherit' });
  }
}
