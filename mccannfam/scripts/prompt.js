// Question-and-answer helper for the setup scripts.
// Answers typed or pasted before a question appears are kept, so pasting several lines works.
const readline = require('node:readline');
const { loadEnvFile } = require('../src/env');
const path = require('node:path');

// Reads mccannfam/.env into process.env (real environment variables win).
function loadEnv(root = path.join(__dirname, '..')) {
  loadEnvFile(path.join(root, '.env'));
}

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const queue = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queue.push(line)));
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()(null);
  });

  function next() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => waiting.push(resolve));
  }

  return {
    // Shows the current value in [brackets]; pressing Enter keeps it.
    async question(text, current = '') {
      process.stdout.write(current ? `${text} [${current}]: ` : `${text}: `);
      const answer = await next();
      if (answer === null) return current;
      return answer.trim() || current;
    },
    async yesNo(text, defaultYes = false) {
      const answer = (await this.question(`${text} (${defaultYes ? 'Y/n' : 'y/N'})`)).toLowerCase();
      return answer ? answer.startsWith('y') : defaultYes;
    },
    close: () => rl.close(),
  };
}

module.exports = { createPrompter, loadEnv };
