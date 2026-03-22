declare module "@thatopen/fragments/worker?url" {
  const url: string;
  export default url;
}

declare module "@thatopen/components" {
  export const Components: any;
  export const Worlds: any;
  export const SimpleScene: any;
  export const OrthoPerspectiveCamera: any;
  export const Grids: any;
  export const FragmentsManager: any;
  export const IfcLoader: any;
  export const Raycasters: any;
  export const Classifier: any;
  export const Hider: any;
  export const Clipper: any;
}

declare module "@thatopen/components-front" {
  export const RendererWith2D: any;
  export const Highlighter: any;
  export const Hoverer: any;
  export const LengthMeasurement: any;
  export const AreaMeasurement: any;
}

declare module "bim-viewport" {}
