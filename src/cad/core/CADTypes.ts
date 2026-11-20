/**
 * Core Type Definitions for HACHIHI AutoCAD Engine (DXF / DWG Adapter)
 * Strictly decoupled from Network Design `ProjectState` models.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BoundingBox3D extends BoundingBox2D {
  minZ: number;
  maxZ: number;
}

export interface RawDxfGroupPair {
  code: number;
  value: string | number;
}

export interface CADXDataEntry {
  appName: string;
  values: RawDxfGroupPair[];
}

export type CADPreservationTier = 'supported' | 'readonly' | 'unknown';

export type CADUnitCode =
  | 0  // Unitless
  | 1  // Inches
  | 2  // Feet
  | 3  // Miles
  | 4  // Millimeters
  | 5  // Centimeters
  | 6  // Meters
  | 7  // Kilometers
  | 8  // Microinches
  | 9  // Mils
  | 10 // Yards
  | 11 // Angstroms
  | 12 // Nanometers
  | 13 // Microns
  | 14 // Decimeters
  | 15 // Decameters
  | 16 // Hectometers
  | 17 // Gigameters
  | 18 // Astronomical Units
  | 19 // Light Years
  | 20; // Parsecs

export interface CADHeaderVariables {
  $ACADVER: string;
  $INSUNITS: CADUnitCode;
  $MEASUREMENT: 0 | 1; // 0 = Imperial, 1 = Metric
  $LUNITS: number;
  $DIMSCALE: number;
  $LTSCALE: number;
  $TEXTSIZE: number;
  $CLAYER: string;
  $EXTMIN?: Point3D;
  $EXTMAX?: Point3D;
  $LIMMIN?: Point2D;
  $LIMMAX?: Point2D;
  $INSBASE?: Point3D;
  $UCSORG?: Point3D;
  $UCSXDIR?: Point3D;
  $UCSYDIR?: Point3D;
  $HANDSEED?: string;
  extra?: Record<string, RawDxfGroupPair[]>;
}

export interface CADLayer {
  id: string;
  name: string;
  colorIndex: number; // ACI 1..255
  trueColor?: number; // 24-bit 0xRRGGBB
  lineType: string;
  lineWeight: number; // -3 default, or 100ths of mm
  visible: boolean;   // Layer On/Off (negative ACI color in DXF means off)
  frozen: boolean;    // Bit 1 of group 70
  locked: boolean;    // Bit 4 of group 70
  plottable: boolean; // Group 290
  handle?: string;
  rawPairs?: RawDxfGroupPair[];
}

export interface CADLineType {
  name: string;
  description: string;
  pattern: number[]; // + dash, - gap, 0 dot
  totalLength: number;
  handle?: string;
  rawPairs?: RawDxfGroupPair[];
}

export interface CADTextStyle {
  name: string;
  fontFile: string;
  bigFontFile?: string;
  fixedHeight: number;
  widthFactor: number;
  obliqueAngle: number;
  isShapeFile?: boolean;
  missingFontFallback?: boolean;
  handle?: string;
  rawPairs?: RawDxfGroupPair[];
}

export interface CADDimensionStyle {
  name: string;
  dimscale: number;
  dimtxt: number;
  dimasz: number;
  dimexo: number;
  dimexe: number;
  dimlfac: number;
  dimdec: number;
  handle?: string;
  rawPairs?: RawDxfGroupPair[];
}

export interface CADLayout {
  name: string;
  tabOrder: number;
  isModelSpace: boolean;
  paperWidth?: number;
  paperHeight?: number;
  plotScale?: number;
  handle?: string;
  rawPairs?: RawDxfGroupPair[];
}

export interface CADPolylineVertex {
  x: number;
  y: number;
  z?: number;
  bulge?: number;
  startWidth?: number;
  endWidth?: number;
}

export interface CADInsertAttribute {
  id: string;
  tag: string;
  text: string;
  position: Point3D;
  height: number;
  rotation: number;
  style?: string;
  layer?: string;
  handle?: string;
  rawPairs?: RawDxfGroupPair[];
}

export interface CADBaseEntity {
  id: string;
  handle: string;
  layer: string;
  colorIndex?: number; // 256 = ByLayer, 0 = ByBlock, 1..255 = ACI
  trueColor?: number;  // 0xRRGGBB
  lineType?: string;   // 'BYLAYER' | 'BYBLOCK' | pattern name
  lineTypeScale?: number;
  lineWeight?: number;
  visible?: boolean;   // group 60: 0=visible, 1=invisible
  space?: 'model' | 'paper';
  layoutName?: string;
  extrusion?: Point3D; // DXF group 210, 220, 230
  xdata?: CADXDataEntry[];
  rawDxf?: RawDxfGroupPair[];
  dirty?: boolean;
  preservationTier: CADPreservationTier;
  bounds?: BoundingBox2D;
}

export interface CADLineEntity extends CADBaseEntity {
  type: 'LINE';
  start: Point3D;
  end: Point3D;
}

export interface CADPointEntity extends CADBaseEntity {
  type: 'POINT';
  position: Point3D;
}

export interface CADCircleEntity extends CADBaseEntity {
  type: 'CIRCLE';
  center: Point3D;
  radius: number;
}

export interface CADArcEntity extends CADBaseEntity {
  type: 'ARC';
  center: Point3D;
  radius: number;
  startAngle: number; // Degrees
  endAngle: number;   // Degrees
}

export interface CADLwPolylineEntity extends CADBaseEntity {
  type: 'LWPOLYLINE';
  vertices: CADPolylineVertex[];
  closed: boolean;
  elevation: number;
  constantWidth?: number;
}

export interface CADPolylineEntity extends CADBaseEntity {
  type: 'POLYLINE';
  vertices: CADPolylineVertex[];
  closed: boolean;
  is3D?: boolean;
  isPolygonMesh?: boolean;
}

export interface CADSplineEntity extends CADBaseEntity {
  type: 'SPLINE';
  degree: number;
  controlPoints: Point3D[];
  fitPoints: Point3D[];
  knots: number[];
  weights?: number[];
  closed: boolean;
}

export interface CADEllipseEntity extends CADBaseEntity {
  type: 'ELLIPSE';
  center: Point3D;
  majorAxisEndPoint: Point3D; // Relative to center
  axisRatio: number;
  startParam: number; // Radians (0..2PI)
  endParam: number;   // Radians (0..2PI)
}

export interface CADHatchEntity extends CADBaseEntity {
  type: 'HATCH';
  patternName: string;
  solidFill: boolean;
  patternScale: number;
  patternAngle: number;
  boundaryLoops: Point2D[][];
}

export interface CADSolidEntity extends CADBaseEntity {
  type: 'SOLID';
  points: [Point3D, Point3D, Point3D, Point3D];
}

export interface CADTextEntity extends CADBaseEntity {
  type: 'TEXT';
  position: Point3D;
  secondAlignmentPoint?: Point3D;
  height: number;
  rotation: number; // Degrees
  text: string;
  style: string;
  hAlign: number;
  vAlign: number;
  widthFactor: number;
  obliqueAngle: number;
}

export interface CADMTextEntity extends CADBaseEntity {
  type: 'MTEXT';
  position: Point3D;
  height: number;
  width: number;
  rotation: number; // Degrees
  rawText: string;
  plainText: string;
  style: string;
  attachmentPoint: number; // 1..9
  lineSpacingFactor?: number;
}

export interface CADAttribEntity extends CADBaseEntity {
  type: 'ATTRIB' | 'ATTDEF';
  position: Point3D;
  tag: string;
  text: string;
  prompt?: string;
  height: number;
  rotation: number;
  style: string;
  flags: number;
}

export type CADDimensionKind =
  | 'linear'
  | 'aligned'
  | 'angular'
  | 'radial'
  | 'diameter'
  | 'ordinate';

export interface CADDimensionEntity extends CADBaseEntity {
  type: 'DIMENSION';
  dimensionType: CADDimensionKind;
  subTypeCode: number;
  defPoint: Point3D;
  defPoint2?: Point3D;
  defPoint3?: Point3D;
  defPoint4?: Point3D;
  textMidPoint: Point3D;
  text: string; // Empty or '<>' uses measuredValue
  measuredValue: number;
  style: string;
  blockName?: string;
  rotation?: number;
}

export interface CADLeaderEntity extends CADBaseEntity {
  type: 'LEADER' | 'MLEADER';
  vertices: Point3D[];
  text?: string;
  arrowSize?: number;
  hasArrowhead: boolean;
}

export interface CADInsertEntity extends CADBaseEntity {
  type: 'INSERT';
  blockName: string;
  position: Point3D;
  scale: Point3D;
  rotation: number; // Degrees
  rowCount?: number;
  columnCount?: number;
  rowSpacing?: number;
  columnSpacing?: number;
  attributes?: CADInsertAttribute[];
}

export interface CAD3DFaceEntity extends CADBaseEntity {
  type: '3DFACE';
  vertices: [Point3D, Point3D, Point3D, Point3D];
}

export interface CADUnknownEntity extends CADBaseEntity {
  type: 'UNKNOWN';
  dxfType: string;
  previewPoint?: Point3D;
  note?: string;
}

export type CADEntity =
  | CADLineEntity
  | CADPointEntity
  | CADCircleEntity
  | CADArcEntity
  | CADLwPolylineEntity
  | CADPolylineEntity
  | CADSplineEntity
  | CADEllipseEntity
  | CADHatchEntity
  | CADSolidEntity
  | CADTextEntity
  | CADMTextEntity
  | CADAttribEntity
  | CADDimensionEntity
  | CADLeaderEntity
  | CADInsertEntity
  | CAD3DFaceEntity
  | CADUnknownEntity;

export type CADEntityType = CADEntity['type'];

export interface CADBlock {
  id: string;
  name: string;
  basePoint: Point3D;
  entities: CADEntity[];
  isPaperSpace?: boolean;
  isAnonymous?: boolean;
  isXref?: boolean;
  xrefPath?: string;
  handle?: string;
  rawHeaderPairs?: RawDxfGroupPair[];
  rawEndblkPairs?: RawDxfGroupPair[];
}

export type CADLayerFilterMode = 'all' | 'used' | 'locked' | 'hidden';

export type CADSpaceFilter = 'model' | 'paper' | 'all';

export interface CADRawSections {
  classes?: RawDxfGroupPair[];
  objects?: RawDxfGroupPair[];
  thumbnail?: RawDxfGroupPair[];
  extraTables?: Array<{
    name: string;
    handle?: string;
    rawHeaderPairs?: RawDxfGroupPair[];
    rawPairs: RawDxfGroupPair[];
  }>;
}

export interface CADUnderlayAlignment {
  enabled: boolean;
  opacity: number;
  offsetX: number;
  offsetY: number;
  scaleToCanvasPx: number;
  rotationDeg: number;
  locked: boolean;
  showIn3D: boolean;
  visibleFloorIds?: string[];
}

export interface CADDocumentMetadata {
  sourceFileName: string;
  sourceFileSizeBytes: number;
  sourceFormat: 'dxf-ascii' | 'dxf-binary' | 'dwg-converted' | 'new';
  acadVersion: string;
  hasRawRoundTripData: boolean;
  missingFonts: string[];
  missingXrefs: string[];
  unknownEntityTypes: Record<string, number>;
  securityWarnings: string[];
  importTimestamp: string;
}

export interface CADDocument {
  id: string;
  name: string;
  projectId?: string;
  schemaVersion: number;
  header: CADHeaderVariables;
  layers: Record<string, CADLayer>;
  lineTypes: Record<string, CADLineType>;
  textStyles: Record<string, CADTextStyle>;
  dimStyles: Record<string, CADDimensionStyle>;
  blocks: Record<string, CADBlock>;
  layouts: CADLayout[];
  entities: CADEntity[];
  extents: BoundingBox2D;
  nextHandleSeed: number;
  rawSections?: CADRawSections;
  metadata: CADDocumentMetadata;
  underlay: CADUnderlayAlignment;
  createdAt: string;
  updatedAt: string;
}

export type CADToolId =
  | 'select'
  | 'pan'
  | 'measure'
  | 'line'
  | 'polyline'
  | 'circle'
  | 'arc'
  | 'rect'
  | 'text'
  | 'dimension'
  | 'insert'
  | 'move'
  | 'copy'
  | 'rotate'
  | 'scale'
  | 'mirror'
  | 'offset'
  | 'trim'
  | 'extend';

export type CADSnapMode =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'perpendicular'
  | 'quadrant'
  | 'nearest'
  | 'insertion';

export interface CADSnapSettings {
  enabled: boolean;
  ortho: boolean;
  polar: boolean;
  gridSnap: boolean;
  gridSpacing: number;
  modes: Record<CADSnapMode, boolean>;
}
