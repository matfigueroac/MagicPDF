export type DrawingKind =
  | "highlight"
  | "underline"
  | "text"
  | "rectangle"
  | "square"
  | "ellipse"
  | "line"
  | "arrow"
  | "ink";
export interface DrawingAnnotation {
  id: string;
  page: number;
  kind: DrawingKind;
  points: number[][];
  rects?: number[][];
  color: string;
  width: number;
  lineStyle: "solid" | "dashed" | "dotted";
  text: string;
  fontSize: number;
  fontFamily: "sans" | "serif" | "mono";
  border: boolean;
  borderColor: string;
  lines?: string[];
  groupId?: string;
  locked?: boolean;
  name?: string;
  groupName?: string;
  hidden?: boolean;
  groupHidden?: boolean;
}
