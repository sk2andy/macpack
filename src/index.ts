#!/usr/bin/env node
import { createProgram } from "./cli/commands.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
