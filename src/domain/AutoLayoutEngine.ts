import type { FigmaNode } from "../types/figma";
import { isContainerNode } from "../types/figma";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function alignOffset(mode: string | undefined, available: number, content: number): number {
  if (mode === "MAX") return Math.max(0, available - content);
  if (mode === "CENTER") return Math.max(0, (available - content) / 2);
  return 0;
}

/** Calculates the small, deterministic subset of Auto Layout used by LabelStudio. */
export class AutoLayoutEngine {
  public arrange(input: FigmaNode): FigmaNode {
    if (!isContainerNode(input) || !input.layoutMode || input.layoutMode === "NONE") return clone(input);

    const node = clone(input);
    node.children = (node.children ?? []).map((child) => this.arrange(child));
    const horizontal = node.layoutMode === "HORIZONTAL";
    const paddingStart = horizontal ? node.paddingLeft ?? 0 : node.paddingTop ?? 0;
    const paddingEnd = horizontal ? node.paddingRight ?? 0 : node.paddingBottom ?? 0;
    const crossStart = horizontal ? node.paddingTop ?? 0 : node.paddingLeft ?? 0;
    const crossEnd = horizontal ? node.paddingBottom ?? 0 : node.paddingRight ?? 0;
    const gap = node.itemSpacing ?? 0;
    const mainSize = horizontal ? node.width ?? 0 : node.height ?? 0;
    const crossSize = horizontal ? node.height ?? 0 : node.width ?? 0;
    const children = node.children ?? [];
    const availableMain = Math.max(0, mainSize - paddingStart - paddingEnd);
    const availableCross = Math.max(0, crossSize - crossStart - crossEnd);
    const isFillMain = (child: FigmaNode) => horizontal ? child.layoutSizingHorizontal === "FILL" : child.layoutSizingVertical === "FILL";
    const isFillCross = (child: FigmaNode) => horizontal ? child.layoutSizingVertical === "FILL" : child.layoutSizingHorizontal === "FILL";
    const rawMainSize = (child: FigmaNode) => horizontal ? child.width ?? 0 : child.height ?? 0;
    const rawCrossSize = (child: FigmaNode) => horizontal ? child.height ?? 0 : child.width ?? 0;
    const fillCount = children.filter(isFillMain).length;
    const fixedMain = children.filter((child) => !isFillMain(child)).reduce((total, child) => total + rawMainSize(child), 0);
    const fillMain = fillCount > 0 ? Math.max(0, (availableMain - fixedMain - Math.max(0, children.length - 1) * gap) / fillCount) : 0;
    const childMainSize = (child: FigmaNode) => isFillMain(child) ? fillMain : rawMainSize(child);
    const childCrossSize = (child: FigmaNode) => isFillCross(child) ? availableCross : rawCrossSize(child);
    const contentMain = children.reduce((total, child) => total + childMainSize(child), 0) + Math.max(0, children.length - 1) * gap;
    let cursor = paddingStart + alignOffset(node.primaryAxisAlignItems, availableMain, contentMain);

    for (const child of children) {
      const childMain = childMainSize(child);
      const childCross = childCrossSize(child);
      const crossPosition = crossStart + alignOffset(node.counterAxisAlignItems, availableCross, childCross);
      const next = {
        ...child,
        ...(horizontal ? { x: cursor, y: crossPosition } : { x: crossPosition, y: cursor }),
      };
      if (node.counterAxisAlignItems === "STRETCH") {
        if (horizontal) next.height = availableCross;
        else next.width = availableCross;
      }
      if (isFillMain(child)) {
        if (horizontal) next.width = childMain;
        else next.height = childMain;
      }
      if (isFillCross(child)) {
        if (horizontal) next.height = availableCross;
        else next.width = availableCross;
      }
      const index = children.indexOf(child);
      children[index] = next;
      cursor += childMain + gap;
    }

    if (node.layoutSizingHorizontal === "HUG" && horizontal) node.width = contentMain + paddingStart + paddingEnd;
    if (node.layoutSizingVertical === "HUG" && !horizontal) node.height = contentMain + paddingStart + paddingEnd;
    node.children = children;
    return node;
  }
}
