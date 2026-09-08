import {createReadStream} from 'node:fs';

// JSON strings may contain literal U+2028/U+2029. Only LF separates JSONL records.
export async function* readCheckpointJsonl(file) {
  let pending = '', number = 0;
  const parse = line => {
    number++;
    if (!line.trim()) return undefined;
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`invalid_checkpoint_line:${file}:${number}:${error.message}`); }
  };
  for await (const chunk of createReadStream(file, {encoding:'utf8'})) {
    pending += chunk;
    let start = 0, end;
    while ((end = pending.indexOf('\n', start)) !== -1) {
      const record = parse(pending.slice(start, end));
      if (record !== undefined) yield record;
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  if (pending.length) {
    const record = parse(pending);
    if (record !== undefined) yield record;
  }
}
