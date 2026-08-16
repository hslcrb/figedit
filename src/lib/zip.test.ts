import { describe, expect, it } from "vitest";
import { parseFigBuffer, serializeFigDocument } from "./zip";
import { createNewDocument } from "./figma";

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe("zip round-trip", () => {
  it("직렬화한 .fig 바이트를 다시 파싱하면 동일한 문서가 나온다", () => {
    const { doc } = createNewDocument("테스트.fig");
    const extra = { "images/1.png": new TextEncoder().encode("fake-image") };

    const bytes = serializeFigDocument(doc, extra);
    const parsed = parseFigBuffer(toArrayBuffer(bytes));

    expect(parsed.doc.name).toBe("테스트");
    expect(parsed.doc.document.type).toBe("DOCUMENT");
    expect(parsed.doc.document.children).toHaveLength(1);
    expect(parsed.doc.document.children![0].children![0].type).toBe("FRAME");
    expect(parsed.files["images/1.png"]).toBeDefined();
    expect(new TextDecoder().decode(parsed.files["images/1.png"])).toBe("fake-image");
  });

  it("임의의 바이트 버퍼에서 .fig.json을 찾아낸다", () => {
    const { doc } = createNewDocument("x.fig");
    const bytes = serializeFigDocument(doc);
    const parsed = parseFigBuffer(toArrayBuffer(bytes));
    expect(parsed.doc.document.children![0].type).toBe("PAGE");
  });
});
