import fs from "node:fs/promises";

export async function writeJsonObjectWithArrayAtomic(filename, payload, arrayKey, rows) {
  if (!filename) throw new Error("json_stream_filename_required");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("json_stream_payload_object_required");
  }
  if (!arrayKey) throw new Error("json_stream_array_key_required");
  if (!Array.isArray(rows)) throw new Error("json_stream_rows_array_required");

  const temporary = `${filename}.${process.pid}.${Date.now()}.stream.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "w");
    await handle.write("{");

    let wroteProperty = false;
    for (const [key, value] of Object.entries(payload)) {
      if (key === arrayKey) continue;
      if (wroteProperty) await handle.write(",");
      await handle.write(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
      wroteProperty = true;
    }

    if (wroteProperty) await handle.write(",");
    await handle.write(`${JSON.stringify(arrayKey)}:[`);
    for (let index = 0; index < rows.length; index++) {
      if (index > 0) await handle.write(",");
      await handle.write(JSON.stringify(rows[index]));
    }
    await handle.write("]}");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filename);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
