package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import fi.iki.elonen.NanoHTTPD; // Note: org.nanohttpd:nanohttpd:2.3.1 still uses fi.iki.elonen package
import java.io.IOException;
import java.security.SecureRandom;
import java.util.Map;
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
    private final Gson gson = new Gson();

    public SQLHTTPServer(Map<String, DatabaseConnection> databases) throws IOException {
        super(findAvailablePort());
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
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Database");
        response.addHeader("Access-Control-Max-Age", "86400");
        return response;
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

        String uri = session.getUri();
        Method method = session.getMethod();

        try {
            if (method == Method.POST && uri.equals("/execute")) {
                return addCorsHeaders(handleExecute(session, db));
            } else if (method == Method.POST && uri.equals("/batch")) {
                return addCorsHeaders(handleBatch(session, db));
            } else if (method == Method.POST && uri.equals("/transaction/begin")) {
                return addCorsHeaders(handleBeginTransaction(db));
            } else if (method == Method.POST && uri.equals("/transaction/commit")) {
                return addCorsHeaders(handleCommitTransaction(db));
            } else if (method == Method.POST && uri.equals("/transaction/rollback")) {
                return addCorsHeaders(handleRollbackTransaction(db));
            } else {
                return addCorsHeaders(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Endpoint not found"));
            }
        } catch (Exception e) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Error: " + e.getMessage()));
        }
    }

    private Response handleExecute(IHTTPSession session, DatabaseConnection db) throws Exception {
        // Read request body
        String body = readRequestBody(session);
        JsonObject request = JsonParser.parseString(body).getAsJsonObject();

        String statement = request.get("statement").getAsString();
        JsonArray paramsJson = request.has("params") ? request.getAsJsonArray("params") : new JsonArray();

        // Convert to JSArray
        JSArray params = new JSArray();
        for (JsonElement param : paramsJson) {
            if (param.isJsonNull()) {
                params.put(JSONObject.NULL);
            } else if (param.isJsonPrimitive()) {
                if (param.getAsJsonPrimitive().isNumber()) {
                    try {
                        params.put(param.getAsLong());
                    } catch (NumberFormatException e) {
                        params.put(param.getAsDouble());
                    }
                } else if (param.getAsJsonPrimitive().isBoolean()) {
                    params.put(param.getAsBoolean());
                } else {
                    params.put(param.getAsString());
                }
            } else if (param.isJsonObject()) {
                JsonObject obj = param.getAsJsonObject();
                JSONObject jsonObj = new JSONObject();
                for (String key : obj.keySet()) {
                    jsonObj.put(key, obj.get(key).getAsString());
                }
                params.put(jsonObj);
            }
        }

        // Execute query
        JSObject result = db.execute(statement, params);

        // Convert result to JSON
        String resultJson = result.toString();
        return newFixedLengthResponse(Response.Status.OK, "application/json", resultJson);
    }

    private Response handleBatch(IHTTPSession session, DatabaseConnection db) throws Exception {
        // Read request body
        String body = readRequestBody(session);
        JsonObject request = JsonParser.parseString(body).getAsJsonObject();
        JsonArray operations = request.getAsJsonArray("operations");

        JSONArray results = new JSONArray();
        for (JsonElement opElement : operations) {
            JsonObject operation = opElement.getAsJsonObject();
            String statement = operation.get("statement").getAsString();
            JsonArray paramsJson = operation.has("params") ? operation.getAsJsonArray("params") : new JsonArray();

            // Convert to JSArray
            JSArray params = new JSArray();
            for (JsonElement param : paramsJson) {
                if (param.isJsonNull()) {
                    params.put(JSONObject.NULL);
                } else if (param.isJsonPrimitive()) {
                    if (param.getAsJsonPrimitive().isNumber()) {
                        try {
                            params.put(param.getAsLong());
                        } catch (NumberFormatException e) {
                            params.put(param.getAsDouble());
                        }
                    } else if (param.getAsJsonPrimitive().isBoolean()) {
                        params.put(param.getAsBoolean());
                    } else {
                        params.put(param.getAsString());
                    }
                } else if (param.isJsonObject()) {
                    JsonObject obj = param.getAsJsonObject();
                    JSONObject jsonObj = new JSONObject();
                    for (String key : obj.keySet()) {
                        jsonObj.put(key, obj.get(key).getAsString());
                    }
                    params.put(jsonObj);
                }
            }

            JSObject result = db.execute(statement, params);
            results.put(new JSONObject(result.toString()));
        }

        return newFixedLengthResponse(Response.Status.OK, "application/json", results.toString());
    }

    private Response handleBeginTransaction(DatabaseConnection db) throws Exception {
        db.beginTransaction();
        return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
    }

    private Response handleCommitTransaction(DatabaseConnection db) throws Exception {
        db.commitTransaction();
        return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
    }

    private Response handleRollbackTransaction(DatabaseConnection db) throws Exception {
        db.rollbackTransaction();
        return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
    }

    private String readRequestBody(IHTTPSession session) throws IOException {
        int contentLength = Integer.parseInt(session.getHeaders().get("content-length"));
        byte[] buffer = new byte[contentLength];
        session.getInputStream().read(buffer, 0, contentLength);
        return new String(buffer);
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

    private static int findAvailablePort() {
        // Try ports in the range 9000-9100
        for (int port = 9000; port < 9100; port++) {
            try {
                NanoHTTPD testServer = new NanoHTTPD(port) {
                    @Override
                    public Response serve(IHTTPSession session) {
                        return null;
                    }
                };
                testServer.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
                testServer.stop();
                return port;
            } catch (IOException e) {
                // Port not available, try next one
            }
        }
        return 9000; // Fallback
    }
}
