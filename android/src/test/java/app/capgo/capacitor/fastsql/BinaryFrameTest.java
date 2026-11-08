package app.capgo.capacitor.fastsql;

import static org.junit.Assert.*;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class BinaryFrameTest {

    @Test
    public void decodesSharedJavascriptGolden() throws Exception {
        try (InputStream input = getClass().getResourceAsStream("/binary-v1.bin")) {
            assertNotNull(input);
            JSONObject request = (JSONObject) BinaryFrame.decode(input.readAllBytes());
            JSONArray params = request.getJSONArray("params");
            assertArrayEquals(new byte[] { 0, 1, (byte) 255 }, (byte[]) params.get(0));
            assertArrayEquals(new byte[0], (byte[]) params.get(1));
            assertEquals(1.25, params.getDouble(2), 0);
            assertEquals("😀", params.getString(3));
        }
    }

    @Test
    public void rawBytesBindAndReturnWithoutBase64() throws Exception {
        SQLDatabase database = new SQLDatabase(":memory:", false, false);
        try {
            JSArray params = new JSArray();
            params.put(new byte[] { 0, 1, (byte) 255 });
            params.put(new byte[0]);
            params.put(JSONObject.NULL);
            params.put(1.25);
            JSObject result = database.executeBinary("SELECT ? AS bytes, ? AS empty, ? AS missing, ? AS fraction", params);
            byte[] frame = BinaryFrame.encode(result);
            JSONObject row = ((JSONObject) BinaryFrame.decode(frame)).getJSONArray("rows").getJSONObject(0);
            assertArrayEquals(new byte[] { 0, 1, (byte) 255 }, (byte[]) row.get("bytes"));
            assertArrayEquals(new byte[0], (byte[]) row.get("empty"));
            assertEquals(JSONObject.NULL, row.get("missing"));
            assertEquals(1.25, row.getDouble("fraction"), 0);
        } finally {
            database.close();
        }
    }

    @Test
    public void httpExecutesJavascriptFrameAndAuthenticatesBeforeDecoding() throws Exception {
        SQLDatabase database = new SQLDatabase(":memory:", false, false);
        java.util.Map<String, DatabaseConnection> databases = new java.util.HashMap<>();
        databases.put("test", database);
        SQLHTTPServer server = new SQLHTTPServer(databases);
        server.start();
        try (InputStream input = getClass().getResourceAsStream("/binary-v1.bin")) {
            byte[] bytes = input.readAllBytes();
            java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new java.net.URL(
                "http://127.0.0.1:" + server.getPort() + "/execute"
            ).openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Authorization", "Bearer " + server.getToken());
            connection.setRequestProperty("X-Database", "test");
            connection.setRequestProperty("Content-Type", BinaryFrame.CONTENT_TYPE);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (java.io.OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
            assertEquals(200, connection.getResponseCode());
            assertEquals(BinaryFrame.CONTENT_TYPE, connection.getContentType());
            JSONObject row;
            try (InputStream response = connection.getInputStream()) {
                row = ((JSONObject) BinaryFrame.decode(response.readAllBytes())).getJSONArray("rows").getJSONObject(0);
            }
            connection.disconnect();
            assertArrayEquals(new byte[] { 0, 1, (byte) 255 }, (byte[]) row.get("bytes"));
            assertArrayEquals(new byte[0], (byte[]) row.get("empty"));
            assertEquals(1.25, row.getDouble("fraction"), 0);
            assertEquals("😀", row.getString("text"));
            java.net.HttpURLConnection denied = (java.net.HttpURLConnection) new java.net.URL(
                "http://127.0.0.1:" + server.getPort() + "/execute"
            ).openConnection();
            denied.setRequestMethod("POST");
            denied.setDoOutput(true);
            denied.setFixedLengthStreamingMode(1);
            try (java.io.OutputStream output = denied.getOutputStream()) {
                output.write(0);
            }
            assertEquals(401, denied.getResponseCode());
            denied.disconnect();
        } finally {
            server.stop();
            database.close();
        }
    }

    @Test
    public void rejectsMalformedFramesAndReferences() throws Exception {
        byte[] valid = BinaryFrame.encode(new JSONObject().put("value", new byte[] { 1, 2 }));
        assertThrows(Exception.class, () -> BinaryFrame.decode(java.util.Arrays.copyOf(valid, valid.length - 1)));
        byte[] badVersion = valid.clone();
        badVersion[3] = 50;
        assertThrows(Exception.class, () -> BinaryFrame.decode(badVersion));
        byte[] badLength = valid.clone();
        ByteBuffer.wrap(badLength).order(ByteOrder.LITTLE_ENDIAN).putInt(4, Integer.MAX_VALUE);
        assertThrows(Exception.class, () -> BinaryFrame.decode(badLength));
        for (JSONArray ref : new JSONArray[] {
            new JSONArray().put(-1).put(1),
            new JSONArray().put(0).put(999),
            new JSONArray().put(0.5).put(0)
        }) {
            byte[] frame = BinaryFrame.encode(new JSONObject().put("$blob", ref));
            assertThrows(Exception.class, () -> BinaryFrame.decode(frame));
        }
    }
}
