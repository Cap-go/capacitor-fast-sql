package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import fi.iki.elonen.NanoHTTPD; // Note: org.nanohttpd:nanohttpd:2.3.1 still uses fi.iki.elonen package
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * HTTP server for efficient SQL operations
 *
 * This server handles direct HTTP requests from JavaScript, bypassing Capacitor's
 * bridge for better performance with large datasets and sync operations.
 */
public class SQLHTTPServer extends NanoHTTPD {

    private final String token;
    private final Map<String, DatabaseConnection> databases;
    private final ExecutorService requestExecutor = new ThreadPoolExecutor(
        1,
        1,
        0,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(32),
        (runnable) -> {
            Thread thread = new Thread(runnable);
            thread.setName("FastSQL-DB");
            thread.setDaemon(true);
            return thread;
        }
    );

    public SQLHTTPServer(Map<String, DatabaseConnection> databases) throws IOException {
        super("127.0.0.1", 0);
        this.databases = databases;
        this.token = generateToken();
    }

    public String getToken() {
        return token;
    }

    public int getPort() {
        return getListeningPort();
    }

    private Response addCorsHeaders(Response response) {
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Database");
        response.addHeader("Access-Control-Max-Age", "86400");
        return response;
    }

    @Override
    protected boolean useGzipWhenAccepted(Response response) {
        return BinaryFrame.CONTENT_TYPE.equals(response.getMimeType()) || super.useGzipWhenAccepted(response);
    }

