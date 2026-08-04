import { describe, it } from 'node:test'
import assert = require('node:assert/strict')
import { buildDocument, component } from './helpers'

/** The licenses of one listed component, as they appear in the document. */
async function licensesOf(license: string, licenseTextByName = new Map<string, string>(), includeLicenseText?: boolean) {
  const document = await buildDocument({
    packages: [{ name: "dependency", version: "2.0.0", license }],
    licenseTextByName,
    options: { includeLicenseText }
  });
  return component(document, "dependency").licenses;
}

describe("licenses", () => {
  it("renders a valid SPDX identifier as license.id", async () => {
    assert.deepEqual(await licensesOf("MIT"), [{ license: { id: "MIT" } }]);
  });

  it("renders a valid SPDX expression as an expression", async () => {
    assert.deepEqual(await licensesOf("MIT OR Apache-2.0"), [{ expression: "MIT OR Apache-2.0" }]);
  });

  it("renders anything else as free text in license.name", async () => {
    // Not an SPDX identifier, and still has to produce a valid document.
    assert.deepEqual(await licensesOf("Public Domain"), [{ license: { name: "Public Domain" } }]);
  });

  it("omits the licenses entry when there is no license", async () => {
    const document = await buildDocument({ packages: [{ name: "dependency", version: "2.0.0" }] });
    assert.equal("licenses" in component(document, "dependency"), false);
  });

  it("omits the licenses entry for a blank license", async () => {
    const document = await buildDocument({ packages: [{ name: "dependency", version: "2.0.0", license: "   " }] });
    assert.equal("licenses" in component(document, "dependency"), false);
  });

  it("gives the product its license too", async () => {
    const document = await buildDocument({ product: { name: "my-product", version: "1.2.3", license: "MIT" } });
    assert.deepEqual(document.metadata.component.licenses, [{ license: { id: "MIT" } }]);
  })
})

describe("includeLicenseText", () => {
  const text = "Do what you like. Copyright © 2026 Ünicode.";
  const encoded = Buffer.from(text, "utf-8").toString("base64");

  it("embeds no license text by default", async () => {
    const licenses = await licensesOf("Public Domain", new Map([["Public Domain", text]]));
    assert.deepEqual(licenses, [{ license: { name: "Public Domain" } }]);
  });

  it("embeds the text of a free-text license as a base64 attachment", async () => {
    const licenses = await licensesOf("Public Domain", new Map([["Public Domain", text]]), true);
    assert.deepEqual(licenses, [{
      license: {
        name: "Public Domain",
        text: { content: encoded, contentType: "text/plain", encoding: "base64" }
      }
    }]);
  });

  it("embeds the text of an SPDX identifier as well", async () => {
    const licenses = await licensesOf("MIT", new Map([["MIT", text]]), true);
    assert.deepEqual(licenses, [{
      license: { id: "MIT", text: { content: encoded, contentType: "text/plain", encoding: "base64" } }
    }]);
  });

  it("encodes the text as UTF-8", async () => {
    const licenses = await licensesOf("MIT", new Map([["MIT", text]]), true);
    assert.equal(Buffer.from(licenses[0].license.text.content, "base64").toString("utf-8"), text);
  });

  it("leaves an expression without a text, which it has no place for", async () => {
    // A CycloneDX license expression is a bare string: there is nothing to attach to.
    const licenses = await licensesOf("MIT OR Apache-2.0", new Map([["MIT OR Apache-2.0", text]]), true);
    assert.deepEqual(licenses, [{ expression: "MIT OR Apache-2.0" }]);
  });

  it("still renders the license when no text is available for it", async () => {
    // The text is keyed by the license name, so a license the map does not know keeps its
    // entry and simply carries no attachment.
    const licenses = await licensesOf("Public Domain", new Map([["MIT", text]]), true);
    assert.deepEqual(licenses, [{ license: { name: "Public Domain" } }]);
  })
})
