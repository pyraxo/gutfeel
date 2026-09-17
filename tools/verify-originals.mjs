import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../recovered/file-manifest.json',import.meta.url),'utf8'));
const failures=[];
for(const file of manifest.files){const bytes=await readFile(new URL('../'+file.path,import.meta.url));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256) failures.push(file.path);}
if(failures.length){console.error('Original installation changed:',failures);process.exitCode=1;}else console.log(`Verified ${manifest.files.length} original installation files: all sizes and SHA-256 hashes unchanged.`);
