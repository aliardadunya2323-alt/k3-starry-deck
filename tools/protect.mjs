import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, webcrypto} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iterations = 600000;

export async function seal(html, app, password) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({name:'PBKDF2', salt, iterations, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, false, ['encrypt']);
  const content = JSON.stringify({version:1, html, app});
  const encrypted = await webcrypto.subtle.encrypt({name:'AES-GCM', iv}, key, Buffer.from(content));
  return Buffer.concat([Buffer.from('K3G1'), salt, iv, Buffer.from(encrypted)]);
}

export async function buildProtected(password) {
  if (!password) throw Error('Provide a nonempty access code through stdin.');
  const output = path.join(root, '.protected');
  await fs.mkdir(output, {recursive:true});
  await fs.cp(path.join(root, 'site'), output, {recursive:true});
  let html = await fs.readFile(path.join(root, 'site/index.html'), 'utf8');
  html = html.replace(/<script\s+type="module"\s+src="app\.js[^\"]*"><\/script>/, '')
    .replace("script-src 'self';", "script-src 'self' blob:;");
  if (html.includes('src="app.js')) throw Error('Unrecognized app entry: refusing to publish unprotected entry.');
  const app = await fs.readFile(path.join(root, 'site/app.js'), 'utf8');
  await fs.writeFile(path.join(output, 'deck.bin'), await seal(html, app, password));
  // Replace the old public script as well, so its old URL no longer boots the scene.
  await fs.writeFile(path.join(output, 'app.js'), '// This hosted experience now opens through its encrypted entry.\n');
  for (const file of ['index.html', 'gate.js', 'gate.css']) {
    await fs.copyFile(path.join(root, 'gate', file), path.join(output, file));
  }
  console.log('Protected deployment built in .protected/. Access code is not stored.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let password = '';
  for await (const chunk of process.stdin) password += chunk;
  password = password.replace(/\r?\n$/, '');
  await buildProtected(password);
  password = '';
}
