package app.capgo.capacitor.fastsql;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Shared binary v1 envelope. Byte arrays never pass through base64 or JSON. */
final class BinaryFrame {

    static final String CONTENT_TYPE = "application/vnd.capgo.fast-sql.v1+binary";
    static final int MAX_BYTES = 64 * 1024 * 1024;
    private static final int MAX_METADATA = 1024 * 1024;
    private static final int HEADER = 12;
    private static final byte[] MAGIC = { 70, 83, 81, 49 };
    private int nodes;
    private int blobs;
    private long referencedBytes;

    static Object decode(byte[] frame) throws Exception {
        if (frame.length < HEADER || frame.length > MAX_BYTES) throw new IOException("Invalid binary frame length");
        for (int i = 0; i < MAGIC.length; i++) if (frame[i] != MAGIC[i]) throw new IOException("Invalid binary frame version");
        ByteBuffer header = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN);
        int metadataLength = header.getInt(4);
        int payloadLength = header.getInt(8);
        if (
            metadataLength <= 0 ||
            metadataLength > MAX_METADATA ||
            payloadLength < 0 ||
            (long) HEADER + metadataLength + payloadLength != frame.length
        ) throw new IOException("Invalid binary frame lengths");
        String metadata = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(frame, HEADER, metadataLength))
            .toString();
        checkNesting(metadata);
        JSONTokener parser = new JSONTokener(metadata);
        Object value = parser.nextValue();
        if (parser.nextClean() != 0) throw new IOException("Trailing binary metadata");
        return new BinaryFrame().decodeValue(value, frame, HEADER + metadataLength, payloadLength, 0);
    }

    private static void checkNesting(String json) throws IOException {
        boolean quoted = false;
        boolean escaped = false;
        int depth = 0;
        for (int i = 0; i < json.length(); i++) {
            char value = json.charAt(i);
            if (quoted) {
                if (escaped) escaped = false;
                else if (value == 92) escaped = true;
                else if (value == 34) quoted = false;
            } else if (value == 34) quoted = true;
            else if (value == '[' || value == '{') {
                if (++depth > 33) throw new IOException("Binary metadata nesting exceeds limits");
            } else if (value == ']' || value == '}') depth--;
        }
    }

    private Object decodeValue(Object value, byte[] frame, int payloadStart, int payloadLength, int depth) throws Exception {
        if (++nodes > 100000 || depth > 32) throw new IOException("Binary metadata exceeds limits");
        if (value instanceof JSONArray) {
            JSONArray input = (JSONArray) value;
            JSONArray result = new JSONArray();
            for (int i = 0; i < input.length(); i++) result.put(decodeValue(input.get(i), frame, payloadStart, payloadLength, depth + 1));
            return result;
        }
        if (!(value instanceof JSONObject)) return value;
        JSONObject input = (JSONObject) value;
        if (input.has("$blob") && input.length() == 1) {
            JSONArray reference = input.getJSONArray("$blob");
            if (
                reference.length() != 2 || !(reference.get(0) instanceof Number) || !(reference.get(1) instanceof Number)
            ) throw new IOException("Invalid binary attachment reference");
            double offset = reference.getDouble(0);
            double length = reference.getDouble(1);
            if (
                !Double.isFinite(offset) ||
                !Double.isFinite(length) ||
                offset < 0 ||
                length < 0 ||
                offset != Math.floor(offset) ||
                length != Math.floor(length) ||
                offset + length > payloadLength
            ) throw new IOException("Binary attachment outside frame");
            referencedBytes += (long) length;
            if (++blobs > 4096 || referencedBytes > MAX_BYTES) throw new IOException("Decoded attachments exceed limits");
            return java.util.Arrays.copyOfRange(frame, payloadStart + (int) offset, payloadStart + (int) offset + (int) length);
        }
        JSONObject result = new JSONObject();
        Iterator<String> keys = input.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, decodeValue(input.get(key), frame, payloadStart, payloadLength, depth + 1));
        }
        return result;
    }

    static byte[] encode(Object value) throws Exception {
        ByteArrayOutputStream attachments = new ByteArrayOutputStream();
        BinaryFrame codec = new BinaryFrame();
        Object metadataValue = codec.encodeValue(value, attachments, 0);
        String wrapped = new JSONArray().put(metadataValue).toString();
        byte[] metadata = wrapped.substring(1, wrapped.length() - 1).getBytes(StandardCharsets.UTF_8);
        long total = (long) HEADER + metadata.length + attachments.size();
        if (metadata.length > MAX_METADATA || total > MAX_BYTES) throw new IOException("Binary frame exceeds limits");
        ByteArrayOutputStream output = new ByteArrayOutputStream((int) total);
        output.write(MAGIC);
        output.write(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(metadata.length).putInt(attachments.size()).array());
        output.write(metadata);
        attachments.writeTo(output);
        return output.toByteArray();
    }

    private Object encodeValue(Object value, ByteArrayOutputStream attachments, int depth) throws Exception {
        if (++nodes > 100000 || depth > 32) throw new IOException("Binary metadata exceeds limits");
        if (value instanceof byte[]) {
            byte[] bytes = (byte[]) value;
            if (++blobs > 4096 || (long) attachments.size() + bytes.length > MAX_BYTES - HEADER) throw new IOException(
                "Binary attachments exceed limits"
            );
            JSONObject reference = new JSONObject();
            reference.put("$blob", new JSONArray().put(attachments.size()).put(bytes.length));
            attachments.write(bytes);
            return reference;
        }
        if (value instanceof JSONArray) {
            JSONArray input = (JSONArray) value;
            JSONArray result = new JSONArray();
            for (int i = 0; i < input.length(); i++) result.put(encodeValue(input.get(i), attachments, depth + 1));
            return result;
        }
        if (value instanceof JSONObject) {
            JSONObject input = (JSONObject) value;
            JSONObject result = new JSONObject();
            Iterator<String> keys = input.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                result.put(key, encodeValue(input.get(key), attachments, depth + 1));
            }
            return result;
        }
        return value;
    }
}
