import { describe, it } from 'node:test'
import assert = require('node:assert/strict')
import { buildSbom, SbomSpecVersion } from '../src/sbom'
import { Json, TOOL, buildDocument, buildJson, component } from './helpers'

describe("the generated document", () => {
  it("is a CycloneDX 1.6 document by default", async () => {
    const document = await buildDocument();
    assert.equal(document.$schema, "http://cyclonedx.org/schema/bom-1.6.schema.json");
    assert.equal(document.bomFormat, "CycloneDX");
    assert.equal(document.specVersion, "1.6");
    assert.equal(document.version, 1);
  });

  // Getting a document back at all means it validated against that version's schema, which
  // is the whole point of asking for an older one.
  for (const specVersion of ["1.6", "1.5", "1.4"] as SbomSpecVersion[])
    it(`builds and validates a ${specVersion} document`, async () => {
      const document = await buildDocument({
        product: {
          name: "product", version: "1.0.0", license: "MIT", homepage: "https://example.com/",
          packageDependencies: [{ name: "@scope/dependency", version: "2.0.0" }]
        },
        packages: [{ name: "@scope/dependency", version: "2.0.0", license: "Public Domain", description: "A dependency" }],
        options: { specVersion }
      });
      assert.equal(document.$schema, `http://cyclonedx.org/schema/bom-${specVersion}.schema.json`);
      assert.equal(document.specVersion, specVersion);
    });

  it("records the product as metadata.component", async () => {
    const document = await buildDocument({
      product: {
        name: "my-product", version: "1.2.3",
        description: "The product itself", homepage: "https://example.com/product"
      }
    });
    assert.deepEqual(document.metadata.component, {
      type: "application",
      name: "my-product",
      version: "1.2.3",
      "bom-ref": "my-product@1.2.3",
      description: "The product itself",
      purl: "pkg:npm/my-product@1.2.3",
      externalReferences: [{ url: "https://example.com/product", type: "website" }]
    });
  });

  it("lists the packages as library components", async () => {
    const document = await buildDocument({
      packages: [{
        name: "dependency", version: "2.0.0",
        description: "A dependency", homepage: "https://example.com/dependency"
      }]
    });
    assert.deepEqual(document.components, [{
      type: "library",
      name: "dependency",
      version: "2.0.0",
      "bom-ref": "dependency@2.0.0",
      description: "A dependency",
      purl: "pkg:npm/dependency@2.0.0",
      externalReferences: [{ url: "https://example.com/dependency", type: "website" }]
    }]);
  });

  it("omits an absent or blank description and homepage", async () => {
    const document = await buildDocument({
      packages: [
        { name: "bare", version: "2.0.0" },
        { name: "blank", version: "2.0.0", description: "  ", homepage: "" }
      ]
    });
    for (const name of ["bare", "blank"]) {
      assert.equal("description" in component(document, name), false);
      assert.equal("externalReferences" in component(document, name), false);
    }
  });

  it("splits a scoped name into group and name", async () => {
    const document = await buildDocument({ packages: [{ name: "@scope/dependency", version: "2.0.0" }] });
    const dependency = component(document, "dependency");
    assert.equal(dependency.group, "@scope");
    // The group keeps the "@" so that it is percent-encoded into the purl namespace.
    assert.equal(dependency.purl, "pkg:npm/%40scope/dependency@2.0.0");
    // The bom-ref stays the name the caller passed in.
    assert.equal(dependency["bom-ref"], "@scope/dependency@2.0.0");
  });

  it("keeps a name that only looks scoped in one piece", async () => {
    const document = await buildDocument({ packages: [{ name: "@notascope", version: "2.0.0" }] });
    const dependency = component(document, "@notascope");
    assert.equal("group" in dependency, false);
  });

  it("sorts the components, so their order does not depend on the input order", async () => {
    const names = ["zeta", "alpha", "mu"];
    const document = await buildDocument({ packages: names.map(name => ({ name, version: "2.0.0" })) });
    assert.deepEqual(document.components.map((c: Json) => c.name), ["alpha", "mu", "zeta"]);
  });

  it("carries no components at all when there are no packages", async () => {
    const document = await buildDocument({ packages: [] });
    assert.deepEqual(document.components, []);
  });
})

describe("metadata.tools", () => {
  it("records the tool as a component rather than in the deprecated flat form", async () => {
    // Anything placed in metadata.tools.tools collapses the whole block to the flat form,
    // so assert on the shape and not only on the name.
    const document = await buildDocument({ tool: { name: "@vendor/generator", version: "9.9.9" } });
    assert.deepEqual(document.metadata.tools, {
      components: [{
        type: "application",
        name: "generator",
        group: "@vendor",
        version: "9.9.9",
        "bom-ref": "tool:@vendor/generator"
      }]
    });
  });

  it("uses the flat form for 1.4, which has no other", async () => {
    const document = await buildDocument({
      tool: { name: "@vendor/generator", version: "9.9.9" },
      options: { specVersion: "1.4" }
    });
    assert.deepEqual(document.metadata.tools, [{ vendor: "@vendor", name: "generator", version: "9.9.9" }]);
  })
})

