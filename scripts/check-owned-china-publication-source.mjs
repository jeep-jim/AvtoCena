import path from 'node:path';
import {openOwnedChinaVerifiedInput} from './lib/open-owned-china-verified-input.mjs';

await openOwnedChinaVerifiedInput(path.resolve(process.argv[2]));
