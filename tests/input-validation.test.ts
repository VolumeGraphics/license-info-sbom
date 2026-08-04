import { describe, it } from 'node:test'
import assert = require('node:assert/strict')
import { build, buildErrors } from './helpers'

describe("input validation", () => {
  it("accepts a product with a name and a version", async () => {
    const result = await build({
      product: { name: "product", version: "1.0.0" },
      packages: [{ name: "dependency", version: "2.0.0" }]
    });
    assert.equal(result.type, "Sbom");
  });

  it("rejects a product without a name", async () => {
    const errors = await buildErrors({ product: { name: "", version: "1.0.0" } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^The product has no name\./);
  });

  it("rejects a product without a version", async () => {
    const errors = await buildErrors({ product: { name: "product", version: "" } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^The product "product" has no version\./);
  });

  it("rejects a dependency without a name", async () => {
    const errors = await buildErrors({ packages: [{ name: "", version: "2.0.0" }] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Dependency has no name\./);
  });

  it("rejects a dependency without a version", async () => {
    const errors = await buildErrors({ packages: [{ name: "dependency", version: "" }] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Dependency "dependency" has no version\./);
  });

  it("treats a blank name or version as missing", async () => {
    const errors = await buildErrors({ packages: [{ name: "  ", version: "\t" }] });
    assert.equal(errors.length, 2);
  });

  it("reports every problem at once rather than only the first", async () => {
    const errors = await buildErrors({
      product: { name: "", version: "" },
      packages: [
        { name: "", version: "" },
        { name: "fine", version: "2.0.0" },
        { name: "versionless", version: "" }
      ]
    });
    assert.equal(errors.length, 5);
    assert.equal(errors.filter(e => e.indexOf("has no name") !== -1).length, 2);
    assert.equal(errors.filter(e => e.indexOf("has no version") !== -1).length, 3);
    assert.equal(errors.filter(e => e.indexOf("fine") !== -1).length, 0);
  });

  it("names the package.json a faulty component came from", async () => {
    const errors = await buildErrors({
      packages: [{
        name: "broken",
        version: "",
        // Only the first is named: it is there to point at a file, not to list every place
        // the package was found.
        packageJson: ["/project/node_modules/broken/package.json", "/elsewhere/package.json"]
      }]
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Dependency "broken" has no version \(\/project\/node_modules\/broken\/package\.json\)\./);
    assert.equal(errors[0].indexOf("/elsewhere/"), -1);
  });

  it("says nothing about the origin when there is no package.json", async () => {
    const errors = await buildErrors({ packages: [{ name: "broken", version: "", packageJson: [] }] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].indexOf("("), -1);
  });

  it("rejects an unsupported specification version", async () => {
    // The declared type admits only 1.6, 1.5 and 1.4. `any` stands in for a JavaScript
    // caller, or for a version read from a configuration file, which is where an
    // unsupported value actually comes from.
    const specVersion: any = "1.3";
    const errors = await buildErrors({ options: { specVersion } });
    assert.deepEqual(errors, [
      'Unsupported CycloneDX specification version "1.3". Supported versions are 1.6, 1.5 and 1.4.'
    ]);
  });

  it("reports every package URL that cannot be built", async () => {
    // An empty purlType is neither the npm default nor the explicit null that means "emit
    // no purl", so it reaches packageurl-js and is rejected there.
    const errors = await buildErrors({
      product: { name: "product", version: "1.0.0" },
      packages: [{ name: "dependency", version: "2.0.0" }],
      options: { purlType: "" }
    });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /^Could not build a package URL for "product@1\.0\.0": /);
    assert.match(errors[1], /^Could not build a package URL for "dependency@2\.0\.0": /);
  });

  it("reports a scoped name the configured ecosystem cannot express", async () => {
    // A purl namespace means something different in every ecosystem: conan demands a
    // channel qualifier alongside it. Better an error than a purl that Black Duck would
    // match on.
    const errors = await buildErrors({
      packages: [{ name: "@scope/dependency", version: "2.0.0" }],
      options: { purlType: "conan" }
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Could not build a package URL for "@scope\/dependency@2\.0\.0": .*conan/);
  })
})
