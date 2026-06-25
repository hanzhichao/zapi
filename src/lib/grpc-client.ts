import type { ResponseData } from "./types";

/** Encode a JSON/text payload as a gRPC-Web data frame */
function encodeGrpcWebMessage(body: string): Uint8Array {
  const data = new TextEncoder().encode(body);
  const frame = new Uint8Array(5 + data.length);
  frame[0] = 0; // compression flag: not compressed
  const len = data.length;
  frame[1] = (len >>> 24) & 0xff;
  frame[2] = (len >>> 16) & 0xff;
  frame[3] = (len >>> 8) & 0xff;
  frame[4] = len & 0xff;
  frame.set(data, 5);
  return frame;
}

/** Decode a gRPC-Web response buffer into data frame + trailers */
function decodeGrpcWebResponse(buffer: ArrayBuffer): {
  message: string;
  trailers: Record<string, string>;
} {
  const data = new Uint8Array(buffer);
  let offset = 0;
  let message = "";
  const trailers: Record<string, string> = {};

  while (offset + 5 <= data.length) {
    const frameType = data[offset];
    const frameLen =
      ((data[offset + 1] << 24) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 8) |
        data[offset + 4]) >>>
      0;
    offset += 5;
    if (offset + frameLen > data.length) break;

    const frameData = data.slice(offset, offset + frameLen);
    offset += frameLen;

    if ((frameType & 0x80) === 0) {
      // Data frame
      message = new TextDecoder().decode(frameData);
    } else {
      // Trailer frame
      const trailerStr = new TextDecoder().decode(frameData);
      for (const line of trailerStr.split("\r\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          trailers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
        }
      }
    }
  }

  return { message, trailers };
}

/**
 * Invoke a gRPC-Web method with JSON encoding.
 *
 * URL format: http[s]://host:port/package.ServiceName/MethodName
 * Request body: JSON string that the server will decode from its JSON transcoding
 */
export async function invokeGrpc(
  url: string,
  requestBody: string,
  extraHeaders: Record<string, string> = {}
): Promise<ResponseData> {
  const body = encodeGrpcWebMessage(requestBody);
  const start = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/grpc-web+json",
        "X-Grpc-Web": "1",
        Accept: "application/grpc-web+json,application/grpc-web",
        ...extraHeaders,
      },
      body,
    });
  } catch (e) {
    throw new Error(`gRPC connection failed: ${String(e)}`);
  }

  const time = Date.now() - start;
  const buffer = await response.arrayBuffer();
  const { message, trailers } = decodeGrpcWebResponse(buffer);

  const grpcStatus = trailers["grpc-status"] ?? "0";
  const grpcMessage = trailers["grpc-message"] ?? "";

  const responseHeaders: Record<string, string> = {
    "grpc-status": grpcStatus,
    ...(grpcMessage ? { "grpc-message": grpcMessage } : {}),
  };
  response.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  const statusOk = grpcStatus === "0";
  const displayBody = message || (grpcMessage ? `gRPC Error: ${grpcMessage}` : "(empty response)");
  const size = new TextEncoder().encode(displayBody).length;

  return {
    status: statusOk ? 200 : parseInt(grpcStatus, 10) || 500,
    statusText: statusOk ? "OK" : grpcMessage || "gRPC Error",
    headers: responseHeaders,
    body: displayBody,
    size,
    time,
    contentType: "application/json",
  };
}
