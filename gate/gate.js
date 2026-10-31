const form = document.getElementById('unlock');
const input = document.getElementById('access-code');
const button = document.getElementById('enter');
const status = document.getElementById('status');
let encrypted;
let busy = false;

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  if (!crypto.subtle) {
    status.textContent = '请使用支持安全连接的浏览器，通过 HTTPS 打开。';
    return;
  }
  busy = true;
  button.disabled = true;
  status.textContent = '正在准备登船…';
  let password = input.value;
  input.value = '';
  let stage = 'download';
  let appURL;
  try {
    if (!encrypted) {
      const response = await fetch('deck.bin', {cache:'no-cache'});
      if (!response.ok) throw Error('Download failed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 48 || new TextDecoder().decode(bytes.slice(0,4)) !== 'K3G1') throw Error('Invalid package');
      encrypted = bytes;
    }
    stage = 'decrypt';
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    password = '';
    const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:encrypted.slice(4,20), iterations:600000, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:encrypted.slice(20,32)}, key, encrypted.slice(32));
    const payload = JSON.parse(new TextDecoder().decode(plain));
    if (payload.version !== 1 || typeof payload.html !== 'string' || typeof payload.app !== 'string') throw Error('Invalid content');
    stage = 'start';
    appURL = URL.createObjectURL(new Blob([payload.app], {type:'text/javascript'}));
    const page = new DOMParser().parseFromString(payload.html, 'text/html');
    document.head.replaceChildren(...Array.from(page.head.childNodes));
    document.body.replaceChildren(...Array.from(page.body.childNodes));
    await import(appURL);
    encrypted = null;
  } catch {
    const message = stage === 'download' ? '连接暂时不顺畅，请稍后重试。' : stage === 'decrypt' ? '体验码不正确，请重新输入。' : '甲板加载失败，请刷新后重试。';
    const target = document.getElementById('status') || document.getElementById('loading-text');
    if (target) target.textContent = message;
    input.focus();
  } finally {
    password = '';
    if (appURL) URL.revokeObjectURL(appURL);
    busy = false;
    button.disabled = false;
  }
});
