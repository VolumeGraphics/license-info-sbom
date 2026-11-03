# @volumegraphics/license-info-sbom

Builds a [CycloneDX](https://cyclonedx.org/) JSON SBOM from already-collected package data
and validates it against the CycloneDX JSON schema before returning it.

This is a library only, with no command line interface. It does no dependency discovery of
its own: it reads no files, walks no `node_modules`, and resolves no version ranges.
Everything it needs is passed in, so the caller decides where the package data comes from.

# Install

`npm install --save "@volumegraphics/license-info-sbom"`

# Usage

```js
const { buildSbom } = require("@volumegraphics/license-info-sbom");

const result = await buildSbom({
  product: { name: "my-product", version: "1.2.3" },
  packages: [
    { name: "some-library", version: "4.5.6", license: "MIT", homepage: "https://example.com" }
  ],
  licenseTextByName: new Map(),
  tool: { name: "my-generator", version: "1.0.0" },
  options: { specVersion: "1.6" }
});

if (result.type === "Error") {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

fs.writeFileSync("bom.json", result.json);
```

`buildSbom` returns the errors instead of a document whenever either the input data or the
resulting document is invalid, so the caller can abort before writing anything to disk.

# API

|Type|Description|
|:---|:----------|
|`buildSbom(input: SbomInput): Promise<SbomResult>`|Builds and validates the document.|
|`SbomInput`|`product`, `packages`, `licenseTextByName`, `tool`, `options`.|
|`SbomPackage`|The subset of collected package data the SBOM needs: `name`, `version`, and optionally `bomRef`, `purlOptions`, `license`, `description`, `homepage`, `packageJson`, and the resolved `packageDependencies` / `packageDevDependencies` / `packageOptionalDependencies` arrays.|
|`SbomPurlOptions`|One mandatory property, `purl`: a package URL, or `null` for none. See the package URL section below.|
|`SbomOptions`|See the options table below.|
|`SbomResult`|`{ type: "Sbom", json }` or `{ type: "Error", errors }`.|
|`DependencyType`, `DEPENDENCY_TYPES`|The dependency fields a document can cover — `"dependencies"`, `"devDependencies"` and `"optionalDependencies"` — and the list of all of them.|

## Options

|Option|Default|Description|
|:-----|:------|:----------|
|`specVersion`|`"1.6"`|`"1.6"`, `"1.5"` or `"1.4"`. Black Duck only gained 1.6 support in release 2025.1.0.|
|`includeLicenseText`|`false`|Embed license texts as base64 attachments. Multiplies the file size, and Black Duck does not read them.|
|`serialNumber`|`true`|Emit a randomly generated `serialNumber`.|
|`timestamp`|`true`|Emit `metadata.timestamp`.|
|`dependencyTypes`|every package|Which of the product's dependency fields the document covers. See **Choosing what a document covers** below.|

### Reproducible output

`serialNumber` and `timestamp` are the only non-deterministic parts of the document:
everything else is sorted and content-derived. Set both to `false` and two runs over
identical input produce byte-identical output.

### Display names

`bom-ref` defaults to `name@version`. If your `name` is a human-readable display name
rather than an identifier, supply `bomRef` explicitly so that bom-refs and dependency edges
key on something canonical while the rendered `name` stays human-readable.

### Choosing what a document covers

Left out, `dependencyTypes` lists every package in `packages`, whether the product depends
on it or not. Given, the document lists only the packages the product reaches through those
of its dependency fields, so one collected dependency tree can yield several documents —
for example everything that was built, and what ships:

```js
const built = await buildSbom({ ...input, options: { dependencyTypes: ["dependencies", "devDependencies", "optionalDependencies"] } });
const shipped = await buildSbom({ ...input, options: { dependencyTypes: ["dependencies", "optionalDependencies"] } });
```

The fields name the product's own dependencies. Below the product, a package's
`dependencies` are always followed and its `optionalDependencies` only when
`"optionalDependencies"` is given, the way npm's `--omit=optional` works. A package's
`devDependencies` are never followed: npm does not install them, so such an edge could only
have been resolved against an unrelated package that happens to match the version range.

The dependency graph follows the same edges, so it never points outside the document.

## Package URLs

The package URL is decided per component, through `purlOptions` on the `SbomPackage` — the
product included, since that is an `SbomPackage` too.

|`purlOptions`|Result|
|:------------|:-----|
|left out|`pkg:npm/<name>@<version>` is built from the name and the version.|
|`{ purl: "pkg:conan/zlib@1.3.1?channel=stable" }`|That purl is used verbatim.|
|`{ purl: null }`|No `purl` is emitted for this component.|

`purl` is the only property, and it is mandatory: naming the component is the only thing the
options are for. Options without a usable purl are reported as an error rather than quietly
falling back to the npm default — leave the options out to ask for that, and set `purl` to
`null` to ask for no package URL at all.

The built purl is always an npm one, and scoped names of the form `@scope/name` are split
into a purl namespace and name accordingly.

A given `purl` is taken as it stands and is not checked, so it is the way to name a component
whose ecosystem needs qualifiers, or whose real name differs from the `name` in the document.

Prefer a null `purl` over one you are not sure of. The purl is what Black Duck matches on,
so a wrong one produces confidently wrong matches — worse than no purl, where matching falls
back to name and version. Being a per-component decision, a dependency set drawn from several
ecosystems does not have to make that trade for all of it at once: name each component the
way it can be named, and leave the rest without a purl.

## Input validation

Every component must have a name and a version, and all problems are reported at once
rather than only the first. A component without a name makes Black Duck reject the entire
SBOM; without a version the package URL is incomplete and component matching degrades.
With `dependencyTypes` only the packages the document lists are checked, so a
development-only package cannot fail a document of what ships.

## What the document contains

Per component: `type`, `name`, `group` for scoped packages, `version`, a `purl` unless that
component asked for none, a unique `bom-ref`, the `licenses` entry, and the homepage as an
external reference. The document carries a `serialNumber`, `metadata.timestamp`,
`metadata.tools`, `metadata.component` for the product, and a `dependencies` graph built
from the resolved dependency arrays.

Licenses follow the CycloneDX convention: a valid SPDX identifier becomes `license.id`, a
valid SPDX expression becomes `expression`, and anything else becomes free text in
`license.name`. So a value like `"Public Domain"`, which is not an SPDX identifier, still
produces a valid document.

## Validation

The document is validated against the CycloneDX JSON schema before it is returned.
Validation is never skipped: if the validator itself cannot be set up, that is reported as
an error too, because "validated" must not silently degrade into "not validated".

Validation is performed here rather than through `CDX.Validation.JsonValidator`, using this
package's own `ajv`. `@cyclonedx/cyclonedx-library` declares `ajv` as an *optional* peer
dependency and then resolves it from its own location, so in a project whose dependency
tree hoists a different `ajv` major, the library silently picks that one up and fails deep
inside `ajv-formats` with `TypeError: Cannot read properties of undefined (reading 'code')`.
It offers no way to inject an instance. Because `ajv` is a real dependency of this package,
npm always places a compatible copy where this module can reach it — so validation works
regardless of what the consuming project hoists. The ajv options and the schema files are
taken from the library itself, so behaviour and schema version match what it would have
done.

Note that `serialNumber` and `metadata.timestamp` differ on every run, so the output is not
byte-for-byte reproducible even though all lists are sorted.

# Tests

`npm test`

This compiles `src` and `tests` into `out-test` and runs the compiled JavaScript with node's
built-in test runner, so the tests need no framework and no dependency beyond the TypeScript
compiler that is here anyway.

They drive `buildSbom` through its public interface and assert on the serialized document,
because those are the bytes the caller writes to disk. Any test that gets a document back has
also asserted that the document validates against the CycloneDX schema, since `buildSbom`
returns errors instead of a document whenever it does not.

To debug them in VS Code, pick one of the two launch configurations. *Debug the open test
file* runs the compiled counterpart of the test file in the editor directly, so every test
executes in a single process and breakpoints always bind — that is the one to reach for while
working on a test. *Debug all tests* goes through `npm test`, where node's test runner puts
every test file in a child process of its own and the debugger attaches to each. Breakpoints
in `src` work in both, by way of the source maps the test build emits.

# Dependencies

`@cyclonedx/cyclonedx-library` declares `ajv`, `ajv-formats` and `ajv-formats-draft2019`
only as optional peer dependencies, which npm does not install automatically. They are
therefore real dependencies here — without them schema validation is unavailable, which
`buildSbom` treats as a failure.
