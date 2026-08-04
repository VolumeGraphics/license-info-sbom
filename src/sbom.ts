import { readFileSync } from 'node:fs'
import * as CDX from '@cyclonedx/cyclonedx-library'
import { PackageURL } from 'packageurl-js'
import spdxExpressionParse = require('spdx-expression-parse')
// Resolved from THIS package, deliberately. cyclonedx-library declares ajv as an
// optional peer dependency and then requires it from its own location, so in a consumer
// whose tree hoists a different ajv major it silently picks that one up and dies inside
// ajv-formats. ajv is a real dependency here, so npm guarantees a compatible copy is
// reachable - which is why validation happens in this module rather than through
// CDX.Validation.JsonValidator.
import ajvModule = require('ajv')
import ajvFormatsModule = require('ajv-formats')
import addFormats2019 = require('ajv-formats-draft2019')

// This project compiles without esModuleInterop, so reach for the default export by hand.
// ajv-formats-draft2019 has no default: its module *is* the function.
const Ajv = ajvModule.default;
const addFormats = ajvFormatsModule.default;

export type SbomSpecVersion = "1.6" | "1.5" | "1.4";

export type SbomOptions = {
  /**
   * CycloneDX specification version of the generated document. Defaults to "1.6".
   * Black Duck only gained CycloneDX 1.6 support in release 2025.1.0 - use "1.4"
   * for older installations.
   */
  specVersion?: SbomSpecVersion;
  /**
   * Embed the license texts as base64 attachments. Defaults to false: it multiplies
   * the file size and Black Duck does not read them.
   */
  includeLicenseText?: boolean;
  /**
   * Package URL type of the components, for example "npm" or "conan". Defaults to
   * "npm". Set to null to emit no package URL at all, which is the honest choice for
   * an ecosystem whose components cannot all be named by a single type: a wrong purl
   * is worse than none, because the purl is what Black Duck matches on.
   */
  purlType?: string | null;
  /**
   * Emit a randomly generated serialNumber. Defaults to true. Set to false, together
   * with timestamp, to make the document byte-for-byte reproducible.
   */
  serialNumber?: boolean;
  /**
   * Emit metadata.timestamp. Defaults to true. Set to false, together with
   * serialNumber, to make the document byte-for-byte reproducible.
   */
  timestamp?: boolean;
}

/**
 * The subset of the collected package data the SBOM needs. Declared structurally so
 * this module does not depend on which of the collector's types are re-exported.
 */
export type SbomPackage = {
  name: string;
  version: string;
  /**
   * Stable identity of this component. Defaults to name@version. Supply it when the
   * name is a display name rather than an identifier, so that bom-refs and dependency
   * edges key on something canonical.
   */
  bomRef?: string;
  license?: string;
  description?: string;
  homepage?: string;
  packageJson?: string[];
  packageDependencies?: SbomPackage[];
  packageDevDependencies?: SbomPackage[];
  packageOptionalDependencies?: SbomPackage[];
}

export type SbomInput = {
  /** The product itself, used for metadata.component. */
  product: SbomPackage;
  /** Every dependency to list as a component. */
  packages: SbomPackage[];
  /** License texts keyed by license name. Only consulted when includeLicenseText is set. */
  licenseTextByName: Map<string, string>;
  /** This tool, recorded in metadata.tools. */
  tool: { name: string, version: string };
  options: SbomOptions;
}

// A string discriminant, matching the ResultType style used for toDocument's result. A
// boolean discriminant would not narrow here, because this project compiles without
// strictNullChecks.
export type SbomResult =
  | { type: "Sbom", json: string }
  | { type: "Error", errors: string[] };

function specFor(version: SbomSpecVersion) {
  switch (version) {
    case "1.6": return CDX.Spec.Spec1dot6;
    case "1.5": return CDX.Spec.Spec1dot5;
    case "1.4": return CDX.Spec.Spec1dot4;
  }
}

