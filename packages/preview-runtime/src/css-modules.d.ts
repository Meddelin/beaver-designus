// Ambient module declarations for stylesheet imports.
//
// DS component sources do `import s from "./x.module.css"` /
// `import "./y.css"`. Without these declarations `tsc` (run by
// `npm run preview:wire` and `npm run typecheck`) emits TS2307
// ("Cannot find module './x.module.css'") for every such import — which
// previously knocked whole packages (e.g. @beaver-ui/form, 39 components)
// out of the preview as UnknownComponentFallback.
//
// This is the standard CSS-modules typing shim. Vite handles the actual
// CSS (modules + plain) natively at runtime; these declarations only keep
// the type-check honest so real errors aren't masked and no component is
// dropped over a DS packaging choice.
//
// Lives under packages/ so it's part of the tsconfig program
// (`include: ["packages/**/*"]`); ambient `declare module` is global.

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module "*.module.sass" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module "*.module.less" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Plain side-effect / URL stylesheet imports — no useful typed shape.
declare module "*.css";
declare module "*.scss";
declare module "*.sass";
declare module "*.less";