describe("bom-ref", () => {
  it("defaults to name@version", async () => {
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3" },
      packages: [{ name: "dependency", version: "2.0.0" }]
    });
    assert.equal(document.metadata.component["bom-ref"], "my-product@1.2.3");
    assert.equal(component(document, "dependency")["bom-ref"], "dependency@2.0.0");
  });

  it("takes an explicit ref, so a display name can stay human-readable", async () => {
    const document = await buildDocument({
      product: { name: "My Product", version: "1.2.3", bomRef: "my-product" },
      packages: [{ name: "Some Library", version: "2.0.0", bomRef: "some-library" }]
    });
    assert.equal(document.metadata.component.name, "My Product");
    assert.equal(document.metadata.component["bom-ref"], "my-product");
    assert.equal(component(document, "Some Library")["bom-ref"], "some-library");
  });

  it("ignores a blank explicit ref", async () => {
    const document = await buildDocument({ product: { name: "my-product", version: "1.2.3", bomRef: " " } });
    assert.equal(document.metadata.component["bom-ref"], "my-product@1.2.3");
  });

  it("makes repeated refs unique, rather than letting serialization replace them", async () => {
    // Two packages of the same name and version are not the same component: they may carry
    // different licenses. Duplicate refs would be replaced by random values during
    // serialization, silently.
    const document = await buildDocument({
      packages: [
        { name: "dependency", version: "2.0.0", license: "MIT" },
        { name: "dependency", version: "2.0.0", license: "Apache-2.0" },
        { name: "dependency", version: "2.0.0", license: "ISC" }
      ]
    });
    assert.deepEqual(document.components.map((c: Json) => c["bom-ref"]).sort(),
      ["dependency@2.0.0", "dependency@2.0.0#2", "dependency@2.0.0#3"]);
  });

  it("keeps an explicit ref clear of the ref the tool takes", async () => {
    const document = await buildDocument({
      tool: { name: "generator", version: "9.9.9" },
      packages: [{ name: "dependency", version: "2.0.0", bomRef: "tool:generator" }]
    });
    assert.equal(document.metadata.tools.components[0]["bom-ref"], "tool:generator");
    assert.equal(component(document, "dependency")["bom-ref"], "tool:generator#2");
  })
})

describe("purlType", () => {
  it("defaults to npm", async () => {
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3" },
      packages: [{ name: "dependency", version: "2.0.0" }]
    });
    assert.equal(document.metadata.component.purl, "pkg:npm/my-product@1.2.3");
    assert.equal(component(document, "dependency").purl, "pkg:npm/dependency@2.0.0");
  });

  it("names the configured ecosystem", async () => {
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3" },
      packages: [{ name: "dependency", version: "2.0.0" }],
      options: { purlType: "conan" }
    });
    assert.equal(document.metadata.component.purl, "pkg:conan/my-product@1.2.3");
    assert.equal(component(document, "dependency").purl, "pkg:conan/dependency@2.0.0");
  });

  it("emits no package URL at all when null", async () => {
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3" },
      packages: [{ name: "@scope/dependency", version: "2.0.0" }],
      options: { purlType: null }
    });
    assert.equal("purl" in document.metadata.component, false);
    const dependency = component(document, "dependency");
    assert.equal("purl" in dependency, false);
    // The scoped name is still split: group and name are not there for the purl's sake.
    assert.equal(dependency.group, "@scope");
  })
})

describe("serialNumber and timestamp", () => {
  it("are both emitted by default", async () => {
    // buildSbom's own defaults, so this one goes around the test helper.
    const before = new Date();
    const result = await buildSbom({
      product: { name: "my-product", version: "1.2.3" },
      packages: [],
      licenseTextByName: new Map(),
      tool: TOOL,
      options: {}
    });
    if (result.type === "Error")
      assert.fail("buildSbom reported errors:\n" + result.errors.join("\n"));
    const document = JSON.parse(result.json);
    assert.match(document.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const timestamp = new Date(document.metadata.timestamp);
    assert.ok(timestamp.getTime() >= before.getTime(), `${document.metadata.timestamp} is before the call`);
    assert.ok(timestamp.getTime() <= Date.now(), `${document.metadata.timestamp} is after the call`);
  });

  it("differ between two runs over identical input", async () => {
    const first = await buildDocument({ options: { serialNumber: true, timestamp: true } });
    const second = await buildDocument({ options: { serialNumber: true, timestamp: true } });
    assert.notEqual(first.serialNumber, second.serialNumber);
  });

  it("are the only reason two runs differ: switching both off is byte-for-byte reproducible", async () => {
    const input = {
      product: {
        name: "my-product", version: "1.2.3", license: "MIT",
        packageDependencies: [{ name: "dependency", version: "2.0.0" }]
      },
      packages: [
        { name: "zeta", version: "2.0.0", license: "ISC", homepage: "https://example.com/zeta" },
        { name: "alpha", version: "2.0.0", license: "MIT OR Apache-2.0" }
      ],
      options: { serialNumber: false, timestamp: false }
    };
    assert.equal(await buildJson(input), await buildJson(input));
  });

  it("are absent from the document when switched off", async () => {
    const document = await buildDocument({ options: { serialNumber: false, timestamp: false } });
    assert.equal("serialNumber" in document, false);
    assert.equal("timestamp" in document.metadata, false);
  });

  it("can be switched off one at a time", async () => {
    const withTimestamp = await buildDocument({ options: { serialNumber: false, timestamp: true } });
    assert.equal("serialNumber" in withTimestamp, false);
    assert.ok("timestamp" in withTimestamp.metadata);

    const withSerialNumber = await buildDocument({ options: { serialNumber: true, timestamp: false } });
    assert.ok("serialNumber" in withSerialNumber);
    assert.equal("timestamp" in withSerialNumber.metadata, false);
  })
})
