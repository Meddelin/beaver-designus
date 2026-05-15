// Manifest types — duplicated from shared/types.ts intentionally: this package
// is the builder's source-of-truth, the runtime types in shared/ are the
// consumer's. They MUST agree in shape; we just don't want a cross-package
// runtime dep from the builder side.

export type {
  PropEntry,
  PropShape,
  SlotPolicy,
  ExampleSnippet,
  ManifestEntry,
} from "../../../shared/types.ts";
