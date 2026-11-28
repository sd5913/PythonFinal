import {mkdir, cp, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'.worker-assets');
await mkdir(output,{recursive:true});
await cp(join(root,'app/static'),join(output,'static'),{recursive:true});
await cp(join(root,'visual-effects'),join(output,'visual-effects'),{recursive:true});
await copyFile(join(root,'app/static/index.html'),join(output,'index.html'));
