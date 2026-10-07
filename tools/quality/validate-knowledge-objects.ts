import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { concludeGate, GateReport } from "./gate-report";

const schema = (await Bun.file("ecosystem/schemas/knowledge-object.schema.json").json()) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const glob = new Bun.Glob("ecosystem/objects/**/*.json");
const report = new GateReport();

function safeError(error: ErrorObject): string {
  const message = error.message ?? "invalid";
  return `${error.instancePath || "/"}: ${message} (${error.keyword})`;
}

for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) {
  let value: unknown;
  try {
    value = await Bun.file(path).json();
  } catch {
    report.check(path, false, "invalid JSON");
    continue;
  }

  const valid = validate(value);
  report.check(
    path,
    valid,
    valid ? "schema valid" : (validate.errors ?? []).map(safeError).join("; "),
  );
}

// Zero objects trips the empty-gate rule on its own; the message names the home.
if (report.asserted === 0) {
  report.check("ecosystem/objects/", false, "no Knowledge Object found");
}
concludeGate("Knowledge Objects", report);
