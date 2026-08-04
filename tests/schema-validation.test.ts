import { describe, it } from 'node:test'
import assert = require('node:assert/strict')
import { SbomSpecVersion } from '../src/sbom'
import { build, buildErrors } from './helpers'

/**
 * Longer than the 1024 characters the CycloneDX 1.6 schema allows for a version; 1.5 and 1.4
 * leave the length unbounded. Nothing in the input checks bounds it either, so this is a
 * document that only validating the serialized bytes catches - which is the point of
 * validating them.
 */
const OVERLONG_VERSION = "2.0.0-" + "x".repeat(1024);

/**
 * The findings, without the header line. What sits between the instance path and the params
 * is ajv's own wording and is deliberately not asserted anywhere: the contract here is one
 * readable line per finding, saying where in the document it is - not ajv's prose.
 */
function findings(error: string): string[] {
  const lines = error.split("\n");
  assert.equal(lines[0], "The generated SBOM does not validate against the CycloneDX schema:");
  return lines.slice(1);
}

describe("schema validation", () => {
  it("reports a document that does not validate against the schema", async () => {
    const errors = await buildErrors({ packages: [{ name: "dependency", version: OVERLONG_VERSION }] });
    // One error, not one per finding: the whole report is a single message for the caller to
    // put into a build log.
    assert.equal(errors.length, 1);
    const lines = findings(errors[0]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^ {2}\/components\/0\/version: .+ \{"limit":1024\}$/);
  });

  it("hands back no document alongside the findings", async () => {
    // The caller aborts on an error, so an invalid document must not also be reachable.
    const result = await build({ packages: [{ name: "dependency", version: OVERLONG_VERSION }] });
    assert.equal(result.type, "Error");
    assert.equal("json" in result, false);
  });

  it("locates a finding in the product rather than in the component list", async () => {
    const errors = await buildErrors({ product: { name: "product", version: OVERLONG_VERSION } });
    assert.deepEqual(findings(errors[0]).map(line => line.split(":")[0]), ["  /metadata/component/version"]);
  });

  it("renders every finding of one failure on a line of its own", async () => {
    // An over-long tool version breaks the object form of metadata.tools, and with it the
    // oneOf that offers the deprecated flat form as the alternative - so a single mistake
    // yields a finding for the violation itself, one for the branch it does not fit, and one
    // for the oneOf. All three have to be readable.
    const errors = await buildErrors({ tool: { name: "generator", version: OVERLONG_VERSION } });
    assert.equal(errors.length, 1);
    const lines = findings(errors[0]);
    assert.deepEqual(lines.map(line => line.split(":")[0]), [
      "  /metadata/tools/components/0/version",
      "  /metadata/tools",
      "  /metadata/tools"
    ]);
    for (const line of lines)
      assert.match(line, /^ {2}\/metadata\/tools\S*: \S.* \{.+\}$/);
  });

  it("reports the first violation only, unlike the input checks", async () => {
    // The ajv options mirror the ones cyclonedx-library uses, and those leave allErrors off.
    // Worth knowing when reading a report: a second over-long version is not mentioned.
    const errors = await buildErrors({
      packages: [
        { name: "first", version: OVERLONG_VERSION },
        { name: "second", version: OVERLONG_VERSION }
      ]
    });
    assert.equal(findings(errors[0]).length, 1);
  });

  it("validates against the requested specification version, not one fixed schema", async () => {
    // Only 1.6 bounds the length of a component version - 1.5 and 1.4 declare it as a plain
    // string - so the very document 1.6 rejects has to pass under the older two. Were one
    // fixed schema used for all of them, one of these would come out wrong.
    const packages = [{ name: "dependency", version: OVERLONG_VERSION }];
    const errors = await buildErrors({ packages, options: { specVersion: "1.6" } });
    assert.deepEqual(findings(errors[0]).map(line => line.split(":")[0]), ["  /components/0/version"]);

    for (const specVersion of ["1.5", "1.4"] as SbomSpecVersion[]) {
      const result = await build({ packages, options: { specVersion } });
      assert.equal(result.type, "Sbom", `${specVersion} does not bound a component version`);
    }
  })
})