/**
 * "@scope/name" -> { group: "@scope", name: "name" }. The group keeps the "@" so that
 * packageurl-js percent-encodes it into the purl namespace as "%40scope".
 */
function splitScopedName(fullName: string) {
  if (fullName.startsWith("@")) {
    const slash = fullName.indexOf("/");
    if (slash > 0)
      return { group: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
  }
  return { group: undefined, name: fullName };
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function origin(p: SbomPackage): string {
  return p.packageJson !== undefined && p.packageJson.length > 0 ? ` (${p.packageJson[0]})` : "";
}

/**
 * Compiles the CycloneDX JSON schema for one specification version.
 *
 * This is deliberately a local reimplementation of what cyclonedx-library does in
 * `_optPlug.node/__jsonValidators/ajv.js`, with the same ajv options, so behaviour is
 * unchanged. The point is only *which* ajv runs it: theirs is resolved from their own
 * location and can be an incompatible major that a consumer happened to hoist, ours is a
 * declared dependency of this package. The library offers no way to inject an instance.
 *
 * Schema file locations come from the library rather than being hard-wired, so the schema
 * always matches the serializer that produced the document.
 */
function compileValidator(spec: NonNullable<ReturnType<typeof specFor>>) {
  // _Resources is exported at runtime from the package's main entry but is absent from
  // its type declarations, so describe just the two members used here.
  type SchemaFiles = {
    CDX: { JSON_SCHEMA: Record<string, string | undefined> },
    SPDX: { JSON_SCHEMA: string },
    CryptoDefs: { JSON_SCHEMA: string },
    JSF: { JSON_SCHEMA: string }
  };
  const files = (CDX as unknown as { _Resources: { FILES: SchemaFiles } })._Resources.FILES;

  // JSON_SCHEMA has entries for specification versions that ship no schema (1.0, 1.1).
  const schemaFile = files.CDX.JSON_SCHEMA[spec.version];
  if (schemaFile === undefined)
    throw new Error(`No CycloneDX JSON schema is available for specification version ${spec.version}.`);

  const readSchema = (file: string) => JSON.parse(readFileSync(file, 'utf-8'));

  const ajv = new Ajv({
    useDefaults: false,
    strict: false,
    strictSchema: false,
    addUsedSchema: false,
    // No network access, ever. The schema references its siblings by absolute URI, and
    // those are supplied from local files below; anything else is an error rather than a
    // silent fetch.
    loadSchema: (uri: string) => { throw new Error(`Remote schemas are disabled: ${uri}`) },
    // Keyed by the exact URIs the CycloneDX schema $refs, or the references do not resolve.
    schemas: {
      'http://cyclonedx.org/schema/spdx.SNAPSHOT.schema.json': readSchema(files.SPDX.JSON_SCHEMA),
      'http://cyclonedx.org/schema/cryptography-defs.SNAPSHOT.schema.json': readSchema(files.CryptoDefs.JSON_SCHEMA),
      'http://cyclonedx.org/schema/jsf-0.82.SNAPSHOT.schema.json': readSchema(files.JSF.JSON_SCHEMA)
    }
  });

  // ajv ships no formats of its own. Without these the schema still compiles, but every
  // "format" assertion silently becomes a no-op, which is worse than failing.
  addFormats(ajv);
  addFormats2019(ajv, { formats: ['idn-email'] });
  // Provided by neither formats package; registering it keeps it a known no-op rather
  // than an unknown format.
  ajv.addFormat('iri-reference', true);

  return ajv.compile(readSchema(schemaFile));
}

/**
 * Renders the validator's findings one per line. The raw error array is an ajv
 * structure that is unreadable when dumped into a build log verbatim.
 */
function formatSchemaErrors(errors: unknown): string {
  const list: any[] = Array.isArray(errors) ? errors : [errors];
  const lines = list.map((e: any) => {
    if (typeof e !== "object" || e === null)
      return "  " + String(e);
    const at = isNonEmpty(e.instancePath) ? e.instancePath : "/";
    const params = e.params !== undefined && Object.keys(e.params).length > 0
      ? " " + JSON.stringify(e.params)
      : "";
    return "  " + at + ": " + (e.message !== undefined ? e.message : "invalid") + params;
  });
  return "The generated SBOM does not validate against the CycloneDX schema:\n" + lines.join("\n");
}

/**
 * Builds a CycloneDX SBOM from the collected package data and validates it against the
 * CycloneDX JSON schema. Returns the errors instead of a document if either the input
 * data or the resulting document is not valid, so that the caller can abort before
 * anything is written to disk.
 */
export async function buildSbom(input: SbomInput): Promise<SbomResult> {
  const specVersion = input.options.specVersion !== undefined ? input.options.specVersion : "1.6";
  const spec = specFor(specVersion);
  if (spec === undefined)
    return { type: "Error", errors: [`Unsupported CycloneDX specification version "${specVersion}". Supported versions are 1.6, 1.5 and 1.4.`] };

  // Check the input data first, and report every problem rather than only the first one.
  // A component without a name makes Black Duck reject the entire SBOM, and a component
  // without a version yields an incomplete package URL, which degrades matching.
  const errors: string[] = [];
  const checkPackage = (p: SbomPackage, role: string) => {
    if (!isNonEmpty(p.name))
      errors.push(`${role} has no name${origin(p)}. A CycloneDX component requires a name, and Black Duck rejects the whole SBOM if a single component is missing one.`);
    if (!isNonEmpty(p.version))
      errors.push(`${role} "${p.name}" has no version${origin(p)}. Without a version the package URL is incomplete and component matching degrades.`);
  };
  checkPackage(input.product, "The product");
  for (const p of input.packages)
    checkPackage(p, "Dependency");
  if (errors.length !== 0)
    return { type: "Error", errors };

  // An explicit null means "emit no purl"; leaving it out keeps the npm default.
  const purlType = input.options.purlType !== undefined ? input.options.purlType : "npm";

  const licenseFactory = new CDX.Contrib.License.Factories.LicenseFactory(spdxExpressionParse);

  // bom-refs are derived from name@version so that repeated runs produce the same
  // document. Duplicates would otherwise be replaced by random values during
  // serialization, silently, so make them unique here instead.
  const usedRefs = new Set<string>();
  const uniqueRef = (base: string) => {
    let ref = base;
    for (let i = 2; usedRefs.has(ref); ++i)
      ref = base + "#" + i;
    usedRefs.add(ref);
    return ref;
  };

  const addLicense = (component: CDX.Models.Component, license: string | undefined) => {
    if (!isNonEmpty(license))
      return;
    // The collector yields exactly one license string per package, so a component never
    // holds more than one license. That matters: a set mixing an expression with other
    // licenses loses all but the first expression during normalization.
    const model = licenseFactory.makeFromString(license as string);
    if (input.options.includeLicenseText === true && !(model instanceof CDX.Models.LicenseExpression)) {
      const text = input.licenseTextByName.get(license as string);
      if (text !== undefined)
        model.text = new CDX.Models.Attachment(Buffer.from(text, "utf-8").toString("base64"), {
          contentType: "text/plain",
          encoding: CDX.Enums.AttachmentEncoding.Base64
        });
    }
    component.licenses.add(model);
  };

  const makeComponent = (p: SbomPackage, type: CDX.Enums.ComponentType) => {
    const split = splitScopedName(p.name);
    const component = new CDX.Models.Component(type, split.name, {
      group: split.group,
      version: p.version,
      description: isNonEmpty(p.description) ? p.description : undefined,
      bomRef: uniqueRef(isNonEmpty(p.bomRef) ? p.bomRef as string : p.name + "@" + p.version)
    });
    if (purlType !== null) {
      try {
        component.purl = new PackageURL(purlType, split.group, split.name, p.version, undefined, undefined).toString();
      } catch (e) {
        errors.push(`Could not build a package URL for "${p.name}@${p.version}"${origin(p)}: ${e.message}`);
      }
    }
    if (isNonEmpty(p.homepage))
      component.externalReferences.add(new CDX.Models.ExternalReference(
        p.homepage as string, CDX.Enums.ExternalReferenceType.Website));
    addLicense(component, p.license);
    return component;
  };

  const bom = new CDX.Models.Bom();
  bom.version = 1;
  // Both are random or wall-clock, so they are the only reason two runs over identical
  // input differ. Everything else is sorted and content-derived.
  if (input.options.serialNumber !== false)
    bom.serialNumber = CDX.Contrib.Bom.Utils.randomSerialNumber();
  if (input.options.timestamp !== false)
    bom.metadata.timestamp = new Date();

  // Record this tool under metadata.tools.components. Anything placed in
  // metadata.tools.tools collapses the whole block to the deprecated flat form.
  const toolSplit = splitScopedName(input.tool.name);
  bom.metadata.tools.components.add(new CDX.Models.Component(
    CDX.Enums.ComponentType.Application, toolSplit.name, {
      group: toolSplit.group,
      version: input.tool.version,
      bomRef: uniqueRef("tool:" + input.tool.name)
    }));

  // The product is the root component. Black Duck derives the scan / code location name
  // from it; the project and version are mapped by hand after the upload.
  const rootComponent = makeComponent(input.product, CDX.Enums.ComponentType.Application);
  bom.metadata.component = rootComponent;

  const componentOf = new Map<SbomPackage, CDX.Models.Component>();
  for (const p of input.packages) {
    const component = makeComponent(p, CDX.Enums.ComponentType.Library);
    bom.components.add(component);
    componentOf.set(p, component);
  }

  if (errors.length !== 0)
    return { type: "Error", errors };

  // Dependency edges. The collector's resolved dependency arrays hold the very same
  // objects that are in `packages`, so the map lookup works by identity.
  //
  // Development edges are taken from the product only. npm never installs the
  // devDependencies of a dependency, so a development edge on a third-party package can
  // only have been resolved against some unrelated package that happens to satisfy the
  // version range - the collector resolves by searching the flat package list, not by
  // walking node_modules. Following those would claim edges that do not exist.
  const edgesOf = (p: SbomPackage, includeDevelopment: boolean) => ([] as SbomPackage[]).concat(
    p.packageDependencies !== undefined ? p.packageDependencies : [],
    p.packageOptionalDependencies !== undefined ? p.packageOptionalDependencies : [],
    includeDevelopment && p.packageDevDependencies !== undefined ? p.packageDevDependencies : []
  );
  const addEdges = (from: CDX.Models.Component, p: SbomPackage, includeDevelopment: boolean) => {
    for (const dependency of edgesOf(p, includeDevelopment)) {
      const to = componentOf.get(dependency);
      if (to !== undefined && to !== from)
        from.dependencies.add(to.bomRef);
    }
  };
  addEdges(rootComponent, input.product, true);
  for (const p of input.packages) {
    const from = componentOf.get(p);
    if (from !== undefined)
      addEdges(from, p, false);
  }

  const serializer = new CDX.Serialize.JsonSerializer(new CDX.Serialize.JSON.Normalize.Factory(spec));
  const json = serializer.serialize(bom, { sortLists: true, space: 2 });

  // Validate before handing the document back, so the caller can abort before writing.
  let validate;
  try {
    validate = compileValidator(spec);
  } catch (e) {
    // Never let "validated" degrade silently into "not validated" - that is the whole
    // point of generating the document here. Name the ajv in use: the failure mode this
    // guards against is an incompatible one being picked up.
    return { type: "Error", errors: [`Could not validate the generated SBOM against the CycloneDX ${specVersion} schema: ${e.message}`] };
  }

  // Validate the serialized document rather than the model, so what is checked is exactly
  // the bytes the caller is about to write.
  if (!validate(JSON.parse(json)))
    return { type: "Error", errors: [formatSchemaErrors(validate.errors)] };

  return { type: "Sbom", json };
}
