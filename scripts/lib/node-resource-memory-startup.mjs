import {reportResourceNodeStartup} from './node-resource-memory.mjs';

// Loaded by --import in the actual heavy process, before its application code.
reportResourceNodeStartup();
