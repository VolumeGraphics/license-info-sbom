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
|`SbomPackage`|The subset of collected package data the SBOM needs: `name`, `version`, and optionally `license`, `description`, `homepage`, `packageJson`, and the resolved `packageDependencies` / `packageDevDependencies` / `packageOptionalDependencies` arrays.|
|`SbomOptions`|`specVersion` (`"1.6"` \| `"1.5"` \| `"1.4"`, default `"1.6"`) and `includeLicenseText` (default `false`).|
|`SbomResult`|`{ type: "Sbom", json }` or `{ type: "Error", errors }`.|

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
