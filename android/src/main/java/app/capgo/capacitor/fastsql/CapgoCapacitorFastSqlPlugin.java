package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * Native SQL Plugin for Android
 *
 * This plugin uses a custom HTTP server for efficient data transfer,
 * bypassing Capacitor's standard bridge for better performance.
 */
@CapacitorPlugin(name = "CapgoCapacitorFastSql")
public class CapgoCapacitorFastSqlPlugin extends Plugin {

    private final String pluginVersion = "8.0.6";

    private Map<String, SQLDatabase> databases = new HashMap<>();
    private SQLHTTPServer server;

    @PluginMethod
    public void connect(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        // Check if already connected
        if (databases.containsKey(database)) {
            if (server != null) {
                JSObject ret = new JSObject();
                ret.put("port", server.getPort());
                ret.put("token", server.getToken());
                ret.put("database", database);
                call.resolve(ret);
                return;
            }
        }

        try {
            // Get database path
            File dbFile = getDatabasePath(database);

            // Open database
            SQLDatabase db = new SQLDatabase(dbFile.getAbsolutePath());
            databases.put(database, db);

            // Start HTTP server if not already running
            if (server == null) {
                server = new SQLHTTPServer(databases);
                server.start();
            }

            JSObject ret = new JSObject();
            ret.put("port", server.getPort());
            ret.put("token", server.getToken());
            ret.put("database", database);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to connect to database: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        SQLDatabase db = databases.get(database);
        if (db == null) {
            call.reject("Database '" + database + "' is not connected");
            return;
        }

        db.close();
        databases.remove(database);

        // Stop server if no more databases
        if (databases.isEmpty() && server != null) {
            server.stop();
            server = null;
        }

        call.resolve();
    }

    @PluginMethod
    public void getServerInfo(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        if (!databases.containsKey(database)) {
            call.reject("Database '" + database + "' is not connected");
            return;
        }

        if (server == null) {
            call.reject("Server is not running");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("port", server.getPort());
        ret.put("token", server.getToken());
        call.resolve(ret);
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        String statement = call.getString("statement");
        if (statement == null) {
            call.reject("Statement is required");
            return;
        }

        SQLDatabase db = databases.get(database);
        if (db == null) {
            call.reject("Database '" + database + "' is not connected");
            return;
        }

        JSArray params = call.getArray("params", new JSArray());

        try {
            JSObject result = db.execute(statement, params);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to execute statement: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void beginTransaction(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        SQLDatabase db = databases.get(database);
        if (db == null) {
            call.reject("Database '" + database + "' is not connected");
            return;
        }

        try {
            db.beginTransaction();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to begin transaction: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void commitTransaction(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        SQLDatabase db = databases.get(database);
        if (db == null) {
            call.reject("Database '" + database + "' is not connected");
            return;
        }

        try {
            db.commitTransaction();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to commit transaction: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void rollbackTransaction(PluginCall call) {
        String database = call.getString("database");
        if (database == null) {
            call.reject("Database name is required");
            return;
        }

        SQLDatabase db = databases.get(database);
        if (db == null) {
            call.reject("Database '" + database + "' is not connected");
            return;
        }

        try {
            db.rollbackTransaction();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to rollback transaction: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getPluginVersion(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("version", pluginVersion);
        call.resolve(ret);
    }

    private File getDatabasePath(String database) {
        File dataDir = getContext().getFilesDir();
        return new File(dataDir, database + ".db");
    }
}
