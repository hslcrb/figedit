import { describe, expect, it } from "vitest";
import {
  addChild,
  createNewDocument,
  duplicateNode,
  findNode,
  findParent,
  makeNode,
  moveNodeInParent,
  removeNode,
  replaceNode,
  updateNode,
  walk,
} from "./figma";

const emptyPage = makeNode("PAGE", { children: [] } as never);

function buildTree() {
  const root = makeNode("DOCUMENT", emptyPage);
  const page = makeNode("PAGE", root);
  const frame = makeNode("FRAME", page, { x: 10, y: 20, width: 200, height: 300 });
  const rect = makeNode("RECTANGLE", frame, { x: 5, y: 5, width: 50, height: 50 });
  const text = makeNode("TEXT", frame, { x: 60, y: 5 });
  root.children = [page];
  page.children = [frame];
  frame.children = [rect, text];
  return { root, page, frame, rect, text };
}

describe("walk", () => {
  it("방문 순서가 DFS 순서와 일치한다", () => {
    const { root } = buildTree();
    const ids: string[] = [];
    walk(root, (n) => {
      ids.push(n.name!);
    });
    expect(ids).toEqual(["Document", "페이지", "프레임", "사각형", "텍스트"]);
  });
});

describe("findNode / findParent", () => {
  it("id로 노드를 찾는다", () => {
    const { root, rect } = buildTree();
    expect(findNode(root, rect.id)?.type).toBe("RECTANGLE");
  });

  it("부모와 인덱스를 찾는다", () => {
    const { root, frame, rect, text } = buildTree();
    const info = findParent(root, rect.id!);
    expect(info?.parent.id).toBe(frame.id);
    expect(info?.index).toBe(0);
    const info2 = findParent(root, text.id!);
    expect(info2?.index).toBe(1);
  });
});

describe("addChild / removeNode / updateNode", () => {
  it("자식을 추가한다", () => {
    const { frame, root } = buildTree();
    const ellipse = makeNode("ELLIPSE", frame);
    const next = replaceNode(root, frame.id!, addChild(frame, ellipse));
    expect(findNode(next, frame.id!)?.children).toHaveLength(3);
  });

  it("노드를 삭제한다", () => {
    const { root, rect } = buildTree();
    const { root: next, removed } = removeNode(root, rect.id!);
    expect(removed?.type).toBe("RECTANGLE");
    expect(findNode(next, rect.id!)).toBeNull();
  });

  it("노드 속성을 갱신한다", () => {
    const { root, rect } = buildTree();
    const next = updateNode(root, rect.id!, { width: 123 });
    expect(findNode(next, rect.id!)?.width).toBe(123);
  });
});

describe("duplicateNode", () => {
  it("같은 부모에 복사본을 만든다", () => {
    const { root, rect } = buildTree();
    const { root: next, newId } = duplicateNode(root, rect.id!);
    expect(newId).not.toBeNull();
    expect(findNode(next, newId!)?.type).toBe("RECTANGLE");
    expect(findNode(next, rect.id!)?.name).toBe("사각형");
    expect(findNode(next, newId!)?.name).toBe("사각형 복사");
  });
});

describe("moveNodeInParent", () => {
  it("순서를 위로 이동한다", () => {
    const { root, text } = buildTree();
    const next = moveNodeInParent(root, text.id!, -1);
    const frame = next.children?.[0].children?.[0];
    expect(frame?.children?.[0].id).toBe(text.id);
  });
});

describe("createNewDocument", () => {
  it("문서/페이지/프레임 구조를 만든다", () => {
    const { doc } = createNewDocument("test.fig");
    expect(doc.document.type).toBe("DOCUMENT");
    expect(doc.document.children).toHaveLength(1);
    const page = doc.document.children![0];
    expect(page.type).toBe("PAGE");
    expect(page.children).toHaveLength(1);
    const frame = page.children![0];
    expect(frame.type).toBe("FRAME");
    expect(frame.children?.length).toBeGreaterThanOrEqual(3);
  });
});
