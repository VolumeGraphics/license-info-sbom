import { describe, it } from 'node:test'
import assert = require('node:assert/strict')
import { DEPENDENCY_TYPES, DependencyType, SbomPackage } from '../src/sbom'
import { Json, buildDocument, buildErrors, dependsOn } from './helpers'

/** The names of the listed components, sorted. An absent components list reads as none. */
function names(document: Json): string[] {
  return ((document.components || []) as Json[]).map((c: Json) => c.name).sort();
}

describe("dependencyTypes", () => {
  it("lists every given package when left out, reached or not", async () => {
    const runtime = { name: "runtime", version: "2.0.0" };
    const unreached = { name: "unreached", version: "2.0.0" };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [runtime] },
      packages: [runtime, unreached]
    });
    assert.deepEqual(names(document), ["runtime", "unreached"]);
  });

  it("lists what the product reaches through the given fields", async () => {
    const runtime = { name: "runtime", version: "2.0.0" };
    const optional = { name: "optional", version: "2.0.0" };
    const development = { name: "development", version: "2.0.0" };
    const unreached = { name: "unreached", version: "2.0.0" };
    const product = {
      name: "my-product", version: "1.2.3",
      packageDependencies: [runtime],
      packageOptionalDependencies: [optional],
      packageDevDependencies: [development]
    };
    const listed = async (dependencyTypes: DependencyType[]) =>
      names(await buildDocument({ product, packages: [runtime, optional, development, unreached], options: { dependencyTypes } }));
    assert.deepEqual(await listed(["dependencies"]), ["runtime"]);
    assert.deepEqual(await listed(["dependencies", "optionalDependencies"]), ["optional", "runtime"]);
    assert.deepEqual(await listed(["devDependencies"]), ["development"]);
    assert.deepEqual(await listed(DEPENDENCY_TYPES), ["development", "optional", "runtime"]);
  });

  it("follows the dependencies below the product whichever fields are given", async () => {
    // What a build tool needs to run is part of what building needs.
    const library = { name: "library", version: "2.0.0" };
    const tool = { name: "tool", version: "2.0.0", packageDependencies: [library] };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDevDependencies: [tool] },
      packages: [tool, library],
      options: { dependencyTypes: ["devDependencies"] }
    });
    assert.deepEqual(names(document), ["library", "tool"]);
  });

  it("follows optionalDependencies below the product only when they are given", async () => {
    const native = { name: "native", version: "2.0.0" };
    const library = { name: "library", version: "2.0.0", packageOptionalDependencies: [native] };
    const product = { name: "my-product", version: "1.2.3", packageDependencies: [library] };
    const listed = async (dependencyTypes: DependencyType[]) =>
      names(await buildDocument({ product, packages: [library, native], options: { dependencyTypes } }));
    assert.deepEqual(await listed(["dependencies"]), ["library"]);
    assert.deepEqual(await listed(["dependencies", "optionalDependencies"]), ["library", "native"]);
  });

  it("never follows the devDependencies of a dependency", async () => {
    // npm never installs them, so an installed package that matches one of them is there
    // for some other reason, or for none.
    const unrelated = { name: "unrelated", version: "2.0.0" };
    const library = { name: "library", version: "2.0.0", packageDevDependencies: [unrelated] };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [library] },
      packages: [library, unrelated],
      options: { dependencyTypes: DEPENDENCY_TYPES }
    });
    assert.deepEqual(names(document), ["library"]);
  });

  it("lists a package needed both at runtime and for building in both documents", async () => {
    const shared = { name: "shared", version: "2.0.0" };
    const tool = { name: "tool", version: "2.0.0", packageDependencies: [shared] };
    const product = {
      name: "my-product", version: "1.2.3",
      packageDependencies: [shared],
      packageDevDependencies: [tool]
    };
    const listed = async (dependencyTypes: DependencyType[]) =>
      names(await buildDocument({ product, packages: [shared, tool], options: { dependencyTypes } }));
    assert.deepEqual(await listed(["dependencies"]), ["shared"]);
    assert.deepEqual(await listed(["devDependencies"]), ["shared", "tool"]);
  });

  it("gives the product no edge of a field the document does not cover", async () => {
    // Otherwise the graph of what ships would claim a direct dependency on a package that
    // it only needs indirectly.
    const indirect = { name: "indirect", version: "2.0.0" };
    const direct = { name: "direct", version: "2.0.0", packageDependencies: [indirect] };
    const document = await buildDocument({
      product: {
        name: "my-product", version: "1.2.3",
        packageDependencies: [direct],
        packageDevDependencies: [indirect]
      },
      packages: [direct, indirect],
      options: { dependencyTypes: ["dependencies"] }
    });
    assert.deepEqual(dependsOn(document, "my-product@1.2.3"), ["direct@2.0.0"]);
    assert.deepEqual(dependsOn(document, "direct@2.0.0"), ["indirect@2.0.0"]);
  });

  it("does not reach through a package that is not given", async () => {
    const behind = { name: "behind", version: "2.0.0" };
    const notGiven = { name: "not-given", version: "2.0.0", packageDependencies: [behind] };
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [notGiven] },
      packages: [behind],
      options: { dependencyTypes: ["dependencies"] }
    });
    assert.deepEqual(names(document), []);
  });

  it("terminates on a cycle", async () => {
    const first: SbomPackage = { name: "first", version: "2.0.0" };
    const second: SbomPackage = { name: "second", version: "2.0.0", packageDependencies: [first] };
    first.packageDependencies = [second];
    const document = await buildDocument({
      product: { name: "my-product", version: "1.2.3", packageDependencies: [first] },
      packages: [first, second],
      options: { dependencyTypes: ["dependencies"] }
    });
    assert.deepEqual(names(document), ["first", "second"]);
  });

  it("checks only the packages it lists", async () => {
    // A development-only package without a version must not fail a document of what ships,
    // while it still fails a document it is part of.
    const runtime = { name: "runtime", version: "2.0.0" };
    const broken = { name: "broken", version: "" };
    const product = {
      name: "my-product", version: "1.2.3",
      packageDependencies: [runtime],
      packageDevDependencies: [broken]
    };
    const document = await buildDocument({ product, packages: [runtime, broken], options: { dependencyTypes: ["dependencies"] } });
    assert.deepEqual(names(document), ["runtime"]);
    const errors = await buildErrors({ product, packages: [runtime, broken], options: { dependencyTypes: DEPENDENCY_TYPES } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /"broken" has no version/);
  });

  it("rejects an empty list", async () => {
    const errors = await buildErrors({ options: { dependencyTypes: [] } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /dependencyTypes is empty/);
  });

  it("rejects an unknown type and names it", async () => {
    const errors = await buildErrors({ options: { dependencyTypes: ["dependencies", "devDependency" as DependencyType] } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Unknown dependency type "devDependency"/);
  });
})
