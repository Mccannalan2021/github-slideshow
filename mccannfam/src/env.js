// One reader and writer for .env values, shared by the server and the setup scripts, so a value
// written by one (with quotes, backslashes or spaces) is read back exactly by the others.
const fs = require('node:fs');

// Values with spaces, quotes, # or backslashes are written as JSON strings ("C:\\Users\\me").
function encodeEnvValue(value) {
  const s = String(value ?? '');
  return /[\s#"'\\]/.test(s) ? JSON.stringify(s) : s;
}

function decodeEnvValue(raw) {
  const s = String(raw ?? '').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

const LINE = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/;

// Reads a .env file into `target` (process.env by default). Real environment variables win.
function loadEnvFile(file, target = process.env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m && target[m[1]] === undefined) target[m[1]] = decodeEnvValue(m[2]);
  }
}

// Helpers for editing a .env file's lines in place (keeps comments and order).
function getEnvLine(lines, key) {
  const line = lines.find((l) => l.startsWith(`${key}=`));
  return line ? decodeEnvValue(line.slice(key.length + 1)) : '';
}
function setEnvLine(lines, key, value) {
  const line = `${key}=${encodeEnvValue(value)}`;
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i === -1) lines.push(line);
  else lines[i] = line;
}

module.exports = { encodeEnvValue, decodeEnvValue, loadEnvFile, getEnvLine, setEnvLine };
