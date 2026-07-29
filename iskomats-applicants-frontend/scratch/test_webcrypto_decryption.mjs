import { webcrypto } from 'crypto';
import fetch from 'node-fetch';

const { subtle } = webcrypto;
const MAGIC_PREFIX = 'ENC:';

async function getCryptoKey(keyStr) {
  const enc = new TextEncoder();
  const keyData = enc.encode(keyStr.padEnd(32, '0').slice(0, 32));
  return subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
}

async function main() {
  const url = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/coe/1-enrollment_certificate_doc.jpg";
  console.log("Fetching", url);
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();

  const prefixBytes = new TextEncoder().encode(MAGIC_PREFIX);
  const iv = new Uint8Array(buffer.slice(prefixBytes.length, prefixBytes.length + 12));
  const ciphertext = buffer.slice(prefixBytes.length + 12);

  const candidateKeys = [
    'iskomats-system-secret-key-2024',
    'your_encryption_key_here',
    'iskomats-system-secret-key',
    'iskomats',
    'secret'
  ];

  for (const kStr of candidateKeys) {
    try {
      const key = await getCryptoKey(kStr);
      const dec = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      const decBytes = new Uint8Array(dec);
      const isJpg = decBytes[0] === 0xff && decBytes[1] === 0xd8;
      const isPng = decBytes[0] === 0x89 && decBytes[1] === 0x50;
      console.log(`\nSUCCESS with key '${kStr}'! len=${dec.byteLength}, isJpg=${isJpg}, isPng=${isPng}`);
      return;
    } catch (err) {
      console.log(`Failed with key '${kStr}':`, err.message);
    }
  }

  console.log("\nAll candidate keys failed.");
}

main();
