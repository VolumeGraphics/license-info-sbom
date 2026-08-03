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

The document is validated against the vendored CycloneDX JSON schema before it is
returned. Validation is never skipped: if the validator itself is unavailable, that is
reported as an error too, because "validated" must not silently degrade into
"not validated".

Note that `serialNumber` and `metadata.timestamp` differ on every run, so the output is not
byte-for-byte reproducible even though all lists are sorted.

# Dependencies

`@cyclonedx/cyclonedx-library` declares `ajv`, `ajv-formats` and `ajv-formats-draft2019`
only as optional peer dependencies, which npm does not install automatically. They are
therefore real dependencies here — without them schema validation is unavailable, which
`buildSbom` treats as a failure.
