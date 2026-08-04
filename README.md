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
|`SbomPackage`|The subset of collected package data the SBOM needs: `name`, `version`, and optionally `bomRef`, `license`, `description`, `homepage`, `packageJson`, and the resolved `packageDependencies` / `packageDevDependencies` / `packageOptionalDependencies` arrays.|
|`SbomOptions`|See the options table below.|
|`SbomResult`|`{ type: "Sbom", json }` or `{ type: "Error", errors }`.|

## Options

|Option|Default|Description|
|:-----|:------|:----------|
|`specVersion`|`"1.6"`|`"1.6"`, `"1.5"` or `"1.4"`. Black Duck only gained 1.6 support in release 2025.1.0.|
|`includeLicenseText`|`false`|Embed license texts as base64 attachments. Multiplies the file size, and Black Duck does not read them.|
|`purlType`|`"npm"`|Package URL type of the components, e.g. `"npm"` or `"conan"`. Set to `null` to emit no package URL at all.|
|`serialNumber`|`true`|Emit a randomly generated `serialNumber`.|
|`timestamp`|`true`|Emit `metadata.timestamp`.|

### Ecosystems other than npm

The default `purlType` is `"npm"`, and scoped names of the form `@scope/name` are split into
a purl namespace and name accordingly. For a different ecosystem, either set `purlType` to
that ecosystem's type, or set it to `null`.

Prefer `null` over a type that is only right for part of your dependency set. The purl is
what Black Duck matches on, so a purl naming the wrong ecosystem produces confidently wrong
matches — which is worse than no purl, where matching falls back to name and version.

### Reproducible output

`serialNumber` and `timestamp` are the only non-deterministic parts of the document:
everything else is sorted and content-derived. Set both to `false` and two runs over
identical input produce byte-identical output.

### Display names

`bom-ref` defaults to `name@version`. If your `name` is a human-readable display name
rather than an identifier, supply `bomRef` explicitly so that bom-refs and dependency edges
key on something canonical while the rendered `name` stays human-readable.

## Input validation

Every component must have a name and a version, and all problems are reported at once
rather than only the first. A component without a name makes Black Duck reject the entire
SBOM; without a version the package URL is incomplete and component matching degrades.

## What the document contains

Per component: `type`, `name`, `group` for scoped packages, `version`, a `purl`, a unique
`bom-ref`, the `licenses` entry, and the homepage as an external reference. The document
carries a `serialNumber`, `metadata.timestamp`, `metadata.tools`, `metadata.component` for
the product, and a `dependencies` graph built from the resolved dependency arrays.

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
