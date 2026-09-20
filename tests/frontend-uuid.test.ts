import { describe, expect, test } from "bun:test";
import { generateOperationId } from "../frontend/utils/uuid.ts";

describe("generateOperationId", () => {
  test("uses native randomUUID when available", () => {
    const id = generateOperationId({
      randomUUID: () => "native-operation-id",
    });

    expect(id).toBe("native-operation-id");
  });

  test("creates an RFC 4122 v4 id when randomUUID is unavailable", () => {
    const id = generateOperationId({
      getRandomValues: (buffer: Uint8Array) => {
        buffer.set([
          0x12, 0x34, 0x56, 0x78,
          0x9a, 0xbc,
          0xde, 0xf0,
          0x11, 0x22,
          0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
        ]);
        return buffer;
      },
    });

    expect(id).toBe("12345678-9abc-4ef0-9122-334455667788");
  });
});
