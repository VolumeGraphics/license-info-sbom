import { describe, it } from 'node:test'
import assert = require('node:assert/strict')
import { SbomPackage } from '../src/sbom'
import { Json, buildDocument, dependsOn } from './helpers'

describe("the dependency graph", () => {
  it("has an entry for every component, including the product", async () => {
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3" },
      packages: [{ name: "alpha", version: "2.0.0" }, { name: "zeta", version: "2.0.0" }]
    });
    assert.deepEqual(document.dependencies.map((d: Json) => d.ref).sort(),
      ["alpha@2.0.0", "my-product@1.2.3", "zeta@2.0.0"]);
  });

  it("takes the product's runtime, optional and development edges", async () => {
    // The product's devDependencies are installed, so they are part of what was built.
    const runtime = { name: "runtime", version: "2.0.0" };
    const optional = { name: "optional", version: "2.0.0" };
    const development = { name: "development", version: "2.0.0" };
    const document = await buildDocument({
      product: {
        name: "my-product", version: "1.2.3",
        packageDependencies: [runtime],
        packageOptionalDependencies: [optional],
        packageDevDependencies: [development]
      },
      packages: [runtime, optional, development]
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"),
      ["development@2.0.0", "optional@2.0.0", "runtime@2.0.0"]);
  });

  it("takes a dependency's runtime and optional edges, but not its development ones", async () => {
    // npm never installs the devDependencies of a dependency, so a development edge on a
    // third-party package can only have been resolved against some unrelated package that
    // happens to satisfy the version range. Following it would claim an edge that is not
    // there.
    const runtime = { name: "runtime", version: "2.0.0" };
    const optional = { name: "optional", version: "2.0.0" };
    const development = { name: "development", version: "2.0.0" };
    const middle = {
      name: "middle", version: "2.0.0",
      packageDependencies: [runtime],
      packageOptionalDependencies: [optional],
      packageDevDependencies: [development]
    };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [middle] },
      packages: [middle, runtime, optional, development]
    });
    assert.deepEqual(dependsOn(document, "middle@2.0.0"), ["optional@2.0.0", "runtime@2.0.0"]);
    // Still listed as a component: it is installed, just not depended upon by `middle`.
    assert.deepEqual(dependsOn(document, "development@2.0.0"), []);
  });

  it("mentions a dependency only once when it appears in several kinds", async () => {
    const both = { name: "both", version: "2.0.0" };
    const document = await buildDocument({
      product: {
        name: "my-product", version: "1.2.3",
        packageDependencies: [both],
        packageOptionalDependencies: [both],
        packageDevDependencies: [both]
      },
      packages: [both]
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), ["both@2.0.0"]);
  });

  it("has no edges when no dependency arrays are given", async () => {
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3" },
      packages: [{ name: "dependency", version: "2.0.0" }]
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), []);
    assert.deepEqual(dependsOn(document, "dependency@2.0.0"), []);
  });

  it("drops an edge to a package that is not listed as a component", async () => {
    const unlisted = { name: "unlisted", version: "2.0.0" };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [unlisted] },
      packages: []
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), []);
  });

  it("resolves edges by object identity, not by name and version", async () => {
    // The collector's resolved dependency arrays hold the very same objects that are in
    // `packages`. An equal-looking copy is a different package as far as this is concerned.
    const listed = { name: "dependency", version: "2.0.0" };
    const copy = { name: "dependency", version: "2.0.0" };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [copy] },
      packages: [listed]
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), []);
  });

  it("has no self edge for a package that depends on itself", async () => {
    // This pins the document, not the guard in buildSbom: the serializer drops a self
    // reference during normalization, so no input can produce one either way.
    const selfish: SbomPackage = { name: "selfish", version: "2.0.0" };
    selfish.packageDependencies = [selfish];
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [selfish] },
      packages: [selfish]
    });
    assert.deepEqual(dependsOn(document, "selfish@2.0.0"), []);
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), ["selfish@2.0.0"]);
  });

  it("keeps both directions of a cycle between two components", async () => {
    const first: SbomPackage = { name: "first", version: "2.0.0" };
    const second: SbomPackage = { name: "second", version: "2.0.0", packageDependencies: [first] };
    first.packageDependencies = [second];
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [first] },
      packages: [first, second]
    });
    assert.deepEqual(dependsOn(document, "first@2.0.0"), ["second@2.0.0"]);
    assert.deepEqual(dependsOn(document, "second@2.0.0"), ["first@2.0.0"]);
  });

  it("points at the deduplicated ref of a repeated name and version", async () => {
    // Two distinct packages that happen to share a name and a version get distinct refs,
    // and each edge has to name the one it actually points at.
    const first = { name: "dependency", version: "2.0.0", license: "MIT" };
    const second = { name: "dependency", version: "2.0.0", license: "ISC" };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [second] },
      packages: [first, second]
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), ["dependency@2.0.0#2"]);
  })
})
