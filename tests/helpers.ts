import { buildSbom, SbomOptions, SbomPackage, SbomResult } from '../src/sbom'
import assert = require('node:assert/strict')

/** Recorded in metadata.tools. Irrelevant to everything but the tests about it. */
export const TOOL = { name: "test-tool", version: "0.0.1" };

/**
 * Anything a test does not spell out is filled in by `build`.
 */
export type BuildInput = {
  product?: SbomPackage;
  packages?: SbomPackage[];
  licenseTextByName?: Map<string, string>;
  tool?: { name: string, version: string };
  options?: SbomOptions;
};

/**
 * The parsed document, and any node inside it. What is asserted on is the serialized JSON,
 * so no shape is imposed on it here - the point of these tests is the bytes the caller
 * writes, not the model that produced them.
 */
export type Json = any;

/**
 * Calls buildSbom, defaulting everything the test is not about.
 *
 * serialNumber and timestamp are off unless a test asks for them: they are the only
 * non-deterministic parts of the document, and leaving them on would make every expected
 * document depend on the clock.
 */
export function build(input: BuildInput = {}): Promise<SbomResult> {
  return buildSbom({
    product: input.product !== undefined ? input.product : { name: "product", version: "1.0.0" },
    packages: input.packages !== undefined ? input.packages : [],
    licenseTextByName: input.licenseTextByName !== undefined ? input.licenseTextByName : new Map(),
    tool: input.tool !== undefined ? input.tool : TOOL,
    options: Object.assign({ serialNumber: false, timestamp: false }, input.options)
  });
}

/**
 * The serialized document, failing the test if buildSbom reported errors instead.
 *
 * buildSbom validates against the CycloneDX JSON schema before returning, so every test
 * that gets past this call has also asserted that its document is schema-valid.
 */
export async function buildJson(input: BuildInput = {}): Promise<string> {
  const result = await build(input);
  if (result.type === "Error")
    assert.fail("buildSbom reported errors:\n" + result.errors.join("\n"));
  return result.json;
}

/** The parsed document, failing the test if buildSbom reported errors instead. */
export async function buildDocument(input: BuildInput = {}): Promise<Json> {
  return JSON.parse(await buildJson(input));
}

/** The reported errors, failing the test if buildSbom produced a document instead. */
export async function buildErrors(input: BuildInput = {}): Promise<string[]> {
  const result = await build(input);
  if (result.type !== "Error")
    assert.fail("Expected buildSbom to report errors, but it produced a document.");
  return result.errors;
}

/**
 * The one listed component with this name. Components are sorted in the document, so no
 * index into `components` is stable.
 */
export function component(document: Json, name: string): Json {
  const found = (document.components as Json[]).filter((c: Json) => c.name === name);
  assert.equal(found.length, 1, `Expected exactly one component named "${name}".`);
  return found[0];
}

/** The dependsOn list of one bom-ref. An absent dependsOn reads as no edges. */
export function dependsOn(document: Json, ref: string): string[] {
  const found = (document.dependencies as Json[]).filter((d: Json) => d.ref === ref);
  assert.equal(found.length, 1, `Expected exactly one dependencies entry for "${ref}".`);
  return found[0].dependsOn !== undefined ? found[0].dependsOn.slice().sort() : [];
}