    @Override
    public void stop() {
        super.stop();
        requestExecutor.shutdownNow();
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (Method.OPTIONS.equals(session.getMethod())) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.OK, "text/plain", ""));
        }

        String authHeader = session.getHeaders().get("authorization");
        if (authHeader == null || !authHeader.equals("Bearer " + token)) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.UNAUTHORIZED, "text/plain", "Unauthorized"));
        }

        String database = session.getHeaders().get("x-database");
        if (database == null) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Database header required"));
        }

        DatabaseConnection db = databases.get(database);
        if (db == null) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Database not found"));
        }

        Future<Response> request = null;
        try {
            request = requestExecutor.submit(() -> routeRequest(session, db));
            return request.get(600, TimeUnit.SECONDS);
        } catch (TimeoutException | RejectedExecutionException error) {
            if (request != null) request.cancel(false);
            Response response = newFixedLengthResponse(
                Response.Status.SERVICE_UNAVAILABLE,
                "text/plain",
                "Request unavailable; a timed-out write may still complete. Do not automatically retry."
            );
            response.closeConnection(true);
            return addCorsHeaders(response);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof IOException || e.getCause() instanceof org.json.JSONException) {
                Response response = newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid SQL/frame request");
                response.closeConnection(true);
                return addCorsHeaders(response);
            }
            Throwable cause = e.getCause();
            String message = cause != null ? cause.getMessage() : e.getMessage();
            return addCorsHeaders(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Error: " + message));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return addCorsHeaders(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Request interrupted"));
        }
    }

    private Response routeRequest(IHTTPSession session, DatabaseConnection db) throws Exception {
        String uri = session.getUri();
        Method method = session.getMethod();

        if (method == Method.POST && (uri.equals("/execute") || uri.equals("/batch") || uri.equals("/echo"))) {
            return addCorsHeaders(handleDataRequest(session, db));
        } else if (method == Method.POST && uri.equals("/transaction/begin")) {
            return addCorsHeaders(handleBeginTransaction(session, db));
        } else if (method == Method.POST && uri.equals("/transaction/commit")) {
            return addCorsHeaders(handleCommitTransaction(session, db));
        } else if (method == Method.POST && uri.equals("/transaction/rollback")) {
            return addCorsHeaders(handleRollbackTransaction(session, db));
        } else {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Endpoint not found"));
        }
    }

    private Response handleDataRequest(IHTTPSession session, DatabaseConnection db) throws Exception {
        boolean binary = BinaryFrame.CONTENT_TYPE.equals(session.getHeaders().get("content-type"));
        byte[] bytes = readRequestBytes(session);
        Object decoded = binary ? BinaryFrame.decode(bytes) : new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!(decoded instanceof JSONObject)) throw new IOException("Expected SQL request object");
        JSONObject request = (JSONObject) decoded;
        Object result;
        if (session.getUri().equals("/batch")) {
            JSONArray operations = request.getJSONArray("operations");
            if (operations.length() > 10000) throw new IOException("Too many batch operations");
            for (int i = 0; i < operations.length(); i++) validateOperation(operations.getJSONObject(i));
            JSONArray results = new JSONArray();
            for (int i = 0; i < operations.length(); i++) results.put(executeOperation(db, operations.getJSONObject(i), binary));
            result = results;
        } else {
            validateOperation(request);
            if (session.getUri().equals("/echo")) {
                JSObject row = new JSObject();
                if (request.getJSONArray("params").length() != 1) throw new IOException("Echo requires one parameter");
                row.put("value", request.getJSONArray("params").get(0));
                JSObject echo = new JSObject();
                echo.put("rows", new JSONArray().put(row));
                echo.put("rowsAffected", 0);
                result = echo;
            } else result = executeOperation(db, request, binary);
        }
        if (!binary) return newFixedLengthResponse(Response.Status.OK, "application/json", result.toString());
        byte[] response;
        try {
            response = BinaryFrame.encode(result);
        } catch (Exception error) {
            throw new IllegalStateException("Could not encode SQL response; a write may already be committed", error);
        }
        return newFixedLengthResponse(Response.Status.OK, BinaryFrame.CONTENT_TYPE, new ByteArrayInputStream(response), response.length);
    }

    private static void validateOperation(JSONObject operation) throws Exception {
        if (!(operation.get("statement") instanceof String)) throw new IOException("Expected SQL statement");
        JSONArray params = operation.optJSONArray("params");
        if (operation.has("params") && params == null) throw new IOException("Expected parameter array");
        if (params == null) return;
        for (int i = 0; i < params.length(); i++) {
            Object value = params.get(i);
            if (value == JSONObject.NULL || value instanceof String || value instanceof Boolean || value instanceof byte[]) continue;
            if (value instanceof Number && Double.isFinite(((Number) value).doubleValue())) continue;
            if (value instanceof JSONObject) {
                JSONObject blob = (JSONObject) value;
                if ("binary".equals(blob.optString("_type")) && blob.opt("_data") instanceof String) continue;
            }
            throw new IOException("Unsupported SQL parameter");
        }
    }

    private static JSObject executeOperation(DatabaseConnection db, JSONObject operation, boolean binary) throws Exception {
        JSONArray input = operation.optJSONArray("params");
        JSArray params = new JSArray();
        if (input != null) for (int i = 0; i < input.length(); i++) params.put(input.get(i));
        return binary ? db.executeBinary(operation.getString("statement"), params) : db.execute(operation.getString("statement"), params);
    }

    private Response handleBeginTransaction(IHTTPSession session, DatabaseConnection db) throws Exception {
        String body = readRequestBody(session);
        JSONObject request = body.isEmpty() ? new JSONObject() : new JSONObject(body);
        if (!"SERIALIZABLE".equals(request.optString("isolationLevel", "SERIALIZABLE"))) {
            return newFixedLengthResponse(
                Response.Status.BAD_REQUEST,
                "text/plain",
                "Only SERIALIZABLE transaction isolation is supported"
            );
        }
        db.beginTransaction();
        return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
    }

    private Response handleCommitTransaction(IHTTPSession session, DatabaseConnection db) throws Exception {
        readRequestBody(session); // drain any body to keep the connection clean for keep-alive
        db.commitTransaction();
        return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
    }

    private Response handleRollbackTransaction(IHTTPSession session, DatabaseConnection db) throws Exception {
        readRequestBody(session); // drain any body to keep the connection clean for keep-alive
        db.rollbackTransaction();
        return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
    }

    private String readRequestBody(IHTTPSession session) throws IOException {
        return new String(readRequestBytes(session), StandardCharsets.UTF_8);
    }

    private byte[] readRequestBytes(IHTTPSession session) throws IOException {
        if (session.getHeaders().containsKey("transfer-encoding")) throw new IOException("Chunked requests are unsupported");
        String header = session.getHeaders().get("content-length");
        long length;
        try {
            length = header == null ? 0 : Long.parseLong(header);
        } catch (NumberFormatException error) {
            throw new IOException("Invalid Content-Length", error);
        }
        if (length < 0 || length > BinaryFrame.MAX_BYTES) throw new IOException("Request exceeds 64 MiB");
        byte[] bytes = new byte[(int) length];
        new DataInputStream(session.getInputStream()).readFully(bytes);
        return bytes;
    }

    private static String generateToken() {
        SecureRandom random = new SecureRandom();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
