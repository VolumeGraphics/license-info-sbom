// Minimal ambient declarations for runtime dependencies that ship no type definitions
// of their own. Only the members actually used here are declared.

declare module 'ajv-formats-draft2019' {
  /**
   * Registers the draft-2019 formats on an Ajv instance. Typed loosely on purpose: the
   * only caller passes an Ajv from this package's own dependency, and narrowing it here
   * would tie this declaration to a specific ajv major.
   */
  function addFormats2019(ajv: unknown, options?: { formats?: string[] }): unknown;
  export = addFormats2019;
}

declare module 'spdx-expression-parse' {
  /**
   * Throws if the value is not a valid SPDX license expression. This throw-on-invalid
   * contract is exactly what the CycloneDX LicenseFactory expects to be injected.
   */
  function parse(expression: string): unknown;
  export = parse;
}
