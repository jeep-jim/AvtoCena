function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  if (typeof value === "object") return "object";
  return typeof value;
}

function acceptsType(value, expected) {
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Only local JSON Schema refs are supported: ${ref}`);
  return ref.slice(2).split("/").reduce((value, part) => value?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], rootSchema);
}

function validateNode(value, schema, rootSchema, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    validateNode(value, resolveRef(rootSchema, schema.$ref), rootSchema, path, errors);
    return;
  }

  if (schema.anyOf) {
    const branches = schema.anyOf.map((candidate) => {
      const branchErrors = [];
      validateNode(value, candidate, rootSchema, path, branchErrors);
      return branchErrors;
    });
    if (!branches.some((branch) => branch.length === 0)) errors.push({ path, keyword: "anyOf", message: "Value does not match any allowed schema" });
    return;
  }

  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length && !expectedTypes.some((expected) => acceptsType(value, expected))) {
    errors.push({ path, keyword: "type", message: `Expected ${expectedTypes.join(" or ")}, received ${valueType(value)}` });
    return;
  }

  if ("const" in schema && !Object.is(value, schema.const)) errors.push({ path, keyword: "const", message: `Expected constant ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) errors.push({ path, keyword: "enum", message: `Value is outside the allowed enum` });

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, keyword: "minLength", message: `String is shorter than ${schema.minLength}` });
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push({ path, keyword: "pattern", message: `String does not match ${schema.pattern}` });
    if (schema.format === "uri") {
      try { new URL(value); } catch { errors.push({ path, keyword: "format", message: "String is not a valid URI" }); }
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, keyword: "minimum", message: `Number is below ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, keyword: "maximum", message: `Number is above ${schema.maximum}` });
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, keyword: "minItems", message: `Array has fewer than ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, keyword: "maxItems", message: `Array has more than ${schema.maxItems} items` });
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) errors.push({ path, keyword: "uniqueItems", message: "Array items are not unique" });
    }
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${path}/${index}`, errors));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push({ path: `${path}/${required}`, keyword: "required", message: "Required property is missing" });
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) if (!(key in schema.properties)) errors.push({ path: `${path}/${key}`, keyword: "additionalProperties", message: "Unknown property" });
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) validateNode(value[key], childSchema, rootSchema, `${path}/${key}`, errors);
    }
  }

  for (const child of schema.allOf || []) {
    if (child.if) {
      const conditionErrors = [];
      validateNode(value, child.if, rootSchema, path, conditionErrors);
      if (!conditionErrors.length && child.then) validateNode(value, child.then, rootSchema, path, errors);
    } else {
      validateNode(value, child, rootSchema, path, errors);
    }
  }
}

export function validateJsonSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, "$", errors);
  return errors;
}
