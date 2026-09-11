# markdown-it browser bundle

This directory vendors the untouched UMD browser distribution from
`markdown-it@15.0.2`.

- Source package: <https://registry.npmjs.org/markdown-it/-/markdown-it-15.0.2.tgz>
- Registry integrity: `sha512-q4IGxMv56jCqT4OCRCADBoDP3LO4MhmTXjFbphHPXs4g3j9Xg5RDnxqN8IF/3vIWEU+VCnUq+7JUg/cfy2E6Qw==`
- Bundle: `markdown-it.min.js`, copied from `package/dist/browser/markdown-it.umd.min.js` without edits
- Included dependency versions identified from the bundle source map: `mdurl@2.1.0`, `uc.micro@3.0.0`, `entities@8.0.0`, `linkify-it@6.0.0`, and `punycode.js@2.3.1`

The corresponding published license texts are in `markdown-it.LICENSE`.

To update this vendor, obtain the intended `markdown-it` npm tarball, verify
its registry integrity, copy only its browser UMD file without rebuilding or
modifying it, inspect the source map for bundled dependencies, and refresh the
license and provenance files. Do not add an install or build step for this
static bundle.
