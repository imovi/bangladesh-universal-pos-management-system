#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const modelNames = process.argv.slice(2);
if (modelNames.length === 0) {
  console.error("Usage: node scripts/describe-schema.cjs <Model1> [Model2...]");
  process.exit(1);
}

const schemaPath = path.resolve(__dirname, "../apps/api/prisma/schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");

function getModelBody(modelName) {
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s*\\{`));
  if (!match) return null;
  const startIdx = match.index;
  const openBrace = schema.indexOf("{", startIdx);
  let depth = 1;
  let i = openBrace + 1;
  while (depth > 0 && i < schema.length) {
    if (schema[i] === "{") depth++;
    else if (schema[i] === "}") depth--;
    i++;
  }
  return schema.slice(openBrace + 1, i - 1);
}

for (const modelName of modelNames) {
  const body = getModelBody(modelName);
  if (!body) {
    console.log(`Model ${modelName}: Not found in schema`);
    continue;
  }

  console.log(`### Model ${modelName}`);
  const lines = body.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;

    // Field line format: name type modifiers...
    const parts = line.split(/\s+/);
    const fieldName = parts[0];
    const fieldType = parts[1];

    // Find @map("...")
    const mapMatch = line.match(/@map\("([^"]+)"\)/);
    const mapCol = mapMatch ? mapMatch[1] : fieldName;

    // Skip relations (types starting with capital letter that are not standard Prisma types)
    const baseType = fieldType.replace(/\?$/, "");
    const isRelation = /^[A-Z]/.test(baseType) && !["String", "Int", "BigInt", "Boolean", "DateTime", "Decimal", "Float", "Json", "Bytes"].includes(baseType);
    if (isRelation || fieldType.endsWith("[]")) continue;

    console.log(`- \`${fieldName}\` (${fieldType}) -> column \`${mapCol}\``);
  }
  console.log("");
}
